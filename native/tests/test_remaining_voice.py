"""Voice-specific prior of the remaining-time estimate."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import voices
from remaining import RemainingTime

chunks = [{"text": "eins zwei drei vier fünf sechs sieben acht neun zehn"}] * 20
assert RemainingTime(chunks).seconds(0, 1) == RemainingTime(chunks, None).seconds(0, 1)
assert RemainingTime(chunks, 0.31).seconds(0, 1) < RemainingTime(chunks, 0.36).seconds(0, 1)
assert RemainingTime(chunks, "x").seconds(0, 1) == RemainingTime(chunks).seconds(0, 1)
assert RemainingTime(chunks, True if False else 50).seconds(0, 1) == RemainingTime(chunks).seconds(0, 1)  # absurd prior ignored
assert voices.prior_seconds_per_word("piper:thorsten") < voices.prior_seconds_per_word("kokoro:df_kerstin")
assert voices.prior_seconds_per_word("kokoro:af_bella") == voices.prior_seconds_per_word(None) == 0.36
# Calibration still overrides the prior once audio exists.
r = RemainingTime(chunks, 0.31)
for i in range(10):
    r.observe(i, chunks[i], 5.0)
assert abs(r.seconds(0, 1) - 20 * 5.0) < 15
print("ok remaining voice")
