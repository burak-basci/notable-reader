"""Voice catalog: language -> installed voices, defaults and selection rules.

Pure data and path checks; no model is loaded here.  A voice id is
``<engine>:<name>`` and satisfies the bridge allowlist ``^[a-z0-9_:.-]{1,64}$``.
Only voices whose model files exist are published, so the browser never offers
a voice that cannot run.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent

# group -> files.  "base" is the always-warm English/multilingual Kokoro model.
GROUPS = {
    "base": {"engine": "kokoro", "model": "models/kokoro-full.onnx", "voices": "models/voices.bin"},
    "de-kerstin": {"engine": "kokoro", "model": "models/kokoro-de/kokoro-kerstin.onnx",
                   "voices": "models/kokoro-de/voices-kerstin.npz"},
    "de-martin": {"engine": "kokoro", "model": "models/kokoro-de/kokoro-martin.onnx",
                  "voices": "models/kokoro-de/voices-martin.npz"},
    "piper-thorsten": {"engine": "piper", "model": "models/piper/de_DE-thorsten-high.onnx",
                       "config": "models/piper/de_DE-thorsten-high.onnx.json"},
}

LANGUAGES = {"de": "Deutsch", "en": "English", "fr": "Français", "es": "Español",
             "it": "Italiano", "pt": "Português"}
# Order in which languages appear in the picker.
ORDER = ["de", "en", "fr", "es", "it", "pt"]

# language, id, label, group, voice name inside the group, espeak language, note
_VOICES = [
    ("de", "kokoro:df_kerstin", "Kerstin", "de-kerstin", "kerstin", "de", "weiblich · Kokoro"),
    ("de", "kokoro:dm_martin", "Martin", "de-martin", "martin", "de", "männlich · Kokoro"),
    ("de", "piper:thorsten", "Thorsten", "piper-thorsten", None, "de", "männlich · Piper hoch"),
    ("en", "kokoro:af_bella", "Bella", "base", "af_bella", "en-us", "weiblich · US"),
    ("en", "kokoro:af_sarah", "Sarah", "base", "af_sarah", "en-us", "weiblich · US"),
    ("en", "kokoro:af_nicole", "Nicole", "base", "af_nicole", "en-us", "weiblich · US, leise"),
    ("en", "kokoro:am_adam", "Adam", "base", "am_adam", "en-us", "männlich · US"),
    ("en", "kokoro:am_michael", "Michael", "base", "am_michael", "en-us", "männlich · US"),
    ("en", "kokoro:bf_emma", "Emma", "base", "bf_emma", "en-gb", "weiblich · UK"),
    ("en", "kokoro:bm_george", "George", "base", "bm_george", "en-gb", "männlich · UK"),
    ("fr", "kokoro:ff_siwis", "Siwis", "base", "ff_siwis", "fr-fr", "weiblich"),
    ("es", "kokoro:ef_dora", "Dora", "base", "ef_dora", "es", "weiblich"),
    ("es", "kokoro:em_alex", "Alex", "base", "em_alex", "es", "männlich"),
    ("it", "kokoro:if_sara", "Sara", "base", "if_sara", "it", "weiblich"),
    ("it", "kokoro:im_nicola", "Nicola", "base", "im_nicola", "it", "männlich"),
    ("pt", "kokoro:pf_dora", "Dora", "base", "pf_dora", "pt-br", "weiblich · Brasilien"),
    ("pt", "kokoro:pm_alex", "Alex", "base", "pm_alex", "pt-br", "männlich · Brasilien"),
]
DEFAULTS = {"de": "kokoro:df_kerstin", "en": "kokoro:af_bella", "fr": "kokoro:ff_siwis",
            "es": "kokoro:ef_dora", "it": "kokoro:if_sara", "pt": "kokoro:pf_dora"}
FALLBACK_LANGUAGE = "en"


def voice_record(voice_id):
    for language, ident, label, group, name, espeak, note in _VOICES:
        if ident == voice_id:
            return {"id": ident, "language": language, "label": label, "group": group,
                    "name": name, "espeak": espeak, "note": note,
                    "engine": GROUPS[group]["engine"]}
    return None


def group_installed(group, root=ROOT):
    files = [value for key, value in GROUPS[group].items() if key != "engine"]
    return all((Path(root) / name).is_file() for name in files)


def catalog(root=ROOT):
    """Published catalog, as sent to the bar: only languages with a runnable voice."""
    result = []
    for code in ORDER:
        voices = []
        for language, ident, label, group, _name, _espeak, note in _VOICES:
            if language == code and group_installed(group, root):
                voices.append({"id": ident, "label": label, "engine": GROUPS[group]["engine"], "note": note})
        if voices:
            default = DEFAULTS[code] if any(v["id"] == DEFAULTS[code] for v in voices) else voices[0]["id"]
            result.append({"code": code, "label": LANGUAGES[code], "voices": voices, "default": default})
    return result


def catalog_version(entries):
    import hashlib, json
    digest = hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()
    return int(digest[:6], 16)


def language_codes(entries):
    return [entry["code"] for entry in entries]


def voice_for(entries, language, preferences=None):
    """Chosen voice id for ``language``: saved choice if still valid, else the default."""
    for entry in entries:
        if entry["code"] == language:
            ids = [voice["id"] for voice in entry["voices"]]
            wanted = (preferences or {}).get(language)
            return wanted if wanted in ids else entry["default"]
    return None


def valid_language_setting(value, entries):
    return value == "auto" or value in language_codes(entries)


def valid_voice(language, voice_id, entries):
    return any(entry["code"] == language and any(v["id"] == voice_id for v in entry["voices"])
               for entry in entries)


# Measured speaking rates at synthesis speed 1.0 (seconds per word of German prose, 85 words each):
# Kerstin 0.357, Martin 0.349, Thorsten 0.304; Bella is the established 165 wpm = 0.364.
def prior_seconds_per_word(voice_id):
    record = voice_record(voice_id)
    return 0.31 if record and record["engine"] == "piper" else 0.36
