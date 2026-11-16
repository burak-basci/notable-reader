#!/usr/bin/env python3
"""Private, offline Brave document reader. No document text is written to logs."""
from __future__ import annotations

import atexit
import bisect
import contextlib
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import wave
from dataclasses import dataclass, field

ROOT = Path(__file__).resolve().parent
BASE_SPEED = 1.0


def product_metadata():
    """Release identity is distinct from the stable loopback protocol version."""
    try:
        value=json.loads((ROOT/'build-info.json').read_text())
        if (not isinstance(value,dict) or type(value.get('protocolVersion'))is not int or value['protocolVersion']!=1 or
            not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',str(value.get('productVersion',''))) or
            not re.fullmatch(r'[a-f0-9]{64}',str(value.get('buildHash','')))):
            raise ValueError('Invalid build metadata')
        return {'productVersion':value['productVersion'],'buildHash':value['buildHash'],'protocolVersion':1}
    except (OSError,ValueError,TypeError):
        return {'productVersion':'1.6.4','buildHash':None,'protocolVersion':1}


class ReadFailure(RuntimeError):
    """Only static, locally authored playback explanations may reach the UI."""


def read_failure(error, stage):
    """Dataminimal support metadata; never format an exception or its locals."""
    name=type(error).__name__
    name=name if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,63}',name)else 'Exception'
    result={'stage':stage,'exception':name,'source':'external','line':0}
    allowed={'player.py','prefetch.py','synthesis.py','piper_engine.py','engines.py','timing.py','extraction.py','remaining.py'}
    trace=error.__traceback__
    while trace:
        path=Path(trace.tb_frame.f_code.co_filename)
        if path.name in allowed and path.resolve().parent==ROOT:
            result.update(source=path.name,line=trace.tb_lineno)
        trace=trace.tb_next
    return result


def synth_worker():
    """One model for the application's lifetime; requests do not reload it."""
    loaded_at = time.monotonic()
    import logging
    logging.disable(logging.CRITICAL)
    import onnxruntime as ort
    import soundfile as sf
    from kokoro_onnx import Kokoro

    from accelerator import create_session

    def new_options():
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        options.log_severity_level = 4
        return options

    session = create_session(ort, ROOT / "models/kokoro-full.onnx", new_options())
    active_lock = threading.Lock()
    active = {"id": None, "options": None, "cancelled": None, "done": -1}
    cancelled_ids = set()
    shutdown = threading.Event()

    class CancelledInference(Exception):
        pass

    class Session:
        def __init__(self, inner):
            self._inner = inner

        def __getattr__(self, name):
            return getattr(self._inner, name)

        def run(self, output_names, inputs):
            with active_lock:
                run_options = active["options"]
                if shutdown.is_set() or active["cancelled"] is None or active["cancelled"].is_set():
                    raise CancelledInference()
            # The same loaded session is retained when RunOptions terminates a run.
            return self._inner.run(output_names, inputs, run_options)

    from engines import Engines
    from memory_usage import release_unused_memory

    def open_session(path):
        # Extra voices (German Kokoro fine-tunes, Piper) use the same device policy.
        return Session(session if Path(path) == ROOT / "models/kokoro-full.onnx"
                       else create_session(ort, path, new_options()))

    engines = Engines(ROOT, open_session, Kokoro, release_unused_memory)
    engines.get("base")
    release_unused_memory()
    print(json.dumps({"type": "ready", "pid": os.getpid(),
                      "loadSeconds": time.monotonic() - loaded_at,
                      "providers": session.get_providers()}), flush=True)
    requests = queue.Queue()

    def input_loop():
        try:
            for line in sys.stdin:
                try:
                    request = json.loads(line)
                    if request.get("type") == "cancel":
                        identity = request.get("id")
                        if type(identity) is not int:
                            continue
                        with active_lock:
                            if identity > active["done"]:
                                cancelled_ids.add(identity)
                            if active["id"] == identity:
                                active["cancelled"].set()
                                active["options"].terminate = True
                    else:
                        requests.put(request)
                except (ValueError, TypeError, AttributeError):
                    continue
        finally:
            shutdown.set()
            with active_lock:
                if active["options"] is not None:
                    active["options"].terminate = True
            requests.put(None)

    threading.Thread(target=input_loop, name="synthesis-control", daemon=True).start()
    while not shutdown.is_set():
        request = requests.get()
        if request is None:
            break
        identity = request.get("id", 0)
        cancelled = threading.Event()
        with active_lock:
            run_options = ort.RunOptions()
            run_options.log_severity_level = 4
            if "CUDAExecutionProvider" in session.get_providers():
                # Variable sentence shapes otherwise fragment the bounded GPU
                # arena until a later paragraph fails despite free device RAM.
                # Release unused arena regions after each run, keeping weights
                # and this same model session resident.
                run_options.add_run_config_entry(
                    "memory.enable_memory_arena_shrinkage", "gpu:0")
            active.update(id=identity, options=run_options, cancelled=cancelled)
            if identity in cancelled_ids or shutdown.is_set():
                cancelled.set()
                run_options.terminate = True
        try:
            if cancelled.is_set():
                raise CancelledInference()
            voice = request.get("voice") if isinstance(request.get("voice"), str) else None
            if request.get("warm") is True:
                engines.warm(voice)
                print(json.dumps({"id": identity, "ok": True, "warm": True, "loaded": engines.names()}), flush=True)
                continue
            samples, sample_rate, spoken = engines.synthesize(voice, request["text"])
            if cancelled.is_set() or shutdown.is_set():
                raise CancelledInference()
            sf.write(request["output"], samples, sample_rate)
            os.chmod(request["output"], 0o600)
            print(json.dumps({"id": identity, "ok": True, "timings": spoken,
                              "loaded": engines.names()}), flush=True)
        except Exception:
            # Library exceptions can contain the input text; never pass them through.
            print(json.dumps({"id": identity, "ok": False,
                              "cancelled": cancelled.is_set() or shutdown.is_set()}), flush=True)
        finally:
            # ONNX/CUDA scratch allocations are temporary; keep only the model.
            samples = None
            release_unused_memory()
            with active_lock:
                active.update(id=None, options=None, cancelled=None)
                active["done"] = max(active["done"], identity)
                cancelled_ids.discard(identity)


def runtime_dir():
    base = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    if not base.is_dir() or base.stat().st_uid != os.getuid():
        raise RuntimeError("Kein privates Laufzeitverzeichnis verfügbar.")
    path = base / "brave-reader"
    path.mkdir(mode=0o700, exist_ok=True)
    if path.is_symlink() or path.stat().st_uid != os.getuid():
        raise RuntimeError("Unsicheres Laufzeitverzeichnis.")
    path.chmod(0o700)
    return path


def send_command(path, command):
    try:
        with socket.socket(socket.AF_UNIX) as sock:
            sock.settimeout(0.7)
            sock.connect(str(path))
            sock.sendall((command + "\n").encode())
            return sock.recv(32).startswith(b"ok")
    except (OSError, TimeoutError):
        return False


def terminate(process):
    if process is None or process.poll() is not None:
        return
    with contextlib.suppress(ProcessLookupError):
        process.terminate()
    try:
        process.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            process.kill()
        process.wait(timeout=1)


@dataclass
class Reading:
    number: int
    cancelled: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    player: subprocess.Popen | None = None
    paused: bool = False
    ipc: Path | None = None
    remaining: object | None = None
    position: float = 0.0
    last_word: dict | None = None
    document: dict | None = None
    resume: bool = False
    require_selection: bool = False
    visible_start: bool = False
    voice: str | None = None
    language: str | None = None
    status_text: str = "Liest vor · Bella · Englisch · offline"
    start_section: int = 0
    start_fraction: float = 0.0
    section_index: int = 0
    start_char: int = 0
    section_char: int = 0
    full_timing: object | None = None
    failure: dict | None = None
    finished: threading.Event = field(default_factory=threading.Event)

    def launch(self, attribute, args, **kwargs):
        with self.lock:
            if self.cancelled.is_set():
                return None
            process = subprocess.Popen(args, **kwargs)
            setattr(self, attribute, process)
            return process

    def cancel(self):
        self.cancelled.set()
        with self.lock:
            terminate(self.player)

    def restore_pause(self, actual=None):
        """Fence current intent through its ACK; never restore a cached value."""
        with self.lock:
            if self.cancelled.is_set():return False
            if type(actual)is bool and actual is self.paused:return True
            return self.mpv(["set_property", "pause", self.paused])

    def mpv(self, command):
        """A successful write is not a device ACK. Every call is bounded."""
        if self.ipc is None or self.cancelled.is_set():return False
        deadline=time.monotonic()+0.15
        try:
            with socket.socket(socket.AF_UNIX) as sock:
                sock.settimeout(max(.001,deadline-time.monotonic()))
                sock.connect(str(self.ipc))
                sock.settimeout(max(.001,deadline-time.monotonic()))
                sock.sendall((json.dumps({"command": command,"request_id":1}) + "\n").encode())
                buffer=b""
                while not self.cancelled.is_set():
                    remaining=deadline-time.monotonic()
                    if remaining<=0:return False
                    sock.settimeout(remaining)
                    block=sock.recv(8192)
                    if not block:return False
                    buffer+=block
                    if len(buffer)>65536:return False
                    while b"\n"in buffer:
                        line,_,buffer=buffer.partition(b"\n");message=json.loads(line)
                        if message.get('request_id')==1:return message.get('error')=='success'
        except (OSError,ValueError):return False
        return False


def sentences(chunks):
    """Extraction already bounds chunks and attaches precise PDF word geometry."""
    for chunk in chunks:
        if str(chunk.get("text", "")).strip():
            yield chunk


