/* Sentence ends of the section splitter (session/text-map.mjs): an ordinal before a month is no sentence end, also inside brackets (R2-06, de.wikipedia Bochum "(31. Dezember 2023)").
   Run: node tests/text-map-sentences.test.mjs -> "TEXT MAP SENTENCES OK (n checks)" */
import assert from 'node:assert/strict';
import {sentenceSpans} from '../extension/session/text-map.mjs';
let checks = 0; const parts = text => sentenceSpans(text).map(([a, b]) => text.slice(a, b).trim()).filter(Boolean);
const eq = (text, want) => { assert.deepEqual(parts(text), want, text); checks++; };
eq('Bochum hat 364.454 Einwohner (31. Dezember 2023) und liegt im Ruhrgebiet. Es ist eine Großstadt.', ['Bochum hat 364.454 Einwohner (31. Dezember 2023) und liegt im Ruhrgebiet.', 'Es ist eine Großstadt.']);
eq('Die Messe beginnt am 3. Oktober in Essen. Danach folgt Bochum.', ['Die Messe beginnt am 3. Oktober in Essen.', 'Danach folgt Bochum.']);
eq('Stand „1. Januar 2024“ gilt weiter. Neu ist nichts.', ['Stand „1. Januar 2024“ gilt weiter.', 'Neu ist nichts.']);
eq('Das Spiel endete 3. Danach ging es weiter.', ['Das Spiel endete 3.', 'Danach ging es weiter.']);
console.log(`TEXT MAP SENTENCES OK (${checks} checks)`);
