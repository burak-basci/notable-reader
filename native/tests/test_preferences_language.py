"""Persistent language and per-language voice settings."""
import json
import stat
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preferences import Preferences

with tempfile.TemporaryDirectory() as folder:
    path = Path(folder) / "settings.json"
    preferences = Preferences(path)
    assert preferences.language == "auto" and preferences.voices == {}
    preferences.set_language("de")
    preferences.set_voice("de", "kokoro:dm_martin")
    preferences.set_voice("en", "kokoro:af_sarah")
    data = json.loads(path.read_text())
    assert data["language"] == "de" and data["voices"] == {"de": "kokoro:dm_martin", "en": "kokoro:af_sarah"}
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    # Unrelated keys survive and a new instance reads everything back.
    preferences.update({"speed": 2.0})
    again = Preferences(path)
    assert again.language == "de" and again.voices["de"] == "kokoro:dm_martin" and again.speed == 2.0
    # Atomic batch: an invalid member changes nothing, in memory or on disk.
    before = path.read_text()
    for bad in ({"language": "German"}, {"language": 3}, {"voices": {"de": "Bad Id"}}, {"voices": {"deu": "x"}},
                {"voices": []}, {"voices": {"de": 1}}, {"language": "fr", "speed": "x"}):
        try:
            again.update(bad)
        except (ValueError, TypeError):
            pass
        else:
            raise AssertionError(bad)
        assert path.read_text() == before and again.language == "de"
    again.set_language("auto")
    assert Preferences(path).language == "auto"
    # Corrupt values fall back to defaults without discarding the rest.
    path.write_text(json.dumps({"language": "Deutsch", "voices": {"de": "NO"}, "speed": 1.5}))
    broken = Preferences(path)
    assert broken.language == "auto" and broken.voices == {} and broken.speed == 1.5
print("ok preferences language")
