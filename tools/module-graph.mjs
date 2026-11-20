#!/usr/bin/env node
/* Reachability graph of the extension directory.
 *
 *   node tools/module-graph.mjs [extension-dir] [--json]
 *
 * Starts at the manifest entry points (background, popup, side panel, icons, locales) and follows every
 * string literal that names an existing file: static and dynamic imports, new URL(...), runtime.getURL(...),
 * scripting.executeScript files, HTML src/href, CSS url(). Comments are ignored, so a file that is only
 * mentioned in a comment counts as unreachable. Directory literals are expanded inside vendor/ trees
 * (pdf.js cmaps, fonts, WebAssembly). Listening samples are reachable when the voice catalogue names them.
 *
 * The result separates documentation and license files (shipped for compliance, never loaded) from
 * genuinely unreachable files. tools/build.py fails the package check on any unreachable file.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';

const args = process.argv.slice(2);
const json = args.includes('--json');
const root = path.resolve(args.find(a => !a.startsWith('--')) || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension'));
const posix = p => p.split(path.sep).join('/');

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.name === '__pycache__') continue;
    if (entry.isDirectory()) walk(relative); else if (entry.isFile()) files.push(relative);
  }
})('');
const fileSet = new Set(files);
const isVendor = file => /(^|\/)vendor\//.test(file);

/* Documentation and license texts: shipped for compliance or reference, not loaded by code. */
const DOCUMENTATION = [/(^|\/)(README|PRIVACY|THIRD_PARTY_NOTICES|PROVENANCE|NOTICE)\.md$/i, /(^|\/)(LICENSE|COPYING)(-[A-Z]+)?$/, /(^|\/)LICENSE_[A-Z0-9_]+$/,
  /-LICENSE(\.md)?$/, /(^|\/)(L?GPL-3\.0\.txt|ThirdPartyNotices\.txt|onnxruntime-ThirdPartyNotices\.txt)$/, /-MODEL-CARD$/, /(^|\/)UPSTREAM-[A-Z]+(\.md)?$/,
  /(^|\/)(provenance|upstream-package|runtime-hashes)\.json$/, /(^|\/)standard_fonts\/LICENSE_[A-Z_]+$/];
const isDocumentation = file => DOCUMENTATION.some(re => re.test(file));

