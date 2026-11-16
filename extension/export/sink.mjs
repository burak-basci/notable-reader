/* beNotable! Reader · Export: Speicherziele (eigene Datei, OPFS, IndexedDB, Speicher). MIT.
 * Gleicher Job-Präfix wie audio-export.js, damit clearAudiobookStorage() alte Reste beider Wege findet. */
export const JOB_PREFIX = 'notable-audiobook-';
export const MEMORY_LIMIT = 32 * 1024 * 1024;
export const BUFFER_BYTES = 256 * 1024;
const FALLBACK_ERRORS = ['SecurityError', 'NotSupportedError', 'InvalidStateError'];

export const storageError = error => error?.name === 'QuotaExceededError'
  ? new Error('Der lokale Speicher ist voll. Bitte Speicher freigeben oder mit „Datei speichern“ direkt auf ein Laufwerk exportieren.') : error;

// Web Lock je Job: ein Absturz oder geschlossener Tab gibt ihn frei, ein aktiver Job bleibt vor Aufräumen geschützt.
async function lease(id) {
  if (!globalThis.navigator?.locks) return () => {};
  let release, ok, fail;
  const ready = new Promise((a, b) => { ok = a; fail = b; }), life = new Promise(r => release = r);
  navigator.locks.request(id, async () => { ok(); await life; }).catch(fail);
  await ready; return release;
}
const openDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open('notable-reader-audiobook-exports', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('parts');
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  req.onblocked = () => reject(new Error('Der Exportspeicher ist blockiert. Andere Reader-Tabs schließen und erneut versuchen.'));
});
const tx = (db, mode, action) => new Promise((resolve, reject) => {
  const t = db.transaction('parts', mode); let value;
  try { value = action(t.objectStore('parts')); } catch (e) { reject(e); return; }
  t.oncomplete = () => resolve(value?.result); t.onerror = t.onabort = () => reject(t.error || value?.error || new Error('Der lokale Exportspeicher ist nicht verfügbar.'));
});

// Löscht nur verwaiste Jobs; aktive oder noch gehaltene Ergebnisse bleiben.
export async function clearAudiobookStorage() {
  if (!globalThis.navigator?.locks) return { removed: 0, skipped: 0, unavailable: true, message: 'Dieser Browser kann aktive Exporte nicht sicher unterscheiden. Temporäre Audiodaten lassen sich über die Website-Daten im Browser löschen.' };
  let removed = 0, skipped = 0;
  const unused = (id, action) => navigator.locks.request(id, { ifAvailable: true }, async lock => { if (!lock) { skipped++; return; } await action(); removed++; });
  if (navigator.storage?.getDirectory) {
    try { const dir = await navigator.storage.getDirectory(); for await (const [name, handle] of dir.entries()) if (handle.kind === 'file' && name.startsWith(JOB_PREFIX)) await unused(name, () => dir.removeEntry(name)); }
    catch (e) { if (!FALLBACK_ERRORS.includes(e.name)) throw storageError(e); }
  }
  if (globalThis.indexedDB) {
    const db = await openDb();
    try {
      const keys = await tx(db, 'readonly', s => s.getAllKeys());
      for (const id of new Set(keys.map(k => k[0]).filter(id => typeof id === 'string' && id.startsWith(JOB_PREFIX)))) await unused(id, () => tx(db, 'readwrite', s => s.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))));
    } finally { db.close(); }
  }
  return { removed, skipped, unavailable: false, message: `${removed} temporäre Hörbuchdateien gelöscht. ${skipped} aktive oder noch verwendete Exporte bleiben erhalten.` };
}

