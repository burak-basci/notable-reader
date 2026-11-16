/* Page snapshot for the HTML download (round 4, owner request: "PDF und HTML sollen die Seite sein, wie sie (mit Nachtmodus) von der Erweiterung
   bearbeitet ist"). The document as it looks in the tab right now: its own markup with the inline styles the extension wrote (Night mode,
   typography), its readable style sheets inlined, the extension's constructed sheets (Night mode covers) added, links made absolute; without
   scripts, event handlers and without the extension's own UI (bar, menus, marks, panels, quick actions). Ranges: the whole page, from the reading
   place (the reading blocks before it are left out) or the selection only. Own code, MIT. */
const EXTENSION_UI = ['[data-notable-reader-surface]', '[data-notable-quick-actions]', '[data-notable-reader-ui]', '[data-reader-tutor-marks]', '[data-reader-explain-panel]',
  '[data-reader-explain-annotations]', '[data-reader-scrollbars-style]', '[data-notable-reader-spacing]', '[data-notable-reader-update]', '[data-notable-appearance]'].join(',');

/* path of child indices from the root element; the same path finds the twin in a deep clone */
const pathOf = (node, root) => { const path = []; for (let n = node; n && n !== root; n = n.parentNode) { if (!n.parentNode) return null; path.unshift([...n.parentNode.childNodes].indexOf(n)); } return path; };
const nodeAt = (root, path) => { let n = root; for (const i of path || []) { n = n?.childNodes[i]; if (!n) return null; } return n; };
const rulesOf = sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText).join('\n'); } catch { return null; } };   // a cross-origin sheet stays a link

export function pageSnapshot({document: doc = globalThis.document, range = 'all', fromElement = null, beforeElements = [], selection = null} = {}) {
  const root = doc.documentElement, clone = root.cloneNode(true), win = doc.defaultView;
  /* style sheets first (they are found by their path in the untouched clone): readable ones inline, the others as absolute links */
  const swaps = [];
  for (const sheet of [...doc.styleSheets]) {
    const owner = sheet.ownerNode; if (!owner || owner.closest?.(EXTENSION_UI)) continue;
    const twin = nodeAt(clone, pathOf(owner, root)); if (!twin) continue;
    const text = rulesOf(sheet);
    if (text !== null && (owner.tagName === 'LINK' || owner.textContent.trim() !== text.trim())) { const style = doc.createElement('style'); if (sheet.media?.mediaText) style.media = sheet.media.mediaText; style.textContent = text; swaps.push([twin, style]); }
    else if (owner.tagName === 'LINK' && owner.href) twin.setAttribute('href', owner.href);
  }
  /* canvases lose their pixels in a clone: an image of what they show (a tainted canvas stays empty) */
  for (const canvas of root.querySelectorAll('canvas')) { if (canvas.closest(EXTENSION_UI)) continue; const twin = nodeAt(clone, pathOf(canvas, root)); if (!twin) continue; try { const img = doc.createElement('img'); img.src = canvas.toDataURL(); img.width = canvas.width; img.height = canvas.height; img.setAttribute('style', canvas.getAttribute('style') || ''); if (canvas.className) img.className = canvas.className; swaps.push([twin, img]); } catch {} }
  /* "from here": the reading blocks before the reading place are left out (their twins found before anything moves) */
  const drop = range === 'here' ? beforeElements.map(el => nodeAt(clone, pathOf(el, root))).filter(Boolean) : [];
  for (const [from, to] of swaps) from.replaceWith(to);
  for (const node of drop) node.remove();
  /* no extension UI, no scripts, no handlers, no own base / refresh */
  for (const node of clone.querySelectorAll(EXTENSION_UI + ',script,base,meta[http-equiv],link[rel~=preload],link[rel~=modulepreload],link[rel~=prefetch]')) node.remove();
  for (const el of [clone, ...clone.querySelectorAll('*')]) for (const attr of [...el.attributes]) if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
  /* the selection only: the page's head and body frame around the selected nodes */
  const body = clone.querySelector('body');
  if (range === 'selection' && selection && body) {
    const part = selection.cloneContents(); for (const node of part.querySelectorAll(EXTENSION_UI + ',script')) node.remove();
    body.replaceChildren(part);
  }
  /* the extension's constructed sheets (Night mode covers) and absolute addresses */
  let head = clone.querySelector('head'); if (!head) { head = doc.createElement('head'); clone.prepend(head); }
  const adopted = (doc.adoptedStyleSheets || []).map(rulesOf).filter(Boolean).join('\n');
  if (adopted) { const style = doc.createElement('style'); style.dataset.notableSnapshot = 'appearance'; style.textContent = adopted; head.append(style); }
  const base = doc.createElement('base'); base.href = win?.location?.href || doc.baseURI; head.prepend(base);
  if (!head.querySelector('meta[charset]')) { const meta = doc.createElement('meta'); meta.setAttribute('charset', 'utf-8'); head.prepend(meta); }
  const doctype = doc.doctype ? '<!doctype ' + doc.doctype.name + '>' : '<!doctype html>';
  return doctype + '\n' + clone.outerHTML;
}
