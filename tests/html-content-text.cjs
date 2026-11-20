/* Web page text collection (extension/session/html-content.mjs + text-map.mjs): what is read, in which order, with exact word offsets.
   Fixtures mimic the real structure of pages found wrong on 20.11.2026 (tagesschau teaser/programme box, MDN translation banner, python.org docs code,
   BBC byline without spaces) plus counter-examples that must stay readable.
   Run: node tests/html-content-text.cjs   (READER_CDP=http://127.0.0.1:9444 reuses a running browser in its own context; READER_PLAYWRIGHT_MODULE overrides playwright-core) */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require(process.env.READER_PLAYWRIGHT_MODULE || 'playwright-core');
const root = process.env.READER_EXT_ROOT || path.resolve(__dirname, '../extension');
const types = {'.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json'};
const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>x</title><style>
 .byline span,.names span{margin-right:4px} .flexrow{display:flex} .cap{float:left;margin-right:8px;font-size:40px} .hl{margin:0 3px}
</style></head><body class="wmde-show-banner wmde-animate-banner">
<div class="page-with-footer"><main>
 <div class="translation-banner notecard"><p>This content was automatically translated. <a href="#">Learn more</a></p><p class="translation-banner__switch"><button>View in English</button></p></div>
 <h1>Title <code>&lt;p&gt;</code> element</h1>
 <details class="baseline-indicator"><summary><div>Baseline</div><div>Widely available</div></summary></details>
 <div class="content">
  <p id="intro">The <code>while</code> statement repeats, and the <a class="reference internal" href="#a"><code>for</code> statement</a> iterates over items.</p>
  <div class="highlight"><pre><span>&gt;&gt;&gt; x = int(input("n: "))</span>
<span>&gt;&gt;&gt; print(x)</span></pre></div>
  <div class="byline"><time>Just now</time><span><span>Dan Woodland</span><span>and</span><span>Sarah Rainsford,</span><span>Eastern correspondent</span></span></div>
  <div class="names"><span><span>Dan Woodland</span><span>and</span><span>Sarah Rainsford,</span><span>Eastern correspondent</span></span></div>
  <div class="flexrow"><span>Left item</span><span>Right item</span></div>
  <p><span class="cap">T</span>he drop cap stays one word, and so does <b>bold</b>face and <i>e</i>mphasis.</p>
  <p>Call <code class="hl">f(x)</code>, then <code class="hl">g</code>.</p>
  <div class="article-head__title"><p class="metatextline">Stand: 20.11.2026 • 12:40 Uhr</p></div>
  <figure><img alt="" src="data:,"><span class="Image-styles__CopyrightLabel-sc-1">Reuters</span><figcaption>Caption under the picture.</figcaption></figure>
  <p>Bochum [<span class="IPA"><a href="#"><span lang="zxx">ˈboːxʊm</span></a></span>] is a city, the meeting is on <time datetime="2026-11-23">Monday</time> 23 hours from now.</p>
  <figure><blockquote><p>A quoted sentence inside a figure stays.</p></blockquote><figcaption>Quote author</figcaption></figure>
  <div data-area="preferred-sources"><a href="https://google.com/preferences/source?q=example.org" title="Example bei Google bevorzugen"><span>Example bei Google bevorzugen</span></a></div>
  <p>Second paragraph of the real article text that continues to be read.</p>
  <div class="teaser-absatz"><div class="teaser-absatz__teaserinfo" role="complementary"><h3>Airlines under pressure</h3><p>Teaser summary text. mehr</p></div></div>
  <p>Third paragraph after the teaser box, still the article.</p>
  <div class="meldungsfooter"><ul class="taglist"><li><a href="#">Lufthansa</a></li></ul><div class="sendungsbezug"><p>Dieses Thema im Programm:</p><ul><li>tagesschau24 | Nachrichten</li></ul></div></div>
 </div>
