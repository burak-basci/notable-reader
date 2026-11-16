/* beNotable! Reader session · where and when the page scrolls to follow the spoken word (own code, MIT).
   Port of the follow policy of 1.6.24 (bridge.mjs revealWord / manualScroll): ONE responsible scroll owner, a band around the reading height,
   user gestures decide. The decision logic lives in playback/follow.js (zone mode); this file measures the real page for it:
   reading height followPosition (10..90 %), band followMargin (5..30 %), jump rule followMode (paragraph | section | line), scroll owner detection
   (inner scroll containers of chat pages), occlusion by the player bar and by sticky composers. No page DOM is changed. */
const HEADING = 'h1,h2,h3,h4,h5,h6,[role="heading"]', NOT_PARAGRAPH = 'li,dd,dt,[role="listitem"],h1,h2,h3,h4,h5,h6,[role="heading"]';
const SCROLLABLE_Y = /auto|scroll|overlay/, CLIP = /auto|scroll|hidden|clip|overlay/;

export function createFollowZone({doc = document, getBar = () => null, isOwnNode = () => false, settings = () => ({}), blockElement = () => null}) {
  const win = doc.defaultView;
  let current = null, sectionCache = new Map(), overlays = [], headings = null;
  const pct = (value, fallback, min, max) => Number.isFinite(value) && value >= min && value <= max ? value / 100 : fallback / 100;
  const position = () => pct(settings().followPosition, 33, 10, 90), margin = () => pct(settings().followMargin, 10, 5, 30);
  const mode = () => ['paragraph', 'section', 'line'].includes(settings().followMode) ? settings().followMode : 'paragraph';

  /* The element that really scrolls for this block: first ancestor with vertical overflow, else the page (horizontal-only containers as last resort). */
  function scrollOwner(element) {
    let horizontal = null;
    for (let node = element?.parentElement; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
      const style = win.getComputedStyle(node);
      if (SCROLLABLE_Y.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
      if (!horizontal && SCROLLABLE_Y.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1) horizontal = node;
    }
    const root = doc.scrollingElement;
    return root && root.scrollHeight > root.clientHeight + 1 ? root : horizontal || root;
  }
  /* Sticky/fixed composers inside the scroll port occlude text: treated as an edge, never as room to scroll into. */
  function refreshOverlays() {
    overlays = []; const seen = new Set();
    for (const control of [...doc.querySelectorAll('input:not([type="hidden"]),textarea,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]')].slice(0, 64)) {
      if (isOwnNode(control)) continue;
      for (let node = control; node && node !== doc.body; node = node.parentElement) {
        const style = win.getComputedStyle(node); if (!/^(fixed|sticky)$/.test(style.position)) continue;
        const r = node.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < win.innerHeight * .6 && !seen.has(node)) {
          const owner = scrollOwner(node), root = owner === doc.scrollingElement, port = root || !owner ? {top: 0, bottom: win.innerHeight} : owner.getBoundingClientRect(), hasTop = style.top !== 'auto', hasBottom = style.bottom !== 'auto';
          if (style.position === 'sticky' && !hasTop && !hasBottom) continue;
          const edge = hasBottom && !hasTop ? 'bottom' : hasTop && !hasBottom ? 'top' : (r.top + r.bottom) / 2 > (port.top + port.bottom) / 2 ? 'bottom' : 'top';
          seen.add(node); overlays.push({left: r.left, top: r.top, right: r.right, bottom: r.bottom, edge});
        } break;
      }
    }
  }
  /* The part of `rect` that the user can see: clipped by the window and by every clipping ancestor. */
  function visibleRect(rect, element) {
    const r = {left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(win.innerWidth, rect.right), bottom: Math.min(win.innerHeight, rect.bottom)};
    for (let node = element?.parentElement; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
      const style = win.getComputedStyle(node), c = node.getBoundingClientRect(), x = CLIP.test(style.overflowX), y = CLIP.test(style.overflowY);
      if (x) { r.left = Math.max(r.left, c.left + node.clientLeft); r.right = Math.min(r.right, c.left + node.clientLeft + node.clientWidth); }
      if (y) { r.top = Math.max(r.top, c.top + node.clientTop); r.bottom = Math.min(r.bottom, c.top + node.clientTop + node.clientHeight); }
    }
    for (const o of overlays) { if (o.left >= r.right || o.right <= r.left) continue; if (o.edge === 'bottom') r.bottom = Math.min(r.bottom, o.top); else r.top = Math.max(r.top, o.bottom); }
    return r.right > r.left && r.bottom > r.top ? r : null;
  }
  /* Section = count of level-1/2 headings (every heading when the page has none) before the block; null = no headings at all. */
  function sectionOf(block, element) {
    if (sectionCache.has(block)) return sectionCache.get(block);
    headings ??= (() => { const all = [...doc.querySelectorAll(HEADING)].filter(h => !isOwnNode(h)), level = h => h.tagName[0] === 'H' && h.tagName.length === 2 ? Number(h.tagName[1]) : Number(h.getAttribute('aria-level')) || 2, major = all.filter(h => level(h) <= 2); return major.length ? major : all; })();
    let value = null;
    if (headings.length && element) { let n = 0; for (const h of headings) { if (h === element || element.contains(h) || h.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) n++; else break; } value = n; }
    sectionCache.set(block, value); return value;
  }
  /* Scroll owner, visible port and occluding composers depend on layout and scroll positions, not on the word. They
     are measured again when a scroll position or the viewport changed, and at least once a second (DOM changes);
     measuring them for every spoken word queried the whole page and every ancestor's style. */
  let frames = new WeakMap();
  const scrollKey = c => [win.scrollX, win.scrollY, win.innerWidth, win.innerHeight, c.scrollTop, c.scrollLeft].join();
  function frameOf(element) {
    const now = win.performance.now(), cached = element && frames.get(element);
    if (cached && now - cached.at < 1000 && cached.key === scrollKey(cached.container)) return cached;
    refreshOverlays();
    const container = scrollOwner(element); if (!container) return null;
    const root = container === doc.scrollingElement;
    const viewport = {top: 0, left: 0, right: win.innerWidth, bottom: win.innerHeight};
    const c = root ? viewport : container.getBoundingClientRect();
    const x = c.left + container.clientLeft, y = c.top + container.clientTop;
    const port = root ? c : {top: y, left: x, right: x + container.clientWidth, bottom: y + container.clientHeight};
    const frame = {at: now, key: scrollKey(container), container, root, clipped: visibleRect(port, container)};
    if (element) frames.set(element, frame);
    return frame;
  }
  return {
    /* The block (index into the session's blocks) of the word that is about to be marked. */
    setBlock(block) { current = block; },
    reset() { sectionCache = new Map(); headings = null; current = null; frames = new WeakMap(); },
    mode, margin, position,
    /* Geometry of the marked word for the follow controller. null = nothing to do (no geometry). */
    measure(ref) {
      const element = blockElement(current); let r;
      try { r = ref?.getBoundingClientRect?.(); } catch { r = null; }
      if (!r || (!r.width && !r.height)) return null;
      const frame = frameOf(element || ref.startContainer?.parentElement); if (!frame?.clipped) return null;
      const {container, root, clipped} = frame;
      let top = clipped.top + 12, bottom = clipped.bottom - 12, left = clipped.left + 12, right = clipped.right - 12;
      const bar = getBar(), b = bar?.getBoundingClientRect?.(), column = element?.getBoundingClientRect() || r;
      /* Bar occlusion is a property of the text column, not of the word (a per-word x test moved the target by the bar height every time the line crossed the bar). */
      if (b && b.width > 0 && b.height > 0 && b.left < column.right && b.right > column.left) { if ((b.top + b.bottom) / 2 > win.innerHeight / 2) bottom = Math.min(bottom, b.top - 12); else top = Math.max(top, b.bottom + 12); }
      if (bottom <= top || right <= left) return null;
      const targetY = top + (bottom - top) * position(), dy = (r.top + r.bottom) / 2 - targetY, dx = r.left < left || r.right > right ? r.left - (left + (right - left) * .2) : 0;
      const block = current ?? -1, line = {top: r.top + (root ? win.scrollY : container.scrollTop), height: Math.max(1, r.bottom - r.top)};
      return {dy, dx, band: margin() * (bottom - top), container, block, section: block >= 0 ? sectionOf(block, element) : null, paragraph: !!element && !element.closest(NOT_PARAGRAPH), line, mode: mode()};
    },
    /* Moves exactly one scroll owner: to the reading height on a jump, otherwise only horizontally (as 1.6.24). */
    scroll(m, jump) {
      const c = m.container, maxY = c.scrollHeight - c.clientHeight, maxX = c.scrollWidth - c.clientWidth;
      const y = jump ? Math.max(0, Math.min(maxY, c.scrollTop + m.dy)) : c.scrollTop, x = Math.max(0, Math.min(maxX, c.scrollLeft + m.dx));
      if (Math.abs(y - c.scrollTop) > .75 || Math.abs(x - c.scrollLeft) > .75) { c.scrollTo({top: y, left: x, behavior: 'instant'}); return true; }
      return false;
    },
  };
}

