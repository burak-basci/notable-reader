# Privacy and local data

beNotable! Reader – last updated: 20 November 2026

All Reader features and downloads are free. The extension needs no Reader account, creates no device identifier
and contacts no license service. It contains no usage analytics, rating counters or ad trackers. Old local license
and rating counters are removed during the update; settings, reading positions, history and models are kept.

## What is stored on this device

- Settings and chosen voices are kept in the browser profile.
- Reading history: during actual playback, the local reading history saves the source address or file name,
  title, a text copy, the time and your reading position so you can continue later. Private windows are left out
  of the reading history.
- The listening list, bookmarks, saved documents and generated audio files are stored locally and separately.
- History and library can be deleted in their own views.
- Your browser profile, device backups and files you export can contain copies of this data. Access to your
  unlocked browser profile can give access to this local content.

Downloaded speech, text recognition and explanation models stay in the local model storage until you remove them
or clear browser data. Settings can be exported to a file and reset. Removing the extension does not
automatically remove downloads or backup copies you already saved. Storage methods and browser limits differ
between browsers.

## Reading aloud, explanations and network

- Document text, images, text recognition (OCR) results, explanation requests and generated audio are processed
  locally by the Reader features. The extension bundles no credentials for external AI providers and does not
  send document content to such services.
- "Summarize" shows the key passages of a page without any download. For AI explanations (English and German) it uses a local language model (Qwen3.5-0.8B, about 668 MB, or the smaller IBM Granite 4.0 350M, about 580 MB, both Apache-2.0; a copy of the model of earlier versions keeps working until it is replaced). It is downloaded once
  from Hugging Face only after you explicitly click, and then runs in the browser on your device without
  network. The page text stays local.
- System voices are limited to local voices. Whether your operating system's components use additional services
  also depends on its settings. Downloaded Reader voices compute audio in the browser. Without a stored speech
  model, an audio export first requires its download; browser system voices provide no exportable audio file.
- When you explicitly start a download of models or language packs, the file provider receives your IP address
  and technical HTTP request data. Speech and explanation models as well as the language data for text
  recognition (OCR) come from Hugging Face (huggingface.co) and its redirect and file storage services. These
  requests contain no document text. Once the download is complete, the corresponding local processing works
  without network. The browser itself, its extension manager and the website you visit can make their own
  network connections independently of this.
- Downloads are sent without cookies and without a referrer. Every file is pinned to a fixed revision and checked
  by size and SHA-256. The download hosts are `huggingface.co`, `*.huggingface.co`, `*.hf.co` and `*.xethub.hf.co`.
- The language data for text recognition (OCR) is a language pack of about 1 to 4 MB per language, fetched from a
  pinned Hugging Face mirror of `tessdata_fast`.

## Voluntary support and external links

- Only if you open a payment link in the "Support" tab do you switch to Stripe. Stripe and, where applicable,
  the payment processing then handle the payment and contact details you enter there and technical connection
  data according to their own information. The Reader transmits no document content or device identifier for
  this. A payment unlocks nothing; all functions are free. An earlier external payment arrangement is not changed
  by updating this extension.
- Other external links such as the website, source code or help only open when you choose them. Those pages have
  their own privacy information.

## Permissions

- activeTab and scripting allow the processing of the selected page that you request. storage and
  unlimitedStorage hold local settings, content and models; under Chrome, offscreen carries local speech
  computation and playback. Optional permissions for downloads and the side panel are only requested when
  needed. The extension does not request blanket read access to all websites at installation.
- Optional, requested only when you use the feature: `downloads` exports your settings to a file and shows saved
  files in their folder; `sidePanel` (Chrome, Edge) shows the reader in the browser's side panel.
- If a page's text sits in an embedded area (frame) of another website, the popup asks with a button for the
  normal browser permission for exactly that website. Only if the Reader cannot reach the embedded areas
  otherwise is the optional webNavigation permission requested as well; it is used only to list the frames of
  the currently selected tab, and no browsing history is stored or transmitted. Automatic chapter continuation
  also requires permission for the specific website. You can revoke granted permissions in the browser's
  extension manager.

## Contact

Questions about the Reader: burakbascidev@gmail.com. This description documents the extension's data flows; it
is not a commitment about the operating system, browser, external providers or their future behavior.
