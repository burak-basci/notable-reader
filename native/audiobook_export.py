"""Private native audiobook export: bounded, serial synthesis; no text/path logs."""
from __future__ import annotations

import contextlib
import importlib
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time
import unicodedata
import uuid
import wave


def premium_provider(provider=None):
    return provider if provider is not None else importlib.import_module('premium_client')


def premium_status(provider=None):
    """Fail closed. Return only the explicit browser contract, never exceptions."""
    fallback = {'enabled': False, 'status': 'unavailable', 'tier': 'free',
                'priceLabel': '2,99 € / Monat', 'checkoutUrl': '', 'lifetimeUrl': '', 'portalUrl': ''}
    try:
        value = premium_provider(provider).get_status()
        if not isinstance(value, dict): return fallback
        from urllib.parse import urlsplit
        result = {**fallback, 'enabled': value.get('enabled') is True}
        for key in ('status', 'tier', 'priceLabel'):
            if isinstance(value.get(key), str): result[key] = value[key][:100]
        for key in ('checkoutUrl', 'lifetimeUrl', 'portalUrl'):
            url = value.get(key)
            if isinstance(url, str) and len(url) <= 4096 and urlsplit(url).scheme == 'https' and not urlsplit(url).username:
                result[key] = url
        return result
    except Exception:
        return fallback


def safe_filename(title, format):
    title = unicodedata.normalize('NFKC', str(title or 'Hörbuch'))
    title = title.replace('\\','/').rsplit('/',1)[-1]
    title = re.sub(r'[\x00-\x1f\x7f<>:"/\\|?*]', '', title).strip(' .')[:90].strip(' .') or 'Hörbuch'
    while len(title.encode('utf-8')) > 180:title = title[:-1]
    return f'{title}-{time.strftime("%Y%m%d")}-{uuid.uuid4().hex[:10]}.{format}'


class _Cancelled(Exception): pass


