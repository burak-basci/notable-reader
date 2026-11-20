#!/usr/bin/env node
/* beNotable! Reader · web app build (own code, MIT).

   node tools/build-webapp.mjs --out <dir> [--out <dir2> ...] [--version 2.4.1] [--rev r10]

   ONE code base: the web app at reader.benotable.de/app/ is the extension's file view (extension/tools/reader/reader.{html,js,css}) running the SAME modules (page session, bar,
   voice picker, engine, playback, export, appearance, locales ...) in a normal page. This script copies exactly the modules the file view needs from extension/ (same relative
   layout, so every import stays untouched), adds a small adapter (tools/webapp/web-runtime.mjs: the part of the extension API the modules use, in the page; web-boot.mjs: start order;
   web.css) and derives index.html from the extension's reader.html. Nothing is forked: change a module in extension/ and rebuild.

   Differences from the extension are only these (see PATCHES for the few exact text replacements, each with an expected hit count; the build stops when the source drifts):
     - no website navigation on top (the website is the frame), brand "beNotable! Reader";
     - settings and reading places in localStorage instead of chrome.storage, the engine host runs in the page instead of the offscreen document;
     - no Focus-tab hand-over, no global browser shortcuts, no downloads/permissions API.
   Output: index.html, sw.js (offline cache), offline-assets.json (+ offline-assets.sha256.json), app.webmanifest, license/notice files and the module tree. Deterministic: same input, same bytes. */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'extension'), WEB = join(ROOT, 'tools', 'webapp');

const args = process.argv.slice(2), outs = [];
let version = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8')).version, rev = 'r10';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outs.push(resolve(args[++i])); else if (args[i] === '--version') version = args[++i]; else if (args[i] === '--rev') rev = args[++i];
  else { console.error('Unbekannte Option ' + args[i]); process.exit(2); }
}
if (!outs.length) { console.error('Aufruf: node tools/build-webapp.mjs --out <Ordner> [--out <Ordner2>]'); process.exit(2); }
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^r\d+$/.test(rev)) { console.error('Version oder Revision ungueltig'); process.exit(2); }
const CACHE = `notable-reader-${version}-${rev}`;

/* What the file view needs from extension/ (relative to extension/). Directories are copied whole, minus EXCLUDE. */
const DIRS = ['engine', 'playback', 'session', 'export', 'platform', 'models', 'samples', 'tools/reader', 'library', 'explain', 'vendor/explain'];
// Guided explanation: the same modules as the extension (the model worker runs from the page host). The model itself is downloaded only after the click in the card (huggingface.co).
const FILES = ['appearance.mjs', 'appearance-schema.js', 'config.mjs', 'formatting.mjs', 'player-surface.mjs', 'voice-picker.mjs', 'scrollbars.mjs', 'premium-browser.mjs', 'pricing.mjs', 'product-config.js', 'ui-locales.json', 'i18n.js'];
const EXCLUDE = new Set([
  'explain/panel.html', 'explain/panel.mjs', 'explain/panel.css',   // the extension's side panel, not part of the page
  'tools/reader/reader.html',          // replaced by the derived index.html
  'tools/reader/app.webmanifest',      // replaced by the generated one
  'tools/reader/vendor/export/lamejs-corresponding-source.tar.gz',                         // 2.9 MB source archive: published with the source (WEB-SOURCE-NOTICE.md), not served as app file
]);
/* Not precached (fetched and cached on first use): the optional WebGPU runtime (18 MB, only for the Experimental tier) and the voice samples (2.5 MB, played on demand). */
const LAZY = [/^tools\/reader\/vendor\/neural\/ort-webgpu\//, /^samples\//, /^vendor\/explain\//];
const LICENSE_FILES = [['tools/reader/COPYING', 'COPYING'], ['tools/reader/LICENSE', 'LICENSE'], ['tools/reader/LICENSE-MIT', 'LICENSE-MIT'], ['tools/reader/THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md']];

/* Exact text replacements in copied files: [file, old, new, expected hits]. Fewer is better; each one is a place where the extension API has no web equivalent. */
const PATCHES = [
  // The "global shortcut" note of the keyboard help names Alt+Shift+V/K and chrome://extensions/shortcuts: it only exists in the installed extension.
  ['player-surface.mjs', "if(globalThis.chrome?.runtime?.id)notes.splice(1,0,mac?uiText('kbHelpGlobalMac',",
    "if(globalThis.chrome?.runtime?.id&&!globalThis.chrome.runtime.web)notes.splice(1,0,mac?uiText('kbHelpGlobalMac',", 1],
];

const sha256 = data => createHash('sha256').update(data).digest('hex');
const posix = p => p.split(sep).join('/');
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base)); else if (entry.isFile()) out.push(posix(relative(base, full)));
  }
  return out;
}

