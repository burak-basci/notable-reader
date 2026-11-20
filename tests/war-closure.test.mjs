/* web_accessible_resources (code review 2.5.5, R3): pages may load exactly what the bar imports into them, nothing of the engine host.
   The list must cover the import closure of session/page-session.mjs (else the bar does not start, measured: "Denying load of ...") and must not expose
   files outside it under session/ (host.mjs, host-export.mjs, diagnose-engine.mjs, engagement.mjs were readable by any page in 2.5.5).
   use_dynamic_url stays off: with it Chromium refuses the content script's module imports by the fixed ID and the bar does not start (browser check
   20.11.2026, runde5/bin/war-check.mjs). Run: node tests/war-closure.test.mjs -> "WAR CLOSURE OK (n checks)". */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension');
let checks = 0; const ok = (value, message) => { assert.ok(value, message); checks++; };
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const seen = new Set();
const visit = rel => {
  if (seen.has(rel)) return; seen.add(rel);
  const src = strip(fs.readFileSync(path.join(EXT, rel), 'utf8')), dir = path.dirname(rel);
  for (const m of src.matchAll(/(?:import|export)\s[^'"`;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) visit(path.normalize(path.join(dir, m[1] || m[2] || m[3])));
};
visit('session/page-session.mjs');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')), war = manifest.web_accessible_resources;
ok(war.length === 1, 'one WAR block');
const listed = war[0].resources, glob = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
const covered = file => listed.some(entry => glob(entry).test(file));
for (const file of [...seen].sort()) ok(covered(file), `${file} (imported by the bar) is web accessible`);
ok(!listed.some(entry => entry.startsWith('session/') && entry.includes('*')), 'no glob over session/ (it exposed the engine host)');
for (const entry of listed.filter(e => !e.includes('*'))) ok(fs.existsSync(path.join(EXT, entry)), `${entry} exists`);
for (const file of ['session/host.mjs', 'session/host-export.mjs', 'session/diagnose-engine.mjs', 'session/engagement.mjs']) ok(!covered(file), `${file} is not web accessible`);
ok(war[0].use_dynamic_url !== true, 'use_dynamic_url stays off (it stops the bar, see header)');
console.log(`WAR CLOSURE OK (${checks} checks)`);
