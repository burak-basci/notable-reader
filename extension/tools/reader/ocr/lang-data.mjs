/* OCR language data (tessdata_fast) · own code MIT.
 * Only these six files are ever fetched, and only after the user's click. Each one is pinned three ways: revision of the mirror, exact size and SHA-256.
 * The bytes are identical to tesseract-ocr/tessdata_fast at commit 87416418657359cb625c412a48b6e1d6d41c29bd (checked 10.11.2026; the mirror on
 * Hugging Face is used because the extension pages already may connect there, so no new host is needed). A wrong byte is rejected by downloadVerified. */
import {downloadVerified} from '../neural-download.js';

export const OCR_DATA_CACHE = 'notable-reader-ocr-data-v1';
const MIRROR = 'https://huggingface.co/lm-kit/tessdata-fast/resolve/bc1f3580293f86fabee4b57cdff0c96a7d15bef0/';
export const OCR_LANGUAGES = [
  {ui: 'de', code: 'deu', bytes: 1525436, sha256: '19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d'},
  {ui: 'en', code: 'eng', bytes: 4113088, sha256: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2'},
  {ui: 'fr', code: 'fra', bytes: 1130365, sha256: 'ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca'},
  {ui: 'es', code: 'spa', bytes: 2294433, sha256: '6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464'},
  {ui: 'it', code: 'ita', bytes: 2701314, sha256: 'b8f89e1e785118dac4d51ae042c029a64edb5c3ee42ef73027a6d412748d8827'},
  {ui: 'pt', code: 'por', bytes: 1982756, sha256: 'c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb'}
].map(item => ({...item, url: `${MIRROR}${item.code}.traineddata`}));

export const languageByCode = code => OCR_LANGUAGES.find(item => item.code === code) || null;
/** Language of the document (PDF /Lang, "de-DE", "pt_BR", ...) or of the UI ("de"), else the UI fallback. Returns a tessdata code. */
export function chooseLanguage(documentLanguage, uiLanguage) {
  const base = value => String(value || '').toLowerCase().split(/[-_]/u)[0];
  return (OCR_LANGUAGES.find(item => item.ui === base(documentLanguage)) || OCR_LANGUAGES.find(item => item.ui === base(uiLanguage)) || OCR_LANGUAGES[1]).code;
}

const open = () => globalThis.caches.open(OCR_DATA_CACHE);
export async function languageInstalled(code) { const file = languageByCode(code); try{return !!file && !!(await (await open()).match(file.url));}catch{return false;} }
/** Downloads (once, verified) and returns the bytes. onProgress(bytesLoaded, bytesTotal) only while the network is used. */
export async function ensureLanguage(code, {signal, onProgress = () => {}, messages} = {}) {
  const file = languageByCode(code);
  if (!file) throw new Error('Diese Sprache wird von der Texterkennung nicht unterstützt.');
  const cache = await open();
  await downloadVerified(cache, {url: file.url, bytes: file.bytes, sha256: file.sha256}, {signal, onProgress: loaded => onProgress(loaded, file.bytes), messages});
  const response = await cache.match(file.url);
  if (!response) throw new Error('Das Sprachpaket der Texterkennung fehlt im lokalen Speicher.');
  return new Uint8Array(await response.arrayBuffer());
}
export async function clearLanguages() { return globalThis.caches.delete(OCR_DATA_CACHE); }
