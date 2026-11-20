# beNotable! Reader

Deutsch · [English](#english)

Webseiten, PDFs, E-Books und eigene Texte vorlesen lassen, mit Stimmen, die im Browser auf dem eigenen Gerät
rechnen. Das Wort, das gerade gesprochen wird, wird markiert.

- **Web-App:** https://reader.benotable.de/app/
- **Website:** https://reader.benotable.de/
- **Chrome Web Store:** https://chromewebstore.google.com/detail/hgkfghgifkifgmklfgglilnmjglojonm (der Store zeigt bis
  zur Freigabe von 2.5 noch eine ältere Fassung)
- **Quellen:** https://github.com/burak-basci/notable-reader

## Kostenlos, ohne Konto

Alle Funktionen und alle Downloads sind kostenlos: kein Konto, keine Lizenzprüfung, keine Werbung, kein Textkontingent,
keine Nutzungsstatistik. Die Erweiterung und die Web-App enthalten weder eine Gerätekennung noch einen Zahlungsaufruf.
Eine freiwillige Unterstützung über einen Stripe-Link ist möglich; sie schaltet nichts frei (`extension/pricing.mjs`:
„All Reader functions are free“, `extension/premium-browser.mjs`: Kompatibilitätsmodul ohne Konto oder Lizenz).

## Was das Programm kann

- Vorlesen von Webseiten (Erweiterung) und von Dateien: PDF, EPUB ohne DRM, DOCX, TXT, Markdown, HTML, eingefügter
  Text sowie Bilder und Scans per lokaler Texterkennung (OCR).
- Wortmarkierung, Tempo von 0,5× bis 4×, Abschnitte und Kapitel, Lesezeichen, Weiterlesen an der letzten Stelle.
- Speichern als MP3 oder WAV (Hörbuch-Export) sowie Dokument als HTML oder PDF, jeweils auf dem eigenen Gerät erzeugt.
- „Zusammenfassen“: geführte Tour durch die Kernsätze einer Seite, optional mit einem lokalen KI-Modell.
- Oberfläche in sechs Sprachen: Deutsch, Englisch, Französisch, Spanisch, Italienisch, Portugiesisch.
- Läuft in Chromium-Browsern ab Version 123 (Manifest V3). Eine Firefox-Version gibt es nicht; im Code ist dafür kein
  Store-Eintrag hinterlegt (`extension/product-config.js`: `firefox: null`).

## Was lokal läuft

- Die Stimmen-Engine (ONNX Runtime Web mit WebAssembly) rechnet im Browser. Der Text verlässt den Browser nicht;
  an Hugging Face gehen nur Modelldateien-Anfragen (siehe unten), nie Dokumenttext.
- Der lokale Verlauf speichert beim tatsächlichen Abspielen eine Textkopie, die Quelle, den Titel, die Zeit und die
  Position lokal im Browser (private Fenster ausgenommen). Löschen geht in den Ansichten des Verlaufs und der
  Bibliothek. Einzelheiten: [PRIVACY.md](PRIVACY.md).

## Was beim ersten Start geladen wird

- **Die Installation lädt kein Sprachmodell.** Erst der erste Klick auf Play lädt eine Stimme von Hugging Face, mit fester
  Revision und geprüft nach Größe und SHA-256:
  - Deutsch: Thorsten medium, ca. 63 MB (`rhasspy/piper-voices`).
  - Englisch: Bella (Kokoro FP32), ca. 326 MB (`onnx-community/Kokoro-82M-v1.0-ONNX`).
  - Belege: `extension/voice-picker.mjs` (`FIRST_RUN_VOICES`), `extension/tools/reader/neural-models.js`,
    `extension/tools/reader/neural-voices.js`, `extension/models/voice-catalog.mjs`. Weitere Stimmen und Sprachen
    stehen in der Stimmenliste und werden erst nach einem Klick geladen.
