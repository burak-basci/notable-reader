/* beNotable! Reader · Export: Dateinamen, die auf Windows, macOS und Linux gleich gültig sind. MIT. */
import { isReservedName } from '../platform/filenames.mjs'; // eine Liste reservierter Windows-Namen (auch mit Endung reserviert, inkl. CONIN$/CONOUT$)
const encoder = new TextEncoder();
// 255 Bytes je Komponente (Linux/macOS, UTF-8): bei 4-Byte-Zeichen reichen 110 Zeichen nicht; Reserve für „_“ und Endung.
const clipBytes = (text, maxBytes) => { let out = ''; for (const ch of text) { if (encoder.encode(out + ch).length > maxBytes) break; out += ch; } return out; };

export function safeName(title, fallback = 'Hörbuch', max = 110, reserved = true) {
  let name = String(title ?? '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f‎‏‪-‮]/gu, '').replace(/\s+/gu, ' ').replace(/^[. ]+|[. ]+$/gu, '');
  name = clipBytes(Array.from(name).slice(0, max).join(''), 120).replace(/^[. ]+|[. ]+$/gu, '');
  if (!name) name = fallback;
  if (reserved && isReservedName(name.split('.')[0].trim())) name = '_' + name;
  return name;
}
export function audiobookFilename(title = 'Hörbuch', format = 'mp3') {
  return `${safeName(String(title).replace(/\.(mp3|wav)$/iu, ''))}.${format}`;
}
// Dateinamen je Kapitel: „03 - Titel.mp3“, eindeutig innerhalb des Auftrags.
export function chapterFilenames(chapters, format) {
  const width = Math.max(2, String(chapters.length).length), seen = new Set();
  return chapters.map((c, i) => {
    let base = `${String(i + 1).padStart(width, '0')} - ${safeName(c.title, `Kapitel ${i + 1}`, 80, false)}`, name = base, n = 2;
    while (seen.has(name.toLowerCase())) name = `${base} (${n++})`;
    seen.add(name.toLowerCase());
    return `${name}.${format}`;
  });
}