function sources() {
  const files = new Map();     // output path -> Buffer
  const add = (path, data) => { if (files.has(path)) throw new Error('doppelter Pfad ' + path); files.set(path, data); };
  for (const dir of DIRS) for (const file of walk(join(EXT, dir))) { const path = `${dir}/${file}`; if (!EXCLUDE.has(path)) add(path, readFileSync(join(EXT, path))); }
  for (const file of FILES) add(file, readFileSync(join(EXT, file)));
  for (const [from, to] of LICENSE_FILES) add(to, readFileSync(join(EXT, from)));
  for (const path of [...files.keys()]) if (/\.(mjs|js)$/.test(path) && /(^|\/)(__tests__|test)/.test(path)) files.delete(path);
  return files;
}

function applyPatches(files) {
  for (const [file, from, to, expected] of PATCHES) {
    const text = files.get(file)?.toString('utf8');
    if (text === undefined) throw new Error('Patch: Datei fehlt ' + file);
    const hits = text.split(from).length - 1;
    if (hits !== expected) throw new Error(`Patch in ${file}: ${hits} Treffer statt ${expected} (Quelle geaendert? tools/build-webapp.mjs PATCHES anpassen)`);
    files.set(file, Buffer.from(text.split(from).join(to)));
  }
}

/* index.html = the extension's file view page, re-rooted and without everything the web app does not have. */
function indexHtml() {
  let html = readFileSync(join(EXT, 'tools/reader/reader.html'), 'utf8');
  const must = (condition, what) => { if (!condition) throw new Error('index.html: ' + what + ' nicht gefunden (reader.html geaendert?)'); };
  const cut = (re, replacement, what) => { must(re.test(html), what); html = html.replace(re, replacement); };
  // Website navigation on top: gone. reader.js still binds #header-open and #header-converter, so they stay as inert, empty stand-ins;
  // "show player" becomes a small floating button (the bar can be closed with X). reader.html has no paid-edition or donation elements since 2.4.2.
  cut(/<header class="app-header">[\s\S]*?<\/header>/, '<div hidden aria-hidden="true"><button id="header-open" type="button"></button><button id="header-converter" type="button"></button></div>'
    + '<button id="show-player" class="show-player" type="button" hidden data-i18n="fileShowPlayer">Player anzeigen</button>', 'header');
  // Paths: the module tree keeps the extension's layout, the page sits at the root.
  cut(/<h1 data-i18n="fileImportHeading">/, '<p class="brand">beNotable! Reader</p><h1 data-i18n="fileImportHeading">', 'Importtitel');
  cut(/<link rel="icon" href="icons\/icon-32\.png">/, '<link rel="icon" href="tools/reader/icons/icon-32.png"><link rel="canonical" href="https://reader.benotable.de/app/">', 'Favicon');
  cut(/<link rel="manifest" href="app\.webmanifest">/, '<link rel="manifest" href="app.webmanifest"><link rel="apple-touch-icon" href="tools/reader/icons/icon-192.png">', 'Manifest');
  cut(/<link rel="stylesheet" href="reader\.css">/, '<link rel="stylesheet" href="tools/reader/reader.css"><link rel="stylesheet" href="web.css">', 'Stylesheet');
  cut(/<script src="core\.js"><\/script><script type="module" src="reader\.js"><\/script>/, '<script src="tools/reader/core.js"></script><script type="module" src="web-boot.mjs"></script>', 'Skripte');
  return html;
}

