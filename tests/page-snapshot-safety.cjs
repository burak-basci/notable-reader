/* HTML download of a web page (session/page-snapshot.mjs) on a hostile page (code review 2.5.5, R5): the saved file must not run script.
   A fixture page carries script links with tab/newline/entity tricks, handlers, iframe srcdoc, object/embed, a refresh meta and SVG links; the snapshot (whole page and
   selection) is opened again as a page and must run nothing; the file carries a CSP without script.
   Run: node tests/page-snapshot-safety.cjs   (READER_CDP=http://127.0.0.1:9444 reuses a running browser in its own context; READER_PLAYWRIGHT_MODULE overrides playwright-core) */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require(process.env.READER_PLAYWRIGHT_MODULE || 'playwright-core');
const root = path.resolve(__dirname, '../extension');
const hostile = `<!doctype html><html><head><meta charset="utf-8"><title>h</title><meta http-equiv="refresh" content="0;url=javascript:top.__ran='refresh'"></head><body>
<p id="start">Text before. <a id="l1" href="jav&#9;ascript:top.__ran='tab'">tab link</a> <a id="l2" href="java
script:top.__ran='newline'">newline link</a> <a id="l3" href=" &#1;JavaScript:top.__ran='ctrl'">ctrl link</a> <a id="l4" href="https://example.org/ok">fine link</a></p>
<img id="i1" src="data:," onerror="top.__ran='onerror'"><iframe srcdoc="<script>top.__ran='srcdoc'<\/script>"></iframe><object data="data:text/html,<script>top.__ran='object'<\/script>"></object><embed src="data:text/html,x">
<svg width="10" height="10"><a href="javascript:top.__ran='svg'"><rect width="10" height="10"/></a><animate attributeName="href" to="javascript:top.__ran='animate'"/></svg>
<form action="  javascript:top.__ran='form'"><button formaction="javascript:top.__ran='formaction'">b</button></form>
<p id="end">Text after.</p><script>top.__pageScript = 1;</script></body></html>`;
const server = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/blank.html') { r.writeHead(200, {'Content-Type': 'text/html'}); return r.end('<!doctype html><title>b</title>'); }
  if (u === '/hostile.html') { r.writeHead(200, {'Content-Type': 'text/html'}); return r.end(hostile); }
  const f = path.join(root, u.replace(/^\/ext\//, ''));
  if (!u.startsWith('/ext/') || !f.startsWith(root)) { r.writeHead(404); return r.end(); }
  let data; try { data = fs.readFileSync(f); } catch { r.writeHead(404); return r.end(); }
  r.writeHead(200, {'Content-Type': f.endsWith('.mjs') || f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'}); r.end(data);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = process.env.READER_CDP ? await chromium.connectOverCDP(process.env.READER_CDP) : await chromium.launch({headless: true});
  const context = await browser.newContext({bypassCSP: true});
  let checks = 0; const ok = (value, message) => { assert.ok(value, message); checks++; };
  try {
    const page = await context.newPage();
    await page.goto(base + '/hostile.html');
    const out = await page.evaluate(async base => {
      const m = await import(base + '/ext/session/page-snapshot.mjs');
      const all = m.pageSnapshot({document});
      const range = document.createRange(); range.setStartBefore(document.getElementById('start')); range.setEndAfter(document.getElementById('end'));
      const sel = m.pageSnapshot({document, range: 'selection', selection: range});
      return {all, sel, tricks: m.scriptAddress ? ['jav\tascript:x', 'java\nscript:x', ' \u0001JavaScript:x', 'vbscript:x', 'https://example.org'].map(m.scriptAddress) : []};
    }, base);
    for (const [name, html] of [['whole page', out.all], ['selection', out.sel]]) {
      const lower = html.toLowerCase();
      ok(!/javascript:|vbscript:/.test(lower.replace(/[\u0000- ]/g, '')), `${name}: no script address left`);
      ok(!/<(iframe|object|embed|script)\b/.test(lower) && !/\son\w+=/.test(lower) && !/srcdoc/.test(lower), `${name}: no script, handler, frame or plugin`);
      ok(/https:\/\/example\.org\/ok/.test(html) && /Text before\./.test(html) && /Text after\./.test(html), `${name}: text and normal links stay`);
      ok(/<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; frame-src 'none'/.test(html), `${name}: the file starts with a CSP without script`);
      // open the saved file again and use it: nothing may run
      const saved = await context.newPage(); await saved.goto(base + '/blank.html'); await saved.setContent(html);
      await saved.evaluate(() => { for (const a of document.querySelectorAll('a')) { const href = a.getAttribute('href') || ''; if (!/^https?:/.test(href)) a.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true})); } document.querySelector('form')?.requestSubmit?.(); });
      await saved.waitForTimeout(600);
      const ran = await saved.evaluate(() => ({ran: top.__ran ?? null, script: top.__pageScript ?? null})).catch(() => ({ran: 'navigated'}));
      ok(ran.ran === null && !ran.script, `${name}: opening and clicking the saved file runs nothing (${JSON.stringify(ran)})`);
      await saved.close();
    }
    ok(out.tricks.join() === 'true,true,true,true,false', 'scheme check sees through tab, newline, control characters and case: ' + out.tricks.join());
    await page.close();
  } finally { await context.close(); await browser.close().catch(() => {}); server.close(); }
  console.log(`PAGE SNAPSHOT SAFETY OK (${checks} checks)`);
})().catch(error => { console.error(error); server.close(); process.exit(1); });
