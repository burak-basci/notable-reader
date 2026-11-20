# Third-party notices · beNotable! Reader

The browser distribution (extension and web app) is provided under GPL-3.0-or-later (`LICENSE`, `COPYING`) because it
contains eSpeak NG (the phonemizer of the Piper voices). The Reader's own code is Copyright (c) 2026 Burak Basci and is
additionally available under the MIT License (`LICENSE-MIT`, file headers). Every third-party component keeps its
own license and copyright. The optional native Linux companion under `native/` is AGPL-3.0-or-later (`native/LICENSE`,
`native/COPYING-AGPL-3.0`, `native/THIRD_PARTY_NOTICES.md`) and is not part of the browser packages.

This file lists every third-party component that is shipped in this repository or that the Reader downloads on request.
Versions and licenses are taken from the retained license files, provenance files and file headers named in the table.
Where something is not documented in the repository, it says so. Per-voice detail (attribution for CC BY datasets,
sample files) is in `extension/tools/reader/THIRD_PARTY_NOTICES.md`.

## Shipped in the repository and in the packages

| Component | Version | License | Where (repository path) |
|---|---|---|---|
| PDF.js (with its CMaps and standard fonts) | 6.5.438 | Apache-2.0; bundled font and codec notices: Liberation, Foxit, OpenJPEG, QCMS, JBIG2 | `extension/tools/reader/vendor/pdfjs/` (`PDFJS-LICENSE`, `standard_fonts/LICENSE_*`, `wasm/LICENSE_*`); the QuickJS scripting sandbox is not shipped |
| fflate | 0.8.3 | MIT | `extension/tools/reader/vendor/fflate.mjs`, `extension/tools/reader/vendor/FFLATE-LICENSE` |
| ONNX Runtime Web, plain WASM build (speech engine) | 1.22.0 | MIT (upstream `ThirdPartyNotices.txt` retained) | `extension/tools/reader/vendor/neural/ort/` |
| ONNX Runtime Web, JSPI/WebGPU build (experimental stage only) | 1.31.1 | MIT (`LICENSE` retained; no separate third-party notices file for this build is in the repository) | `extension/tools/reader/vendor/neural/ort-webgpu/` |
| Piper phonemizer WebAssembly (`piper_phonemize.wasm`, `.data`, `.mjs`) from `@diffusionstudio/piper-wasm` | 1.0.0 (piper-phonemize fork commit `cfff8e52ebaea37c7e953ae2d06b174acb827ac4`) | wrapper MIT (Michael Hansen, `PIPER-PHONEMIZE-LICENSE`); ESM default export added 2026-11-03, binaries unmodified | `extension/tools/reader/vendor/neural/piper/`, `extension/tools/reader/vendor/neural/PIPER-PHONEMIZE-LICENSE`, hashes in `extension/tools/reader/vendor/neural/runtime-hashes.json` |
| eSpeak NG (compiled into the phonemizer, with its language data in `piper_phonemize.data`) | rhasspy/espeak-ng commit `0f65aa301e0d6bae5e172cc74197d32a6182200f` (data tree `8593723f10cfd9befd50de447f14bf0a9d2a14a4`) | GPL-3.0-or-later | `extension/tools/reader/vendor/neural/GPL-3.0.txt`; complete corresponding sources in `third_party_sources/` (`espeak-ng/`, `espeak-ng-data-source/`, `piper-phonemize/`, `piper-wasm-build/`, `PIPER-WASM-UPSTREAM-BUILD.md`, `provenance.json`, `README.md`) |
| `@breezystack/lamejs` (MP3 encoder, a port of LAME) | 1.2.7 (git commit `1fb0ef5fa177413107e2e107d054a9b994e3f79c`) | LGPL-3.0 (GPL-3.0 and LGPL-3.0 texts retained); unmodified, separately replaceable module | `extension/tools/reader/vendor/export/` (`lamejs.js`, `lamejs-corresponding-source.tar.gz`, `NOTICE.md`, `provenance.json`, `UPSTREAM-LICENSE`, `LGPL-3.0.txt`, `GPL-3.0.txt`) |
| tesseract.js (OCR, JavaScript part) | 7.0.0 | Apache-2.0; two files carry one edit (default CDN host replaced by an invalid name) | `extension/tools/reader/ocr/vendor/` (`tesseract.esm.min.js`, `worker.min.js`, `TESSERACT-JS-LICENSE.md`), provenance in `extension/tools/reader/ocr/PROVENANCE.md` |
| tesseract.js-core (WebAssembly build of Tesseract OCR 5 and Leptonica) | 7.0.0 | Apache-2.0 (Tesseract), BSD-2-Clause (Leptonica); file unmodified | `extension/tools/reader/ocr/vendor/tesseract-core-simd-lstm.wasm.js`, `TESSERACT-CORE-LICENSE` |
| Transformers.js (`@huggingface/transformers`, web bundle; runtime of the optional explanation feature) | 4.2.0 | Apache-2.0; two documented edits (local runtime path, remote models off) | `extension/vendor/explain/transformers.min.js`, `transformers-LICENSE`, `provenance.json`. See the note on this file below. |
| ONNX Runtime Web, plain WASM build used by Transformers.js | 1.26.0-dev.20260416-b7804b056c | MIT (license text and third-party notices kept from the 1.22 release; the npm package ships none) | `extension/vendor/explain/ort-wasm-simd-threaded.mjs`, `.wasm` (unmodified), `onnxruntime-LICENSE`, `onnxruntime-ThirdPartyNotices.txt` |
| `@huggingface/jinja` (bundled inside `transformers.min.js`) | declared `^0.5.6`; license text from 0.5.11 | MIT | `extension/vendor/explain/jinja-LICENSE` |
| `@huggingface/tokenizers` (bundled inside `transformers.min.js`) | declared `^0.1.3` (0.1.3 in `provenance.json`) | Apache-2.0 | `extension/vendor/explain/tokenizers-LICENSE` |
| Lucide icons (expand/collapse controls) and the Feather-derived icons among them | not versioned in the repository | ISC (Lucide), MIT (Feather, Cole Bemis); full texts | `extension/tools/reader/THIRD_PARTY_NOTICES.md` |
| 605 short listening samples (`.opus`), generated locally from a fixed sample sentence | generated 2026-11 | the license of the respective voice (see below); they contain no user text | `extension/samples/` |

