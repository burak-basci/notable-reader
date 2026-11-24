#!/usr/bin/env python3
"""Gebäudezustand: misst, was ein Commit an Wartbarkeit verändert.

Kein Vollscan der Codebasis, sondern der Diff: nur die Python-Dateien, die
zwischen Basis und Kopf angefasst wurden, werden verglichen. Altbestand wird
nie bewertet — sonst blockiert die erste Altlast für immer.

Gemessen wird, was die SlopCodeBench als "strukturelle Erosion" definiert:
Komplexität (zyklomatische Komplexität, CC) sammelt sich in wenigen großen
Funktionen. Ein Commit, der eine Funktion von CC 7 auf 19 wachsen lässt, ist
grün in allen Tests und trotzdem ein Rückschritt.

Aufrufer:
  1. Pipeline (blockiert):  python tools/gesundheit.py --basis <sha> --kopf <sha>
  2. Vor dem Push (schnell): python tools/gesundheit.py            (origin/main als Basis)
  3. Im Agenten-Lauf:        python tools/gesundheit.py --seit origin/main
  4. Hook einrichten:        python tools/gesundheit.py hook install

Ausweg (protokolliert, nicht still): eine Zeile in der Commit-Nachricht des
Kopf-Commits
    # gesundheit-ok: <Grund>
Hebt den Block auf, wird aber als "begründet" ausgegeben.

Exit: 0 = ok/warn, 2 = block, 1 = Werkzeugfehler (blockiert nie die Pipeline).
Nur Standardbibliothek, damit kein CI-Container eine Installation braucht.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

# ── Schwellen (bewusst konservativ, nur für das, was der Commit verursacht) ──
CC_BLOCK_NEU = 15      # neue Funktion über 15: zu groß für einen ersten Wurf
CC_WARN_NEU = 11
CC_BLOCK_WACHSTUM = 8  # bestehende Funktion um mehr als 8 gewachsen
CC_WARN_WACHSTUM = 4
DUP_BLOCK_ZEILEN = 40  # neu duplizierte Zeilen je Datei
DUPLIKAT_BLOCK = 6     # Zeilen je erkanntem Duplikatblock
KLEIN = 3              # kürzere Zeilen zählen nicht als Duplikat

# ── TypeScript/JavaScript: oxlint statt eigener Parser ──────────────────────
# oxlint hat keine CC-Regel, aber Länge je Funktion und Verschachtelungstiefe —
# beides sind die Treiber, die die SlopCodeBench als Erosion misst. Ehrlich
# benannt: das ist Länge und Tiefe, nicht zyklomatische Komplexität.
TS_ENDUNGEN = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
OXLINT_VERSION = "1.23.0"
TS_MAX_ZEILEN = 80       # .ts/.js: Logik
TS_MAX_ZEILEN_JSX = 120  # .tsx/.jsx: JSX blaeht Zeilen auf, ohne Komplexitaet
TS_MAX_TIEFE = 4
TS_WACHSTUM = 25   # eine Funktion darf wachsen, nur nicht in einem Schritt


def git(*args: str, cwd: str | None = None) -> str:
    out = subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=False
    )
    if out.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {out.stderr.strip()}")
    return out.stdout


# ── Komplexität ──────────────────────────────────────────────────────────────

_VERZWEIGUNG = (
    ast.If, ast.IfExp, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler,
    ast.Assert, ast.With, ast.AsyncWith,
)


def _cc_knoten(knoten: ast.AST) -> int:
    """Radon-kompatibel genug: +1 je Verzweigung, BoolOp je zusätzlichem Operand."""
    if isinstance(knoten, _VERZWEIGUNG):
        return 1
    if isinstance(knoten, ast.BoolOp):
        return max(0, len(knoten.values) - 1)
    if isinstance(knoten, ast.comprehension):
        return 1 + len(knoten.ifs)
    if isinstance(knoten, ast.Match):
        return len(knoten.cases)
    return 0


def komplexitaet(quelle: str) -> dict[str, tuple[int, int]]:
    """{qualifizierter Name: (cc, zeilen)} je Funktion/Methode der Datei."""
    try:
        baum = ast.parse(quelle)
    except SyntaxError:
        return {}
    ergebnis: dict[str, tuple[int, int]] = {}

    def lauf(knoten: ast.AST, praefix: str) -> None:
        for kind in ast.iter_child_nodes(knoten):
            if isinstance(kind, (ast.FunctionDef, ast.AsyncFunctionDef)):
                name = f"{praefix}{kind.name}"
                cc = 1 + sum(_cc_knoten(k) for k in ast.walk(kind))
                # Verschachtelte Funktionsdefinitionen nicht doppelt zählen
                for unter in ast.walk(kind):
                    if unter is kind:
                        continue
                    if isinstance(unter, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        cc -= 1 + sum(_cc_knoten(k) for k in ast.walk(unter))
                zeilen = (kind.end_lineno or kind.lineno) - kind.lineno + 1
                ergebnis[name] = (max(cc, 1), zeilen)
                lauf(kind, f"{name}.")
            else:
                lauf(kind, praefix)

    lauf(baum, "")
    return ergebnis


# ── Duplikate ────────────────────────────────────────────────────────────────

def _normalisiert(zeile: str) -> str:
    return re.sub(r"\s+", "", zeile)


def duplikat_zeilen(quelle: str) -> int:
    """Zeilen, die in einem Block >= DUPLIKAT_BLOCK identisch woanders stehen."""
    zeilen = [_normalisiert(z) for z in quelle.splitlines()]
    zeilen = [z for z in zeilen if len(z) > KLEIN and z not in ("pass", "return")]
    gesehen: dict[str, list[int]] = {}
    for i in range(len(zeilen) - DUPLIKAT_BLOCK + 1):
        block = "\n".join(zeilen[i:i + DUPLIKAT_BLOCK])
        gesehen.setdefault(hashlib.sha1(block.encode()).hexdigest(), []).append(i)
    doppelt: set[int] = set()
    for stellen in gesehen.values():
        if len(stellen) > 1:
            for start in stellen:
                doppelt.update(range(start, start + DUPLIKAT_BLOCK))
    return len(doppelt)


# ── Diff-Auswertung ──────────────────────────────────────────────────────────

def datei_inhalt(ref: str, pfad: str, cwd: str) -> str | None:
    if ref in ("", "ARBEITSBAUM"):
        voll = os.path.join(cwd, pfad)
        if not os.path.isfile(voll):
            return None
        with open(voll, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    try:
        return git("show", f"{ref}:{pfad}", cwd=cwd)
    except RuntimeError:
        return None


def begruendung(kopf: str, cwd: str) -> str | None:
    try:
        nachricht = git("log", "-1", "--format=%B", kopf, cwd=cwd)
    except RuntimeError:
        return None
    treffer = re.search(r"^#\s*gesundheit-ok:\s*(.+)$", nachricht, re.MULTILINE)
    return treffer.group(1).strip() if treffer else None


def basis_ermitteln(seit: str | None, kopf: str) -> str:
    """Merge-Base mit dem Ziel; ohne Upstream das Vorcommit; ohne das der leere Baum.

    Ein nicht auflösbarer Ref blockiert nie — er fällt auf die nächste Stufe
    zurück. Sonst wäre der Hook in einem frischen Klon blind.
    """
    kandidaten = [seit] if seit else []
    kandidaten += ["origin/main", "HEAD~1"]
    for kandidat in kandidaten:
        try:
            merge = git("merge-base", kandidat, kopf).strip()
            if merge:
                return merge
        except RuntimeError:
            continue
    leer = git("hash-object", "-t", "tree", "/dev/null").strip()
    return leer


def diff_zeilen(basis: str, kopf: str, pfad: str, cwd: str) -> set[int]:
    """Zeilennummern der Kopfseite, die der Diff in dieser Datei berührt."""
    try:
        aus = git("diff", "-U0", basis, kopf, "--", pfad, cwd=cwd)
    except RuntimeError:
        return set()
    zeilen: set[int] = set()
    for treffer in re.finditer(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", aus, re.MULTILINE):
        start, anzahl = int(treffer.group(1)), int(treffer.group(2) or 1)
        zeilen.update(range(start, start + anzahl))
    return zeilen


def _oxlint(pfade: list[str], regeln: dict, cwd: str) -> tuple[list[dict], str | None]:
    """oxlint auf eine Dateigruppe; nur die übergebenen Regeln zählen."""
    if not pfade:
        return [], None
    with tempfile.TemporaryDirectory() as tmp:
        config = os.path.join(tmp, "oxlintrc.json")
        with open(config, "w", encoding="utf-8") as fh:
            json.dump({"rules": regeln}, fh)
        lauf = subprocess.run(
            ["npx", "--yes", f"oxlint@{OXLINT_VERSION}", "--format=json",
             "--config", config, "--no-ignore", *pfade],
            cwd=cwd, capture_output=True, text=True, check=False,
        )
    if lauf.returncode not in (0, 1):
        return [], f"oxlint nicht verfügbar (Exit {lauf.returncode})"
    try:
        return json.loads(lauf.stdout).get("diagnostics", []), None
    except json.JSONDecodeError:
        return [], "oxlint-Ausgabe nicht lesbar"


def _grenze(pfad: str) -> int:
    return TS_MAX_ZEILEN_JSX if pfad.endswith((".tsx", ".jsx")) else TS_MAX_ZEILEN


def _laengen(pfade: list[str], cwd: str) -> tuple[dict[str, dict[str, int]], str | None]:
    """{Datei: {Funktion: Zeilen}} — max=1 meldet jede Funktion mit ihrer Größe."""
    diagnosen, fehler = _oxlint(pfade, {"eslint/max-lines-per-function": ["error", {
        "max": 1, "skipBlankLines": True, "skipComments": True,
    }]}, cwd)
    groessen: dict[str, dict[str, int]] = {}
    for d in diagnosen:
        if "max-lines-per-function" not in d.get("code", ""):
            continue
        datei = d.get("filename") or ""
        treffer = re.search(r"`([^`]+)` has too many lines \((\d+)\)", d.get("message", ""))
        if datei and treffer:
            groessen.setdefault(datei, {})[treffer.group(1)] = int(treffer.group(2))
    return groessen, fehler


def _basis_laengen(basis: str, pfade: list[str], cwd: str) -> dict[str, dict[str, int]]:
    """Größen der Funktionen im Basisstand, in einem temporären Baum gemessen."""
    with tempfile.TemporaryDirectory() as tmp:
        kopiert = []
        for pfad in pfade:
            inhalt = datei_inhalt(basis, pfad, cwd)
            if inhalt is None:
                continue
            ziel = os.path.join(tmp, pfad)
            os.makedirs(os.path.dirname(ziel) or tmp, exist_ok=True)
            with open(ziel, "w", encoding="utf-8") as fh:
                fh.write(inhalt)
            kopiert.append(pfad)
        groessen, _ = _laengen(kopiert, tmp)
    return groessen


def _tiefe(pfade: list[str], bereiche: dict[str, set[int]], cwd: str) -> list[str]:
    """Verschachtelung nur dort, wo der Diff die Zeile anfasst."""
    diagnosen, _ = _oxlint(pfade, {"eslint/max-depth": ["error", {"max": TS_MAX_TIEFE}]}, cwd)
    befunde = []
    for d in diagnosen:
        if "max-depth" not in d.get("code", ""):
            continue
        datei = d.get("filename") or ""
        zeile = ((d.get("labels") or [{}])[0].get("span") or {}).get("line") or 0
        if zeile and zeile in bereiche.get(datei, set()):
            befunde.append(
                f"{datei}:{zeile}: Verschachtelung zu tief (Grenze {TS_MAX_TIEFE}) "
                f"— teile die Funktion oder begründe"
            )
    return befunde


def ts_befunde(basis: str, pfade: list[str], bereiche: dict[str, set[int]],
               cwd: str) -> tuple[list[str], str | None]:
    """Nur was der Commit verursacht: neue Funktionen und gewachsene.

    Ein Bestandsbefund (122 Zeilen, seit Monaten) blockiert nicht — sonst wäre
    jede Berührung einer großen Komponente ein Fehler.
    """
    if not pfade:
        return [], None
    kopf, fehler = _laengen(pfade, cwd)
    basis_groessen = _basis_laengen(basis, pfade, cwd)
    befunde = []
    for datei, funktionen in kopf.items():
        for name, zeilen in funktionen.items():
            grenze = _grenze(datei)
            alt = basis_groessen.get(datei, {}).get(name, 0)
            if zeilen > grenze and zeilen - alt > TS_WACHSTUM:
                herkunft = f"war {alt}" if alt else "neu"
                befunde.append(
                    f"{datei}: {name}() hat {zeilen} Zeilen ({herkunft}, Grenze {grenze}) "
                    f"— teilen oder begründen"
                )
    befunde.extend(_tiefe(pfade, bereiche, cwd))
    return befunde, fehler


def _funktionen_bewerten(pfad: str, alt_fn: dict, neu_fn: dict,
                         befunde: list, warnungen: list) -> int:
    """Vergleicht die Funktionen einer Datei; gibt den CC-Zuwachs zurück."""
    zuwachs_summe = 0
    for name, (cc_neu, zeilen) in sorted(neu_fn.items()):
        cc_alt = alt_fn.get(name, (0, 0))[0]
        if cc_alt == 0:
            if cc_neu > CC_BLOCK_NEU:
                befunde.append(
                    f"{pfad}: neue Funktion {name}() hat CC {cc_neu} "
                    f"({zeilen} Zeilen) — teile sie nach Aufgabe oder begründe"
                )
            elif cc_neu > CC_WARN_NEU:
                warnungen.append(f"{pfad}: neue Funktion {name}() hat CC {cc_neu}")
            continue
        zuwachs = cc_neu - cc_alt
        zuwachs_summe += max(zuwachs, 0)
        if zuwachs > CC_BLOCK_WACHSTUM:
            befunde.append(
                f"{pfad}: {name}() wuchs von CC {cc_alt} auf {cc_neu} "
                f"(+{zuwachs}) — neue Fälle in eigene Funktionen ziehen oder begründen"
            )
        elif zuwachs > CC_WARN_WACHSTUM:
            warnungen.append(f"{pfad}: {name}() wuchs von CC {cc_alt} auf {cc_neu}")
    return zuwachs_summe


def _python_bewerten(basis: str, kopf: str, pfade: list[str], cwd: str,
                     befunde: list, warnungen: list) -> dict:
    zahlen = {"dateien": 0, "cc_plus": 0, "dup_plus": 0}
    for pfad in pfade:
        neu = datei_inhalt(kopf, pfad, cwd)
        if neu is None:
            continue  # gelöscht: Erosion sinkt, nichts zu melden
        alt = datei_inhalt(basis, pfad, cwd) or ""
        zahlen["dateien"] += 1
        zahlen["cc_plus"] += _funktionen_bewerten(
            pfad, komplexitaet(alt), komplexitaet(neu), befunde, warnungen
        )
        zahlen["dup_plus"] += _duplikat_bewerten(pfad, alt, neu, befunde)
    return zahlen


def _ts_bewerten(basis: str, kopf: str, pfade: list[str], cwd: str,
                 befunde: list, warnungen: list) -> dict:
    zahlen = {"dateien": 0, "dup_plus": 0}
    bereiche = {}
    for pfad in pfade:
        neu = datei_inhalt(kopf, pfad, cwd)
        if neu is None:
            continue
        alt = datei_inhalt(basis, pfad, cwd) or ""
        zahlen["dateien"] += 1
        zahlen["dup_plus"] += _duplikat_bewerten(pfad, alt, neu, befunde)
        bereiche[pfad] = diff_zeilen(basis, kopf, pfad, cwd)
    ts_funde, fehler = ts_befunde(basis, pfade, bereiche, cwd)
    befunde.extend(ts_funde)
    if fehler:
        warnungen.append(f"{fehler} — TypeScript/JavaScript nicht geprüft")
    return zahlen


def _duplikat_bewerten(pfad: str, alt: str, neu: str, befunde: list) -> int:
    zuwachs = duplikat_zeilen(neu) - duplikat_zeilen(alt)
    if zuwachs > DUP_BLOCK_ZEILEN:
        befunde.append(f"{pfad}: {zuwachs} Zeilen neu dupliziert — gemeinsamen Teil herausziehen")
        return zuwachs
    return 0


def _pruefenswert(pfad: str) -> bool:
    """Tests und generierte Dateien fliegen raus: dort sind lange Funktionen normal."""
    teile = pfad.split("/")
    if {"tests", "__tests__", "testdata"} & set(teile[:-1]):
        return False
    if pfad.endswith((".d.ts", ".gen.ts", ".generated.ts", ".min.js")):
        return False
    name = teile[-1]
    return not (name.startswith("test_") or ".test." in name or ".spec." in name)


def auswerten(basis: str, kopf: str, cwd: str) -> dict:
    geaendert = git("diff", "--name-only", "--diff-filter=ACMR", basis, kopf, cwd=cwd).splitlines()
    ohne_tests = [p for p in geaendert if _pruefenswert(p)]
    python_pfade = [p for p in ohne_tests if p.endswith(".py")]
    ts_pfade = [p for p in ohne_tests if p.endswith(TS_ENDUNGEN)]
    befunde, warnungen = [], []
    zahlen = {"dateien": 0, "cc_plus": 0, "dup_plus": 0}
    for teil in (
        _python_bewerten(basis, kopf, python_pfade, cwd, befunde, warnungen),
        _ts_bewerten(basis, kopf, ts_pfade, cwd, befunde, warnungen),
    ):
        zahlen["dateien"] += teil["dateien"]
        zahlen["dup_plus"] += teil["dup_plus"]
        zahlen["cc_plus"] += teil.get("cc_plus", 0)
    grund = begruendung(kopf, cwd) if befunde else None
    return {
        "basis": basis, "kopf": kopf, "zahlen": zahlen,
        "block": [] if grund else befunde,
        "begruendet": befunde if grund else [],
        "grund": grund, "warnungen": warnungen,
    }


# ── Ausgabe ──────────────────────────────────────────────────────────────────

def melden(ergebnis: dict, als_json: bool, still: bool) -> int:
    if als_json:
        print(json.dumps(ergebnis, ensure_ascii=False))
    if still:
        return 2 if ergebnis["block"] else 0
    art = "BLOCK" if ergebnis["block"] else ("BEGRÜNDET" if ergebnis["begruendet"] else "OK")
    print(f"Gebäudezustand: {art}  ({ergebnis['kopf'][:12]})")
    for zeile in ergebnis["block"]:
        print(f"  ✗ {zeile}")
    for zeile in ergebnis["begruendet"]:
        print(f"  · begründet ({ergebnis['grund']}): {zeile}")
    for zeile in ergebnis["warnungen"]:
        print(f"  ! {zeile}")
    z = ergebnis["zahlen"]
    print(f"  {z['dateien']} Datei(en) geprüft, +{z['cc_plus']} CC, +{z['dup_plus']} Duplikatzeilen")
    if ergebnis["block"]:
        print("  → Reparieren oder in die Commit-Nachricht:  # gesundheit-ok: <Grund>")
    return 2 if ergebnis["block"] else 0


# ── Selbsttest: die Zahl muss rot werden können ──────────────────────────────

SCHLECHT = '''\
def verarbeiten(a, b, c, d, e, f, g, h):
    if a:
        return 1
    elif b:
        return 2
    elif c:
        return 3
    elif d:
        return 4
    elif e:
        return 5
    elif f:
        return 6
    elif g:
        return 7
    elif h:
        return 8
    elif a and b:
        return 9
    elif c or d:
        return 10
    elif e and f or g:
        return 11
    for i in range(a):
        while i < b:
            try:
                if c:
                    return 12
            except ValueError:
                return 13
            finally:
                pass
    return 14
'''


def _lange_funktion(name: str, zeilen: int) -> str:
    """TSX-Funktion mit genau `zeilen` Zeilen, ohne echte Komplexität."""
    rumpf = [f"export function {name}() {{", "  const a = 1;"]
    while len(rumpf) < zeilen - 2:
        rumpf.append(f"  const v{len(rumpf)} = a + {len(rumpf)};")
    rumpf += ["  return a;", "}"]
    return "\n".join(rumpf) + "\n"


def _selbsttest_ts() -> list[tuple[str, bool]]:
    """Zwei TS-Fälle: neue lange Funktion blockiert, Bestand nicht."""
    if shutil.which("npx") is None:
        return [("TS übersprungen (kein npx)", True)]
    with tempfile.TemporaryDirectory() as tmp:
        git("init", "-q", cwd=tmp)
        git("config", "user.email", "t@t", cwd=tmp)
        git("config", "user.name", "t", cwd=tmp)
        with open(os.path.join(tmp, "komp.tsx"), "w") as fh:
            fh.write(_lange_funktion("Bestand", 130))
        git("add", "-A", cwd=tmp)
        git("commit", "-qm", "bestand", cwd=tmp)
        basis = git("rev-parse", "HEAD", cwd=tmp).strip()
        # Fall 1: neue lange Funktion dazu
        with open(os.path.join(tmp, "komp.tsx"), "a") as fh:
            fh.write("\n" + _lange_funktion("Neu", 130))
        git("add", "-A", cwd=tmp)
        git("commit", "-qm", "neu", cwd=tmp)
        frisch = auswerten(basis, git("rev-parse", "HEAD", cwd=tmp).strip(), tmp)
        # Fall 2: nur eine Zeile im Bestand geändert, keine neue Funktion
        with open(os.path.join(tmp, "komp.tsx"), "a") as fh:
            fh.write("\nconst rand = 2;\n")
        git("add", "-A", cwd=tmp)
        git("commit", "-qm", "beruehrt", cwd=tmp)
        beruehrt = auswerten(
            git("rev-parse", "HEAD~1", cwd=tmp).strip(),
            git("rev-parse", "HEAD", cwd=tmp).strip(), tmp,
        )
    return [
        ("neue lange TS-Funktion blockiert", any("Neu()" in b for b in frisch["block"])),
        ("Bestandsfunktion 130 Zeilen blockiert nicht", not any("Bestand()" in b for b in beruehrt["block"])),
    ]


def selbsttest() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        git("init", "-q", cwd=tmp)
        git("config", "user.email", "t@t", cwd=tmp)
        git("config", "user.name", "t", cwd=tmp)
        os.makedirs(os.path.join(tmp, "pkg"))
        gueter = os.path.join(tmp, "pkg", "gut.py")
        with open(gueter, "w") as fh:
            fh.write("def eins():\n    return 1\n")
        git("add", "-A", cwd=tmp)
        git("commit", "-qm", "gut", cwd=tmp)
        basis = git("rev-parse", "HEAD", cwd=tmp).strip()
        with open(gueter, "w") as fh:
            fh.write(SCHLECHT)
        git("add", "-A", cwd=tmp)
        git("commit", "-qm", "schlecht", cwd=tmp)
        kopf = git("rev-parse", "HEAD", cwd=tmp).strip()
        schmutzig = auswerten(basis, kopf, tmp)
        sauber = auswerten(basis, basis, tmp)
        # Gegenprobe mit Begründung
        git("commit", "-q", "--allow-empty", "-m", "schlecht\n\n# gesundheit-ok: bewusst", cwd=tmp)
        begruendet = auswerten(basis, git("rev-parse", "HEAD", cwd=tmp).strip(), tmp)
    faelle = [
        ("verschlechterter Commit wird BLOCK", bool(schmutzig["block"])),
        ("unveränderter Stand ist OK", not sauber["block"] and not sauber["begruendet"]),
        ("# gesundheit-ok hebt auf", not begruendet["block"] and bool(begruendet["begruendet"])),
    ]
    faelle += _selbsttest_ts()
    for name, ok in faelle:
        print(f"  {'✓' if ok else '✗'} {name}")
    return 0 if all(ok for _, ok in faelle) else 1


# ── Hook ─────────────────────────────────────────────────────────────────────

HOOK = """#!/bin/sh
# Gebäudezustand vor dem Push (eingerichtet von tools/gesundheit.py).
# Nur aktiv, wenn .gesundheit.toml im Repo liegt; blockiert nur bei Befund.
[ -f .gesundheit.toml ] || exit 0
# Vergleichsbasis ist main, nicht der eigene Upstream: nach einem Rebase
# (oder auf einem Zweig mit vielen Commits) wuerde der Upstream sonst die
# halbe Historie als "neu" melden.
python3 tools/gesundheit.py --seit origin/main
[ $? -eq 2 ] && exit 1
exit 0
"""


def hook(aktion: str) -> int:
    # --git-path liefert bei Worktrees den gemeinsamen Hooks-Ordner; ein
    # selbst gebauter Pfad aus --git-dir zeigt dort ins Leere.
    ziel = git("rev-parse", "--git-path", "hooks/pre-push").strip()
    if not os.path.isabs(ziel):
        ziel = os.path.join(os.getcwd(), ziel)
    if aktion == "install":
        os.makedirs(os.path.dirname(ziel), exist_ok=True)
        if os.path.exists(ziel) and "gesundheit.py" not in open(ziel, encoding="utf-8").read():
            print(f"Vorhandener Hook bleibt unangetastet: {ziel}", file=sys.stderr)
            return 1
        with open(ziel, "w", encoding="utf-8") as fh:
            fh.write(HOOK)
        os.chmod(ziel, 0o755)
        print(f"pre-push eingerichtet: {ziel}\nAktiv nur mit .gesundheit.toml im Repo.")
        return 0
    if aktion == "uninstall":
        if os.path.exists(ziel) and "gesundheit.py" in open(ziel, encoding="utf-8").read():
            os.remove(ziel)
            print("pre-push entfernt.")
        else:
            print("Kein von gesundheit.py eingerichteter Hook gefunden.")
        return 0
    print("hook install|uninstall", file=sys.stderr)
    return 1


# ── Einstieg ─────────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser(description="Gebäudezustand eines Commits prüfen")
    p.add_argument("--basis", help="Vergleichsbasis (SHA oder Ref)")
    p.add_argument("--kopf", default="HEAD", help="zu prüfender Commit (Standard HEAD)")
    p.add_argument("--seit", dest="seit", help="Kurzform: Basis = Merge-Base mit diesem Ref")
    p.add_argument("--json", action="store_true", help="Maschinenlesbare Zeile ausgeben")
    p.add_argument("--still", action="store_true", help="Nur Exit-Code, keine Ausgabe")
    p.add_argument("--selbsttest", action="store_true", help="Negativprobe ausführen")
    p.add_argument("unterbefehl", nargs="?", choices=["hook"], help="hook install|uninstall")
    p.add_argument("argument", nargs="?", help="install oder uninstall")
    a = p.parse_args()

    try:
        if a.selbsttest:
            return selbsttest()
        if a.unterbefehl == "hook":
            return hook(a.argument or "install")
        basis = basis_ermitteln(a.seit, a.kopf)
        if a.basis:
            basis = a.basis
        return melden(auswerten(basis, a.kopf, os.getcwd()), a.json, a.still)
    except Exception as fehler:  # Werkzeugfehler blockieren nie die Pipeline
        if not a.still:
            print(f"Gebäudezustand nicht messbar ({fehler}) — gilt als bestanden.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
