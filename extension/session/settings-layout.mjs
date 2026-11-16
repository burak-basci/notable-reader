/* beNotable! Reader · layout of the settings panel (own code, MIT): FIVE tabs, the overlay colors and the typography preview.
   ONE implementation for the bar on a page, the file view / Focus Reader and the toolbar popup: every consumer calls installSettingsLayout() once, AFTER installMarkSettings() and
   installSettingsExtras() have added their blocks (the blocks are only moved, never rebuilt, so every hook of the other modules keeps working).
   Tabs: Funktionalitaet | Text | Theme (Farben) | Tastatur | Regeln. The selected tab is remembered (extension storage, key notableSettingsTab).
   shadow: the surface shadow root. t(key, params): label lookup. get(): the settings. onChange(key, value): one setting. onPreview(theme): live colors while a color picker is dragged (nothing is stored). */
import {OVERLAY_DEFAULTS, OVERLAY_FIELDS, OVERLAY_PRESETS, cleanOverlayTheme, derive, mix, resolve, problems, matchPreset, emptyTheme, APPEARANCE_PRESETS, APPEARANCE_FIELDS} from './overlay-theme.mjs';

export const TABS = Object.freeze([['func', 'setTabFunc'], ['text', 'setTabText'], ['theme', 'setTabTheme'], ['keys', 'setTabKeys'], ['rules', 'setTabRules']]);
export const TAB_KEY = 'notableSettingsTab';
/* which block lives in which tab; blocks that exist nowhere in this list stay where they are (in the tab "func") */
/* round 3: Functions = reading, reader bar, summarize; following the text belongs to Text; pronunciation and the settings backup to Rules */
const PLACE = {reading: 'func', toolbar: 'func', explain: 'func', follow: 'text', speech: 'rules', backup: 'rules', typography: 'text', 'overlay-colors': 'theme', appearance: 'theme', marks: 'theme', keyboard: 'keys', shortcuts: 'keys', 'reading-tools': 'rules', 'reading-filters': 'rules'};
const FONTS = {serif: 'Georgia, "Times New Roman", serif', sans: 'Arial, Helvetica, sans-serif', readable: '"Atkinson Hyperlegible", Lexend, Verdana, "DejaVu Sans", sans-serif', book: 'Charter, "Bitstream Charter", "Noto Serif", "Liberation Serif", Georgia, serif', modern: 'Inter, "Noto Sans", "Segoe UI", Roboto, "Helvetica Neue", sans-serif', classic: '"Times New Roman", "Liberation Serif", "Nimbus Roman", Times, serif', system: 'system-ui, sans-serif', mono: 'ui-monospace, monospace'};
const CSS = '.settings-tabs{position:relative;z-index:2;display:flex;flex:none;gap:2px;margin:0;padding:8px 6px 0;background:var(--reader-paper);border-bottom:1px solid var(--reader-line);overflow:hidden}@media(max-width:420px){.settings-tabs button[role=tab]{font-size:11px!important}}' +
  /* G2a/G2b: the strip is a fixed head, only the area UNDER it scrolls (its scrollbar never reaches the tabs); nothing scrolls sideways */
  '.settings-content[data-tabbed]{display:flex;flex-direction:column;gap:0;min-height:0;padding:0;overflow:hidden}.settings-content[data-tabbed]>.settings-tabpanels{display:block;flex:1 1 auto;min-width:0;min-height:0;box-sizing:border-box;padding:12px 16px 14px;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-gutter:stable}' +
  '.settings-panel[data-inline] .settings-content[data-tabbed]{overflow:visible}.settings-panel[data-inline] .settings-content[data-tabbed]:not([data-fit])>.settings-tabpanels{overflow:visible}.settings-panel[data-inline] .settings-content[data-tabbed]:not([data-fit])>.settings-tabs{position:sticky;top:0}.settings-panel[data-inline] .settings-content[data-tabbed][data-fit]{overflow:hidden;max-height:var(--tabs-avail,none)!important}' +
  '.settings-tabs button[role=tab]{flex:1 1 0;min-width:44px;margin:0;padding:0 2px;min-height:44px;line-height:41px;border:0;border-bottom:3px solid transparent;border-radius:6px 6px 0 0;background:transparent;color:var(--reader-muted);font:inherit;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}' +
  '.settings-tabs button[role=tab]:hover{color:var(--reader-ink);background:var(--reader-soft)}.settings-tabs button[role=tab][aria-selected=true]{color:var(--reader-ink);border-bottom-color:var(--reader-accent)}.settings-tabs button[role=tab]:focus-visible{outline:2px solid var(--reader-accent);outline-offset:-2px}' +
  '.settings-tabpanel{display:block;column-width:290px;column-gap:14px;min-width:0}.settings-tabpanel>*{break-inside:avoid;margin:0 0 10px!important}.settings-tabpanel .kb-edit-list{column-width:330px;column-gap:14px}.settings-tabpanel .kb-edit-row{break-inside:avoid}.settings-tabpanel>[data-settings-block=reading-tools],.settings-tabpanel>[data-settings-block=shortcuts],.settings-tabpanel>[data-settings-block=overlay-colors],.settings-tabpanel>[data-settings-block=marks],.settings-tabpanel>[data-settings-block=appearance]{column-span:all}.settings-tabpanel[hidden],.settings-block[data-emptied]{display:none!important}.settings-section[data-emptied]{display:none!important}' +
  '.ov-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}@media(max-width:560px){.ov-grid{grid-template-columns:minmax(0,1fr)}}.ov-side{display:flex;flex-direction:column;gap:8px;min-width:0;padding:10px;border:1px solid var(--reader-line);border-radius:9px}.ov-presets{min-width:0}.ov-title{font-weight:700}' +
  '.ov-presets{display:flex;flex-wrap:wrap;gap:6px}.ov-chip{position:relative;width:26px;height:26px;min-width:26px;min-height:26px;padding:0;margin:0;border:2px solid var(--reader-line);border-radius:50%;cursor:pointer}.ov-chip[aria-checked=true]{border-color:var(--reader-accent);box-shadow:0 0 0 2px var(--reader-paper),0 0 0 4px var(--reader-accent)}.ov-chip:focus-visible{outline:2px solid var(--reader-accent);outline-offset:3px}' +
  '.settings-panel .ov-field{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0}.ov-field input[type=color]{width:38px;height:26px;min-width:38px;padding:0;border:1px solid var(--reader-line);border-radius:6px;background:transparent;cursor:pointer}.ov-field input[type=color]:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}' +
  '.ov-preview{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--pv-line);border-radius:9px;background:var(--pv-paper);color:var(--pv-ink);min-width:0}.ov-play{flex:none;width:26px;height:26px;border-radius:50%;background:var(--pv-accent);color:var(--pv-on)}.ov-play::after{content:"";display:block;width:0;height:0;margin:7px 0 0 10px;border-left:9px solid var(--pv-on);border-top:6px solid transparent;border-bottom:6px solid transparent}' +
  /* The sample shows the selected ink exactly; derived muted UI text would misrepresent the color picker. */
  '.ov-preview{flex-wrap:nowrap}.ov-preview strong{font-weight:700;white-space:nowrap;flex:none}.ov-preview .ov-pill{white-space:nowrap;flex:none}.ov-preview .ov-muted{color:var(--pv-ink);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ov-preview .ov-pill{margin-left:auto;padding:2px 8px;border-radius:999px;background:var(--pv-soft);color:var(--pv-ink);border:1px solid var(--pv-line)}' +
  '.ov-warn{margin:0;font-size:.92em;line-height:1.45;color:var(--reader-ink)}.ov-warn:empty{display:none}.ov-warn[data-low=true]{padding:4px 8px;border:1px solid var(--reader-accent);border-radius:6px;background:var(--reader-soft)}' +
  '.ov-reset,.typo-open{align-self:flex-start;margin:0;padding:6px 12px;border:1px solid var(--reader-line);border-radius:8px;background:var(--reader-soft);color:var(--reader-ink);font:inherit;cursor:pointer}.ov-reset:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}' +
  '.typo-preview{margin:0;padding:10px 12px;border:1px solid var(--reader-line);border-radius:9px;background:var(--reader-soft);color:var(--reader-ink);overflow:hidden;overflow-wrap:anywhere}.typo-preview p{margin:0}';
