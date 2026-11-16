/* beNotable! Reader · guided explanation, engine host side (own code, MIT).
   Lives in the engine host (Chrome offscreen document, Firefox background page): an extension page that is cross-origin
   isolated, so the model worker gets WASM threads, and that no web page can reach. Reading sessions (content scripts,
   the file view) connect with runtime.connect({name:'notable-explain'}).
   Messages: status -> tiers (installed, bytes); download {tier} -> progress until ready/error (only after the click in
   the card, the only network use); cancelDownload; plan {id, tier, language, anchors} -> raw step/summary answers of the
   worker (validated by the session); cancel {id}; skip {id, index} (the tour read that passage without explanation); remove {tier} (frees the model files, not while a plan or download runs). No page text is stored; the worker ends after a quiet minute. */
import {TIERS, offered, installed, manifest, downloadModel, removeModel} from './model-store.mjs';
export const TUTOR_PORT = 'notable-explain';
const IDLE_MS = 90000, TIER_IDS = Object.keys(TIERS), LANGS = ['de', 'en', 'fr', 'es', 'it', 'pt'];
const plain = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';

export function serveTutor(api = globalThis.chrome, {hold = () => () => {}, createWorker = () => new Worker(new URL('./worker.mjs', import.meta.url), {type: 'module'})} = {}) {
  const ports = new Set(), plans = new Map();
  let worker = null, idleTimer = 0, job = null;
  /* the model computes a whole answer without returning to the worker's event loop, so a 'skip' or 'cancel' message
     would only be read after it: this shared counter (cross-origin isolated host only) stops the running answer at once */
  const interrupt = globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function' ? new Int32Array(new SharedArrayBuffer(4)) : null;
  const stopAnswer = () => { if (interrupt) Atomics.add(interrupt, 0, 1); };
  /* every tier with its size and whether it is on the device; the shipped runtime is the plain WASM build, so a tier
     made for another device would not be available; 'legacy' is reported (it may still run) but never offered */
  async function tiers() {
    return Promise.all(TIER_IDS.map(async id => { try { const m = await manifest(id); return {id, offered: offered(id), available: (m.device || 'wasm') === 'wasm', device: m.device || 'wasm', installed: await installed(id), bytes: m.files.reduce((n, f) => n + f.bytes, 0), model: m.id, license: m.license}; } catch { return {id, offered: offered(id), available: false, installed: false, bytes: 0}; } }));
  }
  /* a current model is installed and nothing runs: the legacy copy is replaced, its space is freed */
  async function freeLegacy(list) {
    const legacy = list.find(x => x.id === 'legacy'); if (!legacy?.installed || job || plans.size || !list.some(x => x.offered && x.available && x.installed)) return;
    if (TIER_IDS.some(id => id !== 'legacy' && TIERS[id].cache === TIERS.legacy.cache)) return;   // never while a current tier shares that cache
    await removeModel('legacy').catch(() => {}); legacy.installed = false; legacy.replaced = true;
  }
  const broadcast = m => { for (const p of ports) { try { p.postMessage(m); } catch {} } };
  function startDownload(tier) {
    if (job) return;
    const abort = new AbortController(), release = hold('explain-model-download');
    job = {tier, abort, loaded: 0, total: 0};
    broadcast({t: 'download', tier, phase: 'download', loaded: 0, total: 0});
    let last = 0;
    downloadModel({tier, signal: abort.signal, onProgress: p => { if (!job) return; job.loaded = p.loaded; job.total = p.total; const now = Date.now(); if (now - last > 250) { last = now; broadcast({t: 'download', tier, phase: 'download', loaded: p.loaded, total: p.total}); } }})
      .then(() => broadcast({t: 'download', tier, phase: 'ready', loaded: job?.total || 0, total: job?.total || 0}))
      .catch(error => broadcast({t: 'download', tier, phase: error?.name === 'AbortError' ? 'cancelled' : 'error', code: plain(error?.code, 40) || (error?.name === 'AbortError' ? 'cancelled' : 'download_failed')}))
      .finally(() => { job = null; release(); });
  }
  function ensureWorker() {
    clearTimeout(idleTimer); idleTimer = 0;
    if (worker) return worker;
    worker = createWorker();
    worker.onmessage = ({data: r}) => {
      const plan = plans.get(r?.id); if (!plan) return;
      if (['step', 'summary', 'progress', 'timing'].includes(r.type)) plan.port.postMessage({...r, t: r.type, type: undefined});
      if (r.type === 'done' || r.type === 'error') { plan.port.postMessage({t: r.type, id: r.id, code: plain(r.code, 40) || (r.type === 'error' ? 'failed' : '')}); plans.delete(r.id); plan.release(); idle(); }
    };
    worker.onerror = () => { for (const [id, plan] of plans) { plan.port.postMessage({t: 'error', id, code: 'worker'}); plan.release(); } plans.clear(); worker?.terminate(); worker = null; };
    return worker;
  }
  function idle() { if (plans.size || idleTimer) return; idleTimer = setTimeout(() => { idleTimer = 0; if (!plans.size && worker) { worker.terminate(); worker = null; } }, IDLE_MS); }
  function cancel(id) { const plan = plans.get(id); if (!plan) return; plans.delete(id); plan.release(); worker?.postMessage({type: 'cancel', id}); stopAnswer(); idle(); }
  const onConnect = port => {
    if (port.name !== TUTOR_PORT) return;
    if (port.sender?.id !== api.runtime.id) { port.disconnect(); return; }   // only this extension's own pages and content scripts
    ports.add(port);
    port.onMessage.addListener(async m => {
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'status') { const list = await tiers().catch(() => []); await freeLegacy(list); port.postMessage({t: 'status', tiers: list, preferred: ['better', 'small', 'legacy'].find(id => list.some(x => x.id === id && x.available && x.installed)) || 'small', download: job ? {tier: job.tier, state: 'running', loaded: job.loaded, total: job.total} : null}); return; }
      if (m.t === 'download' && offered(m.tier)) { startDownload(m.tier); return; }
      if (m.t === 'cancelDownload') { job?.abort.abort(); return; }
      if (m.t === 'remove' && TIER_IDS.includes(m.tier)) { if (!job && !plans.size) { worker?.terminate(); worker = null; await removeModel(m.tier).catch(() => {}); } port.postMessage({t: 'removed', tier: m.tier}); return; }
      if (m.t === 'cancel') { cancel(m.id); return; }
      if (m.t === 'skip') { if (plans.get(m.id)?.port === port && worker) { worker.postMessage({type: 'skip', id: m.id, index: Number(m.index) | 0}); stopAnswer(); } return; }   // a passage the tour no longer waits for
      if (m.t === 'plan' && typeof m.id === 'string' && /^[\w-]{1,64}$/.test(m.id) && Array.isArray(m.anchors)) {
        for (const [id, plan] of plans) if (plan.port === port) cancel(id);   // one tour per session
        const release = hold('explain-plan');
        plans.set(m.id, {port, release});
        ensureWorker().postMessage({type: 'tutor', id: m.id, tier: TIER_IDS.includes(m.tier) ? m.tier : 'small', language: LANGS.includes(m.language) ? m.language : 'en', anchors: m.anchors.slice(0, 16), summary: true, interrupt: interrupt?.buffer || null});
      }
    });
    port.onDisconnect.addListener(() => { ports.delete(port); for (const [id, plan] of plans) if (plan.port === port) cancel(id); });
  };
  api.runtime.onConnect.addListener(onConnect);
  return {dispose() { api.runtime.onConnect.removeListener(onConnect); for (const id of [...plans.keys()]) cancel(id); clearTimeout(idleTimer); idleTimer = 0; worker?.terminate(); worker = null; job?.abort.abort(); }, get busy() { return plans.size > 0 || !!job; }};
}
