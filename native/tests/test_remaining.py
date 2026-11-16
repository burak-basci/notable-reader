"""Time estimates must follow audio time, speed and the selected document tail."""
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from remaining import RemainingTime, format_remaining


class RemainingTests(unittest.TestCase):
    def test_initial_estimate_and_speed(self):
        estimate = RemainingTime([{"text": "word " * 165}])
        self.assertAlmostEqual(estimate.seconds(0, 1), 60)
        self.assertAlmostEqual(estimate.seconds(0, 4), 15)

    def test_prepared_durations_replace_estimate_without_double_count(self):
        chunks = [{"text": "word " * 80}, {"text": "word " * 85}]
        estimate = RemainingTime(chunks)
        estimate.observe(0, chunks[0], 40)
        estimate.observe(0, chunks[0], 40)
        estimate.observe(1, chunks[1], 50)
        self.assertEqual(estimate.seconds(10, 2), 40)

    def test_only_media_time_consumes_remaining(self):
        chunk = {"text": "word " * 10}
        estimate = RemainingTime([chunk])
        estimate.observe(0, chunk, 20)
        self.assertEqual(estimate.seconds(5, 1), 15)
        self.assertEqual(estimate.seconds(5, 1), 15)  # Paused at the same audio time.
        self.assertEqual(estimate.seconds(8, 1), 12)
        self.assertEqual(estimate.seconds(8, 2), 6)

    def test_new_selection_counts_only_tail(self):
        whole = RemainingTime([{"text": "word " * 100}])
        tail = RemainingTime([{"text": "word " * 10}])
        self.assertAlmostEqual(tail.seconds(0, 1), whole.seconds(0, 1) / 10)

    def test_empty_end_and_bad_samples(self):
        self.assertEqual(RemainingTime([]).seconds(0, 1), 0)
        chunk = {"text": "one two"}
        estimate = RemainingTime([chunk])
        estimate.observe(0, chunk, float("nan"))
        estimate.observe(0, chunk, -1)
        estimate.observe(0, chunk, 3)
        self.assertEqual(estimate.seconds(8, 1), 0)
        self.assertEqual(estimate.seconds(-5, 1), 3)
        self.assertEqual(estimate.seconds(float("nan"), float("inf")), 3)

    def test_formatting(self):
        self.assertEqual(format_remaining(None), "")
        self.assertEqual(format_remaining(0), "Rest ca. 0:00")
        self.assertEqual(format_remaining(65.1), "Rest ca. 1:06")
        self.assertEqual(format_remaining(3665), "Rest ca. 1:01:05")


if __name__ == "__main__":
    unittest.main()
