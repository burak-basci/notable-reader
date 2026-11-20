/* beNotable! Reader playback · resume points ("Lesestellen"): per document fingerprint, only {chunk, word, ts}
   (no text). Storage is injected ({get(key)->Promise, set(key,value)->Promise}), e.g. chrome.storage.local.
   Throttled writes, bounded count (own code, MIT). */
export const RESUME_KEY = 'resumePoints', MAX_POINTS = 200;
/* A place on the last word of the last section (or past it) means "read to the end": Play starts at the beginning again there,
   a resume point there is not restored (a page read to the end was silent on the second Play, 2.5.4). The first word of a
   one-section document is its beginning, never its end. */
export function atDocumentEnd(chunks, at) {
  if (!at || !Array.isArray(chunks) || !chunks.length || !Number.isInteger(at.chunk)) return false;
  const last = chunks.length - 1, word = Number.isInteger(at.word) ? at.word : 0, count = chunks[last]?.words?.length || 0;
  if (at.chunk > last) return true;
  return at.chunk === last && word >= count - 1 && (last > 0 || word > 0);
}
/* Every tab (page session, file view) has its own instance over ONE storage. 2.5.5 kept a private copy per tab and wrote the whole copy back, so a tab with an
   older copy brought back a point another tab had just forgotten (the silent second Play of H1 again, code review 2.5.5 R2). Now a tab keeps only ITS changes
   (fingerprint -> point, or null for "forgotten") and merges them into the CURRENT store on every write; reads go to the store too. */
export function createResumePoints({storage, now = () => Date.now(), minIntervalMs = 2000, max = MAX_POINTS}) {
  const changes = new Map();
  let lastWrite = 0, writing = Promise.resolve();
  const merge = (stored, list) => { const out = {...(stored && typeof stored === 'object' ? stored : {})}; for (const [key, point] of list) { if (point) out[key] = point; else delete out[key]; } return out; };
  const read = async () => merge(await storage.get(RESUME_KEY), changes);
  const write = async () => {
    if (!changes.size) return;
    const stored = await storage.get(RESUME_KEY), mine = [...changes]; changes.clear();      // merge and take over the changes in one step: nothing added meanwhile is lost
    const out = merge(stored, mine), keys = Object.keys(out);
    if (keys.length > max) for (const key of keys.sort((a, b) => (out[a].ts || 0) - (out[b].ts || 0)).slice(0, keys.length - max)) delete out[key];
    lastWrite = now();
    try { await storage.set(RESUME_KEY, out); } catch (error) { for (const [key, point] of mine) if (!changes.has(key)) changes.set(key, point); throw error; }
  };
  const flush = () => (writing = writing.then(write, write));                                 // one write at a time per tab
  return {
    async get(fingerprint) { const point = (await read())[fingerprint]; return point ? {chunk: point.chunk, word: point.word} : null; },
    /* Remember a position; written at most every minIntervalMs unless force (pause, stop, tab close). */
    async save(fingerprint, {chunk, word}, {force = false} = {}) {
      if (!fingerprint || !Number.isInteger(chunk) || chunk < 0) return false;
      changes.set(fingerprint, {chunk, word: Number.isInteger(word) ? word : 0, ts: now()});
      if (force || now() - lastWrite >= minIntervalMs) { await flush(); return true; }
      return false;
    },
    async flushPending() { if (changes.size) await flush(); },
    async forget(fingerprint) { changes.set(fingerprint, null); await flush(); },
  };
}