`extension/vendor/explain/transformers.min.js` is listed in `.gitignore` and is therefore not in the Git repository
(the release inventory `tools/release-files.json` still names it, so a release build needs it). It is the unmodified
file `dist/transformers.min.js` of the npm package `@huggingface/transformers` 4.2.0 plus the two edits recorded
in `extension/vendor/explain/provenance.json`; the integrity value of the npm tarball and the SHA-256 of the edited file
are recorded there. Mozilla Readability and the former `extension/vendor/export/` path of older versions are not part
of this source any more.

The upstream npm tarballs used for provenance: `pdfjs-dist-6.5.438.tgz` (SHA-256
`7461aefcd27c4ef0dd76f9ca5760f09466eb6b3f934432670c12132e7b3d6faa`), `fflate-0.8.3.tgz`
(`38c2cd824402407b43153c782274aec2ea83ea688e4aa0b743c5f2c305857d92`), `tesseract.js-7.0.0.tgz`
(`9a93bf51c3387f945d10a24bf8b3a4bf2e45c7c7161b8242aafbaf9d3c4b606a`) and `tesseract.js-core-7.0.0.tgz`
(`ba584355515eaff877552022853c0e71f2cb70466e759d1d6940484929718ee0`).

No model weights, private documents, credentials, browser sessions, Python runtime or CUDA libraries are part of the
extension packages. Browser and operating-system voices remain separately supplied components.

## Downloaded only after a click (not in the repository, not in the packages)

Each file is fetched from Hugging Face at a fixed revision and verified by size and SHA-256 before it is stored.

| Model | License | Pinned in |
|---|---|---|
| Kokoro-82M v1.0 ONNX (`onnx-community/Kokoro-82M-v1.0-ONNX`; English voice Bella: FP32 about 326 MB, compact 8-bit variant about 93 MB; further Kokoro voices) | Apache-2.0 (`extension/tools/reader/vendor/neural/KOKORO-LICENSE`) | `extension/tools/reader/neural-models.js`, `neural-voices.js` |
| Piper voices (`rhasspy/piper-voices`), among them Thorsten medium (German, about 63 MB) | Piper model repository MIT; the voice dataset license as stated on each model card and recorded in the catalogs (`license`, `metadata.datasetLicense`): mostly CC0 or CC BY 4.0 (attribution texts in `extension/tools/reader/THIRD_PARTY_NOTICES.md`), also CC BY 3.0 and Apache-2.0. Thorsten: CC0 (retained card `extension/tools/reader/vendor/neural/THORSTEN-MODEL-CARD`). Voice Eva (`de_DE-eva_k-x_low`): dataset license not confirmed (model card says "See URL") | `extension/tools/reader/neural-models.js`, `neural-voices.js`, `extension/models/voice-catalog.mjs` |
| KittenTTS nano / micro / mini 0.8 (`KittenML`) | Apache-2.0 per the Hugging Face model metadata | `extension/tools/reader/neural-models.js` |
| Phonon 31M English (Gradium) with voices, ONNX conversion `onnx-community/phonon-31m-en-ONNX` | Apache-2.0 per the model cards; it builds on Kyutai Pocket TTS and Mimi (CC-BY-4.0); the upstream license relation is not documented on the cards (unverified) | `extension/tools/reader/neural-voices-pocket.js` |
| Qwen3-TTS 12Hz 0.6B CustomVoice, 4-bit ONNX export for WebGPU by danyalmalik (experimental stage, never preselected) | Apache-2.0 according to the catalog header comment; not re-checked | `extension/tools/reader/neural-voices-experimental.js` |
| IBM Granite 4.0 350M, ONNX export `onnx-community/granite-4.0-350m-ONNX-web` (q4, about 580 MB; explanation feature) | Apache-2.0 | `extension/explain/model-manifest.json` |
| Qwen3.5-0.8B, ONNX export `onnx-community/Qwen3.5-0.8B-ONNX` (q4, about 668 MB; explanation feature, also German) | Apache-2.0 (as recorded in the manifest) | `extension/explain/model-manifest-better.json` |
| Qwen2.5-0.5B-Instruct, `onnx-community/Qwen2.5-0.5B-Instruct` (q8; model of the 2.4 releases, no longer offered) | Apache-2.0 (as recorded in the manifest) | `extension/explain/model-manifest-legacy.json` |
| OCR language data `tessdata_fast` (German, English, French, Spanish, Italian, Portuguese; 1 to 4 MB each), from a pinned Hugging Face mirror | Apache-2.0 | `extension/tools/reader/ocr/lang-data.mjs` |

Entries marked "according to ..." or "as recorded" repeat what the catalog, manifest or model card states; the license
texts of these models are not stored in the repository, only the ones named in the first table. Planned candidates in
`neural-models.js` (`PLANNED_MODELS`) cannot be downloaded and are not listed.

## Unmodified sources and rebuilding

The corresponding source of eSpeak NG and the phonemizer build, the lamejs source archive and all retained license
files are in this repository so that the GPL and LGPL parts can be rebuilt or replaced. The reproducible release build
and its hash inventory are described in `docs/releases.md`.
