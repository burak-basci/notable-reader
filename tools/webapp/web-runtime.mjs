/* beNotable! Reader web app · browser adapter (own code, MIT).
   The extension modules (session/page-session.mjs, session/host.mjs, tools/reader/reader.js ...) talk to a small subset of the extension API: runtime.sendMessage / onMessage /
   connect / onConnect / getURL / getManifest, storage.local (+ onChanged) and storage.session. A web page has none of it. This file provides exactly that subset IN THE PAGE, so the
   web app runs the SAME modules as the extension (one code base): the "service worker" is a tiny message router below, the "offscreen document" is startHost() running in this page
   (session/host.mjs), settings and reading places live in localStorage (own prefix), the file view's temporary export files in OPFS/IndexedDB (export/, unchanged).
   Not provided on purpose: tabs, scripting, downloads, permissions, alarms (no Premium, no Focus tab hand-over, no global shortcuts). Nothing here sends document text anywhere. */
const BASE = new URL('./', import.meta.url).href;          // the app root (this file sits in it)
const VERSION = '__WEB_VERSION__';                          // replaced by tools/build-webapp.mjs
const PREFIX = 'notable.web.';
const clone = value => value === undefined ? undefined : structuredClone(value);

/* -- events ------------------------------------------------------------------------------------------------------------------------------------------ */
function emitter() {
  const listeners = new Set();
  return {addListener: fn => { listeners.add(fn); }, removeListener: fn => { listeners.delete(fn); }, hasListener: fn => listeners.has(fn), get listeners() { return [...listeners]; }};
}

/* -- storage ----------------------------------------------------------------------------------------------------------------------------------------- */
function memoryBacking() { const map = new Map(); return {keys: () => [...map.keys()], get: k => map.get(k) ?? null, set: (k, v) => { map.set(k, v); }, remove: k => { map.delete(k); }}; }
function webBacking(storage, label) {
  try { const probe = PREFIX + 'probe'; storage.setItem(probe, '1'); storage.removeItem(probe); } catch { return memoryBacking(); }   // private window / blocked site data: the page still works, nothing persists
  return {
    keys: () => { const out = []; for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith(PREFIX + label + '.')) out.push(k.slice((PREFIX + label + '.').length)); } return out; },
    get: k => storage.getItem(PREFIX + label + '.' + k), set: (k, v) => storage.setItem(PREFIX + label + '.' + k, v), remove: k => storage.removeItem(PREFIX + label + '.' + k),
  };
}
function storageArea(backing, areaName, onChanged) {
  const parse = raw => { if (raw === null) return undefined; try { return JSON.parse(raw); } catch { return undefined; } };
  const read = k => parse(backing.get(k));
  const change = (changes) => { if (Object.keys(changes).length) queueMicrotask(() => { for (const fn of onChanged.listeners) { try { fn(clone(changes), areaName); } catch {} } }); };
  return {
    async get(keys = null) {
      if (keys === null || keys === undefined) return Object.fromEntries(backing.keys().map(k => [k, read(k)]).filter(([, v]) => v !== undefined));
      const out = {};
      if (typeof keys === 'string') keys = [keys];
      if (Array.isArray(keys)) { for (const k of keys) { const v = read(k); if (v !== undefined) out[k] = v; } return out; }
      for (const [k, fallback] of Object.entries(keys)) { const v = read(k); out[k] = v === undefined ? clone(fallback) : v; }
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items || {})) {
        if (v === undefined) continue;
        const old = read(k), text = JSON.stringify(v); backing.set(k, text); changes[k] = {...(old !== undefined ? {oldValue: old} : {}), newValue: clone(v)};
      }
      change(changes);
    },
    async remove(keys) {
      const changes = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) { const old = read(k); if (old === undefined) continue; backing.remove(k); changes[k] = {oldValue: old}; }
      change(changes);
    },
    async clear() { await this.remove(backing.keys()); },
    _external(k, raw, oldRaw) { change({[k]: {...(oldRaw !== null ? {oldValue: parse(oldRaw)} : {}), ...(raw !== null ? {newValue: parse(raw)} : {})}}); },
  };
}

