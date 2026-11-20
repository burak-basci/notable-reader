/* A page read to the end reads again from the beginning (Neu-Nutzer-Test 2.5.4, H1: reload + Play stayed silent, the bar said
   "Fertig gelesen", because the resume point was saved on the last word right after it had been forgotten).
   Run: node tests/replay-finished-page.test.mjs  -> "REPLAY OK (n checks)", exit 0.
   Covers the end test itself, the resume store (forget after the end leaves no point) and the three places that decide where
   Play starts: PageSession.toggle (page bar, Fokus view, file view, web app), PageSession.restore and the file view's first place. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let checks = 0; const ok = (value, message) => { assert.ok(value, message); checks++; };
const {atDocumentEnd, createResumePoints} = await import(pathToFileURL(path.join(root, 'playback/resume-points.js')).href);

const words = n => Array.from({length: n}, (_, i) => ({start: i * 2, end: i * 2 + 1}));
const three = [{words: words(20)}, {words: words(12)}, {words: words(35)}];
ok(atDocumentEnd(three, {chunk: 2, word: 34}), 'last word of the last section is the end (the tester\'s point: section 3, word 34)');
ok(atDocumentEnd(three, {chunk: 2, word: 40}), 'past the last word is the end');
ok(atDocumentEnd(three, {chunk: 5, word: 0}), 'a section past the document is the end');
ok(!atDocumentEnd(three, {chunk: 2, word: 33}), 'the word before the last is still a place to resume');
ok(!atDocumentEnd(three, {chunk: 1, word: 11}), 'the end of a middle section is not the end');
ok(!atDocumentEnd(three, {chunk: 0, word: 0}), 'the beginning is not the end');
ok(!atDocumentEnd([{words: words(1)}], {chunk: 0, word: 0}), 'the first word of a one-word document is its beginning');
ok(atDocumentEnd([{words: words(1)}, {words: words(1)}], {chunk: 1, word: 0}), 'a one-word last section: its word is the end');
ok(!atDocumentEnd([], {chunk: 0, word: 0}) && !atDocumentEnd(three, null) && !atDocumentEnd(three, {chunk: 'x'}), 'nothing to read / no place is not the end');

/* the store: the 2.5.4 order (forget, then save of the end) left a point; the session now forgets instead of saving */
const data = {}; const storage = {get: async k => data[k], set: async (k, v) => { data[k] = structuredClone(v); }};
const resume = createResumePoints({storage, minIntervalMs: 0});
await resume.save('fp', {chunk: 1, word: 3}, {force: true});
ok((await resume.get('fp'))?.chunk === 1, 'a place in the middle is kept');
await Promise.all([resume.forget('fp'), resume.forget('fp')]);
ok(await resume.get('fp') === null && !('fp' in data.resumePoints), 'after the end nothing is left to restore');

/* the decisions in the sources (PageSession needs a page; these lines are what the browser check exercised) */
const session = read('session/page-session.mjs'), file = read('tools/reader/reader.js');
ok(/createResumePoints, atDocumentEnd\} from '\.\.\/playback\/index\.js'/.test(session), 'session imports the end test');
ok(session.includes("if (this.state === 'ended' || atDocumentEnd(this.chunks, from)) from = {chunk: 0, word: 0};"), 'Play on a finished page starts at 0,0');
ok(session.includes('if (saved && atDocumentEnd(this.chunks, saved)) { void this.resume.forget(fingerprint)'), 'restore() does not mark the end');
ok(/ended=this\.state==='ended'\|\|atDocumentEnd\(this\.chunks,at\).*ended\?this\.resume\.forget\(this\.fingerprint\):this\.resume\.save/.test(session), 'savePosition forgets the end instead of saving it');
ok(file.includes('atDocumentEnd(docChunks,saved))saved=null'), 'the file view opens a finished text at the beginning');
console.log(`REPLAY OK (${checks} checks)`);
