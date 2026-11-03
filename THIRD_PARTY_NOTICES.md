# Third-party notices

The combined neural distribution is GPL-3.0-or-later (LICENSE/COPYING).
Notable Reader's own code is Copyright (c) 2026 Burak Basci, also available under MIT (LICENSE-MIT).
Third-party components retain their original licenses and copyrights.

| Component | Version | Origin | License and retained notice |
|---|---|---|---|
| PDF.js | 6.5.438 | https://github.com/mozilla/pdf.js | Apache-2.0: `extension/vendor/pdfjs/PDFJS-LICENSE`; copyright headers retained in modules |
| Mozilla Readability | 0.6.0 | https://github.com/mozilla/readability | Apache-2.0: `extension/vendor/READABILITY-LICENSE.md`; copyright header retained |
| fflate | 0.8.3 | https://github.com/101arrowz/fflate | MIT: `extension/vendor/FFLATE-LICENSE` |

The PDF.js distribution includes standard-font and WebAssembly assets under
additional upstream terms. All supplied license files are retained beside
their assets under `extension/vendor/pdfjs/standard_fonts/` and
`extension/vendor/pdfjs/wasm/`. In particular these include Liberation and Foxit
font notices, OpenJPEG, QCMS, QuickJS, JBIG2, and the PDF.js wrapper notices.
The reader imports PDF page text and renders the page; PDF scripting is not enabled.

The upstream npm release tarballs used for reproducible provenance were:

- `pdfjs-dist-6.5.438.tgz`, SHA-256 `7461aefcd27c4ef0dd76f9ca5760f09466eb6b3f934432670c12132e7b3d6faa`
- `readability-0.6.0.tgz`, SHA-256 `6d3c3cc50dad51b543925deadc66d5b58cd2262d1d585f2ae0a44975627ad919`
- `fflate-0.8.3.tgz`, SHA-256 `38c2cd824402407b43153c782274aec2ea83ea688e4aa0b743c5f2c305857d92`

No speech model weights, private documents, credentials, browser sessions,
Python runtime, PyMuPDF package, or CUDA libraries are distributed by this release.
Browser and operating-system voices remain separately supplied components.

## Optional neural speech components

- ONNX Runtime Web 1.22.0, MIT, source https://github.com/microsoft/onnxruntime/tree/v1.22.0. Full LICENSE and ThirdPartyNotices.txt are in `extension/vendor/neural/ort/`.
- Piper phonemizer WASM from `@diffusionstudio/piper-wasm@1.0.0`; wrapper MIT, embedded eSpeak NG GPL-3.0-or-later. Original GPL and wrapper notices, runtime hashes and complete corresponding engine/dictionary sources are included. See `third_party_sources/README.md`; ESM adapter added 2026-11-03, underlying binaries unmodified.
- Optional Kokoro82M FP32 model/Bella: Apache-2.0, pinned upstream revision and SHA-256 in `extension/neural-models.js`. No weights distributed in the extension or source ZIP.
- Optional Piper Thorsten high: upstream model repository MIT; Thorsten voice dataset CC0 as stated by its retained model card. No weights distributed in the extension or source ZIP.

The neural runtime does not incorporate the unused `phonemizer` npm package or Transformers.js. It calls the local Piper/eSpeak phonemizer and ONNX Runtime directly.
