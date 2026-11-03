# Local audiobook export contract

```js
import {AudiobookExport, clearAudiobookStorage} from './audio-export.js';
const exporter = new AudiobookExport({models: localModels});
const result = await exporter.exportBook({
  text: reader.text,             // the ENTIRE imported document, not a selection
  modelId: 'kokoro',             // 'kokoro' (English) or 'piper' (German)
  format: 'mp3',                 // 'mp3' or 'wav'
  title: 'My audiobook',
  signal: abortController.signal,
  sink: optionalWritableFileStream,
  onProgress: progress => { /* update UI; never upload document data */ }
});
```

The model must already be installed through the user's explicit download.
The export module never downloads a model, uses a server voice, or claims that
Web Speech system voices can be captured into a file. Pause/lock the reader and
call `models.cancelSynthesis()` before starting an export to invalidate old
playback/prefetch requests. Keep file imports, voice/model changes and deletion
locked while an export is running. The module itself rejects overlapping jobs.

`text` is processed completely by a generator in source order, with at most
230 UTF-16 code units per synthesis span. The limit protects neural token
windows; it is not a document-length limit. Spaces/newlines between spans do
not produce spoken audio; all non-whitespace text, including the last sentence,
is retained. One span of Float32 PCM exists at a time. The MP3 encoder consumes
1152-sample blocks and the output writer aggregates at most 256 KiB. No full
book PCM buffer, WAV concatenation in RAM, or word-count paywall is used.

Export synthesis always uses `rate: 1`. Preview tempo/volume do not alter the
download. MP3 is 64 kbit/s mono (approximately 28.8 MB/hour). WAV is mono PCM16
at the voice's native sample rate: 22,050 Hz for Thorsten, 24,000 Hz for Bella.
The user can change listening speed in their audio player. Conversion duration
depends on the device and book; real-time or faster conversion is not promised.

## Output and storage

The result is:

```js
{
  filename, mime, bytes, duration, sampleRate, samples,
  completedChunks, totalChunks, totalCharacters,
  storage: 'file' | 'opfs' | 'indexeddb' | 'memory',
  blob: Blob | null,
  cleanup: async () => {}
}
```

When a user-clicked File System Access picker is available, obtain its handle
in the click gesture before asynchronous work and pass `await handle.createWritable()`
as `sink`. It must provide `write`, `close`, and `abort`. WAV also needs `seek`
or positional `write({type:'write',position,data})`. The module closes the file
only after every span has been written; on failure/abort it aborts the writable.
Here `blob` is null and the selected file is already saved.

Without a supplied sink, output is written to a temporary, randomly named OPFS
file. If OPFS is unavailable, IndexedDB stores bounded encoded Blob parts. The
result is a disk-backed Blob/File for an explicit download link. After revoking
any Object URL and releasing the download/preview, call `result.cleanup()`.
Do not delete the underlying temporary file before a download finishes.

If neither storage API is available, a small-memory fallback has a **32 MiB
encoded-audio limit**. It fails clearly at the limit and never silently cuts a
book. The user can choose direct file saving, another capable browser, or
individual chapters. WAV's RIFF format is additionally limited to just under
4 GiB; MP3 is appropriate for longer books. Disk quotas and browser limits can
still stop an export; it is reported as a failure, not a partial success.

Temporary encoded audio can remain locally after a tab/browser crash. The
explicit `clearAudiobookStorage()` command deletes orphaned OPFS/IndexedDB
audio jobs and returns `{removed,skipped,unavailable,message}`. Each active job
and ready file holds a browser Web Lock until `cleanup`; another tab's cleanup
skips it. A tab crash releases the lock. Without Web Locks the command refuses
unsafe cross-tab deletion and explains how to clear site data in browser
settings. The UI must disclose temporary local audio storage and offer deletion.

## Progress and cancellation

Progress fields: `phase`, `message`, `completedChunks`, `totalChunks`,
`processedCharacters`, `totalCharacters`, `bytes`, `samples`, `sampleRate`,
`duration`, `percent`. Phases are `preparing`, `synthesizing`, `encoding`,
`saving`, `done`, `aborted`, `error`. Only `done` has 100 percent. Bytes and
duration are actual produced output, not an invented estimate.

Abort through the supplied AbortSignal or `exporter.cancel()`. Before final
commit this terminates the active neural worker, invalidates queued/pending
initialization, discards temporary output/aborts the file, and rejects with
`AbortError`. New work can start afterward. Once **`saving`** begins, all PCM
and encoded bytes are written and atomic `close()` is the commit boundary.
Disable Cancel during this short phase; a late abort cannot truthfully promise
that a completed file was not saved. It returns the complete result instead.

The encoder is a bundled, separately replaceable ES module. Exact source,
license texts, provenance, and build/replacement instructions are supplied in
`extension/vendor/export/NOTICE.md`.
