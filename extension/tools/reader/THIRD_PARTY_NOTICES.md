# Third-party notices

The combined neural distribution is GPL-3.0-or-later (LICENSE/COPYING).
beNotable! Reader's own code is Copyright (c) 2026 Burak Basci, also available under MIT (LICENSE-MIT).
Third-party components retain their original licenses and copyrights.

| Component | Version | Origin | License and retained notice |
|---|---|---|---|
| PDF.js | 6.5.438 | https://github.com/mozilla/pdf.js | Apache-2.0: `extension/tools/reader/vendor/pdfjs/PDFJS-LICENSE`; copyright headers retained in modules |
| fflate | 0.8.3 | https://github.com/101arrowz/fflate | MIT: `extension/tools/reader/vendor/FFLATE-LICENSE` |
| tesseract.js (text recognition, JavaScript part) | 7.0.0 | https://github.com/naptha/tesseract.js | Apache-2.0: `extension/tools/reader/ocr/vendor/TESSERACT-JS-LICENSE.md`; files `tesseract.esm.min.js`, `worker.min.js` with one edit (default CDN host replaced by an invalid name, see `extension/tools/reader/ocr/PROVENANCE.md`) |
| tesseract.js-core (WebAssembly build of Tesseract OCR 5 and Leptonica) | 7.0.0 | https://github.com/naptha/tesseract.js-core | Apache-2.0: `extension/tools/reader/ocr/vendor/TESSERACT-CORE-LICENSE`; file `tesseract-core-simd-lstm.wasm.js` unmodified. Contains Tesseract (Apache-2.0) and Leptonica (BSD-2-Clause) |
| tessdata_fast language data (deu, eng, fra, spa, ita, por) | commit 87416418657359cb625c412a48b6e1d6d41c29bd | https://github.com/tesseract-ocr/tessdata_fast | Apache-2.0. Not part of the package: downloaded once after the user's click from a pinned Hugging Face mirror revision, verified by size and SHA-256 (`extension/tools/reader/ocr/lang-data.mjs`) |

The PDF.js distribution includes standard-font and WebAssembly assets under
additional upstream terms. All supplied license files are retained beside
their assets under `extension/tools/reader/vendor/pdfjs/standard_fonts/` and
`extension/tools/reader/vendor/pdfjs/wasm/`. In particular these include Liberation and Foxit
font notices, OpenJPEG, QCMS, JBIG2, and the PDF.js wrapper notices.
The QuickJS scripting sandbox of the PDF.js distribution is not shipped.
The reader imports PDF page text and renders the page; PDF scripting is not enabled.

Text recognition for scans and images (Tesseract, Apache-2.0) runs entirely on the device, as code that ships in the package (no remote code). Only the
language data of the chosen language is fetched, once, after an explicit click; Apache-2.0 notices of Tesseract, Leptonica (BSD-2-Clause) and the
language data are retained as listed above and in `extension/tools/reader/ocr/PROVENANCE.md`.

The upstream npm release tarballs used for reproducible provenance were:

- `pdfjs-dist-6.5.438.tgz`, SHA-256 `7461aefcd27c4ef0dd76f9ca5760f09466eb6b3f934432670c12132e7b3d6faa`
- `fflate-0.8.3.tgz`, SHA-256 `38c2cd824402407b43153c782274aec2ea83ea688e4aa0b743c5f2c305857d92`
- `tesseract.js-7.0.0.tgz`, SHA-256 `9a93bf51c3387f945d10a24bf8b3a4bf2e45c7c7161b8242aafbaf9d3c4b606a`
- `tesseract.js-core-7.0.0.tgz`, SHA-256 `ba584355515eaff877552022853c0e71f2cb70466e759d1d6940484929718ee0`

No speech model weights, private documents, credentials, browser sessions,
Python runtime, PyMuPDF package, or CUDA libraries are distributed by this release.
Browser and operating-system voices remain separately supplied components.

## Optional neural speech components

