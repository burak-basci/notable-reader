#!/usr/bin/env node
/* Browser run of the stand-alone web app (no extension): build -> serve on 127.0.0.1 -> real clicks.

   node tests/webapp-browser.mjs [--out <scratch dir>] [--scenarios desktop,mobile,noheaders,credentialless,swisolate] [--pdf <file.pdf>] [--en] [--default-context] [--skip-build]

   --en               also run the English voice (Bella FP32, 326 MB from huggingface.co). A private/incognito browser context cannot store a model that large in the Cache API
                      ("Unexpected internal error" above ~300 MB, measured here): use --default-context with a normal (persistent) browser profile for it.
   --default-context  run in the browser's default context (own tab, emulated viewport/touch through CDP, site data of the test origin removed at the end) instead of a new private context.

   Needs: Node >= 18, ffprobe/ffmpeg (checks the exported audio), playwright-core and a Chromium reachable over CDP (nothing is started here, the run uses its own browser
   context and closes it): CDP_URL (default http://127.0.0.1:9444), PLAYWRIGHT_ROOT (folder whose node_modules has playwright-core; default the repo, then ~/work/pin-creatives).
   Network: voices come from huggingface.co after the click (DE Thorsten ~114 MB, EN Bella with --en or by default in "desktop"/"mobile"); every other external request fails the run.
   Result: PASS/FAIL per step, exit code 1 on any FAIL. Screenshots and exported files: <out>/shots, <out>/downloads. Nothing audible is played (headless). */
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from './webapp-serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; }, flag = n => args.includes(n);
const OUT = resolve(opt('--out', join(tmpdir(), 'notable-webapp-test')));
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9444';
const WANT = (opt('--scenarios', 'desktop,mobile,noheaders,credentialless,swisolate')).split(',');
const SKIP_BUILD = flag('--skip-build'), WITH_EN = flag('--en'), DEFAULT_CTX = flag('--default-context');
let touch = null;      // {cdp} when taps must be sent through CDP (default context cannot be created with hasTouch)

function playwright() {
  for (const base of [process.env.PLAYWRIGHT_ROOT, ROOT, join(homedir(), 'work/pin-creatives')].filter(Boolean)) {
    try { return createRequire(join(resolve(base), 'node_modules') + '/')('playwright-core'); } catch {}
  }
  throw new Error('playwright-core nicht gefunden (PLAYWRIGHT_ROOT setzen)');
}
const {chromium} = playwright();

