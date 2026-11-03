# Product privacy

Version 2.1.0, 3 November 2026. Operator: Burak Basci. The full website and
payment privacy notice is https://reader.benotable.de/privacy.

The reader processes user-selected documents and article text in the browser.
Notable Reader has no document-upload server. Imported text and files are held
in the current reader session; they are not stored in bookmarks or analytics.

The web/document reader uses localStorage under the key `notable-reader-v2`.
The article extension uses chrome.storage.local under `notableReaderV2`.
These stores contain voice identifier, playback rate, volume, language/options
and up to 100 document fingerprint/section-number pairs. They contain no
document text, filename, full document URL or account identity. Data remains
until the user deletes it, the browser clears it, or the extension is removed.
The reader's deletion button clears its own settings/bookmarks. Browser and
extension settings are distinct stores and have their own deletion button.

The installable web app caches public program files, fonts and parsing modules
for offline use. User documents are not passed through its network/cache
handler. Browser/site storage settings can remove this application cache.

Only voices the browser marks as local are offered by default. Enabling online
voices can transmit speech text to the voice provider under that provider's
terms. Notable Reader does not operate those voices or receive their audio.

Clicking website/support links makes a normal external navigation. The website
host and payment provider can process connection/payment data as described
in the website privacy notice. The product contains no analytics trackers,
advertising scripts, product account or telemetry endpoint.

Optional neural voices download only on a deliberate click. The download requests
public files from huggingface.co and its delivery CDN, without credentials or
a document-bearing request body. Sizes and SHA-256 fingerprints are pinned.
The provider sees normal technical connection metadata. Models are stored in
CacheStorage `notable-reader-neural-models-v1`; **Lokale KI-Modelle löschen**
removes this cache. Voice models and language modules can be large; precise
model sizes and the additional shared module download are shown before the click.
Text-to-speech inference and audio generation then happen on the device.

The article button **Lokale KI-Stimme öffnen** transfers the selected article
text via temporary chrome.storage.session to the extension's own reader page.
The handoff is removed after retrieval. An unopened handoff expires after five
minutes and is cleaned during the next handoff; closing/restarting the browser
clears this session store. It is never copied into persistent settings.
