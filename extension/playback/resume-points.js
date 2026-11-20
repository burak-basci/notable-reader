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
export function createResumePoints({storage, now = () => Date.now(), minIntervalMs = 2000, max = MAX_POINTS}) {
  let cache = null, lastWrite = 0, pending = null;
  const load = async () => cache ??= (await storage.get(RESUME_KEY)) || {};
  const flush = async () => { if (!cache) return; const keys = Object.keys(cache); if (keys.length > max) for (const key of keys.sort((a, b) => cache[a].ts - cache[b].ts).slice(0, keys.length - max)) delete cache[key]; lastWrite = now(); pending = null; await storage.set(RESUME_KEY, cache); };
  return {
    async get(fingerprint) { const point = (await load())[fingerprint]; return point ? {chunk: point.chunk, word: point.word} : null; },
    /* Remember a position; written at most every minIntervalMs unless force (pause, stop, tab close). */
    async save(fingerprint, {chunk, word}, {force = false} = {}) {
      if (!fingerprint || !Number.isInteger(chunk) || chunk < 0) return false;
      (await load())[fingerprint] = {chunk, word: Number.isInteger(word) ? word : 0, ts: now()};
      if (force || now() - lastWrite >= minIntervalMs) { await flush(); return true; }
      pending = true; return false;
    },
    async flushPending() { if (pending) await flush(); },
    async forget(fingerprint) { delete (await load())[fingerprint]; await flush(); },
  };
}
