"""Disk persistence and actual Tk/mpv speed across documents and app restarts."""
import json
import contextlib
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preferences import Preferences, speed_value, bar_value, axis_value
import player
import synthesis


class PreferencesTests(unittest.TestCase):
    def test_global_path_respects_xdg(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"XDG_CONFIG_HOME": folder}):
            first = Preferences()
            first.set_speed(3.25)
            self.assertEqual(Preferences().speed, 3.25)
            self.assertEqual(first.path, Path(folder) / "brave-reader/settings.json")

    def test_atomic_roundtrip_and_latest_wins(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "prefs/settings.json"
            preferences = Preferences(path)
            self.assertEqual(preferences.speed, 1)
            for speed in (2.5, 3, 3.25, 1):
                preferences.set_speed(speed)
                self.assertEqual(Preferences(path).speed, speed)
            self.assertEqual(json.loads(path.read_text()), {"speed": 1})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(path.parent.iterdir()), [path])

    def test_malformed_settings_fall_back(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "settings.json"
            for content in ('oops', '[]', '{}', '{"speed":true}', '{"speed":null}',
                            '{"speed":99}', '{"speed":NaN}', '{"speed":' + '9' * 1000 + '}'):
                path.write_text(content)
                self.assertEqual(Preferences(path).speed, 1, content[:40])

    def test_failed_replace_preserves_previous_setting(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "settings.json"
            preferences = Preferences(path)
            preferences.set_speed(2.5)
            with patch("preferences.os.replace", side_effect=OSError("test")):
                with self.assertRaises(OSError):
                    preferences.set_speed(3.5)
            self.assertEqual(preferences.speed, 2.5)
            self.assertEqual(Preferences(path).speed, 2.5)
            self.assertEqual(list(path.parent.iterdir()), [path])

    def test_bad_speed_rejected_and_supported_range(self):
        for value in (True, None, "bad", "nan", float("inf")):
            with self.assertRaises((TypeError, ValueError)):
                speed_value(value)
        self.assertEqual(speed_value(99), 4)
        self.assertEqual(speed_value(0), 0.8)
        self.assertEqual(speed_value(3.25), 3.25)


class BarPositionTests(unittest.TestCase):
    def test_default_bar_position(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(Preferences(Path(folder) / "settings.json").bar, {"x": 0.5, "y": 1.0})

    def test_bar_roundtrip_rounding_and_clamping(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "prefs/settings.json"
            preferences = Preferences(path)
            preferences.set_bar_position({"x": 0.123456, "y": 0.987654})
            self.assertEqual(Preferences(path).bar, {"x": 0.1235, "y": 0.9877})
            preferences.set_bar_position({"x": -5, "y": 5})
            self.assertEqual(Preferences(path).bar, {"x": 0.0, "y": 1.0})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_bad_bar_rejected(self):
        for value in (True, None, "bad", float("nan"), float("inf")):
            with self.assertRaises((TypeError, ValueError)):
                axis_value(value)
        for value in (None, "bad", [], {"x": 0.5}, {"y": 0.5}, {"x": True, "y": 0.5},
                      {"x": 0.5, "y": True}, {"x": float("nan"), "y": 0.5}, {"x": 0.5, "y": float("inf")}):
            with self.assertRaises((TypeError, ValueError)):
                bar_value(value)
        self.assertEqual(bar_value({"x": 2, "y": -3}), {"x": 1.0, "y": 0.0})

    def test_malformed_bar_in_settings_falls_back_to_default(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "settings.json"
            for content in ('{"bar":"oops"}', '{"bar":[1,2]}', '{"bar":{"x":true,"y":0.5}}',
                            '{"bar":{"x":0.5}}', '{"bar":{"x":2,"y":0.5}}',
                            '{"bar":{"x":0.5,"y":NaN}}'):
                path.write_text(content)
                self.assertEqual(Preferences(path).bar, {"x": 0.5, "y": 1.0}, content)

    def test_set_speed_does_not_erase_saved_bar_position_and_vice_versa(self):
        # Regression: the old set_speed rewrote the whole file with only
        # {"speed": ...}, silently discarding a previously saved bar position.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "settings.json"
            preferences = Preferences(path)
            preferences.set_bar_position({"x": 0.2, "y": 0.6})
            preferences.set_speed(3.0)
            reloaded = Preferences(path)
            self.assertEqual(reloaded.bar, {"x": 0.2, "y": 0.6})
            self.assertEqual(reloaded.speed, 3.0)
            reloaded.set_bar_position({"x": 0.9, "y": 0.1})
            final = Preferences(path)
            self.assertEqual(final.speed, 3.0)
            self.assertEqual(final.bar, {"x": 0.9, "y": 0.1})
            self.assertEqual(json.loads(path.read_text()),
                              {"speed": 3.0, "bar": {"x": 0.9, "y": 0.1}})

    def test_bar_short_circuits_when_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "settings.json"
            preferences = Preferences(path)
            preferences.set_bar_position({"x": 0.5, "y": 1.0})
            self.assertFalse(path.exists())


class DummyBridge:
    def __init__(self, events, *args):
        self.events = events

    def send(self, message):
        if message.get("type") == "attach":
            self.events.put((None, "browser", {"type": "attached", "ok": True}))

    def close(self):
        pass


class DummySynth:
    def __init__(self, *args):
        pass

    def render(self, text, path, cancelled):
        if cancelled.is_set():
            return None
        with wave.open(str(path), "wb") as output:
            output.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
            output.writeframes(b"\0\0" * 240000)
        return {"ok": True, "timings": []}

    def close(self):
        pass


def property_value(reading, name):
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(0.5)
        sock.connect(str(reading.ipc))
        sock.sendall((json.dumps({"command": ["get_property", name], "request_id": 1}) + "\n").encode())
        buffer = b""
        while True:
            data = sock.recv(4096)
            if not data:
                raise OSError("player closed")
            buffer += data
            while b"\n" in buffer:
                line, _, buffer = buffer.partition(b"\n")
                message = json.loads(line)
                if message.get("request_id") == 1:
                    return message.get("data")


class ReaderPreferencesTests(unittest.TestCase):
    def test_fallback_pdf_switch_restart_and_new_app_keep_speed(self):
        iteration_value = os.environ.get("BRAVE_PREFS_QA_ITERATION")
        if iteration_value is None:
            with tempfile.TemporaryDirectory(prefix="reader-prefs-", dir=player.runtime_dir()) as folder:
                Preferences(Path(folder) / "global-settings.json").set_speed(2.5)
                for iteration in range(2):
                    environment = {**os.environ, "BRAVE_PREFS_QA_ITERATION": str(iteration),
                                   "BRAVE_PREFS_QA_RUNTIME": folder}
                    result = subprocess.run([sys.executable, __file__,
                        "ReaderPreferencesTests.test_fallback_pdf_switch_restart_and_new_app_keep_speed"],
                        env=environment, capture_output=True, text=True, timeout=15)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(Preferences(Path(folder) / "global-settings.json").speed, 3.25)
            print(json.dumps({"ok": True, "global_speed": 3.25, "app_processes": 2,
                "document_playbacks": 4, "fallback_mapping": "preserved", "mpv_speed": "verified"}))
            return
        original_popen = subprocess.Popen
        processes = []

        def muted(args, *a, **kw):
            if args[0] == "mpv":
                args = [args[0], "--volume=0", *args[1:]]
            process = original_popen(args, *a, **kw)
            processes.append(process)
            return process

        def pump(app, predicate, timeout=4):
            deadline = time.monotonic() + timeout
            while not predicate():
                app.window.update()
                time.sleep(0.01)
                self.assertLess(time.monotonic(), deadline, app.status.get())

        with contextlib.nullcontext(os.environ["BRAVE_PREFS_QA_RUNTIME"]) as folder, \
                patch.object(player, "BrowserBridge", DummyBridge), \
                patch.object(synthesis, "SynthService", DummySynth), \
                patch.object(player.subprocess, "Popen", muted):
            runtime = Path(folder)
            preferences_path = runtime / "global-settings.json"
            for iteration in (int(iteration_value),):
                server = socket.socket(socket.AF_UNIX)
                control = runtime / f"control-{iteration}.sock"
                server.bind(str(control))
                server.listen(8)
                app = player.Reader(runtime, server, watch_browser=False, preferences_path=preferences_path)
                try:
                    expected = 2.5 if iteration == 0 else 3.25
                    self.assertEqual(app.rate, expected)
                    app.window.update()
                    self.assertEqual(app.rate, expected, "Mapping fallback reset saved speed")
                    app.browser_event({"type": "command", "command": "speed", "value": 3.25})
                    # A newly mapped Tk scale used to deliver an obsolete 1x value.
                    app.window.withdraw()
                    app.window.update()
                    self.assertEqual(app.rate, 3.25)
                    self.assertEqual(app.speed_scale.get(), 3.25)
                    for document_number in (1, 2):
                        context = {"kind": "pdf", "url": "local-qa", "targetId": str(document_number)}
                        before_context = app.browser_context
                        app.events.put((None, "browser_watch", {"type": "context", "context": context}))
                        pump(app, lambda: app.watched_context == context)
                        self.assertEqual(app.browser_context, before_context, "Watching must not auto-open a reader")
                        app.attach_context(context)
                        pump(app, lambda: app.browser_context == context)
                        document = {"title": "Public speed QA", "context": context,
                                    "chunks": [{"text": "Public speed test.", "page": 1, "words": []}]}
                        app.restart(document)
                        pump(app, lambda: app.reading is not None and app.reading.ipc is not None
                             and app.reading.ipc.exists())
                        pump(app, lambda: property_value(app.reading, "speed") == 3.25)
                        app.toggle()
                        self.assertTrue(app.reading.paused)
                        app.toggle()
                        self.assertEqual(app.rate, 3.25)
                        app.stop()
                        self.assertEqual(Preferences(preferences_path).speed, 3.25)
                finally:
                    app.close()
            for process in processes:
                process.wait(timeout=3)
            self.assertTrue(all(process.poll() is not None for process in processes))


if __name__ == "__main__":
    unittest.main()
