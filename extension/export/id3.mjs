/* beNotable! Reader · Export: ID3v2.3-Kopf mit Titel und Kapitelmarken (CTOC/CHAP). MIT. */
const enc = new TextEncoder();
const u32 = n => new Uint8Array([n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]);
const syncsafe = n => new Uint8Array([n >>> 21 & 127, n >>> 14 & 127, n >>> 7 & 127, n & 127]);
const cat = parts => { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const ascii = s => enc.encode(s);
function utf16(text) { // Kodierung 1: UTF-16 mit BOM, little endian
  const s = String(text), out = new Uint8Array(2 + s.length * 2); out[0] = 0xff; out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[2 + i * 2] = c & 255; out[3 + i * 2] = c >> 8; }
  return out;
}
const frame = (id, body) => cat([ascii(id), u32(body.length), new Uint8Array(2), body]);
const textFrame = (id, text) => frame(id, cat([new Uint8Array([1]), utf16(text), new Uint8Array([0, 0])]));

// chapters: [{title, startSec, endSec}] — gibt Uint8Array des gesamten Tags zurück.
export function id3Tag({ title, chapters = [] }) {
  const frames = [];
  if (title) frames.push(textFrame('TIT2', title));
  if (chapters.length > 1) {
    const ids = chapters.map((_, i) => `chp${i}`);
    frames.push(frame('CTOC', cat([ascii('toc'), new Uint8Array([0, 3, ids.length]), ...ids.map(id => cat([ascii(id), new Uint8Array([0])]))])));
    chapters.forEach((c, i) => frames.push(frame('CHAP', cat([ascii(ids[i]), new Uint8Array([0]), u32(Math.round(c.startSec * 1000)), u32(Math.round(c.endSec * 1000)), u32(0xffffffff), u32(0xffffffff), textFrame('TIT2', c.title)]))));
  }
  if (!frames.length) return new Uint8Array(0);
  const body = cat(frames);
  return cat([ascii('ID3'), new Uint8Array([3, 0, 0]), syncsafe(body.length), body]);
}
