# extension/export: Hörbuchexport im Browser

Schnittstelle: `import {AudiobookExporter} from './export/index.mjs'`

```js
const ex = new AudiobookExporter({ engine });          // TtsEngine (engine/) oder LocalModels
const r = await ex.export({
  text | chapters:[{title,text}], detectChapters?, title, modelId,
  format:'mp3'|'wav', split:'single'|'chapters', announceChapters?, kbps?:64,
  signal?, onProgress?(e), sink?, sinkFor?(filename,i), lookahead?:true });
// r.files[i] = {filename, mime, bytes, duration, sampleRate, storage, blob|null, cleanup(), chapters:[{title,startSec,endSec}]}
ex.cancel();   // Abbruch bis zum atomaren Dateiabschluss, danach nicht mehr
```
- Fortschritt: `phase` preparing|synthesizing|encoding|saving|done|aborted|error, `percent`, `completedChunks/totalChunks`, `chapterIndex`, `fileIndex`.
- Speicher: eigenes Ziel (`sink`/`sinkFor`, z. B. showSaveFilePicker) > OPFS > IndexedDB > Speicher (32 MiB). Ein PCM-Abschnitt plus ein vorausberechneter im RAM.
- MP3: lamejs aus `tools/reader/vendor/export/` (unverändert, LGPL, getrennt austauschbar über `setMp3Loader`). Einzeldatei mit Kapiteln bekommt ID3v2.3 CTOC/CHAP.
- Ersetzt `tools/reader/audio-export.js` noch nicht; Umschalten ist Sache des Integrators. Gleicher Job-Präfix, `clearAudiobookStorage()` räumt beide Wege auf.
- Tests: `node --test tests/export-exporter.mjs`, `node tests/export-browser.mjs` (Chromium), `tests/export-firefox.mjs` (optional, `PLAYWRIGHT_CORE`, `FIREFOX_BIN`).
