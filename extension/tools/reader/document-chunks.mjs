/* beNotable! Reader file view / Focus Reader · the sections of a document text. (own code, MIT)
   The sentence recognition itself is the SAME as on every page (session/text-map.mjs buildChunks: 1.6.24 sentences packed up to 500 characters);
   this file only cuts the cleaned text into paragraphs (hard line breaks end one, soft breaks of hard-wrapped lines do not) and keeps absolute offsets
   (saved positions, chapters and the export address the text, not the blocks). */
import {buildChunks} from '../../session/text-map.mjs';
export const cleanText = text => String(text || '').replace(/\r\n?/g, '\n').replace(/\u00ad/g, '').replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const END = /[.!?。！？…]["'»”’)\]]*$/;
function wrapWidth(text) {
  const lens = []; let from = 0;
  for (;;) { const at = text.indexOf('\n', from), end = at < 0 ? text.length : at; if (end > from) lens.push(end - from); if (at < 0) break; from = at + 1; }
  if (lens.length < 8) return 0;
  lens.sort((a, b) => a - b); return lens[Math.floor(lens.length * 0.9)];
}
function softBreak(text, p, width) { // single line break inside a paragraph (hard-wrapped source text)
  if (text[p - 1] === '\n' || text[p + 1] === '\n' || !width) return false;
  const lineStart = text.lastIndexOf('\n', p - 1) + 1, line = text.slice(lineStart, p);
  return line.length >= width * 0.7 && !END.test(line) && !/^\s*([-*•#]|\d+[.)])\s/.test(text.slice(p + 1, p + 8));
}
/* Paragraphs of the cleaned text (hard line breaks end one, soft breaks of hard-wrapped lines do not): the blocks the shared section recognition (session/text-map.mjs) runs on. */
function paragraphSpans(input) {
  const text = cleanText(input), width = wrapWidth(text), spans = []; let start = 0;
  for (let p = 0; p < text.length; p++) if (text[p] === '\n' && !softBreak(text, p, width)) { if (p > start) spans.push([start, p]); start = p + 1; }
  if (start < text.length) spans.push([start, text.length]);
  return {text, spans};
}

/* -> {text, chunks:[{text,start,end,block,rel,words}], layout:{spans, blocks}} ; start/end absolute in `text`, rel = offset inside the block. */
export function documentChunks(input) {
  const {text, spans} = paragraphSpans(input), blocks = spans.map(([a, b]) => ({text: text.slice(a, b).replace(/\n/g, ' ')}));
  const chunks = buildChunks(blocks).map(c => ({text: c.text, start: spans[c.block][0] + c.start, end: spans[c.block][0] + c.start + c.text.length, block: c.block, rel: c.start, words: c.words}));
  return {text, chunks, layout: {spans, blocks}};
}
