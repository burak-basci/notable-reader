/* Reading speed is 0.5x-4x everywhere (owner decision 20.11.2026: up to 5x was too much).
   Run: node tests/speed-limit.test.mjs  -> "SPEED LIMIT OK (n checks)", exit 0.
   Covers the schema (config.mjs), the stored-value migration (4.5 -> 4), the import, the playback clamp and every
   place in the UI sources that lists or bounds the speed values (a 5 there would bring the old range back). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension');
const load = file => import(pathToFileURL(path.join(root, file)).href);
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let checks = 0; const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };

const config = await load('config.mjs');
eq([config.SPEED_MIN, config.SPEED_MAX], [.5, 4], 'schema range');
for (const [stored, expected] of [[4.5, 4], [5, 4], [4.05, 4], [4, 4], [2.25, 2.25], [.5, .5], [1, 1]])
  eq(config.migrate({speed: stored, configVersion: 2, voices: {}}).speed, expected, `stored ${stored} -> ${expected}`);
const storage = {data: {pageSettings: {speed: 4.5, configVersion: 2, voices: {}}}, async get() { return structuredClone(this.data); }, async set(v) { Object.assign(this.data, structuredClone(v)); }, async remove() {}};
eq((await config.loadConfig(storage)).speed, 4, 'loadConfig clamps');
eq(storage.data.pageSettings.speed, 4, 'clamped value is written back once');
ok(config.validSettingsPatch({speed: 4}), 'patch 4 accepted');
ok(!config.validSettingsPatch({speed: 4.05}), 'patch 4.05 refused');
ok(!config.validSettingsPatch({speed: 5}), 'patch 5 refused');
const imported = config.parseImport(JSON.stringify({schema: config.EXPORT_SCHEMA, version: 1, settings: {speed: 4.75}}));
eq(imported.ok && imported.values.speed, 4, 'old export with 4.75 imports as 4');
ok(!config.parseImport(JSON.stringify({schema: config.EXPORT_SCHEMA, version: 1, settings: {speed: 9}})).ok, 'nonsense speed still refused');

const timeline = await load('playback/timeline.js');
eq(timeline.MAX_RATE, 4, 'playback clamp');
eq(timeline.clampRate(4.5), 4, 'clampRate 4.5'); eq(timeline.clampRate(.2), .5, 'clampRate .2');

/* the UI sources: option lists end at 4.00 (71 entries from 0.50), sliders max 4, guards <= 4 */
const surface = read('player-surface.mjs'), controls = read('session/speech-controls.mjs'), shared = read('session/shared-settings.mjs');
ok(surface.includes('Array.from({length:71},(_,i)=>{const n=(.5+i*.05)'), 'bar option list 0.50-4.00');
ok(surface.includes('Math.min(4,Math.round((current+direction*.1)*20)/20)'), 'keyboard step stops at 4');
ok(surface.includes('message.speed>=.5&&message.speed<=4'), 'bar state guard');
ok(controls.includes("range.max='4'") && controls.includes('const MIN=.5,MAX=4,'), 'slider max 4');
ok(controls.includes('for(let i=0;i<=70;i++)'), 'settings option list 0.50-4.00');
ok(shared.includes('Array.from({length:71},'), 'shared settings option list');
ok(read('file-player-transport.mjs').includes('value<.5||value>4||'), 'file transport guard');
ok(read('tools/reader/reader.js').includes("if(command==='speed')return!finite(.5,4);"), 'file view guard');
ok(read('service-worker.js').includes('Math.min(4, settings.speed)'), 'worker hands out at most 4');
const sources = ['player-surface.mjs', 'session/speech-controls.mjs', 'session/shared-settings.mjs', 'file-player-transport.mjs', 'tools/reader/reader.js', 'service-worker.js', 'config.mjs', 'playback/timeline.js'];
for (const file of sources) for (const bad of ['length:91', 'i<=90', "max='5'", 'MAX=5', 'MAX_RATE = 5', 'speed<=5', 'speed <= 5', 'value>5', 'finite(.5,5)', '0.50-5.00'])
  ok(!read(file).includes(bad), `${file} has no "${bad}"`);
console.log(`SPEED LIMIT OK (${checks} checks)`);
