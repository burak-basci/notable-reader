# Privacy · beNotable! Reader

Version 2.5.3, 20 November 2026. Operator: Burak Basci, contact burakbascidev@gmail.com.
This file describes what the code in this repository does: the browser extension (`extension/`) and the web app built
from the same modules (https://reader.benotable.de/app/). The extension ships the same description as
`extension/PRIVACY.md`; the website has its own notice for the website itself (https://reader.benotable.de/privacy).

## Free, no account, no identifier

All Reader functions and downloads are free. There is no Reader account, no licence check, no device identifier,
no usage analytics, no rating counter, no advertising and no telemetry endpoint. A voluntary payment unlocks nothing.
Local licence data and counters of the older 2.3/2.4 versions are deleted during the update; settings, reading
positions, history and models are kept.

## Processing stays on the device

Page text, imported files (PDF, EPUB, DOCX, TXT, Markdown, HTML, images), text recognition (OCR), explanations and
the generated audio are processed in the browser on your device. Reader voices compute speech locally with
WebAssembly (ONNX Runtime). No document text, title, address, file name or audio is sent to a server operated by
the Reader, and the code contains no credentials for external AI services.

## What is stored on this device

- Settings (voices, tempo, appearance, reading rules, keyboard) and reading positions: extension storage
  (`chrome.storage.local`, key `pageSettings` and related keys); in the web app `localStorage` with the prefix
  `notable.web.`.
- Reading history: only during actual playback, the history keeps the source address or file name, the title, a
  text copy, the time and your position, so you can continue later. Private windows are left out. The listening
  list, bookmarks, saved documents and generated audio files are kept separately. All of this lives in the
  IndexedDB database `benotable-reader-library-v1` and can be deleted in the library views.
- Downloaded voices: Cache Storage `notable-reader-neural-models-v1`. Explanation models and OCR language data use
  their own local caches. They stay until you remove them (Settings, file view "Delete AI models") or clear
  browser data.
- Temporary audiobook files: Origin Private File System or IndexedDB `notable-reader-audiobook-exports`, removed
  after the download, by cancelling or with the cleanup button; a browser crash can leave them until then.
- Hand-over of a page to the file view / focus view: `chrome.storage.session`, removed when the view reads it,
  expires after five minutes, gone when the browser closes.
- The web app's service worker caches the public program files for offline use; your documents never pass
  through it.

Your browser profile, device backups and files you export can contain copies of this data. Removing the
extension does not delete files you already saved.

## Network connections

The Reader connects to the network only when you ask for something that needs a download:

- Voices, explanation models (IBM Granite 4.0 350M, about 580 MB, or Qwen3.5-0.8B, about 668 MB) and OCR language
  packs (about 1 to 4 MB per language) come from Hugging Face (`huggingface.co`, `*.huggingface.co`, `*.hf.co`,
  `*.xethub.hf.co`). Every file is pinned to a fixed revision and checked by size and SHA-256; requests carry no
  cookies, no referrer and no document text. The provider receives your IP address and normal HTTP request data.
  The size of a download is shown before you start it.
- Links (voluntary support via Stripe, source code on GitHub, the website, the Chrome Web Store, sharing via
  WhatsApp) open only when you click them. Those sites have their own privacy information. The Reader passes no
  document content or identifier to them.
- In the web app, the hosting server of reader.benotable.de receives the normal request data of the page and its
  program files (see the website privacy notice). The app itself contains no analytics.

## Extension permissions

`activeTab` and `scripting` read the page you ask the Reader to read. `storage` and `unlimitedStorage` keep
settings, library and models. `offscreen` (Chrome) runs the voices and audio in a hidden extension document.
Optional, requested only when you use the feature: `downloads` (settings file, show saved files), `sidePanel`
(reader in the side panel), `webNavigation` (only to list the frames of the current tab when a page's text sits
in an embedded frame), and access to a single website when its text sits in a frame of that site or for automatic
chapter continuation. The extension asks for no blanket access to all websites at installation. Granted
permissions can be revoked in the browser's extension manager.
