#!/usr/bin/env node
/* Web app: "continue reading" after a reload (finding M3, 2.5.6). Build -> serve on 127.0.0.1 -> own browser context over CDP (nothing audible, no voice download).
   node tests/webapp-resume.mjs [--out <dir>] [--skip-build]     CDP_URL (default http://127.0.0.1:9444), PLAYWRIGHT_ROOT as in tests/webapp-browser.mjs.
   Checks: empty start view has no offer; a pasted text + a moved place survive a reload as "Weiterlesen · bei Abschnitt n"; the button reopens the same text at that section;
   "Verlauf löschen" removes text and place (nothing offered after the next reload); a second text replaces the first. Exit 1 on any FAIL. */
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from './webapp-serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const OUT = resolve(opt('--out', join(tmpdir(), 'notable-webapp-resume')));
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9444';
function playwright() { for (const base of [process.env.PLAYWRIGHT_ROOT, ROOT, join(homedir(), 'work/pin-creatives')].filter(Boolean)) { try { return createRequire(join(resolve(base), 'node_modules') + '/')('playwright-core'); } catch {} } throw new Error('playwright-core nicht gefunden'); }
let failed = 0; const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failed++; };

if (!args.includes('--skip-build')) execFileSync(process.execPath, [join(ROOT, 'tools/build-webapp.mjs'), '--out', OUT], {stdio: 'inherit'});
const {server, url} = await startServer(OUT);
const browser = await playwright().chromium.connectOverCDP(CDP);
const context = await browser.newContext({locale: 'de-DE'});
try {
  const page = await context.newPage();
  await page.goto(url, {waitUntil: 'load'});
  await page.waitForFunction(() => globalThis.notableFileApp && globalThis.notableWebDocument);
  check(await page.locator('#web-resume').isHidden().catch(() => true), 'leere Startansicht: kein Weiterlesen-Angebot');

  const text = Array.from({length: 40}, (_, i) => `Satz Nummer ${i + 1} über das Weiterlesen nach dem Neuladen der Seite.`).join(' ');
  await page.fill('#paste', text);
  await page.click('#load-text');
  await page.waitForFunction(() => globalThis.notableSession?.chunks?.length > 2);
  const chunks = await page.evaluate(() => globalThis.notableSession.chunks.length);
  const target = await page.evaluate(() => { const s = globalThis.notableSession, c = s.chunks[2]; return s.charOfChunk ? s.charOfChunk(2) + 1 : null; });
  await page.evaluate(async at => { await globalThis.notableSession.command('seekChar', at); await globalThis.notableSession.savePosition?.(true); }, target);
  await page.waitForTimeout(2500);                                                         // resume points are written at most every 2 s
  await page.evaluate(async () => { await globalThis.notableSession.savePosition?.(true); });
  const title = await page.locator('#document-title').textContent();

  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => globalThis.notableFileApp && document.querySelector('#web-resume') && !document.querySelector('#web-resume').hidden, null, {timeout: 15000}).catch(() => {});
  const offer = await page.locator('#web-resume').isVisible().catch(() => false);
  const line = offer ? await page.locator('#web-resume .web-resume-title').textContent() : '';
  check(offer, 'nach Neuladen: Karte „Weiterlesen“ sichtbar');
  check(/bei Abschnitt 3\b/.test(line) && line.startsWith(title.slice(0, 10)), `Karte nennt Titel und Stelle (${JSON.stringify(line.slice(-24))}, ${chunks} Abschnitte)`);
  check(await page.locator('#web-resume [data-act=clear]').textContent() === 'Verlauf löschen', 'Knopf „Verlauf löschen“ vorhanden');
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({path: join(OUT, 'resume-card.png')});

  await page.click('#web-resume [data-act=resume]');
  await page.waitForFunction(() => globalThis.notableSession?.chunks?.length > 2);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({chunk: globalThis.notableSession.position.chunk, text: document.querySelector('#document-title').textContent, status: document.querySelector('#status').textContent}));
  check(after.chunk === 2, `Weiterlesen öffnet denselben Text an Abschnitt 3 (Abschnitt ${after.chunk + 1})`);
  check(after.text === title, 'gleicher Titel wie vor dem Neuladen');
  check(await page.locator('#web-resume').isHidden(), 'Angebot verschwindet, sobald der Text offen ist');

  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.querySelector('#web-resume') && !document.querySelector('#web-resume').hidden, null, {timeout: 15000});
  await page.click('#web-resume [data-act=clear]');
  await page.waitForFunction(() => document.querySelector('#web-resume').hidden, null, {timeout: 5000}).catch(() => {});   // the handler is asynchronous (IndexedDB)
  const gone = await page.evaluate(async () => ({hidden: document.querySelector('#web-resume').hidden, status: document.querySelector('#status').textContent, points: Object.keys((await chrome.storage.local.get('resumePoints')).resumePoints || {}).length}));
  check(gone.hidden && gone.status === 'Verlauf gelöscht.', 'Verlauf löschen: Karte weg, Status „Verlauf gelöscht.“');
  check(gone.points === 0, 'Verlauf löschen: Lesestelle entfernt');
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => globalThis.notableFileApp && document.querySelector('#web-resume'));
  await page.waitForTimeout(500);
  check(await page.locator('#web-resume').isHidden(), 'nach Löschen und Neuladen: kein Angebot');

  await page.fill('#paste', 'Erster Text. Er wird gleich ersetzt.'); await page.click('#load-text'); await page.waitForFunction(() => globalThis.notableSession?.chunks?.length > 0);
  await page.fill('#paste', 'Zweiter Text über etwas anderes. Er bleibt.'); await page.click('#load-text'); await page.waitForTimeout(500);
  const second = await page.locator('#document-title').textContent();
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.querySelector('#web-resume') && !document.querySelector('#web-resume').hidden, null, {timeout: 15000});
  const line2 = await page.locator('#web-resume .web-resume-title').textContent();
  check(line2.startsWith(second.slice(0, 8)) && /von vorn/.test(line2), `zweiter Text ersetzt den ersten (${JSON.stringify(line2)})`);

  // an opened FILE is kept as well (its text; a PDF comes back as its extracted text, like the extension's library does)
  await page.setInputFiles('#file', {name: 'Bericht-Weiterlesen.txt', mimeType: 'text/plain', buffer: Buffer.from('Ein Bericht aus einer Datei. ' + 'Noch ein Satz in der Datei. '.repeat(30))});
  await page.waitForFunction(() => /Bericht/.test(document.querySelector('#document-title').textContent), null, {timeout: 15000});
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => document.querySelector('#web-resume') && !document.querySelector('#web-resume').hidden, null, {timeout: 15000});
  const line3 = await page.locator('#web-resume .web-resume-title').textContent();
  check(/Bericht/.test(line3), `geöffnete Datei wird nach Neuladen angeboten (${JSON.stringify(line3)})`);
  await page.click('#web-resume [data-act=resume]');
  await page.waitForFunction(() => /Bericht/.test(document.querySelector('#document-title').textContent) && globalThis.notableSession?.chunks?.length > 0, null, {timeout: 15000});
  check(true, 'Datei-Text wieder geöffnet');
} finally {
  await context.close(); await browser.close().catch(() => {}); server.close();
}
console.log(failed ? `${failed} FAIL` : 'ALLE PRÜFUNGEN GRÜN');
process.exit(failed ? 1 : 0);
