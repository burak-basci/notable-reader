#!/usr/bin/env node
/* The bar lives inside the page (open shadow root): a page script must not start voice downloads by synthetic clicks (code review 2.5.5, R4).
   Web app build (same bar and voice list as the extension) -> own browser context over CDP. Opens the voice list with a real (trusted) click, then
   (1) a page script clicks a voice's download button (.click() and dispatchEvent): no download may start (no request to huggingface.co, no cancel button);
   (2) a real click on the same button starts it (request seen), then it is cancelled with a real click. Nothing audible.
   (3) R6: the details of voices on a non-commercial base checkpoint say so (Thorsten high/Kerstin low), the default Thorsten medium does not.
   node tests/webapp-voice-trusted.mjs [--out <dir>] [--skip-build]     CDP_URL (default http://127.0.0.1:9444). Exit 1 on any FAIL. */
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from './webapp-serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const OUT = resolve(opt('--out', join(tmpdir(), 'notable-webapp-trusted'))), CDP = process.env.CDP_URL || 'http://127.0.0.1:9444';
function playwright() { for (const base of [process.env.PLAYWRIGHT_ROOT, ROOT, join(homedir(), 'work/pin-creatives')].filter(Boolean)) { try { return createRequire(join(resolve(base), 'node_modules') + '/')('playwright-core'); } catch {} } throw new Error('playwright-core nicht gefunden'); }
let failed = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failed++; };

if (!args.includes('--skip-build')) execFileSync(process.execPath, [join(ROOT, 'tools/build-webapp.mjs'), '--out', OUT], {stdio: 'inherit'});
const {server, url} = await startServer(OUT);
const browser = await playwright().chromium.connectOverCDP(CDP);
const context = await browser.newContext({locale: 'de-DE'});
const hf = []; context.on('request', r => { if (/huggingface\.co|hf\.co/.test(r.url())) hf.push(r.url()); });
try {
  const page = await context.newPage();
  await page.goto(url, {waitUntil: 'load'});
  await page.waitForFunction(() => globalThis.notableFileApp);
  await page.fill('#paste', 'Ein kurzer Text, damit die Leiste eine Stimme wählen kann.'); await page.click('#load-text');
  await page.waitForFunction(() => globalThis.notableSession?.chunks?.length > 0);
  const voiceBtn = page.locator('[data-notable-reader-surface] .voice-btn').first();
  await voiceBtn.click();                                                                       // trusted: opens the list
  const dlSel = '[data-notable-reader-surface] .vp-row [data-act=dl]:not([data-off])';
  await page.waitForSelector(dlSel, {timeout: 10000});
  const id = await page.locator(dlSel).first().evaluate(b => b.closest('.vp-row').dataset.id);
  const rowSel = `[data-notable-reader-surface] .vp-row[data-id="${id}"]`;
  hf.length = 0;
  await page.evaluate(sel => { const b = document.querySelector('[data-notable-reader-surface]').shadowRoot.querySelector(sel); b.click(); b.dispatchEvent(new MouseEvent('click', {bubbles: true, composed: true, detail: 1})); }, `.vp-row[data-id="${id}"] [data-act=dl]`);
  await page.waitForTimeout(2500);
  const synthetic = {requests: hf.length, cancel: await page.locator(rowSel + ' [data-act=dlx]').count()};
  check(synthetic.requests === 0 && synthetic.cancel === 0, `synthetische Klicks der Seite starten keinen Download (${JSON.stringify(synthetic)})`);
  if (synthetic.cancel) { check(false, 'echter Klick nicht prüfbar: der synthetische Klick hat den Download schon gestartet'); await page.locator(rowSel + ' [data-act=dlx]').first().click().catch(() => {}); throw new Error('rot'); }
  await page.locator(rowSel + ' [data-act=dl]').first().click();                                   // trusted click starts it
  await page.waitForFunction(() => true); await page.waitForTimeout(2500);
  const real = {requests: hf.length, cancel: await page.locator(rowSel + ' [data-act=dlx]').count()};
  check(real.requests > 0 || real.cancel > 0, `ein echter Klick startet den Download weiter (${JSON.stringify(real)})`);
  if (real.cancel) await page.locator(rowSel + ' [data-act=dlx]').first().click().catch(() => {});
  // R6: voices on a non-commercial base checkpoint say so in their details (title of the voice cell), others do not
  const more = page.locator('[data-notable-reader-surface] .vp-more');
  if (await more.count() && /alle|all/i.test(await more.first().textContent())) await more.first().click();
  await page.waitForTimeout(500);
  const tips = await page.evaluate(() => Object.fromEntries([...document.querySelector('[data-notable-reader-surface]').shadowRoot.querySelectorAll('.vp-opt')].map(o => [o.dataset.key, o.title])));
  const pick = re => Object.entries(tips).find(([k]) => re.test(k))?.[1] || '';
  const high = tips['piper:de_de-thorsten'] || pick(/thorsten-high/), medium = pick(/thorsten-medium$/), kerstin = pick(/kerstin-low$/), low = pick(/thorsten-low$/);
  console.log('high-tip', JSON.stringify(high.split('\n').slice(0, 4)));
  check(/Trainingsdaten nur für nicht-kommerzielle Nutzung \(Blizzard 2013 Lessac\)/.test(high), 'Thorsten high nennt die nicht-kommerzielle Basis in den Details: ' + JSON.stringify(high.split('\n').slice(1, 3)));
  check(!kerstin || /nicht-kommerzielle Nutzung \(RyanSpeech CC BY-NC-SA 4\.0\)/.test(kerstin), 'Kerstin low (falls gelistet) nennt RyanSpeech');
  check(!low || /nicht-kommerzielle Nutzung \(RyanSpeech/.test(low), 'Thorsten low (falls gelistet) nennt RyanSpeech');
  check(medium && !/nicht-kommerziell/.test(medium), 'Thorsten medium (Standardstimme) trägt keinen solchen Hinweis');
} finally {
  await context.close(); await browser.close().catch(() => {}); server.close();
}
console.log(failed ? `${failed} FAIL` : 'ALLE PRÜFUNGEN GRÜN');
process.exit(failed ? 1 : 0);