// Ergebnis: {kind, write(u8), patch(header), finish()->Blob|null, discard(), cleanup()}
export async function makeSink(supplied, mime, { forceKind } = {}) {
  if (supplied) {
    if (['write', 'close', 'abort'].some(k => typeof supplied[k] !== 'function')) throw new Error('Das Speicherziel unterstützt keinen sicheren Dateiexport.');
    return { kind: 'file', write: d => supplied.write(d), finish: async () => { await supplied.close(); return null; }, discard: () => supplied.abort(), cleanup: async () => {},
      patch: async h => { if (typeof supplied.seek === 'function') { await supplied.seek(0); await supplied.write(h); } else await supplied.write({ type: 'write', position: 0, data: h }); } };
  }
  if (forceKind !== 'indexeddb' && forceKind !== 'memory' && globalThis.navigator?.storage?.getDirectory) {
    try {
      const dir = await navigator.storage.getDirectory(), name = JOB_PREFIX + crypto.randomUUID(), release = await lease(name);
      let writer, handle;
      try { handle = await dir.getFileHandle(name, { create: true }); if (typeof handle.createWritable !== 'function') throw new DOMException('Schreibbarer Dateispeicher ist nicht verfügbar.', 'NotSupportedError'); writer = await handle.createWritable(); }
      catch (e) { await dir.removeEntry(name).catch(() => {}); release(); throw e; }
      const cleanup = async () => { try { await dir.removeEntry(name).catch(() => {}); } finally { release(); } };
      return { kind: 'opfs', write: d => writer.write(d), patch: async h => { await writer.seek(0); await writer.write(h); },
        finish: async () => { await writer.close(); const f = await handle.getFile(); return f.slice(0, f.size, mime); },
        discard: async () => { await writer.abort().catch(() => {}); await cleanup(); }, cleanup };
    } catch (e) { if (!FALLBACK_ERRORS.includes(e.name)) throw storageError(e); }
  }
  if (forceKind !== 'memory' && globalThis.indexedDB) {
    try {
      const db = await openDb(), id = JOB_PREFIX + crypto.randomUUID(), release = await lease(id), range = () => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
      let index = 0, closed = false;
      const cleanup = async () => { if (closed) return; try { await tx(db, 'readwrite', s => s.delete(range())); } finally { db.close(); closed = true; release(); } };
      return { kind: 'indexeddb', write: d => tx(db, 'readwrite', s => s.put(new Blob([d], { type: mime }), [id, index++])), patch: h => tx(db, 'readwrite', s => s.put(new Blob([h], { type: mime }), [id, 0])),
        finish: async () => new Blob(await tx(db, 'readonly', s => s.getAll(range())), { type: mime }), discard: cleanup, cleanup };
    } catch (e) { if (!FALLBACK_ERRORS.includes(e.name)) throw storageError(e); }
  }
  // Echte Browsergrenze (kein Wort-/Bezahllimit): ohne Dateispeicher maximal 32 MiB.
  const parts = []; let bytes = 0;
  return { kind: 'memory', write: async d => { if (bytes + d.byteLength > MEMORY_LIMIT) throw new Error('Dieser Browser bietet keinen Dateispeicher. Für mehr als 32 MiB Audio bitte einen Browser mit Dateispeicher verwenden oder einzelne Kapitel exportieren.'); bytes += d.byteLength; parts.push(new Blob([d], { type: mime })); },
    patch: async h => { parts[0] = new Blob([h], { type: mime }); }, finish: async () => new Blob(parts, { type: mime }), discard: async () => { parts.length = 0; }, cleanup: async () => { parts.length = 0; } };
}

// Sammelt kleine Encoderausgaben und schreibt höchstens BUFFER_BYTES am Stück.
export class BufferedOutput {
  constructor(store) { this.store = store; this.parts = []; this.pending = 0; this.bytes = 0; }
  async write(data) {
    if (!data.byteLength) return;
    if (this.pending + data.byteLength > BUFFER_BYTES) await this.flush();
    const copy = new Uint8Array(data.byteLength); copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    this.parts.push(copy); this.pending += copy.byteLength; this.bytes += copy.byteLength;
    if (this.pending >= BUFFER_BYTES) await this.flush();
  }
  async flush() {
    if (!this.pending) return;
    const merged = new Uint8Array(this.pending); let o = 0;
    for (const p of this.parts) { merged.set(p, o); o += p.length; }
    this.parts = []; this.pending = 0; await this.store.write(merged);
  }
}
