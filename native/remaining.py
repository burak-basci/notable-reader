"""Remaining wall-clock reading time, calibrated by already prepared audio.

Only counts and durations are retained; no document text or audio is stored.
The playback position comes from mpv, so pauses never consume estimated time.
"""
from __future__ import annotations

import math
import bisect
import re
import threading


def word_count(chunk):
    # Citation marks stay in the text but are not spoken, so they take no time.
    silent = sum(1 for w in chunk.get("words", []) if isinstance(w, dict) and w.get("silent"))
    return max(0, len(re.findall(r"\S+", str(chunk.get("text", "")))) - silent)


class RemainingTime:
    DEFAULT_SECONDS_PER_WORD = 60 / 165
    PRIOR_WORDS = 40

    def __init__(self, chunks, seconds_per_word=None):
        # Voice-specific prior (measured speaking rate); calibrated away as audio is prepared.
        self.prior_rate = (seconds_per_word if isinstance(seconds_per_word, (int, float)) and 0.1 <= seconds_per_word <= 2
                           else self.DEFAULT_SECONDS_PER_WORD)
        weights = [word_count(chunk) for chunk in chunks]
        self.weights = weights
        self._durations = {}
        self._view_cache = None
        self.total_words = sum(weights)
        self.total_chunks = sum(weight > 0 for weight in weights)
        self._seen = set()
        self._known_words = 0
        self._known_seconds = 0.0
        self._lock = threading.Lock()

    def observe(self, index, chunk, duration):
        if type(index) is not int or not 0 <= index < len(self.weights) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration < 0:
            return
        with self._lock:
            if index in self._seen:
                return
            self._seen.add(index)
            self._known_words += word_count(chunk)
            self._known_seconds += duration
            self._durations[index] = duration
            self._view_cache = None

    def durations(self):
        """Actual prepared durations plus explicitly estimated unprepared spans."""
        return self._view()[0]

    def _view(self):
        with self._lock:
            if self._view_cache is None:
                rate = ((self._known_seconds + self.PRIOR_WORDS * self.prior_rate)
                        / (self._known_words + self.PRIOR_WORDS))
                durations = tuple(self._durations.get(index, weight * rate) for index, weight in enumerate(self.weights))
                prefix = [0.0]
                for duration in durations: prefix.append(prefix[-1]+duration)
                estimated = any(index not in self._durations for index in range(len(self.weights)))
                self._view_cache = durations,tuple(prefix),estimated
            return self._view_cache

    def position_at(self, index, fraction=0):
        durations,prefix,_ = self._view()
        index = max(0,min(len(durations),index))
        return prefix[index]+(durations[index]*max(0,min(1,fraction)) if index<len(durations) else 0)

    def index_at(self, position):
        durations,prefix,_ = self._view()
        if not durations or not prefix[-1]:return 0
        return max(0,min(len(durations)-1,bisect.bisect_right(prefix,position)-1))

    def calibrated_rate(self):
        with self._lock:
            return ((self._known_seconds + self.PRIOR_WORDS * self.prior_rate)
                    / (self._known_words + self.PRIOR_WORDS))

    def snapshot(self, position=0, speed=1):
        if type(position) not in (int, float) or not math.isfinite(position): position = 0
        if type(speed) not in (int, float) or not math.isfinite(speed) or speed <= 0: speed = 1
        _durations,prefix,estimated = self._view()
        total = prefix[-1]
        elapsed = min(total, max(0, position))
        return {'elapsedSeconds': elapsed / speed, 'totalSeconds': total / speed,
                'remainingSeconds': max(0, total - elapsed) / speed,
                'progressFraction': elapsed / total if total else 0,
                'remainingEstimated': bool(estimated)}

    def seconds(self, position, speed):
        if not isinstance(position, (int, float)) or not math.isfinite(position):
            position = 0
        if not isinstance(speed, (int, float)) or not math.isfinite(speed) or speed <= 0:
            speed = 1
        with self._lock:
            unknown = max(0, self.total_words - self._known_words)
            rate = ((self._known_seconds + self.PRIOR_WORDS * self.prior_rate)
                    / (self._known_words + self.PRIOR_WORDS))
            total_seconds = self._known_seconds + unknown * rate
            return max(0.0, total_seconds - max(0, position)) / speed


def format_remaining(seconds):
    if seconds is None:
        return ""
    seconds = max(0, math.ceil(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    duration = f"{hours}:{minutes:02}:{seconds:02}" if hours else f"{minutes}:{seconds:02}"
    return f"Rest ca. {duration}"