/* The user's own scroll gestures (not any scroll event: the page scrolls by itself too): wheel, scroll keys, touch/pen/mouse pan, middle button, drag of the scrollbar.
   Ignores the player bar and form fields. Returns the dispose function. */
export function watchScrollGestures({win = window, isExcluded = () => false, onGesture}) {
  const doc = win.document, off = [], listen = (t, n, f, o) => { t.addEventListener(n, f, o); off.push(() => t.removeEventListener(n, f, o)); };
  const excluded = e => isExcluded(e) || e.composedPath().some(n => /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(n?.tagName || ''));
  // Scroll keys typed into an editor (contenteditable, ARIA textbox) are text input, not a scroll gesture: counting
  // them could switch following off while the user typed into a chat composer.
  const typing = e => e.composedPath().some(n => n?.isContentEditable === true
    || n?.getAttribute?.('role') === 'textbox');
  listen(win, 'wheel', e => { if (!excluded(e) && !e.ctrlKey && (e.deltaX || e.deltaY)) onGesture(); }, {capture: true, passive: true});
  listen(win, 'keydown', e => { if (!excluded(e) && !typing(e) && !e.ctrlKey && !e.metaKey && !e.altKey && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'].includes(e.key)) onGesture(); }, true);
  let pan = null;
  listen(win, 'pointerdown', e => { if (excluded(e)) return; if (e.button === 1) onGesture(); else if (e.button === 0) { const root = doc.documentElement, bar = e.clientX >= root.clientWidth || e.clientY >= root.clientHeight; if (bar) onGesture(); pan = {x: e.clientX, y: e.clientY}; } }, true);
  listen(win, 'pointermove', e => { if (pan && Math.hypot(e.clientX - pan.x, e.clientY - pan.y) > 5) { onGesture(); pan = null; } }, {capture: true, passive: true});
  listen(win, 'pointerup', () => { pan = null; }, true); listen(win, 'pointercancel', () => { pan = null; }, true);
  listen(win, 'touchmove', e => { if (!excluded(e)) onGesture(); }, {capture: true, passive: true});
  return () => { for (const f of off.splice(0)) f(); };
}
