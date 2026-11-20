#!/usr/bin/env node
/* Recreates extension/vendor/explain/transformers.min.js (runtime of the optional explanation feature) from the npm package named in
   extension/vendor/explain/provenance.json: download the tarball, check its sha512 integrity, take dist/transformers.min.js, apply the two
   documented edits (local runtime path, remote models off) and check the SHA-256 of the result. The file is not in Git (a secret scanner
   reports a false positive in it), so a build from a fresh checkout runs this first.  Own code, MIT.
   Run: node tools/fetch-transformers.mjs [--force]   -> "TRANSFORMERS OK <sha256>" */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), DIR = join(ROOT, 'extension/vendor/explain'), TARGET = join(DIR, 'transformers.min.js');
const provenance = JSON.parse(readFileSync(join(DIR, 'provenance.json'), 'utf8')), want = provenance.files['transformers.min.js'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
if (existsSync(TARGET) && !process.argv.includes('--force') && sha256(readFileSync(TARGET)) === want.sha256) { console.log('TRANSFORMERS OK ' + want.sha256 + ' (already there)'); process.exit(0); }

const response = await fetch(provenance.runtime.tarball);
if (!response.ok) throw new Error('download failed: HTTP ' + response.status);
const tgz = Buffer.from(await response.arrayBuffer());
const [algo, digest] = provenance.runtime.integrity.split('-');
if (createHash(algo).update(tgz).digest('base64') !== digest) throw new Error('tarball integrity does not match provenance.json');

/* the one file out of the tar stream (512-byte headers, size in octal) */
const tar = gunzipSync(tgz); let file = null;
for (let at = 0; at + 512 <= tar.length;) {
  const name = tar.toString('utf8', at, at + 100).replace(/\0.*$/s, ''), size = parseInt(tar.toString('utf8', at + 124, at + 136).replace(/\0.*$/s, '').trim() || '0', 8);
  if (!name) break;
  if (name === 'package/dist/transformers.min.js') { file = tar.subarray(at + 512, at + 512 + size).toString('utf8'); break; }
  at += 512 + Math.ceil(size / 512) * 512;
}
if (!file) throw new Error('dist/transformers.min.js not in the tarball');

/* the two edits recorded in provenance.json "modifications" */
const EDITS = [
  ['allowRemoteModels:!0', 'allowRemoteModels:!1'],
  ['let e=`https://cdn.jsdelivr.net/npm/onnxruntime-web@${it.versions.web}/dist/`', 'let e=new URL("./",import.meta.url).href'],
];
for (const [from, to] of EDITS) {
  const count = file.split(from).length - 1;
  if (count !== 1) throw new Error(`edit expected once, found ${count}x: ${from}`);
  file = file.replace(from, () => to);
}
const bytes = Buffer.from(file, 'utf8'), got = sha256(bytes);
if (got !== want.sha256 || bytes.length !== want.bytes) throw new Error(`result ${got} (${bytes.length} bytes) differs from provenance.json ${want.sha256} (${want.bytes} bytes)`);
writeFileSync(TARGET, bytes);
console.log('TRANSFORMERS OK ' + got);
