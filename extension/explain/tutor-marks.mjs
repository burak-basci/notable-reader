/* beNotable! Reader · guided explanation: the pen on the original page (own code, MIT).
   Draws per step a hand-made mark on the exact source words (circle, underline, highlighter, margin bracket), a numbered
   badge and a short handwritten margin note, animated like a pen while the explanation is spoken.
   - Words come only from rangeOf(blockId, start, end) of the session (the same text map as the word highlight); a quote
     whose DOM text is not exactly the quote is dropped, never moved to a guessed place.
   - Two layers in page coordinates (absolute at the document origin): they scroll with the page by themselves; inner
     scroll containers, zoom, resize and reflow redraw. No page node is changed, no layout shift (0x0 hosts).
   - The page stays usable: only the badges take clicks (replay of their step), everything else is pointer-events:none.
   - Colors: Paper/Green ink, marker yellow; light or dark ink chosen from the real background under each mark. */
const SVG = 'http://www.w3.org/2000/svg';
const norm = s => String(s).replace(/\s+/gu, ' ').trim();
const FONT = '"Segoe Print","Bradley Hand","Chalkboard SE","Comic Neue","Patrick Hand","Caveat","Comic Sans MS",cursive';
export const TUTOR_INK = Object.freeze({light: {pen: '#1f6b50', badge: '#256249', onBadge: '#ffffff', marker: '#f4c94c', markerOpacity: .5, blend: 'multiply', focus: '#7fc8a6', focusOpacity: .28, word: '#f4c94c', wordOpacity: .55}, dark: {pen: '#9ad8b6', badge: '#a5d3b3', onBadge: '#173020', marker: '#f4c94c', markerOpacity: .3, blend: 'normal', focus: '#9ad8b6', focusOpacity: .16, word: '#f4c94c', wordOpacity: .35}});
function seeded(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 - .5; }; }
function seedOf(text) { let n = 2166136261; for (const c of String(text)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
const f = n => n.toFixed(1);
/* Path data of one style for line rects in layer coordinates (left/top/right/bottom). Deterministic per seed. */
export function tutorPath(style, rects, seed = 1, block = null) {
  const rand = seeded(seed), w = (n = 1.6) => rand() * n, out = [];
  if (!rects.length) return out;
  if (style === 'underline') for (const r of rects) { const y = r.bottom + 1.5, x0 = r.left - 2, x1 = r.right + 2, m = (x0 + x1) / 2; out.push(`M ${f(x0)} ${f(y + w())} Q ${f((x0 + m) / 2)} ${f(y + 1.6 + w())} ${f(m)} ${f(y + w())} T ${f(x1)} ${f(y + w(1))}`); }
  else if (style === 'marker') for (const r of rects) { const cy = (r.top + r.bottom) / 2, x0 = r.left - 3, x1 = r.right + 3; out.push(`M ${f(x0)} ${f(cy + .8 + w(.8))} L ${f(x1)} ${f(cy - .8 + w(.8))}`); }
  else if (style === 'circle') {
    const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right)), top = Math.min(...rects.map(r => r.top)), bottom = Math.max(...rects.map(r => r.bottom));
    const cx = (left + right) / 2, cy = (top + bottom) / 2, rx = (right - left) / 2 + 7, ry = (bottom - top) / 2 + 5, a0 = -2.5, turns = 1.12, n = 40; let d = '';
    for (let i = 0; i <= n; i++) { const a = a0 + i / n * Math.PI * 2 * turns, grow = 1 + (i / n) * .05; d += (i ? ' L ' : 'M ') + f(cx + Math.cos(a) * rx * grow + w(1.2)) + ' ' + f(cy + Math.sin(a) * ry * grow + w(1)); }
    out.push(d);
  } else if (style === 'bracket') {
    const top = Math.min(...rects.map(r => r.top)) - 2, bottom = Math.max(...rects.map(r => r.bottom)) + 2, mid = (top + bottom) / 2;
    const left = block ? block.left : Math.min(...rects.map(r => r.left)), right = block ? block.right : Math.max(...rects.map(r => r.right));
    const side = left >= 18 ? -1 : 1, x = side < 0 ? left - 9 : right + 9, d = 6 * side;
    out.push(`M ${f(x - d * .2)} ${f(top + w())} Q ${f(x + d)} ${f(top + 1)} ${f(x + d * .9)} ${f(top + 7)} L ${f(x + d + w(.6))} ${f(mid - 5)} Q ${f(x + d * 1.1)} ${f(mid)} ${f(x + d * 1.8)} ${f(mid)} Q ${f(x + d * 1.1)} ${f(mid)} ${f(x + d + w(.6))} ${f(mid + 5)} L ${f(x + d * .9)} ${f(bottom - 7)} Q ${f(x + d)} ${f(bottom - 1)} ${f(x - d * .2)} ${f(bottom + w())}`);
  }
  return out;
}
function luminance(rgb) { const m = String(rgb).match(/[\d.]+/g); if (!m || m.length < 3) return 1; const [r, g, b] = m.slice(0, 3).map(v => { v = Number(v) / 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; }
/* Background under an element: first opaque ancestor background (dark when its luminance is low). */
export function darkUnder(el) {
  const win = el?.ownerDocument?.defaultView; if (!win) return false;
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) { const bg = win.getComputedStyle(node).backgroundColor, m = String(bg).match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > .5) && !/^transparent$/.test(bg)) return luminance(bg) < .25; }
  const root = win.getComputedStyle(el.ownerDocument.documentElement).colorScheme; return /^dark/.test(root || '') && !/light/.test(root);
}
const CSS = `:host{all:initial}.layer{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
svg{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
path{fill:none;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.badge{all:unset;box-sizing:border-box;position:absolute;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 11px/1 system-ui,sans-serif;cursor:pointer;pointer-events:auto;box-shadow:0 1px 3px #0003;transform-origin:50% 50%}
.badge:focus-visible{outline:2px solid currentColor;outline-offset:2px}.badge[data-active]{box-shadow:0 0 0 3px #f4c94c99,0 1px 3px #0003;animation:tc-pulse 1.6s ease-in-out infinite}
@keyframes tc-pulse{0%,100%{box-shadow:0 0 0 3px #f4c94c99,0 1px 3px #0003}50%{box-shadow:0 0 0 7px #f4c94c33,0 1px 3px #0003}}
@media (prefers-reduced-motion:reduce){.badge[data-active]{animation:none}}
.note{position:absolute;white-space:nowrap;font:600 15px/1.15 ${FONT};pointer-events:none;letter-spacing:.2px;transform:rotate(-2deg);transform-origin:0 50%}
@media (forced-colors:active){.badge{forced-color-adjust:none;border:1px solid CanvasText}}`;