/* ---- fixtures ------------------------------------------------------------------------------------------------------------------------------------ */
const DE = 'Dies ist ein kurzer Testtext. Er wird jetzt vorgelesen, damit wir sehen, ob alles funktioniert. Noch ein dritter Satz folgt hier.';
const EN = 'This is a short test text. It is read aloud right now, so that we can see whether everything works. A third sentence follows here.';
function makePdf(path) {   // two pages of plain Helvetica text, valid xref table
  const lines = [['Das Grundgesetz ist ein Testdokument.', 'Erster Absatz mit genug Woertern fuer eine kurze Vorlesepruefung.', 'Zweiter Absatz folgt hier und dann ist die Seite zu Ende.'],
    ['Zweite Seite des Dokuments.', 'Auch hier steht ein ganzer Satz, der vorgelesen werden kann.']];
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${lines.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${lines.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  lines.forEach((page, i) => {
    const content = 'BT /F1 14 Tf 60 760 Td 22 TL ' + page.map(l => `(${l}) Tj T*`).join(' ') + ' ET';
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let body = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length; body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(path, body, 'latin1');
}

/* ---- reporting ----------------------------------------------------------------------------------------------------------------------------------- */
const results = []; let scenarioName = '', shotNo = 0;
const log = (...a) => console.log(...a);
async function step(name, fn) {
  const t0 = Date.now(); let ok = true, detail = '';
  try { const r = await fn(); detail = r === undefined ? '' : typeof r === 'string' ? r : JSON.stringify(r); } catch (e) { ok = false; detail = String(e?.message || e).split('\n')[0].slice(0, 300); }
  results.push({scenario: scenarioName, name, ok, detail, ms: Date.now() - t0});
  log(`${ok ? 'PASS' : 'FAIL'}  [${scenarioName}] ${name}${detail ? ' :: ' + detail : ''} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return ok;
}
const must = (c, m) => { if (!c) throw new Error(m); };

/* ---- page helpers (the bar lives in a shadow root; Playwright CSS selectors pierce it) ----------------------------------------------------------- */
const bar = p => ({
  async state() {
    return p.evaluate(() => {
      let host = null; for (const e of document.querySelectorAll('*')) if (e.shadowRoot?.querySelector('.voice-btn')) host = e;
      if (!host) return null; const r = host.shadowRoot, g = s => r.querySelector(s), hl = globalThis.CSS?.highlights?.get('notable-word');
      let word = ''; try { word = hl ? [...hl][0]?.toString() || '' : ''; } catch {}
      const rect = g('.primary')?.getBoundingClientRect();
      return {label: g('.primary')?.getAttribute('aria-label') || '', status: g('.status')?.innerText || '', seek: Number(g('.seek-progress')?.value || 0), word, speed: g('.speed-trigger')?.getAttribute('aria-label') || '', voice: g('.voice-btn')?.innerText || '',
        playVisible: !!rect && rect.width > 0 && rect.bottom <= innerHeight + 1 && rect.right <= innerWidth + 1 && rect.left >= -1};
    });
  },
});
async function shot(p, name) { await p.screenshot({path: join(OUT, 'shots', `${scenarioName}-${String(++shotNo).padStart(2, '0')}-${name}.png`)}); }
async function tap(p, sel, mobile) {
  const loc = p.locator(sel).first();
  if (!mobile) return loc.click();
  if (!touch) return loc.tap();
  await loc.scrollIntoViewIfNeeded(); const box = await loc.boundingBox(); const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await touch.cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]}); await touch.cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
}

async function openText(p, text, mobile) {
  await p.fill('#paste', text); await tap(p, '#load-text', mobile);
  await p.waitForFunction(t => document.body.innerText.includes(t.slice(0, 20)), text, {timeout: 15000});
}
/* Play: the first click on a voice that is not on the device starts the download; "Ready" ends it, the next click reads. Returns {downloadMs, firstAudioMs}. */
async function startReading(p, mobile, {downloadTimeout = 240000} = {}) {
  const b = bar(p), t0 = Date.now(); let downloadMs = 0, clickedAt = Date.now();
  await tap(p, '.primary[aria-label^="Play"]', mobile);
  for (;;) {
    await p.waitForTimeout(120); const s = await b.state();
    if (/^Pause/.test(s.label) && s.status === 'Reading') return {downloadMs, firstAudioMs: Date.now() - clickedAt};
    if (s.status === 'Ready' && /^Play/.test(s.label)) { downloadMs = Date.now() - t0; await p.waitForTimeout(400); clickedAt = Date.now(); await tap(p, '.primary[aria-label^="Play"]', mobile); }
    if (/failed/i.test(s.status)) throw new Error('Wiedergabe fehlgeschlagen: ' + s.status);
    if (Date.now() - t0 > downloadTimeout) throw new Error('keine Wiedergabe nach ' + downloadTimeout / 1000 + ' s: ' + JSON.stringify(s));
  }
}
async function watchWords(p, ms = 4000) {
  const b = bar(p), words = new Set(), t0 = Date.now(); let moved = false, seek0 = null;
  while (Date.now() - t0 < ms) { const s = await b.state(); if (s.word) words.add(s.word); if (seek0 === null) seek0 = s.seek; else if (s.seek > seek0) moved = true; await p.waitForTimeout(100); }
  return {words: [...words], timelineMoved: moved};
}
async function pauseIfPlaying(p, mobile) { const s = await bar(p).state(); if (/^Pause/.test(s.label)) { await tap(p, '.primary[aria-label^="Pause"]', mobile); await p.waitForFunction(() => { for (const e of document.querySelectorAll('*')) { const l = e.shadowRoot?.querySelector('.primary')?.getAttribute('aria-label'); if (l) return /^(Play|Resume)/.test(l); } }, null, {timeout: 10000}); } }

async function setSpeed(p, mobile) {
  await tap(p, '.speed-trigger', mobile); await p.waitForTimeout(300);
  const info = await p.evaluate(() => { const i = [...document.querySelectorAll('*')].map(e => e.shadowRoot?.querySelector('.speed-pop input[type=range]')).find(Boolean); return {min: i.min, max: i.max}; });
  const sl = p.locator('.speed-pop input[type=range]').first();
  await sl.focus(); await p.keyboard.press('End'); await p.waitForTimeout(200);
  const atMax = (await bar(p).state()).speed;
  // a value above the maximum (typed or scripted) must be clamped
  await p.evaluate(() => { const i = [...document.querySelectorAll('*')].map(e => e.shadowRoot?.querySelector('.speed-pop input[type=range]')).find(Boolean); i.value = '6'; i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); });
  await p.waitForTimeout(300); const over = (await bar(p).state()).speed;
  return {...info, atMax, afterSix: over};
}
async function resetSpeed(p, mobile) {
  const sl = p.locator('.speed-pop input[type=range]').first(); if (!(await sl.count())) await tap(p, '.speed-trigger', mobile);
  await p.locator('.speed-pop input[type=range]').first().focus(); await p.evaluate(() => { const i = [...document.querySelectorAll('*')].map(e => e.shadowRoot?.querySelector('.speed-pop input[type=range]')).find(Boolean); i.value = '1'; i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); });
  await p.keyboard.press('Escape');
}

/* export through the bar's download menu: More -> Download -> format -> Download */
async function exportFile(p, format, mobile, dir) {
  // a menu that still shows the result of the last file: "Another file" returns to the choice
  const again = p.locator('.download-menu .dlm-again'); if (await again.count() && await again.first().isVisible()) await again.first().click();
  if (!(await p.locator('.download-menu .dlm-format').first().isVisible().catch(() => false))) {
    await tap(p, '.more-toggle', mobile); await p.waitForTimeout(300);
    await p.locator('.more-menu >> text=Download').first().click();
  }
  await p.waitForSelector('.download-menu .dlm-format', {state: 'visible', timeout: 10000});
  await p.locator('.download-menu .dlm-format', {hasText: new RegExp('^\\s*' + format, 'i')}).first().click();
  const t0 = Date.now(), dl = p.waitForEvent('download', {timeout: 240000});
  await p.locator('.download-menu .dlm-start').first().click();
  const d = await dl, name = d.suggestedFilename(), path = join(dir, name); const bad = await d.failure(); if (bad) throw new Error('Download fehlgeschlagen: ' + bad); await d.saveAs(path);
  return {name, path, ms: Date.now() - t0, bytes: statSync(path).size};
}
function audioFacts(path) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_name,sample_rate,channels', '-of', 'json', path]).toString());
  const vol = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], {encoding: 'utf8'}).stderr;
  const mean = Number(/mean_volume:\s*(-?[\d.]+) dB/.exec(vol)?.[1]), max = Number(/max_volume:\s*(-?[\d.]+) dB/.exec(vol)?.[1]);
  return {duration: Number(Number(probe.format.duration).toFixed(2)), format: probe.format.format_name, codec: probe.streams?.[0]?.codec_name, rate: probe.streams?.[0]?.sample_rate, meanDb: mean, maxDb: max};
}

/* ---- scenario ------------------------------------------------------------------------------------------------------------------------------------ */
const ALLOWED = /^(huggingface\.co|(?:[a-z0-9-]+\.)*hf\.co|cdn-lfs[a-z0-9.-]*\.huggingface\.co|(?:[a-z0-9-]+\.)*huggingface\.co)$/;
async function scenario(browser, def) {
  scenarioName = def.name; shotNo = 0;
  const dir = join(OUT, 'downloads', def.name); mkdirSync(dir, {recursive: true});
  const served = await startServer(join(OUT, 'app'), {isolation: def.isolation, base: '/app/'});
  let ctx, p, cdp = null; touch = null;
  if (!DEFAULT_CTX) {
    ctx = await browser.newContext({viewport: def.viewport, acceptDownloads: true, serviceWorkers: def.sw === false ? 'block' : 'allow', ...(def.mobile ? {hasTouch: true, isMobile: true, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Mobile Safari/537.36'} : {})});
    p = await ctx.newPage();
  } else {
    ctx = browser.contexts()[0]; p = await ctx.newPage(); cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setDeviceMetricsOverride', {width: def.viewport.width, height: def.viewport.height, deviceScaleFactor: 1, mobile: !!def.mobile});
    if (def.mobile) { await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5}); touch = {cdp}; }
    if (def.sw === false) { await cdp.send('Network.enable'); await cdp.send('Network.setBypassServiceWorker', {bypass: true}); }
  }
  const external = new Set(), errors = [], failed = [];
  p.on('pageerror', e => errors.push(e.message.slice(0, 200)));
  p.on('request', r => { const u = new URL(r.url()); if (!/^(http|https|ws|wss):$/.test(u.protocol)) return; if (u.hostname !== '127.0.0.1') external.add(u.hostname); });
  p.on('requestfailed', r => { if (r.url().startsWith(served.url.slice(0, -4))) failed.push(r.url().slice(-80) + ' ' + r.failure()?.errorText); });
  p.on('response', r => { if (r.status() >= 400 && r.url().startsWith(served.url.slice(0, -4))) failed.push(r.status() + ' ' + r.url().slice(-80)); });
  const mobile = !!def.mobile, b = bar(p);
  try {
    await step('Seite laedt, crossOriginIsolated=' + def.isolated, async () => {
      const t0 = Date.now(); const resp = await p.goto(served.url, {waitUntil: 'load'}); must(resp.status() === 200, 'HTTP ' + resp.status());
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some(e => e.shadowRoot?.querySelector('.voice-btn')), null, {timeout: 20000});
      const iso = await p.evaluate(() => crossOriginIsolated); must(iso === def.isolated, 'crossOriginIsolated=' + iso);
      await shot(p, 'start'); return {loadMs: Date.now() - t0, isolated: iso, wasm: await p.evaluate(() => typeof SharedArrayBuffer)};
    });
    if (def.swIsolation) {
      await step('Service Worker aktiv, nach Neuladen isoliert ohne Serverkopfzeilen', async () => {
        await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(1500); await p.reload({waitUntil: 'load'});
        const iso = await p.evaluate(() => crossOriginIsolated); must(iso === true, 'nicht isoliert nach Neuladen'); return {isolated: iso};
      });
      await step('Offline-Huelle im Cache', async () => { let n = 0; for (let i = 0; i < 40 && n <= 300; i++) { n = await p.evaluate(async () => { const k = (await caches.keys()).find(k => /^notable-reader-\d/.test(k)); return k ? (await (await caches.open(k)).keys()).length : 0; }); if (n <= 300) await p.waitForTimeout(1000); } must(n > 300, 'nur ' + n + ' Eintraege'); return {cached: n}; });
    } else {
      await step('Kein Fehler in der Seitenkonsole beim Start', async () => { must(!errors.length && !failed.length, JSON.stringify({errors, failed}).slice(0, 300)); });
      await step('Text einfuegen, Text oeffnen (DE)', async () => { await openText(p, DE, mobile); await shot(p, 'text-de'); });
      let de;
      await step('DE Thorsten: Play laedt Stimme nach Klick und liest vor', async () => { de = await startReading(p, mobile); await shot(p, 'play-de'); return de; });
      await step('Wortmarkierung laeuft, Zeitleiste bewegt sich', async () => { const w = await watchWords(p, 5000); must(w.words.length >= 2, 'Woerter: ' + JSON.stringify(w)); must(w.timelineMoved, 'Zeitleiste steht'); return w; });
      await step('Tempo bis 4x, nicht hoeher', async () => {
        const r = await setSpeed(p, mobile); must(r.max === '4' && /4×/.test(r.atMax) && /4×/.test(r.afterSix) && !/[5-9]×/.test(r.afterSix), JSON.stringify(r)); await shot(p, 'speed-4x');
        await p.keyboard.press('Escape'); await resetSpeed(p, mobile); return r;
      });
      await step('Pause und Weiterlesen', async () => { await pauseIfPlaying(p, mobile); const s = await b.state(); must(/^(Play|Resume)/.test(s.label), s.label); await tap(p, '.primary[aria-label^="Resume"], .primary[aria-label^="Play"]', mobile); await p.waitForFunction(() => [...document.querySelectorAll('*')].some(e => /^Pause/.test(e.shadowRoot?.querySelector('.primary')?.getAttribute('aria-label') || '')), null, {timeout: 20000}); await pauseIfPlaying(p, mobile); });
      if (WITH_EN && !def.quick) {
        await step('EN Bella: Text oeffnen, Stimme nach Klick laden, vorlesen', async () => {
          await openText(p, EN, mobile); await p.waitForTimeout(800); const s0 = await b.state(); must(/Bella|Heart|English|Sky|Nicole/i.test(s0.voice + ' ' + await p.locator('.voice-btn').first().getAttribute('aria-label')), 'Stimme: ' + s0.voice);
          const r = await startReading(p, mobile, {downloadTimeout: 360000}); await shot(p, 'play-en'); const w = await watchWords(p, 4000); must(w.words.length >= 1, 'keine Markierung'); await pauseIfPlaying(p, mobile); return {...r, words: w.words.length};
        });
      }
      await step('Datei laden (PDF), Text erscheint', async () => {
        const pdf = def.pdf; await p.setInputFiles('#file', pdf);
        await p.waitForFunction(() => /pages?|section/i.test(document.querySelector('.reader-meta, #doc-meta, .meta, main')?.innerText || document.body.innerText) && document.body.innerText.length > 300, null, {timeout: 60000}); await p.waitForTimeout(1500); await shot(p, 'pdf');
        const s = await b.state(); return {status: s.status, bodyChars: await p.evaluate(() => document.body.innerText.length)};
      });
      await step('PDF wird vorgelesen (Wiedergabe, Markierung)', async () => {
        // the language of the PDF decides the voice; a voice that is not on the device downloads first
        const r = await startReading(p, mobile, {downloadTimeout: 360000}); const w = await watchWords(p, 4000); must(w.timelineMoved, 'Zeitleiste steht'); await shot(p, 'pdf-play'); await pauseIfPlaying(p, mobile); return {...r, words: w.words.length};
      });
      // export from the short German text: voice is on the device already
      await step('Zurueck zum Kurztext (DE)', async () => { await openText(p, DE, mobile); await p.waitForTimeout(800); });
      for (const format of ['MP3', 'WAV']) {
        await step(`Export ${format}: ohne Abfrage, Datei hat Ton`, async () => {
          const r = await exportFile(p, format, mobile, dir); const f = audioFacts(r.path); await shot(p, 'export-' + format.toLowerCase());
          must(r.name.toLowerCase().endsWith(format.toLowerCase()), 'Name ' + r.name); must(r.bytes > 10000, 'Datei zu klein: ' + r.bytes); must(f.duration >= 4 && f.duration <= 25, 'Dauer ' + f.duration); must(f.meanDb > -50 && f.maxDb > -20, 'zu leise/stumm ' + JSON.stringify(f));
          return {file: r.name, bytes: r.bytes, exportMs: r.ms, ...f};
        });
      }
      await step('Nur erlaubte Netzwerkziele (huggingface.co)', async () => { const bad = [...external].filter(h => !ALLOWED.test(h)); must(!bad.length, 'unerwartet: ' + bad.join(',')); return [...external]; });
      await step('Keine Seitenfehler, keine fehlenden Dateien', async () => { must(!errors.length && !failed.length, JSON.stringify({errors, failed}).slice(0, 300)); });
      await step('Kein Verweis auf Premium-Dienst oder Geraete-ID', async () => {
        const hit = await p.evaluate(async () => { const out = []; for (const n of ['premium-browser.mjs', 'product-config.js', 'pricing.mjs']) { const t = await (await fetch('./' + n)).text(); if (/reader-premium|deviceId|device_id/i.test(t)) out.push(n); } return out; });
        must(!hit.length, 'gefunden in ' + hit.join(',')); const keys = await p.evaluate(() => Object.keys(localStorage)); must(!keys.some(k => /device|licen|premium/i.test(k)), 'localStorage: ' + keys.join(','));
      });
      if (mobile) {
        await step('Mobil: keine waagrechte Scrollleiste, Leiste im Bild', async () => {
          const m = await p.evaluate(() => ({sw: document.documentElement.scrollWidth, iw: innerWidth, bodyOverflow: document.body.scrollWidth > innerWidth}));
          must(m.sw <= m.iw, JSON.stringify(m)); const s = await b.state(); must(s.playVisible, 'Play nicht im Bild'); await shot(p, 'mobile-end'); return m;
        });
        await step('Mobil: Leistenknoepfe erreichbar (Tippflaeche >= 28 px, im Bild)', async () => {
          const r = await p.evaluate(() => { const host = [...document.querySelectorAll('*')].find(e => e.shadowRoot?.querySelector('.voice-btn')), out = []; for (const e of host.shadowRoot.querySelectorAll('button')) { const q = e.getBoundingClientRect(); if (!q.width || getComputedStyle(e).visibility === 'hidden') continue; out.push({c: e.className.slice(0, 20), w: Math.round(q.width), h: Math.round(q.height), in: q.left >= -1 && q.right <= innerWidth + 1 && q.bottom <= innerHeight + 1}); } return out; });
          const bad = r.filter(x => !x.in || x.w < 28 || x.h < 28); must(!bad.length, JSON.stringify(bad)); return {buttons: r.length};
        });
      } else {
        await step('Desktop: keine waagrechte Scrollleiste', async () => { const m = await p.evaluate(() => ({sw: document.documentElement.scrollWidth, iw: innerWidth})); must(m.sw <= m.iw, JSON.stringify(m)); });
      }
    }
  } finally {
    if (!DEFAULT_CTX) await ctx.close().catch(() => {});
    else { try { await cdp.send('Storage.clearDataForOrigin', {origin: new URL(served.url).origin, storageTypes: 'all'}); } catch {} await p.close().catch(() => {}); }
    served.server.close();
  }
}

/* ---- main ---------------------------------------------------------------------------------------------------------------------------------------- */
rmSync(join(OUT, 'shots'), {recursive: true, force: true}); mkdirSync(join(OUT, 'shots'), {recursive: true}); mkdirSync(join(OUT, 'downloads'), {recursive: true});
if (!SKIP_BUILD) { execFileSync(process.execPath, [join(ROOT, 'tools/build-webapp.mjs'), '--out', join(OUT, 'app')], {stdio: 'inherit'}); }
const pdf = opt('--pdf', join(OUT, 'fixture.pdf')); if (!existsSync(pdf)) makePdf(pdf);
const DEFS = {
  desktop: {name: 'desktop', viewport: {width: 1366, height: 900}, isolation: 'require-corp', isolated: true, pdf},
  mobile: {name: 'mobile', viewport: {width: 390, height: 844}, mobile: true, isolation: 'require-corp', isolated: true, pdf},
  noheaders: {name: 'noheaders', viewport: {width: 1366, height: 900}, isolation: 'none', isolated: false, sw: false, quick: true, pdf},
  credentialless: {name: 'credentialless', viewport: {width: 1366, height: 900}, isolation: 'credentialless', isolated: true, quick: true, pdf},
  swisolate: {name: 'swisolate', viewport: {width: 1366, height: 900}, isolation: 'none', isolated: false, swIsolation: true, pdf},
};
const browser = await chromium.connectOverCDP(CDP);
try { for (const n of WANT) { if (!DEFS[n]) throw new Error('unbekanntes Szenario ' + n); await scenario(browser, DEFS[n]); } } finally { await browser.close().catch(() => {}); }
const fail = results.filter(r => !r.ok);
log(`\n${results.length - fail.length}/${results.length} PASS` + (fail.length ? `, ${fail.length} FAIL:\n` + fail.map(r => `  [${r.scenario}] ${r.name} :: ${r.detail}`).join('\n') : ''));
writeFileSync(join(OUT, 'result.json'), JSON.stringify(results, null, 1));
process.exit(fail.length ? 1 : 0);
