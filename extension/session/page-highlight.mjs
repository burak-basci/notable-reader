/* beNotable! Reader session · word highlight, follow scrolling and click mapping on the page itself (own code, MIT).
   No page text is changed: the fill uses the CSS Custom Highlight API (adopted stylesheet), the 1.6.24 frame and the section corner marks are drawn on an own fixed overlay
   (pointer-events none, outside the page flow). Three settings: markWord (off | subtle | normal | strong), markTint (section tint on/off) and markCorners (section corner marks on/off),
   independent of each other. The section is drawn from the exact character range of the spoken section (first to last word): one box per line fragment, the first line starting at the
   first word, the last line ending at the last word (never the line/block edge).
   Exactly one owner (follow controller) scrolls. */
import {createFollowController} from '../playback/follow.js';
import {isPlainClick} from '../playback/click-seek.js';
import {wordOffsets} from '../playback/timeline.js';
import {createRangeMapper} from './text-map.mjs';
import {STYLE_DEFAULTS, cleanStyle, styleKey, isDefaultStyle, wordHighlightCss, overlayCss, measureContext} from './mark-style.mjs';

const MARK_MODES = ['off', 'subtle', 'normal', 'strong'], MARK_DEFAULTS = Object.freeze({word: 'normal', tint: true, corners: true, style: STYLE_DEFAULTS});
const pick = (v, d) => MARK_MODES.includes(v) ? v : d, flag = (v, d) => typeof v === 'boolean' ? v : d;
/* Colors: ALL of them come from mark-style.mjs (the same functions draw the settings preview). With the default style they are the 1.6.24 palette: normal = #ffec95, strong = #ffbf00 with a 2 px dark frame, subtle =
   faint yellow wash + 2 px underline, dark text on both filled levels (>= 4.5:1 on light AND dark pages). A custom color / strength picks its text color itself (black or white, whichever reads better on the page).
   Geometry contract: the word fill and the section block share ONE horizontal inset, so the corner marks end exactly on the edge of the first/last word's fill.
   .block = padded box around the section (tint), .corner = L-marks drawn ON its outer edge, .frame = 1 px line OUTSIDE the padded word fill, .pad = the fill's inset strips (the ::highlight fill itself has no padding). */
export const padX = h => Math.max(2, Math.min(3, Math.round(h * .15))), BLOCK_PAD_Y = 1;

