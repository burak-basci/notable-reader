# Changelog

## 2.5.5 (2026-11-20)

- A page read to the end reads again from the beginning on Play, also after a reload (2.5.4 saved the last word as the
  resume point: the second Play stayed silent and the bar said "Fertig gelesen"). Same in the file view and web app.
- Header status words that do not fit show a short form ("Fertig", "↓ 63 MB", "↓ 45 %", "… 12 s"); the full text is the
  tooltip and the accessible name.
- Cookie walls: the article behind them was already read, but its marks were painted over the wall (heise, faz,
  chefkoch, t-online). Marks under a wall are no longer painted, the bar says "Ein Cookie-Hinweis der Seite verdeckt den
  Text. Vorgelesen wird der Text dahinter."; in-page banners of Sourcepoint, OneTrust, Usercentrics, Cookiebot, Didomi,
  consentmanager, Borlabs, Complianz, Quantcast, TrustArc and CookieYes are not page text.
- File view and web app: a damaged file after a good one shows its message; pdf.js parser errors appear in the
  interface language; an empty text file no longer mentions scans.

## 2.5.4 (2026-11-20)

- Accessibility of the Reader's own surfaces (bar, voice list, settings, popup, welcome, help, side panel, file view, web
  app), checked with axe-core 4.10 (WCAG 2.2 A/AA rules) in light and dark mode, the Chromium accessibility tree, a
  scripted keyboard walk, 200 % zoom, 320 px width and increased text spacing: Play keeps one name and states
  `aria-pressed`; the timeline carries "1:23 of 3:40" as `aria-valuetext`; waits of 2 s or more are announced once; the voice panel that keeps
  Tab inside is a modal dialog; reduced motion switches off the bar's transitions; Alt+Shift+B moves the focus from
  anywhere on the page into the bar (listed in help, settings and on the welcome page); the popup has a main landmark
  and a heading. Not yet tested with real screen readers.
- English at 2x and 3x: a heavy voice (Kokoro FP32) waits for 2 s of listening per 1x of tempo before the first sound
  and looks 5 sections ahead. Three English texts, cold engine: 2x 5 stops (7.7 s) -> 0, 3x 31 stops (48 s) -> 0; the
  first sound comes about 1 s (2x) / 4 s (3x) later. 1x and Piper voices (German) are unchanged. A third worker and
  sentence-sized pieces were measured and not taken.
- A device that computes the voice slower than it speaks (3 stops within 2 minutes or 6 s of silence) gets an offer in
  the voice card: English Kitten nano (then Piper LJSpeech), German Thorsten medium. It asks; "read with current voice"
  is remembered per voice. On a quarter of an 8-core desktop Bella FP32 stopped 12 times in 550 words at 1x, Thorsten
  never.
- Firefox: a finished voice download no longer waits for Firefox's persistent-storage prompt (the voice stayed "not
  downloaded" and Play never read). Web app in Firefox 157: 35 of 35 browser checks pass.
- Reading: no IPA pronunciation (Wikipedia), no date line ("Stand: …", tagesschau), no relative byline time and no
  picture credit (BBC), no Google "preferred sources" button (SPIEGEL); "(31. Dezember 2023)" no longer ends a section;
  a key-sentence tour step lands below fixed page banners.
- Diagnosis numbers in the interface language's notation ("0,5 s" in German).
- Build and docs: `npm test` runs the unit tests, `tools/fetch-transformers.mjs` recreates the gitignored
  Transformers.js bundle from npm (checked against provenance.json); README in German and English, complete
  third-party notices; the 2.4 install/release pages are marked historical.

## 2.5.3 (2026-11-20)

- English reads without stopping: only the engine host (the offscreen document that runs the voices) is cross-origin
  isolated, served with COOP/COEP by the extension's service worker, so voice workers get WASM threads again; every
  other extension page stays as before. Kokoro FP32 (Bella) on 16 cores: real-time factor 1.43 -> 0.52 per worker,
  a pair 0.36. Three English texts of about 550 words, engine cold: first sound 1.4-2.3 s at 1x (was 4.0-4.9 s) and
  2.7-5.9 s at 2x (was 10.5-14.2 s); stops per 1000 words 9.5 -> 0 at 1x and 79 -> 3 at 2x (336 s -> 2.1 s of silence).
- German keeps Thorsten medium as the first voice also with threads (Thorsten high stopped once per text); with
  threads it starts within 0.2-1.7 s and never stopped at 1x or 2x.
- A voice pair already when one worker would run at more than half its speed (8+ cores), the start buffer counts the
  pair, a heading waits a moment for its paragraph; Play takes a worker from look-ahead work also without threads.
