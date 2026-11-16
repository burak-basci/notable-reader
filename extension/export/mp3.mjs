/* beNotable! Reader · Export: lamejs (LGPL-3.0, getrennt austauschbar) erst bei Bedarf laden. MIT. */
let loader = () => import('../tools/reader/vendor/export/lamejs.js');
// Tests und Buildvarianten können den Ladeweg ersetzen; die Datei selbst bleibt unverändert im Paket.
export const setMp3Loader = fn => { loader = fn; };
export async function createMp3Encoder(rate, kbps = 64) {
  const { Mp3Encoder } = await loader();
  return new Mp3Encoder(1, rate, kbps);
}
