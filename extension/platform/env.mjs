// Browser-, Betriebssystem- und Faehigkeitserkennung. Reine Funktionen: alles Globale kommt als Argument (Standard globalThis),
// damit Tests Chrome/Firefox/Windows/macOS ohne Browser nachstellen. Kein Netz, kein Speicherzugriff, keine Nutzerdaten.
const lower = value => (typeof value === 'string' ? value : '').toLowerCase();

/** @returns {'windows'|'mac'|'linux'|'android'|'chromeos'|'other'} */
export function detectOS(g = globalThis) {
  const nav = g.navigator || {};
  const hint = lower(nav.userAgentData?.platform), platform = lower(nav.platform), ua = lower(nav.userAgent);
  const text = `${hint} ${platform} ${ua}`;
  if (/android/.test(text)) return 'android';
  if (/cros|chrome os/.test(text)) return 'chromeos';
  if (/win/.test(hint || platform) || /windows/.test(ua)) return 'windows';
  if (/mac|iphone|ipad/.test(hint || platform) || /macintosh|mac os x/.test(ua)) return 'mac';
  if (/linux|x11/.test(text)) return 'linux';
  return 'other';
}

/** family: 'gecko' (Firefox) oder 'chromium' (Chrome, Edge, Brave, Opera ...). */
export function detectBrowser(g = globalThis) {
  const nav = g.navigator || {}, ua = nav.userAgent || '';
  const gecko = typeof g.browser?.runtime?.getBrowserInfo === 'function' || (/\bFirefox\/\d/.test(ua) && !/Seamonkey/i.test(ua));
  if (gecko) return {name: 'firefox', family: 'gecko', major: major(ua, /Firefox\/(\d+)/)};
  if (nav.brave) return {name: 'brave', family: 'chromium', major: major(ua, /Chrome\/(\d+)/)};
  if (/\bEdg\/\d/.test(ua)) return {name: 'edge', family: 'chromium', major: major(ua, /Edg\/(\d+)/)};
  if (/\bOPR\/\d/.test(ua)) return {name: 'opera', family: 'chromium', major: major(ua, /OPR\/(\d+)/)};
  if (/\bChrom(e|ium)\/\d/.test(ua)) return {name: 'chrome', family: 'chromium', major: major(ua, /Chrom(?:e|ium)\/(\d+)/)};
  return {name: 'unknown', family: 'unknown', major: null};
}

function major(ua, pattern) { const m = pattern.exec(ua || ''); return m ? Number(m[1]) : null; }

/**
 * Wo laeuft die Synthese-Engine (Worker + Audio)? Der Hintergrund-Service-Worker von Chrome hat weder Worker noch Audio
 * (gemessen: typeof Worker === 'undefined'), dort traegt ein Offscreen-Dokument den Host. Firefox hat keine Offscreen-Seite,
 * die Hintergrund-Ereignisseite hat DOM, Worker und Audio. Erweiterungsseiten (Popup, Fokus, Reader) brauchen keinen Host.
 * @returns {'in-page'|'offscreen'|'background-page'|'unavailable'}
 */
export function engineHostKind(g = globalThis) {
  const hasDom = typeof g.document !== 'undefined' && typeof g.Worker === 'function';
  if (hasDom) return 'in-page';
  const api = g.chrome || g.browser || {};
  if (api.offscreen && typeof api.offscreen.createDocument === 'function') return 'offscreen';
  return 'unavailable';
}

/** Welcher Mechanismus legt/erreicht den Host? (Hintergrundseite von Firefox hat selbst DOM -> 'in-page' dort, sonst 'offscreen'). */
export function hostStrategy(browser = detectBrowser(), g = globalThis) {
  if (browser.family === 'gecko') return 'background-page';
  return typeof g.chrome?.offscreen?.createDocument === 'function' ? 'offscreen' : 'unavailable';
}

/**
 * Anzahl WASM-Threads fuer onnxruntime-web. Ohne Cross-Origin-Isolation gibt es keinen SharedArrayBuffer, also genau 1.
 * Sonst min(4, Kerne/2), bei wenig Arbeitsspeicher (navigator.deviceMemory < 4) hoechstens 2. Gemessen 08.11.2026 (Piper high, 4 Threads
 * RTF 0,37 statt 1,3 mit einem); mehr als 4 bringt laut Kokoro-q8-Messung kaum etwas (8 Threads 0,81 gegen 4 Threads 0,90).
 */
export function wasmThreads({isolated, cores, memoryGB} = {}) {
  if (isolated !== true) return 1;
  const c = Number.isFinite(cores) && cores > 0 ? Math.floor(cores) : 2;
  let n = Math.max(1, Math.min(4, Math.floor(c / 2)));
  if (Number.isFinite(memoryGB) && memoryGB < 4) n = Math.min(n, 2);
  return n;
}

/** Faehigkeiten der aktuellen Umgebung ohne etwas zu starten. */
export function platformInfo(g = globalThis) {
  const nav = g.navigator || {};
  const browser = detectBrowser(g);
  const isolated = g.crossOriginIsolated === true && typeof g.SharedArrayBuffer === 'function';
  return {
    browser, os: detectOS(g), host: engineHostKind(g), isolated,
    threads: wasmThreads({isolated, cores: nav.hardwareConcurrency, memoryGB: nav.deviceMemory}),
    opfs: typeof nav.storage?.getDirectory === 'function',
    webgpu: typeof nav.gpu?.requestAdapter === 'function',
    speech: typeof g.speechSynthesis?.speak === 'function',
    audio: typeof g.AudioContext === 'function' || typeof g.webkitAudioContext === 'function'
  };
}

/** chrome.* gibt es in Chrome-MV3 und Firefox-MV3 (Promises). Fuer aeltere Firefox-Wege bleibt browser.* der Rueckfall. */
export function extensionApi(g = globalThis) { return g.chrome?.runtime?.id ? g.chrome : g.browser?.runtime?.id ? g.browser : null; }

/** Protokoll der eigenen Erweiterungsseiten ('chrome-extension:' oder 'moz-extension:'), ohne die Build-Ersetzung noetig zu machen. */
export function extensionProtocol(g = globalThis) {
  try { return new URL(extensionApi(g).runtime.getURL('/')).protocol; } catch { return null; }
}
