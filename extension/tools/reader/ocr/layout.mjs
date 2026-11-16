/* Paragraphs from OCR output · own code MIT (pure functions, no DOM).
 * Input: the `blocks` tree of Tesseract (blocks -> paragraphs -> lines -> words {text, confidence, bbox{x0,y0,x1,y1}}) in pixels of the rendered page.
 * Output per page: text (paragraphs separated by one blank line, single spaces, already in the form cleanText() leaves unchanged) and a word list whose
 * offsets satisfy  text.slice(start, end) === word.text  (same contract as everywhere in the Reader).
 * Reading order = the order Tesseract's layout analysis gives the blocks (columns top-down, left to right): good for one column and for clean
 * multi-column pages, best effort for irregular layouts. */
const SKIP_BLOCK = /IMAGE|LINE$|NOISE|TABLE_LINE|VERT|HORZ/u;   // pictures, rules, specks: no text
const HYPHEN_END = /[\p{L}\p{N}][-‐‑­]$/u;
const SENTENCE_END = /[.!?:;…。！？]["'»”’)\]]*$/u;
const LOWER_START = /^[\p{Ll}]/u;
const NOISE_WORD = /^[|_~¦\\/]+$/u;
export const MIN_LINE_CONFIDENCE = 35;   // a line whose words average below this is page dirt (a photo, a stamp), not text

const clean = value => String(value ?? '').replace(/[­​-‍﻿]/gu, '').replace(/[\s ]+/gu, ' ').trim().normalize('NFC');

const lineHeight = line => { const box = line.bbox || (line.words || [])[0]?.bbox; return box ? Math.max(0, box.y1 - box.y0) : 0; };
const median = values => { const sorted = values.filter(value => value > 0).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
export const HEADING_RATIO = 1.3;   // a line taller than 1.3x the page's median line is set larger than the body text: a heading, kept apart from the paragraph around it
const PAGE_NUMBER = /^[-\u2013\u2014\s]*(?:\d{1,4}|[ivxlcdm]{1,6})[-\u2013\u2014\s]*$/iu;

/** Flat word records of one paragraph, line by line; each word remembers the line it stands on and whether the line is set in large type. */
function paragraphWords(paragraph, bodyHeight) {
  const words = [];
  (paragraph.lines || []).forEach((line, lineIndex) => {
    const big = bodyHeight > 0 && lineHeight(line) > bodyHeight * HEADING_RATIO;
    const kept = (line.words || []).map(word => ({text: clean(word.text), conf: Number(word.confidence), bbox: word.bbox, line: lineIndex, big})).filter(word => word.text && !NOISE_WORD.test(word.text));
    if (!kept.length) return;
    const mean = kept.reduce((sum, word) => sum + (Number.isFinite(word.conf) ? word.conf : 0), 0) / kept.length;
    if (mean < MIN_LINE_CONFIDENCE) return;
    words.push(...kept);
  });
  return words;
}

/** Joins the words of a paragraph: hyphenation at a line end is resolved ("Beispiel-" + "satz" -> "Beispielsatz"), a hyphen before a capital stays ("Süd-" + "Deutschland"). */
function joinParagraph(words) {
  const merged = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index], next = words[index + 1];
    if (next && next.line !== word.line && HYPHEN_END.test(word.text) && next.text) {
      const join = LOWER_START.test(next.text) ? word.text.slice(0, -1) + next.text : word.text + next.text;
      merged.push({text: join, conf: Math.min(word.conf, next.conf), bbox: word.bbox, bbox2: next.bbox, line: next.line, big: word.big});
      index++;
    } else merged.push(word);
  }
  return merged;
}

export function layoutPage(blocks, {width, height} = {}) {
  const paragraphs = [];   // {words, block, big}
  const textBlocks = (blocks || []).filter(block => !SKIP_BLOCK.test(String(block.blocktype || '')));
  const bodyHeight = median(textBlocks.flatMap(block => (block.paragraphs || []).flatMap(paragraph => (paragraph.lines || []).map(lineHeight))));
  for (const [blockIndex, block] of textBlocks.entries()) {
    for (const paragraph of block.paragraphs || []) {
      const all = joinParagraph(paragraphWords(paragraph, bodyHeight));
      // a heading line and the body text that Tesseract put into one paragraph become two paragraphs
      const runs = []; for (const word of all) { if (!runs.length || runs.at(-1).big !== word.big) runs.push({big: word.big, words: []}); runs.at(-1).words.push(word); }
      for (const run of runs) {
        const words = run.words, previous = paragraphs.at(-1);
        // Tesseract over-splits justified text: a paragraph that begins in lower case after an unfinished sentence of the same block continues it.
        if (previous && !previous.big && !run.big && previous.block === blockIndex && !SENTENCE_END.test(previous.words.at(-1).text) && LOWER_START.test(words[0].text)) previous.words.push(...words);
        else paragraphs.push({words, block: blockIndex, big: run.big});
      }
    }
  }
  // page numbers (a lone number in the top or bottom margin) are no reading text, same as the repeated margins the text-PDF path removes
  const marginal = paragraph => { const box = paragraph.words[0].bbox; return width && height && box && (box.y1 / height < 0.08 || box.y0 / height > 0.92) && paragraph.words.length <= 3 && PAGE_NUMBER.test(paragraph.words.map(word => word.text).join(' ')); };
  for (let index = paragraphs.length - 1; index >= 0; index--) if (marginal(paragraphs[index])) paragraphs.splice(index, 1);
  const norm = (box, fallback) => {
    if (!box || !width || !height) return fallback;
    const clamp = value => Math.max(0, Math.min(1, value));
    return [clamp(box.x0 / width), clamp(box.y0 / height), clamp(box.x1 / width), clamp(box.y1 / height)].map(value => Math.round(value * 10000) / 10000);
  };
  let text = '', confidenceSum = 0, confidenceCount = 0;
  const words = [];
  paragraphs.forEach((paragraph, index) => {
    if (index) text += '\n\n';
    paragraph.words.forEach((word, wordIndex) => {
      if (wordIndex) text += ' ';
      const start = text.length;
      text += word.text;
      const conf = Number.isFinite(word.conf) ? word.conf : 0;
      confidenceSum += conf; confidenceCount++;
      const entry = {text: word.text, start, end: text.length, bbox: norm(word.bbox, [0, 0, 0, 0]), conf: Math.round(conf)};
      if (word.bbox2) entry.bbox2 = norm(word.bbox2, null);
      words.push(entry);
    });
  });
  return {text, words, confidence: confidenceCount ? Math.round(confidenceSum / confidenceCount) : 0};
}
