// Dateinamen fuer Downloads (MP3/WAV/PDF/HTML), gueltig auf Windows, macOS und Linux zugleich.
// Windows ist am strengsten: reservierte Geraetenamen (CON.mp3 ist ebenfalls reserviert), Zeichen <>:"/\|?*, Steuerzeichen,
// kein Punkt/Leerzeichen am Ende. macOS/Linux: Schraegstrich und NUL verboten, 255 Bytes je Komponente (UTF-8).
const RESERVED = new Set(['con', 'prn', 'aux', 'nul', 'conin$', 'conout$', ...Array.from({length: 9}, (_, i) => `com${i + 1}`), ...Array.from({length: 9}, (_, i) => `lpt${i + 1}`),
  'com\u00b9', 'com\u00b2', 'com\u00b3', 'lpt\u00b9', 'lpt\u00b2', 'lpt\u00b3']);
const encoder = new TextEncoder();

export function isReservedName(base) {
  const stem = String(base).split('.')[0].replace(/[ ]+$/, '').toLowerCase();
  return RESERVED.has(stem);
}

function clipBytes(text, maxBytes) {
  if (encoder.encode(text).length <= maxBytes) return text;
  let out = '';
  for (const ch of text) { if (encoder.encode(out + ch).length > maxBytes) break; out += ch; }
  return out;
}

/**
 * @param {string} name   gewuenschter Name (z. B. Dokumenttitel), mit oder ohne Endung
 * @param {{extension?:string, fallback?:string, maxBytes?:number}} [opts]  extension ohne Punkt, z. B. 'mp3'
 */
export function safeFileName(name, {extension = '', fallback = 'beNotable', maxBytes = 120} = {}) {
  const ext = String(extension).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  const room = Math.max(8, maxBytes - (ext ? ext.length + 1 : 0));
  let base = String(name ?? '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^\.+/, '').replace(/[. ]+$/, '');
  base = clipBytes(base, room).replace(/[. ]+$/, '');
  if (!base) base = fallback;
  if (isReservedName(base)) base = `${base}_`;
  return ext ? `${base}.${ext}` : base;
}

/** Fuer den Build: gilt ein Pfad innerhalb eines ZIPs auf allen Systemen? Gibt eine Fehlerliste zurueck (leer = ok). */
export function portablePathProblems(path) {
  const problems = [];
  if (path.length > 180) problems.push('Pfad laenger als 180 Zeichen (Windows MAX_PATH 260 inkl. Zielordner)');
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..') problems.push('leere oder relative Komponente');
    else {
      if (/[<>:"\\|?*\u0000-\u001f]/.test(part)) problems.push(`Zeichen in "${part}" auf Windows verboten`);
      if (/[. ]$/.test(part)) problems.push(`"${part}" endet auf Punkt/Leerzeichen`);
      if (isReservedName(part)) problems.push(`"${part}" ist ein reservierter Windows-Name`);
      if (encoder.encode(part).length > 255) problems.push(`"${part}" ueber 255 Bytes`);
    }
  }
  return problems;
}
