/* Explicit reading scopes and next-chapter selection. Source DOM and offsets stay intact. */
import {createRangeMapper} from './text-map.mjs';
import {wordOffsets} from '../playback/timeline.js';

export function scopedChunks(chunks, blocks, textNodes, scope) {
  if (!scope) return chunks;
  const out = [], maps = new Map();
  const intersects = range => {
    if (!range) return false;
    if (scope.element) return scope.element.contains(range.startContainer) || scope.element.contains(range.endContainer);
    if (scope.range) return range.compareBoundaryPoints(Range.END_TO_START, scope.range) < 0 && range.compareBoundaryPoints(Range.START_TO_END, scope.range) > 0;
    if (scope.ranges?.length) return scope.ranges.some(r => range.compareBoundaryPoints(Range.END_TO_START, r) < 0 && range.compareBoundaryPoints(Range.START_TO_END, r) > 0);
    if (scope.rect) { const a = scope.rect; return [...range.getClientRects()].some(b => b.right > a.left && b.left < a.right && b.bottom > a.top && b.top < a.bottom); }
    return false;
  };
  const reach = new Map();
  const blockReach = bi => {
    if (!reach.has(bi)) reach.set(bi, mayReach(textNodes[bi] || [], scope));
    return reach.get(bi);
  };
  for (const chunk of chunks) {
    if (!blockReach(chunk.block)) continue;
    if (!maps.has(chunk.block)) maps.set(chunk.block, createRangeMapper(textNodes[chunk.block] || [], blocks[chunk.block].text));
    const mapper = maps.get(chunk.block), offsets = wordOffsets(chunk.text, chunk.words);
    if (!mapper || !offsets) continue;
    let first = -1;
    const flush = end => { if (first < 0) return; const start = offsets[first].start, last = offsets[end - 1].end; out.push({...chunk, id: out.length, start: chunk.start + start, text: chunk.text.slice(start, last), words: chunk.words.slice(first, end)}); first = -1; };
    for (let i = 0; i < offsets.length; i++) {
      const hit = intersects(mapper.range(chunk.start + offsets[i].start, chunk.start + offsets[i].end));
      if (hit && first < 0) first = i;
      if (!hit) flush(i);
    }
    flush(offsets.length);
  }
  return out;
}
/* Every word range lies inside its block's text, so a block whose whole text range misses the scope holds no hit
   and its words need no range at all. Answers true (exact per-word check) whenever that containment is not certain:
   nodes in several trees, nodes out of document order, or a scope range in another tree. Same precedence as above. */
function mayReach(nodes, scope) {
  if (!nodes.length) return false;
  if (scope.element) return nodes.some(node => scope.element.contains(node));
  const root = nodes[0].getRootNode();
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i].getRootNode() !== root) return true;
    const after = nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (nodes[i] !== nodes[i - 1] && !after) return true;
  }
  const last = nodes.at(-1), block = nodes[0].ownerDocument.createRange();
  block.setStart(nodes[0], 0); block.setEnd(last, last.length);
  const overlaps = r => r.startContainer.getRootNode() !== root
    || block.compareBoundaryPoints(Range.END_TO_START, r) < 0 && block.compareBoundaryPoints(Range.START_TO_END, r) > 0;
  if (scope.range) return overlaps(scope.range);
  if (scope.ranges?.length) return scope.ranges.some(overlaps);
  if (scope.rect) {
    const a = scope.rect, b = block.getBoundingClientRect();
    return b.right > a.left && b.left < a.right && b.bottom > a.top && b.top < a.bottom;
  }
  return false;
}