class NativeExportManager:
    def __init__(self, synth, output_dir=None, runtime=None, premium_provider=None, notify=None):
        self.synth = synth
        self.output_dir = Path(output_dir) if output_dir is not None else Path.home() / 'Downloads' / 'NotableReader'
        self.runtime = Path(runtime) if runtime is not None else None
        self.provider = premium_provider
        self.notify = notify or (lambda _state: None)
        self._lock = threading.RLock()
        self._cancelled = threading.Event()
        self._thread = None
        self._encoder = None
        self._committing = False
        self._state = {'state': 'idle', 'percent': 0, 'completedChunks': 0,
                       'totalChunks': 0, 'filename': '', 'error': '', 'errorKey': ''}

    def snapshot(self):
        with self._lock: return dict(self._state)

    def _publish(self, **values):
        with self._lock:
            self._state.update(values)
            state = dict(self._state)
        with contextlib.suppress(Exception): self.notify(state)

    def start(self, document, voice, format='mp3'):
        with self._lock:
            if self._thread and self._thread.is_alive(): return False
            return self._start_locked(document,voice,format)

    def _start_locked(self, document, voice, format):
        if format not in ('mp3', 'wav'): return False
        chunks = document.get('navigationChunks') if isinstance(document, dict) else None
        if (not isinstance(chunks, list) or not chunks or not isinstance(voice, str) or not voice
            or any(not isinstance(chunk,dict) or not isinstance(chunk.get('text'),str) for chunk in chunks)):
            self._publish(state='error',percent=0,completedChunks=0,totalChunks=0,filename='', error='Bitte zuerst das vollständige Dokument vorbereiten.', errorKey='prepare_failed')
            return False
        # Copy containers, not a concatenated full-book text or PCM. The source
        # strings/geometry remain immutable; the current reading tail is ignored.
        chunks = tuple(dict(chunk) for chunk in chunks if isinstance(chunk, dict) and str(chunk.get('text', '')).strip())
        if not chunks:
            self._publish(state='error',percent=0,completedChunks=0,totalChunks=0,filename='',error='Im Dokument wurde kein vorlesbarer Text gefunden.',errorKey='prepare_failed')
            return False
        with self._lock:
            if self._thread and self._thread.is_alive(): return False
            self._cancelled = threading.Event()
            self._committing = False
            self._state = {'state': 'running', 'percent': 0, 'completedChunks': 0,
                           'totalChunks': len(chunks), 'filename': '', 'error': '', 'errorKey': ''}
            self._thread = threading.Thread(target=self._run, args=(chunks, str(document.get('title') or 'Hörbuch'), voice, format),
                                            name='reader-audiobook-export', daemon=True)
            self._thread.start()
        return True

    def cancel(self):
        with self._lock:
            if self._state['state'] != 'running' or self._committing: return False
            self._cancelled.set(); encoder = self._encoder
        if encoder is not None:
            with contextlib.suppress(OSError): encoder.terminate()
        return True

    def wait(self, timeout=None):
        thread = self._thread
        if thread: thread.join(timeout)
        return self.snapshot()

    def close(self, timeout=3):
        self.cancel(); self.wait(timeout)

    def _check(self):
        if self._cancelled.is_set(): raise _Cancelled()

    def _run(self, chunks, title, voice, format):
        temporary = None; writer = None; encoder = None
        try:
            try:
                provider = premium_provider(self.provider)
                if provider.require_export() is False or premium_status(provider)['enabled'] is not True:
                    raise PermissionError()
            except Exception:
                self._publish(state='locked', error='Für den vollständigen Audioexport ist Premium erforderlich.', errorKey='premium_locked')
                return
            self._check()
            self.output_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
            handle, name = tempfile.mkstemp(prefix='.notable-export-', suffix='.'+format, dir=self.output_dir)
            os.close(handle); temporary = Path(name); temporary.chmod(0o600)
            filename = safe_filename(title, format)
            audio_format = None
            with tempfile.TemporaryDirectory(prefix='native-export-', dir=self.runtime) as folder:
                work = Path(folder); work.chmod(0o700)
                for index, chunk in enumerate(chunks):
                    self._check()
                    import citations
                    view = citations.spoken_view(chunk) if citations.has_speech(chunk) else None
                    text = view[0] if view else str(chunk.get('text', ''))
                    audio = work / 'section.wav'
                    response = self.synth.render(text, audio, self._cancelled, voice=voice)
                    self._check()
                    if not response or response.get('ok') is not True: raise RuntimeError('synthesis')
                    audio.chmod(0o600)
                    with wave.open(str(audio), 'rb') as source:
                        params = (source.getnchannels(), source.getsampwidth(), source.getframerate())
                        if params[0:2] != (1, 2) or not 8000 <= params[2] <= 96000 or source.getnframes() <= 0:
                            raise RuntimeError('audio_format')
                        if audio_format is None:
                            audio_format = params
                            if format == 'wav':
                                writer = wave.open(str(temporary), 'wb'); writer.setparams((*params, 0, 'NONE', 'not compressed'))
                            else:
                                encoder = subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y',
                                    '-f','s16le','-ar',str(params[2]),'-ac','1','-i','pipe:0','-c:a','libmp3lame','-b:a','64k','-f','mp3',str(temporary)],
                                    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                                with self._lock: self._encoder = encoder
                        elif params != audio_format: raise RuntimeError('audio_format')
                        while True:
                            self._check(); block = source.readframes(4096)
                            if not block: break
                            if writer is not None: writer.writeframesraw(block)
                            else:
                                pending = memoryview(block)
                                while pending:
                                    self._check(); count = encoder.stdin.write(pending)
                                    if not count: raise RuntimeError('encoder')
                                    pending = pending[count:]
                    audio.unlink(missing_ok=True)
                    self._publish(completedChunks=index+1, percent=min(99, int((index+1)/len(chunks)*100)))
                if writer is not None: writer.close(); writer = None
                if encoder is not None:
                    encoder.stdin.close()
                    while encoder.poll() is None:
                        self._check(); self._cancelled.wait(.03)
                    if encoder.returncode != 0: raise RuntimeError('encoder')
                self._check()
            if not temporary.is_file() or temporary.stat().st_size <= 44: raise RuntimeError('empty')
            with temporary.open('rb') as output: os.fsync(output.fileno())
            with self._lock:
                self._check(); self._committing = True
                os.replace(temporary, self.output_dir / filename)
                self._state.update(state='complete', percent=100, filename=filename, error='', errorKey='')
            temporary = None
            self._publish()
        except _Cancelled:
            self._publish(state='cancelled', error='', errorKey='')
        except Exception:
            if self._cancelled.is_set(): self._publish(state='cancelled', error='', errorKey='')
            else: self._publish(state='error', error='Das vollständige Hörbuch konnte nicht gespeichert werden. Bitte freien Speicher und FFmpeg prüfen.', errorKey='export_failed')
        finally:
            if writer is not None:
                with contextlib.suppress(Exception): writer.close()
            if encoder is not None and encoder.poll() is None:
                with contextlib.suppress(OSError): encoder.terminate()
                try: encoder.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(OSError): encoder.kill()
                    encoder.wait()
            if temporary is not None:
                with contextlib.suppress(OSError): temporary.unlink()
            with self._lock: self._encoder = None
