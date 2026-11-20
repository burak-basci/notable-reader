/* beNotable! Reader web app · "continue reading" after a reload (own code, MIT).
   The extension has its library; the web app had nothing after a reload (finding M3). This file keeps the LAST opened text ON THIS DEVICE (IndexedDB 'notable-web', store 'last',
   one record) together with its title and fingerprint. The reading place itself stays where the file view already keeps it: the session's resume points (chrome.storage.local
   -> localStorage via web-runtime.mjs). After a reload the start card offers "Continue reading: <title> · at section n" and "Clear history" (removes the text and its place).
   Nothing here sends anything anywhere; a private window or blocked site data simply keeps nothing. Samples (metadata noHistory) are never kept. */
const DB = 'notable-web', STORE = 'last', KEY = 'last', MAX_CHARS = 20_000_000;
const TEXTS = {
  de: {heading: 'Weiterlesen', at: '{title} · bei Abschnitt {n}', start: '{title} · von vorn', resume: 'Weiterlesen', clear: 'Verlauf löschen', note: 'Nur auf diesem Gerät gespeichert.', cleared: 'Verlauf gelöscht.'},
  en: {heading: 'Continue reading', at: '{title} · at section {n}', start: '{title} · from the start', resume: 'Continue', clear: 'Clear history', note: 'Saved on this device only.', cleared: 'History cleared.'},
  es: {heading: 'Seguir leyendo', at: '{title} · en la sección {n}', start: '{title} · desde el principio', resume: 'Seguir', clear: 'Borrar historial', note: 'Guardado solo en este dispositivo.', cleared: 'Historial borrado.'},
  fr: {heading: 'Reprendre la lecture', at: '{title} · à la section {n}', start: '{title} · depuis le début', resume: 'Reprendre', clear: 'Effacer l’historique', note: 'Enregistré uniquement sur cet appareil.', cleared: 'Historique effacé.'},
  it: {heading: 'Continua a leggere', at: '{title} · alla sezione {n}', start: '{title} · dall’inizio', resume: 'Continua', clear: 'Cancella cronologia', note: 'Salvato solo su questo dispositivo.', cleared: 'Cronologia cancellata.'},
  pt: {heading: 'Continuar a ler', at: '{title} · na secção {n}', start: '{title} · desde o início', resume: 'Continuar', clear: 'Limpar histórico', note: 'Guardado apenas neste dispositivo.', cleared: 'Histórico limpo.'},
};
const lang = () => { const raw = String(globalThis.notableFileApp?.settings?.uiLanguage || document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase(); return TEXTS[raw] ? raw : 'en'; };
const t = (key, vars = {}) => TEXTS[lang()][key].replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));

function open() {
  return new Promise((resolve, reject) => {
    let request; try { request = indexedDB.open(DB, 1); } catch (error) { reject(error); return; }
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function run(mode, fn) {
  const db = await open();
  try { return await new Promise((resolve, reject) => { const tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE)); tx.oncomplete = () => resolve(req?.result); tx.onerror = tx.onabort = () => reject(tx.error); }); }
  finally { db.close(); }
}
export const readLast = () => run('readonly', store => store.get(KEY)).catch(() => null);
export const saveLast = record => run('readwrite', store => store.put(record, KEY)).catch(() => {});
async function resumePoint(fingerprint) {
  try { const points = (await chrome.storage.local.get('resumePoints')).resumePoints || {}; const p = points[fingerprint]; return p && Number.isSafeInteger(p.chunk) ? p : null; } catch { return null; }
}
export async function clearLast() {
  const last = await readLast();
  await run('readwrite', store => store.delete(KEY)).catch(() => {});
  if (last?.fingerprint) { try { const points = (await chrome.storage.local.get('resumePoints')).resumePoints || {}; if (points[last.fingerprint]) { delete points[last.fingerprint]; await chrome.storage.local.set({resumePoints: points}); } } catch {} }
}

let card = null;
function ensureCard() {
  if (card?.isConnected) return card;
  const pane = document.querySelector('.import-pane'), heading = pane?.querySelector('h1');
  if (!pane) return null;
  card = document.createElement('section'); card.id = 'web-resume'; card.className = 'web-resume'; card.hidden = true; card.setAttribute('aria-labelledby', 'web-resume-heading');
  card.innerHTML = '<h2 id="web-resume-heading"></h2><p class="web-resume-title"></p><div class="web-resume-actions"><button type="button" class="primary" data-act="resume"></button><button type="button" data-act="clear"></button></div><p class="small muted web-resume-note"></p>';
  heading ? heading.after(card) : pane.prepend(card);
  card.addEventListener('click', async event => {
    const act = event.target.closest('button')?.dataset.act; if (!act) return;
    if (act === 'clear') { await clearLast(); card.hidden = true; announce(t('cleared')); return; }
    const last = await readLast(); if (!last?.text) { card.hidden = true; return; }
    card.hidden = true;
    await globalThis.notableFileApp?.loadDocument(last.text, last.title, last.language || '', {fileName: last.fileName || '', mimeType: last.mimeType || 'text/plain'});
  });
  return card;
}
function announce(text) { const s = document.querySelector('#status'); if (s) s.textContent = text; }

export async function renderCard() {
  const last = await readLast(), el = ensureCard();
  if (!el) return;
  if (!last?.text || !last.title && !last.text) { el.hidden = true; return; }
  const p = last.fingerprint ? await resumePoint(last.fingerprint) : null, title = String(last.title || '').trim() || '…';
  el.querySelector('h2').textContent = t('heading');
  el.querySelector('.web-resume-title').textContent = p && (p.chunk > 0 || p.word > 0) ? t('at', {title, n: p.chunk + 1}) : t('start', {title});
  el.querySelector('[data-act=resume]').textContent = t('resume');
  el.querySelector('[data-act=clear]').textContent = t('clear');
  el.querySelector('.web-resume-note').textContent = t('note');
  el.hidden = false;
}

export function installLast() {
  globalThis.notableWebDocument = record => {
    if (!record?.text || record.text.length > MAX_CHARS) return;
    if (card) card.hidden = true;                                                                  // a text is open now: the offer belongs to the empty start view
    void saveLast({text: record.text, title: String(record.title || ''), language: String(record.language || ''), fingerprint: String(record.fingerprint || ''), fileName: String(record.fileName || ''), mimeType: String(record.mimeType || ''), savedAt: Date.now()});
  };
  globalThis.notableWebClear = async () => { await clearLast(); if (card) card.hidden = true; };   // "Einstellungen & Lesestellen löschen" of the file view also forgets the kept text
  void renderCard();
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings && card && !card.hidden) void renderCard(); });   // interface language changed while the offer is shown
}