/* The message catalogue is the extension's; a few texts name the extension, Premium, licenses or browser-wide shortcuts and are worded for the web app (tools/webapp/web-messages.json, all six languages per key). */
function catalogue(files) {
  const raw = files.get('ui-locales.json').toString('utf8'), data = JSON.parse(raw), overrides = JSON.parse(readFileSync(join(WEB, 'web-messages.json'), 'utf8'));
  for (const [key, byLang] of Object.entries(overrides)) {
    for (const lang of Object.keys(data.messages)) {
      if (typeof byLang[lang] !== 'string' || !byLang[lang]) throw new Error(`web-messages.json: ${key} fehlt in ${lang}`);
      if (!(key in data.messages[lang])) throw new Error(`web-messages.json: Schluessel ${key} existiert nicht mehr in ui-locales.json (${lang})`);
      const was = [...data.messages[lang][key].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(), now = [...byLang[lang].matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join();
      if (was !== now) throw new Error(`web-messages.json: Platzhalter von ${key} (${lang}) weichen ab: ${was} / ${now}`);
      data.messages[lang][key] = byLang[lang];
    }
  }
  return Buffer.from(JSON.stringify(data, null, 1) + (raw.endsWith('\n') ? '\n' : ''));
}

function manifest() {
  const icon = size => ({src: `tools/reader/icons/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any'});
  return JSON.stringify({name: 'beNotable! Reader', short_name: 'beNotable!', description: 'PDFs, E-Books und Texte lokal vorlesen und als Hörbuch exportieren.', id: './', start_url: './', scope: './', display: 'standalone',
    background_color: '#f6f7f5', theme_color: '#145c4c', lang: 'de', icons: [icon(192), icon(512)]}, null, 2) + '\n';
}

function notice() {
  return `# beNotable! Reader (Web-App ${version}) – Quellen

Diese Web-App wird aus demselben Quellcode gebaut wie die Browser-Erweiterung beNotable! Reader ${version}: die Dateiansicht der Erweiterung (extension/tools/reader) läuft mit denselben Modulen
(Leiste, Stimmenliste, Engine, Wiedergabe, Hörbuch-Export, Darstellung, Sprachen) in einer normalen Seite. Dokumente und Audio werden lokal verarbeitet; Stimmenmodelle lädt die App nur nach
ausdrücklichem Klick und prüft sie per SHA-256. Hörbuch- und Dokument-Downloads sind in der Web-App kostenlos.

Quellen, Fremdkomponenten und Buildhinweise: https://github.com/burak-basci/notable-reader (Verzeichnisse extension/, tools/, third_party_sources/).
Reproduzieren: \`node tools/build-webapp.mjs --out <Ordner>\` (nur Node ab 18, keine Abhängigkeiten). Der Adapter zwischen Erweiterungs-Modulen und Browserseite steht in tools/webapp/
(web-runtime.mjs, web-boot.mjs, web.css), die wenigen Textersetzungen in tools/build-webapp.mjs (PATCHES). Der unveränderte LGPL-MP3-Encoder (lamejs) mit vollständigem korrespondierendem
Quellarchiv liegt im Quellpaket unter extension/tools/reader/vendor/export/. Eigener Code: GPL-3.0-or-later (Gesamtauslieferung wegen eSpeak NG), zusätzlich MIT; Fremdlizenzen: THIRD_PARTY_NOTICES.md.
`;
}

function serviceWorker(precache) {
  return readFileSync(join(WEB, 'sw.template.js'), 'utf8').replace('__CACHE__', CACHE).replace('__SHELL__', JSON.stringify(precache, null, 0));
}

function build(out) {
  const files = sources();
  applyPatches(files);
  files.set('ui-locales.json', catalogue(files));
  files.set('index.html', Buffer.from(indexHtml()));
  for (const name of ['web-runtime.mjs', 'web-boot.mjs']) files.set(name, Buffer.from(readFileSync(join(WEB, name), 'utf8').replace('__WEB_VERSION__', version)));
  files.set('web.css', readFileSync(join(WEB, 'web.css')));
  files.set('app.webmanifest', Buffer.from(manifest()));
  files.set('WEB-SOURCE-NOTICE.md', Buffer.from(notice()));
  files.set('version.json', Buffer.from(JSON.stringify({app: 'beNotable! Reader', version, cache: CACHE}, null, 2) + '\n'));

  // offline list: everything except the lazy parts and the files that cannot cache themselves
  const names = [...files.keys()].sort();
  const precache = ['./', ...names.filter(n => n !== 'sw.js' && !LAZY.some(re => re.test(n)) && !n.startsWith('offline-assets')).map(n => './' + n)];
  const hashes = Object.fromEntries(names.filter(n => precache.includes('./' + n)).map(n => [n, sha256(files.get(n))]));
  files.set('offline-assets.json', Buffer.from(JSON.stringify(precache, null, 2) + '\n'));
  files.set('offline-assets.sha256.json', Buffer.from(JSON.stringify({version, cache: CACHE, files: hashes, lazy: names.filter(n => LAZY.some(re => re.test(n)))}, null, 2) + '\n'));
  files.set('sw.js', Buffer.from(serviceWorker(precache.filter(p => p !== './'))));

  checkImports(files);
  if (existsSync(out)) rmSync(out, {recursive: true, force: true});
  for (const [name, data] of [...files].sort()) { const target = join(out, name); mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, data); }
  const bytes = [...files.values()].reduce((sum, d) => sum + d.length, 0);
  console.log(`ok ${out}: ${files.size} Dateien, ${(bytes / 1048576).toFixed(1)} MB, Cache ${CACHE}, Offline-Liste ${precache.length} Eintraege`);
}

/* Every relative static/dynamic import of the output must resolve inside it (the module tree keeps the extension's layout, so a miss means a new dependency outside DIRS/FILES). */
function checkImports(files) {
  const missing = [];
  const re = /(?:import|export)\s[^'"`;]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|^\s*import\s*['"](\.[^'"]+)['"]|new (?:Worker|URL)\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/gm;
  for (const [name, data] of files) {
    if (!/\.(mjs|js)$/.test(name) || name.includes('/vendor/')) continue;
    for (const m of data.toString('utf8').matchAll(re)) {
      const spec = m[1] || m[2] || m[3] || m[4];
      const target = posix(join(dirname(name), spec)).replace(/\/$/, '');
      if (target === '' || target === '.') continue;
      if (!files.has(target) && ![...files.keys()].some(k => k.startsWith(target + '/'))) missing.push(`${name} -> ${spec}`);
    }
  }
  // optional lookup that is caught at runtime (the web app has no manifest.json; the model download then simply keeps its storage-quota check)
  const known = new Set(['explain/model-store.mjs -> ../manifest.json']);
  for (let i = missing.length - 1; i >= 0; i--) if (known.has(missing[i])) missing.splice(i, 1);
  if (missing.length) throw new Error('Importe ausserhalb des Pakets:\n  ' + missing.join('\n  '));
}

for (const out of outs) build(out);