/* -- messages ---------------------------------------------------------------------------------------------------------------------------------------- */
const messageListeners = emitter(), connectListeners = emitter(), storageChanged = emitter();
const sender = () => ({id: 'notable-reader-web', url: location.href, origin: location.origin});
/* chrome.runtime.sendMessage semantics inside one page: every listener sees a copy; the first one that answers (synchronously or after returning true) wins; no listener answering resolves undefined. */
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    let copy; try { copy = structuredClone(message); } catch (error) { reject(error); return; }
    let done = false, waiting = 0;
    const finish = value => { if (done) return; done = true; resolve(clone(value)); };
    // asynchronous like the real API (the caller never runs inside the handler)
    queueMicrotask(() => {
      for (const fn of messageListeners.listeners) {
        let result;
        try { result = fn(copy, sender(), finish); } catch { continue; }
        if (done) return;
        if (result === true) waiting++;
      }
      if (!waiting && !done) finish(undefined);
    });
  });
}
function makePort(name) {
  const make = () => ({name, onMessage: emitter(), onDisconnect: emitter(), closed: false, sender: sender(), peer: null,
    postMessage(message) {
      if (this.closed) throw new Error('Attempting to use a disconnected port object');
      const copy = structuredClone(message), peer = this.peer; setTimeout(() => { if (!peer.closed) for (const fn of peer.onMessage.listeners) { try { fn(copy, peer); } catch {} } }, 0);
    },
    disconnect() { if (this.closed) return; this.closed = true; const peer = this.peer; peer.closed = true; setTimeout(() => { for (const fn of peer.onDisconnect.listeners) { try { fn(peer); } catch {} } }, 0); },
  });
  const a = make(), b = make(); a.peer = b; b.peer = a; return [a, b];
}
function connect(info = {}) {
  const [client, server] = makePort(String(info.name || ''));
  setTimeout(() => { for (const fn of connectListeners.listeners) { try { fn(server); } catch {} } }, 0);
  return client;
}

/* -- the "worker": answers the messages the extension's service worker answers, as far as the web app has them ------------------------------------------ */
const worker = (message, from, respond) => {
  if (message?.t === 'ensureHost') { respond({ok: true}); return false; }                                 // the host (engine) is this page: always there
  if (message?.type === 'premiumStatus' || message?.t === 'premium') { respond({ok: true, premium: {enabled: true, status: 'free', mode: 'website'}}); return false; }   // downloads are free here, nothing to buy
  if (message?.t === 'openFlags') { respond({ok: false}); return false; }                                   // a page cannot open chrome:// addresses: the bar copies the address instead
  if (message?.t === 'settingsFile') { respond({ok: false, reason: 'unsupported'}); return false; }         // no downloads API: the settings backup is a normal browser download
  return false;
};
messageListeners.addListener(worker);

const local = storageArea(webBacking(globalThis.localStorage, 'local'), 'local', storageChanged);
const session = storageArea(webBacking(globalThis.sessionStorage, 'session'), 'session', storageChanged);
// another tab wrote a setting: the sessions of this tab follow (the same event the extension fires for the options page and other tabs)
addEventListener('storage', event => { if (event.storageArea === localStorage && event.key?.startsWith(PREFIX + 'local.')) local._external(event.key.slice((PREFIX + 'local.').length), event.newValue, event.oldValue); });

const runtime = {
  id: 'notable-reader-web', web: true, lastError: undefined,
  getURL: path => new URL(String(path || ''), BASE).href,
  getManifest: () => ({name: 'beNotable! Reader', version: VERSION, manifest_version: 3}),
  getPlatformInfo: async () => ({os: /Win/.test(navigator.platform) ? 'win' : /Mac/.test(navigator.platform) ? 'mac' : /Linux|X11/.test(navigator.platform) ? 'linux' : 'unknown', arch: 'unknown'}),
  sendMessage, connect,
  onMessage: messageListeners, onConnect: connectListeners,
};
const api = {runtime, storage: {local, session, onChanged: storageChanged}};
globalThis.chrome = api;
globalThis.browser = api;
export {api};