- The bar is honest while waiting: a voice download shows its percent, any other wait counts seconds ("Loading… 4 s"),
  the tooltip says what happens. Removed a leftover test hook that showed a simulated error on the first restart.
- Reading: no teaser boxes or programme boxes (tagesschau), no translation banner (MDN), word gaps from layout are
  kept ("Woodland and"), code blocks are skipped by default for new installs (inline code stays), letter-spaced PDF
  text is read as words ("Grundgesetz"), diagnosis lines in the interface language.
- Reading starts at the headline also where it sits in the article's own header (heise, The Guardian), and picture
  captions before the first paragraph are not read first (English Wikipedia, The Guardian).
- Popup "Summarize" shows or continues a running tour instead of ending it; long voice names fit the voice button;
  the help page names the real first download (German 63 MB, it said 114 MB).
- Web app (reader.benotable.de/app) builds again from this source (tools/build-webapp.mjs) and runs without the
  extension. PRIVACY.md describes the free product.

## 2.5.2 (2026-11-20)

- Store package: the extension name carries what it does ("beNotable! Reader: Text to Speech", localized in six
  languages); the short description no longer says "natural" or "works offline" (voices are downloaded once from
  huggingface.co): "Reads web pages, PDFs and e-books aloud with voices that run on your device. Word highlighting,
  free, no account."
- Removed the unused companion client reader-api.js (the package contains no loopback address any more) and dead
  premium styles (download star, offer cards). All functions and downloads stay free; there is no licence check,
  device identifier or payment call in the code.

## 2.5.1 (2026-11-20)

- Reading speed 0.5x-4x everywhere (was up to 5x); a stored or imported 4.05-5x becomes 4x.
- First run: the first Play after the voice download starts reading (it hung for 60 s and reported "Reading failed");
  before the first Play the bar names the voice Play downloads; the welcome page names the real button
  ("Open the reader bar") and the real download size, and plays the matching sample.
- Reading starts at the text: no screen-reader-only labels or video player captions (tagesschau.de), no floated
  info boxes (Wikipedia), the README on GitHub repository pages, Sphinx/Read the Docs links are read, and a cookie
  dialog in its own frame (Sourcepoint, OneTrust, Usercentrics, ...) is never read as the page (spiegel.de).
- "Heard" / "Remaining" follow the spoken word instead of jumping once per section.
- English Kokoro voice: two workers on 8+ cores while the engine has no WASM threads (fewer pauses at 1x).
- File view: the status line shows the opened document instead of "PDF is opening ... page 15 of 15".
- Removed the tracked backup copy `extension.backup.1794849236/` (old 2.4 files, not part of any release); it stays in
  the Git history.

## 2.5.0 (2026-11-16)

- Interface in six languages (de, en, es, fr, it, pt) through the browser's own locale system (`default_locale: en`,
  `__MSG_*` placeholders in the manifest, localized store name and description).
- Side panel (optional `sidePanel` permission), keyboard shortcuts (Alt+Shift+V open, Alt+Shift+K play/pause,
  Alt+Shift+Left/Right previous/next section) and an offscreen document that runs the voices and audio
  (`offscreen`, `unlimitedStorage`); local `file://` pages and PDFs can be read.
- Two extension packages from one source (official ID and compatible ID); they differ only in `manifest.key`.
- Voices: the Play button downloads the recommended voice for the page language once; a double click on a voice row
  downloads and starts it; a running download shows as one slim strip above the bar and as a ring on the voice button;
  prepared audio colours the timeline.
- Optional local AI explanation ("Summarize" tour): English and, with the larger model, German; the model is
  downloaded only after a click and checked by SHA-256 (Qwen3.5-0.8B q4, 668 MB, Apache-2.0, was added as a second
  size on 17 November; the 2.4 model keeps working until a current one is installed).
- COOP/COEP for all extension pages was tried and removed again during 2.5.0 (it stopped the offscreen engine host);
  since 2.5.3 only the engine host is isolated.

## 2.4.0

- One canonical source release for the original paper/green extension controls,
  browser document reader and optional native companion; stable local/native
  upgrade ID and official extension ID from the same implementation.
- Official and compatible ZIPs differ only by the public manifest identity key.
- Allowlisted native source with AGPL disclosures and explicit Linux bootstrap;
  no bundled models, environments, private configuration or entitlement secrets.
- Immutable staged release directories, deterministic ZIP metadata, complete file
  hashes, source/Git binding and generated native product/protocol build metadata.
- Browser web/PWA build remains independent of the optional native daemon.

## 2.3.3

Visible donation links and consistent lifetime terms. Existing published ZIPs
and tags remain immutable; the store review has its own independently read state.

## 2.3.2

Cancelled or superseded PDF figure paints no longer leave a persistent error;
real current rendering errors remain visible and successful retries recover.
