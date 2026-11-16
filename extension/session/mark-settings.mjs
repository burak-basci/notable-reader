import {createSettingsSwitch} from './shared-settings.mjs';
/* beNotable! Reader · "Markierung" settings block (own code, MIT): three independent controls. Word mark: off | subtle | normal | strong (segmented). Section tint (markTint) and section corner marks
   (markCorners): two switches, any combination (both, one, none). ONE implementation for the bar, the popup and the file view (they all mount this module).
   Built into the settings panel of the player surface (bar and popup) without touching the surface factory: same tokens, same block markup.
   The surface re-translates every [data-i18n] node itself when the UI language changes. */
import {STYLE_DEFAULTS, STYLE_RANGES, WORD_PRESETS, SECTION_PRESETS, cleanStyle, wordPalette, sectionPalette, wordContrast, measureContext, parseHex} from './mark-style.mjs';
export const MARK_VALUES = ['off', 'subtle', 'normal', 'strong'], MARK_VERSION = 2;
/* Settings model, version 2. Before: markWord off|subtle|strong (strong = the 1.6.24 look) and markSection off|subtle|strong. Now: markWord off|subtle|normal|strong (the old strong look is "normal"),
   markTint and markCorners booleans. marksFrom() reads ANY stored shape; the one-time rewrite (old values kept in markLegacy) lives in config.mjs.
   Old markSection: off -> tint off + corners off; subtle/strong/missing -> both on (the old strong intensity has no counterpart anymore, one level). */
export function marksFrom(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  if (r.markVersion === MARK_VERSION) return {markWord: MARK_VALUES.includes(r.markWord) ? r.markWord : 'normal', markTint: r.markTint !== false, markCorners: r.markCorners !== false};
  const on = r.markSection !== 'off';
  return {markWord: {off: 'off', subtle: 'subtle', strong: 'normal', normal: 'normal'}[r.markWord] || 'normal', markTint: on, markCorners: on};
}
const SWITCHES = [['markTint', 'markTintHint'], ['markCorners', 'markCornersHint']];
const CSS = '.mark-switch>span{font-weight:600;min-width:0}.mark-seg button{display:flex;flex-direction:column;align-items:center;gap:4px}.mark-swatch{display:inline-block;min-width:2.2em;padding:0 .35em;border-radius:3px;font-weight:400;line-height:1.5;text-align:center;box-sizing:border-box}.mark-swatch[data-level=off]{border:1px dashed currentColor;opacity:.7}.mark-swatch[data-level=subtle]{background:rgba(255,215,35,.2);border-bottom:2px solid #c68b00;border-radius:0 0 2px 2px}.mark-swatch[data-level=normal]{background:#ffec95;color:#14170f;border:1px solid #c68b00}.mark-swatch[data-level=strong]{background:#ffbf00;color:#14170f;border:2px solid #7a4a00;border-radius:4px}';
const CSS_BASE = '.mark-block{gap:12px}.mark-row{display:flex;flex-direction:column;gap:6px;min-width:0}.mark-row>span{font-weight:600}.mark-seg{display:flex;border:1px solid var(--reader-line);border-radius:8px;overflow:hidden;background:var(--reader-soft)}.mark-seg button{flex:1 1 0;min-width:0;margin:0;padding:6px 8px;border:0;border-left:1px solid var(--reader-line);border-radius:0;background:transparent;color:var(--reader-ink);font:inherit;cursor:pointer}.mark-seg button:first-child{border-left:0}.mark-seg button[aria-checked=true]{background:var(--reader-accent);color:var(--reader-on,#fff);font-weight:600}.mark-seg button:focus-visible{outline:2px solid var(--reader-accent);outline-offset:-2px}';
/* Speech block (same module, same three consumers: bar, popup, file view): one switch "normalizeSpeech" (default on) next to the marks. */
const SPEECH_CSS = '.speech-row{display:flex;align-items:center;gap:10px;margin:0;cursor:pointer}.speech-row>span{flex:1 1 auto;min-width:0;font-weight:600;overflow-wrap:anywhere}' +
  /* the explanation is ONE small line (the rest is in the tooltip and read out by screen readers via aria-describedby) */
  '.settings-block .speech-hint{margin:0;font-size:9px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}';
