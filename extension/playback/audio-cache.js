/* beNotable! Reader playback · audio cache of the engine host (own code, MIT).
   Finished sections stay as compact 16-bit PCM (half of Float32) with their word times, for every pipeline of the host: a jump back or ahead, Pause/Resume,
   closing and reopening the bar, a page reload (same text = same key), the guided explanation and the engine's idle unload all find what was synthesized.
   Key = voice (model id) + speech normalisation + reading rules that change the SPOKEN audio (with the page language they normalise in) + the section's text
   and word list, written out in full (no hash, so no collision is possible). The request language itself does not change the audio (the worker speaks in
   the model's language). Tempo, volume, pitch, bass, treble and section pauses are applied at playback and are not part of the key.
   Budget: `budgetBytes` for the whole host, least recently used first; an entry a pipeline holds in its look-ahead window (`refs`) goes only after every
   unreferenced one. Entries not used for `ttlMs` are dropped (a page left long ago does not keep memory). Nothing leaves the host, nothing is written to disk. */
import {floatToInt16, int16ToFloat} from './wav.js';
export const CACHE_BUDGET_BYTES = 256 * 1024 * 1024;
export const CACHE_TTL_MS = 30 * 60 * 1000;
const SEP = '\u0001';
/* The parts of a request that change the synthesized audio. `reading` is the cleaned reading-rule object: only dictionary, link skipping and the three
   pauses change what is spoken (structural filters act before the text reaches the pipeline). */
