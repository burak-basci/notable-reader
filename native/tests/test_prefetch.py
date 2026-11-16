#!/usr/bin/env python3
"""Isolated WAV/producer checks; no browser, playback, or model required."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prefetch import Prefetch


def wait_for(predicate):
    end = time.monotonic() + 2
    while not predicate():
        if time.monotonic() >= end:
            raise AssertionError("Timed out waiting for producer")
        time.sleep(0.005)


class FakeSynth:
    def __init__(self, *, block=False, fail_at=None, failed_response=False):
        self.block, self.fail_at = block, fail_at
        self.failed_response = failed_response
        self.calls = []
        self.active = 0
        self.maximum_active = 0
        self.started = threading.Event()

    def render(self, text, audio, cancelled):
        index = len(self.calls)
        self.calls.append((index, audio))
        self.active += 1
        self.maximum_active = max(self.maximum_active, self.active)
        self.started.set()
        try:
            if self.block:
                cancelled.wait()
                return None
            if index == self.fail_at:
                raise RuntimeError("Public test failure")
            with wave.open(str(audio), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(24000)
                wav.writeframes(b"\0\0" * 2400)
            return {"ok": not self.failed_response, "timings": [{"start": 0, "end": 0.1}]}
        finally:
            self.active -= 1


class PrefetchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="brave-prefetch-test-")
        self.work = Path(self.temp.name)
        self.cancelled = threading.Event()

    def tearDown(self):
        self.temp.cleanup()

    def chunks(self, count):
        return [{"text": f"Public sentence {index}.", "page": index + 1} for index in range(count)]

    def test_multiple_ahead_bound_order_and_metadata(self):
        synth = FakeSynth()
        chunks = self.chunks(12)
        with Prefetch(synth, chunks, self.work, self.cancelled, limit=6) as producer:
            current = producer.get()
            self.assertEqual(current.index, 0)
            wait_for(lambda: len(synth.calls) == 7)
            # While the consumer keeps the current audio, six more are ready.
            time.sleep(0.04)
            self.assertEqual(len(synth.calls), 7)
            self.assertEqual(len(list(producer._directory.glob("*.wav"))), 7)
            self.assertEqual(producer._directory.stat().st_mode & 0o777, 0o700)
            for index in range(12):
                prepared = current if index == 0 else producer.get()
                self.assertEqual(prepared.index, index)
                self.assertIs(prepared.chunk, chunks[index])
                self.assertEqual(prepared.audio.name, f"chunk-{index}.wav")
                self.assertEqual(prepared.audio.stat().st_mode & 0o777, 0o600)
                self.assertEqual(prepared.timings, [{"start": 0, "end": 0.1}])
                self.assertAlmostEqual(prepared.duration, 0.1)
                prepared.audio.unlink()
            self.assertIsNone(producer.get())
            self.assertEqual(synth.maximum_active, 1)
        self.assertFalse(producer._thread.is_alive())
        self.assertFalse(producer._directory.exists())

    def test_close_preserves_consumed_audio_and_clears_pending(self):
        synth = FakeSynth()
        producer = Prefetch(synth, self.chunks(10), self.work, self.cancelled, limit=3)
        consumed = producer.get()
        wait_for(lambda: len(synth.calls) == 4)
        producer.close()
        producer.close()
        self.assertTrue(consumed.audio.exists())
        self.assertEqual(list(producer._directory.glob("*.wav")), [consumed.audio])
        self.assertFalse(self.cancelled.is_set())
        self.assertFalse(producer._thread.is_alive())
        self.assertIsNone(producer.get())

    def test_shared_cancellation_cleans_full_buffer_and_joins(self):
        synth = FakeSynth()
        producer = Prefetch(synth, self.chunks(20), self.work, self.cancelled, limit=2)
        wait_for(lambda: len(synth.calls) == 2)
        start = time.monotonic()
        self.cancelled.set()
        self.assertIsNone(producer.get())
        producer.close()
        self.assertLess(time.monotonic() - start, 0.3)
        self.assertFalse(producer._thread.is_alive())
        self.assertFalse(producer._directory.exists())

    def test_close_cancels_active_render_without_mutating_reading(self):
        synth = FakeSynth(block=True)
        producer = Prefetch(synth, self.chunks(5), self.work, self.cancelled)
        self.assertTrue(synth.started.wait(1))
        start = time.monotonic()
        producer.close()
        self.assertLess(time.monotonic() - start, 0.3)
        self.assertFalse(self.cancelled.is_set())
        self.assertEqual(synth.active, 0)
        self.assertFalse(producer._directory.exists())

    def test_get_waiting_for_audio_returns_on_shared_cancellation(self):
        synth = FakeSynth(block=True)
        with Prefetch(synth, self.chunks(5), self.work, self.cancelled) as producer:
            self.assertTrue(synth.started.wait(1))
            with ThreadPoolExecutor(max_workers=1) as pool:
                waiting = pool.submit(producer.get)
                self.cancelled.set()
                self.assertIsNone(waiting.result(timeout=0.3))
            wait_for(lambda: not producer._thread.is_alive())
            self.assertFalse(producer._directory.exists())

    def test_error_reaches_consumer_after_completed_audio(self):
        synth = FakeSynth(fail_at=2)
        with Prefetch(synth, self.chunks(6), self.work, self.cancelled) as producer:
            for index in range(2):
                prepared = producer.get()
                self.assertEqual(prepared.index, index)
                prepared.audio.unlink()
            with self.assertRaisesRegex(RuntimeError, "Public test failure"):
                producer.get()
        self.assertFalse(producer._directory.exists())

    def test_empty_input(self):
        synth = FakeSynth()
        with Prefetch(synth, [], self.work, self.cancelled) as producer:
            self.assertIsNone(producer.get())
        self.assertEqual(synth.calls, [])

    def test_failed_response_rejects_even_an_existing_valid_wav(self):
        synth = FakeSynth(failed_response=True)
        with Prefetch(synth, self.chunks(1), self.work, self.cancelled) as producer:
            with self.assertRaisesRegex(RuntimeError, "Sprachausgabe konnte nicht vorbereitet werden"):
                producer.get()
        self.assertFalse(producer._directory.exists())

    def test_invalid_bound(self):
        for limit in (0, -1, False, 1.5):
            with self.assertRaises(ValueError):
                Prefetch(FakeSynth(), [], self.work, self.cancelled, limit=limit)


if __name__ == "__main__":
    unittest.main()
