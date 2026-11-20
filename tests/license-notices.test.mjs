/* Licence lists (code review 2.5.5, R6 part 1): the reader folder's list names the parts the root list has (ORT WebGPU 1.31.1, Qwen3-TTS, Qwen3.5) and every voice
   on a non-commercial base checkpoint (NC_BASE_OF in neural-models.js); Thorsten high is no longer called plainly "CC0".
   Run: node tests/license-notices.test.mjs -> "LICENSE NOTICES OK (n checks)". */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0; const ok = (value, message) => { assert.ok(value, message); checks++; };
const reader = fs.readFileSync(path.join(repo, 'extension/tools/reader/THIRD_PARTY_NOTICES.md'), 'utf8');
const models = fs.readFileSync(path.join(repo, 'extension/tools/reader/neural-models.js'), 'utf8');
for (const part of ['ort-webgpu', '1.31.1', 'Qwen3-TTS', 'Qwen3.5-0.8B']) ok(reader.includes(part), `reader list names ${part}`);
const nc = [...models.slice(models.indexOf('NC_BASE_OF=')).split('};')[0].matchAll(/'([a-z]{2}_[A-Z]{2}-[\w-]+)'\s*:/g)].map(m => m[1]);
ok(nc.length === 19, `19 voices on a non-commercial base in the register (${nc.length})`);
for (const voice of nc) ok(reader.includes(voice), `reader list names ${voice}`);
const thorstenHigh = reader.split('\n').find(line => line.includes('Piper Thorsten high')) || '';
ok(/lessac/i.test(thorstenHigh) && /research/i.test(thorstenHigh), 'Thorsten high names its lessac base and the research-only data licence');
console.log(`LICENSE NOTICES OK (${checks} checks)`);
