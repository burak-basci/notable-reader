/* beNotable! Reader · Export: PCM-Umwandlung und WAV-Kopf. MIT. */
export const BLOCK = 1152; // MP3-Rahmen: Encoder bekommt immer gleich große Blöcke

export function pcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i])) : 0;
    out[i] = Math.round(v * (v < 0 ? 32768 : 32767));
  }
  return out;
}
export function waveHeader(samples, rate) {
  const bytes = new Uint8Array(44), view = new DataView(bytes.buffer);
  const put = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  put(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); put(8, 'WAVE'); put(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  put(36, 'data'); view.setUint32(40, samples * 2, true);
  return bytes;
}
export const bytesOf = v => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
export const WAV_MAX_SAMPLES = Math.floor((0xffffffff - 36) / 2);

// Prüft eine Engine-Ausgabe und liefert {pcm, rate, peak}. Wirft verständliche Fehler.
export function checkSynthesis(result, text, expectedRate) {
  const pcm = result?.pcm ?? result?.samples, rate = result?.sampleRate;
  if (!(pcm instanceof Float32Array) || !pcm.length || !Number.isInteger(rate) || rate < 8000 || rate > 192000) throw new Error('Die lokale Stimme hat keine vollständigen Audiodaten geliefert.');
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) { const v = pcm[i]; if (!Number.isFinite(v)) throw new Error('Die lokale Stimme hat ungültige Audiodaten geliefert. Bitte den Export erneut starten.'); const a = v < 0 ? -v : v; if (a > peak) peak = a; }
  if (!peak && /[\p{L}\p{N}]/u.test(text)) throw new Error('Die lokale Stimme hat für diesen Text keine hörbaren Audiodaten geliefert.');
  if (expectedRate && rate !== expectedRate) throw new Error('Die Abtastrate hat sich während des Exports geändert. Bitte erneut versuchen.');
  if (pcm.length > rate * 180) throw new Error('Ein Sprachabschnitt ist unerwartet groß. Der Export wurde sicher angehalten.');
  return { pcm, rate, peak };
}