/* shadow: the surface shadow root. t(key): label lookup. get(): settings (any stored shape). onChange(key, value): markWord string | markTint / markCorners boolean / normalizeSpeech boolean. Returns {sync}. */
/* -- color and strength -------------------------------------------------------------------------------------------------------------------------- */
const STYLE_CSS = '.mark-style{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px 16px;margin-top:4px}.mark-style>h4,.mark-style>p,.mark-style>.mark-warn,.mark-style>.mark-reset{grid-column:1/-1}.mark-style h4{margin:0;font:inherit;font-weight:600}.mark-group{display:flex;flex-direction:column;gap:8px;min-width:0;padding-top:8px;border-top:1px solid var(--reader-line)}' +
  '.mark-group>span.mark-group-title{font-weight:600}.mark-swatches{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0;padding:2px 0 4px}.mark-chip{position:relative;width:26px;height:26px;min-width:26px;min-height:26px;padding:0;margin:0;border:2px solid var(--reader-line);border-radius:50%;cursor:pointer;background-clip:padding-box}' +
  '.mark-chip[data-preset=default]{background:conic-gradient(#ffec95 0 50%,#ffbf00 0)}.mark-chip[aria-checked=true]{border-color:var(--reader-accent);box-shadow:0 0 0 2px var(--reader-paper),0 0 0 4px var(--reader-accent)}.mark-chip:focus-visible{outline:2px solid var(--reader-accent);outline-offset:3px}' +
  '.mark-style .mark-custom{display:inline-flex;align-items:center;gap:6px;margin:0 0 0 4px!important;padding:0!important;min-height:0!important;font-size:.92em}.mark-custom input[type=color]{width:34px;height:26px;min-width:34px;padding:0;border:1px solid var(--reader-line);border-radius:6px;background:transparent;cursor:pointer}.mark-custom input[type=color]:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}' +
  '.mark-style .mark-range{display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 10px;margin:0!important;padding:0!important;min-height:0!important}.mark-range>span{grid-column:1/-1;font-weight:600}.mark-range input[type=range]{min-width:0;width:100%;accent-color:var(--reader-accent)}.mark-range output{min-width:3.4em;text-align:right;font-variant-numeric:tabular-nums}' +
  '.mark-preview{position:relative;padding:12px 14px;border:1px solid var(--reader-line);border-radius:8px;line-height:1.7;overflow:hidden}.pv-word{display:inline-block;line-height:1.35;padding:0 3px;border-radius:3px}.pv-sec{position:relative;display:block;padding:3px 8px;border-radius:3px}' +
  '.pv-corner{position:absolute;width:12px;height:12px;border:0 solid}.pv-corner.s{left:0;top:0;border-top-width:2px;border-left-width:2px;border-top-left-radius:3px}.pv-corner.e{right:0;bottom:0;border-bottom-width:2px;border-right-width:2px;border-bottom-right-radius:3px}' +
  '.mark-warn:empty{display:none}.mark-warn{margin:0;padding:6px 10px;border-radius:6px;border:1px solid var(--reader-line);background:var(--reader-soft);font-size:.92em}.mark-warn[data-level=low]{border-color:#c68b00;background:color-mix(in srgb,#ffbf00 18%,var(--reader-paper))}.mark-style button.mark-reset{align-self:flex-start;margin:0;padding:6px 12px;border:1px solid var(--reader-line);border-radius:8px;background:var(--reader-soft);color:var(--reader-ink);font:inherit;cursor:pointer}.mark-style button.mark-reset:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}';
