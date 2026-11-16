// Haelt eine Hintergrund-Ereignisseite (Firefox) bzw. den Service-Worker (Chrome) wach, solange gearbeitet wird (Wiedergabe, Synthese, Export).
// Firefox laut MDN: Ereignisseiten entladen nach kurzer Leerlaufzeit (Standard 30 s), offene Nachrichten-Ports verhindern das NICHT,
// sichtbare Ansichten schon; Erweiterungs-API-Aufrufe zaehlen als Aktivitaet. Daher: waehrend mindestens ein Halter aktiv ist, alle
// 20 s ein billiger API-Aufruf (runtime.getPlatformInfo). Die Wirkung in echtem Firefox ist UNGEPRUEFT (temporaer installierte Erweiterungen
// wurden im Test nie suspendiert, signierte Pakete sind lokal nicht installierbar); die Logik selbst ist per Fake-Uhr getestet.
export const KEEPALIVE_MS = 20000;

/**
 * @param {{ping:()=>unknown, setInterval?:Function, clearInterval?:Function, interval?:number}} deps
 * ping ruft eine Erweiterungs-API auf, z. B. () => chrome.runtime.getPlatformInfo()
 */
export function createKeepAlive({ping, setInterval: si = globalThis.setInterval, clearInterval: ci = globalThis.clearInterval, interval = KEEPALIVE_MS}) {
  const holders = new Set();
  let timer = null, pings = 0;
  const tick = () => { pings++; try { const r = ping(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch {} };
  const stop = () => { if (timer !== null) { ci(timer); timer = null; } };
  return {
    /** Liefert eine Freigabefunktion; mehrfaches Freigeben ist harmlos. */
    hold(label = 'work') {
      const token = Symbol(label);
      holders.add(token);
      if (timer === null) { tick(); timer = si(tick, interval); }
      return () => { holders.delete(token); if (holders.size === 0) stop(); };
    },
    get active() { return holders.size > 0; },
    get pings() { return pings; },
    dispose() { holders.clear(); stop(); }
  };
}
