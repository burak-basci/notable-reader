# Reproduce audiobook acceptance

Install the project's development dependencies (`npm install --ignore-scripts`)
and a Playwright Chromium build (`npx playwright install chromium`). FFmpeg and
ffprobe must be installed for independent full-file decoding. The real test
does not play audio into the user's desktop and starts one isolated Chromium
at a time with `--mute-audio`.

The test requires the **public** Kokoro FP32 model files already downloaded
under `~/.cache/notable-reader-models` (or `READER_MODEL_FIXTURES`). It never
silently downloads 326 MB from a third party. Expected local filenames:

| Local file | Public source at fixed revision | SHA-256 |
|---|---|---|
| `kokoro-fp32.onnx` | [model.onnx](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/onnx/model.onnx) | `8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb` |
| `af_bella.bin` | [Bella](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_bella.bin) | `f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b` |
| `kokoro-tokenizer.json` | [tokenizer.json](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/tokenizer.json) | `77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34` |

These files are checked by size and SHA-256 before the browser starts. A private
Companion Kokoro model with a different fingerprint is not interchangeable.
Model provenance/licensing is also in `extension/neural-models.js`.

From the repository root:

```sh
node tests/audiobook-export/acceptance.mjs
```

Only the complete successful run prints `EXPORT ACCEPTANCE PASSED`.
Reports and downloaded MP3/WAV output default to `qa/audiobook-export/`.
Optional environment variables:

- `AUDIOBOOK_REPORT_DIR`: a test-only output/profile directory with enough disk
  space (avoid a quota-limited `/tmp` for the model cache).
- `READER_PLAYWRIGHT_MODULE`: alternate installed `playwright-core` module path.
- `READER_MODEL_FIXTURES`: directory containing the three checked model files.
- `AUDIOBOOK_TEST_PORT`: local real-test port, default 47839; do not run two
  full acceptance jobs simultaneously on the same port/profile.
- `AUDIOBOOK_BOOK_PATH`: alternate path to the identical checked complete story.

The complete public-domain **The Tale of Peter Rabbit** narrative is bundled
under `fixtures/`: 950 words, from the first story sentence through THE END.
Only non-narrative illustration markers, publisher text and source licence
boilerplate were removed from the export fixture. The original full Gutenberg
text (including source/licence notices) and source hashes are preserved next
to it. The source narrative hash excludes the final file newline; the actual
export includes that newline as well. This is a complete book, not a sample
sentence or a 230-character excerpt.

The real test performs genuine Kokoro ONNX/WASM inference, exports a short
WAV and the entire book as MP3, downloads both through the browser, and uses
FFmpeg to decode every frame. Decoder PCM is inspected in 64 KiB blocks and
deleted afterward. Duration, sample count, mono codec, peak/RMS, actual file
size, complete text/section counts, and absence of external requests are checked.
The same browser verifies temporary-file lock protection and orphan deletion.

Separate clearly labelled deterministic PCM tests exercise 100,000 words/all
chunks, streaming writes, 32 MiB fallback failure, quotas, safe cancellation,
model-consent prerequisites, stale worker initialization, and the atomic-close
abort race. Browser storage tests exercise actual IndexedDB, memory fallback,
and cross-tab lock protection. Deterministic tests are never presented as
evidence of a real neural voice or subjective audio quality.

The API contract is [API.md](API.md).