class BrowserBridge:
    """The browser owns rendering; Python owns playback and the audio clock."""
    def __init__(self, events, script="bridge.mjs", event="browser"):
        self.events = events
        self.event = event
        self.lock = threading.Lock()
        self._appearance_lock=threading.Lock();self._appearance_serial=0;self._appearance_pending=None;self._appearance_writer=None;self._appearance_closed=False;self._appearance_small=[]
        self.process = subprocess.Popen(["node", str(ROOT / script)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1)
        threading.Thread(target=self.receive, daemon=True).start()

    def receive(self):
        try:
            for line in self.process.stdout:
                value = json.loads(line)
                self.events.put((None, self.event, value))
        except (ValueError, OSError):
            pass

    def send(self, value):
        with self._appearance_lock:
            if self._appearance_writer is not None and threading.current_thread() is not self._appearance_writer:
                if len(self._appearance_small)>=4096 and value.get('type')in('word','state'):
                    for index,item in enumerate(self._appearance_small):
                        if item.get('type')==value['type']:self._appearance_small.pop(index);break
                self._appearance_small.append(value);return
            if self._appearance_writer is None:
                self._send_direct(value);return
        self._send_direct(value)

    def _send_direct(self, value):
        with self.lock:
            if self.process.poll() is not None:
                return
            try:
                self.process.stdin.write(json.dumps(value) + "\n")
                self.process.stdin.flush()
            except (OSError, ValueError, BrokenPipeError):
                pass

    def send_appearance(self, value):
        # Large page rasters never encode/write on Tk. Only one latest transfer;
        # small frames release the existing bridge lock between ordinary states.
        with self._appearance_lock:
            if self._appearance_closed:return
            self._appearance_serial+=1;self._appearance_pending=(self._appearance_serial,value)
            if self._appearance_writer is None:
                self._appearance_writer=threading.Thread(target=self._write_appearance,name='reader-raster-transport',daemon=True);self._appearance_writer.start()

    def _write_appearance(self):
        while True:
            with self._appearance_lock:
                if self._appearance_closed:self._appearance_writer=None;return
                small,self._appearance_small=self._appearance_small,[]
                if self._appearance_pending is None:
                    if not small:self._appearance_writer=None;return
                    pending=None
                else:pending=self._appearance_pending;self._appearance_pending=None
            for message in small:self._send_direct(message)
            if pending is None:continue
            serial,value=pending
            encoded=json.dumps(value,separators=(',',':'))
            if len(encoded)>64*1024*1024:
                self.send({'type':'appearanceFigures','context':value.get('context'),'appearanceFigures':[],'appearancePages':[],'appearanceRasters':[],'errorKey':'appearance_figures_unavailable'});continue
            transfer=os.urandom(16).hex();size=48*1024;parts=math.ceil(len(encoded)/size)
            for part in range(parts):
                with self._appearance_lock:
                    if self._appearance_closed or serial!=self._appearance_serial:break
                    small,self._appearance_small=self._appearance_small,[]
                for message in small:self._send_direct(message)
                self.send({'type':'appearanceChunk','transferId':transfer,'part':part,'parts':parts,'payload':encoded[part*size:(part+1)*size]})
                time.sleep(.001)

    def cancel_appearance(self):
        with self._appearance_lock:self._appearance_serial+=1;self._appearance_pending=None

    def close(self):
        with self._appearance_lock:
            self._appearance_closed=True;self._appearance_serial+=1;self._appearance_pending=None;self._appearance_small=[];writer=self._appearance_writer
        if writer:
            writer.join(.2)
            if writer.is_alive():terminate(self.process);writer.join(.2)
        self._send_direct({"type": "close"})
        with contextlib.suppress(OSError):
            self.process.stdin.close()
        try:
            self.process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            terminate(self.process)


def word_frames(chunk, timings):
    frames = []
    for timed in timings:
        if timed.get("silent"):  # citation mark: kept in text and offsets, never highlighted
            continue
        matches = [word for word in chunk.get("words", [])
                   if word["start"] < timed["charEnd"] and word["end"] > timed["charStart"]]
        if matches:
            frames.append({"start": timed["start"], "end": timed["end"], "word": matches[0]})
    return frames


class PlaybackTimeline:
    """Original word geometry on the continuous PCM sample clock."""
    def __init__(self):
        self.lock = threading.Lock()
        self.starts, self.frames = [], []
        self.chunk_starts, self.chunks = [], []
        self.samples = 0

    def append(self, prepared, samples):
        with self.lock:
            offset = self.samples / 24000
            self.chunk_starts.append(offset)
            self.chunks.append(prepared.chunk)
            for frame in word_frames(prepared.chunk, prepared.timings):
                self.starts.append(offset + frame["start"])
                self.frames.append(frame["word"])
            self.samples += samples

    def at(self, position):
        with self.lock:
            chunk_index = bisect.bisect_right(self.chunk_starts, position + 0.015) - 1
            word_index = bisect.bisect_right(self.starts, position + 0.015) - 1
            chunk = self.chunks[chunk_index] if chunk_index >= 0 else None
            word = self.frames[word_index] if word_index >= 0 else None
            return chunk_index, chunk, word_index, word


def watch_playback(reading, process, timeline, notify, ready=lambda: None):
    """Use mpv's media position, which already accounts for pause and speed."""
    last_chunk = last_word = -1
    last_progress = 0.0
    request_id = 0
    while not reading.cancelled.is_set() and process.poll() is None:
        try:
            with socket.socket(socket.AF_UNIX) as sock:
                sock.settimeout(0.15)
                sock.connect(str(reading.ipc))
                buffer = b""
                def property_value(name):
                    nonlocal request_id, buffer
                    request_id += 1
                    sock.sendall((json.dumps({"command": ["get_property", name],
                                              "request_id": request_id}) + "\n").encode())
                    while True:
                        while b"\n" not in buffer:
                            data = sock.recv(8192)
                            if not data:
                                raise ConnectionError("player closed")
                            buffer += data
                        line, _, buffer = buffer.partition(b"\n")
                        message = json.loads(line)
                        if message.get("request_id") == request_id:
                            return message.get("data")
                # A keep-open EOF can itself set pause. Never reconcile that
                # terminal state into an unpause/restart loop.
                if property_value("eof-reached") is True:
                    sock.sendall(b'{"command":["quit"]}\n');return
                ready()
                last_pause_check=0.0
                while not reading.cancelled.is_set() and process.poll() is None:
                    if property_value("eof-reached") is True:
                        sock.sendall(b'{"command":["quit"]}\n');return
                    now=time.monotonic()
                    if now-last_pause_check>=.2:
                        last_pause_check=now
                        reading.restore_pause(property_value("pause"))
                    position = property_value("time-pos")
                    if isinstance(position, (int, float)):
                        chunk_index, chunk, word_index, word = timeline.at(position)
                        if chunk is not None and chunk_index != last_chunk:
                            last_chunk = chunk_index
                            reading.section_index = reading.start_section + chunk_index
                            reading.section_char = reading.start_char if chunk_index == 0 else 0
                            notify("preview", chunk)
                            notify("status", getattr(reading, "status_text", "Liest vor · Bella · Englisch · offline"))
                        if word is not None and word_index != last_word:
                            last_word = word_index
                            reading.last_word = word
                            reading.section_char = (reading.start_char if chunk_index == 0 else 0) + word.get("start",0)
                            notify("word", word)
                        if time.monotonic() - last_progress >= 0.4:
                            last_progress = time.monotonic()
                            notify("progress", position)
                    reading.cancelled.wait(0.02)
        except (OSError, ValueError, ConnectionError):
            reading.cancelled.wait(0.03)


class Reader:
    def __init__(self, runtime, server, watch_browser=True, preferences_path=None, positions_path=None,
                 premium_provider=None, export_output_dir=None):
        import tkinter as tk
        from preferences import Preferences
        self.tk = tk
        self.preferences = Preferences(preferences_path)
        import voices as voice_catalog
        self.voice_catalog = voice_catalog
        self.catalog = voice_catalog.catalog(ROOT)
        self.catalog_version = voice_catalog.catalog_version(self.catalog)
        self.detected_language = None
        self.detection_cache = {}
        self._timing = None
        self._timing_key = None
        self._idle_position = None
        self._navigation_chosen = False
        self._navigation_preview = None
        self._chapters = [];self._chapter_anchors = [];self._chapter_order = [];self._chapter_focus = -1
        self._premium_provider = premium_provider
        from audiobook_export import premium_status
        # Isolated readers created with watch_browser=False do not contact or
        # initialize the owner's real licence store merely by running a test.
        self._premium = premium_status(premium_provider if watch_browser or premium_provider is not None else object())
        self._premium_activation = {'state': 'idle', 'errorKey': ''}
        self._premium_refreshing = False
        from positions import Positions
        # Older isolated tests supply only a preferences path; keep bookmarks
        # beside it instead of ever writing the user's real reading position.
        if positions_path is None and preferences_path is not None:
            positions_path = Path(preferences_path).with_name("positions.json")
        self.positions = Positions(positions_path)
        self.prepare_generation = 0
        self.capture_lock = threading.Lock()
        self.runtime, self.server = runtime, server
        self.events = queue.Queue()
        self.bridge = BrowserBridge(self.events)
        self.extension_control = None
        self.extension_request = None
        self.extension_hides = {}
        self.visibility_serial = 0
        self._overlay_visible=None
        self._visibility_pending=None
        self.target_visibility = {}
        self.dismissed_documents = {}
        self.watched_context = None
        self.last_error = None
        self.preference_version = 0
        self._extension_status_lock = threading.Lock()
        self._extension_snapshot = {
            **self.regional_format_state(), **self.player_theme_state(),
            'uiLanguage':self.preferences.ui_language, 'uiLanguages':['de','en','fr','es','it','pt'],
            'catalog':self.catalog, 'premium':self._premium, 'premiumActivation':self._premium_activation, 'appearance':self.appearance_state(),
            'exportState':{'state':'idle','percent':0,'completedChunks':0,'totalChunks':0,'filename':'','error':'','errorKey':''},
            'settings': {'speed': self.preferences.speed, 'follow': self.preferences.follow,
                         'clickSeek': self.preferences.click_seek, 'autoShow': self.preferences.auto_show,
                         'bar': dict(self.preferences.bar), 'language': self.preferences.language,
                         'uiLanguage': self.preferences.ui_language, **self.regional_format_state(), **self.player_theme_state(), 'appearance':self.appearance_state(),
                         'voices': dict(self.preferences.voices),
                         'volume': self.preferences.volume, 'muted': self.preferences.muted},
            'playback': {'playing': False, 'paused': False},
        }
        if watch_browser:
            from extension_api import ExtensionControl
            try:
                self.extension_control = ExtensionControl(self.events, status_provider=self.extension_status, document_provider=self.document_response)
            except OSError:
                self.extension_control = None
        self.inline = False
        self.attach_request_id = None
        self.follow = self.preferences.follow
        self.click_seek = self.preferences.click_seek
        self.document = None
        self.navigation_pages = {}
        self.requested_pages = []
        self.browser_context = None
        self.reading = None
        self.serial = 0
        self.rate = self.preferences.speed
        self.volume = self.preferences.volume
        self.muted = self.preferences.muted
        self.closing = threading.Event()
        self.window = tk.Tk(className="BraveReader")
        self.window.withdraw()
        # Tk owns only the event queue and variables. No desktop reader window
        # or fallback widgets exist; all visible controls belong to the extension.
        self.window.protocol("WM_DELETE_WINDOW", self.close)
        self.title = tk.StringVar(value="Dokument in Brave vorlesen")
        self.status = tk.StringVar(value="Bereit · " + self.voice_status())
        self.status_kind = "info"
        self.status_key = 'ready'
        self.last_read_error = None
        self.status_params = {}
        self.page = tk.StringVar(value="")
        self.preview = tk.StringVar(value="")
        self.speed_label = tk.StringVar(value=f"Tempo {self.rate:.2f}×".replace(".", ","))
        self.pause_label = tk.StringVar(value="Pause")
        self.speed_scale = tk.DoubleVar(value=self.rate)
        self.window.after(20, self.drain)
        from synthesis import SynthService
        self.synth = SynthService(self.runtime, Path(__file__))
        from audiobook_export import NativeExportManager
        self.export_manager = NativeExportManager(self.synth, output_dir=export_output_dir, runtime=self.runtime,
            premium_provider=premium_provider, notify=lambda state: self.events.put((None, 'export_status', state)))
        from reading_view import ReadingViewManager
        self.view_manager=ReadingViewManager(runtime=self.runtime,notify=lambda state:self.events.put((None,'document_status',state)))
        self._appearance_system_dark=True;self._figure_request_key=None;self._figure_request_serial=0;self._figure_lock=threading.Lock()
        from document_export import DocumentExportManager,ExportCoordinator
        document_export=DocumentExportManager(self.view_manager,output_dir=export_output_dir,runtime=self.runtime,premium_provider=premium_provider,notify=lambda state:self.events.put((None,'export_status',state)))
        self.export_manager=ExportCoordinator(self.export_manager,document_export)
        self.watcher = BrowserBridge(self.events, "watch.mjs", "browser_watch") if watch_browser else None
        self.publish_extension_status()
        if watch_browser or premium_provider is not None:self.window.after(1000, self.refresh_premium)
        threading.Thread(target=self.commands, daemon=True).start()

    def set_status(self, text, kind="info", key=None, params=None):
        """Keep authored reader status for the extension and inline controls."""
        self.status.set(text)
        self.status_kind = kind if kind == "error" else "info"
        if key is None:
            if kind == 'error': key = 'reader_error'
            elif text.startswith('Pausiert'): key = 'paused'
            elif text.startswith(('Liest vor', 'Vorlesen wird fortgesetzt')): key = 'playing'
            elif text.startswith('Gestoppt'): key = 'stopped'
            elif text.startswith('Fertig'): key = 'completed'
            elif 'wird' in text or 'vorbereitet' in text: key = 'preparing'
            else: key = 'ready'
        self.status_key, self.status_params = key, params or {}

    def emit(self, reading, kind, value=None):
        self.events.put((reading.number, kind, value))

    def drain(self):
        if (self.extension_request and self.extension_control and
            not self.extension_control.is_pending(self.extension_request['requestId'])):
            self.expire_extension_show()
        self.extension_hides = {key: value for key, value in self.extension_hides.items()
                                if self.extension_control and self.extension_control.is_pending(key)}
        while True:
            try:
                number, kind, value = self.events.get_nowait()
            except queue.Empty:
                break
            if kind == "command":
                if value == 'restart':self.restart(visible=True)
                else:{"show": self.show, "toggle": self.toggle,
                      "stop": self.stop}.get(value, lambda: None)()
                continue
            if kind == 'document_status':
                self.sync_browser();continue
            if kind == 'appearance_figures':
                if value.get('serial')==self._figure_request_serial and value.get('context')==self.browser_context:
                    if value['metadata'].get('errorKey'):self._figure_request_key=None
                    message={'type':'appearanceFigures','context':self.browser_context,**value['metadata']}
                    if hasattr(self.bridge,'send_appearance'):self.bridge.send_appearance(message)
                    else:self.bridge.send(message)
                continue
            if kind == 'export_status':
                phase = value.get('state')
                key = {'running':'export_running', 'complete':'export_complete', 'cancelled':'export_cancelled',
                       'locked':'premium_locked', 'error':'export_failed'}.get(phase)
                if key and value.get('kind')=='document':
                    key={'running':'document_export_running','complete':'document_export_complete','cancelled':'document_export_cancelled','locked':'premium_locked','error':value.get('errorKey')or'document_export_failed'}.get(phase,key)
                    message={'running':'Dokument wird lokal gespeichert …','complete':'Vollständiges Dokument gespeichert.','cancelled':'Dokumentexport abgebrochen.','locked':'Für Downloads ist Reader Premium erforderlich.','error':'Das vollständige Dokument konnte nicht gespeichert werden.'}[phase]
                    self.set_status(message,'error'if phase in('locked','error')else'info',key=key);self.sync_browser();continue
                if key:
                    messages = {'export_running':'Hörbuch wird lokal erstellt …', 'export_complete':'Vollständiges Hörbuch gespeichert.',
                                'export_cancelled':'Hörbuchexport abgebrochen.', 'premium_locked':'Für Downloads ist Reader Premium erforderlich.',
                                'export_failed':'Das Hörbuch konnte nicht vollständig gespeichert werden.'}
                    self.set_status(messages[key], 'error' if phase in ('error','locked') else 'info', key=key,
                                    params={'completed':value.get('completedChunks',0),'total':value.get('totalChunks',0)})
                self.sync_browser(); continue
            if kind in ('premium_status', 'premium_activation'):
                self._premium = value['premium']
                if kind == 'premium_activation':
                    self._premium_activation = {'state':'complete' if not value.get('errorKey') else 'error', 'errorKey':value.get('errorKey','')}
                    if value.get('requestId') and self.extension_control:
                        self.publish_extension_status()
                        self.extension_control.complete(value['requestId'], not value.get('errorKey'),
                            value.get('errorKey') or 'applied', extra=self.extension_status())
                self.sync_browser(); continue
            if kind == "extension_show":
                self.show_extension(value)
                continue
            if kind == "extension_hide":
                self.hide_extension(value)
                continue
            if kind == "extension_hide_captured":
                self.extension_hide_captured(value)
                continue
            if kind in ('extension_settings', 'extension_control'):
                self.extension_operation(kind, value)
                continue
            if kind == "extension_captured":
                self.extension_captured(value)
                continue
            if kind == "browser":
                self.browser_event(value)
                continue
            if kind == "browser_watch":
                self.watch_context(value)
                continue
            if kind == 'show_captured':
                context = value['context']
                if self.target_visibility.get(context.get('targetId'), 0) <= value['intent']:
                    self.allow_context(context, value['intent'])
                    self.attach_context(context)
                continue
            if kind == "attach_context":
                self.allow_context(value)
                self.attach_context(value)
                continue
            if kind == "prepared":
                if (value.get("generation") != self.prepare_generation
                    or value.get("context") != self.browser_context or self.reading):
                    continue
                document = value.get("document")
                if document and document.get("context") == self.browser_context:
                    if document.get("context", {}).get("kind") == "pdf":
                        document = self.restore_document(document)
                    self.set_document(document, restore=document.get("context", {}).get("kind") == "pdf")
                    self.sync_browser()
                    self.extension_ready()
                else:
                    if self.extension_request and self.extension_request.get('context') == value.get('context'):
                        self.finish_extension(False, "prepare_failed")
                    self.reader_error("prepare_failed")
                continue
            if kind == "show_error":
                self.reader_error(value)
                continue
            if not self.reading or self.reading.number != number:
                continue
            if kind == "captured":
                self.set_document(value)
                if value.get("context", {}).get("kind") in ("pdf", "html"):
                    if self.browser_context != value["context"] or not self.inline:
                        self.browser_context = value["context"]
                        self.requested_pages = []
                        self.send_attach(value["context"])
                    self.send_navigation()
                    self.show_navigation_preview()
                else:
                    self.inline = False
                    self.reader_error("unsupported")
            elif kind == "preview":
                self.preview.set(value["text"][:155])
                self.page.set("Seite " + str(value["page"]) if value.get("page") is not None else "")
            elif kind == "status":
                self.set_status("Pausiert" if self.reading.paused else value)
            elif kind == "word":
                self.save_position(self.reading)
                if self._navigation_preview and self.reading.paused:
                    self.show_navigation_preview()
                else:
                    self._navigation_preview = None
                    self.bridge.send({"type": "word", "word": value, "follow": self.follow})
            elif kind == "progress":
                self.reading.position = value
            elif kind in ("error", "done"):
                if kind == 'error':self.last_read_error=self.reading.failure
                if kind == 'done' and getattr(self.reading,'full_timing',None):
                    self._idle_position = sum(self.reading.full_timing.durations())
                else:
                    self._idle_position = self._media_position()
                self.save_position(self.reading, flush=True)
                self.set_status(value, "error" if kind == "error" else "info")
                self.pause_label.set("Pause")
                self.reading = None
                self.bridge.send({"type": "clear"})
            if kind != "word":
                self.sync_browser()
        self.publish_extension_status()
        if not self.closing.is_set():
            self.window.after(20, self.drain)

    def voice_state(self):
        language, voice = self.resolve_voice()
        return {"language": self.preferences.language, "detectedLanguage": self.detected_language,
                "activeLanguage": language, "voice": voice, "voiceLabel": self.voice_label(voice),
                "catalog": self.catalog, "catalogVersion": self.catalog_version,
                "uiLanguage": getattr(self.preferences, 'ui_language', 'de'), **self.regional_format_state(), **self.player_theme_state(), "appearance":self.appearance_state(),
                "uiLanguages": ['de','en','fr','es','it','pt']}

    @staticmethod
    def navigation_start(document):
        chunks = document.get('navigationChunks', [])
        if not chunks: return 0, 0.0
        index = document.get('_sectionStartIndex')
        start = document.get('_sectionStartChar', 0)
        if type(index) is int and 0 <= index < len(chunks):
            return index, max(0, min(1, start / max(1,len(chunks[index].get('text','')))))
        first = (document.get('chunks') or [{}])[0]
        words = first.get('words') or []
        if words:
            found = Reader.find_word(document, words[0])
            if found: return found[0], found[1]/max(1,len(chunks[found[0]].get('text','')))
        for index, source in enumerate(chunks):
            text = str(first.get('text',''))
            if text and source.get('page') == first.get('page') and str(source.get('text','')).endswith(text):
                return index, (len(source['text'])-len(text))/max(1,len(source['text']))
        return 0, 0.0

    def _media_position(self):
        reading = self.reading
        timer = (getattr(reading,'full_timing',None) if reading else None) or getattr(self,'_timing',None)
        if timer is None: return 0.0
        durations = timer.durations()
        if reading:
            index = max(0,min(len(durations)-1,getattr(reading,'start_section',0)))
            return timer.position_at(index,getattr(reading,'start_fraction',0)) + max(0,reading.position)
        if getattr(self,'_idle_position',None) is not None: return self._idle_position
        index, fraction = (self._selected_start if getattr(self,'_selected_document',None) is self.document
                           else self.navigation_start(self.document or {}))
        return timer.position_at(index,fraction)

    def timing_state(self):
        from remaining import RemainingTime
        document = self.document or {}
        chunks = document.get('navigationChunks', [])
        if not chunks and self.reading and self.reading.remaining:
            # Compatibility for older explicit callers supplying only a tail:
            # time is still calibrated, but full-document navigation is unknown
            # and such a document can never be exported as a complete book.
            return {**self.reading.remaining.snapshot(self.reading.position,self.rate),
                    'sectionIndex':0,'sectionCount':0,'remainingEstimated':True}
        timer = (getattr(self.reading,'full_timing',None) if self.reading else None) or getattr(self,'_timing',None)
        if timer is None: timer = RemainingTime(chunks)
        result = timer.snapshot(self._media_position(), self.rate)
        index = getattr(self.reading,'section_index',0) if self.reading else self.navigation_start(document)[0]
        if not self.reading and chunks:
            index=timer.index_at(self._media_position())
        if chunks and result['progressFraction'] >= 1: index = len(chunks)-1
        return {**result,'sectionIndex':max(0,min(len(chunks)-1,index)) if chunks else 0,'sectionCount':len(chunks)}

    def appearance_state(self):
        from reading_view import DEFAULT_APPEARANCE
        return dict(getattr(self.preferences,'appearance',DEFAULT_APPEARANCE))

    def document_state(self):
        manager=getattr(self,'view_manager',None)
        return manager.state()if manager else {'state':'idle','generation':'','errorKey':'','sectionCount':0,'imageCount':0}

    def document_response(self,*,refresh=False):
        manager=getattr(self,'view_manager',None)
        return manager.response(refresh=refresh)if manager else (503,{'ok':False,'version':1,'code':'unavailable','errorKey':'document_unavailable'})

    def change_appearance(self, value):
        before=self.appearance_state()
        try:self.preferences.update({'appearance':value})
        except (ValueError,TypeError):return False
        except OSError:
            self.set_status('Darstellung konnte nicht gespeichert werden.','error',key='save_failed');self.sync_browser();return False
        if before!=self.appearance_state():self.preference_version+=1
        if self.appearance_state()['mode']=='off'and hasattr(self.bridge,'cancel_appearance'):self.bridge.cancel_appearance()
        self.sync_browser();self.request_appearance_figures(getattr(self,'requested_pages',[])or[((self.document or{}).get('chunks')or[{}])[0].get('page',1)]);return True

    def toggle_theme(self):
        mode=self.appearance_state()['mode'];dark=mode=='dark'or mode=='auto'and getattr(self,'_appearance_system_dark',True)
        return self.change_appearance({'mode':'light'if dark else'dark'})

    def open_focus(self, extension_origin=None):
        if not self.document:return False
        from extension_api import EXTENSION_ORIGINS
        extension_origin=extension_origin or getattr(self,'_focus_extension_origin',None)
        if extension_origin is not None and extension_origin not in EXTENSION_ORIGINS:return False
        self.view_manager.response();self.bridge.send({'type':'openFocus', **({'extensionId':extension_origin.split('://',1)[1]} if extension_origin else {})});return True

    def request_appearance_figures(self,pages,dpi=144):
        if not self.document or (self.document.get('context')or{}).get('kind')!='pdf':return
        if self.appearance_state()['mode']=='off':return
        pages=tuple(dict.fromkeys(page for page in pages if type(page)is int and page>0))[:2]
        dpi=dpi if type(dpi)is int and 72<=dpi<=384 else 144
        context=self.document.get('context');key=(self.document.get('fingerprint'),json.dumps(context,sort_keys=True),pages,dpi)
        if not pages or key==getattr(self,'_figure_request_key',None):return
        self._figure_request_key=key;self._figure_request_serial+=1;serial=self._figure_request_serial;document=self.document
        def prepare():
            try:
                with self._figure_lock:
                    if serial!=self._figure_request_serial:return
                    metadata=self.view_manager.pdf_metadata(document,pages,dpi=dpi,rasters=True)
            except Exception:metadata={'appearanceFigures':[],'appearancePages':[],'errorKey':'appearance_figures_unavailable'}
            self.events.put((None,'appearance_figures',{'serial':serial,'context':context,'metadata':metadata}))
        threading.Thread(target=prepare,name='reader-appearance-figures',daemon=True).start()

    def player_theme_state(self):
        return {'playerTheme':getattr(self.preferences,'player_theme','system')}

    def set_overlay_visible(self,visible,request_id=None,expected=None):
        context=self.browser_context;generation=self.document_state().get('generation')
        if type(visible)is not bool or not self.document or self.document.get('context')!=context or expected is not None and expected!=generation:return False
        if getattr(self,'_visibility_pending',None):return False
        identifier=request_id or os.urandom(16).hex()
        self._visibility_pending={'id':identifier,'api':request_id,'context':dict(context),'generation':generation,'visible':visible}
        self._overlay_visible=None
        if not visible:self.stop(quiet=True)
        self.bridge.send({'type':'overlayVisibility','visible':visible,'requestId':identifier,'context':context,'sourceGeneration':generation})
        self.sync_browser()
        def timeout():
            pending=getattr(self,'_visibility_pending',None)
            if pending and pending['id']==identifier:
                self._visibility_pending=None;self.sync_browser()
                if pending['api']and self.extension_control:self.extension_control.complete(pending['api'],False,'timeout',extra=self.extension_status())
        self.window.after(4500,timeout)
        return True

    def visibility_applied(self,value):
        pending=getattr(self,'_visibility_pending',None)
        if not pending or value.get('requestId')!=pending['id']or value.get('context')!=pending['context']:return
        if value.get('sourceGeneration')!=pending['generation']:return
        if pending['api']and self.extension_control and not self.extension_control.is_pending(pending['api']):
            self._visibility_pending=None;self.sync_browser();return
        current=self.document_state().get('generation')
        if current!=pending['generation']or self.browser_context!=pending['context']or self.document is None:
            self._visibility_pending=None;code='document_changed';ok=False
        elif type(value.get('visible'))is not bool:return
        else:
            self._overlay_visible=value['visible'];self._visibility_pending=None
            ok=value.get('ok')is True and value['visible']==pending['visible'];code='applied'if ok else'bridge_failed'
        self.sync_browser()
        if pending['api']and self.extension_control:self.extension_control.complete(pending['api'],ok,code,extra=self.extension_status())

    def regional_format_state(self):
        return {'formatLocale':getattr(self.preferences,'format_locale','auto'),
                'timeFormat':getattr(self.preferences,'time_format','auto')}

    def change_regional_format(self, key, value):
        if key not in ('formatLocale','timeFormat'):return False
        try:self.preferences.update({key:value})
        except (ValueError,TypeError):return False
        except OSError:
            self.set_status('Regionalformat konnte nicht gespeichert werden.','error',key='save_failed')
            self.sync_browser();return False
        self.preference_version+=1
        self.sync_browser()
        return True

    def change_ui_language(self, value):
        try: self.preferences.update({'uiLanguage':value})
        except (ValueError,TypeError): return False
        except OSError:
            self.set_status('Oberflächensprache konnte nicht gespeichert werden.','error',key='save_failed');self.sync_browser();return False
        self.preference_version += 1;self.sync_browser();return True

    def navigate_section(self, index, start=0):
        if not self.document or self.export_manager.snapshot()['state']=='running': return False
        chunks = self.document.get('navigationChunks',[])
        if type(index) is not int or not 0<=index<len(chunks): return False
        if type(start)is not int or start<0 or (start and not any(word.get('start')==start for word in chunks[index].get('words',[]))):return False
        document = self.document_from_word(self.document,index,start,'Aktuelle Stelle erkannt')
        paused = bool(self.reading and self.reading.paused)
        if self.reading is not None:self.restart(document,paused=paused)
        self._idle_position = None;self._navigation_chosen = True
        self.set_document(document)
        # Commit the explicit anchor before asynchronous capture/audio work. Stop,
        # Resume and saved-position reload must all retain this exact choice.
        from positions import geometry
        words=(document.get('chunks')or[{}])[0].get('words',[])
        word=next((word for word in words if not word.get('silent') and geometry(word)),None)
        self._navigation_preview = None;self._chapter_focus = -1
        if word:
            marker=geometry(word);parts=self.word_parts(word)
            if parts:marker['parts']=parts
            self._navigation_preview={'context':document.get('context'),'fingerprint':document.get('fingerprint'),'word':marker}
            try:self.positions.remember(document.get('context'),word,document['fingerprint'],flush=True)
            except OSError:self.set_status('Lesestelle konnte nicht dauerhaft gespeichert werden.','error',key='save_failed')
        if self.reading:
            self.reading.document=document
            self.reading.last_word=word
        self.sync_browser()
        if word:self.show_navigation_preview(reveal=True)
        else:self.bridge.send({'type':'clear'})
        return True

    def show_navigation_preview(self, reveal=False):
        preview=getattr(self,'_navigation_preview',None);document=self.document or {}
        if preview and preview['context']==document.get('context') and preview['fingerprint']==document.get('fingerprint'):
            self.bridge.send({'type':'word','word':preview['word'],'preview':True,'follow':bool(reveal)})

    def seek_section(self, value):
        return self.navigate_section(value) if type(value)is int else False

    def seek_chapter(self, value):
        anchors=getattr(self,'_chapter_anchors',[])
        if type(value)is not int or not 0<=value<len(anchors):return False
        if not self.navigate_section(*anchors[value]):return False
        self._chapter_focus=value;self.sync_browser();return True

    def navigation_state(self, metrics=None):
        metrics=metrics or self.timing_state();index=metrics['sectionIndex'];count=metrics['sectionCount']
        if self.reading:char=getattr(self.reading,'section_char',0)
        else:
            chunks=(self.document or {}).get('navigationChunks',[])
            begin,fraction=self.navigation_start(self.document or {})
            char=round(fraction*len(chunks[begin].get('text','')))if chunks and begin==index else 0
            if chunks and metrics.get('progressFraction',0)>=1:char=len(chunks[index].get('text',''))
        from bisect import bisect_right
        order=getattr(self,'_chapter_order',[]);at=bisect_right(order,(index,char,float('inf')))-1
        chapter=order[at][2]if at>=0 and count else -1
        focus=getattr(self,'_chapter_focus',-1);anchors=getattr(self,'_chapter_anchors',[])
        if chapter>=0 and 0<=focus<len(anchors) and anchors[focus]==anchors[chapter]:chapter=focus
        busy=self.export_manager.snapshot()['state']=='running';ready=bool(self.document and count)
        controls={'canToggle':ready and not busy,'canPreviousSection':ready and index>0 and not busy,
                  'canNextSection':ready and index+1<count and not busy,'canSeek':ready and not busy,
                  'canExport':ready and bool(self._premium.get('enabled')) and not busy,'canCancelExport':busy}
        return {'chapters':getattr(self,'_chapters',[]) if ready else [],'chapterIndex':chapter,'ready':ready,'documentReady':ready,
                'controls':controls,'currentSelection':{'sectionIndex':index,'sectionCount':count,'chapterIndex':chapter}}

    def previous_section(self):
        index=self.timing_state()['sectionIndex'];return self.navigate_section(index-1) if index>0 else False

    def next_section(self):
        data=self.timing_state();return self.navigate_section(data['sectionIndex']+1) if data['sectionIndex']+1<data['sectionCount'] else False

    def seek_progress(self, value):
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=1 or not self.document: return False
        if self.export_manager.snapshot()['state']=='running': return False
        chunks=self.document.get('navigationChunks',[])
        if not chunks:return False
        timer=getattr(self.reading,'full_timing',None) if self.reading else None
        timer=timer or self._timing
        if timer is None:return False
        durations=timer.durations();target=sum(durations)*value
        if value==1:
            self.stop(quiet=True);self._idle_position=sum(durations)
            self.document=self.document_from_word(self.document,0,0,'Aktuelle Stelle erkannt');self._navigation_chosen=True
            self.set_status('Fertig · Ende des Dokuments erreicht',key='completed');self.sync_browser();return True
        prefix=0.0
        for index,duration in enumerate(durations):
            if target < prefix+duration or index==len(durations)-1:break
            prefix+=duration
        fraction=max(0,min(1,(target-prefix)/duration)) if duration else 0
        words=chunks[index].get('words',[])
        start=words[min(len(words)-1,int(fraction*len(words)))]['start'] if words else 0
        return self.navigate_section(index,start)

    def refresh_premium(self):
        if self.closing.is_set():return
        if not self._premium_refreshing:
            self._premium_refreshing=True
            def refresh():
                from audiobook_export import premium_status
                value=premium_status(self._premium_provider)
                self._premium_refreshing=False
                self.events.put((None,'premium_status',{'premium':value}))
            threading.Thread(target=refresh,name='reader-premium-status',daemon=True).start()
        self.window.after(30000,self.refresh_premium)

    def activate_premium(self, code, request_id=None):
        if self._premium_activation.get('state')=='running':return False
        if type(code) is not str or not re.fullmatch(r'[A-Za-z0-9._-]{8,1800}',code):return False
        self._premium_activation={'state':'running','errorKey':''};self.sync_browser()
        def activate():
            from audiobook_export import premium_provider,premium_status
            key=''
            try:
                provider=premium_provider(self._premium_provider);provider.activate(code)
                value=premium_status(provider)
                if not value['enabled']:key='activation_failed'
            except (ConnectionError,TimeoutError):value=premium_status(self._premium_provider);key='premium_unavailable'
            except Exception:value=premium_status(self._premium_provider);key='activation_failed'
            self.events.put((None,'premium_activation',{'premium':value,'errorKey':key,'requestId':request_id}))
        threading.Thread(target=activate,name='reader-premium-activation',daemon=True).start();return True

    def start_export(self, format):
        if self.export_manager.snapshot()['state']=='running':return False
        if self.reading and not self.reading.paused:self.toggle()
        result=self.export_manager.start(self.document,self.resolve_voice()[1],format)
        self.sync_browser();return result

    def start_document_export(self, value):
        if self.export_manager.snapshot()['state']=='running':return False
        if isinstance(value,dict):
            if set(value)!={'format','view'}or value.get('format')not in('pdf','html')or value.get('view')not in('focus','source'):return False
            format=value['format'];appearance={**self.appearance_state(),'focus':value['view']=='focus'}
        elif type(value)is str and value in('pdf','html'):format=value;appearance=self.appearance_state()
        else:return False
        if self.reading and not self.reading.paused:self.toggle()
        result=self.export_manager.start_document(self.document,appearance,format,system_dark=getattr(self,'_appearance_system_dark',True))
        self.sync_browser();return result

    def sync_browser(self):
        self.publish_extension_status()
        from remaining import format_remaining
        metrics = self.timing_state()
        remaining = metrics['remainingSeconds'] if metrics['sectionCount'] or (self.reading and self.reading.remaining) else None
        page = self.page.get().split(" · Rest ca.", 1)[0]
        self.page.set(" · ".join(part for part in (page, format_remaining(remaining)) if part))
        self.bridge.send({"type": "state", "playing": self.reading is not None,
                          "paused": bool(self.reading and self.reading.paused),
                          "speed": self.rate, "volume": self.volume, "muted": self.muted,
                          "status": self.status.get(), "statusKind": self.status_kind,
                          "statusKey": getattr(self,'status_key','ready'), "statusParams": getattr(self,'status_params',{}),
                          "follow": self.follow, "ready": self.document is not None,
                          "clickSeek": self.click_seek, "preferenceVersion": self.preference_version,
                          **metrics, **self.navigation_state(metrics), "premium":self._premium, "premiumActivation":self._premium_activation,
                          "exportState":self.export_manager.snapshot(),
                          "barPosition": dict(self.preferences.bar), **self.voice_state()})

    def browser_event(self, value):
        kind = value.get("type")
        if kind == "attached":
            if value.get('requestId') != self.attach_request_id:
                return
            if value.get('context') is not None and value['context'] != self.browser_context:
                return
            self.inline = value.get('ok') is True and value.get('visible') is True
            self._overlay_visible=value.get('visible')if type(value.get('visible'))is bool else None
            pending = self.extension_request
            if (pending and value.get('requestId') == pending['requestId'] and
                value.get('context') == pending.get('context') and
                pending.get('context') == self.browser_context):
                pending['bridge_ready'] = self.inline
                if not pending['bridge_ready']:
                    self.finish_extension(False, 'bridge_failed')
                else:
                    self.extension_ready()
            if self.inline:
                self.window.withdraw()
                self.sync_browser()
                self.show_saved_position()
                self.show_navigation_preview()
            else:
                self.reader_error('bridge_failed')
        elif kind == 'surfaceLost':
            if value.get('context') != self.browser_context:return
            self.inline=False;self._overlay_visible=False
            pending=getattr(self,'_visibility_pending',None)
            if pending and pending['context']==self.browser_context:
                self.visibility_applied({'requestId':pending['id'],'context':pending['context'],
                    'sourceGeneration':pending['generation'],'visible':False,'ok':False})
            self.sync_browser()
        elif kind == 'visibilityApplied':
            self.visibility_applied(value)
        elif kind == 'detached':
            request_id = value.get('requestId')
            pending = self.extension_hides.get(request_id)
            if pending and value.get('context') == pending.get('context'):
                self.extension_hides.pop(request_id, None)
                self.extension_control.complete(request_id, bool(value.get('ok')),
                                                'applied' if value.get('ok') else 'bridge_failed')
        elif kind == "command":
            command = value.get("command")
            if value.get("context") is not None and value["context"] != self.browser_context:
                return
            if self.export_manager.snapshot()['state']=='running' and command in ('toggle','restart','selection','language','voice','seek'):
                return
            if (command == "toggle" and self.reading is None
                and isinstance(value.get("value"), dict)
                and value["value"].get("explicitSelection") is True):
                # The browser reports only that a fresh selection exists;
                # recapture it privately rather than resuming an older tail.
                self.restart(require_selection=(self.browser_context or {}).get("kind") == "html")
            elif command == 'hide':
                self.hide_context(value.get('context') or self.browser_context)
            elif command == "selection":
                self.restart(require_selection=True)
            elif command == 'restart':self.restart(visible=True)
            elif command in ("toggle", "stop"):
                getattr(self, command)()
            elif command == "speed":
                self.change_speed(value.get("value", 1))
            elif command == "volume":
                self.change_volume(value.get("value"))
            elif command == "mute":
                self.change_mute(value.get("value"))
            elif command == "follow":
                self.change_follow(value.get("value"))
            elif command == "clickseek":
                self.change_click_seek(value.get("value"))
            elif command == "language":
                self.change_language(value.get("value"))
            elif command == 'uiLanguage':self.change_ui_language(value.get('value'))
            elif command == 'appearance':self.change_appearance(value.get('value'))
            elif command == 'setOverlayVisible':self.set_overlay_visible(value.get('value'))
            elif command == 'toggleTheme':self.toggle_theme()
            elif command == 'openFocus':self.open_focus()
            elif command in ('formatLocale','timeFormat'):self.change_regional_format(command,value.get('value'))
            elif command == 'previousSection':self.previous_section()
            elif command == 'nextSection':self.next_section()
            elif command == 'seekProgress':self.seek_progress(value.get('value'))
            elif command == 'seekSection':self.seek_section(value.get('value'))
            elif command == 'seekChapter':self.seek_chapter(value.get('value'))
            elif command == 'exportDocument':self.start_document_export(value.get('value'))
            elif command == 'export':self.start_export(value.get('value'))
            elif command == 'cancelExport':self.export_manager.cancel()
            elif command == 'activatePremium':self.activate_premium(value.get('value'))
            elif command == "voice":
                self.change_voice(value.get("value"))
            elif command == "seek":
                if self.click_seek:
                    self.seek(value.get("value"), value.get("context"))
            elif command == "barPosition":
                self.set_bar_position(value.get("value"))
        elif kind == 'appearanceSystem':
            if type(value.get('dark'))is bool and (value.get('context')is None or value.get('context')==self.browser_context):self._appearance_system_dark=value['dark']
        elif kind == 'appearanceRequest':
            if value.get('context')is None or value.get('context')==self.browser_context:
                pages=value.get('pages',[])
                if isinstance(pages,list):self.request_appearance_figures(pages,value.get('dpi',144))
        elif kind == "navigationRequest":
            if value.get("context") is not None and value["context"] != self.browser_context:
                return
            pages = value.get("pages", [])
            if isinstance(pages, list):
                limit = 100 if (self.browser_context or {}).get("kind") == "html" else 6
                self.requested_pages = [p for p in pages if type(p) is int and p > 0][:limit]
                self.send_navigation()
        elif kind == "error":
            self.set_status(value.get("message", "Browserverbindung unterbrochen"), "error")

    def set_bar_position(self, value):
        """Strict gate before persistence; the bridge already debounces the command."""
        if not isinstance(value, dict):
            return
        x_raw, y_raw = value.get("x"), value.get("y")
        if isinstance(x_raw, bool) or isinstance(y_raw, bool):
            return
        try:
            x, y = float(x_raw), float(y_raw)
        except (TypeError, ValueError):
            return
        if not (math.isfinite(x) and math.isfinite(y) and 0 <= x <= 1 and 0 <= y <= 1):
            return
        try:
            self.preferences.set_bar_position({"x": round(x, 4), "y": round(y, 4)})
        except OSError:
            self.set_status("Leistenposition konnte nicht dauerhaft gespeichert werden.", "error")
            return
        self.preference_version += 1
        self.sync_browser()

    def send_navigation(self):
        if self.document is not None and self.requested_pages:
            self.request_appearance_figures(self.requested_pages)
            pages = {str(page): self.navigation_pages.get(page, []) for page in self.requested_pages}
            self.bridge.send({"type": "navigation", "pages": pages})

    def capture_document(self, context, selector=None, *, visible=False):
        """Read an explicit renderer without selecting a tab or synthesizing audio."""
        from extraction import extract_html, extract_pdf
        command = ["node", str(ROOT / "capture.mjs"), "--target", context["targetId"]]
        if selector is not None:
            command.append('--selector-stdin')
        result = subprocess.run(command, input=json.dumps(selector) if selector is not None else None,
                                capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise RuntimeError("Dokument konnte nicht vorbereitet werden.")
        state = json.loads(result.stdout)
        if state.get("context") != context:
            raise RuntimeError("Die Dokumentansicht wurde inzwischen gewechselt.")
        if visible:state['selection']=''
        document = extract_pdf(state) if state.get("kind") == "pdf" else extract_html(state)
        document["explicitSelection"] = bool(state.get("selection", "").strip())
        from memory_usage import release_unused_memory
        release_unused_memory()
        return document

    @staticmethod
    def word_parts(word):
        """A word split across a line break can carry up to 4 extra hitbox rects."""
        parts = word.get("parts")
        width, height = word.get("pageWidth"), word.get("pageHeight")
        if not isinstance(parts, list) or type(width) not in (int, float) or type(height) not in (int, float):
            return []
        valid = []
        for part in parts[:4]:
            if (isinstance(part, (list, tuple)) and len(part) == 4
                and all(type(v) in (int, float) and math.isfinite(v) for v in part)):
                x0, y0, x1, y1 = part
                if (x0 < x1 and y0 < y1
                    and 0 <= x0 and x1 <= width + 1 and 0 <= y0 and y1 <= height + 1):
                    valid.append([x0, y0, x1, y1])
        return valid

    @staticmethod
    def decorate_document(document):
        if "navigationPages" not in document:
            pages = {}
            for index, chunk in enumerate(document.get("navigationChunks", [])):
                for word in chunk.get("words", []):
                    if word.get("geometryValid") is False:
                        continue
                    if not isinstance(word.get("bbox"), (list, tuple)) or len(word["bbox"]) != 4:
                        continue
                    pages.setdefault(word["page"], []).append(
                        [index, word["start"], *[round(v, 3) for v in word["bbox"]],
                         word["pageWidth"], word["pageHeight"]])
                    for part in Reader.word_parts(word):
                        pages[word["page"]].append(
                            [index, word["start"], *[round(v, 3) for v in part],
                             word["pageWidth"], word["pageHeight"]])
            document["navigationPages"] = pages
        if "fingerprint" not in document:
            digest = hashlib.sha256()
            for chunk in document.get("navigationChunks", []):
                digest.update(json.dumps([chunk.get("page"),chunk.get("text"),
                    [(w.get("bbox"), w.get("pageWidth"), w.get("pageHeight"))
                     for w in chunk.get("words", [])]], separators=(",", ":")).encode())
            document["fingerprint"] = digest.hexdigest()
        return document

    def reader_error(self, code):
        from extension_api import MESSAGES
        code = code if code in MESSAGES else 'bridge_failed'
        self.last_error = {'code': code, 'message': MESSAGES[code]}
        self.set_status(MESSAGES[code], 'error')
        self.sync_browser()

    @staticmethod
    def surface_key(context):
        # Generation changes invalidate offsets, but a reload must not undo a
        # dismissal of this same document in this same tab.
        return (context.get('targetId'), context.get('kind'), context.get('url'))

    def allow_context(self, context, intent=None):
        if intent is None:
            self.visibility_serial += 1
            intent = self.visibility_serial
        self.target_visibility[context.get('targetId')] = intent
        if len(self.target_visibility) > 256:
            self.target_visibility.pop(next(iter(self.target_visibility)))
        self.dismissed_documents.pop(context.get('targetId'), None)
        self.last_error = None

    def send_attach(self, context, request_id=None):
        pending=getattr(self,'_visibility_pending',None)
        if pending:
            self._visibility_pending=None
            if pending['api']and self.extension_control:
                self.extension_control.complete(pending['api'],False,'document_changed',extra=self.extension_status())
        self._overlay_visible=None
        self.attach_request_id = request_id or os.urandom(16).hex()
        self.bridge.send({'type': 'attach', 'context': context,
                          'requestId': self.attach_request_id})

    def detach_context(self, context, request_id=None):
        if context == self.browser_context:
            pending=getattr(self,'_visibility_pending',None)
            if pending and pending['context']==context:
                self._visibility_pending=None
                if pending['api']and self.extension_control:
                    self.extension_control.complete(pending['api'],False,'document_changed',extra=self.extension_status())
            self._overlay_visible=None
            self.prepare_generation += 1
            self.stop(quiet=True)
            self.inline = False
            self.attach_request_id = None
            self.browser_context = None
            self.document = None
            if getattr(self,'view_manager',None):self.view_manager.bind(None)
            if hasattr(self.bridge,'cancel_appearance'):self.bridge.cancel_appearance()
            self.detected_language = None
            self.navigation_pages = {}
            self.requested_pages = []
        self.bridge.send({'type': 'detach', 'context': context, 'requestId': request_id})

    def hide_context(self, context, request_id=None, intent=None):
        if not isinstance(context, dict) or not context.get('targetId'):
            return False
        target = context['targetId']
        if intent is None:
            self.visibility_serial += 1
            intent = self.visibility_serial
        self.target_visibility[target] = intent
        self.dismissed_documents[target] = dict(context)
        # Bound in-memory metadata; no URLs or document text are persisted.
        if len(self.dismissed_documents) > 128:
            self.dismissed_documents.pop(next(iter(self.dismissed_documents)))
        if len(self.target_visibility) > 256:
            self.target_visibility.pop(next(iter(self.target_visibility)))
        pending = self.extension_request
        if pending and pending.get('context') == context:
            self.finish_extension(False, 'tab_changed')
        if context != self.browser_context:
            return False
        self.detach_context(context, request_id)
        self.set_status('Vorleseleiste für dieses Dokument geschlossen')
        self.publish_extension_status()
        return True

    def watch_context(self, value):
        context = value.get('context')
        if value.get('type') == 'gone':
            if (self.watched_context and value.get('targetId') == self.watched_context.get('targetId')):
                self.watched_context = None
            if self.browser_context and value.get('targetId') == self.browser_context.get('targetId'):
                previous = self.browser_context
                pending = self.extension_request
                if pending and pending.get('context') == previous:
                    self.finish_extension(False, 'tab_changed')
                self.detach_context(previous)
            return
        if not isinstance(context, dict) or context.get('kind') not in ('pdf', 'html'):
            return
        target = context.get('targetId')
        previous = self.browser_context
        if (previous and previous.get('targetId') == target and
            type(previous.get('documentGeneration')) in (int, float) and
            type(context.get('documentGeneration')) in (int, float) and
            context['documentGeneration'] < previous['documentGeneration']):
            return
        self.watched_context = context
        dismissed = self.dismissed_documents.get(target)
        if dismissed and self.surface_key(dismissed) != self.surface_key(context):
            # Navigation away permits a later automatic opening. Merely changing
            # tabs or reloading the same URL keeps the explicit dismissal.
            self.dismissed_documents.pop(target, None)
            dismissed = None
        # A reload/navigation invalidates the old offsets even with auto-show off.
        if (self.browser_context and target == self.browser_context.get('targetId')
            and context != self.browser_context):
            previous = self.browser_context
            if self.extension_request and self.extension_request.get('context') == previous:
                self.finish_extension(False, 'tab_changed')
            self.detach_context(previous)
        if (not self.preferences.auto_show or dismissed or self.extension_request or
            self.extension_hides or context == self.browser_context):
            return
        self.attach_context(context)

    def expire_extension_show(self):
        pending = self.extension_request
        self.extension_request = None
        # Only the attachment owned by this expired request is invalidated;
        # unrelated playback/bindings must remain untouched.
        if (pending and pending.get('owns_attachment') and
            pending.get('context') == self.browser_context and
            self.attach_request_id == pending['requestId']):
            self.detach_context(self.browser_context)
        self.reader_error('timeout')

    def hide_extension(self, request):
        api = self.extension_control
        request_id = request['requestId']
        if api is None or not api.is_pending(request_id):
            return
        self.visibility_serial += 1
        self.extension_hides[request_id] = {'context': None, 'intent': self.visibility_serial}
        def capture():
            value = {'requestId': request_id}
            try:
                # Do not wait behind a long document extraction; close is a
                # bounded target lookup, independent of prepared text or audio.
                result = subprocess.run(['node', str(ROOT / 'capture.mjs'), '--selector-stdin', '--context-only'],
                    input=json.dumps(request['tab']), capture_output=True, text=True, timeout=3.5)
                if result.returncode:
                    try:
                        code = json.loads(result.stderr.strip()).get('code')
                    except (ValueError, AttributeError):
                        code = 'browser_unavailable'
                    value['error'] = code if code in ('unsupported', 'ambiguous', 'tab_changed') else 'browser_unavailable'
                else:
                    value['context'] = json.loads(result.stdout).get('context')
            except subprocess.TimeoutExpired:
                value['error'] = 'timeout'
            except (OSError, ValueError):
                value['error'] = 'browser_unavailable'
            self.events.put((None, 'extension_hide_captured', value))
        threading.Thread(target=capture, name='extension-hide', daemon=True).start()

    def extension_hide_captured(self, value):
        request_id = value.get('requestId')
        api = self.extension_control
        pending = self.extension_hides.get(request_id)
        if not pending or api is None or not api.is_pending(request_id):
            self.extension_hides.pop(request_id, None)
            return
        context = value.get('context') or {}
        error = value.get('error')
        if error or context.get('kind') not in ('pdf', 'html'):
            self.extension_hides.pop(request_id, None)
            api.complete(request_id, False, error or 'unsupported')
            return
        # A show explicitly issued after this hide takes priority.
        show = self.extension_request
        newer_show = (show and show['intent'] > pending['intent'] and
                      show.get('context') == context)
        if (self.target_visibility.get(context.get('targetId'), 0) > pending['intent'] or newer_show):
            self.extension_hides.pop(request_id, None)
            api.complete(request_id, False, 'tab_changed')
            return
        pending['context'] = context
        if not self.hide_context(context, request_id, pending['intent']):
            # Another document is bound: acknowledge without touching it.
            self.extension_hides.pop(request_id, None)
            api.complete(request_id, True, 'applied')

    def attach_context(self, context, extension_request_id=None):
        pending = self.extension_request
        if pending and pending.get('context') != context:
            self.finish_extension(False, 'tab_changed')
        selector = pending.get('tab') if pending and extension_request_id == pending['requestId'] else None
        if context != self.browser_context or self.document is None:
            self.stop(quiet=True)
            self.prepare_generation += 1
            self.document = None
            if getattr(self,'view_manager',None):self.view_manager.bind(None)
            if hasattr(self.bridge,'cancel_appearance'):self.bridge.cancel_appearance()
            self.detected_language = None
            self.navigation_pages = {}
            self.requested_pages = []
            self.browser_context = context
            self.set_status("Dokumenttext wird vorbereitet …")
            generation = self.prepare_generation
            def prepare():
                try:
                    # A large PDF can take a while. Never extract several at
                    # once or spend memory on an obsolete queued tab switch.
                    with self.capture_lock:
                        if (self.closing.is_set() or generation != self.prepare_generation
                            or context != self.browser_context):
                            return
                        document = self.capture_document(context, selector) if selector is not None else self.capture_document(context)
                        if (self.closing.is_set() or generation != self.prepare_generation
                            or context != self.browser_context):
                            return
                        document = self.decorate_document(document)
                except Exception:
                    document = None
                self.events.put((None, "prepared", {"generation": generation,
                    "context": context, "document": document}))
            threading.Thread(target=prepare, name="pdf-prepare", daemon=True).start()
        self.send_attach(context, extension_request_id)

    def set_document(self, document, restore=False):
        previous_document=self.document or {}
        self.document = self.decorate_document(document)
        if getattr(self,'view_manager',None):self.view_manager.bind(self.document)
        if previous_document.get('fingerprint')!=document.get('fingerprint') or previous_document.get('context')!=document.get('context'):
            self._navigation_preview=None;self._chapter_focus=-1;self._navigation_chosen=False
        from chapters import document_chapters
        self._chapters,self._chapter_anchors=document_chapters(document)
        self._chapter_order=sorted((section,start,index)for index,(section,start)in enumerate(self._chapter_anchors))
        self._selected_start=self.navigation_start(self.document);self._selected_document=self.document
        self.detect_language(self.document)
        from remaining import RemainingTime
        voice = self.resolve_voice()[1]
        key = (document.get('fingerprint'), voice)
        previous = getattr(self,'_timing_key',None)
        if self.reading and self.reading.document is document and self.reading.full_timing is not None:
            self._timing = self.reading.full_timing
        elif previous != key or self._timing is None:
            self._timing = RemainingTime(document.get('navigationChunks',[]),self.voice_catalog.prior_seconds_per_word(voice))
        if previous is None or previous[0] != key[0]: self._idle_position = None
        self._timing_key = key
        self.warm_voice()
        self.navigation_pages = document.get("navigationPages", {})
        self.title.set(document.get("title") or "Dokument in Brave")
        self.set_status(document.get("startDescription") or "Aktuelle Stelle erkannt")
        self.send_navigation()
        if restore:
            self.show_saved_position()
        self.publish_extension_status()

    @staticmethod
    def document_from_word(document, index, start, description):
        chunks = document.get("navigationChunks", [])
        source = chunks[index]
        first = {**source, "text": source["text"][start:],
                 "words": [{**word, "start": word["start"] - start, "end": word["end"] - start}
                           for word in source.get("words",[]) if word["start"] >= start]}
        return {**document, "chunks": [first, *chunks[index + 1:]],
                "startDescription": description, "restored": False,
                "_sectionStartIndex": index, "_sectionStartChar": start}

    @staticmethod
    def locate_anchor(document, anchor):
        """Exact match keeps the old tight tolerance; a stale one takes the
        nearest word on the same page, since the text itself has shifted."""
        stale = bool(anchor.get("stale"))
        nearest = None
        for index, chunk in enumerate(document.get("navigationChunks", [])):
            for word in chunk.get("words", []):
                if word["page"] != anchor["page"]:
                    continue
                if not stale:
                    if max(abs(a - b) for a, b in zip(word["bbox"], anchor["bbox"])) < 0.15:
                        return index, word, False
                    continue
                wx = (word["bbox"][0] + word["bbox"][2]) / 2, (word["bbox"][1] + word["bbox"][3]) / 2
                ax = (anchor["bbox"][0] + anchor["bbox"][2]) / 2, (anchor["bbox"][1] + anchor["bbox"][3]) / 2
                distance = (wx[0] - ax[0]) ** 2 + (wx[1] - ax[1]) ** 2
                if nearest is None or distance < nearest[0]:
                    nearest = (distance, index, word)
        if stale and nearest is not None:
            return nearest[1], nearest[2], True
        return None

    def restore_document(self, document):
        document = self.decorate_document(document)
        if document.get("explicitSelection"):
            return document
        pages = {page: (words[0][6], words[0][7])
                 for page, words in document.get("navigationPages", {}).items() if words}
        anchor = self.positions.get(document.get("context"), document["fingerprint"], pages)
        if anchor:
            match = self.locate_anchor(document, anchor)
            if match is not None:
                index, word, stale = match
                location = "PDF-Seite" if document.get("context", {}).get("kind") == "pdf" else "Artikel-Absatz"
                description = (f"Gespeicherte Lesestelle · {location} {word['page']} · "
                                f"{'Text neu eingelesen · ' if stale else ''}Start setzt fort")
                result = self.document_from_word(document, index, word["start"], description)
                result["restored"] = True
                return result
        return document

    def show_saved_position(self):
        if self.document and self.document.get("restored") and not self.reading:
            first = self.document.get("chunks", [{}])[0].get("words", [])
            if first:
                label = "Seite" if self.document.get("context", {}).get("kind") == "pdf" else "Absatz"
                self.page.set(f"{label} {first[0]['page']}")
                self.bridge.send({"type": "word", "word": first[0], "follow": self.follow, "restore": True})

    def save_position(self, reading, flush=False):
        if reading and reading.document and reading.last_word:
            try:
                self.positions.remember(reading.document.get("context"), reading.last_word,
                                        reading.document["fingerprint"], flush=flush)
            except OSError:
                self.set_status("Lesestelle konnte nicht dauerhaft gespeichert werden.", "error")
        if flush:
            with contextlib.suppress(OSError):
                self.positions.flush()

    def seek(self, value, context):
        """Restart from a cached original word; no browser text search or recapture."""
        if not self.document or context != self.document.get("context") or not isinstance(value, dict):
            return
        index, start = value.get("chunkIndex"), value.get("charStart")
        chunks = self.document.get("navigationChunks", [])
        if type(index) is not int or type(start) is not int or not 0 <= index < len(chunks):
            return
        source = chunks[index]
        if not any(word["start"] == start for word in source.get("words", [])):
            return
        location = "PDF-Seite" if self.document.get("context", {}).get("kind") == "pdf" else "Artikel-Absatz"
        document = self.document_from_word(self.document, index, start,
                    f"Ab angeklickter Textstelle · {location} {source['page']}")
        self.restart(document)
        # An explicit click is an intentional new bookmark even while the
        # selected passage is still preparing. Prepared future audio never is.
        self.reading.document = document
        self.reading.last_word = document["chunks"][0]["words"][0]
        self.save_position(self.reading, flush=True)

    def commands(self):
        self.server.settimeout(0.4)
        while not self.closing.is_set():
            try:
                conn, _ = self.server.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            with conn:
                conn.settimeout(0.5)
                try:
                    command = conn.recv(4096).decode().strip()
                    if command.startswith("{"):
                        request = json.loads(command)
                        if request.get("type") == "attach" and request.get("context", {}).get("kind") in ("pdf", "html"):
                            self.events.put((None, "attach_context", request["context"]))
                            conn.sendall(b"ok\n")
                        elif request.get("type") == "model_status":
                            health = {
                                "extensionApi": bool(self.extension_control and self.extension_control.thread.is_alive()),
                                "bridge": self.bridge.process.poll() is None,
                                "watcher": bool(self.watcher and self.watcher.process.poll() is None),
                            }
                            conn.sendall((json.dumps({"ok": True, "model": self.synth.stats(),
                                                     "health": health}) + "\n").encode())
                        continue
                    if command == "background":
                        conn.sendall(b"ok\n")
                    elif command in {"show", "toggle", "restart", "stop"}:
                        self.events.put((None, "command", command))
                        conn.sendall(b"ok\n")
                except (OSError, UnicodeError, ValueError):
                    pass

    def publish_extension_status(self):
        """Only the main thread copies playback/preferences into public data."""
        metrics=self.timing_state();navigation=self.navigation_state(metrics)
        document_state=self.document_state()
        context=(self.document or {}).get('context')
        bound=bool(context and context==self.browser_context and context.get('kind')in('html','pdf') and document_state.get('generation'))
        source_context={'bound':True,'kind':context['kind'],'generation':document_state['generation'],'overlayVisible':getattr(self,'_overlay_visible',None),'overlayPending':bool(getattr(self,'_visibility_pending',None))}if bound else None
        if source_context and isinstance(context.get('url'),str)and isinstance((self.document or {}).get('title'),str):
            # ActiveTab can compare this opaque key without exposing source URLs.
            source_identity=[context['kind'],context['url'].split('#',1)[0],self.document['title']]
            source_context['sourceKey']=hashlib.sha256(json.dumps(source_identity,ensure_ascii=False,separators=(',',':')).encode('utf-8',errors='replace')).hexdigest()
        value = {
            **navigation,
            'lastError': dict(self.last_error) if self.last_error else None,
            'lastReadError':dict(self.last_read_error) if self.last_read_error else None,
            'settingsVersion': self.preference_version,
            'settings': {'speed': self.preferences.speed, 'follow': self.preferences.follow,
                         'clickSeek': self.preferences.click_seek, 'autoShow': self.preferences.auto_show,
                         'bar': dict(self.preferences.bar), 'language': self.preferences.language,
                         'uiLanguage': self.preferences.ui_language, **self.regional_format_state(), **self.player_theme_state(), 'appearance':self.appearance_state(),
                         'voices': dict(self.preferences.voices),
                         'volume': self.preferences.volume, 'muted': self.preferences.muted},
            'voice': self.voice_state(),
            'playback': {'playing': self.reading is not None,
                         'paused': bool(self.reading and self.reading.paused), **metrics, **navigation},
            **metrics, **self.regional_format_state(), **self.player_theme_state(), 'appearance':self.appearance_state(), 'documentState':document_state, 'sourceContext':source_context, 'uiLanguage':getattr(self.preferences,'ui_language','de'),
            'uiLanguages':['de','en','fr','es','it','pt'], 'catalog':self.catalog,
            'premium':self._premium, 'premiumActivation':self._premium_activation,
            'exportState':self.export_manager.snapshot(),
            'statusKey':getattr(self,'status_key','ready'),'statusKind':getattr(self,'status_kind','info'),'statusParams':getattr(self,'status_params',{}),
        }
        with self._extension_status_lock:
            self._extension_snapshot = value

    def extension_status(self):
        """Safe on HTTP threads: no Tk access, document data or URL exposure."""
        with self._extension_status_lock:
            snapshot = json.loads(json.dumps(self._extension_snapshot))
        synth = getattr(self, 'synth', None)
        model = synth.stats() if synth is not None else {}
        watcher = getattr(self, 'watcher', None)
        voice = snapshot.pop('voice', None) or {}
        snapshot['engine'] = {'ready': bool(model.get('ready')), 'voice': voice.get('voice'),
                              'voiceLabel': voice.get('voiceLabel'), 'language': voice.get('language', 'auto'),
                              'activeLanguage': voice.get('activeLanguage'),
                              'detectedLanguage': voice.get('detectedLanguage'),
                              'catalog': voice.get('catalog', []), 'catalogVersion': voice.get('catalogVersion', 0),
                              'loaded': list(model.get('loaded', [])),
                              'providers': list(model.get('providers', []))}
        snapshot['components'] = {
            'extensionApi': bool(self.extension_control and self.extension_control.thread.is_alive()),
            'bridge': self.bridge.process.poll() is None,
            'watcher': bool(watcher and watcher.process.poll() is None),
        }
        snapshot.update(product_metadata())
        return snapshot

    def extension_operation(self, kind, request):
        """Queued popup mutations expire before execution and commit once."""
        api = self.extension_control
        request_id = request['requestId']
        if api is None or not api.is_pending(request_id):
            return
        try:
            expected=request.get('sourceGeneration')
            if expected is not None and expected!=self.document_state().get('generation'):
                api.complete(request_id,False,'document_changed',extra=self.extension_status());return
            if expected is not None and (self.document is None or (self.document or {}).get('context')!=self.browser_context):
                api.complete(request_id,False,'document_changed',extra=self.extension_status());return
            if kind == 'extension_settings':
                if self.export_manager.snapshot()['state']=='running' and set(request['settings']) & {'voice','language'}:
                    api.complete(request_id,False,'busy',extra=self.extension_status());return
                # One atomic file replace precedes every visible/runtime change.
                previous_auto_show = self.preferences.auto_show
                settings = self.sanitize_voice_settings(request['settings'])
                voice_changed = 'language' in settings or 'voices' in settings
                self.preferences.update(settings)
                self.follow = self.preferences.follow
                self.click_seek = self.preferences.click_seek
                if 'speed' in settings:
                    self.change_speed(self.preferences.speed)
                if 'volume' in settings or 'muted' in settings:
                    self.volume, self.muted = self.preferences.volume, self.preferences.muted
                    self.apply_volume()
                if voice_changed:
                    self.apply_voice_change()
                elif 'speed' not in settings:
                    self.preference_version += 1
                    self.sync_browser()
                if self.preferences.auto_show and not previous_auto_show and self.watched_context:
                    self.watch_context({'type': 'context', 'context': self.watched_context})
            elif request['command'] == 'resetBar':
                from preferences import DEFAULT_BAR
                self.preferences.update({'bar': dict(DEFAULT_BAR)})
                self.preference_version += 1
                self.sync_browser()
            elif request['command'] == 'activatePremium':
                if not self.activate_premium(request.get('value'),request_id):
                    api.complete(request_id,False,'activation_failed',extra=self.extension_status())
                return
            elif request['command'] == 'setOverlayVisible':
                if not self.set_overlay_visible(request.get('value'),request_id,expected):api.complete(request_id,False,'busy'if getattr(self,'_visibility_pending',None)else'document_changed',extra=self.extension_status())
                return
            elif request['command'] == 'authorizeExport':
                try:
                    from audiobook_export import premium_provider
                    if premium_provider(self._premium_provider).require_export()is False:raise PermissionError()
                except Exception:
                    api.complete(request_id,False,'premium_locked',extra=self.extension_status());return
                api.complete(request_id,True,'applied',extra={**self.extension_status(),'authorized':True});return
            elif request['command'] == 'toggleTheme':self.toggle_theme()
            elif request['command'] == 'openFocus':self.open_focus(request.get('_extensionOrigin'))
            elif request['command'] == 'restart':self.restart(visible=True)
            elif request['command'] == 'toggle':
                if self.reading is None and self.document is not None:self.restart(self.document,resume=True)
                else:self.toggle()
            elif request['command'] in ('seekSection','seekChapter'):
                operation=self.seek_section if request['command']=='seekSection' else self.seek_chapter
                if not operation(request.get('value')):
                    api.complete(request_id,False,'invalid_request',extra=self.extension_status());return
            elif request['command'] == 'previousSection':self.previous_section()
            elif request['command'] == 'nextSection':self.next_section()
            elif request['command'] == 'seekProgress':self.seek_progress(request.get('value'))
            elif request['command'] == 'exportDocument':
                if not self.start_document_export(request.get('value')):
                    api.complete(request_id,False,'export_failed',extra=self.extension_status());return
            elif request['command'] == 'export':
                if not self.start_export(request.get('value')):
                    api.complete(request_id,False,'export_failed',extra=self.extension_status());return
            elif request['command'] == 'cancelExport':self.export_manager.cancel()
            else:
                self.stop()
        except OSError:
            self.set_status("Die Einstellungen konnten nicht dauerhaft gespeichert werden.", "error")
            self.sync_browser()
            api.complete(request_id, False, 'save_failed', extra=self.extension_status())
            return
        self.publish_extension_status()
        api.complete(request_id, True, 'applied', extra=self.extension_status())

    def finish_extension(self, ok, code='ready'):
        pending = self.extension_request
        if pending and self.extension_control:
            if ok:
                from extension_api import EXTENSION_ORIGINS
                origin=pending.get('_extensionOrigin')
                if origin in EXTENSION_ORIGINS:self._focus_extension_origin=origin
            self.extension_control.complete(pending['requestId'], ok, code)
        self.extension_request = None

    def extension_ready(self):
        pending = self.extension_request
        if (pending and pending.get('bridge_ready') and self.document is not None and
            pending.get('context') == self.browser_context == self.document.get('context')):
            self.finish_extension(True)

    def extension_captured(self, value):
        pending = self.extension_request
        if (not pending or value.get('requestId') != pending['requestId'] or
            not self.extension_control.is_pending(pending['requestId'])):
            return
        if value.get('error'):
            self.finish_extension(False, value['error'])
            return
        context = value.get('context') or {}
        if context.get('kind') not in ('html', 'pdf'):
            self.finish_extension(False, 'unsupported')
            return
        if self.target_visibility.get(context.get('targetId'), 0) > pending['intent']:
            self.finish_extension(False, 'tab_changed')
            return
        pending['context'] = context
        pending['owns_attachment'] = (context != self.browser_context or
                                      (not self.inline and self.reading is None))
        self.allow_context(context, pending['intent'])
        self.attach_context(context, extension_request_id=pending['requestId'])

    def show_extension(self, request):
        """A toolbar request selects a tab explicitly and never starts playback."""
        if not self.extension_control or not self.extension_control.is_pending(request['requestId']):
            return
        if self.extension_request:
            self.extension_control.complete(request['requestId'], False, 'busy')
            return
        self.visibility_serial += 1
        self.extension_request = {**request, 'context': None, 'bridge_ready': False,
                                  'intent': self.visibility_serial}
        def capture():
            value = {'requestId': request['requestId']}
            try:
                with self.capture_lock:
                    if not self.extension_control.is_pending(request['requestId']):
                        return
                    result = subprocess.run(['node', str(ROOT / 'capture.mjs'), '--selector-stdin', '--context-only'],
                        input=json.dumps(request['tab']), capture_output=True, text=True, timeout=90)
                if result.returncode:
                    try:
                        code = json.loads(result.stderr.strip()).get('code')
                    except (ValueError, AttributeError):
                        code = 'browser_unavailable'
                    value['error'] = code if code in ('unsupported', 'ambiguous', 'tab_changed') else 'browser_unavailable'
                else:
                    value['context'] = json.loads(result.stdout).get('context')
            except (OSError, ValueError, subprocess.TimeoutExpired):
                value['error'] = 'browser_unavailable'
            self.events.put((None, 'extension_captured', value))
        threading.Thread(target=capture, name='extension-capture', daemon=True).start()

    def show(self):
        self.visibility_serial += 1
        intent = self.visibility_serial
        def attach():
            try:
                result = subprocess.run(["node", str(ROOT / "capture.mjs")],
                    capture_output=True, text=True, timeout=90)
                state = json.loads(result.stdout)
                context = state.get("context", {})
                if context.get("kind") in ("pdf", "html"):
                    self.events.put((None, "show_captured", {"context": context, "intent": intent}))
                else:
                    self.events.put((None, "show_error", "unsupported"))
            except (OSError, ValueError, subprocess.TimeoutExpired):
                self.events.put((None, "show_error", "browser_unavailable"))
        threading.Thread(target=attach, daemon=True).start()

    def restart(self, document=None, resume=False, require_selection=False, paused=False, visible=False):
        if getattr(self,'export_manager',None) and self.export_manager.snapshot()['state']=='running':return
        self.stop(quiet=True)
        self.prepare_generation += 1
        self.serial += 1
        reading = Reading(self.serial)
        reading.resume = resume
        reading.require_selection = require_selection
        reading.visible_start = bool(visible)
        reading.paused = bool(paused)
        if isinstance(document,dict):
            reading.start_section,reading.start_fraction=self.navigation_start(document)
            reading.section_index=reading.start_section
            chunks=document.get("navigationChunks",[])
            reading.start_char=round(reading.start_fraction*len(chunks[reading.start_section].get("text",""))) if chunks else 0
            reading.section_char=reading.start_char
        self.reading = reading
        self.pause_label.set("Pause")
        self.set_status("Aktuelle Stelle in Brave wird gelesen …")
        self.sync_browser()
        threading.Thread(target=self.read, args=(reading, document), daemon=True).start()

    def toggle(self):
        if self.export_manager.snapshot()['state']=='running':return
        reading = self.reading
        if reading is None or reading.cancelled.is_set():
            # A terminal event may still be queued when the next click arrives.
            # Never toggle a cancelled worker: restart creates a new generation.
            self.restart(self.document if self._navigation_chosen else None,resume=True)
            return
        with reading.lock:
            reading.paused = not reading.paused
            paused = reading.paused
            reading.mpv(["set_property", "pause", paused])
        self.pause_label.set("Weiter" if paused else "Pause")
        self.set_status("Pausiert" if paused else "Vorlesen wird fortgesetzt …")
        self.sync_browser()

    def stop(self, quiet=False):
        self._idle_position = self._media_position()
        reading, self.reading = self.reading, None
        if reading:
            reading.cancel()
            if self._navigation_chosen and reading.document and reading.last_word:
                located=self.find_word(reading.document,reading.last_word)
                if located:
                    self.document=self.document_from_word(reading.document,*located,'Aktuelle Stelle erkannt')
                    self._selected_start=self.navigation_start(self.document);self._selected_document=self.document
        self.save_position(reading, flush=True)
        self.bridge.send({"type": "clear"})
        self.show_navigation_preview()
        self.pause_label.set("Pause")
        if not quiet:
            self.set_status("Gestoppt · Start setzt an der letzten Lesestelle fort")
        self.sync_browser()

    LANGUAGE_NAMES = {"de": "Deutsch", "en": "Englisch", "fr": "Französisch", "es": "Spanisch",
                      "it": "Italienisch", "pt": "Portugiesisch"}

    def resolve_voice(self):
        """-> (active language, voice id) from the setting, detection and saved voices."""
        codes = self.voice_catalog.language_codes(self.catalog)
        setting = self.preferences.language
        if setting != "auto" and setting in codes:
            language = setting
        elif setting == "auto" and self.detected_language in codes:
            language = self.detected_language
        else:
            language = self.voice_catalog.FALLBACK_LANGUAGE if self.voice_catalog.FALLBACK_LANGUAGE in codes else (codes[0] if codes else None)
        voice = self.voice_catalog.voice_for(self.catalog, language, self.preferences.voices) if language else None
        return language, voice

    def voice_label(self, voice_id=None):
        record = self.voice_catalog.voice_record(voice_id or self.resolve_voice()[1])
        return record["label"] if record else ""

    def voice_status(self):
        language, voice = self.resolve_voice()
        return f"{self.voice_label(voice)} · {self.LANGUAGE_NAMES.get(language, language)} · offline"

    def detect_language(self, document):
        """Language of the whole document (hint, then text); cached per document fingerprint."""
        from langdetect import detect_document
        key = document.get("fingerprint") if isinstance(document, dict) else None
        if key in self.detection_cache:
            result = self.detection_cache[key]
        else:
            result = detect_document(document)
            if key is not None:
                self.detection_cache = {key: result}
        self.detected_language = result.get("language")
        return result

    def warm_voice(self):
        voice = self.resolve_voice()[1]
        if voice and getattr(self, "synth", None) is not None:
            with contextlib.suppress(Exception):
                self.synth.warm(voice)

    @staticmethod
    def find_word(document, word):
        """Locate a played word in the navigation chunks: (chunk index, char start) or None."""
        for index, chunk in enumerate(document.get("navigationChunks", [])):
            if chunk.get("page") != word.get("page"):
                continue
            for candidate in chunk.get("words", []):
                if candidate.get("text") == word.get("text") and candidate.get("bbox") == word.get("bbox") \
                        and candidate.get("start") is not None:
                    return index, candidate["start"]
        return None

    def apply_voice_change(self):
        """New language/voice: continue from the current word with the new voice, pause state kept."""
        language, voice = self.resolve_voice()
        previous = (self.reading.language, self.reading.voice) if self.reading else None
        if self.document and previous != (language,voice):
            from remaining import RemainingTime
            self._timing=RemainingTime(self.document.get('navigationChunks',[]),self.voice_catalog.prior_seconds_per_word(voice))
            self._timing_key=(self.document.get('fingerprint'),voice)
        self.preference_version += 1
        self.warm_voice()
        reading = self.reading
        if reading is None or previous == (language, voice):
            if reading is None:
                self.set_status("Bereit · " + self.voice_status())
            self.sync_browser()
            return
        document = reading.document
        paused, word = reading.paused, reading.last_word
        resumed = None
        if document is not None:
            located = self.find_word(document, word) if word else None
            if located is not None:
                resumed = self.document_from_word(document, located[0], located[1],
                                                  "Weiter mit Stimme " + self.voice_label(voice))
            else:
                resumed = document
        self.restart(resumed,paused=paused)
        if self.reading is not None:
            self.reading.paused = paused
            if document is not None:
                self.reading.document = resumed
            if word:
                self.reading.last_word = word
            self.pause_label.set("Weiter" if paused else "Pause")

    def change_language(self, value):
        if self.export_manager.snapshot()['state']=='running':return False
        if not isinstance(value, str) or not self.voice_catalog.valid_language_setting(value, self.catalog):
            return False
        try:
            self.preferences.set_language(value)
        except OSError:
            self.set_status("Sprache konnte nicht dauerhaft gespeichert werden.", "error")
            self.sync_browser()
            return False
        self.apply_voice_change()
        return True

    def change_voice(self, value):
        if self.export_manager.snapshot()['state']=='running':return False
        if not isinstance(value, dict):
            return False
        language, voice = value.get("language"), value.get("id")
        if not self.voice_catalog.valid_voice(language, voice, self.catalog):
            return False
        active = self.resolve_voice()[0]
        try:
            self.preferences.set_voice(language, voice)
            # Choosing a voice of another language is an explicit choice of that language.
            if language != active:
                self.preferences.set_language(language)
        except OSError:
            self.set_status("Stimme konnte nicht dauerhaft gespeichert werden.", "error")
            self.sync_browser()
            return False
        self.apply_voice_change()
        return True

    def sanitize_voice_settings(self, settings):
        """Popup settings -> preference keys the installed catalog can run.

        ``voice`` ({language, id}) becomes an entry of ``voices``; choosing a voice of
        another language also selects that language, like the bar does.  Invalid members
        are dropped, the rest still applies.
        """
        clean = dict(settings)
        voice = clean.pop("voice", None)
        if "language" in clean and not self.voice_catalog.valid_language_setting(clean["language"], self.catalog):
            del clean["language"]
        known = {}
        if isinstance(clean.get("voices"), dict):
            known = {code: ident for code, ident in clean["voices"].items()
                     if self.voice_catalog.valid_voice(code, ident, self.catalog)}
        if isinstance(voice, dict) and self.voice_catalog.valid_voice(voice.get("language"), voice.get("id"), self.catalog):
            known[voice["language"]] = voice["id"]
            if "language" not in clean and voice["language"] != self.resolve_voice()[0]:
                clean["language"] = voice["language"]
        if known or "voices" in clean:
            clean["voices"] = {**self.preferences.voices, **known}
        return clean

    def scale_speed(self, _value):
        # Retain the old callable for private clients without a visible scale.
        self.change_speed(self.speed_scale.get())

    def change_speed(self, value):
        from preferences import speed_value
        try:
            rate = speed_value(value)
        except (TypeError, ValueError, OverflowError):
            return False
        try:
            self.preferences.set_speed(rate)
        except OSError:
            self.set_status("Tempo konnte nicht gespeichert werden.", "error")
            if self.speed_scale.get() != self.rate:
                self.speed_scale.set(self.rate)
            self.sync_browser()
            return False
        self.preference_version += 1
        self.rate = rate
        if self.speed_scale.get() != self.rate:
            self.speed_scale.set(self.rate)
        self.speed_label.set(f"Tempo {self.rate:.2f}×".replace(".", ","))
        if self.reading:
            self.reading.mpv(["set_property", "speed", self.rate / BASE_SPEED])
        self.sync_browser()
        return True

    def apply_volume(self):
        """mpv's own software `volume` property only; never ao-volume/pactl/PipeWire (WirePlumber remembers those)."""
        if self.reading:
            self.reading.mpv(["set_property", "volume", 0 if self.muted else self.volume])

    def change_volume(self, value):
        from preferences import volume_value
        try:
            volume = volume_value(value)
        except (TypeError, ValueError, OverflowError):
            return False
        self.volume = volume
        if volume > 0 and self.muted:
            self.muted = False   # moving the slider up leaves mute
        self.apply_volume()
        self._persist_volume()
        return True

    def change_mute(self, value):
        if type(value) is not bool:
            return False
        self.muted = value
        self.apply_volume()
        self._persist_volume()
        return True

    def _persist_volume(self):
        try:
            self.preferences.update({'volume': self.volume, 'muted': self.muted})
        except OSError:
            self.set_status("Lautstärke konnte nicht gespeichert werden.", "error")
        self.preference_version += 1
        self.sync_browser()

    def change_follow(self, value):
        if type(value) is not bool:
            return False
        try:
            self.preferences.set_follow(value)
        except OSError:
            self.set_status("Folgen konnte nicht dauerhaft gespeichert werden.", "error")
            self.sync_browser()
            return False
        self.preference_version += 1
        self.follow = self.preferences.follow
        self.sync_browser()
        return True

    def change_click_seek(self, value):
        if type(value) is not bool:
            return False
        try:
            self.preferences.set_click_seek(value)
        except OSError:
            self.set_status("Klicksprung konnte nicht dauerhaft gespeichert werden.", "error")
            self.sync_browser()
            return False
        self.preference_version += 1
        self.click_seek = self.preferences.click_seek
        self.sync_browser()
        return True

    def read(self, reading, document=None):
        stage='capture';terminal=False
        try:
            from extraction import capture_and_extract
            try:
                if document is None:
                    context = dict(self.browser_context) if self.browser_context else None
                    with self.capture_lock:
                        if reading.cancelled.is_set():
                            return
                        if context and context.get("kind") in ("pdf", "html"):
                            document = self.capture_document(context,visible=True) if reading.visible_start else self.capture_document(context)
                        else:
                            document = capture_and_extract(visible=True) if reading.visible_start else capture_and_extract()
                    if reading.resume:
                        if document.get("context", {}).get("kind") in ("pdf", "html"):
                            document = self.restore_document(document)
            except ValueError as error:
                reading.failure=read_failure(error,stage)
                raise ReadFailure("Die aktuelle Textstelle konnte nicht gelesen werden. Bitte die Seite prüfen und erneut starten.") from None
            if reading.cancelled.is_set():
                return
            stage='document'
            if not isinstance(document, dict):
                raise ReadFailure("Dokument konnte nicht erkannt werden.")
            if reading.require_selection and document.get("startDescription") != "Ab markierter Textstelle":
                raise ReadFailure("Bitte zuerst Text im Artikel markieren und erneut „↳ Auswahl“ wählen.")
            document = self.decorate_document(document)
            reading.document = document
            stage='voice'
            self.detect_language(document)
            reading.language, reading.voice = self.resolve_voice()
            reading.status_text = (f"Liest vor · {self.voice_label(reading.voice)} · "
                                   f"{self.LANGUAGE_NAMES.get(reading.language, reading.language)} · offline")
            stage='timing'
            from remaining import RemainingTime
            reading.remaining = RemainingTime(document.get("chunks", []),
                                              self.voice_catalog.prior_seconds_per_word(reading.voice))
            key=(document.get('fingerprint'),reading.voice)
            # New synthesis can differ (notably Piper). Reuse the calibrated
            # prior, never claim old renders are exact durations of a new run.
            prior=(self._timing.calibrated_rate() if self._timing_key==key and self._timing is not None
                   else self.voice_catalog.prior_seconds_per_word(reading.voice))
            reading.full_timing=RemainingTime(document.get('navigationChunks',[]),prior)
            reading.start_section,reading.start_fraction=self.navigation_start(document)
            reading.section_index=reading.start_section
            chunks=document.get("navigationChunks",[])
            reading.start_char=round(reading.start_fraction*len(chunks[reading.start_section].get("text",""))) if chunks else 0
            reading.section_char=reading.start_char
            self.emit(reading, "captured", document)
            pieces = iter(sentences(document.get("chunks", [])))
            first = next(pieces, None)
            if first is None:
                raise ReadFailure("An dieser Stelle wurde kein vorlesbarer Text gefunden.")
            with tempfile.TemporaryDirectory(prefix="reading-", dir=self.runtime) as folder:
                work = Path(folder)
                reading.ipc = work / "mpv.sock"
                from itertools import chain
                from prefetch import Prefetch
                self.emit(reading, "preview", first)
                self.emit(reading, "status", "Stimme wird vorbereitet …")
                stage='synthesis'
                with Prefetch(self.synth, chain([first], pieces), work, reading.cancelled,
                              voice=reading.voice) as ahead:
                    prepared = ahead.get()
                    if prepared is None or reading.cancelled.is_set():
                        return
                    # A short heading must not finish before the following
                    # paragraph exists. Start with a small runway (up to three
                    # sections), then keep filling it independently of playback.
                    initial = [prepared]
                    seconds = prepared.duration
                    while seconds < self.rate * 1.5 and len(initial) < 3:
                        following = ahead.get()
                        if following is None:
                            break
                        initial.append(following)
                        seconds += following.duration
                    if reading.cancelled.is_set():
                        return
                    initial = iter(initial)
                    prepared = next(initial)
                    timeline = PlaybackTimeline()
                    # One raw PCM stream keeps the audio device open across sections.
                    # mpv buffers at most ~22 seconds; the producer separately holds
                    # six future sections rather than synthesizing the whole document.
                    stage='player_start'
                    player = reading.launch("player", ["mpv", "--no-video", "--no-terminal",
                        "--really-quiet", "--audio-display=no", "--input-default-bindings=no",
                        "--input-ipc-server=" + str(reading.ipc), "--audio-pitch-correction=yes",
                        "--speed=" + str(self.rate / BASE_SPEED),
                        "--volume-max=150", "--volume=" + str(0 if self.muted else self.volume),
                        "--keep-open=yes",
                        "--pause=" + ("yes" if reading.paused else "no"),
                        "--demuxer=rawaudio", "--demuxer-rawaudio-rate=24000",
                        "--demuxer-rawaudio-channels=mono", "--demuxer-rawaudio-format=s16le",
                        "--cache=yes", "--demuxer-max-bytes=1MiB", "--demuxer-readahead-secs=20",
                        "--cache-pause-wait=0.5", "-"],
                        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL, bufsize=0)
                    if player is None:
                        return
                    watcher = threading.Thread(target=watch_playback,
                        args=(reading, player, timeline,
                              lambda kind, value: self.emit(reading, kind, value),
                              lambda: (reading.restore_pause(),
                                       reading.mpv(["set_property", "speed", self.rate / BASE_SPEED]),
                                       self.apply_volume())),
                        daemon=True)
                    watcher.start()
                    stage='stream'
                    try:
                        while prepared is not None and not reading.cancelled.is_set():
                            with wave.open(str(prepared.audio), "rb") as audio:
                                if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (24000, 1, 2):
                                    raise ReadFailure("Die lokale Stimme hat ein ungültiges Audioformat erzeugt.")
                                reading.remaining.observe(prepared.index, prepared.chunk,
                                                          audio.getnframes() / 24000)
                                full_index=reading.start_section+prepared.index
                                original=document.get('navigationChunks',[])
                                if full_index<len(original) and prepared.chunk.get('text')==original[full_index].get('text'):
                                    reading.full_timing.observe(full_index,original[full_index],audio.getnframes()/24000)
                                timeline.append(prepared, audio.getnframes())
                                while not reading.cancelled.is_set():
                                    block = audio.readframes(4096)
                                    if not block:
                                        break
                                    pending = memoryview(block)
                                    while pending and not reading.cancelled.is_set():
                                        written = player.stdin.write(pending)
                                        if not written:
                                            raise BrokenPipeError()
                                        pending = pending[written:]
                            prepared.audio.unlink(missing_ok=True)
                            prepared = next(initial, None)
                            if prepared is None:
                                prepared = ahead.get()
                    finally:
                        with contextlib.suppress(OSError):
                            player.stdin.close()
                    stage='playback_wait'
                    while player.poll() is None and not reading.cancelled.wait(0.04):
                        pass
                    if reading.cancelled.is_set():
                        return
                    if player.returncode != 0:
                        raise ReadFailure("Audioausgabe fehlgeschlagen. Bitte Audioausgang prüfen.")
                    watcher.join(timeout=0.25)
                terminal=True
                self.emit(reading, "done", "Fertig · Ende des Dokuments erreicht")
        except Exception as error:
            if not reading.cancelled.is_set():
                reading.failure=reading.failure or read_failure(error,stage)
                message = str(error) if type(error) is ReadFailure else "Vorlesen fehlgeschlagen. Bitte erneut starten; die lokale Stimme wird wieder vorbereitet."
                terminal=True;self.emit(reading, "error", message)
        finally:
            if not terminal and not reading.cancelled.is_set():
                reading.failure={'stage':stage,'exception':'UnexpectedEnd','source':'player.py','line':0}
                self.emit(reading,'error','Vorlesen konnte nicht gestartet werden. Bitte erneut starten.')
            reading.cancel()
            reading.finished.set()

    def close(self):
        self.closing.set()
        self.stop(quiet=True)
        self.export_manager.close()
        if getattr(self,'view_manager',None):self.view_manager.close()
        self.synth.close()
        if self.watcher:
            self.watcher.close()
        if self.extension_control:
            self.extension_control.close()
        self.bridge.close()
        self.server.close()
        self.window.destroy()


def main():
    os.umask(0o077)
    if len(sys.argv) > 1 and sys.argv[1] == "--synth-worker":
        synth_worker()
        return
    command = sys.argv[1] if len(sys.argv) > 1 else "show"
    if command not in {"show", "toggle", "restart", "stop", "background"}:
        raise SystemExit("Aufruf: player.py [show|toggle|restart|stop|background]")
    runtime = runtime_dir()
    control = runtime / "control.sock"
    if send_command(control, command):
        return
    lock = open(runtime / "instance.lock", "a+")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        for _ in range(30):
            if send_command(control, command):
                return
            time.sleep(0.1)
        raise SystemExit("Vorlesefenster antwortet nicht.")
    if command == "stop":
        return
    control.unlink(missing_ok=True)
    server = socket.socket(socket.AF_UNIX)
    server.bind(str(control))
    control.chmod(0o600)
    server.listen(8)
    atexit.register(lambda: control.unlink(missing_ok=True))
    app = Reader(runtime, server)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: app.close())
    if command == "toggle":
        app.window.after(150, app.toggle)
    elif command == "restart":
        app.window.after(150, app.restart)
    elif command == "show":
        app.window.after(100, app.show)
    try:
        app.window.mainloop()
    finally:
        app.close() if not app.closing.is_set() else None
        lock.close()


if __name__ == "__main__":
    main()
