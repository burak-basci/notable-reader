/* Resume points across tabs (code review 2.5.5, R2): every tab has its own createResumePoints() over ONE storage (chrome.storage.local).
   2.5.5 kept a private copy per tab and wrote the whole copy back: tab B (older copy) brought back the end point tab A had just forgotten, and the
   next Play of that page was silent again (H1). Behaviour test with two real instances over one shared, asynchronous storage; no source text search.
   Run: node tests/resume-points-tabs.test.mjs  -> "RESUME POINTS TABS OK (n checks)", exit 0. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension');
const {createResumePoints} = await import(pathToFileURL(path.join(root, 'playback/resume-points.js')).href);
let checks = 0; const ok = (value, message) => { assert.ok(value, message); checks++; };
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
const shared = () => { const data = {}; return {data, get: async k => { await tick(); return structuredClone(data[k]); }, set: async (k, v) => { await tick(); data[k] = structuredClone(v); }}; };

{ // the review's probe: A forgets X, B (which had read X before) saves Y -> X must stay gone
  const storage = shared(), a = createResumePoints({storage, minIntervalMs: 0}), b = createResumePoints({storage, minIntervalMs: 0});
  await a.save('X', {chunk: 5, word: 3}, {force: true});
  ok((await b.get('X'))?.chunk === 5, 'tab B sees the point tab A saved');
  await a.forget('X');
  await b.save('Y', {chunk: 1, word: 0}, {force: true});
  ok(!('X' in (storage.data.resumePoints || {})), 'a point forgotten in tab A does not come back through tab B\'s write');
  ok(storage.data.resumePoints?.Y?.chunk === 1, 'tab B\'s own point is written');
  ok(await b.get('X') === null && await a.get('X') === null, 'neither tab restores the forgotten point (no silent replay)');
}
{ // a stale tab must not restore a point another tab forgot, even without writing anything itself
  const storage = shared(), a = createResumePoints({storage, minIntervalMs: 0}), b = createResumePoints({storage, minIntervalMs: 0});
  await b.save('P', {chunk: 2, word: 0}, {force: true}); await a.get('P'); await b.get('P');
  await a.forget('P');
  ok(await b.get('P') === null, 'tab B reads the current store, not its old copy');
}
{ // throttled writes of two tabs keep both points; a later write of one tab keeps the other tab's newer point
  const storage = shared(), a = createResumePoints({storage, minIntervalMs: 60_000}), b = createResumePoints({storage, minIntervalMs: 60_000});
  await a.save('A1', {chunk: 1, word: 1}, {force: true});
  await b.save('B1', {chunk: 2, word: 2}, {force: true});
  await a.save('A1', {chunk: 3, word: 0});                 // throttled: not yet written
  ok(storage.data.resumePoints?.A1?.chunk === 1, 'a throttled save is not written at once');
  ok((await a.get('A1'))?.chunk === 3, 'the tab sees its own unsaved place');
  await a.flushPending();
  ok(storage.data.resumePoints?.A1?.chunk === 3 && storage.data.resumePoints?.B1?.chunk === 2, 'flushPending writes the place and keeps the other tab\'s point');
}
{ // concurrent forgets/saves in one tab still leave no point (2.5.4 order, kept from replay-finished-page)
  const storage = shared(), a = createResumePoints({storage, minIntervalMs: 0});
  await a.save('E', {chunk: 9, word: 9}, {force: true});
  await Promise.all([a.forget('E'), a.forget('E')]);
  ok(!('E' in (storage.data.resumePoints || {})), 'two forgets at once leave no point');
}
{ // the bound still holds (oldest points go first)
  let t = 0; const storage = shared(), a = createResumePoints({storage, minIntervalMs: 0, max: 3, now: () => ++t});
  for (const k of ['k1', 'k2', 'k3', 'k4']) await a.save(k, {chunk: 0, word: 1}, {force: true});
  ok(Object.keys(storage.data.resumePoints).sort().join() === 'k2,k3,k4', 'at most max points, the oldest is dropped');
}
console.log(`RESUME POINTS TABS OK (${checks} checks)`);
