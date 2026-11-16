/* beNotable! Reader · Export: Text in sprechbare Abschnitte und Kapitel teilen. MIT. */
// Generator statt Gesamtarray: jedes nicht leere Zeichen liegt in genau einem Abschnitt.
export function* chunkText(text, limit = 230) {
  if (typeof text !== 'string' || !Number.isInteger(limit) || limit < 2) throw new TypeError('Ungültiger Buchtext oder Abschnittsgrenze.');
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && /\s/u.test(text[cursor])) cursor++;
    if (cursor === text.length) break;
    let end = Math.min(text.length, cursor + limit);
    if (end < text.length) {
      const part = text.slice(cursor, end);
      const last = [...part.matchAll(/[.!?。！？]["'»”’)]*(?=\s)|\n/gu)].at(-1);
      let boundary = last ? last.index + last[0].length : 0;
      if (boundary < limit / 3) { const space = part.search(/\s+\S*$/u); boundary = space > limit / 3 ? space + 1 : 0; }
      if (boundary) end = cursor + boundary;
      if (/[\uD800-\uDBFF]/u.test(text[end - 1])) end--; // keine halbe Surrogat-Paarung
    }
    const raw = text.slice(cursor, end), spoken = raw.trim();
    if (spoken) { const start = cursor + raw.indexOf(spoken); yield { text: spoken, start, end: start + spoken.length }; }
    cursor = end;
  }
}

const HEADING = /^[ \t]*((?:kapitel|chapter|teil|part|abschnitt|section|prolog|epilog|prologue|epilogue)\b[^\n]{0,80}|(?:[IVXLC]{1,7}|\d{1,3})\.?[ \t]*)$/gimu;
// Überschriften wie „Kapitel 3“ oder „Chapter IV: Titel“ als eigene Zeile. Ohne Treffer: ein Kapitel.
export function detectChapters(text, fallbackTitle = 'Hörbuch') {
  const marks = [...text.matchAll(HEADING)].map(m => ({ title: m[1].trim(), at: m.index }));
  if (marks.length < 2) return [{ title: fallbackTitle, text }];
  const chapters = [];
  const head = text.slice(0, marks[0].at);
  if (head.trim()) chapters.push({ title: fallbackTitle, text: head });
  marks.forEach((mark, i) => chapters.push({ title: mark.title, text: text.slice(mark.at, i + 1 < marks.length ? marks[i + 1].at : text.length) }));
  return chapters.filter(c => c.text.trim());
}

// Normalisiert die Eingabe zu [{title,text}] und prüft sie.
export function normalizeChapters({ text, chapters, title = 'Hörbuch', detect = false }) {
  let list;
  if (Array.isArray(chapters) && chapters.length) list = chapters.map((c, i) => ({ title: String(c?.title ?? `Kapitel ${i + 1}`), text: String(c?.text ?? '') }));
  else if (typeof text === 'string') list = detect ? detectChapters(text, title) : [{ title, text }];
  else list = [];
  list = list.filter(c => c.text.trim());
  if (!list.length) throw new Error('Bitte zuerst einen Text oder ein vollständiges Buch öffnen.');
  return list;
}
