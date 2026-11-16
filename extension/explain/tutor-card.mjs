/* beNotable! Reader · guided explanation ("Zusammenfassen"): the panel at the reader bar (own code, MIT).
   Same kind of non-modal panel as the voice card (above or below the bar, never wider than it, drawn from a view
   object). While the tour runs it is a slim subtitle line (layout "subtitle", at most 64 px): the step counter "3/9",
   only the sentence (or part) being spoken, one quiet line under it (AI notice, paused, step label), a menu button with
   the options (scope, depth, language, "Explain in English (AI)", study sheet, remove marks) and X; at the end one line
   with two or three buttons. The eye stays on the page, where pen, passage band and word mark show what is meant.
   Model offer, download progress, error with Retry stay a compact card.
   Built with DOM calls only (no innerHTML: pages with Trusted Types stay intact). It lives in the bar's shadow root and
   uses the bar's color tokens, so light/dark/custom overlay themes apply by themselves. */
const SVG = 'http://www.w3.org/2000/svg';
/* Lucide icons (ISC): highlighter, x, chevron-down */
const ICONS = {highlighter: ['m9 11-6 6v3h9l3-3', 'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'], x: ['M18 6 6 18', 'm6 6 12 12'], options: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
  download: ['M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5'], eraser: ['M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21', 'm5.082 11.09 8.828 8.828']};
