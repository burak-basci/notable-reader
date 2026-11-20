#!/usr/bin/env node
/* Runs every unit test (tests/*.test.mjs, no browser) one after the other; exit code 1 if one fails.
   Run: npm test  (or node tests/run-unit.mjs) */
import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url)); let failed = 0;
for (const name of readdirSync(dir).filter(n => n.endsWith('.test.mjs')).sort()) {
  const run = spawnSync(process.execPath, ['--no-warnings', join(dir, name)], {encoding: 'utf8'});
  const last = (run.stdout || '').trim().split('\n').at(-1) || '';
  if (run.status === 0) console.log(`PASS ${name}: ${last}`); else { failed++; console.log(`FAIL ${name}:\n${(run.stdout || '') + (run.stderr || '')}`); }
}
console.log(failed ? `${failed} FAILED` : 'ALL UNIT TESTS PASS'); process.exit(failed ? 1 : 0);