const SAMPLE = ['markPreviewBefore', 'markPreviewWord', 'markPreviewAfter'];
const LEVEL_ALPHA = {subtle: 20, normal: 100, strong: 100, off: 100};
/* Colors of the reading mode the user chose (Hell / Dunkel / Automatisch): page background + page text of that scheme, so the previews are drawn on the same ground the marks appear on. null when the mode is off (then the measured page / the panel colors are used). */
const HEXC = /^#[0-9a-f]{6}$/i;
function readingPage(a) {
  const ap = a && typeof a === 'object' ? a : {}; let mode = ap.mode;
  if (mode === 'auto') mode = globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  if (mode !== 'dark' && mode !== 'light') return null;
  const pick = (v, d) => typeof v === 'string' && HEXC.test(v) ? parseHex(v) : parseHex(d);
  return mode === 'dark' ? {bg: pick(ap.background, '#181a1b'), text: pick(ap.text, '#e8e6e3')} : {bg: pick(ap.lightBackground, '#ffffff'), text: pick(ap.lightText, '#202124')};
}
/* pageContext(): {bg, text} of the page the marks are drawn on (bar / file view) or null (popup: no page at hand -> the contrast is checked against a light AND a dark reference page). */
function buildStyleBlock(doc, {t, get, onChange, pageContext}) {
  const node = doc.createElement('div'); node.className = 'mark-style'; node.dataset.markStyle = '';
  const css = doc.createElement('style'); css.textContent = STYLE_CSS; node.append(css);
  const heading = doc.createElement('h4'); heading.dataset.i18n = 'markStyleHeading'; heading.textContent = t('markStyleHeading');
  const hint = doc.createElement('p'); hint.className = 'block-sub'; hint.dataset.i18n = 'markStyleHint'; hint.textContent = t('markStyleHint');
  node.append(heading, hint);
  let style = cleanStyle(get?.()?.markStyle); const current = () => marksFrom(get?.() || {});
  const commit = () => onChange?.('markStyle', {...style});
  const group = (key, title) => { const g = doc.createElement('div'); g.className = 'mark-group'; g.dataset.markGroup = key; const h = doc.createElement('span'); h.className = 'mark-group-title'; h.dataset.i18n = title; h.textContent = t(title); g.append(h); return g; };
  /* swatch row: radiogroup of preset chips + the system color picker */
  const swatchRow = (presets, field) => {
    const row = doc.createElement('div'); row.className = 'mark-swatches'; row.setAttribute('role', 'radiogroup'); row.dataset.markColors = field; row.setAttribute('aria-label', t('markColorLabel'));
    const chips = presets.map(([id, hex]) => {
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'mark-chip'; b.setAttribute('role', 'radio'); b.dataset.preset = id; b.dataset.hex = hex || ''; if (hex) b.style.background = hex;
      b.dataset.i18nTitle = 'markColor_' + id; const name = t('markColor_' + id); b.title = name; b.setAttribute('aria-label', name);
      b.addEventListener('click', () => { style = {...style, [field]: hex}; paint(); commit(); });
      row.append(b); return b;
    });
    row.addEventListener('keydown', e => {
      const step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[e.key]; if (!step || e.target.type === 'color') return;
      const at = Math.max(0, chips.findIndex(c => c.tabIndex === 0)), next = chips[(at + step + chips.length) % chips.length]; e.preventDefault(); next.click(); next.focus();
    });
    const custom = doc.createElement('label'); custom.className = 'mark-custom'; const cs = doc.createElement('span'); cs.dataset.i18n = 'markColorCustom'; cs.textContent = t('markColorCustom');
    const input = doc.createElement('input'); input.type = 'color'; input.dataset.markColor = field; input.setAttribute('aria-label', t('markColorCustom'));
    input.addEventListener('input', () => { style = {...style, [field]: input.value.toLowerCase()}; paint(true); });
    input.addEventListener('change', () => { style = {...style, [field]: input.value.toLowerCase()}; paint(); commit(); });
    custom.append(cs, input); row.append(custom);
    return {row, chips, input, presets, field};
  };
  const range = (field, title, [lo, hi], store) => {
    const wrap = doc.createElement('label'); wrap.className = 'mark-range'; const sp = doc.createElement('span'); sp.dataset.i18n = title; sp.textContent = t(title);
    const input = doc.createElement('input'); input.type = 'range'; input.min = lo; input.max = hi; input.step = 1; input.dataset.markRange = field;
    const out = doc.createElement('output');
    const set = (v, save) => { out.textContent = v + ' %'; input.setAttribute('aria-valuetext', v + ' %'); style = {...style, [field]: store(v)}; paint(true); if (save) commit(); };
    input.addEventListener('input', () => set(Number(input.value), false)); input.addEventListener('change', () => set(Number(input.value), true));
    wrap.append(sp, input, out); return {wrap, input, out};
  };
  const word = group('word', 'markStyleWord'), wordSw = swatchRow(WORD_PRESETS, 'wordColor');
  const wordAlpha = range('wordAlpha', 'markStyleAlpha', STYLE_RANGES.wordAlpha, v => v === LEVEL_ALPHA[current().markWord] ? null : v);   // the level's own strength is stored as "default" (null), so switching the level keeps its own look
  const wordPreview = doc.createElement('div'); wordPreview.className = 'mark-preview'; wordPreview.dataset.markPreview = 'word'; wordPreview.setAttribute('aria-hidden', 'true');
  word.append(wordSw.row, wordAlpha.wrap, wordPreview);
  const sec = group('section', 'markStyleSection'), secSw = swatchRow(SECTION_PRESETS, 'sectionColor');
  const tint = range('tintAlpha', 'markStyleTint', STYLE_RANGES.tintAlpha, v => v), corner = range('cornerAlpha', 'markStyleCorners', STYLE_RANGES.cornerAlpha, v => v);
  const secPreview = doc.createElement('div'); secPreview.className = 'mark-preview'; secPreview.dataset.markPreview = 'section'; secPreview.setAttribute('aria-hidden', 'true');
  sec.append(secSw.row, tint.wrap, corner.wrap, secPreview);
  const warn = doc.createElement('p'); warn.className = 'mark-warn'; warn.setAttribute('role', 'status'); warn.setAttribute('aria-live', 'polite'); warn.dataset.markContrast = '';
  const reset = doc.createElement('button'); reset.type = 'button'; reset.className = 'mark-reset'; reset.dataset.markReset = ''; reset.dataset.i18n = 'markStyleReset'; reset.textContent = t('markStyleReset');
  reset.addEventListener('click', () => { style = {...STYLE_DEFAULTS}; paint(); commit(); });
  node.append(word, sec, warn, reset);
  const fmt = n => n.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1});
  function paint() {
    const m = current(), page = readingPage(get?.()?.appearance) || pageContext?.() || null, level = m.markWord;
    for (const sw of [wordSw, secSw]) {
      const value = style[sw.field], idx = sw.presets.findIndex(([, hex]) => hex === value);
      sw.chips.forEach((c, i) => { c.setAttribute('aria-checked', String(i === idx)); c.tabIndex = i === idx || (idx < 0 && i === 0) ? 0 : -1; });
      if (doc.activeElement !== sw.input && sw.input.getRootNode().activeElement !== sw.input) sw.input.value = value || (sw.field === 'wordColor' ? '#ffec95' : '#ffd723');
    }
    const wa = style.wordAlpha ?? LEVEL_ALPHA[level] ?? 100;
    wordAlpha.input.value = wa; wordAlpha.out.textContent = wa + ' %'; tint.input.value = style.tintAlpha; tint.out.textContent = style.tintAlpha + ' %'; corner.input.value = style.cornerAlpha; corner.out.textContent = style.cornerAlpha + ' %';
    wordAlpha.input.disabled = level === 'off'; tint.input.disabled = !m.markTint; corner.input.disabled = !m.markCorners;
    /* previews on the colors of the page (or of the reader panel when there is no page at hand) */
    const pageBg = page?.bg ? `rgb(${page.bg.map(Math.round)})` : 'var(--reader-paper)', pageText = page?.text ? `rgb(${page.text.map(Math.round)})` : 'var(--reader-ink)';
    for (const box of [wordPreview, secPreview]) { box.style.background = pageBg; box.style.color = pageText; }
    const w = doc.createElement('span'); w.className = 'pv-word'; w.textContent = t(SAMPLE[1]);
    if (level === 'off') { w.style.border = '1px dashed currentColor'; w.style.opacity = '.7'; }
    else { const p = wordPalette(level, style, {bg: page?.bg || null}); w.style.background = p.fill; if (p.text) w.style.color = p.text; if (level === 'subtle') w.style.borderBottom = '2px solid ' + p.under; else { w.style.border = p.frameWidth + 'px solid ' + p.frame; w.style.borderRadius = level === 'strong' ? '4px' : '3px'; } }
    wordPreview.replaceChildren(doc.createTextNode(t(SAMPLE[0]) + ' '), w, doc.createTextNode(' ' + t(SAMPLE[2])));
    const sp = sectionPalette(style), box = doc.createElement('span'); box.className = 'pv-sec'; box.textContent = t(SAMPLE[0]) + ' ' + t(SAMPLE[1]) + ' ' + t(SAMPLE[2]);
    if (m.markTint) box.style.background = sp.tint;
    if (m.markCorners) for (const kind of ['s', 'e']) { const c = doc.createElement('span'); c.className = 'pv-corner ' + kind; c.style.borderColor = sp.corner; c.style.opacity = sp.cornerOpacity; box.append(c); }
    secPreview.replaceChildren(box);
    /* contrast warning: a notice, never a ban */
    /* only the WORD mark is checked (its text sits on the fill); the section tint is just a faint hint of the section being read, so it never produces a warning */
    const lows = [], wc = wordContrast(level, style, page);
    if (!wc.ok) lows.push(t(wc.approx ? 'markContrastWordRef' : 'markContrastWord', {ratio: fmt(wc.ratio)}));
    warn.dataset.level = lows.length ? 'low' : 'ok'; warn.dataset.low = String(lows.length);
    warn.textContent = lows.join(' ');   // only a real problem is written down; no always-on "contrast ok" line and no advice sentence
  }
  const sync = () => {
    style = cleanStyle(get?.()?.markStyle);
    for (const n of node.querySelectorAll('[data-i18n]')) { const text = t(n.dataset.i18n); if (n.textContent !== text) n.textContent = text; }
    for (const n of node.querySelectorAll('[data-i18n-title]')) { const text = t(n.dataset.i18nTitle); n.title = text; n.setAttribute('aria-label', text); }
    for (const i of node.querySelectorAll('input[type=color]')) i.setAttribute('aria-label', t('markColorCustom'));
    for (const r of node.querySelectorAll('.mark-swatches')) r.setAttribute('aria-label', t('markColorLabel'));
    paint();
  };
  return {node, sync};
}
export function installMarkSettings(shadow, {t = key => key, get, onChange, pageContext}) {
  const content = shadow?.querySelector('.settings-content');
  if (!content || content.querySelector('[data-settings-block=marks]')) return {sync() {}, node: content?.querySelector('[data-settings-block=marks]') || null};
  const doc = shadow.ownerDocument || document, node = doc.createElement('fieldset');
  node.className = 'settings-block mark-block'; node.dataset.settingsBlock = 'marks';
  const style = doc.createElement('style'); style.textContent = CSS_BASE + CSS;
  const legend = doc.createElement('legend'); legend.dataset.i18n = 'markHeading'; legend.textContent = t('markHeading');
  node.append(style, legend);
  /* a) word mark: four levels */
  const wordRow = doc.createElement('div'); wordRow.className = 'mark-row'; wordRow.dataset.markKey = 'markWord';
  const title = doc.createElement('span'); title.id = 'mark-markWord'; title.dataset.i18n = 'markWord'; title.textContent = t('markWord');
  const seg = doc.createElement('div'); seg.className = 'mark-seg'; seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-labelledby', title.id);
  const cap = v => 'mark' + v[0].toUpperCase() + v.slice(1);
  for (const value of MARK_VALUES) {
    const b = doc.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.value = value;
    const swatch = doc.createElement('span'); swatch.className = 'mark-swatch'; swatch.dataset.level = value; swatch.setAttribute('aria-hidden', 'true'); swatch.textContent = 'Aa';
    const label = doc.createElement('span'); label.dataset.i18n = cap(value); label.textContent = t(label.dataset.i18n);
    b.append(swatch, label);
    b.addEventListener('click', () => { if (b.getAttribute('aria-checked') === 'true') return; paintWord(value); onChange?.('markWord', value); });
    seg.append(b);
  }
  const wordSub = doc.createElement('p'); wordSub.className = 'block-sub'; wordSub.dataset.i18n = 'markWordHint'; wordSub.textContent = t('markWordHint');
  wordRow.append(title, seg, wordSub); node.append(wordRow);
  function paintWord(value) { for (const b of seg.children) { const on = b.dataset.value === value; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; } }
  seg.addEventListener('keydown', e => {
    const step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[e.key]; if (!step) return;
    const at = MARK_VALUES.indexOf(seg.querySelector('[aria-checked=true]')?.dataset.value), next = MARK_VALUES[(at + step + MARK_VALUES.length) % MARK_VALUES.length];
    e.preventDefault(); paintWord(next); onChange?.('markWord', next); seg.querySelector('[data-value=' + next + ']').focus();
  });
  /* b) section tint, c) corner marks: independent switches */
  const boxes = new Map(), subs = new Map();
  for (const [key, hint] of SWITCHES) {
    /* same pattern as every other switch of the settings panel: <label>text <button class="switch-input" role="switch" aria-checked>, text left, switch right */
    const row = doc.createElement('label'); row.className = 'mark-switch'; row.dataset.markKey = key;
    const box = doc.createElement('button'); box.type = 'button'; box.className = 'switch-input'; box.setAttribute('role', 'switch'); box.dataset.markSwitch = key; box.id = 'mark-' + key; box.setAttribute('aria-checked', 'false');
    const text = doc.createElement('span'); text.dataset.i18n = key; text.textContent = t(key);
    const sub = doc.createElement('p'); sub.className = 'block-sub'; sub.id = 'mark-' + key + '-hint'; sub.dataset.i18n = hint; sub.textContent = t(hint);
    box.setAttribute('aria-describedby', sub.id); box.addEventListener('click', () => { const on = box.getAttribute('aria-checked') !== 'true'; box.setAttribute('aria-checked', String(on)); onChange?.(key, on); });
    row.append(text, box); node.append(row, sub); boxes.set(key, box); subs.set(key, sub);
  }
  const styleBlock = buildStyleBlock(doc, {t, get, onChange, pageContext: pageContext || (() => measureContext(doc))}); node.append(styleBlock.node);
  const speech = doc.createElement('fieldset'); speech.className = 'settings-block mark-block'; speech.dataset.settingsBlock = 'speech';
  const speechStyle = doc.createElement('style'); speechStyle.textContent = SPEECH_CSS;
  const speechLegend = doc.createElement('legend'); speechLegend.dataset.i18n = 'speechHeading'; speechLegend.textContent = t('speechHeading');
  const speechRow = doc.createElement('label'); speechRow.className = 'speech-row'; speechRow.dataset.speechKey = 'normalizeSpeech';
  const box = createSettingsSwitch(doc.createElement('button'),true); box.dataset.speechSwitch = 'normalizeSpeech'; box.id = 'speech-normalizeSpeech';
  const speechTitle = doc.createElement('span'); speechTitle.dataset.i18n = 'normalizeSpeech'; speechTitle.textContent = t('normalizeSpeech');
  const speechSub = doc.createElement('p'); speechSub.className = 'block-sub speech-hint'; speechSub.dataset.i18n = 'normalizeSpeechHint'; speechSub.textContent = t('normalizeSpeechHint');
  box.addEventListener('change', () => onChange?.('normalizeSpeech', box.checked));
  speechRow.append(speechTitle, box); speech.append(speechStyle, speechLegend, speechRow, speechSub);
  const sync = () => {
    const v = get?.() || {};
    for (const n of speech.querySelectorAll('[data-i18n]')) { const text = t(n.dataset.i18n); if (n.textContent !== text) n.textContent = text; }
    box.checked = v.normalizeSpeech !== false; speechRow.title = speechSub.title = speechSub.textContent; box.setAttribute('aria-describedby', 'speech-normalizeSpeech-hint'); speechSub.id = 'speech-normalizeSpeech-hint';
    for (const n of node.querySelectorAll('[data-i18n]')) { const text = t(n.dataset.i18n); if (n.textContent !== text) n.textContent = text; }
    const m = marksFrom(v); paintWord(m.markWord); styleBlock.sync(); for (const b of seg.children) b.title = t('markWordHint');
    for (const [key] of SWITCHES) { boxes.get(key).setAttribute('aria-checked', String(m[key])); boxes.get(key).parentElement.title = subs.get(key).textContent; }
  };
  const anchor = content.querySelector('[data-settings-block=follow]');
  if (anchor) anchor.after(node); else (content.querySelector('[data-settings-section=view]') || content).append(node);
  node.after(speech);
  sync();
  return {sync, node, speech};
}
