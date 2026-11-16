/* beNotable! Reader engine · synthesis units · own code MIT.
 * A section (paragraph up to 500 characters) is the unit of display, word marking and reading positions. It stays that. Only the SYNTHESIS of the first
 * section of a start or jump is split: the first sentence (a short piece, at most `head` words) is synthesized and played first, the rest follows from the
 * same worker. Word indices, offsets and section borders are not touched: both pieces report timings for their own words only, the engine joins them.
 * Pure functions on the SPOKEN text (after speech normalisation: one spoken string per word), so they run in tests without a browser. */
const STRONG = /[.!?…]["'”’)\]»›]*$/u, WEAK = /[,;:–—]["'”’)\]»›]*$/u;
const MIN_HEAD = 5, MIN_TAIL = 3;

/* Character range of every word inside `text` (words appear in order). null when a word is not found: then nothing is split, never guessed. */
export function wordRanges(text, words) {
  const out = []; let cursor = 0;
  for (const word of words) {
    const at = text.indexOf(word, cursor);
    if (at < 0) return null;
    out.push([at, at + word.length]); cursor = at + word.length;
  }
  return out;
}

/* Where the first piece ends (word index, exclusive): the first sentence end at or after MIN_HEAD words, within `head` words; else the last clause
   boundary (comma, semicolon) in that span; else the cap. `from` is the first word to be spoken. */
export function headEnd(words, from, head) {
  const lo = from + MIN_HEAD, hi = Math.min(words.length, from + head);
  for (let i = lo; i <= hi; i++) if (STRONG.test(words[i - 1])) return i;
  for (let i = hi; i >= lo; i--) if (WEAK.test(words[i - 1])) return i;
  return hi;
}

/* End (exclusive) of a later piece that starts at `at` and should hold about `target` words: the sentence end nearest to the target inside
   [0.6, 1.5] x target, else the nearest clause boundary there, else the target itself. Never leaves fewer than MIN_TAIL words behind. */
export function pieceEnd(words, at, target) {
  const want = at + target, lo = at + Math.max(MIN_HEAD, Math.floor(target * 0.6)), hi = Math.min(words.length - MIN_TAIL, at + Math.ceil(target * 1.5));
  if (lo > hi) return Math.min(words.length, Math.max(at + 1, want));
  const nearest = test => { let best = -1; for (let i = lo; i <= hi; i++) if (test.test(words[i - 1]) && (best < 0 || Math.abs(i - want) < Math.abs(best - want))) best = i; return best; };
  const strong = nearest(STRONG); if (strong > 0) return strong;
  const weak = nearest(WEAK); if (weak > 0) return weak;
  return Math.min(hi, Math.max(lo, want));
}
/* Background work in short pieces (about `size` words, cut at sentence ends): the engine joins them into ONE result, but between two pieces it can hand the
   worker to a request that is needed now (another session's start, the next step of a guided explanation) or pause while the user interacts with the page,
   without stopping the worker (a stop costs a model load). null when the section is short enough to be one piece. */
export function sentenceUnits(text, words, size = 16) {
  size = Math.max(MIN_HEAD, Math.floor(size) || 16);
  if (!words?.length || words.length <= size * 1.5 + MIN_TAIL) return null;
  const ranges = wordRanges(text, words); if (!ranges) return null;
  const slice = (a, b) => ({text: text.slice(ranges[a][0], ranges[b - 1][1]), words: words.slice(a, b)});
  const units = []; let at = 0;
  while (at < words.length) {
    if (words.length - at <= size * 1.5 + MIN_TAIL) { units.push(slice(at, words.length)); break; }
    const cut = pieceEnd(words, at, size); units.push(slice(at, cut)); at = cut;
  }
  return units.length > 1 ? {from: 0, units, join: true} : null;
}
/* plan: null (synthesize the section as one unit from word 0, as without any option) or {from, units:[{text,words}, ...]} with units that together cover words[from..].
   from > 0 skips the words before it (a jump into the middle of a section: the audio of the skipped part is never needed to start there).
   grow >= 1 (progressive start): after the head every next piece holds about `grow` times the words of the piece before it, cut at a sentence end
   (1 = pieces as long as the head: for a voice that is barely faster than the tempo).
   Piece k+1 is then synthesized while pieces 0..k play; with a real-time factor r it is ready in time as long as r * grow <= 1, so the first
   section never waits after its first sentence (with two pieces the rest of a long section took longer than the first sentence lasted). */
/* most (optional): no later piece holds more than about `most` words (a slow voice: a piece nobody can interrupt must stay short, and the last pieces of a
   long sentence then go to both workers instead of one long one). */
export function planUnits(text, words, {from = 0, head = 0, grow = 0, most = 0} = {}) {
  from = Math.max(0, Math.floor(from) || 0); head = Math.max(0, Math.floor(head) || 0); most = most > 0 ? Math.max(MIN_HEAD, Math.floor(most)) : 0;
  if ((!from && !head) || !words?.length || from >= words.length) return null;
  const ranges = wordRanges(text, words); if (!ranges) return null;
  const slice = (a, b) => ({text: text.slice(ranges[a][0], ranges[b - 1][1]), words: words.slice(a, b)});
  const rest = words.length - from;
  const whole = () => from ? {from, units: [slice(from, words.length)]} : null;       // one unit from word 0 is the plain request
  if (!head || rest <= head + MIN_TAIL) return whole();
  const end = headEnd(words, from, head);
  if (words.length - end < MIN_TAIL) return whole();
  if (!(grow >= 1)) return {from, units: [slice(from, end), slice(end, words.length)]};
  const units = [slice(from, end)]; let at = end, size = end - from;
  while (at < words.length) {
    const target = Math.max(MIN_HEAD, Math.round(size * grow)), capped = most ? Math.min(target, most) : target;
    if (words.length - at <= (most ? capped + MIN_TAIL : target * 1.5 + MIN_TAIL)) { units.push(slice(at, words.length)); break; }
    const cut = pieceEnd(words, at, capped); units.push(slice(at, cut)); size = most ? Math.min(cut - at, most) : cut - at; at = cut;
  }
  return {from, units};
}
