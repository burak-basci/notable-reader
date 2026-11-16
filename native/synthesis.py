"""One warm synthesis process, independent of reading and playback lifetimes."""
from __future__ import annotations

import contextlib
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections import deque


class _WorkerLost(Exception):
    pass


@dataclass
class _Job:
    text: str
    output: Path
    cancelled: threading.Event
    done: threading.Event = field(default_factory=threading.Event)
    abandoned: bool = False
    published: bool = False
    result: dict | None = None
    error: RuntimeError | None = None
    identifier: int = 0
    sent_pid: int | None = None
    voice: str | None = None
    warm: bool = False


class SynthService:
    """Prewarm Bella once; canceled readings never terminate its model.

    The dispatcher renders; cancellation sends a control message on the same
    serialized pipe.  Its response is drained and its private WAV discarded.
    No worker ever receives a reading-owned output path.
    """

    # Cold native model loads get a generous budget; a cancelled request only
    # keeps its worker when the worker actually acknowledges cancellation.
    STARTUP_TIMEOUT = 120.0
    REQUEST_TIMEOUT = 180.0
    CANCELLATION_TIMEOUT = 2.0
    MAX_RESPONSE_BYTES = 8 * 1024 * 1024

    def __init__(self, runtime: Path, script: Path):
        self._script = Path(script)
        self._directory = Path(tempfile.mkdtemp(prefix="synth-service-", dir=runtime))
        self._directory.chmod(0o700)
        self._condition = threading.Condition()
        self._writer = threading.Lock()
        self._jobs = deque()
        self._active = None
        self._process = None
        self._closed = False
        self._receive_buffer = bytearray()
        self._loads = 0
        self._ready = False
        self._load_seconds = None
        self._providers = []
        self._loaded = []
        self._serial = 0
        self._thread = threading.Thread(target=self._dispatch, name="brave-synthesis", daemon=True)
        self._thread.start()

    def stats(self):
        with self._condition:
            process = self._process
            alive = process is not None and process.poll() is None
            return {"pid": process.pid if alive else None, "loads": self._loads,
                    "ready": self._ready and alive, "loadSeconds": self._load_seconds,
                    "providers": list(self._providers) if alive else [],
                    "loaded": list(self._loaded) if alive else []}

    def warm(self, voice):
        """Load the engine of ``voice`` ahead of its first section; returns immediately."""
        job = _Job("", self._directory / "warm.wav", threading.Event(), voice=voice, warm=True)
        with self._condition:
            if self._closed:
                return
            # Queued behind real sections: a warm-up must never delay audio.
            self._jobs.append(job)
            self._condition.notify()

    def render(self, text, output_path: Path, cancelled: threading.Event, voice=None):
        job = _Job(text, Path(output_path), cancelled, voice=voice)
        with self._condition:
            if self._closed or cancelled.is_set():
                return None
            self._jobs.appendleft(job)
            self._condition.notify()
        while not job.done.wait(0.02):
            if cancelled.is_set():
                with self._condition:
                    job.abandoned = True
                    if job.published:
                        with contextlib.suppress(OSError):
                            job.output.unlink()
                    self._condition.notify()
                self._cancel_active(job)
                return None
        with self._condition:
            if self._closed or cancelled.is_set() or job.abandoned:
                if job.published:
                    with contextlib.suppress(OSError):
                        job.output.unlink()
                return None
            if job.error:
                raise job.error
            return job.result

    def _cancel_active(self, job):
        # Same lock order as request publication.  A cancellation before a
        # request is sent makes _perform skip it; after publication, its cancel
        # control is guaranteed to follow that complete JSON line.
        with self._writer:
            with self._condition:
                process = self._process
                if (self._closed or job.done.is_set() or self._active is not job or
                        process is None or job.sent_pid != process.pid):
                    return
                try:
                    process.stdin.write(json.dumps({"type": "cancel", "id": job.identifier}) + "\n")
                    process.stdin.flush()
                except (OSError, ValueError):
                    # The dispatcher owns crash detection and its single retry.
                    pass

    @staticmethod
    def _terminate(process):
        if process is None:
            return
        with contextlib.suppress(OSError, ValueError):
            process.stdin.close()
        if process.poll() is None:
            try:
                process.wait(timeout=0.15)
            except subprocess.TimeoutExpired:
                with contextlib.suppress(OSError):
                    process.terminate()
                try:
                    process.wait(timeout=0.7)
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(OSError):
                        process.kill()
                    process.wait()
        for stream in (process.stdin, process.stdout):
            with contextlib.suppress(OSError, ValueError):
                stream.close()

    def _discard_process(self):
        with self._condition:
            process, self._process = self._process, None
            self._ready = False
        self._terminate(process)
        self._receive_buffer.clear()

    def _receive(self, process, timeout, job=None):
        deadline = time.monotonic() + timeout
        cancelled_at = None
        try:
            # readline() can block forever even after select() if a native
            # worker flushed only half a JSON line. Read available bytes only.
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    now = time.monotonic()
                    if self._closed:
                        raise _WorkerLost()
                    if job is not None and (job.abandoned or job.cancelled.is_set()):
                        if cancelled_at is None:
                            cancelled_at = now
                        deadline = min(deadline, cancelled_at + self.CANCELLATION_TIMEOUT)
                    if now >= deadline:
                        raise _WorkerLost()
                    newline = self._receive_buffer.find(b"\n")
                    if newline >= 0:
                        line = self._receive_buffer[:newline]
                        del self._receive_buffer[:newline + 1]
                        message = json.loads(line)
                        if not isinstance(message, dict):
                            raise ValueError()
                        return message
                    if not selector.select(min(0.05, deadline - now)):
                        continue
                    block = os.read(process.stdout.fileno(), 65536)
                    if not block:
                        raise _WorkerLost()
                    self._receive_buffer.extend(block)
                    if len(self._receive_buffer) > self.MAX_RESPONSE_BYTES:
                        raise _WorkerLost()
        except (OSError, ValueError, TypeError):
            raise _WorkerLost() from None

    def _start(self):
        with self._condition:
            if self._closed:
                raise _WorkerLost()
            try:
                process = subprocess.Popen(
                    [sys.executable, str(self._script), "--synth-worker"],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                    text=True, bufsize=1,
                    env={**os.environ, "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2",
                         "MALLOC_ARENA_MAX": "2", "MALLOC_TRIM_THRESHOLD_": "131072"},
                )
            except OSError:
                raise _WorkerLost() from None
            self._process = process
            self._ready = False
        self._receive_buffer.clear()
        ready = self._receive(process, self.STARTUP_TIMEOUT)
        if ready.get("type") != "ready" or ready.get("pid") != process.pid:
            raise _WorkerLost()
        with self._condition:
            if self._closed:
                raise _WorkerLost()
            self._loads += 1
            self._load_seconds = ready.get("loadSeconds")
            self._providers = [name for name in ready.get("providers", [])
                               if name in {"CUDAExecutionProvider", "CPUExecutionProvider"}]
            self._ready = True
        return process

    def _perform(self, job, private_path):
        for attempt in range(2):
            if self._closed or job.abandoned or job.cancelled.is_set():
                return None
            try:
                process = self._process
                if process is None or process.poll() is not None:
                    self._discard_process()
                    process = self._start()
                request = {"id": job.identifier, "text": job.text, "output": str(private_path)}
                if job.voice:
                    request["voice"] = job.voice
                if job.warm:
                    request["warm"] = True
                with self._writer:
                    with self._condition:
                        if self._closed or job.abandoned or job.cancelled.is_set():
                            return None
                        try:
                            process.stdin.write(json.dumps(request) + "\n")
                            process.stdin.flush()
                            job.sent_pid = process.pid
                        except (OSError, ValueError):
                            raise _WorkerLost() from None
                response = self._receive(process, self.REQUEST_TIMEOUT, job)
                if response.get("id") != job.identifier:
                    raise _WorkerLost()
                if response.get("cancelled") is True and (job.abandoned or job.cancelled.is_set()):
                    return None
                if isinstance(response.get("loaded"), list):
                    self._loaded = [name for name in response["loaded"] if isinstance(name, str)][:8]
                if response.get("ok") is not True:
                    if job.warm:
                        return None
                    raise RuntimeError("Dieser Abschnitt konnte nicht vorgelesen werden. Bitte erneut starten.")
                return response
            except _WorkerLost:
                self._discard_process()
                with contextlib.suppress(OSError):
                    private_path.unlink()
                if attempt:
                    raise RuntimeError("Die Sprachausgabe wurde unterbrochen. Bitte erneut starten.") from None
        return None

    def _dispatch(self):
        try:
            # Startup is independent of render(), so the model warms immediately.
            for attempt in range(2):
                try:
                    self._start()
                    break
                except _WorkerLost:
                    self._discard_process()
                    if self._closed:
                        return
                    # A failed eager warm-up must not poison this service for
                    # its whole lifetime. A later reading gets its own bounded
                    # retry through _perform(), without an autonomous spin loop.
            while True:
                with self._condition:
                    self._condition.wait_for(lambda: self._closed or self._jobs)
                    if self._closed:
                        return
                    job = self._jobs.popleft()
                    self._active = job
                    self._serial += 1
                    job.identifier = self._serial
                    private_path = self._directory / f"job-{self._serial}.wav"
                try:
                    if not job.abandoned and not job.cancelled.is_set():
                        response = self._perform(job, private_path)
                        with self._condition:
                            if (response is not None and not job.warm and not self._closed
                                    and not job.abandoned and not job.cancelled.is_set()):
                                # Never create a reading's directory: cancellation
                                # may already have removed it while ONNX finished.
                                os.replace(private_path, job.output)
                                job.published = True
                                job.result = response
                except RuntimeError as error:
                    job.error = error
                except Exception:
                    # Filesystem/protocol errors must never disclose input text.
                    job.error = RuntimeError("Die Sprachausgabe konnte nicht vorbereitet werden. Bitte erneut starten.")
                finally:
                    with contextlib.suppress(OSError):
                        private_path.unlink()
                    with self._condition:
                        self._active = None
                        job.done.set()
        finally:
            self._discard_process()
            with self._condition:
                for job in self._jobs:
                    job.error = RuntimeError("Die Sprachausgabe konnte nicht gestartet werden. Bitte die Vorlese-App neu öffnen.")
                    job.done.set()
                self._jobs.clear()

    def close(self):
        with self._condition:
            first = not self._closed
            self._closed = True
            if self._active:
                self._active.abandoned = True
                self._active.done.set()
            for job in self._jobs:
                job.abandoned = True
                job.done.set()
            self._jobs.clear()
            process = self._process if first else None
            self._condition.notify_all()
        if first:
            self._terminate(process)
        if threading.current_thread() is not self._thread:
            self._thread.join(timeout=3)
        if not self._thread.is_alive():
            shutil.rmtree(self._directory, ignore_errors=True)
