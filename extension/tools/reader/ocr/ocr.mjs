/* Local text recognition (OCR) for scanned PDFs and images · own code MIT, engine: tesseract.js / Tesseract (Apache-2.0), files in ./vendor.
 * Standalone ES module: the file view and the web app both use
 *     const result = await ocrDocument(pdfDoc, {lang: 'deu', onProgress, signal, cacheKey})   // -> {lang, pages: [{n, text, words, confidence, cached}]}
 * `pdfDoc` is a pdf.js document (or imageSource(blob)). Everything runs on this device: the engine is code in the package (no remote code), the language
 * data is fetched once from a pinned address with size and SHA-256 check (lang-data.mjs), pages go through the engine one at a time.
 * onProgress({phase: 'download', loaded, total} | {phase: 'start'} | {phase: 'page', n, index, total, fraction} | {phase: 'done'}). */
import {layoutPage} from './layout.mjs';
import {ensureLanguage, languageByCode} from './lang-data.mjs';
import * as cache from './ocr-cache.mjs';

export {chooseLanguage, OCR_LANGUAGES, languageByCode, languageInstalled, ensureLanguage, clearLanguages} from './lang-data.mjs';
export {scanVerdict, visibleChars, MIN_CHARS} from './scan-detect.mjs';
export {documentKey, clearCache, ENGINE_VERSION} from './ocr-cache.mjs';

export const TARGET_DPI = 300;            // x-height of about 25-30 px, what the LSTM model is trained for
export const MAX_PIXELS = 10_000_000;     // one page raster stays below ~40 MB (A4 at 300 dpi = 8.7 MP); larger sheets render at lower dpi (A3: 227)
const abortError = () => new DOMException('Abgebrochen', 'AbortError');
const throwIfAborted = signal => { if (signal?.aborted) throw abortError(); };

/** Render scale (pdf.js: 1 = 72 dpi) for a page of width x height points. */
export const ocrScale = (width, height) => Math.min(TARGET_DPI / 72, Math.sqrt(MAX_PIXELS / Math.max(1, width * height)));

/** pdf.js-like single-page document for an image file (PNG, JPEG, WebP). Small images are enlarged 2x (the engine needs readable letter sizes). */
export async function imageSource(blob) {
  const bitmap = await createImageBitmap(blob);
  if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>64_000_000){bitmap.close?.();throw new Error('Das Bild ist zu groß für die lokale Texterkennung.');}
  const factor = Math.max(bitmap.width, bitmap.height) < 1500 ? 2 : 1, base = {width: bitmap.width * factor * 72 / TARGET_DPI, height: bitmap.height * factor * 72 / TARGET_DPI};
  const page = {
    getViewport: ({scale}) => ({width: base.width * scale, height: base.height * scale, scale}),
    render: ({canvasContext, viewport}) => ({promise: Promise.resolve().then(() => { canvasContext.fillStyle = '#fff'; canvasContext.fillRect(0, 0, viewport.width, viewport.height); canvasContext.drawImage(bitmap, 0, 0, viewport.width, viewport.height); })}),
    cleanup() {}
  };
  return {numPages: 1, getPage: async () => page, destroy() { bitmap.close?.(); }};
}

async function renderPage(doc, n) {
  const page = await doc.getPage(n);
  try {
    const base = page.getViewport({scale: 1}), viewport = page.getViewport({scale: ocrScale(base.width, base.height)});
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height));
    try {
      const context = canvas.getContext('2d', {willReadFrequently: false});
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({canvasContext: context, viewport}).promise;
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Die Seite konnte nicht in ein Bild umgewandelt werden.')), 'image/png'));
      return {blob, width: canvas.width, height: canvas.height};
    } finally { canvas.width = canvas.height = 0; }
  } finally { page.cleanup?.(); }
}

/* The worker of tesseract.js 7.0.0 hands an object language {code, data} to its loader but then initialises with `data` as the name (upstream quirk).
 * Its own cache is the way to give it bytes we have already verified: seed its IndexedDB key, start in read-only cache mode, delete the key again. */
const SEED_DB = 'keyval-store', SEED_STORE = 'keyval', SEED_PATH = 'notable-ocr';
function seedKey(code, bytes) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(SEED_DB);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(SEED_STORE)) open.result.createObjectStore(SEED_STORE); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, transaction = db.transaction(SEED_STORE, 'readwrite'), store = transaction.objectStore(SEED_STORE);
      if (bytes) store.put(bytes, `${SEED_PATH}/${code}.traineddata`); else store.delete(`${SEED_PATH}/${code}.traineddata`);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}

