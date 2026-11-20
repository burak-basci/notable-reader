/* beNotable! Reader playback · time axis: media time -> word, char offset -> word, progress interpolation (own code, MIT). */
export const MIN_RATE = 0.5, MAX_RATE = 4, MAX_VOLUME = 1.5;
export const clampRate = value => { const n = Number(value); return Number.isFinite(n) ? Math.min(MAX_RATE, Math.max(MIN_RATE, n)) : 1; };
export const clampVolume = value => { const n = Number(value); return Number.isFinite(n) ? Math.min(MAX_VOLUME, Math.max(0, n)) : 1; };
/* Voice shaping (Runde 5): pitch in semitones (+-6, steps of 0.5), bass / treble in dB (+-10), pause between sections in ms (0 = at once, up to 3 s). */
export const MAX_PITCH = 6, MAX_TONE = 10, MAX_GAP_MS = 3000;
const clampTo = (value, lo, hi, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };
export const clampPitch = value => clampTo(value, -MAX_PITCH, MAX_PITCH), clampTone = value => clampTo(value, -MAX_TONE, MAX_TONE), clampGapMs = value => clampTo(value, 0, MAX_GAP_MS);
export const pitchFactor = semitones => 2 ** (clampPitch(semitones) / 12);
export const cleanFx = fx => ({pitch: clampPitch(fx?.pitch), bass: clampTone(fx?.bass), treble: clampTone(fx?.treble), gapMs: clampGapMs(fx?.gapMs)});

/* Index of the word being spoken at media time t (seconds), -1 before the first word, null without timings.
   Between two words the earlier word stays marked (no flicker in pauses). */
export function wordAt(timings, t) {
  if (!timings || !timings.length) return null;
  if (!(t >= timings[0].start)) return -1;
  let lo = 0, hi = timings.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (timings[mid].start <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

/* Character offsets of a word list inside the chunk text (words appear in order; Offsets are sacred:
   text.slice(start,end) === word). Returns null when a word cannot be found, never guesses. */
export function wordOffsets(text, words) {
  const out = []; let cursor = 0;
  for (const word of words) {
    const at = text.indexOf(word, cursor);
    if (at < 0) return null;
    out.push({start: at, end: at + word.length}); cursor = at + word.length;
  }
  return out;
}

/* Word whose range contains (or follows) char offset; used for boundary events and click-to-seek. */
export function wordAtChar(offsets, charIndex) {
  if (!offsets || !offsets.length) return null;
  let lo = 0, hi = offsets.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid].start <= charIndex) lo = mid; else hi = mid - 1; }
  return charIndex < offsets[0].start ? 0 : lo;
}

/* Interpolates between 100 ms progress messages: mediaTime + (now - epochMs) * rate. Clamped to the chunk length,
   monotonic inside one chunk unless a seek (new message with an earlier time) arrives. */
export function createProgressInterpolator({rate = 1} = {}) {
  let last = null, currentRate = rate, duration = Infinity;
  return {
    push(message) { if (message && Number.isFinite(message.mediaTime)) last = {chunk: message.chunk, mediaTime: message.mediaTime, playing: message.playing !== false, epochMs: Number.isFinite(message.epochMs) ? message.epochMs : 0}; },
    setRate(value) { currentRate = clampRate(value); },
    setDuration(seconds) { duration = Number.isFinite(seconds) ? seconds : Infinity; },
    at(nowMs) {
      if (!last) return null;
      const elapsed = last.playing ? Math.max(0, (nowMs - last.epochMs) / 1000) * currentRate : 0;
      return {chunk: last.chunk, mediaTime: Math.min(duration, last.mediaTime + elapsed), playing: last.playing};
    },
    reset() { last = null; },
  };
}

/* Emits onWord/onChunk only when the marked word changes. `timingsFor(chunk)` returns {start,end}[]|null. */
export function createWordTracker({timingsFor, onWord = () => {}, onChunk = () => {}}) {
  let chunk = -1, word = -2;
  return {
    update(position) {
      if (!position) return;
      if (position.chunk !== chunk) { chunk = position.chunk; word = -2; onChunk(chunk); }
      const next = wordAt(timingsFor(chunk), position.mediaTime);
      if (next !== null && next !== word) { word = next; if (next >= 0) onWord({chunk, word: next}); }
    },
    reset() { chunk = -1; word = -2; },
    get current() { return {chunk, word}; },
  };
}