/* One pass over JavaScript: returns string literals outside comments (template literals only without ${}). */
function jsLiterals(source) {
  const out = [];
  let i = 0, last = '';
  const n = source.length;
  const regexAllowed = () => !last || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || /\b(return|typeof|case|do|else|in|of|void|yield|await|delete|new|throw)$/.test(last);
  while (i < n) {
    const c = source[i], d = source[i + 1];
    if (c === '/' && d === '/') { while (i < n && source[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const end = source.indexOf('*/', i + 2); i = end < 0 ? n : end + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1, value = '', dynamic = false;
      while (j < n && source[j] !== c) {
        if (source[j] === '\\') { value += source[j + 1] ?? ''; j += 2; continue; }
        if (c === '`' && source[j] === '$' && source[j + 1] === '{') {
          dynamic = true;
          let depth = 1; j += 2;
          while (j < n && depth) { if (source[j] === '{') depth++; else if (source[j] === '}') depth--; j++; }
          continue;
        }
        if (c !== '`' && source[j] === '\n') break;
        value += source[j]; j++;
      }
      if (!dynamic) out.push(value);
      i = j + 1; last = 'x';
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false;
      while (j < n && source[j] !== '\n') {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === '[') inClass = true; else if (source[j] === ']') inClass = false; else if (source[j] === '/' && !inClass) break;
        j++;
      }
      i = j + 1; last = 'x';
      continue;
    }
    if (!/\s/.test(c)) {
      if (/[\w$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(source[j])) j++; last = source.slice(i, j); i = j; continue; }
      last = c;
    }
    i++;
  }
  return out;
}

function literalsOf(file) {
  // The manifest's entry points are read explicitly below; its web_accessible_resources only declare what pages may load.
  if (file === 'manifest.json' || file.startsWith('_locales/') || isDocumentation(file)) return [];
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (/\.(m?js|cjs)$/.test(file)) return isVendor(file) ? [...text.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.){1,300})\1/g)].map(m => m[2]) : jsLiterals(text);
  if (/\.html$/.test(file)) return [...text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/(['"])([^'"\n]{1,300})\1/g)].map(m => m[2]);
  if (/\.css$/.test(file)) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g), ...css.matchAll(/(['"])([^'"\n]{1,300})\1/g)].map(m => m[m.length - 1]);
  }
  if (/\.(json|webmanifest)$/.test(file)) {
    const values = [];
    const visit = value => { if (typeof value === 'string') values.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(visit); };
    try { visit(JSON.parse(text)); } catch { /* not JSON: no references */ }
    return values;
  }
  return [];
}

function resolve(from, literal) {
  const clean = literal.trim().replace(/[?#].*$/, '');
  if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.length > 260) return [];
  const found = [];
  const candidates = new Set([path.posix.normalize(path.posix.join(path.posix.dirname(from), clean)), path.posix.normalize(clean.replace(/^\/+/, ''))]);
  for (const candidate of candidates) {
    if (candidate.startsWith('..') || candidate === '.') continue;
    if (fileSet.has(candidate)) found.push(candidate);
    else if (isVendor(candidate + '/') && fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isDirectory())
      found.push(...files.filter(f => f.startsWith(candidate.replace(/\/$/, '') + '/')));
  }
  return found;
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const roots = new Set(['manifest.json', ...files.filter(f => /^_locales\/[^/]+\/messages\.json$/.test(f))]);
const add = value => { if (typeof value === 'string' && fileSet.has(value)) roots.add(value); };
add(manifest.background?.service_worker); (manifest.background?.scripts || []).forEach(add); add(manifest.background?.page);
add(manifest.action?.default_popup); add(manifest.side_panel?.default_path); add(manifest.sidebar_action?.default_panel);
add(manifest.options_ui?.page); add(manifest.options_page);
Object.values(manifest.icons || {}).forEach(add); Object.values(manifest.action?.default_icon || {}).forEach(add);
for (const script of manifest.content_scripts || []) [...(script.js || []), ...(script.css || [])].forEach(add);

const reachable = new Set();
const stack = [...roots];
while (stack.length) {
  const file = stack.pop();
  if (reachable.has(file)) continue;
  reachable.add(file);
  for (const literal of literalsOf(file)) for (const target of resolve(file, literal)) if (!reachable.has(target)) stack.push(target);
}

/* Listening samples are named by the voice catalogue data (paths are partly computed). */
const catalogFile = 'tools/reader/neural-models.js';
const samples = new Set();
if (fileSet.has(catalogFile) && reachable.has(catalogFile)) {
  const {MODELS} = await import(pathToFileURL(path.join(root, catalogFile)).href);
  for (const model of Object.values(MODELS)) if (typeof model.sample === 'string') samples.add(model.sample.replace(/^\/+/, ''));
}
for (const sample of samples) if (fileSet.has(sample)) reachable.add(sample);
const missingSamples = [...samples].filter(sample => !fileSet.has(sample)).sort();

const documentation = files.filter(f => !reachable.has(f) && isDocumentation(f));
const unreachable = files.filter(f => !reachable.has(f) && !isDocumentation(f));
const result = {root: posix(root), files: files.length, reachable: [...reachable].sort(), documentation, unreachable, missingSamples};
if (json) process.stdout.write(JSON.stringify(result) + '\n');
else {
  console.log(`${files.length} files, ${reachable.size} reachable, ${documentation.length} documentation/license files, ${unreachable.length} unreachable`);
  for (const file of unreachable) console.log('  unreachable: ' + file);
  for (const file of missingSamples) console.log('  missing sample: ' + file);
}