export function createPageHighlight({doc = document, chunks, blocks, textNodes, onSeek, onUserScroll, marks = MARK_DEFAULTS}) {
  const win = doc.defaultView, mappers = new Map();
  let offsets = chunks.map(c => wordOffsets(c.text, c.words));
  const supported = typeof win.Highlight === 'function' && !!win.CSS?.highlights;
  let enabled = true;
  let sheet = null, current = null, clickSeek = true, disposed = false, mode = {word: pick(marks?.word, MARK_DEFAULTS.word), tint: flag(marks?.tint, MARK_DEFAULTS.tint), corners: flag(marks?.corners, MARK_DEFAULTS.corners), style: cleanStyle(marks?.style)};
  let wordRng = null, chunkRng = null, parts = [], rtl = false, host = null, layer = null, frame = 0, ownHighlight = null;
  /* ONE mark layer per page: every layer host carries its owner; a host of another owner (an orphaned content script of a reloaded/updated extension lives on in its own
     isolated world and shares only the DOM, or a stale host of an older version without an owner) is removed before this session draws. */
  const owner = Math.random().toString(36).slice(2) + Date.now().toString(36), HOST = '[data-notable-reader-ui="highlight"]';
  const evictForeign = () => { for (const n of doc.querySelectorAll(HOST)) if (n !== host && n.dataset.notableOwner !== owner) n.remove(); };
  /* page colors the custom mark colors depend on (only measured for a custom style: the default palette is fixed and needs no page) */
  let ctx = {}, ctxAt = 0, styleEl = null;
  const pageCtx = (force = false) => { if (isDefaultStyle(mode.style)) return (ctx = {}); const now = Date.now(); if (force || now - ctxAt > 400) { ctx = measureContext(doc); ctxAt = now; } return ctx; };
  const sheetText = () => wordHighlightCss(mode.word, mode.style, pageCtx(true));
  if (supported) {
    try { sheet = new win.CSSStyleSheet(); sheet.replaceSync(sheetText()); doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]; } catch { sheet = null; }
  }
  let adoptedRoots=new Set([doc]),textRoots=null;
  // The trees holding the text change only with update(): they are collected once, not per word over every
  // text node. Per word only these few roots are checked, so a page that rewrites its adoptedStyleSheets gets
  // the sheet back.
  const collectRoots=()=>{
    const roots=new Set([doc]);
    for(const nodes of textNodes)for(const node of nodes){const root=node.getRootNode();if(root?.host)roots.add(root);}
    return roots;
  };
  const syncRoots=()=>{
    const roots=textRoots??=collectRoots();
    for(const root of adoptedRoots)if(!roots.has(root)){
      try{root.adoptedStyleSheets=root.adoptedStyleSheets.filter(s=>s!==sheet);}catch{}
    }
    for(const root of roots)if(sheet&&!root.adoptedStyleSheets.includes(sheet)){
      try{root.adoptedStyleSheets=[...root.adoptedStyleSheets,sheet];}catch{}
    }
    adoptedRoots=roots;
  };
  /* -- overlay: word frame / underline and section corner marks, repositioned from live range rects -- */
  function ensureLayer() {
    if (layer && host.isConnected) return layer;
    host = doc.createElement('div'); host.setAttribute('data-notable-reader-ui', 'highlight'); host.setAttribute('aria-hidden', 'true'); host.dataset.notableOwner = owner;
    const root = host.attachShadow({mode: 'open'}), style = doc.createElement('style'); style.textContent = overlayCss(mode.style, pageCtx()); styleEl = style; layer = doc.createElement('div'); layer.className = 'layer'; root.append(style, layer);
    evictForeign(); doc.documentElement.append(host); return layer;
  }
  const rectsOf = r => r ? [...r.getClientRects()].filter(b => b.width > 0 && b.height > 0) : [];
  const box = (cls, b, px = 0, py = px) => { const n = doc.createElement('div'); n.className = 'box ' + cls; n.style.cssText = 'left:' + (b.left - px) + 'px;top:' + (b.top - py) + 'px;width:' + (b.width + 2 * px) + 'px;height:' + (b.height + 2 * py) + 'px'; return n; };
  /* Section geometry: one sub-range per rendered text node piece (first/last node cut at the first/last word), so only TEXT rectangles count (no inline element boxes with padding/borders).
     Consecutive pieces on the same visual line are merged (small gap, e.g. a link or <code> inside the sentence); a gap wider than one line height (table cells) stays separate. */
  function sectionParts(r, bi) {
    const out = [], nodes = textNodes[bi] || [], a = nodes.indexOf(r.startContainer), z = nodes.indexOf(r.endContainer);
    if (a < 0 || z < a) return out;
    for (let i = a; i <= z; i++) {
      const n = nodes[i], from = i === a ? r.startOffset : 0, to = i === z ? r.endOffset : n.data.length;
      if (to <= from || !n.data.slice(from, to).trim()) continue;
      const p = doc.createRange(); try { p.setStart(n, from); p.setEnd(n, to); } catch { continue; } out.push(p);
    }
    return out;
  }
  function lineFragments() {
    const out = [];
    for (const p of parts) for (const b of rectsOf(p)) {
      const q = out[out.length - 1], hh = Math.min(b.height, q ? q.b - q.t : b.height);
      const same = q && Math.min(b.bottom, q.b) - Math.max(b.top, q.t) > hh * .5, gap = q ? Math.max(b.left - q.r, q.l - b.right) : 0;
      if (same && gap <= Math.max(b.height * .9, 6)) { q.l = Math.min(q.l, b.left); q.r = Math.max(q.r, b.right); q.t = Math.min(q.t, b.top); q.b = Math.max(q.b, b.bottom); }
      else out.push({l: b.left, t: b.top, r: b.right, b: b.bottom});
    }
    return out;
  }
  function layout() {
    frame = 0; if (disposed) return;
    const nodes = [], h = win.innerHeight, w = win.innerWidth, inView = b => b.bottom > 0 && b.top < h && b.right > 0 && b.left < w;
    if (parts.length && (mode.tint || mode.corners)) {
      const lines = lineFragments(), last = lines.length - 1;
      lines.forEach((f, i) => {
        const px = padX(f.b - f.t) + 1, x0 = f.l - px, x1 = f.r + px, y0 = f.t - BLOCK_PAD_Y, y1 = f.b + BLOCK_PAD_Y;
        if (!(y1 > 0 && y0 < h && x1 > 0 && x0 < w)) return;
        if (mode.tint) nodes.push(box('block', {left: x0, top: y0, width: x1 - x0, height: y1 - y0}));
        if (!mode.corners || (i !== 0 && i !== last)) return;
        const put = (kind, x, y) => { if (y + 12 > 0 && y < h && x + 12 > 0 && x < w) { const n = doc.createElement('div'); n.className = 'box corner ' + kind + (rtl ? ' rtl' : ''); n.style.cssText = 'left:' + x + 'px;top:' + y + 'px'; nodes.push(n); } };
        if (i === 0) put('start', rtl ? x1 - 12 : x0, y0);     // L-mark ON the outer corner of the FIRST line fragment: at the first word, not at the block edge
        if (i === last) put('end', rtl ? x0 : x1 - 12, y1 - 12);   // ... and of the LAST fragment: ends at the last word of the section
      });
    }
    if (mode.word !== 'off') for (const b of rectsOf(wordRng)) if (inView(b)) {
      const px = padX(b.height);
      const bw = mode.word === 'strong' ? 2 : 1;
      if (mode.word !== 'subtle' && !supported) { nodes.push(box('fill' + (mode.word === 'strong' ? ' strong' : ''), b, px + bw, bw)); continue; }
      if (mode.word !== 'subtle') nodes.push(box('frame' + (mode.word === 'strong' ? ' strong' : ''), b, px + bw, bw));
      else nodes.push(box('under', b, px + 1, 1));
      if (supported) for (const side of [-1, 1]) nodes.push(box('pad ' + mode.word, {left: side < 0 ? b.left - px : b.right, top: b.top, width: px, height: b.height}, 0, 0));
    }
    if (!nodes.length && !layer) return;
    ensureLayer().replaceChildren(...nodes); if (nodes.length) evictForeign();
  }
  const schedule = () => { if (!frame && !disposed) frame = win.requestAnimationFrame(layout); };
  const syncSheet = () => { if (sheet) try { sheet.replaceSync(sheetText()); } catch {} if (styleEl) styleEl.textContent = overlayCss(mode.style, pageCtx()); };
  const mapper = bi => { if (!mappers.has(bi)) mappers.set(bi, createRangeMapper(textNodes[bi] || [], blocks[bi].text)); return mappers.get(bi); };
  /* Range of a word: block offsets = chunk.start + word offset. null when the page changed under us. */
  function wordRange(chunkIndex, word) {
    const chunk = chunks[chunkIndex], o = offsets[chunkIndex]?.[word], m = chunk && mapper(chunk.block);
    if (!chunk || !o || !m) return null;
    try { const r = m.range(chunk.start + o.start, chunk.start + o.end, doc); return r && r.startContainer.isConnected ? r : null; } catch { return null; }
  }
  function chunkRange(chunkIndex) {
    const chunk = chunks[chunkIndex], m = chunk && mapper(chunk.block);
    try { return m?.range(chunk.start, chunk.start + chunk.text.length, doc) || null; } catch { return null; }
  }
  const visibility = r => { const b = r.getBoundingClientRect(), h = win.innerHeight, top = h * .12, bottom = h * .72; return b.bottom < top ? 'above' : b.top > bottom ? 'below' : 'visible'; };
  const follow = createFollowController({
    visibility: ref => visibility(ref),
    scrollTo: ref => { const b = ref.getBoundingClientRect(); win.scrollBy({top: b.top - win.innerHeight * .35, behavior: 'auto'}); },
  });
  const scrollSignal = () => { follow.onUserScroll(); onUserScroll?.(); };
  const onKey = e => { if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(e.key)) scrollSignal(); }, onScroll = () => follow.onUserScroll();
  win.addEventListener('wheel', scrollSignal, {passive: true}); win.addEventListener('touchmove', scrollSignal, {passive: true}); win.addEventListener('keydown', onKey, true);
  win.addEventListener('scroll', onScroll, {passive: true});
  doc.addEventListener('scroll', schedule, {capture: true, passive: true}); win.addEventListener('resize', schedule, {passive: true});
  function paint(chunkIndex, word) {
    current = {chunk: chunkIndex, word};
    if (!isDefaultStyle(mode.style)) { const was = JSON.stringify(ctx); pageCtx(); if (JSON.stringify(ctx) !== was) syncSheet(); }     // the page changed its colors (dark button): the automatic text color follows
    syncRoots();const r = wordRange(chunkIndex, word), cr = chunkRange(chunkIndex);
    wordRng = r; chunkRng = cr; parts = cr ? sectionParts(cr, chunks[chunkIndex].block) : []; rtl = !!cr && win.getComputedStyle(cr.startContainer.parentElement || doc.documentElement).direction === 'rtl';
    if (supported) { ownHighlight = new win.Highlight(...(r && mode.word !== 'off' ? [r] : [])); win.CSS.highlights.set('notable-word', ownHighlight); }
    layout(); schedule();
    return r;
  }
  function mark(chunkIndex, word) {
    if (disposed) return null;
    const r = paint(chunkIndex, word);
    if (r) follow.onWord(r);
    return r;
  }
  /* Click-to-seek: plain left click on page text (not on links/buttons/form fields) -> word. Uses caret positions, no layout changes. */
  const down = new Map();
  const pt = e => ({button: e.button, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey});
  // The first click of a press seeks at once; the further presses of a double or triple click (click count >= 2) only
  // select text natively and never seek again. Mouse events carry the count; pointer events may report 0.
  let presses = 1;
  const onMouseDown = e => { presses = e.detail || 1; };
  const cancelSeek = () => { presses = 1; };      // nothing waits: only the click count is forgotten
  const onDown = e => { down.set(e.pointerId, pt(e)); };
  const caretAt = (x, y) => { if (doc.caretPositionFromPoint) { const p = doc.caretPositionFromPoint(x, y,{shadowRoots:[...(textRoots??=collectRoots())].filter(r=>r.host)}); return p ? {node: p.offsetNode, offset: p.offset} : null; } const r = doc.caretRangeFromPoint?.(x, y); return r ? {node: r.startContainer, offset: r.startOffset} : null; };
  const INTERACTIVE = 'a,button,input,select,textarea,summary,[role=button],[contenteditable],[data-notable-reader-surface]';
  /* The pointer really is on the glyphs of that text node (caret positions also answer for blank space next to a line, which is not clickable). */
  const overText = (node, x, y) => { const r = doc.createRange(); r.selectNodeContents(node); for (const b of r.getClientRects()) if (x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2) return true; return false; };
  const hitAt = (x, y, target) => {
    if (!clickSeek || disposed || target?.closest?.(INTERACTIVE) || win.getSelection()?.toString()) return null;
    const caret = caretAt(x, y);
    if (!(caret && caret.node.nodeType === 3 && overText(caret.node, x, y))) return null;
    const at = locate(caret.node, caret.offset); return at && {...at, node: caret.node};
  };
  const onUp = e => {
    const d = down.get(e.pointerId); down.delete(e.pointerId);
    if (!isPlainClick(d, pt(e))) return;
    if (Math.max(e.detail || 0, presses) >= 2) return;
    const hit = hitAt(e.clientX, e.clientY, e.target);
    if (hit) onSeek(hit.chunk, hit.word);
  };
  doc.addEventListener('pointerdown', onDown, true); doc.addEventListener('mousedown', onMouseDown, true);
  doc.addEventListener('pointerup', onUp, true);
  /* Pointer feedback of 1.6.24: over text that WILL be read (a block of the reading text) the "you can click here" pointer, elsewhere the page's own cursor (normal text caret over headings,
     author lines, boxes that are not part of the reading text). No hit rectangles: one adopted rule, scoped to a marker
     attribute on the element under the pointer. A page-wide rule restyled every element of the page on each
     enter/leave. */
  const HOVER = 'data-notable-reader-hover', HOVER_RULE = `[${HOVER}],[${HOVER}] *{cursor:pointer !important}`;
  const hoverRoots = new Set();
  let hoverSheet = null, hoverEl = null, moved = null, moveFrame = 0;
  const setHover = el => {
    if (el === hoverEl) return;
    hoverEl?.removeAttribute(HOVER); hoverEl = null;
    if (!el) return;
    try {
      if (!hoverSheet) { hoverSheet = new win.CSSStyleSheet(); hoverSheet.replaceSync(HOVER_RULE); }
      const root = el.getRootNode();                    // text in an open shadow root needs the rule in that tree
      if (!root.adoptedStyleSheets.includes(hoverSheet)) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, hoverSheet]; hoverRoots.add(root);
      }
      el.setAttribute(HOVER, ''); hoverEl = el;
    } catch { hoverEl = null; }
  };
  const probe = () => {
    moveFrame = 0; if (disposed || !moved) return;
    const hit = moved.buttons === 0 ? hitAt(moved.x, moved.y, moved.target) : null;
    setHover(hit?.node.parentElement || null);
  };
  const onMove = e => { moved = {x: e.clientX, y: e.clientY, target: e.target, buttons: e.buttons}; if (!moveFrame) moveFrame = win.requestAnimationFrame(probe); };
  const onLeave = () => { moved = null; setHover(null); };
  doc.addEventListener('pointermove', onMove, {capture: true, passive: true}); doc.documentElement.addEventListener('pointerleave', onLeave, {passive: true});
  /* DOM position -> {chunk, word}: scan blocks whose text nodes contain the node, then chunks of that block. */
  function locate(node, offset) {
    for (let bi = 0; bi < textNodes.length; bi++) {
      const nodes = textNodes[bi], at = nodes.indexOf(node);
      if (at < 0) continue;
      let ordinal = 0;                                          // non-space characters before the caret inside this block
      for (let i = 0; i < at; i++) ordinal += [...nodes[i].data.replace(/\s/gu, '')].length;
      ordinal += [...node.data.slice(0, offset).replace(/\s/gu, '')].length;
      const text = blocks[bi].text; let seen = 0, charPos = text.length;
      for (let i = 0; i < text.length; i++) { if (/\S/u.test(text[i])) { if (seen === ordinal) { charPos = i; break; } seen++; } }
      for (let ci = 0; ci < chunks.length; ci++) {
        const c = chunks[ci]; if (c.block !== bi || charPos < c.start || charPos >= c.start + c.text.length + 1) continue;
        const rel = charPos - c.start, os = offsets[ci]; if (!os) return null;
        let w = os.findIndex(o => rel < o.end); if (w < 0) w = os.length - 1;
        return {chunk: ci, word: w};
      }
    }
    return null;
  }
  return {
    mark, follow, locate, wordRange, supported, get current() { return current; },
    setClickSeek(v) { clickSeek = v === true; if (!clickSeek) { setHover(null); cancelSeek(); } },
    /* A closed bar rests the page: no pointer, scroll or key listeners until it opens again (dispose ends them for
       good). Marks and click-to-start come back with setEnabled(true). */
    setEnabled(value) {
      const on = value !== false; if (on === enabled || disposed) return; enabled = on;
      if (!on) {
        cancelSeek(); setHover(null); down.clear();
        // no hand-cursor rule stays in the page while it rests; setHover adopts it again when needed
        for (const root of hoverRoots) root.adoptedStyleSheets = root.adoptedStyleSheets.filter(x => x !== hoverSheet);
        hoverRoots.clear();
      }
      const m = on ? 'addEventListener' : 'removeEventListener', passive = on ? {passive: true} : false;
      doc[m]('pointerdown', onDown, true); doc[m]('mousedown', onMouseDown, true); doc[m]('pointerup', onUp, true);
      doc[m]('pointermove', onMove, on ? {capture: true, passive: true} : true);
      doc.documentElement[m]('pointerleave', onLeave, passive);
      win[m]('wheel', scrollSignal, passive); win[m]('touchmove', scrollSignal, passive); win[m]('keydown', onKey, true);
      win[m]('scroll', onScroll, passive); win[m]('resize', schedule, passive);
      doc[m]('scroll', schedule, on ? {capture: true, passive: true} : true);
    },
    setFollow(v) { follow.setFollow(v); },
    get marks() { return {...mode}; },
    /* markWord / markSection changed (settings): restyle and repaint in place, no scrolling, no re-read. */
    setMarks(next) { const w = pick(next?.word, mode.word), t = flag(next?.tint, mode.tint), c = flag(next?.corners, mode.corners), st = next?.style === undefined ? mode.style : cleanStyle(next.style); if (w === mode.word && t === mode.tint && c === mode.corners && styleKey(st) === styleKey(mode.style)) return; mode = {word: w, tint: t, corners: c, style: st}; syncSheet(); if (current && !disposed) { const at = current; paint(at.chunk, at.word); } else layout(); },
    hoverNow() { return !!hoverEl; },
    clear() { current = null; wordRng = chunkRng = null; parts = []; if (supported && ownHighlight && win.CSS.highlights.get('notable-word') === ownHighlight) win.CSS.highlights.delete('notable-word'); ownHighlight = null; if (layer) layer.replaceChildren(); },
    /* The page was re-read (late render, SPA route, appended content): same listeners, new chunk/node arrays. */
    /* keepAt = {chunk, word}: the reading position survives the re-read (a paused reader keeps its word mark); painted in place, no scrolling. */
    update(next, keepAt = null) {
      textRoots = null;
      chunks = next.chunks; blocks = next.blocks; textNodes = next.textNodes; offsets = chunks.map(c => wordOffsets(c.text, c.words)); mappers.clear(); this.clear(); if (keepAt && !disposed && chunks[keepAt.chunk]) paint(keepAt.chunk, keepAt.word); },
    dispose() {
      cancelSeek(); setHover(null);
      for (const root of hoverRoots) root.adoptedStyleSheets = root.adoptedStyleSheets.filter(x => x !== hoverSheet);
      disposed = true; win.cancelAnimationFrame(moveFrame); doc.removeEventListener('pointermove', onMove, true); doc.documentElement.removeEventListener('pointerleave', onLeave); this.clear(); win.cancelAnimationFrame(frame); doc.removeEventListener('scroll', schedule, true); win.removeEventListener('resize', schedule); host?.remove(); host = layer = null; win.removeEventListener('wheel', scrollSignal); win.removeEventListener('touchmove', scrollSignal); win.removeEventListener('keydown', onKey, true); win.removeEventListener('scroll', onScroll); doc.removeEventListener('pointerdown', onDown, true); doc.removeEventListener('mousedown', onMouseDown, true); doc.removeEventListener('pointerup', onUp, true); if(sheet)for(const root of adoptedRoots)root.adoptedStyleSheets=root.adoptedStyleSheets.filter(s=>s!==sheet); },
  };
}
