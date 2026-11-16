/* Offer and progress panel of the text recognition in the file view · own code MIT.
 * One panel for scanned PDFs and images: offer (language, one-time download size, start) -> run (progress "page n of m", cancel) -> back to the offer
 * after a cancel or an error, so the user can retry. It only manipulates the static markup of reader.html; texts come from the UI catalog (mt). */
import {OCR_LANGUAGES, languageInstalled} from './lang-data.mjs';

export function createOcrPanel({root, mt, uiLanguage, onStart, onCancel}) {
  const $ = selector => root.querySelector(selector);
  const title = $('#ocr-title'), select = $('#ocr-lang'), size = $('#ocr-size'), start = $('#ocr-start'), run = $('#ocr-run'), bar = $('#ocr-bar'), line = $('#ocr-progress'), cancel = $('#ocr-cancel');
  let kind = 'pdf', mode = 'hidden';
  const names = () => { try { return new Intl.DisplayNames([uiLanguage() || 'de'], {type: 'language'}); } catch { return null; } };
  const mb = bytes => (bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1);
  async function sizeNote() {
    const file = OCR_LANGUAGES.find(item => item.code === select.value);
    size.textContent = file ? ((await languageInstalled(file.code)) ? mt('ocrInstalledNote') : mt('ocrDownloadNote', {mb: mb(file.bytes)})) : '';
  }
  function fill(selected) {
    const display = names();
    select.replaceChildren(...OCR_LANGUAGES.map(item => { const option = document.createElement('option'); option.value = item.code; option.textContent = display?.of(item.ui) || item.ui; return option; }));
    select.value = selected;
  }
  select.addEventListener('change', () => void sizeNote());
  start.addEventListener('click', () => { if (mode === 'offer') onStart({kind, lang: select.value}); });
  cancel.addEventListener('click', () => { if (mode === 'run') onCancel(); });
  return {
    /** Show the offer. kind: 'pdf' | 'image'; lang: tessdata code preselected. */
    offer({kind: next = 'pdf', lang = 'eng'} = {}) {
      kind = next; mode = 'offer'; root.hidden = false; run.hidden = true; start.hidden = false; select.disabled = false; select.closest('.ocr-field').hidden = false; size.hidden = false;
      title.textContent = mt(kind === 'image' ? 'ocrOfferTitleImage' : 'ocrOfferTitlePdf'); fill(lang); void sizeNote();
    },
    /** The run view: hides the offer controls, shows the bar. */
    running() { mode = 'run'; root.hidden = false; start.hidden = true; select.closest('.ocr-field').hidden = true; size.hidden = true; run.hidden = false; bar.removeAttribute('value'); line.textContent = mt('ocrProgressPrepare'); cancel.focus(); },
    progress(event) {
      if (mode !== 'run') return;
      if (event.phase === 'download') { const fraction = event.total ? event.loaded / event.total : 0; bar.value = fraction; line.textContent = mt('ocrProgressDownload', {percent: Math.floor(fraction * 100)}); }
      else if (event.phase === 'start') { bar.removeAttribute('value'); line.textContent = mt('ocrProgressPrepare'); }
      else if (event.phase === 'page') { bar.value = ((event.index - 1) + (event.fraction || 0)) / Math.max(1, event.total); line.textContent = mt('ocrProgressPage', {index: event.index, total: event.total}); }
    },
    hide() { mode = 'hidden'; root.hidden = true; },
    get mode() { return mode; },
    refresh() { if (mode !== 'hidden') { title.textContent = mt(kind === 'image' ? 'ocrOfferTitleImage' : 'ocrOfferTitlePdf'); fill(select.value); void sizeNote(); } }
  };
}
