# Product privacy

Version 2.3.1, 5 November 2026. Operator: Burak Basci. The full website and
payment privacy notice is https://reader.benotable.de/privacy.

The reader processes user-selected documents and article text in the browser.
Notable Reader has no document-upload server. Imported text and files are held
in the current reader session; they are not stored in bookmarks or analytics.

The web/document reader uses localStorage under the key `notable-reader-v2`.
The article extension uses chrome.storage.local under `notableReaderV2`.
These stores contain voice identifier, playback rate, volume, language/options
and document fingerprint/section-number pairs. The document reader preserves existing bookmarks; the article player retains its bounded set of up to 100. They contain no
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
advertising scripts, mandatory reading account or telemetry endpoint. Premium uses the separate payment and license service below.

Optional neural voices download only on a deliberate click. The download requests
public files from huggingface.co and its delivery CDN, without credentials or
a document-bearing request body. Sizes and SHA-256 fingerprints are pinned.
The provider sees normal technical connection metadata. Models are stored in
CacheStorage `notable-reader-neural-models-v1`; **Lokale KI-Modelle löschen**
removes this cache. Voice models and language modules can be large; precise
model sizes and the additional shared module download are shown before the click.
Text-to-speech inference and audio generation then happen on the device.

The article button **Lokale KI-Stimme öffnen** transfers the selected article
text, title, language, confirmed document appearance and safely readable local raster illustrations via temporary chrome.storage.session to the extension's own reader page. Pictures are copied from already loaded pixels, never fetched again for the handoff; browser CORS restrictions remain in force. Unavailable pictures produce a visible warning instead of a claim of complete image fidelity.
The handoff is removed after retrieval. An unopened handoff expires after five
minutes and is cleaned during the next handoff; closing/restarting the browser
clears this session store. It is never copied into persistent settings.

## Local audiobook export

MP3/WAV export uses the deliberately downloaded local neural model and an on-device encoder. Native browser/system voices do not expose exportable audio and are not recorded. Document text and generated audio are not uploaded. The entire opened text is processed in sequential chunks; the original document text is not persisted by the export module.

Depending on browser capabilities, audio is written to an explicitly selected file, temporary Origin Private File System storage, IndexedDB (`notable-reader-audiobook-exports`) or a bounded memory fallback. These local temporary audio files can remain after a browser crash. The export cleanup button removes unused temporary exports while protecting active jobs in other tabs where browser locks are supported. Browser/site storage controls can clear these stores. A finished file downloaded to the user's own folder remains there until the user deletes it.

## Extension Premium and payments

Reading and all website exports remain free without a mandatory account. Downloads
in the extension require Premium (€2.99 monthly or lifetime access from one payment
of at least €100). The extension connects only to https://reader-premium.benotable.de
for activation, renewal and payment management. It stores a random device identifier
and a short-lived Ed25519-signed entitlement locally, separately from document settings.
Activation uses a code from the payment flow; renewal submits the signed entitlement
and device identifier. No document text, document URL, filename or audio is included.
A changed, expired, incorrectly signed or differently bound entitlement cannot
authorize an extension export. Website exports make no license request.

Stripe collects the checkout email and necessary payment information; the license
service associates payment references with an opaque device identifier. Payment
management opens Stripe's existing email-based billing portal. No additional Reader
password is needed. Deleting local license data requires reactivation; removing
local data does not cancel a paid subscription. Use the billing portal to cancel.
