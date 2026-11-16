"""Synthesis engines inside the one warm worker process.

The base Kokoro model (English and the other bundled languages) is loaded at
worker start and never dropped.  German Kokoro fine-tunes and Piper voices load
on first use and stay resident; at most ``MAX_EXTRA`` of them are kept, least
recently used first, so memory stays bounded while a document keeps one voice.
Switching voice or language never reloads the base model and never restarts the
worker; a section is rendered with whichever engine its voice names.
"""
from __future__ import annotations

from collections import OrderedDict
from pathlib import Path
import re

import voices
from timing import synthesize_with_words, weighted_timings

MAX_EXTRA = 2


class Engines:
    def __init__(self, root, open_session, kokoro_class, release=lambda: None):
        self.root = Path(root)
        self.open_session = open_session          # path -> cancel-aware onnxruntime session
        self.kokoro_class = kokoro_class
        self.release = release
        self.loaded = OrderedDict()               # group -> engine object
        self.load_counts = {}

    def _load(self, group):
        spec = voices.GROUPS[group]
        if spec["engine"] == "kokoro":
            session = self.open_session(self.root / spec["model"])
            return self.kokoro_class.from_session(session, str(self.root / spec["voices"]))
        from piper_engine import PiperVoice
        session = self.open_session(self.root / spec["model"])
        return PiperVoice(session, self.root / spec["config"])

    def get(self, group):
        if group in self.loaded:
            self.loaded.move_to_end(group)
            return self.loaded[group]
        if not voices.group_installed(group, self.root):
            raise KeyError(group)
        engine = self._load(group)
        self.loaded[group] = engine
        self.load_counts[group] = self.load_counts.get(group, 0) + 1
        extras = [name for name in self.loaded if name != "base"]
        while len(extras) > MAX_EXTRA:
            del self.loaded[extras.pop(0)]
            self.release()
        return engine

    def names(self):
        return list(self.loaded)

    def warm(self, voice_id):
        record = voices.voice_record(voice_id)
        if record is None:
            raise KeyError(voice_id)
        self.get(record["group"])

    def synthesize(self, voice_id, text):
        """-> (24 kHz samples, sample rate, word timings) for ``voice_id``."""
        record = voices.voice_record(voice_id or voices.DEFAULTS["en"])
        if record is None:
            raise KeyError(voice_id)
        engine = self.get(record["group"])
        if record["engine"] == "kokoro":
            return synthesize_with_words(engine, text, voice=record["name"], lang=record["espeak"])
        samples = engine.synthesize(text)
        rate = 24000
        words = list(re.finditer(r"\S+", text))
        import phonemizer
        from kokoro_onnx.tokenizer import _espeak_lock
        with _espeak_lock:
            per_word = [" ".join(phonemizer.phonemize([w.group()], language=engine.espeak,
                        preserve_punctuation=True, with_stress=True, language_switch="remove-flags"))
                        for w in words]
        return samples, rate, weighted_timings(text, samples, rate, per_word)
