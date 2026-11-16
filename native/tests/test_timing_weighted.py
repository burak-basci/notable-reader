"""Word timing for engines without duration output: pauses anchor, phonemes weigh."""
import re
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from timing import detect_pauses, weighted_timings

RATE = 24000


def speech(seconds, rng):
    t = np.arange(int(seconds * RATE)) / RATE
    return (0.3 * np.sin(2 * np.pi * 180 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t)) + 0.01 * rng.standard_normal(len(t))).astype(np.float32)


def silence(seconds):
    return np.zeros(int(seconds * RATE), dtype=np.float32)


rng = np.random.default_rng(1)
# 0.1 s lead-in, 1.0 s speech, 0.4 s pause, 1.0 s speech, 0.1 s tail.
audio = np.concatenate([silence(0.1), speech(1.0, rng), silence(0.4), speech(1.0, rng), silence(0.1)])
pauses, (start, end) = detect_pauses(audio, RATE)
assert len(pauses) == 1 and abs(pauses[0][0] - 1.1) < 0.03 and abs(pauses[0][1] - 1.5) < 0.03, pauses
assert abs(start - 0.1) < 0.03 and abs(end - 2.5) < 0.03, (start, end)
# A short stop closure is not a pause.
closure = np.concatenate([speech(1, rng), silence(0.1), speech(1, rng)])
assert detect_pauses(closure, RATE)[0] == []

text = "Das ist ein Satz, danach kommt noch mehr Text."
phonemes = ["dˈas", "ˈɪst", "ˈaɪn", "zˈats,", "dɐnˈaχ", "kˈɔmt", "nˈɔχ", "mˈeːɐ", "tˈɛkst."]
result = weighted_timings(text, audio, RATE, phonemes)
words = text.split()
assert [w["text"] for w in result] == words
for word in result:
    assert text[word["charStart"]:word["charEnd"]] == word["text"]
starts = [w["start"] for w in result]
assert starts == sorted(starts) and all(w["end"] >= w["start"] for w in result)
# The comma boundary is pinned to the measured pause: "danach" starts after it, "Satz," ends before it.
assert result[3]["end"] <= 1.12 and result[4]["start"] >= 1.48, result
# Long words get more time than short ones within a stretch (phoneme weight, not letters).
assert (result[0]["end"] - result[0]["start"]) < (result[3]["end"] - result[3]["start"])
# Everything lies inside the audio.
assert result[0]["start"] >= 0 and result[-1]["end"] <= len(audio) / RATE + 1e-6

# No pauses at all: shares still follow phoneme weight and cover the speech region.
flat = weighted_timings("a bb ccc", speech(2.0, rng), RATE, ["a", "bb", "ccc"])
spans = [w["end"] - w["start"] for w in flat]
assert spans[0] < spans[1] < spans[2] and abs(sum(spans) - 2.0) < 0.05, spans
# Pure silence and mismatched inputs are handled, not guessed.
assert len(weighted_timings("x y", silence(1.0), RATE, ["x", "y"])) == 2
try:
    weighted_timings("x y", audio, RATE, ["x"])
except ValueError:
    pass
else:
    raise AssertionError("mismatch accepted")
assert weighted_timings("", audio, RATE, []) == []
# Same length of letters, different phonemes: weight follows the phonemes.
equal = weighted_timings("aaaa bbbb", speech(2.0, rng), RATE, ["ˈa", "bˈɛːʁtsʊŋ"])
assert (equal[1]["end"] - equal[1]["start"]) > 2 * (equal[0]["end"] - equal[0]["start"])
print("ok weighted timing")
