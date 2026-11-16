"""Bounded synthesis ahead of playback, with explicit WAV ownership."""
from __future__ import annotations

from collections import deque
import contextlib
from dataclasses import dataclass
import inspect
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time
import wave

import citations


def _audit_spoken(chunk, spoken):
    """Opt-in (flag file) acceptance log: counts only, never document text."""
    flag = Path.home() / ".cache" / "brave-reader" / "spoken-audit.flag"
    if not flag.exists():
        return
    try:
        marks = len(citations.BRACKET_MARK.findall(spoken)) + len(re.findall(r"(?<![A-Za-z0-9])[A-Z]{1,2}\d{1,3}(?![A-Za-z0-9])", spoken))
        row = {"chars": len(chunk.get("text", "")), "spokenChars": len(spoken),
               "silentWords": sum(1 for w in chunk.get("words", []) if w.get("silent")), "markLeft": marks}
        log = flag.with_name("spoken-audit.jsonl")
        fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a") as handle:
            handle.write(json.dumps(row) + "\n")
    except Exception:
        pass


@dataclass(frozen=True)
class PreparedChunk:
    chunk: dict
    index: int
    audio: Path
    timings: list
    duration: float


class _Cancellation:
    """Event-compatible view; closing a prefetch never cancels its Reading."""

    def __init__(self, shared, local):
        self.shared, self.local = shared, local

    def is_set(self):
        return self.shared.is_set() or self.local.is_set()

    def wait(self, timeout=None):
        deadline = None if timeout is None else time.monotonic() + timeout
        while not self.is_set():
            remaining = None if deadline is None else deadline - time.monotonic()
            if remaining is not None and remaining <= 0:
                return False
            self.local.wait(0.02 if remaining is None else min(0.02, remaining))
        return True


class Prefetch:
    """Prepare up to ``limit`` ordered chunks while the consumer plays audio.

    ``get()`` transfers the returned WAV to the consumer, which must delete it
    after use.  Pending/active WAVs remain owned here and are deleted on close,
    shared cancellation, or after they are no longer needed.  The supplied
    SynthService remains alive.  A producer error is raised by get() after any
    already prepared chunks have been consumed.
    """

    def __init__(self, synth, chunks, work: Path, cancelled, limit=6, voice=None):
        if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1:
            raise ValueError("Der Vorladepuffer muss mindestens einen Abschnitt enthalten.")
        self._synth, self._chunks, self._limit = synth, chunks, limit
        self._voice = voice
        try:
            accepts = "voice" in inspect.signature(synth.render).parameters
        except (TypeError, ValueError):
            accepts = False
        self._pass_voice = bool(voice) and accepts
        self._directory = Path(tempfile.mkdtemp(prefix="prefetch-", dir=work))
        self._directory.chmod(0o700)
        self._stop = threading.Event()
        self._cancelled = _Cancellation(cancelled, self._stop)
        self._condition = threading.Condition()
        self._queue = deque()
        self._owned = set()
        self._done = False
        self._error = None
        self._thread = threading.Thread(target=self._produce, name="brave-prefetch", daemon=True)
        self._thread.start()

    def _cleanup(self):
        with self._condition:
            paths = list(self._owned)
            self._owned.clear()
            self._queue.clear()
        for path in paths:
            with contextlib.suppress(OSError):
                path.unlink()
        # Consumed WAVs belong to the caller and must survive close().
        with contextlib.suppress(OSError):
            self._directory.rmdir()

    def _produce(self):
        try:
            for index, chunk in enumerate(self._chunks):
                with self._condition:
                    while len(self._queue) >= self._limit and not self._cancelled.is_set():
                        self._condition.wait(0.02)
                    if self._cancelled.is_set():
                        return
                    audio = self._directory / f"chunk-{index}.wav"
                    self._owned.add(audio)
                # Synthesizers written before voices existed take no voice argument.
                extra = {"voice": self._voice} if self._pass_voice else {}
                # Citation marks stay in the chunk (offsets, highlight) but are not spoken.
                view = citations.spoken_view(chunk) if citations.has_speech(chunk) else None
                spoken = view[0] if view else str(chunk.get("text", ""))
                _audit_spoken(chunk, spoken)
                response = self._synth.render(spoken, audio, self._cancelled, **extra)
                if self._cancelled.is_set():
                    return
                if response is None:
                    raise RuntimeError("Die Sprachausgabe wurde beim Vorladen unterbrochen.")
                if response.get("ok") is not True:
                    raise RuntimeError("Die Sprachausgabe konnte nicht vorbereitet werden. Bitte erneut starten.")
                audio.chmod(0o600)
                with wave.open(str(audio), "rb") as wav:
                    duration = wav.getnframes() / wav.getframerate()
                prepared = PreparedChunk(chunk, index, audio,
                                         citations.remap_timings(chunk, view, response.get("timings", [])), duration)
                with self._condition:
                    if self._cancelled.is_set():
                        return
                    self._queue.append(prepared)
                    self._condition.notify_all()
        except Exception as error:
            with self._condition:
                if not self._cancelled.is_set():
                    self._error = error
        finally:
            with self._condition:
                self._done = True
                self._condition.notify_all()
            if self._cancelled.is_set():
                self._cleanup()

    def get(self):
        """Wait for the next chunk; return None at end or on cancellation."""
        with self._condition:
            while True:
                if self._cancelled.is_set():
                    return None
                if self._queue:
                    prepared = self._queue.popleft()
                    self._owned.discard(prepared.audio)
                    self._condition.notify_all()
                    return prepared
                if self._done:
                    if self._error is not None:
                        raise self._error
                    return None
                self._condition.wait(0.02)

    def close(self):
        self._stop.set()
        with self._condition:
            self._condition.notify_all()
        if threading.current_thread() is not self._thread:
            # SynthService.render is cancel-aware and returns independently of
            # whether the native model has acknowledged its cancellation yet.
            self._thread.join()
        self._cleanup()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
