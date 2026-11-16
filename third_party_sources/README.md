# Corresponding phonemizer sources

The optional neural runtime includes eSpeak NG under GPL-3.0-or-later. The
complete applicable source code and the upstream build instructions are
included here rather than being replaced by a link. The combined neural
distribution is provided under GPL-3.0-or-later; original MIT and Apache grants
for individual components are retained. The full GPL text is `GPL-3.0.txt`.

## Binary provenance

The runtime files `piper_phonemize.wasm`, `piper_phonemize.data` and the factory
in `piper_phonemize.mjs` originate from npm
`@diffusionstudio/piper-wasm@1.0.0`, published with the build instructions copied
verbatim into `PIPER-WASM-UPSTREAM-BUILD.md`. Their SHA-256 fingerprints are
listed in `extension/vendor/neural/runtime-hashes.json` at repository root.
The only JavaScript adapter change is an added ES-module default export and a
comment identifying the change, dated 3 November 2026. No binary patch was made.

The published build instructions identify Emscripten 3.1.47 and the
wide-video/piper-phonemize fork. `piper-phonemize/` contains the complete source
snapshot `cfff8e52ebaea37c7e953ae2d06b174acb827ac4` from that fork, as current at
the documented June 2024 build. Its CMakeLists.txt explicitly pins the eSpeak NG
source to `0f65aa301e0d6bae5e172cc74197d32a6182200f`; that complete source is in
`espeak-ng/`, including its dictionaries, headers, licenses and build files.
The upstream repository/source-archive fingerprints are in `provenance.json`.

The separate native preparation of `espeak-ng-data` in those build instructions
used the rhasspy/espeak-ng tree current at that date,
`8593723f10cfd9befd50de447f14bf0a9d2a14a4`. It differs from the included eSpeak
base in only seven build/compatibility files. To avoid distributing thousands
of duplicate files, those full changed files plus a complete per-path hash
manifest are stored in `espeak-ng-data-source/`. Reconstruct the entire original
tree without a network request:

```sh
python3 tools/reconstruct_sources.py /a/new/directory/espeak-ng-data-source
```

The command verifies all 2,534 files against the manifest and refuses an
existing destination. This is a lossless source representation, not a partial
source reference. The full engine source, language/dictionary data and required
build instructions are available in this distribution. Bit-for-bit compiler
reproduction of the upstream binaries is not claimed.

The original piper-phonemize repository also contains an unused Arabic
`etc/libtashkeel_model.ort` binary. It is not part of the WebAssembly runtime,
is not referenced by this fork's phonemizer build and is intentionally omitted.
All source files are retained; no required engine source or dictionary is
omitted. General-purpose compilers and Emscripten are not bundled.

## Rebuilding

Use `PIPER-WASM-UPSTREAM-BUILD.md` with the included source directories instead
of its `git clone` commands. Reconstruct the native data-preparation tree as
shown above; use `piper-phonemize/` for the C++ fork and the explicitly pinned
`espeak-ng/` for CMake's external eSpeak source. Its checked-in CMakeLists.txt
shows every feature flag. The upstream Docker/Make/CMake files, standard
headers and original license directories remain alongside the source.

The reader application and integration adapters are ordinary unminified source
under `extension/`. ONNX Runtime is separately MIT-licensed, and PDF.js,
Readability and fflate retain their upstream notices. Speech model weights are
not embedded in this source distribution; the opt-in model catalog provides
their exact upstream revisions, sizes, licenses and SHA-256 values.
