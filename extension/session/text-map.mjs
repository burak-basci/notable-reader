import {citationTextRanges} from '../playback/reading-rules.js';
/* beNotable! Reader session · text -> chunks with words, and block offsets -> DOM ranges (own code, MIT).
   Contract ("Offsets sind heilig"): chunk.text.slice(o.start,o.end) === word for every word, checked in buildChunks. */
import {wordOffsets} from '../playback/timeline.js';
export const MAX_CHUNK = 500, MAX_CODE = 1200;
/* Chunker of 1.6.24 (extraction._chunks_for), ported onto block texts: sentences are only split where a human would end a sentence
   (terminal mark + space + capital/digit/opening quote, never after an abbreviation such as "e.g." or "Dr."), then consecutive sentences are
   packed again up to `max` characters. A paragraph of up to 500 characters is therefore ONE section, like in the old reader (the sentence-per-dot
   chunker of 2.4.0 cut at every dot: "e." | "g." | "3." | "14"). Only text longer than `max` is cut, at a clause mark or space. */
const ABBREVIATION = /(?:^|[\s(\[„"'“‚»])(?:e\.\s?g|i\.\s?e|z\.\s?B|d\.\s?h|u\.\s?a|o\.\s?ä|u\.\s?U|i\.\s?d\.\s?R|v\.\s?a|s\.\s?o|s\.\s?u|bzw|usw|etc|ca|vs|Nr|Dr|Prof|Hr|Fr|St|Mr|Mrs|Ms|Jr|Sr|inkl|ggf|bspw|sog|vgl|Abb|Fig|Eq|No|al|approx|cf|resp|Tel|Str|Std|Mio|Mrd|Jh|Jahrh|Inc|Ltd|Corp|Co|Dept|Univ|Vol|pp|Ph\.D|a\.m|p\.m|U\.S|U\.K|U\.S\.A|n\.\s?Chr|v\.\s?Chr|Chr|bzgl|evtl|Hrsg|Aufl|geb|gest|Kap|Anm|Dipl|Ing|Frl|Sen|Rep|Gov|Gen|Lt|Capt|Col|Sgt|Rev|Hon|Eng|Mt|Ave|Blvd|Rd)\.$/iu;
const STARTS_SENTENCE = /^[\p{Lu}\p{N}•„»"“‘'(\[]/u;
/* A dot that only looks like a sentence end: initials / spaced abbreviations ("J. K. Rowling", "z. B. Folgendes": a single letter + dot followed by another
   single letter + dot) and German ordinals before a month ("am 3. Oktober"). Fixes sections that ended at "z." and started at "B." (found with a tiny section limit). */
const MONTH = /^(?:Jan(?:uar|uary)?|Feb(?:ruar|ruary)?|M(?:ä|ae)?rz|March|Apr(?:il)?|Mai|May|Jun[ie]?|June|Jul[iy]?|July|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Okt(?:ober)?|Oct(?:ober)?|Nov(?:ember)?|Dez(?:ember)?|Dec(?:ember)?)\b/u;
function notASentenceEnd(text, endOfMark, end) {
  const before = text.slice(0, endOfMark), tok = /(\S+)$/u.exec(before)?.[1] || '', next = /^\S+/u.exec(text.slice(end))?.[0] || '';
  if (/^[(\["„“»'‘]*\p{L}\.$/u.test(tok) && /^(?:\p{L}|Chr)\.[,;:)]*$/u.test(next)) return true;                  // "z. B." "J. K." "u. a." (first letter of a chain)
  const prev = /(\S+)\s+\S+$/u.exec(before)?.[1] || '';
  if (/^[(\["„“»'‘]*\p{L}\.$/u.test(prev) && /^\p{L}\.$/u.test(tok) && /^\p{Lu}/u.test(next)) return /^\p{Lu}\.$/u.test(tok) || /^\p{L}\.$/u.test(prev) && /^\p{Ll}\.$/u.test(tok);   // second initial: "J. K. Rowling", "z. B. Terraform"
  if (/^[(\["„“»'‘]*\d{1,2}\.$/u.test(tok) && MONTH.test(next)) return true;                          // "am 3. Oktober", "(31. Dezember 2023)" (Wikipedia, R2-06)
  return false;
}
export function sentenceSpans(text) {
  const spans = []; let start = 0;
  for (const m of text.matchAll(/[.!?…]+[”’"')\]»]*\s+/gu)) {
    const end = m.index + m[0].length, endOfMark = m.index + m[0].trimEnd().length;
    if (!STARTS_SENTENCE.test(text.slice(end, end + 1))) continue;
    if (/\.$/u.test(text.slice(0, endOfMark)) && m[0][0] === '.' && (ABBREVIATION.test(text.slice(Math.max(0, endOfMark - 14), endOfMark)) || notASentenceEnd(text, endOfMark, end))) continue;
    spans.push([start, endOfMark]); start = end;
  }
  spans.push([start, text.length]);
  return spans;
}
const trimSpan = (text, a, b, extra = /\s/u) => { while (a < b && extra.test(text[a])) a++; while (b > a && extra.test(text[b - 1])) b--; return [a, b]; };
/* Elastic limits (a section must never stop in the middle of a sentence, a word or a line): a section may run up to +25 % over its limit when that
   reaches a clean end, and a cut never leaves less than 40 % of the limit in front of it (no mini sections). Limit Infinity (maxCode) = read the block whole. */
export const ELASTIC = 1.25, FLOOR = .4;
/* Best cut among ascending candidate offsets: the last one inside [FLOOR*max, max], else the first one up to +25 %, else -1. */
function pickCut(offsets, max) {
  let best = -1; for (const p of offsets) { if (p < max * FLOOR) continue; if (p <= max) best = p; else { if (best < 0) best = p; break; } }
  return best;
}
/* Cut an over-long span [a,b) into pieces. A span up to ELASTIC*max is NOT cut (it ends at its own sentence end). Otherwise: a clause mark (, ; : dash, line end), else a space; a hard cut
   only for a "word" longer than the whole window. */
function cutLong(text, a, b, max) {
  const out = [], highest = Math.floor(max * ELASTIC);
  while (b - a > highest) {
    const window = text.slice(a, a + highest + 1), marks = [], spaces = [];
    for (const m of window.matchAll(/[,;:](?= )|(?= [–—] )|\n/gu)) marks.push(m[0] === '\n' ? m.index : m.index + m[0].length);
    for (let i = 0; i < window.length; i++) if (window[i] === ' ' || window[i] === '\n') spaces.push(i);
    let cut = pickCut(marks, max); if (cut < 0) cut = pickCut(spaces, max);
    if (cut < 1) { const any = window.lastIndexOf(' ', Math.floor(max)); cut = any > 0 ? any : Math.floor(max); }
    out.push([a, a + cut]); a += cut; while (a < b && /\s/u.test(text[a])) a++;
  }
  out.push([a, b]);
  return out;
}
/* The rule above needs a capital after the mark, so scripts without letter case (CJK, Hangul, Arabic, Devanagari)
   never end a sentence there. Only a span that would otherwise be cut hard at the limit is split again at their
   sentence marks (Intl.Segmenter as fallback); every other span, and all cased text, keeps its sections unchanged. */
const UNCASED_SCRIPTS = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Arabic}'
  + '\\p{Script=Devanagari}';
const UNCASED = new RegExp(`[${UNCASED_SCRIPTS}]`, 'gu'), CLOSERS = '[”’"\')\\]»」』）]*';
/* Full-width and Arabic/Devanagari marks always end a sentence; ASCII marks only before uncased script or a digit. */
const UNCASED_END = new RegExp(`[。！？｡．؟۔।॥]+${CLOSERS}|[.!?…]+${CLOSERS}(?=\\s+[${UNCASED_SCRIPTS}\\p{N}])`, 'gu');
let sentenceSegmenter;
function segmenterEnds(span) {
  if (typeof Intl === 'undefined' || !Intl.Segmenter) return [];
  try { sentenceSegmenter ??= new Intl.Segmenter(undefined, {granularity: 'sentence'}); } catch { return []; }
  return [...sentenceSegmenter.segment(span)].map(s => s.index + s.segment.length);
}
function uncasedSentences(text, a, b, max) {
  if (b - a <= Math.floor(max * ELASTIC)) return [[a, b]];
  const span = text.slice(a, b), letters = span.match(/\p{L}/gu)?.length || 0;
  const uncased = span.match(UNCASED)?.length || 0;
  if (!letters || uncased * 2 < letters) return [[a, b]];        // mostly cased text: never touched
  let ends = [...span.matchAll(UNCASED_END)].map(m => m.index + m[0].length).filter(end => end < span.length);
  if (!ends.length) ends = segmenterEnds(span).filter(end => end < span.length);
  const out = []; let from = a;
  for (const end of [...ends.map(e => a + e), b]) {
    const [x, y] = trimSpan(text, from, end, /[\s•]/u); if (y > x) out.push([x, y]); from = end;
  }
  return out.length ? out : [[a, b]];
}
/* Prose: spans of the sections of one block text. Sentences are packed up to `max`; a single sentence up to +25 % stays whole, a longer one is cut by cutLong. */
function proseSpans(text, max) {
  const out = []; let pending = null;
  for (const [sa, sb] of sentenceSpans(text)) {
    const [a, b] = trimSpan(text, sa, sb, /[\s•]/u); if (b <= a) continue;
    for (const [ua, ub] of uncasedSentences(text, a, b, max)) for (const [pa, pb] of cutLong(text, ua, ub, max)) {
      if (pending && pb - pending[0] > max) { out.push(pending); pending = null; }
      pending = pending ? [pending[0], pb] : [pa, pb];
    }
  }
  if (pending) out.push(pending);
  return out;
}
/* Code (pre): the whole block is ONE section up to +25 % over `maxCode` (Infinity = always whole). Longer code is cut where a human would: at a blank line (new function / block; best where the
   bracket level is back to 0), else at a line end (best at bracket level 0), never after a line that continues (trailing backslash) and never inside a line unless a single line is longer than
   the window (then at a space). */
function codeSpans(text, maxCode) {
  const [a0, b0] = trimSpan(text, 0, text.length); if (b0 <= a0) return [];
  const highest = Math.floor(maxCode * ELASTIC), out = []; let a = a0;
  while (b0 - a > highest) {
    const window = text.slice(a, a + highest + 1), lines = window.split('\n'), ranks = [[], [], [], []];
    let depth = 0, pos = 0;
    for (let i = 0; i < lines.length - 1; i++) {                       // the last piece is cut by the window itself, it is no line end
      const line = lines[i]; for (const ch of line) { if (ch === '{' || ch === '[' || ch === '(') depth++; else if (ch === '}' || ch === ']' || ch === ')') depth--; }
      pos += line.length;                                              // offset of this line's end
      const blank = i + 1 < lines.length - 1 && lines[i + 1].trim() === '', flat = depth <= 0;
      if (line.trim() !== '' && pos > 0 && !/\\\s*$/.test(line)) ranks[blank ? (flat ? 0 : 1) : (flat ? 2 : 3)].push(pos);
      pos += 1;
    }
    let cut = -1; for (const offsets of ranks) { cut = pickCut(offsets, maxCode); if (cut > 0) break; }
    if (cut < 0) { const spaces = []; for (let i = 0; i < window.length; i++) if (window[i] === ' ') spaces.push(i); cut = pickCut(spaces, maxCode); }
    if (cut < 1) { const any = window.lastIndexOf(' ', Math.floor(maxCode)); cut = any > 0 ? any : Math.floor(maxCode); }
    const [ca, cb] = trimSpan(text, a, a + cut); if (cb > ca) out.push([ca, cb]);
    a += cut; while (a < b0 && /\s/u.test(text[a])) a++;
  }
  const [la, lb] = trimSpan(text, a, b0); if (lb > la) out.push([la, lb]);
  return out;
}
/* Splits one block text into section spans [start,end). `code` blocks (pre) stay whole. */
export function splitBlock(text, max = MAX_CHUNK, {code = false, maxCode = MAX_CODE} = {}) {
  return (code ? codeSpans(text, maxCode) : proseSpans(text, max)).filter(([a, b]) => b > a);
}
/* Footnote/citation marks ([3], superscript numbers; ranges reported by collectHtmlBlocks({cites:true})) are blanked with spaces in the spoken text:
   length and offsets stay identical (the block text still contains them, the highlight maps through it), but they are not words and are not read. */
const blank = (text, base, cites) => { if (!cites?.length) return text; let out = text; for (const [s, e] of cites) { const a = Math.max(s - base, 0), b = Math.min(e - base, text.length); if (b > a) out = out.slice(0, a) + ' '.repeat(b - a) + out.slice(b); } return out; };
/* Scripts written without spaces between words: a whitespace token containing one of them is cut into words with Intl.Segmenter (granularity 'word', locale = document language).
   Punctuation segments stay tokens of their own, so a mark covers exactly the word (and never "word + 。"); other scripts (Latin, Cyrillic, Arabic/RTL, Korean: spaced) keep the whitespace tokens untouched. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const segmenters = new Map();
function segmenter(lang) {
  const key = lang || ''; if (segmenters.has(key)) return segmenters.get(key);
  let seg = null; if (typeof Intl !== 'undefined' && Intl.Segmenter) { try { seg = new Intl.Segmenter(lang || undefined, {granularity: 'word'}); } catch { try { seg = new Intl.Segmenter(undefined, {granularity: 'word'}); } catch { seg = null; } } }
  segmenters.set(key, seg); return seg;
}
export function tokenize(text, lang) {
  const words = [];
  for (const token of text.split(/\s+/u)) {
    if (!token) continue;
    const seg = UNSPACED.test(token) ? segmenter(lang) : null;
    if (!seg) { words.push(token); continue; }
    const parts = [...seg.segment(token)].map(s => s.segment);
    if (parts.join('') !== token) { words.push(token); continue; }   // never guess: keep the whole token if the segments do not rebuild it
    words.push(...parts);
  }
  return words;
}
/* blocks: [{text, code?, cites?}] -> chunks [{id, block, start, text, words:[String]}]; words are whitespace tokens (unspaced scripts: Intl.Segmenter words), offsets verified. */
export function buildChunks(blocks, max = MAX_CHUNK, lang = '', reading = {}) {
  const chunks = [];
  blocks.forEach((block, bi) => {
    if (reading.skipCode && block.code || reading.skipMath && block.math) return;
    const citations=reading.skipCitations===false?[]:[...(block.cites||[]),...(!block.code&&!block.math?citationTextRanges(block.text,{protectedRanges:block.citationProtected||[]}):[])];
    for (const [a, b] of splitBlock(block.text, max, {code: block.code === true})) {
      const raw = blank(block.text.slice(a, b), a, citations), lead = raw.length - raw.trimStart().length, text = raw.trim(), words = tokenize(text, lang);   // a blanked mark at the edge moves the edge, nothing else
      if (!words.length || !wordOffsets(text, words)) continue;
      chunks.push({id: chunks.length, block: bi, start: a + lead, text, words, ...(block.code ? {code: true} : {})});
    }
  });
  if (reading.paragraphPause > 0) for (let i = 0; i < chunks.length; i++) chunks[i].paragraphEnd = !chunks[i + 1] || chunks[i + 1].block !== chunks[i].block;
  return chunks;
}
/* Maps offsets of a block text (whitespace collapsed, trimmed) onto its visible text nodes: i-th non-space character of the block text is
   the i-th non-space character of the concatenated node data. Returns null when the sequences differ (never guesses). */
export function createRangeMapper(textNodes, blockText) {
  // Flat typed arrays instead of one [node, offset] pair per character: mappers stay cached per block, and those pairs
  // held about 20 MB for a fully read long article. Same answers: a position without an entry (the second half of a
  // surrogate pair, or outside the text) stays unset.
  const UNSET = -2; let total = 0, count = 0;
  for (const node of textNodes) total += node.data.length;
  const nodeOf = new Int32Array(total), offsetOf = new Int32Array(total);   // non-space char k -> node index, offset
  textNodes.forEach((node, n) => {
    const data = node.data;
    for (let i = 0; i < data.length;) {
      const cp = data.codePointAt(i), len = cp > 0xffff ? 2 : 1;
      if (!/\s/u.test(String.fromCodePoint(cp))) { nodeOf[count] = n; offsetOf[count] = i; count++; }
      i += len;
    }
  });
  const nonSpace = new Int32Array(blockText.length).fill(UNSET);   // block char offset -> non-space ordinal (or -1)
  let k = 0;
  for (let i = 0; i < blockText.length;) { const cp = blockText.codePointAt(i), len = cp > 0xffff ? 2 : 1; nonSpace[i] = /\s/u.test(String.fromCodePoint(cp)) ? -1 : k++; i += len; }
  if (k !== count) return null;
  const at = i => {
    const v = i >= 0 && i < nonSpace.length ? nonSpace[i] : UNSET; return v === UNSET ? undefined : v;
  };
  const entry = ordinal =>
    ordinal >= 0 && ordinal < count ? [textNodes[nodeOf[ordinal]], offsetOf[ordinal]] : undefined;
  return {
    count: k,
    range(start, end, doc = textNodes[0]?.ownerDocument) {
      let a = start, b = end - 1;
      while (a < end && at(a) === undefined || at(a) === -1) { a++; if (a >= end) return null; }
      while (b > a && (at(b) === undefined || at(b) === -1)) b--;
      const first = entry(at(a)), last = entry(at(b));
      if (!first || !last) return null;
      const r = doc.createRange();
      r.setStart(first[0], first[1]);
      const lastLen = (blockText.codePointAt(b) > 0xffff) ? 2 : 1;
      r.setEnd(last[0], last[1] + lastLen);
      return r;
    }
  };
}

