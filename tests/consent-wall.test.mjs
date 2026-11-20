/* Cookie / consent walls (Neu-Nutzer-Test 2.5.4, H2: heise, faz, chefkoch, t-online looked as if the reader read the wall).
   Measured in the browser (round 4): the reader read the article behind the wall, but painted its marks over the wall.
   Run: node tests/consent-wall.test.mjs  -> "CONSENT WALL OK (n checks)", exit 0.
   Covers consentWallAt (marks are not painted over a wall, the notice in the bar) with a small fake DOM, and the platform
   containers that text finding skips (in-page banners of OneTrust, Usercentrics, Cookiebot, Didomi, consentmanager, Borlabs, ...). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension');
let checks = 0; const ok = (value, message) => { assert.ok(value, message); checks++; };
const {consentWallAt} = await import(pathToFileURL(path.join(root, 'session/page-highlight.mjs')).href);

/* a tiny element tree: tag, id, class, attributes, computed position */
function el(tag, {id = '', cls = '', attrs = {}, position = 'static'} = {}, ...children) {
  const e = {nodeType: 1, tagName: tag.toUpperCase(), id, className: cls, attrs, position, parentElement: null, children};
  for (const c of children) c.parentElement = e;
  e.getAttribute = n => e.attrs[n] ?? null;
  e.contains = other => { for (let x = other; x; x = x.parentElement) if (x === e) return true; return false; };
  e.closest = sel => { for (let x = e; x; x = x.parentElement) if (sel.split(',').some(s => s.startsWith('[data-notable-reader') && Object.keys(x.attrs).some(a => s.includes(a)))) return x; return null; };
  return e;
}
const docWith = (body, at) => { const html = el('html', {}, body); return {body, documentElement: html, elementFromPoint: () => at, defaultView: {getComputedStyle: e => ({position: e.position})}}; };

/* Sourcepoint behind a first-party host (consent.t-online.de): the frame inside a fixed dialog container */
const article = el('p'), frame = el('iframe', {attrs: {src: 'https://consent.t-online.de/index.html?message_id=1475335&consentUUID=null'}});
const sp = el('div', {id: 'sp_message_container_1475335', attrs: {role: 'dialog', 'aria-modal': 'true'}, position: 'fixed'}, frame);
let doc = docWith(el('body', {}, el('main', {}, article), sp), frame);
ok(consentWallAt(doc, 10, 10, article), 'Sourcepoint frame over the article is a wall');
ok(consentWallAt(doc, 10, 10, null), 'without an owner (bar notice): the wall is found');
/* consentmanager (chefkoch.de) and Cookiebot boxes in the page itself */
for (const [id, cls] of [['cmpbox', 'cmpbox'], ['CybotCookiebotDialog', ''], ['onetrust-banner-sdk', 'otFlat'], ['didomi-popup', 'didomi-popup-container'], ['BorlabsCookieBox', '']]) {
  const inner = el('p'), box = el('div', {id, cls, position: 'fixed'}, el('div', {}, inner));
  ok(consentWallAt(docWith(el('body', {}, article, box), inner), 1, 1, article), `${id} over the text is a wall`);
}
/* never a wall: the page itself, the text's own element, the reader's UI, consent words in ordinary (not layered) page markup */
const own = el('div', {attrs: {'data-notable-reader-ui': 'bar'}, position: 'fixed'});
ok(!consentWallAt(docWith(el('body', {}, article, own), own), 1, 1, article), "the reader's own bar is no wall");
ok(!consentWallAt(docWith(el('body', {}, el('main', {}, article)), article), 1, 1, article), 'the text itself is no wall');
const span = el('span'), para = el('p', {}, span);
ok(!consentWallAt(docWith(el('body', {}, para), span), 1, 1, para), 'an element inside the text owner is no wall');
const guide = el('p'), section = el('section', {cls: 'consent-management-guide'}, guide);
ok(!consentWallAt(docWith(el('body', {}, section), guide), 1, 1, null), "a page about consent (class names only, no layer) is no wall");
const sticky = el('div', {cls: 'site-header', position: 'sticky'});
ok(!consentWallAt(docWith(el('body', {}, sticky), sticky), 1, 1, article), 'a sticky header without consent marks is no wall');
ok(!consentWallAt({elementFromPoint: () => { throw new Error('x'); }}, 1, 1), 'elementFromPoint failing is no wall');

/* text finding skips the in-page banners of the common platforms (both lists: with and without header skipping) */
const html = fs.readFileSync(path.join(root, 'session/html-content.mjs'), 'utf8');
for (const sel of ['[id^="sp_message_container"]', '#onetrust-consent-sdk', '#usercentrics-root', '#CybotCookiebotDialog', '#didomi-host', '#cmpbox', '#BorlabsCookieBox', '.cmplz-cookiebanner'])
  ok(html.split(sel + ',').length === 3, `${sel} is skipped in both exclusion lists`);
// the substring patterns are no longer selectors of the exclusion lists (they matched state classes on body/main and silenced the page, review 2.5.5 R1);
// they run through consentBox() (never html/body/main/article, never a box with the page's text) - behaviour test: tests/html-content-text.cjs fixture4
ok(html.split('[class*="cookie-banner" i],').length === 2 && /const consentBox=e=>!\/\^\(\?:HTML\|BODY\|MAIN\|ARTICLE\)\$\//.test(html), 'substring consent patterns only through consentBox()');
const session = fs.readFileSync(path.join(root, 'session/page-session.mjs'), 'utf8');
ok(session.includes("this.workflowNotice(this.text('consent_covers'))") && session.includes("this.workflowNotice(this.text('consent_only'))"), 'the bar says when a wall covers the text / is all there is');
const locales = JSON.parse(fs.readFileSync(path.join(root, 'ui-locales.json'), 'utf8')).messages;
for (const lang of ['de', 'en', 'fr', 'es', 'it', 'pt']) ok(locales[lang].consent_covers && locales[lang].consent_only && locales[lang].statusDoneShort && locales[lang].statusVoiceMissingShort, `${lang}: wall and short status texts`);
console.log(`CONSENT WALL OK (${checks} checks)`);
