/* Notable Reader · Markdown zu Vorlesetext, MIT.
 * Entfernt Markdown-Syntax, damit sie nicht mitgesprochen wird, und liefert die Ueberschriften als Kapitel mit
 * exakten Zeichenpositionen im ausgegebenen Text. Absichtlich klein: kein vollstaendiger CommonMark-Parser. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const inline = line =>
  line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // Bild: nur der Alternativtext
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // Link: nur der Linktext
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<\/?[A-Za-z][^>\n]*>/g, '') // Rest-HTML
    .replace(/`+([^`]+)`+/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w_])_(?=\S)([^_]+?)(?<=\S)_(?![\w_])/g, '$1$2')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
    .replace(/\\([\\`*_{}\[\]()#+\-.!>|~])/g, '$1');

export function markdownText(source) {
  // Raw HTML tags (also multi-line <img ...>) are not text; link reference definitions are not prose.
  const lines = String(source).replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[A-Za-z][^<>]*>/g, '').split('\n').filter(l => !/^ {0,3}\[[^\]]+\]:\s*\S+/.test(l)),
    out = [],
    chapters = [];
  let fence = null,
    length = 0;
  const push = (line, heading) => {
    if (heading) chapters.push({label: line.slice(0, 160), level: heading, charStart: length});
    out.push(line);
    length += line.length + 1;
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i],
      open = raw.match(FENCE);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !raw.replace(FENCE, '').trim()) fence = null;
      continue; // Inhalt von Codebloecken wird nie gesprochen
    }
    if (open) { fence = open[1]; continue; }
    if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(raw) && !/^\s*[-*]\s+\S/.test(raw)) { push('', 0); continue; } // Trennlinie
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(raw) && raw.includes('|')) continue; // Tabellenkopf-Trenner
    const atx = raw.match(/^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/);
    if (atx) { push(inline(atx[2]).trim(), atx[1].length); continue; }
    const next = lines[i + 1];
    if (raw.trim() && next !== undefined && /^ {0,3}(=+|-{2,})\s*$/.test(next) && !/^\s*([-*+]|\d+[.)])\s/.test(raw) && !raw.includes('|')) {
      push(inline(raw).trim(), next.trim()[0] === '=' ? 1 : 2);
      i++;
      continue;
    }
    let line = raw.replace(/^ {0,3}(?:>\s?)+/, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '');
    if (line.includes('|') && /^\s*\|.*\|\s*$/.test(line)) line = line.trim().slice(1, -1).split('|').map(c => c.trim()).filter(Boolean).join('. ');
    push(inline(line).trimEnd(), 0);
  }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Re-map chapter starts onto the text after blank lines were collapsed (search each heading from the previous start).
  let cursor = 0;
  const fixed = chapters
    .map(c => {
      const at = text.indexOf(c.label, cursor);
      if (at < 0) return null;
      cursor = at + c.label.length;
      return {...c, charStart: at};
    })
    .filter(Boolean);
  return {text, chapters: fixed};
}