/* secondary actions of the end line carry an icon: there they show the icon only (label as title and accessible name) */
const ACTION_ICONS = {export: 'download', clear: 'eraser'};
export function lucide(doc, name, size = 16) {
  const svg = doc.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  for (const d of ICONS[name] || []) { const p = doc.createElementNS(SVG, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
const CSS = `.tutor-card{position:fixed;z-index:7;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:10px 12px 12px;background:var(--reader-paper);color:var(--reader-ink);border:1px solid var(--reader-line);border-radius:11px;box-shadow:var(--reader-shadow);font-size:12px;line-height:1.4;pointer-events:auto;cursor:default}
.tutor-card[hidden],.bar:has(.voice-menu[data-open],.settings-panel[data-open],.reader-error:not([hidden])) .tutor-card{display:none}
.tc-head{display:flex;align-items:center;gap:6px;min-width:0}.tc-head>svg{flex:none;color:var(--reader-accent)}
.tc-title{flex:1 1 auto;min-width:0;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-icon{display:flex;align-items:center;justify-content:center;flex:none;width:26px;min-height:26px;padding:0;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--reader-muted);cursor:pointer}
.tc-icon:hover{border-color:var(--reader-muted)}.tc-icon[aria-expanded=true]{color:var(--reader-accent);border-color:var(--reader-line)}
.tc-text{margin:0;font-size:13px;line-height:1.45;max-height:7.4em;overflow-y:auto;overscroll-behavior:contain}
.tc-text:empty{display:none}.tc-note{align-self:flex-start;margin:0;padding:1px 8px;border-radius:999px;background:var(--reader-soft);color:var(--reader-accent);font-size:11px;font-weight:600}
.tc-note:empty{display:none}.tc-hint{margin:0;font-size:11px;color:var(--reader-muted)}.tc-hint:empty{display:none}.tc-ai{margin:0;font-size:10.5px;color:var(--reader-muted);opacity:.85}.tc-ai:empty{display:none}
.tc-points{margin:0;padding:0 0 0 18px;font-size:12px}.tc-points:empty{display:none}.tc-points li{margin:2px 0}
.tc-actions{display:flex;flex-wrap:wrap;gap:6px}.tc-actions:empty{display:none}
.tc-actions button,.tc-options button,.tc-options select{min-height:28px;padding:3px 10px;font:inherit;font-size:12px;color:var(--reader-ink);background:var(--reader-paper);border:1px solid var(--reader-line);border-radius:7px;cursor:pointer}
.tc-actions button:hover,.tc-options button:hover{border-color:var(--reader-muted)}
.tc-actions .tc-primary{background:var(--reader-accent);border-color:var(--reader-accent);color:var(--reader-on-accent);font-weight:600}
.tc-actions button:focus-visible,.tc-options :is(button,select):focus-visible,.tc-icon:focus-visible{outline:2px solid var(--reader-accent);outline-offset:2px}
.tc-options{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}.tc-options[hidden]{display:none}
.tc-seg{display:inline-flex;gap:0}.tc-seg button{border-radius:0;margin-left:-1px}.tc-seg button:first-child{border-radius:7px 0 0 7px;margin-left:0}.tc-seg button:last-child{border-radius:0 7px 7px 0}
.tc-seg button[aria-pressed=true]{background:var(--reader-soft);border-color:var(--reader-accent);color:var(--reader-accent);position:relative;z-index:1}
.tc-seg button[hidden]{display:none}
.tc-meter{display:block;box-sizing:border-box;width:100%;height:4px;margin:0;border:0;border-radius:2px;overflow:hidden;-webkit-appearance:none;appearance:none;background:var(--reader-line)}
.tc-meter::-webkit-progress-bar{background:transparent}.tc-meter::-webkit-progress-value{background:var(--reader-accent)}.tc-meter::-moz-progress-bar{background:var(--reader-accent)}
.tc-meter:indeterminate{background:linear-gradient(90deg,var(--reader-line) 0 30%,var(--reader-accent) 30% 55%,var(--reader-line) 55%) 0 0/200% 100%;animation:tc-busy 1.2s linear infinite}
.tc-meter:indeterminate::-webkit-progress-bar{background:transparent}.tc-meter[hidden]{display:none}
@keyframes tc-busy{to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.tc-meter:indeterminate{animation:none}}
.tc-step,.tc-sub,.tc-meta,.tc-menu-text,.tc-menu-actions{display:none}
.tutor-card[data-layout=subtitle]{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;grid-template-areas:"step sub menu close" "step meta menu close";align-items:center;column-gap:8px;row-gap:1px;padding:5px 6px 5px 10px;max-height:64px;overflow:visible}
.tutor-card[data-layout=subtitle][hidden]{display:none}
.tutor-card[data-layout=subtitle] .tc-head{display:contents}.tutor-card[data-layout=subtitle] .tc-head>svg,.tutor-card[data-layout=subtitle] .tc-title{display:none}
.tutor-card[data-layout=subtitle] .tc-options-toggle{grid-area:menu}.tutor-card[data-layout=subtitle] .tc-close{grid-area:close}
.tutor-card[data-layout=subtitle] :is(.tc-text,.tc-note,.tc-points,.tc-meter,.tc-hint,.tc-ai){display:none}
.tutor-card[data-layout=subtitle] .tc-step{display:block;grid-area:step;align-self:center;min-width:28px;font-size:11px;font-weight:700;color:var(--reader-accent);font-variant-numeric:tabular-nums;white-space:nowrap}
.tutor-card[data-layout=subtitle] .tc-sub{display:-webkit-box;grid-area:sub;margin:0;font-size:13px;line-height:17px;max-height:34px;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-clamp:2}
.tutor-card[data-layout=subtitle] .tc-meta{display:block;grid-area:meta;margin:0;font-size:10.5px;line-height:13px;color:var(--reader-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tutor-card[data-layout=subtitle] .tc-meta:empty{display:none}
.tutor-card[data-layout=subtitle][data-mode=ended] .tc-actions{grid-area:meta;display:flex;flex-wrap:nowrap;gap:6px;overflow:hidden}
.tutor-card[data-layout=subtitle][data-mode=ended] .tc-actions button{min-height:24px;padding:2px 9px;font-size:11.5px;white-space:nowrap}
.tutor-card button.tc-act-icon{display:inline-flex;align-items:center;gap:5px}.tutor-card button.tc-act-icon>svg{flex:none}
.tutor-card[data-layout=subtitle][data-mode=ended] .tc-actions button.tc-act-icon{width:28px;padding:0;justify-content:center}
.tutor-card[data-layout=subtitle][data-mode=ended] .tc-actions button.tc-act-icon>.tc-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.tutor-card[data-layout=subtitle][data-mode=ended] .tc-step{display:none}.tutor-card[data-layout=subtitle][data-mode=ended]{grid-template-columns:0 minmax(0,1fr) auto auto;column-gap:0}.tutor-card[data-layout=subtitle][data-mode=ended] :is(.tc-options-toggle,.tc-close){margin-left:8px}
.tutor-card[data-layout=subtitle]:not([data-mode=ended]) .tc-actions{display:none}
.tutor-card[data-layout=subtitle][data-mode=ended] .tc-sub{-webkit-line-clamp:1;line-clamp:1;max-height:17px;font-weight:600;font-size:12px}
.tutor-card[data-layout=subtitle] .tc-options{position:absolute;left:0;right:0;bottom:calc(100% + 6px);flex-direction:column;align-items:stretch;gap:6px;padding:10px 12px;background:var(--reader-paper);color:var(--reader-ink);border:1px solid var(--reader-line);border-radius:11px;box-shadow:var(--reader-shadow)}
.tutor-card[data-layout=subtitle]:not([data-above]) .tc-options{bottom:auto;top:calc(100% + 6px)}
.tc-options>.tc-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}.tutor-card[data-layout=subtitle] .tc-options>.tc-row{gap:6px 8px}
.tutor-card[data-layout=subtitle] .tc-menu-text{display:block;margin:0;font-size:11.5px;color:var(--reader-muted)}.tutor-card[data-layout=subtitle] .tc-menu-text:empty{display:none}
.tutor-card[data-layout=subtitle] .tc-menu-actions{display:flex;flex-wrap:wrap;gap:6px}.tutor-card[data-layout=subtitle] .tc-menu-actions:empty{display:none}
.tc-menu-actions button{min-height:28px;padding:3px 10px;font:inherit;font-size:12px;color:var(--reader-ink);background:var(--reader-paper);border:1px solid var(--reader-line);border-radius:7px;cursor:pointer}.tc-menu-actions button:hover{border-color:var(--reader-muted)}
.tc-menu-actions .tc-primary{background:var(--reader-accent);border-color:var(--reader-accent);color:var(--reader-on-accent);font-weight:600}
.tc-segments{position:absolute;pointer-events:none;height:12px}.tc-segments>i{position:absolute;top:0;width:2px;height:100%;margin-left:-1px;background:var(--reader-paper);border-radius:1px}
.reader-timeline:has(.tc-segments){position:relative}`;

/* mountTutorCard(shadow, {t, onAction}) -> {render(view), place(), destroy()}; onAction(name, value, trusted) (trusted = a real user click). */
export function mountTutorCard(shadow, {t = k => k, onAction = () => {}} = {}) {
  const doc = shadow.ownerDocument || document, bar = shadow.querySelector('.bar'), el = (tag, cls) => { const n = doc.createElement(tag); if (cls) n.className = cls; return n; };
  const style = el('style'); style.textContent = CSS; shadow.append(style);
  const card = el('div', 'tutor-card'); card.hidden = true; card.setAttribute('aria-modal', 'false'); card.setAttribute('role', 'dialog'); card.id = 'reader-tutor-card';
  const head = el('div', 'tc-head'), title = el('strong', 'tc-title'), optionsButton = el('button', 'tc-icon tc-options-toggle'), close = el('button', 'tc-icon tc-close');
  title.id = 'reader-tutor-title'; card.setAttribute('aria-labelledby', title.id); optionsButton.type = close.type = 'button'; optionsButton.append(lucide(doc, 'options')); close.append(lucide(doc, 'x')); optionsButton.setAttribute('aria-expanded', 'false');
  head.append(lucide(doc, 'highlighter', 16), title, optionsButton, close);
  const text = el('p', 'tc-text'); text.setAttribute('aria-live', 'polite'); const note = el('p', 'tc-note'), points = el('ol', 'tc-points'), hint = el('p', 'tc-hint'), ai = el('p', 'tc-ai'), meter = el('progress', 'tc-meter'); meter.max = 100; meter.setAttribute('aria-hidden', 'true');
  const options = el('div', 'tc-options'); options.hidden = true;
  const counter = el('span', 'tc-step'), sub = el('p', 'tc-sub'), meta = el('p', 'tc-meta'), menuText = el('p', 'tc-menu-text'), menuActions = el('div', 'tc-menu-actions'), optionRow = el('div', 'tc-row');
  sub.setAttribute('aria-live', 'polite');
  const seg = (name, values) => { const g = el('span', 'tc-seg'); g.setAttribute('role', 'group'); g.dataset.option = name; for (const v of values) { const b = el('button'); b.type = 'button'; b.dataset.value = v; b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', () => onAction('option', {name, value: v})); g.append(b); } return g; };
  /* scope and language: the same choices as the settings panel (stored values; ui/page name the language they stand for) */
  const scope = el('select', 'tc-scope'), depth = seg('depth', ['short', 'long']), lang = el('select', 'tc-language');
  scope.addEventListener('change', () => onAction('option', {name: 'scope', value: scope.value}));
  lang.addEventListener('change', () => onAction('option', {name: 'language', value: lang.value}));
  const fillSelect = (select, entries, value) => { const sig = JSON.stringify(entries); if (select.dataset.sig !== sig) { select.dataset.sig = sig; select.replaceChildren(...entries.map(([v, label]) => { const o = el('option'); o.value = v; o.textContent = label; return o; })); } if (doc.activeElement !== select && select.getRootNode().activeElement !== select) select.value = value; };
  const languageName = code => { try { const n = new Intl.DisplayNames([code], {type: 'language'}).of(code); return n.charAt(0).toLocaleUpperCase(code) + n.slice(1); } catch { return code.toUpperCase(); } };
  const remove = el('button', 'tc-remove'); remove.type = 'button'; remove.hidden = true; remove.addEventListener('click', event => onAction('remove', remove.dataset.tier, event.isTrusted));
  optionRow.append(scope, depth, lang, remove); options.append(menuText, optionRow, menuActions);
  const actions = el('div', 'tc-actions');
  card.append(head, counter, sub, meta, options, text, note, points, meter, hint, ai, actions); bar.append(card);
  optionsButton.addEventListener('click', () => { options.hidden = !options.hidden; optionsButton.setAttribute('aria-expanded', String(!options.hidden)); place(); });
  close.addEventListener('click', () => onAction('close'));
  card.addEventListener('pointerdown', event => event.stopPropagation()); card.addEventListener('wheel', event => event.stopPropagation(), {passive: true});
  card.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onAction('close'); } });
  let shown = '', returnFocus = null, timer = 0;
  function place() {
    if (card.hidden) return;
    const r = bar.getBoundingClientRect(), w = Math.max(0, Math.min(r.width, innerWidth - 24)), gap = 6; card.style.width = w + 'px';
    const voice = shadow.querySelector('.voice-card:not([hidden])'), vr = voice && getComputedStyle(voice).display !== 'none' ? voice.getBoundingClientRect() : null;
    const h = card.getBoundingClientRect().height, above = r.top - gap - 12 - (vr && vr.bottom <= r.top ? vr.height + gap : 0), below = innerHeight - r.bottom - gap - 12 - (vr && vr.top >= r.bottom ? vr.height + gap : 0);
    const up = bar.hasAttribute('data-expand-above') ? above >= h || above >= below : below < h && above > below;
    card.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left)) + 'px';
    const top = up ? Math.max(6, (vr && vr.bottom <= r.top ? vr.top : r.top) - h - gap) : (vr && vr.top >= r.bottom ? vr.bottom : r.bottom) + gap;
    card.style.top = Math.min(top, Math.max(6, innerHeight - h - 6)) + 'px'; card.toggleAttribute('data-above', up);
  }
  const button = (key, action, value, primary = false) => { const b = el('button', primary ? 'tc-primary' : ''); b.type = 'button'; const label = t(key, value?.params || {}); b.dataset.action = action;
    if (ACTION_ICONS[action]) { const span = el('span', 'tc-label'); span.textContent = label; b.classList.add('tc-act-icon'); b.title = label; b.setAttribute('aria-label', label); b.append(lucide(doc, ACTION_ICONS[action], 15), span); } else b.textContent = label; b.addEventListener('click', event => onAction(action, value?.value, event.isTrusted)); return b; };
  /* buttons are rebuilt only when they change (the subtitle line renders twice a second: a focused button stays focused) */
  const fill = (box, list) => { const sig = JSON.stringify(list || []) + '|' + t('tutor_title'); if (box.dataset.sig === sig) return; box.dataset.sig = sig; box.replaceChildren(...(list || []).map(([key, action, value, primary]) => button(key, action, value, primary))); };
  /* the tour's steps as segments on the bar's timeline (the timeline itself shows the tour's progress while it runs) */
  function segments(list) {
    const line = shadow.querySelector('.reader-timeline'), range = line?.querySelector('.seek-progress'); let box = line?.querySelector('.tc-segments');
    if (!list?.length || !range) { box?.remove(); return; }
    if (!box) { box = el('div', 'tc-segments'); box.setAttribute('aria-hidden', 'true'); line.append(box); }
    const lr = line.getBoundingClientRect(), rr = range.getBoundingClientRect(); box.style.left = (rr.left - lr.left + 8) + 'px'; box.style.width = Math.max(0, rr.width - 16) + 'px'; box.style.top = (rr.top - lr.top + rr.height / 2 - 6) + 'px';
    const sig = list.map(x => x.toFixed(4)).join(','); if (box.dataset.sig === sig) return; box.dataset.sig = sig;
    box.replaceChildren(...list.map(x => { const i = el('i'); i.style.left = (x * 100).toFixed(3) + '%'; return i; }));
  }
  /* view: {mode, title, text, note, hint, ai (AI explanation shown: the quiet notice), points[], progress (0..100 | null = busy | undefined = none), actions:[[key, action, value, primary]], options:{scope, depth, language, selection}} */
  function render(view) {
    if (!view || !view.mode) { const wasInside = card.contains(shadow.activeElement); card.hidden = true; shown = ''; clearInterval(timer); timer = 0; if (wasInside) (returnFocus?.isConnected ? returnFocus : shadow.querySelector('.explain-toggle,.primary'))?.focus({preventScroll: true}); returnFocus = null; return; }
    card.hidden = false; card.dataset.mode = view.mode; title.textContent = view.title || '';
    if (view.layout === 'subtitle') card.dataset.layout = 'subtitle'; else delete card.dataset.layout;
    counter.textContent = view.counter || ''; if (sub.textContent !== (view.sub || '')) sub.textContent = view.sub || ''; meta.textContent = view.meta || ''; meta.title = view.metaTitle || view.meta || '';
    menuText.textContent = view.menu?.text || ''; fill(menuActions, view.menu?.actions);
    if (text.textContent !== (view.text || '')) text.textContent = view.text || '';
    note.textContent = view.note || ''; hint.textContent = view.hint || ''; ai.textContent = view.ai ? t('tutor_ai_disclaimer') : '';   // every AI explanation says so, quietly
    const pointsSig = JSON.stringify(view.points || []); if (points.dataset.sig !== pointsSig) { points.dataset.sig = pointsSig; points.replaceChildren(...(view.points || []).map(p => { const li = el('li'); li.textContent = p; return li; })); }
    meter.hidden = view.progress === undefined; if (view.progress === null) meter.removeAttribute('value'); else if (Number.isFinite(view.progress)) meter.value = Math.max(0, Math.min(100, view.progress));
    fill(actions, view.actions);
    const label = (n, k) => { n.title = t(k); n.setAttribute('aria-label', t(k)); }; label(optionsButton, 'tutor_options'); label(close, view.mode === 'running' || view.mode === 'preparing' ? 'tutor_cancel' : view.closeKey || 'tutor_close');
    const o = view.options || {}; optionsButton.hidden = !view.options;
    for (const b of depth.children) { b.setAttribute('aria-pressed', String(b.dataset.value === o.depth)); b.textContent = t('tutor_depth_' + b.dataset.value); }
    fillSelect(scope, [['auto', t('explainScopeAuto')], ['page', t('tutor_scope_page')], ['here', t('tutor_scope_here')]], o.scope || 'auto'); label(scope, 'explainScopeLabel');
    fillSelect(lang, [['ui', t('explainLanguageUi') + ' (' + String(o.ui || '').toUpperCase() + ')'], ['page', t('explainLanguagePage') + ' (' + String(o.page || '').toUpperCase() + ')'], ...['de', 'en', 'fr', 'es', 'it', 'pt'].map(c => [c, languageName(c)])], o.language || 'page');
    remove.hidden = !o.removable; if (o.removable) { remove.dataset.tier = o.removable.tier; remove.textContent = t('tutor_remove_model', {mb: o.removable.mb}); } label(lang, 'tutor_language');
    const key = view.mode + '|' + (view.step ?? '');
    if (key !== shown) { const first = !shown; shown = key; if (first) { const active = shadow.activeElement; if (active && !card.contains(active)) returnFocus = active; } if (first && view.mode === 'offer' && shadow.activeElement) (actions.querySelector('.tc-primary') || close).focus({preventScroll: true}); }   // focus moves in only from inside the bar, never from the page
    if (!timer) timer = setInterval(place, 250);   // the bar can be dragged; the card follows it
    place();
  }
  const onResize = () => place(); addEventListener('resize', onResize);
  return {render, place, card, segments, destroy() { clearInterval(timer); removeEventListener('resize', onResize); segments(null); card.remove(); style.remove(); }};
}
