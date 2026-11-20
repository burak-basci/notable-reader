/* Page snapshot for the HTML download (round 4, owner request: "PDF und HTML sollen die Seite sein, wie sie (mit Nachtmodus) von der Erweiterung
   bearbeitet ist"). The document as it looks in the tab right now: its own markup with the inline styles the extension wrote (Night mode,
   typography), its readable style sheets inlined, the extension's constructed sheets (Night mode covers) added, links made absolute; without
   scripts, event handlers and without the extension's own UI (bar, menus, marks, panels, quick actions). Ranges: the whole page, from the reading
   place (the reading blocks before it are left out) or the selection only. Own code, MIT. */
const EXTENSION_UI = ['[data-notable-reader-surface]', '[data-notable-quick-actions]', '[data-notable-reader-ui]', '[data-reader-tutor-marks]', '[data-reader-explain-panel]',
  '[data-reader-explain-annotations]', '[data-reader-scrollbars-style]', '[data-notable-reader-spacing]', '[data-notable-reader-update]', '[data-notable-appearance]'].join(',');

/* Cleaning of the saved file (code review 2.5.5, R5): no scripts, no handlers, no frames/plugins (iframe srcdoc, object, embed), no own base / refresh, and no
   script address in ANY attribute. Browsers drop ASCII tab/newline anywhere in a URL and leading control characters/spaces, so "jav&#9;ascript:" and "java\nscript:"
   are script links too: the scheme is checked on the value without them. Plus a Content-Security-Policy in the file that allows no script, plugin or frame. */
const DROP = ',script,noscript,base,meta[http-equiv],link[rel~=preload],link[rel~=modulepreload],link[rel~=prefetch],link[rel~=import],iframe,frame,frameset,object,embed,applet,portal';
export const SNAPSHOT_CSP = "script-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'";
const SCRIPT_URL = /^(?:javascript|vbscript|livescript|data:text\/html|data:application\/(?:x-)?(?:java|ecma)script)/;
export const scriptAddress = value => SCRIPT_URL.test(String(value).replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase());
function scrub(root) {
  for (const node of root.querySelectorAll(EXTENSION_UI + DROP)) node.remove();
  const all = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')];
  for (const el of all) for (const attr of [...el.attributes]) if (/^on/i.test(attr.name) || attr.name.toLowerCase() === 'srcdoc' || scriptAddress(attr.value)) el.removeAttribute(attr.name);
}

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
  scrub(clone);
  /* the selection only: the page's head and body frame around the selected nodes */
  const body = clone.querySelector('body');
  if (range === 'selection' && selection && body) {
    const part = selection.cloneContents(); scrub(part);                       // the selection gets the same cleaning as the whole page (2.5.5 kept its handlers and links)
    body.replaceChildren(part);
  }
  /* the extension's constructed sheets (Night mode covers) and absolute addresses */
  let head = clone.querySelector('head'); if (!head) { head = doc.createElement('head'); clone.prepend(head); }
  const adopted = (doc.adoptedStyleSheets || []).map(rulesOf).filter(Boolean).join('\n');
  if (adopted) { const style = doc.createElement('style'); style.dataset.notableSnapshot = 'appearance'; style.textContent = adopted; head.append(style); }
  const base = doc.createElement('base'); base.href = win?.location?.href || doc.baseURI; head.prepend(base);
  const csp = doc.createElement('meta'); csp.setAttribute('http-equiv', 'Content-Security-Policy'); csp.setAttribute('content', SNAPSHOT_CSP); head.prepend(csp);   // the saved file runs no script, whatever slipped through
  head.querySelector('meta[charset]')?.remove(); { const meta = doc.createElement('meta'); meta.setAttribute('charset', 'utf-8'); head.prepend(meta); }
  const doctype = doc.doctype ? '<!doctype ' + doc.doctype.name + '>' : '<!doctype html>';
  return doctype + '\n' + clone.outerHTML;
}
