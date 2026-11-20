/* Letter-spaced PDF print ("G r u n d g e s e t z", gesetze-im-internet.de/gg/GG.pdf): textFromPdfItems of tools/reader/core.js pulls it together to words,
   normal text stays byte for byte, and the section recognition keeps exact word offsets.
   Items below are the real pdf.js items of GG.pdf (one item per word, the word gaps are items of their own " ").
   Run: node tests/pdf-letterspacing.test.mjs  -> "PDF LETTERSPACING OK (n checks)"
   Optional: READER_GG_PDF=/path/GG.pdf additionally extracts the whole file with the bundled pdf.js. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), reader = path.join(here, '../extension/tools/reader');
(0, eval)(fs.readFileSync(path.join(reader, 'core.js'), 'utf8'));
const {textFromPdfItems, cleanText} = globalThis.NotableReaderCore, {documentChunks} = await import(pathToFileURL(path.join(reader, 'document-chunks.mjs')).href);
let checks = 0; const ok = (value, message) => { assert.ok(value, message); checks++; }, eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
const item = (str, x, y, hasEOL = false) => ({str, transform: [10, 0, 0, 10, x, y], height: 10, width: str.length * 4, hasEOL});
const text = items => cleanText(textFromPdfItems(items));
// 1. GG.pdf, Eingangsformel: normal words around a letter-spaced title, then the short last line "d i e"
const gg = [item('Der Parlamentarische Rat hat am 23. Mai 1949 beschlossene', 48, 700), item('G r u n d g e s e t z', 380, 700), item(' ', 458, 700), item('f ü r', 465, 700), item(' ', 480, 700), item('d i e', 487, 700, true),
  item('B u n d e s r e p u b l i k', 48, 688), item(' ', 143, 688), item('D e u t s c h l a n d', 150, 688), item(' ', 225, 688), item('in der Woche vom 16. bis 22. Mai 1949 angenommen.', 228, 688, true)];
eq(text(gg), 'Der Parlamentarische Rat hat am 23. Mai 1949 beschlossene Grundgesetz für die Bundesrepublik Deutschland in der Woche vom 16. bis 22. Mai 1949 angenommen.', 'GG title becomes words');
// 2. whole letter-spaced paragraph incl. 2-letter words ("I m", "i n"), punctuation and a hyphen
const preamble = [item('I m', 48, 600), item(' ', 61, 600), item('B e w u ß t s e i n', 68, 600), item(' ', 138, 600), item('s e i n e r', 145, 600), item(' ', 182, 600), item('V e r a n t w o r t u n g', 189, 600), item(' ', 278, 600), item('v o r', 285, 600), item(' ', 303, 600), item('G o t t', 309, 600), item(' ', 334, 600), item('u n d', 341, 600), item(' ', 362, 600), item('M e n s c h e n ,', 396, 600, true),
  item('B a d e n - W ü r t t e m b e r g', 48, 588), item(' ', 150, 588), item('u n d', 155, 588), item(' ', 175, 588), item('i n', 180, 588, true)];
eq(text(preamble), 'Im Bewußtsein seiner Verantwortung vor Gott und Menschen, Baden-Württemberg und in', 'letter-spaced paragraph');
// 3. a short letter-spaced line next to a rich line is collapsed too; one that stands alone is not evidence
eq(text([item('Z w i s c h e n ü b e r s c h r i f t', 48, 500, true), item('u n d', 48, 488, true)]), 'Zwischenüberschrift und', 'short neighbour line collapsed');
// 4. things that must stay exactly as they are
for (const [name, items, expected] of [
  ['abbreviations', [item('Das gilt z. B. für Fälle, d. h. alle u. a. Länder.', 48, 400, true)], 'Das gilt z. B. für Fälle, d. h. alle u. a. Länder.'],
  ['enumeration of letters', [item('Absatz a b c', 48, 390), item('a b c d e', 48, 378, true)], 'Absatz a b c a b c d e'],
  ['single letters in a formula line', [item('x y z', 48, 360, true)], 'x y z'],
  ['table row of single digits', [item('1 2 3 4 5 6 7 8', 48, 340, true)], '1 2 3 4 5 6 7 8'],
  ['letters and digits mixed table', [item('A 1 B 2 C 3 D 4', 48, 320, true)], 'A 1 B 2 C 3 D 4'],
  ['normal prose with short words', [item('Er ist in die Stadt gegangen, um zu sehen, ob es so ist.', 48, 300, true)], 'Er ist in die Stadt gegangen, um zu sehen, ob es so ist.'],
]) eq(text(items), expected, name);
// 5. an enumeration line (not made of single-character tokens only) next to a letter-spaced line is untouched
eq(text([item('G r u n d g e s e t z', 48, 300), item('f ü r', 140, 300, true), item('(a) a b c d e (b) f g', 48, 240, true)]), 'Grundgesetz für\n\n(a) a b c d e (b) f g', 'enumeration next to the evidence stays');
// 6. double space inside one item separates words
eq(text([item('G r u n d  f ü r  d i e  B u n d e s r e p u b l i k', 48, 200, true)]), 'Grund für die Bundesrepublik', 'two spaces separate words inside one item');
// 7. the sections of the result: contract chunk.text.slice === word and absolute offsets
const {text: whole, chunks} = documentChunks(text([...gg, ...preamble.map(i => ({...i, transform: [10, 0, 0, 10, i.transform[4], i.transform[5] - 300]}))]));
ok(chunks.length >= 2 && !/\b\p{L} \p{L} \p{L} \p{L}\b/u.test(whole), 'sections without spelled letters');
for (const c of chunks) { eq(whole.slice(c.start, c.end), c.text, 'absolute offsets exact'); let at = 0; for (const w of c.words) { const i = c.text.indexOf(w, at); ok(i >= at, 'word in order'); at = i + w.length; } }
// 8. optional: the real file with the bundled pdf.js
if (process.env.READER_GG_PDF) {
  await import(pathToFileURL(path.join(reader, 'pdf-polyfills.mjs')).href);
  const pdfjs = await import(pathToFileURL(path.join(reader, 'vendor/pdfjs/pdf.mjs')).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(reader, 'vendor/pdfjs/pdf.worker.mjs')).href;
  const doc = await pdfjs.getDocument({data: new Uint8Array(fs.readFileSync(process.env.READER_GG_PDF)), verbosity: 0}).promise, pages = [];
  for (let n = 1; n <= doc.numPages; n++) pages.push(text((await (await doc.getPage(n)).getTextContent()).items));
  const all = pages.join('\n\n');
  ok(!/(?<![\p{L}])(?:\p{L} ){4,}\p{L}(?![\p{L}])/u.test(all), 'GG.pdf: no spelled words left');
  ok(/dieses Grundgesetz gegeben/.test(all) && /Im Bewußtsein seiner Verantwortung/.test(all), 'GG.pdf: preamble readable');
}
console.log(`PDF LETTERSPACING OK (${checks} checks)`);
