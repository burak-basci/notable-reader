"""Persistent volume/mute settings: defaults, 5-step grid, atomic batch, unrelated keys survive."""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preferences import Preferences, volume_value

assert [volume_value(x) for x in (0, 100, 150, 33, 37, 152, -4, 99.9, "40")] == [0, 100, 150, 35, 35, 150, 0, 100, 40]
for bad in (True, None, "x", float("nan"), float("inf"), [1]):
    try:
        volume_value(bad)
    except (ValueError, TypeError):
        pass
    else:
        raise AssertionError(bad)

with tempfile.TemporaryDirectory() as folder:
    path = Path(folder) / "settings.json"
    path.write_text(json.dumps({"speed": 2.0, "follow": False, "voices": {"de": "piper:thorsten"}}))
    p = Preferences(path)
    assert p.volume == 100 and p.muted is False, "Standard 100 und nicht stumm"
    p.update({"volume": 35, "muted": True})
    data = json.loads(path.read_text())
    assert data["volume"] == 35 and data["muted"] is True
    assert data["speed"] == 2.0 and data["follow"] is False and data["voices"] == {"de": "piper:thorsten"}, "uebrige Werte bleiben"
    again = Preferences(path)
    assert again.volume == 35 and again.muted is True and again.speed == 2.0
    before = path.read_text()
    for bad in ({"volume": "x"}, {"volume": True}, {"muted": 1}, {"muted": "no"}, {"volume": 10, "speed": "x"}):
        try:
            again.update(bad)
        except (ValueError, TypeError):
            pass
        else:
            raise AssertionError(bad)
        assert path.read_text() == before and again.volume == 35 and again.muted is True
    again.update({"volume": 150, "muted": False})
    assert Preferences(path).volume == 150
    # damaged values fall back to the defaults instead of crashing
    path.write_text(json.dumps({"volume": 400, "muted": "x"}))
    q = Preferences(path)
    assert q.volume == 100 and q.muted is False
    path.write_text(json.dumps({"volume": True, "muted": True}))
    q = Preferences(path)
    assert q.volume == 100 and q.muted is True
print("ok")
