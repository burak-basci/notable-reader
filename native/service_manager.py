#!/usr/bin/env python3
"""Install and operate the local reader without loading its model in clients."""
from __future__ import annotations

import argparse
import datetime
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import stat
import subprocess
import sys
import time
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler

ROOT = Path(__file__).resolve().parent
UNIT = "brave-reader.service"


def systemctl(*arguments, check=True):
    return subprocess.run(["systemctl", "--user", *arguments], check=check,
                          capture_output=True, text=True, timeout=15)


def control(payload, timeout=1):
    runtime = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    directory = runtime / "brave-reader"
    endpoint = directory / "control.sock"
    for path in (runtime, directory, endpoint):
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid():
            raise OSError("Unsicheres Laufzeitverzeichnis.")
    if not stat.S_ISSOCK(endpoint.stat().st_mode) or endpoint.stat().st_mode & 0o077:
        raise OSError("Unsicherer Steuerkanal.")
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(timeout)
        connection.connect(str(endpoint))
        connection.sendall((payload + "\n").encode())
        parts = bytearray()
        while len(parts) < 65536:
            part = connection.recv(min(4096, 65536 - len(parts)))
            if not part:
                break
            parts.extend(part)
            if b"\n" in part:
                break
        return bytes(parts)


def run_command(command):
    if command == "stop" and systemctl("is-active", "--quiet", UNIT, check=False).returncode:
        return
    if command != "stop":
        systemctl("start", UNIT)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            ready = json.loads(control('{"type":"model_status"}', timeout=0.7))
            if ready.get("ok"):
                if command == "background" or control(command).startswith(b"ok"):
                    return
        except (OSError, ValueError):
            pass
        time.sleep(0.1)
    raise RuntimeError("Vorlesedienst antwortet nicht. Diagnose: brave-read doctor")


def replace_private(path, text, mode):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink():
        raise RuntimeError(f"Zieldatei ist eine Verknüpfung: {path.name}")
    if path.exists() and path.read_text() == text:
        return False
    if path.exists():
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = path.with_name(path.name + ".bak-" + stamp)
        shutil.copyfile(path, backup)
        backup.chmod(0o600)
    temporary = path.with_name(path.name + f".tmp-{os.getpid()}")
    try:
        with temporary.open("x", encoding="utf-8") as output:
            os.chmod(temporary, mode)
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def systemd_quote(path):
    return '"' + str(path).replace("%", "%%").replace("\\", "\\\\").replace('"', '\\"') + '"'


def install():
    python = ROOT / "venv/bin/python"
    missing = [name for name in ("systemctl", "node", "mpv") if not shutil.which(name)]
    if not python.is_file():
        missing.append("Reader-Python (venv/bin/python)")
    if missing:
        raise RuntimeError("Fehlende Voraussetzungen: " + ", ".join(missing))
    config = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    unit = config / "systemd/user" / UNIT
    content = f'''[Unit]
Description=Brave offline reader
After=graphical-session.target
PartOf=graphical-session.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory={str(ROOT).replace('%', '%%')}
ExecStart={systemd_quote(python)} {systemd_quote(ROOT / "player.py")} background
Environment=MALLOC_ARENA_MAX=2
Environment=MALLOC_TRIM_THRESHOLD_=131072
UMask=0077
Restart=always
RestartSec=5s
TimeoutStopSec=15s

[Install]
WantedBy=graphical-session.target
'''
    launcher = Path.home() / ".local/bin/brave-read"
    wrapper = "#!/bin/sh\nexec " + shlex.quote(str(python)) + " " + shlex.quote(str(ROOT / "service_manager.py")) + ' "$@"\n'
    # Public setup must not take over another installed companion.
    for target, expected in ((unit, content), (launcher, wrapper)):
        if target.is_symlink() or target.exists() and target.read_text() != expected:
            raise RuntimeError("Bestehender Vorlesedienst/Starter bleibt erhalten. Einen eigenen Installationspfad verwenden.")
    changed = replace_private(unit, content, 0o600)
    changed = replace_private(launcher, wrapper, 0o755) or changed
    systemctl("daemon-reload")
    systemctl("enable", UNIT)
    print("Autostart eingerichtet." if changed else "Autostart bereits aktuell.")
    print("Start beim nächsten Desktop-Login. Sofort starten: brave-read background")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def doctor(as_json=False):
    enabled = systemctl("is-enabled", "--quiet", UNIT, check=False).returncode == 0
    active = systemctl("is-active", "--quiet", UNIT, check=False).returncode == 0
    model = None
    health = None
    if active:
        try:
            response = json.loads(control('{"type":"model_status"}'))
            if response.get("ok"):
                value = response.get("model", {})
                model = {key: value.get(key) for key in ("ready", "loads", "providers", "loadSeconds")}
                report = response.get("health")
                if isinstance(report, dict):
                    health = {key: report.get(key) is True for key in ("extensionApi", "bridge", "watcher")}
        except (OSError, ValueError):
            pass
    cdp = False
    try:
        # Never inherit proxy credentials or fetch document titles/URLs.
        opener = build_opener(ProxyHandler({}), NoRedirect())
        with opener.open("http://127.0.0.1:9333/json/version", timeout=1) as response:
            value = json.loads(response.read(65536))
            cdp = isinstance(value, dict) and isinstance(value.get("Browser"), str)
    except (OSError, ValueError):
        pass
    state = {"autostart": enabled, "service_active": active,
             "control_ready": model is not None, "browser_connection": cdp, "model": model,
             "components": health}
    if as_json:
        print(json.dumps(state, ensure_ascii=False))
    else:
        print("Autostart: " + ("aktiviert" if enabled else "fehlt"))
        print("Hintergrundleser: " + ("läuft" if active else "beendet"))
        print("Steuerkanal: " + ("bereit" if model is not None else "nicht bereit"))
        print("Browserverbindung: " + ("erreichbar" if cdp else "nicht erreichbar"))
        if model is not None:
            print("Stimme: " + ("bereit" if model.get("ready") else "wird vorbereitet"))
            print("Rechengerät: " + ", ".join(model.get("providers") or []))
        if health is not None:
            for key, label in (("extensionApi", "Erweiterungsanschluss"), ("bridge", "Browsersteuerung"),
                               ("watcher", "Dokumenterkennung")):
                print(label + ": " + ("bereit" if health[key] else "nicht bereit"))
        if not enabled:
            print("Einrichten: brave-read install")
        if not active:
            print("Starten: brave-read background")
        elif model is None:
            print("Protokoll: journalctl --user -u brave-reader.service -n 40")
    return 0 if (active and model is not None and model.get("ready") is True and cdp
                 and health is not None and all(health.values())) else 1


def main():
    parser = argparse.ArgumentParser(description="Lokalen Vorleser einrichten und steuern")
    parser.add_argument("command", nargs="?", default="show",
                        choices=("show", "toggle", "restart", "stop", "background", "doctor", "install"))
    parser.add_argument("--json", action="store_true", help="Diagnose als JSON")
    args = parser.parse_args()
    if args.json and args.command != "doctor":
        parser.error("--json ist nur für doctor verfügbar")
    try:
        if args.command == "doctor":
            return doctor(args.json)
        if args.command == "install":
            install()
        else:
            run_command(args.command)
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        # Captured systemd output can include private paths; don't dump it.
        print(str(error) if isinstance(error, RuntimeError) else
              "Vorleser konnte nicht gesteuert werden. Diagnose: brave-read doctor", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