export const WORKFLOW_TEXT = {
  de: {pick:'Klicke auf den Link zum nächsten Kapitel. Esc bricht ab.', cancel:'Abbrechen', invalid:'Wähle einen Kapitellink auf derselben Website.', enabled:'Automatisches Weiterlesen ist aktiv. Zum Beenden „Stopp“ drücken.', missing:'Kein nächstes Kapitel gefunden. Weiterlesen wurde beendet.'},
  en: {pick:'Click the next-chapter link. Esc cancels.', cancel:'Cancel', invalid:'Choose a chapter link on the same website.', enabled:'Automatic chapter reading is on. Press Stop to end it.', missing:'No next chapter found. Continuous reading stopped.'},
  fr: {pick:'Cliquez sur le lien du chapitre suivant. Échap annule.',cancel:'Annuler',invalid:'Choisissez un lien sur le même site.',enabled:'Lecture des chapitres activée. Arrêter met fin à la lecture.',missing:'Chapitre suivant introuvable. Lecture arrêtée.'},
  es: {pick:'Pulsa el enlace al siguiente capítulo. Esc cancela.',cancel:'Cancelar',invalid:'Elige un enlace del mismo sitio.',enabled:'Lectura continua activada. Pulsa Detener para terminar.',missing:'No se encontró el siguiente capítulo. Lectura detenida.'},
  it: {pick:'Fai clic sul capitolo successivo. Esc annulla.',cancel:'Annulla',invalid:'Scegli un collegamento sullo stesso sito.',enabled:'Lettura continua attiva. Premi Stop per terminarla.',missing:'Capitolo successivo non trovato. Lettura interrotta.'},
  pt: {pick:'Clique no próximo capítulo. Esc cancela.',cancel:'Cancelar',invalid:'Escolha um link no mesmo site.',enabled:'Leitura contínua ativa. Prima Parar para terminar.',missing:'Próximo capítulo não encontrado. Leitura interrompida.'},
};
export function chapterTarget(recipe, doc = document) {
  let link;
  try { link = doc.querySelector(recipe.selector); } catch {}
  if (!link || link.getAttribute('aria-disabled') === 'true') return null;
  const url = new URL(link.getAttribute('href') || '', doc.location.href);
  return /^https?:$/.test(url.protocol) && url.origin === recipe.origin && url.href !== doc.location.href && !url.username && !url.password ? url.href : null;
}
function selectorFor(link) {
  if (link.id) return '#' + CSS.escape(link.id);
  if (link.relList?.contains('next')) return 'a[rel~="next"]';
  const parts = [];
  for (let el = link; el?.parentElement && parts.length < 10; el = el.parentElement) {
    const same = [...el.parentElement.children].filter(n => n.tagName === el.tagName);
    parts.unshift(el.localName + (same.length > 1 ? `:nth-of-type(${same.indexOf(el) + 1})` : ''));
    const selector = parts.join(' > '); if (document.querySelectorAll(selector).length === 1) return selector;
  }
  return parts.join(' > ');
}
export function pickChapter({language = 'en', onPick, onCancel = () => {}}) {
  const t = WORKFLOW_TEXT[language] || WORKFLOW_TEXT.en, host = document.createElement('div');
  host.dataset.notableReaderUi = 'chapter-picker';
  host.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:16px;transform:translateX(-50%);padding:14px 18px;border:1px solid #52735c;border-radius:12px;background:#faf9f4;color:#183523;font:15px system-ui;box-shadow:0 5px 24px #0003;max-width:calc(100vw - 32px)';
  const message = document.createElement('span'), cancel = document.createElement('button'); message.textContent = t.pick; cancel.textContent = t.cancel; cancel.style.marginInlineStart = '12px'; host.append(message, cancel); document.documentElement.append(host);
  let done = false;
  const cleanup = () => { if (done) return; done = true; document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); host.remove(); };
  const key = e => { if (e.key === 'Escape') { e.preventDefault(); cleanup(); onCancel(); } };
  const click = e => {
    if (!e.isTrusted) {e.preventDefault();return;}
    if (host.contains(e.target)) return;
    e.preventDefault(); e.stopImmediatePropagation(); const link = e.target.closest?.('a[href]');
    if (!link) { message.textContent = t.invalid; return; }
    const recipe = {selector: selectorFor(link), origin: location.origin};
    if (!chapterTarget(recipe)) { message.textContent = t.invalid; return; }
    cleanup(); onPick(recipe);
  };
  cancel.onclick = () => { cleanup(); onCancel(); };
  document.addEventListener('click', click, true); document.addEventListener('keydown', key, true);
  return cleanup;
}
