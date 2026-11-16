/* beNotable! Reader playback · mono 16-bit PCM WAV from Float32 samples (own code, MIT). */
export const WAV_HEADER_BYTES = 44;
export function encodeWav(pcm, sampleRate) {
  if (!(pcm instanceof Float32Array)) throw new TypeError('pcm muss ein Float32Array sein');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Ungültige Abtastrate');
  const dataBytes = pcm.length * 2, out = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes), view = new DataView(out);
  const tag = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  tag(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE'); tag(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i], s = v !== v ? 0 : v > 1 ? 1 : v < -1 ? -1 : v;
    view.setInt16(WAV_HEADER_BYTES + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return new Uint8Array(out);
}
/* Held look-ahead audio is kept as 16-bit samples (half the memory of Float32); the round trip is exact for what encodeWav writes (same scaling). */
export function floatToInt16(pcm) {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) { const v = pcm[i], s = v !== v ? 0 : v > 1 ? 1 : v < -1 ? -1 : v; out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff); }
  return out;
}
export function int16ToFloat(pcm16) {
  const out = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) { const v = pcm16[i]; out[i] = v < 0 ? v / 0x8000 : v / 0x7fff; }
  return out;
}