</main></div></body></html>`;
/* L7 (2.5.6): where reading starts on news pages - a live score box before the article (t-online), share/action row, author line, picture source and
   publish info in the article head (heise, t-online, tagesschau, BBC, arXiv); counter-example: chat turns / feed items (sibling articles) keep the whole scope. */
const long = 'This is the real article text that a listener expects to hear first, long enough to be the text of the page and not a teaser box. '.repeat(3);
const fixture2 = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>y</title></head><body><main>
 <div class="container"><section><div><h2>Bundesliga Live</h2><article><a href="#">Bayern</a> <span>1 1</span> <a href="#">Köln</a></article></div><div><article><a href="#">Mehr zur Bundesliga</a> <a href="#">Tabelle</a></article></div></section></div>
 <article class="story"><header><h2>Headline of the story</h2><div aria-label="Autoren"><span>Von t-online</span></div>
  <div class="a-article-header__service a-article-header__service--right"><a class="a-article-action" href="#">Artikel verschenken</a> <a class="a-article-action" href="#"><span>10</span></a></div>
  <p class="a-caption__source">(Bild: Jane Doe / Agency)</p><div class="a-publish-info">19:17 Uhr Lesezeit: 4 Min.</div><div class="creator">Von Carolin Example</div>
  <div class="authors">Authors: Ann One, Bob Two, Cid Three, Dee Four</div><div class="Image-styles__CreditStyled-sc-1">Reuters</div></header>
  <p>${long}</p><p>Second paragraph of the story.</p></article>
</main><div id="chat"><main><div class="thread"><article><p>Short question of the user?</p></article><article><p>${long}</p></article></div></main></div></body></html>`;
const server = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/fixture.html') { r.writeHead(200, {'Content-Type': 'text/html'}); return r.end(fixture); }
  if (u === '/fixture2.html') { r.writeHead(200, {'Content-Type': 'text/html'}); return r.end(fixture2.replace(/<div id="chat">[\s\S]*<\/div><\/body>/, '</body>')); }
  if (u === '/fixture3.html') { r.writeHead(200, {'Content-Type': 'text/html'}); return r.end(fixture2.replace(/<body><main>[\s\S]*?<\/main><div id="chat">/, '<body><div id="chat">')); }
  const f = path.join(root, u.replace(/^\/ext\//, ''));
  if (!u.startsWith('/ext/') || !f.startsWith(root)) { r.writeHead(404); return r.end(); }
  try { r.writeHead(200, {'Content-Type': types[path.extname(f)] || 'application/octet-stream'}); r.end(fs.readFileSync(f)); } catch { r.writeHead(404); r.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = process.env.READER_CDP ? await chromium.connectOverCDP(process.env.READER_CDP) : await chromium.launch({headless: true});
  const context = await browser.newContext({bypassCSP: true});
  let checks = 0; const ok = (value, message) => { assert.ok(value, message); checks++; };
  try {
    const page = await context.newPage();
    await page.goto(base + '/fixture.html');
    const run = reading => page.evaluate(async ({base, reading}) => {
      const hc = await import(base + '/ext/session/html-content.mjs'), tm = await import(base + '/ext/session/text-map.mjs');
      const c = hc.collectHtmlBlocks({cites: true, reading}), chunks = tm.buildChunks(c.blocks, undefined, 'en', reading);
      let bad = 0, words = 0; const maps = new Map();
      for (const ch of chunks) {
        let m = maps.get(ch.block); if (m === undefined) { m = tm.createRangeMapper(c.textNodes[ch.block], c.blocks[ch.block].text); maps.set(ch.block, m); }
        if (!m) { bad++; continue; }
        let at = 0; for (const w of ch.words) { const i = ch.text.indexOf(w, at); at = i + w.length; words++; const r = m.range(ch.start + i, ch.start + i + w.length); if (ch.text.slice(i, i + w.length) !== w || !r || r.toString().replace(/\s/g, '') !== w) bad++; }
      }
      return {sections: chunks.map(ch => ch.text), bad, words};
    }, {base, reading});
    const defaults = await page.evaluate(async base => (await import(base + '/ext/playback/reading-rules.js')).READING_DEFAULTS, base);
    ok(defaults.skipCode === true, 'new installs skip code blocks by default');
    const r = await run({...defaults}), all = r.sections.join('\n');
    ok(r.words > 40 && r.bad === 0, `word offsets exact in every section (${r.words} words, ${r.bad} bad)`);
    // F16: starts at the title, not at the translation banner / baseline widget
    ok(/^Title/.test(r.sections[0]), 'starts with the title: ' + r.sections[0]);
    ok(!/automatically translated|View in English|Baseline|Widely available/.test(all), 'translation banner and baseline widget are not read');
    // F17: block code skipped, inline code stays audible
    ok(!/>>>|int\(input/.test(all), 'code block skipped by default');
    ok(/The while statement repeats, and the for statement iterates/.test(all), 'inline code inside a sentence stays audible: ' + all.slice(0, 200));
    ok(/<p> element/.test(r.sections[0]), 'inline code in the heading stays audible');
    const withCode = await run({...defaults, skipCode: false});
    ok(/>>> x = int/.test(withCode.sections.join('\n')) && withCode.bad === 0, 'skipCode off reads the code block again');
    // F18: layout-only gaps become word boundaries
    ok(/Dan Woodland and Sarah Rainsford, Eastern correspondent/.test(all), 'names in spans without spaces stay separate words: ' + all.match(/Dan.{0,70}/)?.[0]);
    ok((all.match(/Dan Woodland/g) || []).length === 1, 'the author line itself (class byline) is not read (L7, 2.5.6)');
    ok(/Left item Right item/.test(all), 'flex items separated');
    ok(/The drop cap stays one word/.test(all) && /boldface and emphasis/.test(all), 'drop cap and inline styling stay one word');
    ok(/Call f\(x\), then g\./.test(all), 'inline code with a margin keeps its punctuation attached: ' + all.match(/Call.{0,20}/)?.[0]);
    // F10: complementary teaser box and class-named footer box are not read; article text around them is
    ok(!/Airlines under pressure|Teaser summary|mehr/.test(all), 'teaser box (role=complementary) not read');
    ok(!/Dieses Thema im Programm|tagesschau24|Lufthansa/.test(all), 'programme box in a footer-class container not read');
    ok(/Second paragraph of the real article/.test(all) && /Third paragraph after the teaser box/.test(all), 'article text around the boxes is read');
    // counter-example: a body/wrapper class that merely contains "banner"/"footer" must not remove the article
    ok(r.sections.length >= 8, 'page with layout classes banner/footer on body and wrapper keeps its text');
    // R2-09 / R2-07 / R2-06: date line, byline time, picture credit and IPA pronunciation are not read; a <time> in a sentence, quotes and captions are
    ok(!/Stand: 20\.11|12:40 Uhr/.test(all), 'tagesschau date line (metatextline) not read');
    ok(!/Just now/.test(all), 'relative time in the byline not read');
    ok(!/Reuters/.test(all), 'picture credit label not read');
    ok(!/ˈboːxʊm/.test(all) && /Bochum \[ \] is a city/.test(all), 'IPA pronunciation not read, the brackets stay two tokens: ' + all.match(/Bochum.{0,40}/)?.[0]);
    ok(/meeting is on Monday 23 hours from now/.test(all), 'a <time> inside a sentence stays');
    ok(!/bei Google bevorzugen/.test(all), 'Google "preferred sources" button not read (SPIEGEL, R2-05)');
    ok(/A quoted sentence inside a figure stays/.test(all) && /Caption under the picture/.test(all), 'quote in a figure and the caption stay');
    // reading rule "skip footers" off reads the footer-class box again
    ok(/Dieses Thema im Programm/.test((await run({...defaults, skipFooters: false})).sections.join('\n')), 'skipFooters off reads the footer box');
    // L7: start points on news pages
    await page.goto(base + '/fixture2.html');
    const n = await run({...defaults}), nall = n.sections.join('\n');
    ok(/^Headline of the story/.test(n.sections[0]), 'news page starts at the story headline, not the live score box: ' + n.sections[0].slice(0, 60));
    ok(!/Bundesliga Live|Bayern|Mehr zur Bundesliga/.test(nall), 'live score box before the article is not read');
    ok(!/Artikel verschenken|\b10\b/.test(nall), 'share/action row (Artikel verschenken, comment count) not read');
    ok(!/Von t-online|Von Carolin|Authors: Ann/.test(nall), 'author lines (aria-label Autoren, creator, authors) not read');
    ok(!/Bild: Jane|Lesezeit|Reuters/.test(nall), 'picture source, publish info and picture credit not read');
    ok(/real article text that a listener expects/.test(n.sections[1] || '') && /Second paragraph of the story/.test(nall) && n.bad === 0, 'the story text follows the headline, offsets exact');
    await page.goto(base + '/fixture3.html');
    const c3 = (await run({...defaults})).sections.join('\n');
    ok(/Short question of the user/.test(c3) && /real article text/.test(c3), 'sibling articles (chat turns) keep the whole conversation');
    await page.close();
  } finally { await context.close(); await browser.close().catch(() => {}); server.close(); }
  console.log(`HTML CONTENT TEXT OK (${checks} checks)`);
})().catch(error => { console.error(error); server.close(); process.exit(1); });