- Optional, nur nach Klick: OCR-Sprachdaten (`tessdata_fast`, je 1 bis 4 MB, aus einem festgelegten Hugging-Face-Spiegel).
- Optional, nur nach Klick: ein lokales KI-Erklärmodell. IBM Granite 4.0 350M ca. 580 MB
  (`extension/explain/model-manifest.json`) oder Qwen3.5-0.8B ca. 668 MB
  (`extension/explain/model-manifest-better.json`, auch für Deutsch).
- Erlaubte Download-Ziele laut Content-Security-Policy: `huggingface.co`, `*.huggingface.co`, `*.hf.co`,
  `*.xethub.hf.co`.

## Berechtigungen

Aus `extension/manifest.json`. `host_permissions` ist leer: Beim Installieren fragt die Erweiterung keinen Zugriff auf
alle Websites an.

| Berechtigung | Wozu |
|---|---|
| `activeTab`, `scripting` | die Seite lesen, die du vorlesen lassen willst |
| `storage`, `unlimitedStorage` | Einstellungen, Verlauf, Bibliothek und heruntergeladene Modelle lokal speichern |
| `offscreen` | verstecktes Erweiterungsdokument, in dem Stimmen und Audio laufen |
| `downloads` (optional) | Einstellungen exportieren, gespeicherte Dateien im Ordner zeigen |
| `sidePanel` (optional) | die Leiste im Seitenbereich des Browsers zeigen |
| `webNavigation` (optional) | nur die Frames des aktuellen Tabs auflisten, wenn Text in einem eingebetteten Frame liegt |
| `optional_host_permissions` (`http://*/*`, `https://*/*`) | wird erst bei Bedarf für genau eine Website angefragt (Frame dieser Website, automatisches Weiterlesen der Kapitel) |

Content-Security-Policy der Erweiterungsseiten: `connect-src 'self' https://huggingface.co https://*.huggingface.co
https://*.hf.co https://*.xethub.hf.co`, dazu `script-src 'self' 'wasm-unsafe-eval'`; es wird kein Code nachgeladen.

## Aus dem Quelltext bauen

Voraussetzungen: Python 3 (nur Standardbibliothek) und Git für `tools/release.py`; Node.js für die Web-App und die Tests.

```sh
# Pakete (offizielle ID, kompatible ID, Quellpaket, Web-App); der Zielordner darf noch nicht existieren
python3 tools/release.py --output-dir /pfad/zu/neuem-ordner
# weitere Optionen: --freeze-inventory (Dateiinventar neu festschreiben), --source-commit <hash>,
# --allow-unbound (nur lokal, ohne Herkunftsnachweis)

# Nur die Web-App
node tools/build-webapp.mjs --out /pfad/zu/ordner     # optional --version X.Y.Z --rev rN
```

Entpackt laden: `chrome://extensions` öffnen, Entwicklermodus einschalten, „Entpackte Erweiterung laden“ und den Ordner
`extension/` wählen.

Hinweis: `extension/vendor/explain/transformers.min.js` (Transformers.js 4.2.0, Runtime des Erklärmodells) steht in
`.gitignore` und fehlt im Git-Repository. Der Erklär-Worker (`extension/explain/worker.mjs`) lädt sie, und das Release-Inventar nennt sie; ein Build
braucht sie also. Sie ist die Datei `dist/transformers.min.js` aus dem npm-Paket `@huggingface/transformers` 4.2.0 mit zwei
dokumentierten Änderungen; Herkunft, Prüfsummen und die Änderungen stehen in `extension/vendor/explain/provenance.json`.
Vor dem ersten Bauen aus einem frischen Checkout: `node tools/fetch-transformers.mjs` lädt das npm-Paket, prüft dessen
Integrität, wendet die zwei Änderungen an und prüft das Ergebnis gegen die SHA-256 aus `provenance.json`.

Tests: `npm test` (Unit-Tests ohne Browser); Browsertests wie `node tests/webapp-browser.mjs` brauchen `npm install`
und ein Chromium, das Playwright unterstützt.
Beschreibung des Release-Ablaufs: [docs/releases.md](docs/releases.md) (Teile davon beschreiben noch den Stand 2.4).