- ONNX Runtime Web 1.22.0, MIT, source https://github.com/microsoft/onnxruntime/tree/v1.22.0. Full LICENSE and ThirdPartyNotices.txt are in `extension/tools/reader/vendor/neural/ort/`.
- Piper phonemizer WASM from `@diffusionstudio/piper-wasm@1.0.0`; wrapper MIT, embedded eSpeak NG GPL-3.0-or-later. Original GPL and wrapper notices, runtime hashes and complete corresponding engine/dictionary sources are included in the source archive (`benotable-reader-source-<version>.zip`) and in the repository https://github.com/burak-basci/notable-reader under `third_party_sources/` (not repeated inside the store ZIPs). See `third_party_sources/README.md`; ESM adapter added 2026-11-03, underlying binaries unmodified.
- Optional Kokoro82M FP32 model/Bella: Apache-2.0, pinned upstream revision and SHA-256 in `extension/tools/reader/neural-models.js`. No weights distributed in the extension or source ZIP.
- Optional Piper Thorsten high: upstream model repository MIT; Thorsten voice dataset CC0. The high model is fine-tuned from the U.S. English lessac checkpoint (its MODEL_CARD: "Finetuned from U.S. English lessac voice"), whose training data licence (Blizzard 2013 Lessac) allows research use only and excludes commercial development of voice synthesis. Not preselected (the German default is Thorsten medium). No weights distributed in the extension or source ZIP.
- Optional Piper voices on a non-commercial BASE checkpoint (weights MIT, base training data not free for commercial use; listed in `NC_BASE_OF`, `extension/tools/reader/neural-models.js`): lessac base (Blizzard 2013 Lessac, research only): de_DE-thorsten-high, cs_CZ-jirka-low, en_US-mike-medium, en_US-sam-medium, pl_PL-gosia-medium, pl_PL-mc_speech-medium, es_MX-ald-medium; RyanSpeech base (CC BY-NC-SA 4.0): de_DE-kerstin-low, de_DE-thorsten-low, en_US-kathleen-low, es_ES-mls_10246-low, es_ES-mls_9972-low, fr_FR-gilles-low, fr_FR-mls_1840-low, fr_FR-siwis-low, nl_NL-mls_5809-low, nl_NL-mls_7432-low, pl_PL-mls_6892-low, pt_BR-edresson-low. None of them is a default voice.
- ONNX Runtime Web, JSPI/WebGPU build 1.31.1 (experimental stage only), MIT (`LICENSE` retained), `extension/tools/reader/vendor/neural/ort-webgpu/`.
- Optional Qwen3-TTS 12Hz 0.6B CustomVoice, 4-bit ONNX export for WebGPU by danyalmalik (experimental stage, never preselected): Apache-2.0 according to the catalog header comment, `extension/tools/reader/neural-voices-experimental.js`. Not distributed.
- Optional Qwen3.5-0.8B, ONNX export `onnx-community/Qwen3.5-0.8B-ONNX` (q4, explanation feature): Apache-2.0 as recorded in `extension/explain/model-manifest-better.json`. Not distributed.
- Optional Piper voices on the Hi-Fi TTS base (`en_US-hifi_tts_92-medium` and voices retrained on the `hifi_tts_92` base): weights MIT; training data Hi-Fi Multi-Speaker English TTS Dataset (Hi-Fi TTS), NVIDIA, CC BY 4.0, https://www.openslr.org/109/. Not distributed.
- Optional Phonon / Pocket TTS voices use the Kyutai Mimi audio codec: CC BY 4.0, Kyutai. Not distributed.
- The complete list of every component in this package is `THIRD_PARTY_NOTICES.md` in the package root.
- Optional Kokoro82M q8 (`model_quantized.onnx`): same Apache-2.0 model, 8-bit quantised, pinned revision and SHA-256 in `extension/tools/reader/neural-models.js`. Not distributed.
- Optional KittenTTS nano 0.8 int8 (KittenML/kitten-tts-nano-0.8-int8): Apache-2.0 per the Hugging Face model metadata, pinned revision and SHA-256 in the register; English only. Not distributed.
- Optional Piper Thorsten medium: same CC0 dataset and MIT model repository as Thorsten high. Not distributed.
- Optional Piper Eva (de_DE-eva_k-x_low): Piper repository MIT; dataset M-AILABS Speech Dataset (the model card only says "See URL"; BSD-3-Clause with commercial use was taken from the earlier research report and could not be re-verified on 2026-11-07 because the publisher site was unreachable - re-check before release). Not distributed.
- Optional voices of the extended catalog (`extension/tools/reader/neural-voices.js`; 155 register entries, 94 voices, all pinned to a fixed revision with size and SHA-256; no weights distributed in the extension or the source archive, downloaded only on explicit user action): Kokoro82M voices (Apache-2.0, 41 voices incl. Spanish, French, Italian, Brazilian Portuguese, Hindi), KittenTTS voices (Apache-2.0, 7 more voices in the same files as Bella), and 46 Piper voices (repository MIT; each voice's dataset license as stated on its retained model card and recorded in the register `license` field: CC0, public domain, Apache-2.0, Unlicense, or CC BY 4.0 with attribution). Attribution for the CC BY datasets (names as on the model cards, https://huggingface.co/rhasspy/piper-voices): Kasandra (cs_CZ), Alba (en_GB), Serena (it_IT), Siwis (fr_FR), Edresson (pt_BR), the Multilingual LibriSpeech speakers (es_ES, fr_FR, nl_NL, pl_PL) and Jenny (Dioco) (en_GB; the name "Jenny (Dioco)" is shown in the interface as its README asks). Voices with non-commercial, share-alike, research-only or unclear dataset licenses are not in the register. The 108 short listening samples in `extension/samples/` were generated with these voices (08.11.2026) and carry the license of the respective voice; they contain a fixed sample sentence, no user text.
- Optional Phonon 31M English (Gradium, `gradium/phonon-31m-en`, released 2026-10) with 25 English voices plus the default voice (`gradium/phonon-voices`): model and voices Apache-2.0 per the model cards (read 2026-11-08). ONNX conversion `onnx-community/phonon-31m-en-ONNX`, pinned to revision `4f0cda7c60dddb4862d0e68ff9ff60c32ffdc9f4` (`main` of that repository changed on 2026-11-02 and does not fit; every file pinned with size and SHA-256 in `extension/tools/reader/neural-voices-pocket.js`). Phonon builds on Kyutai's Pocket TTS and the Mimi codec (Kyutai, CC-BY-4.0): attribution given here as a precaution, the upstream license relation is not documented on the Phonon cards (unverified). The adapter (`extension/engine/worker/pocket-family.js`, own code MIT) needs no phonemizer and no GPL component; it uses the model's own `tokenizer.json`. Not included: Phonon 40M (CC-BY-NC), the 12 character voices and the voices designed for other languages. No weights distributed in the extension or the source archive, downloaded only on explicit user action.
- Optional additional Piper voices (`extension/models/voice-catalog.mjs`; 423 register entries in 8 languages, all pinned to a fixed revision of `rhasspy/piper-voices` with size and SHA-256; no weights distributed, downloaded only on explicit user action). Piper models are MIT; dataset licenses as recorded per entry (`license`, `metadata.datasetLicense`, `attribution`) and on each linked model card: CC BY 4.0 (415 entries), CC0 (5), CC BY 3.0 (2), Apache-2.0 (1). Attribution: Multilingual LibriSpeech (Pratap et al., 2020), LibriVox readers, https://www.openslr.org/94/ (de-DE, fr-FR, nl-NL); Spanish Harvard (SHARVARD), Universidad de Granada / University of Edinburgh, https://datashare.ed.ac.uk/handle/10283/574 (es-ES); NST Swedish TTS Dataset, Språkbanken / National Library of Norway, voice by yeagersthlm (sv-SE); Paola Persico, Voice Dataset Italian (it-IT); blackbartblues, piper-pl-bass-high (pl-PL). Their 423 short listening samples in `extension/samples/additional-*.opus` were synthesised locally with the respective voice from a fixed sample sentence (`tools/generate-additional-voice-samples.mjs`) and carry that voice's license.

The speech engine calls the local Piper/eSpeak phonemizer and ONNX Runtime directly; it does not use the `phonemizer` npm package. Transformers.js is used only by the optional local explanation feature described below.

## Local MP3 encoder

Audio export uses the unchanged ES module from `@breezystack/lamejs` 1.2.7 (git commit `1fb0ef5fa177413107e2e107d054a9b994e3f79c`), licensed LGPL-3.0. Its complete corresponding source archive, upstream notices, GPL/LGPL license texts and SHA-256 provenance are included under `extension/tools/reader/vendor/export/`. The encoder is a separately replaceable module; no remote encoder script or cloud conversion service is loaded. See `extension/tools/reader/vendor/export/provenance.json` for the exact upstream archive and module hashes. The complete combined distribution remains GPL-3.0-or-later.

## Optional local explanation

The optional "Explain" feature runs a small language model on the device. Its runtime ships in
`extension/vendor/explain/` and loads only from the extension origin; provenance and SHA-256 values
are in `extension/vendor/explain/provenance.json`.

| Component | Version | Origin | License and retained notice |
|---|---|---|---|
| Transformers.js (`@huggingface/transformers`) | 4.2.0 | https://github.com/huggingface/transformers.js | Apache-2.0: `extension/vendor/explain/transformers-LICENSE`; file `transformers.min.js` (web bundle, ONNX Runtime Web JS inside) with two documented edits (local runtime path instead of the default CDN path, remote models disabled by default) |
| ONNX Runtime Web (plain WASM build used by Transformers.js) | 1.26.0-dev.20260416-b7804b056c | https://github.com/microsoft/onnxruntime | MIT: `extension/vendor/explain/onnxruntime-LICENSE`, `extension/vendor/explain/onnxruntime-ThirdPartyNotices.txt` (the npm package ships no notices file; kept from the 1.22 release, same license); files `ort-wasm-simd-threaded.mjs` and `.wasm` unmodified |
| `@huggingface/jinja` (bundled inside `transformers.min.js`) | declared `^0.5.6` by Transformers.js 4.2.0; license text from 0.5.11 | https://github.com/huggingface/huggingface.js | MIT: `extension/vendor/explain/jinja-LICENSE` |
| `@huggingface/tokenizers` (bundled inside `transformers.min.js`) | declared `^0.1.3` by Transformers.js 4.2.0 | https://github.com/huggingface/huggingface.js | Apache-2.0: `extension/vendor/explain/tokenizers-LICENSE` |
| IBM Granite 4.0 350M (`ibm-granite/granite-4.0-350m`), ONNX export `onnx-community/granite-4.0-350m-ONNX-web` (q4) | revision `62fc8f345c8aed0e1a28f856dc7e79b4cdb55cae` | https://huggingface.co/onnx-community/granite-4.0-350m-ONNX-web | Apache-2.0 (model card of the base model and of the export). Not part of any package: about 580 MB, downloaded from Hugging Face only after the user confirms, every file pinned by size and SHA-256 in `extension/explain/model-manifest.json` |
| Qwen2.5-0.5B-Instruct, ONNX export `onnx-community/Qwen2.5-0.5B-Instruct` (q8), model of the 2.4 releases | revision `22942cb7d7ba4cc81bb4673549ca4d4614469b5e` | https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct | Apache-2.0. No longer offered or downloaded; a copy a user already has keeps working until Granite is installed and is then removed (`extension/explain/model-manifest-legacy.json`) |

## Lucide overlay icons

The expand/collapse controls in `extension/player-surface.mjs` use the Lucide
`maximize-2` and `minimize-2` SVG paths. Origin: https://github.com/lucide-icons/lucide

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