export function audioKey({modelId, lang = '', normalize = true, reading = null, text, words, paragraphEnd = false, mute = null}) {
  return audioKeyPrefix({modelId, lang, normalize, reading, paragraphEnd, mute}) + [text, (words || []).join('\u0002')].join(SEP);
}
/* Everything of the key before the text: the same prefix = the same voice and rules (AudioCache.findSpan looks for sentences inside such sections). */
export function audioKeyPrefix({modelId, lang = '', normalize = true, reading = null, paragraphEnd = false, mute = null}) {
  const r = reading ? JSON.stringify([String(lang), reading.dictionary || [], !!reading.skipLinks, reading.commaPause || 0, reading.sentencePause || 0, reading.paragraphPause || 0]) : '';
  return [modelId, normalize === false ? 0 : 1, r, paragraphEnd ? 1 : 0, mute ? JSON.stringify(mute) : ''].join(SEP) + SEP;
}
export class AudioCache {
  constructor({budgetBytes = CACHE_BUDGET_BYTES, ttlMs = CACHE_TTL_MS, now = () => Date.now()} = {}) {
    Object.assign(this, {budgetBytes, ttlMs, now}); this.map = new Map(); this.bytes = 0; this.listeners = new Set(); this.hits = 0; this.misses = 0; this.evicted = 0;
    this.pending = new Map();      // key -> promise of a synthesis in flight for it (precompute): a pipeline that needs the same audio waits for it instead of synthesizing twice
    this.wanted = new Set();      // keys in `pending` that a pipeline waits for now: a preparation that holds back (precompute ahead) goes on for them
  }
  get size() { return this.map.size; }
  has(key) { return this.map.has(key); }
  /* -> entry {pcm16, sampleRate, timings, timingKind, durationSec, bytes} or null; a hit counts as use (moves to the end of the LRU order) */
  get(key) {
    const entry = this.map.get(key); if (!entry) { this.misses++; return null; }
    this.map.delete(key); this.map.set(key, entry); entry.used = this.now(); this.hits++; return entry;
  }
  peek(key) { return this.map.get(key) || null; }
  /* Float32 PCM (or Int16 already) -> stored as Int16; replaces an older entry of the same key. Returns the entry. */
  put(key, {pcm, pcm16, sampleRate, timings = null, timingKind = timings ? 'model' : 'none', words = null}) {
    const samples = pcm16 || floatToInt16(pcm), old = this.map.get(key);
    if (old) { this.map.delete(key); this.bytes -= old.bytes; }
    const entry = {key, pcm16: samples, sampleRate, timings, timingKind, words, durationSec: samples.length / sampleRate, bytes: samples.byteLength, used: this.now(), refs: old?.refs || 0};
    this.map.set(key, entry); this.bytes += entry.bytes; this.trim(entry);
    return this.map.get(key) || null;
  }
  /* Float32 copy for playback (the cache keeps its Int16) */
  pcm(entry) { return int16ToFloat(entry.pcm16); }
  ref(entry) { if (entry) entry.refs = (entry.refs || 0) + 1; }
  unref(entry) { if (entry && entry.refs > 0) entry.refs--; }
  delete(key, reason = 'delete') { const entry = this.map.get(key); if (!entry) return false; this.map.delete(key); this.bytes -= entry.bytes; this.evicted++; for (const fn of this.listeners) fn(key, reason); return true; }
  /* over budget: least recently used unreferenced entries first, then referenced ones (oldest first); `keep` (the entry just written) goes last */
  trim(keep = null) {
    const stale = this.now() - this.ttlMs;
    for (const [key, entry] of [...this.map]) if (entry.used < stale && !entry.refs && entry !== keep) this.delete(key, 'expired');
    for (const pass of [e => !e.refs, () => true]) {
      if (this.bytes <= this.budgetBytes) return;
      for (const [key, entry] of [...this.map]) { if (this.bytes <= this.budgetBytes) return; if (entry !== keep && pass(entry)) this.delete(key, 'budget'); }
    }
    if (this.bytes > this.budgetBytes && keep) this.delete(keep.key, 'budget');
  }
  /* A finished SENTENCE that lies inside a section held in the cache (same voice prefix of the key): its audio is cut out of the section by the word times,
     so the guided explanation can reuse what reading already synthesized. `prefix` = audioKey parts before the text (voice, language, rules). Returns
     {pcm16, sampleRate, timings} or null. Never guesses: the words must match exactly and in order, the section must have word times. */
  findSpan(prefix, words) {
    if (!words?.length) return null;
    for (const entry of this.map.values()) {
      if (!entry.timings || !entry.words || !entry.key.startsWith(prefix) || entry.words.length < words.length) continue;
      const list = entry.words;
      for (let i = 0; i + words.length <= list.length; i++) {
        if (list[i] !== words[0]) continue;
        let k = 1; while (k < words.length && list[i + k] === words[k]) k++;
        if (k < words.length) continue;
        const t = entry.timings, first = t[i], last = t[i + words.length - 1]; if (!first || !last || !(last.end > first.start)) return null;
        const sr = entry.sampleRate, before = i > 0 ? t[i - 1].end : 0, after = i + words.length < list.length ? t[i + words.length].start : entry.durationSec;
        const from = Math.max(before, first.start - 0.03), to = Math.min(after, last.end + 0.12), a = Math.max(0, Math.floor(from * sr)), b = Math.min(entry.pcm16.length, Math.ceil(to * sr));
        if (b - a < sr * 0.2) return null;
        const shift = a / sr; entry.used = this.now(); this.hits++;
        return {pcm16: entry.pcm16.slice(a, b), sampleRate: sr, timings: t.slice(i, i + words.length).map(w => ({start: Math.max(0, w.start - shift), end: Math.max(0, w.end - shift)})), timingKind: entry.timingKind};
      }
    }
    return null;
  }
  /* a voice was removed from the device: its audio goes too */
  dropModel(modelId) { const prefix = modelId + SEP; for (const key of [...this.map.keys()]) if (key.startsWith(prefix)) this.delete(key, 'removed'); }
  onEvict(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  clear() { for (const key of [...this.map.keys()]) this.delete(key, 'clear'); }
  stats() { return {entries: this.map.size, bytes: this.bytes, budgetBytes: this.budgetBytes, hits: this.hits, misses: this.misses, evicted: this.evicted}; }
}
