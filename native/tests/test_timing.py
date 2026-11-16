#!/usr/bin/env python3
"""Timing regressions using real eSpeak, with no ONNX model or audio device."""
from pathlib import Path
import re
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kokoro_onnx.sliding import Timing
from kokoro_onnx.tokenizer import Tokenizer
from timing import _source_phonemes, synthesize_with_words


class TimedModel:
    def __init__(self):
        self.tokenizer = Tokenizer()
        self.calls = []

    def create_timed(self, text, **kwargs):
        self.calls.append((text, kwargs))
        phonemes = self.tokenizer.phonemize(text)
        spoken = [Timing(char, index / 100, (index + 1) / 100)
                  for index, char in enumerate(phonemes)]
        return np.zeros(max(1, len(phonemes)) * 240, dtype=np.float32), 24000, spoken


class TimingTests(unittest.TestCase):
    def test_numbered_references_keep_their_original_word_owner(self):
        model = TimedModel()
        for text in ('See 2.4. Next action.', '1.2. A useful heading.',
                     'Compare 2.4. and 3.4.5. carefully.', 'Before ◆ after.',
                     'CI/CD in 2026 improves reliability.'):
            with self.subTest(text=text):
                words = list(re.finditer(r'\S+', text))
                _, owners = _source_phonemes(model, words)
                self.assertTrue(all(owner is None or 0 <= owner < len(words)
                                    for owner in owners))
                for index, word in enumerate(words):
                    # Every spoken token, including the final one, retains
                    # ownership even when a preceding reference expands.
                    if any(char.isalnum() for char in word.group()):
                        self.assertIn(index, owners)

    def test_reference_fragments_and_following_word_have_exact_owners(self):
        model = TimedModel()
        words = list(re.finditer(r'\S+', 'See 2.4. Next action.'))
        source, owners = _source_phonemes(model, words)
        owned = [''.join(char for char, owner in zip(source, owners) if owner == index)
                 for index in range(len(words))]
        # Both spoken number fragments belong to source word 1.  In
        # particular, Next must retain its own phonemes at source word 2.
        self.assertEqual(owned, ['sˈiː', 'tˈuː. fˈɔːɹ', 'nˈɛkst', 'ˈækʃən.'])

    def test_numbered_reference_does_not_abort_sentence_or_shift_following_words(self):
        model = TimedModel()
        text = 'See 2.4. Next action improves reliability.'
        samples, rate, timings = synthesize_with_words(model, text)
        words = list(re.finditer(r'\S+', text))
        self.assertEqual(len(timings), len(words))
        self.assertEqual(rate, 24000)
        self.assertGreater(len(samples), 0)
        self.assertEqual([(item['charStart'], item['charEnd']) for item in timings],
                         [(word.start(), word.end()) for word in words])
        self.assertTrue(all(item['end'] > item['start'] for item in timings))
        self.assertEqual(model.calls, [(text, {'voice': 'af_bella', 'speed': 1.0, 'lang': 'en-us'})])


if __name__ == '__main__':
    unittest.main()