## Lizenzen

- Distribution des Browserteils: **GPL-3.0-or-later** (`LICENSE`, `COPYING`), weil sie eSpeak NG enthält (Phonemisierung
  der Piper-Stimmen).
- Eigener Browsercode von Burak Basci: zusätzlich **MIT** (`LICENSE-MIT`, Dateiköpfe).
- Der MP3-Encoder `@breezystack/lamejs` 1.2.7 (LGPL-3.0) liegt unverändert unter
  `extension/tools/reader/vendor/export/`, mit seinen Quellen.
- Nativer Linux-Begleiter unter `native/`: **AGPL-3.0-or-later** (`native/LICENSE`); er ist nicht Teil der Browserpakete.
- Alle Fremdkomponenten, Modelle und deren Lizenzen: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Die Quellen von
  eSpeak NG und des Phonemizers: [third_party_sources/README.md](third_party_sources/README.md).

Datenschutz: [PRIVACY.md](PRIVACY.md). Sicherheitsmeldungen: [SECURITY.md](SECURITY.md). Änderungen:
[CHANGELOG.md](CHANGELOG.md).

---

<a id="english"></a>

# English

Read web pages, PDFs, e-books and your own text aloud with voices that run on your own device in the browser. The word
being spoken is highlighted.

- **Web app:** https://reader.benotable.de/app/
- **Website:** https://reader.benotable.de/
- **Chrome Web Store:** https://chromewebstore.google.com/detail/hgkfghgifkifgmklfgglilnmjglojonm (until 2.5 is approved
  the store still shows an older version)
- **Source:** https://github.com/burak-basci/notable-reader

## Free, no account

Every function and every download is free: no account, no licence check, no ads, no text quota, no usage analytics.
The extension and the web app contain no device identifier and no payment call. A voluntary payment link (Stripe)
exists; it unlocks nothing (`extension/pricing.mjs`, `extension/premium-browser.mjs`).

## What it does

- Reads web pages (extension) and files: PDF, EPUB without DRM, DOCX, TXT, Markdown, HTML, pasted text, and images or
  scans through local text recognition (OCR).
- Word highlighting, speed from 0.5x to 4x, sections and chapters, bookmarks, resume where you stopped.
- Saves audio as MP3 or WAV (audiobook export) and documents as HTML or PDF, all produced on your device.
- "Summarize": a guided tour through the key sentences of a page, optionally with a local AI model.
- Interface in six languages: German, English, French, Spanish, Italian, Portuguese.
- Runs in Chromium-based browsers, version 123 or newer (Manifest V3). There is no Firefox version; the code has no
  Firefox store entry (`extension/product-config.js`: `firefox: null`).

## What runs locally

- The voice engine (ONNX Runtime Web with WebAssembly) computes in the browser. Text does not leave the browser;
  Hugging Face only receives requests for model files (below), never document text.
- The local reading history keeps, during actual playback, a text copy, the source, the title, the time and the position
  in your browser (private windows are left out). It can be deleted in the history and library views. Details:
  [PRIVACY.md](PRIVACY.md).

## What is downloaded on first use

- **Installing downloads no voice model.** The first click on Play downloads one voice from Hugging Face at a fixed
  revision, checked by size and SHA-256:
  - German: Thorsten medium, about 63 MB (`rhasspy/piper-voices`).
  - English: Bella (Kokoro FP32), about 326 MB (`onnx-community/Kokoro-82M-v1.0-ONNX`).
  - Evidence: `extension/voice-picker.mjs` (`FIRST_RUN_VOICES`), `extension/tools/reader/neural-models.js`,
    `extension/tools/reader/neural-voices.js`, `extension/models/voice-catalog.mjs`. More voices and languages are in the
    voice list and are downloaded only after a click.