export function createTutorMarks({document: doc = globalThis.document, rangeOf, onBadge = () => {}, badgeLabel = n => String(n), reduced = null} = {}) {
  if (typeof rangeOf !== 'function') throw Error('rangeOf fehlt.');
  const win = doc.defaultView, isReduced = () => reduced ? reduced() : !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const makeHost = (kind, blend) => { const host = doc.createElement('div'); host.setAttribute('data-reader-tutor-marks', kind); host.style.cssText = 'position:absolute!important;left:0!important;top:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:visible!important;pointer-events:none!important;z-index:2147483640!important;mix-blend-mode:' + blend + '!important;display:block!important;transform:none!important'; const shadow = host.attachShadow({mode: 'closed'}), style = doc.createElement('style'); style.textContent = CSS; const layer = doc.createElement('div'); layer.className = 'layer'; const svg = doc.createElementNS(SVG, 'svg'); svg.setAttribute('aria-hidden', 'true'); layer.append(svg); shadow.append(style, layer); doc.documentElement.append(host); return {host, layer, svg}; };
  const marker = makeHost('marker', 'multiply'), pen = makeHost('pen', 'normal');
  const steps = new Map(); let frame = 0, disposed = false, active = -1, paused = false;
  /* the passage being talked about right now (a soft band under its sentence) and the word the voice is at */
  let focus = null, word = null, focusNode = null, wordNode = null;
  const origin = () => { const r = pen.host.getBoundingClientRect(); return {x: r.left, y: r.top}; };
  /* line rects of a range in layer coordinates (merged per line, tiny/empty rects skipped) */
  function rectsOf(range) {
    const o = origin(), lines = [];
    for (const r of range.getClientRects()) { if (r.width < 1 || r.height < 1) continue; const box = {left: r.left - o.x, top: r.top - o.y, right: r.right - o.x, bottom: r.bottom - o.y}, line = lines.find(l => Math.abs(l.top - box.top) < box.bottom - box.top && Math.abs(l.bottom - box.bottom) < box.bottom - box.top); if (line) { line.left = Math.min(line.left, box.left); line.right = Math.max(line.right, box.right); line.top = Math.min(line.top, box.top); line.bottom = Math.max(line.bottom, box.bottom); } else lines.push(box); }
    return lines;
  }
  function resolve(entry) {
    const m = entry.step.mark; if (!m) return null;
    let range = null; try { range = rangeOf(entry.step.blockId, m.offset, m.offset + m.quote.length); } catch { range = null; }
    if (!range || norm(range.toString()) !== norm(m.quote)) return null;   // the page text under the offsets is not the quote: no mark
    return range;
  }
  function element(range) { let n = range.startContainer; if (n.nodeType !== 1) n = n.parentElement; return n; }
  function blockBox(el) { let n = el; while (n && n.parentElement && getComputedStyle(n).display.startsWith('inline')) n = n.parentElement; const r = n.getBoundingClientRect(), o = origin(); return {left: r.left - o.x, right: r.right - o.x}; }
  const getComputedStyle = el => win.getComputedStyle(el);
  function ink(el) { return TUTOR_INK[darkUnder(el) ? 'dark' : 'light']; }
  function animate(node, keyframes, duration, delay, entry) {
    if (isReduced() || duration <= 0 || typeof node.animate !== 'function') return null;
    const a = node.animate(keyframes, {duration, delay, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'backwards'});
    entry.animations.push(a); entry.animatedTotal = (entry.animatedTotal || 0) + 1; if (paused) a.pause(); a.finished.then(() => { entry.animations = entry.animations.filter(x => x !== a); }, () => {});
    return a;
  }
  /* (Re)builds the nodes of one step in place; `play` = with the pen animation (first appearance). */
  function render(entry, play = false, timing = null) {
    const range = resolve(entry); entry.valid = !!range;
    const old = entry.nodes; entry.nodes = []; for (const n of old) n.remove();
    if (!range || !entry.shown) { entry.geometry = null; return; }
    const lines = rectsOf(range); if (!lines.length) { entry.geometry = null; return; }
    const el = element(range), colors = ink(el), style = entry.step.mark.style, block = style === 'bracket' ? blockBox(el) : null, seed = seedOf(entry.step.blockId + entry.step.mark.quote);
    const paths = tutorPath(style, lines, seed, block), g = doc.createElementNS(SVG, 'g'); g.dataset.step = String(entry.step.index); g.dataset.style = style;
    const target = style === 'marker' ? marker : pen; let delay = timing?.markStart ?? 0; const each = (timing?.markDuration ?? 900) / Math.max(1, paths.length);
    for (const d of paths) {
      const p = doc.createElementNS(SVG, 'path'); p.setAttribute('d', d); p.setAttribute('pathLength', '1');
      if (style === 'marker') { const h = lines[0].bottom - lines[0].top; p.setAttribute('stroke', colors.marker); p.setAttribute('stroke-opacity', String(colors.markerOpacity)); p.setAttribute('stroke-width', String(Math.max(6, h * .82))); p.setAttribute('stroke-linecap', 'butt'); }
      else { p.setAttribute('stroke', colors.pen); p.setAttribute('stroke-width', style === 'circle' ? '2.2' : '2'); p.setAttribute('stroke-opacity', '.92'); }
      p.style.strokeDasharray = '1 1'; g.append(p);
      if (play) animate(p, [{strokeDashoffset: 1}, {strokeDashoffset: 0}], each, delay, entry); delay += each;
    }
    target.svg.append(g); entry.nodes.push(g);
    marker.host.style.setProperty('mix-blend-mode', colors.blend, 'important');
    const first = lines[0], x = Math.max(2, first.left - 13), y = Math.max(2, first.top - 15);
    const badge = doc.createElement('button'); badge.type = 'button'; badge.className = 'badge'; badge.textContent = String(entry.step.index + 1); badge.dataset.step = String(entry.step.index); badge.setAttribute('aria-label', badgeLabel(entry.step.index + 1)); badge.title = badgeLabel(entry.step.index + 1);
    badge.style.left = x + 'px'; badge.style.top = y + 'px'; badge.style.background = colors.badge; badge.style.color = colors.onBadge; if (entry.step.index === active) badge.dataset.active = '';
    badge.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); onBadge(entry.step.index); });
    badge.addEventListener('pointerdown', event => event.stopPropagation());
    pen.layer.append(badge); entry.nodes.push(badge);
    if (play) animate(badge, [{transform: 'scale(0)', opacity: 0}, {transform: 'scale(1)', opacity: 1}], 220, timing?.markStart ?? 0, entry);
    let noteBox = null, noteSide = '';
    if (entry.step.note) {
      const note = doc.createElement('span'); note.className = 'note'; note.textContent = entry.step.note; note.style.color = colors.pen; note.dataset.step = String(entry.step.index); pen.layer.append(note);
      /* the note goes in the margin beside the text block, inside the visible width of the page; with no margin wide
         enough (narrow window, wide text) it stays in the card at the bar only, so it never covers text or leaves the view */
      const nw = Math.ceil(note.getBoundingClientRect().width || entry.step.note.length * 8) + 4, nh = 18, box = blockBox(el), o = origin(), viewLeft = -o.x + 6, viewRight = -o.x + doc.documentElement.clientWidth - 6;
      let nx = null, side = '';
      if (box.right + 14 + nw <= viewRight) { nx = box.right + 14; side = 'right'; }
      else if (box.left - 14 - nw >= viewLeft && style !== 'bracket') { nx = box.left - 14 - nw; side = 'left'; }
      noteSide = side || 'card';
      if (!side) note.remove();
      else {
        const ny = first.top - 2; note.style.left = nx + 'px'; note.style.top = ny + 'px'; noteBox = {left: nx, top: ny, right: nx + nw, bottom: ny + nh, side};
        entry.nodes.push(note);
        const link = doc.createElementNS(SVG, 'path'), lg = doc.createElementNS(SVG, 'g'); lg.dataset.step = String(entry.step.index); lg.dataset.style = 'note';
        /* a short connector in the margin at the height of the marked line (beside the text block, never through it) */
        const anchorX = side === 'left' ? box.left - 4 : box.right + 4, anchorY = (first.top + first.bottom) / 2, fromX = side === 'left' ? nx + nw + 2 : nx - 3, fromY = ny + nh / 2;
        link.setAttribute('d', `M ${f(fromX)} ${f(fromY)} Q ${f((fromX + anchorX) / 2)} ${f(Math.min(fromY, anchorY) - 4)} ${f(anchorX)} ${f(anchorY)}`); link.setAttribute('pathLength', '1'); link.setAttribute('stroke', colors.pen); link.setAttribute('stroke-width', '1.4'); link.setAttribute('stroke-opacity', '.75'); link.style.strokeDasharray = '1 1'; lg.append(link); pen.svg.append(lg); entry.nodes.push(lg);
        if (play) { const start = timing?.noteStart ?? 900, dur = timing?.noteDuration ?? 600; animate(link, [{strokeDashoffset: 1}, {strokeDashoffset: 0}], Math.round(dur * .4), start, entry); animate(note, [{clipPath: 'inset(0 100% 0 0)'}, {clipPath: 'inset(0 0 0 0)'}], dur, start + Math.round(dur * .3), entry); }
      }
    }
    const all = [...lines]; if (noteBox) all.push(noteBox);
    entry.geometry = {ink: colors === TUTOR_INK.dark ? 'dark' : 'light', lines, paths, style, note: noteBox, noteSide, badge: {left: x, top: y, right: x + 20, bottom: y + 20}, bounds: {left: Math.min(...all.map(r => r.left)), top: Math.min(...all.map(r => r.top)), right: Math.max(...all.map(r => r.right)), bottom: Math.max(...all.map(r => r.bottom))}};
  }
  /* soft rounded bands under the lines of a range, in the marker layer (multiply on light pages: the text stays readable) */
  function band(spec, color, opacity, kind) {
    if (!spec) return null; let range = null; try { range = rangeOf(spec.blockId, spec.start, spec.end); } catch { range = null; }
    if (!range) return null; const lines = rectsOf(range); if (!lines.length) return null;
    const g = doc.createElementNS(SVG, 'g'); g.dataset.style = kind;
    for (const l of lines) { const r = doc.createElementNS(SVG, 'rect'); r.setAttribute('x', f(l.left - 3)); r.setAttribute('y', f(l.top - 1)); r.setAttribute('width', f(l.right - l.left + 6)); r.setAttribute('height', f(l.bottom - l.top + 2)); r.setAttribute('rx', '4'); r.setAttribute('fill', color); r.setAttribute('fill-opacity', String(opacity)); g.append(r); }
    marker.svg.prepend(g); return {node: g, lines};
  }
  function drawFocus() {
    focusNode?.node.remove(); wordNode?.node.remove(); focusNode = wordNode = null; if (disposed) return;
    let el = null; try { const r = focus && rangeOf(focus.blockId, focus.start, focus.end); el = r ? element(r) : null; } catch { el = null; }
    const colors = el ? ink(el) : TUTOR_INK.light;
    focusNode = band(focus, colors.focus, colors.focusOpacity, 'focus'); wordNode = band(word, colors.word, colors.wordOpacity, 'word');
  }
  /* geometry follows the page; running pen animations restart at their elapsed time, finished ones stay finished */
  /* geometry follows the page; a pen still drawing is rebuilt at the same moment of its animation */
  function redraw() {
    frame = 0; if (disposed) return; try { drawFocus(); } catch {}
    for (const entry of steps.values()) {
      if (!entry.shown) continue;
      try {
        const live = entry.animations.some(a => a.playState === 'running' || a.playState === 'paused');
        if (!live) { render(entry, false); continue; }
        const elapsed = Math.max(0, ...entry.animations.map(a => Number(a.currentTime) || 0));   // animation time, so a paused pen stays where it was
        for (const a of entry.animations) a.cancel(); entry.animations = [];
        render(entry, true, entry.timing);
        for (const a of entry.animations) a.currentTime = Math.max(0, elapsed);
      } catch (error) { console.error('beNotable! Reader: mark redraw failed', error); }
    }
  }
  const schedule = () => { if (!frame && !disposed) frame = win.requestAnimationFrame(redraw); };
  const onScroll = event => { if (event.target === doc || event.target === doc.documentElement || event.target === doc.body) return; schedule(); };
  doc.addEventListener('scroll', onScroll, {capture: true, passive: true}); win.addEventListener('resize', schedule); win.visualViewport?.addEventListener('resize', schedule); const dpr = win.matchMedia?.(`(resolution: ${win.devicePixelRatio}dppx)`); const onDpr = () => schedule(); dpr?.addEventListener?.('change', onDpr);
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null; resizeObserver?.observe(doc.documentElement);
  const observer = new MutationObserver(records => { if (records.some(r => ![marker.host, pen.host].some(h => h === r.target || h.contains(r.target)))) schedule(); });
  observer.observe(doc.body || doc.documentElement, {childList: true, characterData: true, subtree: true});
  return {
    /* registers a step (not shown yet); false when its quote is not exactly on the page (the step keeps its words, no mark) */
    add(step) { if (disposed || !step || !Number.isInteger(step.index)) return false; const entry = {step, nodes: [], animations: [], shown: false, valid: false, geometry: null}; steps.set(step.index, entry); entry.valid = !!resolve(entry); return entry.valid; },
    has(index) { return !!steps.get(index)?.valid; },
    /* shows one step with the pen (timing from planTiming); again = redraw from scratch (replay) */
    draw(index, timing = null) { const entry = steps.get(index); if (!entry || disposed) return false; for (const a of entry.animations) a.cancel(); entry.animations = []; entry.shown = true; entry.timing = timing; entry.drawnAt = performance.now(); render(entry, true, timing); return !!entry.geometry; },
    /* measures every shown mark again now (zoom, font load, a layout change the observers did not report) */
    refresh() { if (frame) { win.cancelAnimationFrame(frame); frame = 0; } redraw(); },
    /* rectangle of a step in viewport coordinates (scroll target), or null */
    rect(index) { const entry = steps.get(index), range = entry ? resolve(entry) : null; return range ? range.getBoundingClientRect() : null; },
    setActive(index) { active = index; for (const b of pen.layer.querySelectorAll('.badge')) b.toggleAttribute('data-active', Number(b.dataset.step) === index); },
    /* the passage of the current step ({blockId, start, end} of its sentence, null = none) and the spoken word in it */
    setFocus(spec) { focus = spec || null; word = null; drawFocus(); },
    setWord(spec) { const same = word && spec && word.blockId === spec.blockId && word.start === spec.start && word.end === spec.end; if (same || !word && !spec) return; word = spec || null; drawFocus(); },
    focusGeometry() { const o = origin(); return {origin: o, focus: focusNode?.lines || null, word: wordNode?.lines || null}; },
    pause() { paused = true; for (const e of steps.values()) for (const a of e.animations) a.pause(); },
    resume() { paused = false; for (const e of steps.values()) for (const a of e.animations) a.play(); },
    hide(index) { const entry = steps.get(index); if (!entry) return; entry.shown = false; render(entry); },
    clear() { for (const e of steps.values()) { for (const a of e.animations) a.cancel(); for (const n of e.nodes) n.remove(); } steps.clear(); active = -1; focus = word = null; drawFocus(); },
    dispose() { if (disposed) return; this.clear(); disposed = true; observer.disconnect(); resizeObserver?.disconnect(); doc.removeEventListener('scroll', onScroll, {capture: true}); win.removeEventListener('resize', schedule); win.visualViewport?.removeEventListener('resize', schedule); dpr?.removeEventListener?.('change', onDpr); if (frame) win.cancelAnimationFrame(frame); marker.host.remove(); pen.host.remove(); },
    /* for tests and the export: geometry of every shown step in layer coordinates plus the layer origin */
    snapshot() { const o = origin(); return {origin: o, scroll: {x: win.scrollX, y: win.scrollY}, steps: [...steps.values()].filter(e => e.shown && e.geometry).map(e => ({index: e.step.index, style: e.geometry.style, lines: e.geometry.lines, paths: e.geometry.paths, note: e.geometry.note, noteSide: e.geometry.noteSide, noteText: e.step.note, badge: e.geometry.badge, bounds: e.geometry.bounds, quote: e.step.mark.quote, ink: e.geometry.ink, animated: e.animatedTotal || 0}))}; },
    get count() { return [...steps.values()].filter(e => e.shown && e.geometry).length; },
    get disposed() { return disposed; },
  };
}