async function startEngine(code, bytes, signal, aborted) {
  // Tesseract's shared IndexedDB seed must not be removed while another tab is starting.
  const start = () => startSeededEngine(code,bytes,signal,aborted);
  return globalThis.navigator?.locks?.request ? navigator.locks.request('notable-reader-ocr-seed',signal?{signal}:{},start) : start();
}
async function startSeededEngine(code, bytes, signal, aborted) {
  const Tesseract = (await import('./vendor/tesseract.esm.min.js')).default;
  await seedKey(code, bytes);
  let creating = null;
  try {
    const here = path => new URL(path, import.meta.url).href;
    creating = Tesseract.createWorker(code, 1, {
      workerPath: here('./vendor/worker.min.js'), corePath: here('./vendor/tesseract-core-simd-lstm.wasm.js'), langPath: here('./no-network/'),
      workerBlobURL: false, cacheMethod: 'readOnly', cachePath: SEED_PATH, gzip: false, errorHandler: () => {}
    });
    return await Promise.race([creating, aborted]);
  } catch (error) {
    if (signal?.aborted) { creating?.then(worker => worker.terminate(), () => {}); throw abortError(); }
    throw new Error('Die Texterkennung konnte nicht gestartet werden.');
  } finally { await seedKey(code, null).catch(() => {}); }
}

export async function ocrDocument(doc, {lang = 'eng', onProgress = () => {}, signal, cacheKey = null, pages = null, data = null, messages, onRaw} = {}) {
  if (!languageByCode(lang)) throw new Error('Diese Sprache wird von der Texterkennung nicht unterstützt.');
  throwIfAborted(signal);
  const numbers = (pages && pages.length ? pages : Array.from({length: doc.numPages}, (_, index) => index + 1)).filter(n => Number.isInteger(n) && n >= 1 && n <= doc.numPages);
  const result = new Map();
  if (cacheKey) for (const n of numbers) { const hit = await cache.getPage(cacheKey, n); if (hit) result.set(n, hit); }
  const missing = numbers.filter(n => !result.has(n));
  let worker = null;
  let rejectAbort;const onAbort=()=>rejectAbort(abortError());
  const aborted = new Promise((_, reject) => {rejectAbort=reject;signal?.addEventListener('abort',onAbort,{once:true});});
  aborted.catch(() => {});
  const abortWorker = () => { try { worker?.terminate(); } catch { /* ignore */ } };
  signal?.addEventListener('abort', abortWorker, {once: true});
  try {
    if (missing.length) {
      const bytes = data || await ensureLanguage(lang, {signal, messages, onProgress: (loaded, total) => onProgress({phase: 'download', loaded, total})});
      throwIfAborted(signal);
      onProgress({phase: 'start'});
      worker = await startEngine(lang, bytes, signal, aborted);
    }
    let index = 0;
    for (const n of numbers) {
      throwIfAborted(signal); index++;
      if (result.has(n)) { onProgress({phase: 'page', n, index, total: numbers.length, fraction: 1, cached: true}); continue; }
      onProgress({phase: 'page', n, index, total: numbers.length, fraction: 0});
      const image = await renderPage(doc, n);
      throwIfAborted(signal);
      let recognized;
      try { recognized = await Promise.race([worker.recognize(image.blob, {}, {text: false, blocks: true}), aborted]); }
      catch (error) { if (signal?.aborted) throw abortError(); throw new Error('Die Texterkennung ist bei Seite ' + n + ' fehlgeschlagen.'); }
      throwIfAborted(signal);
      onRaw?.(n, recognized.data.blocks, image);   // diagnostics hook of the tests
      const layout = layoutPage(recognized.data.blocks, {width: image.width, height: image.height}), page = {n, ...layout, cached: false};
      result.set(n, page);
      if (cacheKey) await cache.putPage(cacheKey, page);
      onProgress({phase: 'page', n, index, total: numbers.length, fraction: 1});
    }
    if (cacheKey) await cache.touch(cacheKey);
    onProgress({phase: 'done'});
    return {lang, pages: numbers.map(n => result.get(n))};
  } finally { signal?.removeEventListener('abort', abortWorker); signal?.removeEventListener('abort',onAbort); abortWorker(); }
}
