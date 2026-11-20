#!/usr/bin/env node
/* Web app / file view: opening a second file after a good one shows the state of the NEW file (2.5.6, finding "scanned PDF after a valid file").
   node tests/webapp-file-switch.mjs [--files <dir>] [--out <dir>] [--skip-build]     CDP_URL (default http://127.0.0.1:9444).
   Fixtures: tests/fixtures/file-switch-text.pdf (3 sections) and file-switch-scan.pdf (image only), both made for the 2.5.4 new-user test.
   Checks: text.pdf -> 'Bereit'; then scan-img.pdf -> the status line says the text recognition offer (not the old 'Bereit · Abschnitt 1 von 3') and stays so after
   session updates; then text.pdf again -> 'Bereit' and no offer. Nothing audible, no voice or OCR download. Exit 1 on any FAIL. */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from './webapp-serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const OUT = resolve(opt('--out', join(tmpdir(), 'notable-webapp-switch'))), FILES = resolve(opt('--files', join(ROOT, 'tests/fixtures')));
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9444';
function playwright() { for (const base of [process.env.PLAYWRIGHT_ROOT, ROOT, join(homedir(), 'work/pin-creatives')].filter(Boolean)) { try { return createRequire(join(resolve(base), 'node_modules') + '/')('playwright-core'); } catch {} } throw new Error('playwright-core nicht gefunden'); }
let failed = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failed++; };
const catalogue = JSON.parse(readFileSync(join(ROOT, 'extension/ui-locales.json'), 'utf8')).messages.de;

if (!args.includes('--skip-build')) execFileSync(process.execPath, [join(ROOT, 'tools/build-webapp.mjs'), '--out', OUT], {stdio: 'inherit'});
const {server, url} = await startServer(OUT);
const browser = await playwright().chromium.connectOverCDP(CDP);
const context = await browser.newContext({locale: 'de-DE'});
const file = name => ({name, mimeType: 'application/pdf', buffer: readFileSync(join(FILES, name))});
try {
  const page = await context.newPage();
  await page.goto(url, {waitUntil: 'load'});
  await page.waitForFunction(() => globalThis.notableFileApp);
  const statusText = () => page.locator('#status').textContent();
  const idle = () => page.waitForFunction(() => !globalThis.notableFileApp.busy && /^Bereit/.test(document.querySelector('#status').textContent), null, {timeout: 20000});

  await page.setInputFiles('#file', file('file-switch-text.pdf')); await idle();
  check(/^Bereit/.test(await statusText()), `text.pdf: Status „${await statusText()}“`);

  await page.setInputFiles('#file', file('file-switch-scan.pdf'));
  await page.waitForFunction(() => !document.querySelector('#ocr-offer').hidden, null, {timeout: 20000});
  await page.evaluate(() => globalThis.notableSession.changed());                                 // a session update (state/position/voice) must not paint the old document's status over the offer
  await page.waitForTimeout(800);
  const scan = await statusText();
  check(scan === catalogue.ocrOfferStatus, `scan-img.pdf nach gültiger Datei: Status nennt die Texterkennung („${scan}“)`);
  check(!/Abschnitt 1 von/.test(scan), 'kein alter „Bereit · Abschnitt …“');

  // the recognition itself (downloads the small tessdata file from huggingface.co once): afterwards the line belongs to the recognised document again
  await page.click('#ocr-start');
  await page.waitForFunction(() => document.querySelector('#ocr-offer').hidden && /^Bereit/.test(document.querySelector('#status').textContent), null, {timeout: 90000}).catch(() => {});
  check(await page.locator('#ocr-offer').isHidden() && /^Bereit/.test(await statusText()), `nach der Texterkennung: Status des erkannten Texts („${await statusText()}“)`);

  await page.setInputFiles('#file', file('file-switch-text.pdf')); await idle();
  check(/^Bereit/.test(await statusText()) && await page.locator('#ocr-offer').isHidden(), 'danach wieder text.pdf: Bereit, kein Texterkennungs-Angebot');
} finally {
  await context.close(); await browser.close().catch(() => {}); server.close();
}
console.log(failed ? `${failed} FAIL` : 'ALLE PRÜFUNGEN GRÜN');
process.exit(failed ? 1 : 0);
