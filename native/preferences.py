"""Global reader preferences, independent of the current PDF or session."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import re
import tempfile

DEFAULT_BAR = {"x": 0.5, "y": 1.0}


def speed_value(value):
    if isinstance(value, bool):
        raise ValueError("Ungültiges Tempo")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Ungültiges Tempo")
    return round(max(0.8, min(4.0, number)) * 20) / 20


def volume_value(value):
    """mpv software volume in percent, 5-step grid, 0..150."""
    if isinstance(value, bool):
        raise ValueError("Ungültige Lautstärke")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Ungültige Lautstärke")
    return int(round(max(0.0, min(150.0, number)) / 5) * 5)


def axis_value(value):
    if isinstance(value, bool):
        raise ValueError("Ungültige Leistenposition")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Ungültige Leistenposition")
    return round(max(0.0, min(1.0, number)), 4)


def bar_value(value):
    if not isinstance(value, dict):
        raise ValueError("Ungültige Leistenposition")
    try:
        x, y = value["x"], value["y"]
    except KeyError:
        raise ValueError("Ungültige Leistenposition") from None
    return {"x": axis_value(x), "y": axis_value(y)}


LANGUAGE_PATTERN = re.compile(r"^(auto|[a-z]{2})$")
LANGUAGE_CODE = re.compile(r"^[a-z]{2}$")
VOICE_PATTERN = re.compile(r"^[a-z0-9_:.-]{1,64}$")
UI_LANGUAGES = ('de', 'en', 'fr', 'es', 'it', 'pt')
FORMAT_LOCALES = tuple(json.loads(Path(__file__).with_name('ui-locales.json').read_text()).get('formatLocales', ['auto']))
TIME_FORMATS = ('auto', '12h', '24h')


def format_locale_value(value):
    if type(value) is not str or value not in FORMAT_LOCALES:
        raise ValueError('Ungültiges Regionalformat')
    return value


def time_format_value(value):
    if type(value) is not str or value not in TIME_FORMATS:
        raise ValueError('Ungültiges Zeitformat')
    return value


def ui_language_value(value):
    if type(value) is not str or value not in UI_LANGUAGES:
        raise ValueError('Ungültige Oberflächensprache')
    return value


def language_value(value):
    if not isinstance(value, str) or not LANGUAGE_PATTERN.match(value):
        raise ValueError("Ungültige Sprache")
    return value

def player_theme_value(value):
    if type(value) is not str or value not in ('system','light','dark'):
        raise ValueError('Ungültige Playerdarstellung')
    return value


def voices_value(value):
    """Language code -> voice id.  Catalog membership is checked by the player."""
    if not isinstance(value, dict) or len(value) > 16:
        raise ValueError("Ungültige Stimmenwahl")
    result = {}
    for code, voice in value.items():
        if not isinstance(code, str) or not LANGUAGE_CODE.match(code) or not isinstance(voice, str) \
                or not VOICE_PATTERN.match(voice):
            raise ValueError("Ungültige Stimmenwahl")
        result[code] = voice
    return result


class Preferences:
    def __init__(self, path=None):
        config = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
        self.path = Path(path) if path is not None else config / "brave-reader" / "settings.json"
        self.speed = 1.0
        self.bar = dict(DEFAULT_BAR)
        self.click_seek = True
        self.follow = True
        self.auto_show = False
        self.language = "auto"
        self.ui_language = 'de'
        self.player_theme = 'system'
        self.format_locale = 'auto'
        self.time_format = 'auto'
        from reading_view import DEFAULT_APPEARANCE
        self.appearance = dict(DEFAULT_APPEARANCE)
        self.voices = {}
        self.volume = 100
        self.muted = False
        try:
            data = json.loads(self.path.read_text())
            if isinstance(data, dict):
                if type(data.get("autoShow")) is bool:
                    self.auto_show = data["autoShow"]
                if type(data.get("follow")) is bool:
                    self.follow = data["follow"]
                if type(data.get("clickSeek")) is bool:
                    self.click_seek = data["clickSeek"]
                if isinstance(data.get("language"), str) and LANGUAGE_PATTERN.match(data["language"]):
                    self.language = data["language"]
                if data.get('uiLanguage') in UI_LANGUAGES:
                    self.ui_language = data['uiLanguage']
                if data.get('playerTheme') in ('system','light','dark'):
                    self.player_theme = data['playerTheme']
                if type(data.get('formatLocale')) is str and data['formatLocale'] in FORMAT_LOCALES:
                    self.format_locale = data['formatLocale']
                if type(data.get('timeFormat')) is str and data['timeFormat'] in TIME_FORMATS:
                    self.time_format = data['timeFormat']
                try:
                    from reading_view import appearance_value
                    self.appearance = appearance_value(data.get('appearance',{}))
                except (ValueError,TypeError):pass
                try:
                    self.voices = voices_value(data.get("voices", {}))
                except ValueError:
                    self.voices = {}
                if type(data.get("muted")) is bool:
                    self.muted = data["muted"]
                number = data.get("volume")
                if not isinstance(number, bool) and isinstance(number, (int, float)) and 0 <= float(number) <= 150:
                    self.volume = volume_value(number)
                number = data.get("speed")
                if not isinstance(number, bool) and isinstance(number, (int, float)) and 0.8 <= float(number) <= 4:
                    self.speed = speed_value(number)
                bar = data.get("bar")
                if (isinstance(bar, dict) and not isinstance(bar.get("x"), bool)
                        and not isinstance(bar.get("y"), bool)
                        and isinstance(bar.get("x"), (int, float)) and isinstance(bar.get("y"), (int, float))
                        and 0 <= float(bar["x"]) <= 1 and 0 <= float(bar["y"]) <= 1):
                    self.bar = bar_value(bar)
        except (OSError, ValueError, TypeError, KeyError, OverflowError):
            pass

    def _write(self, key, value):
        self._write_many({key: value})

    def _write_many(self, values):
        """Commit a settings batch atomically, preserving unrelated saved keys."""
        self.path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        try:
            data = json.loads(self.path.read_text())
            if not isinstance(data, dict):
                data = {}
        except (FileNotFoundError, ValueError):
            data = {}
        data.update(values)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=".settings-",
                                             dir=self.path.parent, delete=False) as output:
                temporary = Path(output.name)
                os.chmod(temporary, 0o600)
                json.dump(data, output)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def set_speed(self, value):
        speed = speed_value(value)
        if speed == self.speed:
            return
        self._write("speed", speed)
        self.speed = speed

    def set_bar_position(self, value):
        bar = bar_value(value)
        if bar == self.bar:
            return
        self._write("bar", bar)
        self.bar = bar

    def set_click_seek(self, value):
        if type(value) is not bool:
            raise ValueError("Ungültige Klicksprung-Einstellung")
        if value == self.click_seek:
            return
        self._write("clickSeek", value)
        self.click_seek = value

    def update(self, values):
        """No in-memory preference changes are published before replace succeeds."""
        normalized = {}
        for key, value in values.items():
            if key == 'speed':
                normalized[key] = speed_value(value)
            elif key == 'bar':
                normalized[key] = bar_value(value)
            elif key == 'volume':
                normalized[key] = volume_value(value)
            elif key in ('follow', 'clickSeek', 'autoShow', 'muted') and type(value) is bool:
                normalized[key] = value
            elif key == 'language':
                normalized[key] = language_value(value)
            elif key == 'uiLanguage':
                normalized[key] = ui_language_value(value)
            elif key == 'playerTheme':
                normalized[key] = player_theme_value(value)
            elif key == 'formatLocale':
                normalized[key] = format_locale_value(value)
            elif key == 'timeFormat':
                normalized[key] = time_format_value(value)
            elif key == 'appearance':
                from reading_view import appearance_value
                normalized[key] = appearance_value(value,self.appearance)
            elif key == 'voices':
                normalized[key] = voices_value(value)
            else:
                raise ValueError('Ungültige Einstellung')
        current = {'speed': self.speed, 'bar': self.bar,
                   'follow': self.follow, 'clickSeek': self.click_seek, 'autoShow': self.auto_show,
                   'language': self.language, 'voices': self.voices,
                   'uiLanguage': self.ui_language, 'playerTheme':self.player_theme, 'formatLocale': self.format_locale, 'timeFormat': self.time_format,
                   'volume': self.volume, 'muted': self.muted, 'appearance':self.appearance}
        changed = {key: value for key, value in normalized.items() if value != current[key]}
        if changed:
            self._write_many(changed)
        for key, value in normalized.items():
            setattr(self, {'clickSeek': 'click_seek', 'autoShow': 'auto_show', 'uiLanguage': 'ui_language', 'playerTheme':'player_theme', 'formatLocale': 'format_locale', 'timeFormat': 'time_format'}.get(key, key), value)

    def set_language(self, value):
        self.update({'language': value})

    def set_voice(self, language, voice):
        """Remember one language's voice without touching the other languages' choices."""
        self.update({'voices': {**self.voices, **voices_value({language: voice})}})

    def set_follow(self, value):
        self.update({'follow': value})
