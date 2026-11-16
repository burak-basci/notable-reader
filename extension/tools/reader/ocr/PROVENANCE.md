# OCR vendor files (beNotable! Reader)

Files from npm, Apache-2.0 (licence texts next to them). `tesseract.esm.min.js` and `worker.min.js` carry exactly one edit: the default download host of the
library (`cdn.jsdelivr.net`, used only when no path is configured, which this package always does) is replaced by `no-code-cdn.invalid`, so the package contains
no address from which code could ever be loaded (Chrome MV3: no remotely hosted code). Original SHA-256: tesseract.esm.min.js 64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29,
worker.min.js 576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d; the core file is unmodified:

| File | Package | npm integrity (sha512) |
|---|---|---|
| vendor/tesseract.esm.min.js, vendor/worker.min.js | tesseract.js 7.0.0 (dist/) | exPBkd+z+wM1BuMkx/Bjv43OeLBxhL5kKWsz/9JY+DXcXdiBjiAch0V49QR3oAJqCaL5qURE0vx9Eo+G5YE7mA== |
| vendor/tesseract-core-simd-lstm.wasm.js | tesseract.js-core 7.0.0 (WebAssembly with SIMD, LSTM only, embedded) | WnNH518NzmbSq9zgTPeoF8c+xmilS8rFIl1YKbk/ptuuc7p6cLNELNuPAzcmsYw450ca6bLa8j3t0VAtq435Vw== |

The core bundles Tesseract (Apache-2.0) and Leptonica (BSD-2-Clause); its build recipe and the sources of all dependencies are in the upstream
repository of tesseract.js-core (folder third_party). Language data (tessdata_fast, Apache-2.0) is NOT in the package: it is downloaded after the
user's click (see lang-data.mjs: pinned revision, size and SHA-256 per file).
