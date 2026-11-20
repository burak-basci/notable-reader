/* beNotable! Reader web app · start (own code, MIT). Order matters: the adapter must exist before any extension module is evaluated (they read globalThis.chrome at load). */
import './web-runtime.mjs';
import {startHost} from './session/host.mjs';
document.documentElement.dataset.premium = 'off';      // the web app has no Premium: everything marked data-premium-ui stays hidden (reader.css)
document.documentElement.dataset.edition = 'web';
startHost();                                            // the engine host (the extension's offscreen document) runs in this page
await import('./tools/reader/reader.js');
const {installLast} = await import('./web-last.mjs'); installLast();   // "continue reading" after a reload: the last text stays on this device (finding M3)
if ('serviceWorker' in navigator && globalThis.isSecureContext) {
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js', {scope: './'}).catch(() => {}); }, {once: true});   // offline shell; failing to register never blocks reading
}
