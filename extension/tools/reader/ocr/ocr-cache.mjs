/* Per-document OCR result cache (IndexedDB) · own code MIT.
 * One record per page, so an aborted run keeps its finished pages and a later run continues where it stopped. The document key is the SHA-256 of the
 * file bytes plus language and engine version; nothing here ever leaves the device. At most MAX_DOCS documents are kept (least recently used go first). */
export const ENGINE_VERSION = 'tesseract.js-7.0.0/core-7.0.0/fast-87416418';
const DB = 'notable-reader-ocr', MAX_DOCS = 24;

/** Words are stored as flat integer rows [start, end, x0, y0, x1, y1, conf(, x0b, y0b, x1b, y1b)], boxes in 1/10000 of the page. */
export const packWords = words => words.map(word => [word.start, word.end, ...word.bbox.map(value => Math.round(value * 10000)), word.conf, ...(word.bbox2 ? word.bbox2.map(value => Math.round(value * 10000)) : [])]);
export const unpackWords = (rows, text) => rows.map(row => ({text: text.slice(row[0], row[1]), start: row[0], end: row[1], bbox: row.slice(2, 6).map(value => value / 10000), conf: row[6], ...(row.length > 7 ? {bbox2: row.slice(7, 11).map(value => value / 10000)} : {})}));

export async function documentKey(bytes, language) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `${Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')}|${language}|${ENGINE_VERSION}`;
}

function request(target) { return new Promise((resolve, reject) => { target.onsuccess = () => resolve(target.result); target.onerror = () => reject(target.error); }); }
let opened = null;
function database() {
  opened ||= new Promise((resolve, reject) => {
    const open = globalThis.indexedDB.open(DB, 1);
    open.onupgradeneeded = () => { const db = open.result; db.createObjectStore('pages', {keyPath: ['doc', 'n']}); db.createObjectStore('docs', {keyPath: 'doc'}); };
    open.onsuccess = () => { open.result.onversionchange = () => { open.result.close(); opened = null; }; resolve(open.result); };
    open.onerror = () => { opened = null; reject(open.error); };
  });
  return opened;
}
const done = transaction => new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(transaction.error); });

export async function getPage(doc, n) {
  try {
    const db = await database(), record = await request(db.transaction('pages').objectStore('pages').get([doc, n]));
    return record ? {n, text: record.text, words: unpackWords(record.words, record.text), confidence: record.confidence, cached: true} : null;
  } catch { return null; }
}
export async function putPage(doc, page) {
  try {
    const db = await database(), transaction = db.transaction(['pages', 'docs'], 'readwrite');
    transaction.objectStore('pages').put({doc, n: page.n, text: page.text, words: packWords(page.words), confidence: page.confidence});
    transaction.objectStore('docs').put({doc, at: Date.now()});
    await done(transaction);
  } catch { /* a full or blocked store only means "no cache" */ }
}
/** Marks the document as used and trims the store to MAX_DOCS documents. */
export async function touch(doc) {
  try {
    const db = await database(), docs = await request(db.transaction('docs').objectStore('docs').getAll());
    const stale = docs.filter(item => item.doc !== doc).sort((a, b) => b.at - a.at).slice(MAX_DOCS - 1);
    const transaction = db.transaction(['pages', 'docs'], 'readwrite');
    transaction.objectStore('docs').put({doc, at: Date.now()});
    for (const item of stale) {
      transaction.objectStore('docs').delete(item.doc);
      transaction.objectStore('pages').delete(IDBKeyRange.bound([item.doc, 0], [item.doc, Infinity]));
    }
    await done(transaction);
  } catch { /* ignore */ }
}
export async function clearCache() {
  try { const db = await database(), transaction = db.transaction(['pages', 'docs'], 'readwrite'); transaction.objectStore('pages').clear(); transaction.objectStore('docs').clear(); await done(transaction); } catch { /* ignore */ }
}
