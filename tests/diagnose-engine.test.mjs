/* Diagnosis lines (Help & diagnosis, popup): the words follow the interface language (de, en, es, fr, it, pt), numbers and technical names stay.
   Run: node tests/diagnose-engine.test.mjs  -> "DIAGNOSE ENGINE OK (n checks)" */
import assert from 'node:assert/strict';
import {engineLines, diagnosisWords} from '../extension/session/diagnose-engine.mjs';
let checks = 0; const ok = (value, message) => { assert.ok(value, message); checks++; };
const report = {loaded: {backend: 'wasm', workers: 2, initMs: 3400}, caps: {webgpu: false, jspi: true, cores: 8, memoryGB: 16},
  recent: {sections: 4, modelId: 'kokoro', rtf: 0.4, audioSec: 20, ms: 8000},
  bench: {ok: true, modelId: 'kokoro', loadMs: 2000, single: {ms: 4000, audioSec: 10}, parallel: {sections: 2, ms: 6000, audioSec: 20}}};
const english = engineLines(report, 'Voice engine', 'en').join('\n');
ok(english === ['Voice engine: CPU (WASM) · 2 workers · load 3.4 s', 'WebGPU no · JSPI yes · 8 cores · 16 GB', 'Last 4 sections (kokoro): RTF 0.4 (20 s audio in 8 s)', 'Speed test (kokoro): load 2 s', '  1 section: 4 s for 10 s audio, RTF 0.4', '  2 sections in parallel: 6 s for 20 s audio, RTF 0.3'].join('\n'), 'English output unchanged:\n' + english);
const english1 = engineLines({loaded: {backend: 'wasm', workers: 1, initMs: 1000}}, 'Voice engine', 'en')[0];
ok(english1.includes('1 worker ·') && !english1.includes('1 workers'), 'singular worker');
const byLanguage = {};
for (const language of ['de', 'en', 'es', 'fr', 'it', 'pt']) {
  const lines = engineLines(report, 'X', language), none = engineLines({loaded: null}, 'X', language)[0], failed = engineLines({bench: {code: ''}}, 'X', language).at(-1);
  byLanguage[language] = lines.join('\n');
  ok(lines.length === 6 && lines.every(line => line.trim()), `${language}: six lines`);
  ok(/RTF 0\.4/.test(lines.join('')) && /WebGPU/.test(lines[1]) && /JSPI/.test(lines[1]), `${language}: technical names and numbers stay`);
  if (language !== 'en') ok(!/no voice loaded|Speed test|Last 4 sections|s audio in|in parallel\b|for 10 s audio|cores|load /.test(none + '\n' + lines.join('\n')), `${language}: no English wording left`);
  ok(none !== 'X: no voice loaded' || language === 'en', `${language}: "no voice loaded" translated`);
  ok(failed.length > 3 && (language === 'en' || !/failed/.test(failed)), `${language}: failure word translated`);
}
ok(new Set(Object.values(byLanguage)).size === 6, 'six different texts');
ok(/Keine Stimme geladen|keine Stimme geladen/.test(engineLines({loaded: null}, 'Stimmen-Engine', 'de')[0]), 'German: no voice loaded');
ok(/Geschwindigkeitstest/.test(byLanguage.de) && /Kerne/.test(byLanguage.de) && /Letzte 4 Abschnitte/.test(byLanguage.de), 'German words');
// language: explicit argument, else the page's <html lang> (the popup sets it to the interface language), else English
ok(diagnosisWords('xx') === diagnosisWords('en') && diagnosisWords(undefined) === diagnosisWords('en'), 'unknown language and no document: English');
globalThis.document = {documentElement: {lang: 'fr'}};
ok(engineLines({loaded: null}, 'Moteur')[0] === 'Moteur: aucune voix chargée', 'default language from <html lang>');
ok(engineLines({loaded: null}, 'Engine', 'it')[0] === 'Engine: nessuna voce caricata', 'explicit language wins');
delete globalThis.document;
console.log(`DIAGNOSE ENGINE OK (${checks} checks)`);