const CSS_AREA = '.overlay-block>.block-sub:not(.overlay-mode-sub){display:none}.rd-presets{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 4px}.block-cell[data-settings-cell=dark] .block-sub,.block-cell[data-settings-cell=light] .block-sub{display:none}.ov-field,.appearance-row{min-width:0}' +
  /* Lesemodus = same component as the overlay: framed cards (no divider lines), preset circles, color rows, preview */
  '[data-settings-block=appearance] .block-grid{border:0!important;gap:10px}[data-settings-block=appearance] .block-cell{border:1px solid var(--reader-line)!important;border-radius:9px;padding:10px!important}[data-settings-block=appearance] .block-cell .cell-title{font-weight:700}@media(max-width:560px){[data-settings-block=appearance] .block-grid{grid-template-columns:minmax(0,1fr)}}' +
  '.rd-preview{margin-top:2px}.rd-preview .ov-pill{color:var(--pv-accent)}';
const store = () => globalThis.chrome?.storage?.local || null;

export function installSettingsLayout(shadow, {t = key => key, get, onChange, onPreview} = {}) {
  const content = shadow?.querySelector('.settings-content');
  if (!content || content.querySelector('[data-settings-tabs]')) return {sync() {}, select() {}};
  const doc = shadow.ownerDocument || document;
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const text = (node, key, args) => { node.dataset.i18n = key; node.textContent = t(key, args || {}); return node; };
  const style = el('style'); style.textContent = CSS + CSS_AREA; content.prepend(style); content.dataset.tabbed = '';

  /* -- overlay colors (theme tab) ---------------------------------------------------------------------------------------------------------------- */
  const block = el('fieldset', 'settings-block overlay-block'); block.dataset.settingsBlock = 'overlay-colors';
  const legend = el('legend'); text(legend, 'overlayColorsTitle'); const sub = el('p', 'block-sub'); text(sub, 'overlayColorsSub'); block.append(legend, sub);
  /* The "Overlay theme: automatic / light / dark" row is the bar's moon button, so it stays in the bar block of the first tab (category 1 mirrors the whole bar);
     its explanation ("the moon button switches the same setting") follows it there. This block keeps the two color schemes. */
  const themeRow = content.querySelector('.player-theme-row');
  if (themeRow) {
    const toolbar = themeRow.closest('[data-settings-block=toolbar]'), toolbarSub = toolbar?.querySelector(':scope>.block-sub');
    if (toolbarSub) { toolbarSub.classList.add('overlay-mode-sub'); themeRow.after(toolbarSub); }
  }
  const grid = el('div', 'ov-grid'); block.append(grid);
  let draft = cleanOverlayTheme(get?.()?.overlayTheme);
  const sides = {};
  const previewVars = (theme, side) => {
    const r = resolve(theme, side), full = derive({...emptyTheme(), [side]: r}, side);
    return full ? Object.entries(full).map(([k, v]) => `--pv-${k === 'on-accent' ? 'on' : k}:${v}`).join(';') : '';
  };
  const commit = () => onChange?.('overlayTheme', cleanOverlayTheme(draft));
  for (const side of ['dark', 'light']) {
    const box = el('div', 'ov-side'); box.dataset.overlaySide = side; box.setAttribute('role', 'group');
    const title = el('strong', 'ov-title'); title.id = 'ov-title-' + side; text(title, side === 'light' ? 'appearanceLight' : 'appearanceDark'); box.setAttribute('aria-labelledby', title.id);
    const presets = el('div', 'ov-presets', {role: 'radiogroup'}); presets.dataset.overlayPresets = side; presets.setAttribute('aria-label', t('overlayPresetLabel'));
    const chips = OVERLAY_PRESETS[side].map(([id, value]) => {
      const c = value || OVERLAY_DEFAULTS[side], b = el('button', 'ov-chip', {type: 'button', role: 'radio'}); b.dataset.preset = id; b.dataset.i18nTitle = 'overlayPreset_' + id;
      b.style.background = `linear-gradient(135deg,${c.bg} 0 50%,${c.accent} 50% 100%)`; b.title = t('overlayPreset_' + id); b.setAttribute('aria-label', t('overlayPreset_' + id));
      b.addEventListener('click', () => { draft = cleanOverlayTheme({...draft, [side]: value ? {...value} : {bg: null, text: null, accent: null}}); paint(); commit(); });
      presets.append(b); return b;
    });
    presets.addEventListener('keydown', e => {
      const step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[e.key]; if (!step) return;
      const at = Math.max(0, chips.findIndex(c => c.tabIndex === 0)), next = chips[(at + step + chips.length) % chips.length]; e.preventDefault(); next.click(); next.focus();
    });
    const fields = {};
    for (const key of OVERLAY_FIELDS) {
      const row = el('label', 'ov-field'), span = el('span'); text(span, key === 'bg' ? 'appearanceBackground' : key === 'text' ? 'appearanceText' : 'overlayAccent');
      const input = el('input', '', {type: 'color'}); input.dataset.overlayColor = side + '-' + key; input.setAttribute('aria-label', t(span.dataset.i18n) + ' · ' + t(side === 'light' ? 'appearanceLight' : 'appearanceDark'));
      const set = () => { draft = cleanOverlayTheme({...draft, [side]: {...draft[side], [key]: input.value.toLowerCase()}}); };
      input.addEventListener('input', () => { set(); paint(true); onPreview?.(cleanOverlayTheme(draft)); });
      input.addEventListener('change', () => { set(); paint(); commit(); });
      row.append(span, input); fields[key] = input; box.append(row);
    }
    const prev = el('div', 'ov-preview'); prev.dataset.overlayPreview = side; prev.setAttribute('aria-hidden', 'true');
    prev.innerHTML = '<span class="ov-play"></span><strong></strong><span class="ov-muted"></span><span class="ov-pill">Aa</span>';
    const warn = el('p', 'ov-warn'); warn.setAttribute('role', 'status'); warn.setAttribute('aria-live', 'polite'); warn.dataset.overlayWarn = side;
    box.prepend(title, presets); box.append(prev, warn); grid.append(box); sides[side] = {box, chips, fields, prev, warn, presets};
  }
  const reset = el('button', 'ov-reset', {type: 'button'}); reset.dataset.overlayReset = ''; text(reset, 'overlayReset');
  reset.addEventListener('click', () => { draft = emptyTheme(); paint(); commit(); });
  block.append(reset);
  const fmt = n => n.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1});
  function paint(live = false) {
    for (const side of ['light', 'dark']) {
      const s = sides[side], r = resolve(draft, side), id = matchPreset(draft, side);
      s.chips.forEach((b, i) => { const on = b.dataset.preset === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on || id === 'custom' && i === 0 ? 0 : -1; });
      for (const key of OVERLAY_FIELDS) if (s.fields[key].getRootNode().activeElement !== s.fields[key] || !live) s.fields[key].value = r[key];
      s.prev.style.cssText = previewVars(draft, side);
      s.prev.querySelector('strong').textContent = 'beNotable!'; s.prev.querySelector('.ov-muted').textContent = t('overlayPreviewMuted');
      const lows = problems(draft, side).map(p => t(p.field === 'text' ? 'overlayWarnText' : 'overlayWarnAccent', {ratio: fmt(p.ratio)}));
      s.warn.textContent = lows.join(' '); s.warn.dataset.low = String(lows.length > 0);
    }
  }
  /* -- typography preview (text tab): the block of the surface changes the document in the focus reading view; here the user sees the result right away ------------------------------------ */
  const typo = content.querySelector('[data-settings-block=typography]');
  let typoPreview = null;
  if (typo) {
    typoPreview = el('div', 'typo-preview'); typoPreview.dataset.typoPreview = ''; typoPreview.setAttribute('aria-hidden', 'true'); const p = el('p'); typoPreview.append(p);
    typo.append(typoPreview);
    const paintTypo = () => {
      const read = key => typo.querySelector(`[data-appearance=${key}]`)?.value, d = get?.()?.appearance || {};
      const family = read('fontFamily') || d.fontFamily || 'serif', size = Number(read('fontSize') || d.fontSize || 18), line = Number(read('lineHeight') || d.lineHeight || 1.6), width = Number(read('contentWidth') || d.contentWidth || 720);
      p.textContent = t('typoPreviewText'); typoPreview.style.fontFamily = FONTS[family] || FONTS.serif; typoPreview.style.fontSize = Math.max(12, Math.min(32, size)) + 'px'; typoPreview.style.lineHeight = String(Math.max(1.2, Math.min(2.4, line)));
      typoPreview.style.maxWidth = width >= 1200 ? 'none' : Math.max(280, width) + 'px';   // 1200 = the full available width
    };
    typo.addEventListener('input', paintTypo); typo.addEventListener('change', () => setTimeout(paintTypo, 0)); typoPreview._paint = paintTypo; paintTypo();
  }

  /* -- tabs ----------------------------------------------------------------------------------------------------------------------------------------- */
  const tabs = el('div', 'settings-tabs', {role: 'tablist'}); tabs.dataset.settingsTabs = ''; tabs.setAttribute('aria-label', t('setTabsLabel'));
  const panels = {}, tabButtons = {};
  const holder = el('div', 'settings-tabpanels'); holder.dataset.settingsPanels = '';
  for (const [id, key] of TABS) {
    const b = el('button', '', {type: 'button', role: 'tab', id: 'settings-tab-' + id, 'aria-controls': 'settings-panel-' + id, 'aria-selected': 'false', tabindex: '-1'}); b.dataset.tab = id; text(b, key);
    const panel = el('div', 'settings-tabpanel', {role: 'tabpanel', id: 'settings-panel-' + id, 'aria-labelledby': b.id}); panel.dataset.tabPanel = id; panel.hidden = true;
    tabs.append(b); holder.append(panel); tabButtons[id] = b; panels[id] = panel;
  }
  /* move every block into its tab; the order inside a tab follows the order the blocks had in the panel */
  const all = [...content.querySelectorAll('[data-settings-block]')].filter(n => !n.closest('.retired-controls') && !n.closest('.settings-tabpanels'));
  const theme = content.querySelector('[data-settings-block=appearance]'); if (theme) theme.before(block); else content.append(block);
  /* preset tiles for the two reading-mode color schemes (same tiles as the overlay presets); a tile writes the three color inputs of the surface through their own input / change events */
  { const g = theme?.querySelector('.block-grid'), d = g?.querySelector('[data-settings-cell=dark]'), l = g?.querySelector('[data-settings-cell=light]'); if (g && d && l) g.prepend(d, l); }   // color schemes first (Dunkel left, Hell right), tone and images below
  const rdChips = {};
  const rdInput = f => theme?.querySelector(`[data-appearance=${f}]`);
  for (const side of ['dark', 'light']) {
    const cell = theme?.querySelector(`[data-settings-cell=${side}]`), first = cell?.querySelector('.appearance-row'); if (!cell || !first) continue;
    const group = el('div', 'rd-presets', {role: 'radiogroup'}); group.dataset.readingPresets = side; group.setAttribute('aria-label', t('overlayPresetLabel'));
    rdChips[side] = {group, chips: APPEARANCE_PRESETS[side].map(([id, v]) => {
      const fields = APPEARANCE_FIELDS[side], b = el('button', 'ov-chip', {type: 'button', role: 'radio'}); b.dataset.preset = id; b.dataset.i18nTitle = 'overlayPreset_' + id;
      b.style.background = `linear-gradient(135deg,${v[fields[0]]} 0 50%,${v[fields[2]]} 50% 100%)`; b.title = t('overlayPreset_' + id); b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => { const inputs = fields.map(rdInput); if (inputs.some(i => !i)) return; fields.forEach((f, k) => { inputs[k].value = v[f]; inputs[k].dispatchEvent(new Event('input', {bubbles: true})); }); inputs.forEach(i => i.dispatchEvent(new Event('change', {bubbles: true}))); setTimeout(paintReading, 0); });
      group.append(b); return b;
    })};
    group.addEventListener('keydown', e => {
      const step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[e.key]; if (!step) return; const cs = rdChips[side].chips;
      const at = Math.max(0, cs.findIndex(c => c.tabIndex === 0)), next = cs[(at + step + cs.length) % cs.length]; e.preventDefault(); next.click(); next.focus();
    });
    first.before(group);
    const prev = el('div', 'ov-preview rd-preview'); prev.dataset.readingPreview = side; prev.setAttribute('aria-hidden', 'true');
    prev.innerHTML = '<span class="ov-play"></span><strong></strong><span class="ov-muted"></span><span class="ov-pill">Aa</span>'; cell.append(prev); rdChips[side].prev = prev;
  }
  function paintReading() {
    for (const [side, r] of Object.entries(rdChips)) {
      const fields = APPEARANCE_FIELDS[side], cur = fields.map(f => String(rdInput(f)?.value || '').toLowerCase());
      const id = APPEARANCE_PRESETS[side].find(([, v]) => fields.every((f, k) => v[f] === cur[k]))?.[0] || 'custom';
      r.chips.forEach((b, i) => { const on = b.dataset.preset === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on || id === 'custom' && i === 0 ? 0 : -1; });
      if (r.prev && cur.every(c => /^#[0-9a-f]{6}$/.test(c))) {   // the same preview as the overlay: page color, page text, link color
        const [bg, ink, link] = cur; r.prev.style.cssText = `--pv-paper:${bg};--pv-ink:${ink};--pv-accent:${link};--pv-on:${bg};--pv-muted:${mix(ink, bg, .72)};--pv-line:${mix(ink, bg, .16)};--pv-soft:${mix(ink, bg, .06)}`;
        r.prev.querySelector('strong').textContent = 'beNotable!'; r.prev.querySelector('.ov-muted').textContent = t('overlayPreviewMuted');
      }
    }
  }
  shadow.addEventListener('notable-appearance-rendered', () => paintReading());   // the surface fills the color inputs by script (no input event): paint the previews from the real values
  theme?.addEventListener('input', () => setTimeout(paintReading, 0)); theme?.addEventListener('change', () => setTimeout(paintReading, 0));
  const order = ['reading', 'toolbar', 'explain', 'follow', 'typography', 'marks', 'overlay-colors', 'appearance', 'keyboard', 'shortcuts', 'reading-tools', 'reading-filters', 'speech', 'backup'];
  const blocks = [...new Set([...all, block])].sort((a, b) => (order.indexOf(a.dataset.settingsBlock) + 100) % 100 - (order.indexOf(b.dataset.settingsBlock) + 100) % 100);
  for (const node of blocks) {
    const hidden = !!node.closest('[hidden]') && node !== block; if (hidden) node.hidden = true;
    (panels[PLACE[node.dataset.settingsBlock] || 'func']).append(node);
  }
  for (const section of content.querySelectorAll('.settings-section')) if (!section.querySelector('[data-settings-block]')) section.dataset.emptied = '';
  const anchor = content.querySelector('h2'); (anchor || content.firstChild) && (anchor ? anchor.after(tabs, holder) : content.prepend(tabs, holder));
  /* G2d: a block without any visible control (everything moved elsewhere or hidden on this surface, e.g. "Leiste" on a page where the bar is already shown) is hidden, never shown as an empty frame */
  const hiddenWithin = (n, root) => { for (let x = n; x && x !== root; x = x.parentElement) if (x.hidden) return true; return false; };
  const hasControls = node => [...node.querySelectorAll('input,select,button,textarea,output,.kb-edit-list,.ov-grid,.mark-style,.typo-preview')].some(n => !hiddenWithin(n, node) && n.type !== 'file');
  let emptying = false;
  const hideEmpty = () => {
    if (emptying) return; emptying = true;
    try { for (const node of content.querySelectorAll('[data-settings-block]')) { if (node.closest('.retired-controls')) continue; const empty = !hasControls(node); if (empty && !node.hidden) { node.hidden = true; node.dataset.emptied = ''; } else if (!empty && node.dataset.emptied !== undefined) { node.hidden = false; delete node.dataset.emptied; } } } finally { emptying = false; }
  };
  hideEmpty();
  try { new MutationObserver(() => hideEmpty()).observe(holder, {subtree: true, attributes: true, attributeFilter: ['hidden'], childList: true}); } catch {}
  /* G2a on the popup: the host scrolls (its body); the settings get exactly the height that is left, so the page scrollbar never appears and only the area under the tab strip scrolls */
  const up = n => n.parentElement || (n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null);
  const scroller = () => { for (let n = up(content); n; n = up(n)) { if (n === doc.documentElement || n === doc.body) return null; if (['auto', 'scroll'].includes(getComputedStyle(n).overflowY)) return n; } return null; };
  let fitFrame = 0;
  const fit = () => {
    fitFrame = 0;
    const panel = content.closest('.settings-panel');
    if (!panel?.hasAttribute('data-inline') || !content.getClientRects().length) return;
    const sp = scroller(); if (!sp) { content.removeAttribute('data-fit'); return; }
    const box = sp.getBoundingClientRect(), pad = parseFloat(getComputedStyle(sp).paddingBottom) || 0, top = content.getBoundingClientRect().top + sp.scrollTop;
    const room = Math.floor(box.bottom - pad - top - 2); if (!(room > 0)) return;
    const apply = px => { const v = Math.max(120, Math.floor(px)) + 'px'; if (content.style.getPropertyValue('--tabs-avail') !== v) content.style.setProperty('--tabs-avail', v); content.dataset.fit = ''; };
    apply(room); const over = sp.scrollHeight - sp.clientHeight; if (over > 1) apply(room - over);   // whatever else the host puts into its body: the sum must fit, so the host itself never shows a scrollbar
  };
  const scheduleFit = () => { if (!fitFrame) fitFrame = (doc.defaultView || window).requestAnimationFrame(fit); };
  try { const sp0 = scroller(); const ro = new ResizeObserver(scheduleFit); ro.observe(sp0 || doc.documentElement); if (sp0) { ro.observe(shadow.host); for (const child of sp0.children) ro.observe(child); } } catch {}
  (doc.defaultView || window).addEventListener('resize', scheduleFit);
  let current = 'func';
  function select(id, {focus = false, save = true} = {}) {
    if (!panels[id]) id = 'func';
    current = id;
    for (const [k, b] of Object.entries(tabButtons)) { const on = k === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; panels[k].hidden = !on; }
    if (focus) tabButtons[id].focus({preventScroll: true});
    if (save) try { void store()?.set({[TAB_KEY]: id}).catch?.(() => {}); } catch {}
    paint(); paintReading(); typoPreview?._paint?.(); hideEmpty(); scheduleFit();
  }
  tabs.addEventListener('click', e => { const b = e.target.closest('[role=tab]'); if (b) select(b.dataset.tab); });   // a click already focuses the button; only the arrow keys move the focus by script (no focus ring after a mouse click)
  tabs.addEventListener('keydown', e => {
    const ids = TABS.map(x => x[0]), at = ids.indexOf(current), step = {ArrowRight: 1, ArrowLeft: -1}[e.key];
    let next = null; if (step) next = ids[(at + step + ids.length) % ids.length]; else if (e.key === 'Home') next = ids[0]; else if (e.key === 'End') next = ids[ids.length - 1];
    if (next) { e.preventDefault(); e.stopPropagation(); select(next, {focus: true}); }
  });
  paintReading();
  select('func', {save: false});
  try { void store()?.get(TAB_KEY).then(r => { const id = r?.[TAB_KEY]; if (id && panels[id] && id !== current) select(id, {save: false}); }).catch?.(() => {}); } catch {}
  paint();
  const sync = () => {
    draft = cleanOverlayTheme(get?.()?.overlayTheme);
    for (const node of [block, tabs]) for (const n of node.querySelectorAll('[data-i18n]')) { const label = t(n.dataset.i18n); if (n.textContent !== label) n.textContent = label; }
    for (const [id, b] of Object.entries(tabButtons)) b.title = b.textContent;
    tabs.setAttribute('aria-label', t('setTabsLabel'));
    for (const side of ['light', 'dark']) { sides[side].presets.setAttribute('aria-label', t('overlayPresetLabel')); for (const b of sides[side].chips) { const n = t(b.dataset.i18nTitle); b.title = n; b.setAttribute('aria-label', n); } }
    for (const g of Object.values(rdChips)) { g.group.setAttribute('aria-label', t('overlayPresetLabel')); for (const b of g.chips) { const n = t(b.dataset.i18nTitle); b.title = n; b.setAttribute('aria-label', n); } }
    paint(); paintReading(); typoPreview?._paint?.(); hideEmpty(); scheduleFit();
  };
  return {sync, select, block, tabs, panels, current: () => current};
}
