"""Piper VITS voices run directly on onnxruntime with the bundled eSpeak NG data.

No piper-tts package (GPL) is used: the voice's JSON gives the phoneme id map,
text is phonemized with the same eSpeak library the Kokoro tokenizer uses.
Piper models expose audio only, so word times come from timing.weighted_timings.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np

SENTENCE_PAUSE = 0.22
OUTPUT_RATE = 24000   # the playback pipe is fixed to 24 kHz mono s16le


def resample(samples, source, target=OUTPUT_RATE):
    """FFT resampling of one section (speech edges are silent, so no ringing matters)."""
    if source == target or len(samples) == 0:
        return samples.astype(np.float32, copy=False)
    count = int(round(len(samples) * target / source))
    spectrum = np.fft.rfft(samples.astype(np.float64))
    out = np.fft.irfft(spectrum, n=count) * (count / len(samples))
    return out.astype(np.float32)


def ensure_espeak():
    """Point phonemizer at the bundled eSpeak NG (the Kokoro tokenizer does the same)."""
    import espeakng_loader
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    from kokoro_onnx.tokenizer import _espeak_lock
    with _espeak_lock:
        EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
        EspeakWrapper.set_library(espeakng_loader.get_library_path())


class PiperVoice:
    def __init__(self, session, config_path):
        ensure_espeak()
        config = json.loads(Path(config_path).read_text())
        self.session = session
        self.ids = config["phoneme_id_map"]
        self.rate = int(config["audio"]["sample_rate"])
        self.espeak = config.get("espeak", {}).get("voice", "de")
        inference = config.get("inference", {})
        self.scales = np.array([inference.get("noise_scale", 0.667), inference.get("length_scale", 1.0),
                                inference.get("noise_w", 0.8)], dtype=np.float32)

    def phonemes(self, text):
        import phonemizer
        from kokoro_onnx.tokenizer import _espeak_lock
        with _espeak_lock:
            return phonemizer.phonemize([text], language=self.espeak, preserve_punctuation=True,
                                        with_stress=True, language_switch="remove-flags")[0]

    def encode(self, phonemes):
        ids = [self.ids["^"][0]]
        for char in phonemes:
            if char in self.ids and char not in "^$_":
                ids.extend((self.ids[char][0], self.ids["_"][0]))
        ids.append(self.ids["$"][0])
        # Piper interleaves the pad id after every phoneme; BOS is followed by a pad too.
        return [ids[0], self.ids["_"][0], *ids[1:]]

    def run(self, ids):
        feeds = {"input": np.array([ids], dtype=np.int64),
                 "input_lengths": np.array([len(ids)], dtype=np.int64), "scales": self.scales}
        return self.session.run(None, feeds)[0].reshape(-1).astype(np.float32)

    def synthesize(self, text):
        """-> (24 kHz float samples, per-word phoneme strings) for the whole section."""
        parts = [part for part in re.split(r"(?<=[.!?…])\s+", text.strip()) if part]
        pieces, gap = [], np.zeros(int(self.rate * SENTENCE_PAUSE), dtype=np.float32)
        for index, part in enumerate(parts):
            phonemes = " ".join(self.phonemes(part).split())
            ids = self.encode(phonemes)
            if len(ids) < 4:
                continue
            audio = self.run(ids)
            peak = float(np.max(np.abs(audio))) if len(audio) else 0
            if peak > 1:
                audio = audio / peak
            if pieces:
                pieces.append(gap)
            pieces.append(audio)
        if not pieces:
            raise RuntimeError("Kein sprechbarer Text.")
        return resample(np.concatenate(pieces), self.rate)