- Optional, only after a click: OCR language data (`tessdata_fast`, 1 to 4 MB each, from a pinned Hugging Face mirror).
- Optional, only after a click: a local AI explanation model. IBM Granite 4.0 350M, about 580 MB
  (`extension/explain/model-manifest.json`), or Qwen3.5-0.8B, about 668 MB (`extension/explain/model-manifest-better.json`,
  also for German).
- Download hosts allowed by the content security policy: `huggingface.co`, `*.huggingface.co`, `*.hf.co`,
  `*.xethub.hf.co`.

## Permissions

From `extension/manifest.json`. `host_permissions` is empty: installing asks for no access to all websites.

| Permission | Purpose |
|---|---|
| `activeTab`, `scripting` | read the page you ask the Reader to read |
| `storage`, `unlimitedStorage` | keep settings, history, library and downloaded models locally |
| `offscreen` | hidden extension document in which voices and audio run |
| `downloads` (optional) | export settings, show saved files in their folder |
| `sidePanel` (optional) | show the reader bar in the browser's side panel |
| `webNavigation` (optional) | only list the frames of the current tab when the text sits in an embedded frame |
| `optional_host_permissions` (`http://*/*`, `https://*/*`) | requested only when needed, for exactly one website (a frame of that site, automatic chapter continuation) |

Content security policy of the extension pages: `connect-src 'self' https://huggingface.co https://*.huggingface.co
https://*.hf.co https://*.xethub.hf.co`, plus `script-src 'self' 'wasm-unsafe-eval'`; no code is loaded from outside.

## Build from source

Requirements: Python 3 (standard library only) and Git for `tools/release.py`; Node.js for the web app and the tests.

```sh
# packages (official ID, compatible ID, source package, web app); the output directory must not exist yet
python3 tools/release.py --output-dir /path/to/new-directory
# more options: --freeze-inventory (rewrite the file inventory), --source-commit <hash>,
# --allow-unbound (local staging only, no provenance claim)

# web app only
node tools/build-webapp.mjs --out /path/to/directory   # optional --version X.Y.Z --rev rN
```

Load unpacked: open `chrome://extensions`, switch on Developer mode, choose "Load unpacked" and select the `extension/`
folder.

Note: `extension/vendor/explain/transformers.min.js` (Transformers.js 4.2.0, the runtime of the explanation model) is
listed in `.gitignore` and is not in the Git repository. The explanation worker (`extension/explain/worker.mjs`) loads it and the release inventory names it, so a build needs it. It is `dist/transformers.min.js` from the npm package `@huggingface/transformers` 4.2.0 with
two documented edits; origin, checksums and the edits are in `extension/vendor/explain/provenance.json`. Before the first build from a fresh
checkout run `node tools/fetch-transformers.mjs`: it downloads the npm package, checks its integrity, applies the two edits
and checks the result against the SHA-256 in `provenance.json`.

Tests: `npm test` (unit tests, no browser); browser tests such as `node tests/webapp-browser.mjs` need `npm install` and a
Chromium that Playwright supports. The release
procedure is in [docs/releases.md](docs/releases.md) (parts of it still describe the 2.4 state).

## Licences

- The browser distribution as a whole is **GPL-3.0-or-later** (`LICENSE`, `COPYING`) because it contains eSpeak NG
  (phonemizer of the Piper voices).
- The Reader's own browser code by Burak Basci is additionally available under the **MIT** licence (`LICENSE-MIT`, file
  headers).
- The MP3 encoder `@breezystack/lamejs` 1.2.7 (LGPL-3.0) is shipped unmodified under
  `extension/tools/reader/vendor/export/`, with its sources.
- The optional native Linux companion in `native/` is **AGPL-3.0-or-later** (`native/LICENSE`); it is not part of the
  browser packages.
- All third-party components, models and their licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Sources of eSpeak
  NG and the phonemizer: [third_party_sources/README.md](third_party_sources/README.md).

Privacy: [PRIVACY.md](PRIVACY.md). Security reports: [SECURITY.md](SECURITY.md). Changes: [CHANGELOG.md](CHANGELOG.md).
