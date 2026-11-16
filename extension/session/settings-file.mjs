/* beNotable! Reader · saving the exported settings file and "show file in folder" (own code, MIT).
   The permission "downloads" is OPTIONAL (manifest optional_permissions): it is requested by permissions.request on the first click on "Export settings", never at installation (no install warning, the store review
   sees no extra permission). With the permission the file is saved through downloads.download and downloads.show(id) opens the file manager with the file selected. Without it (declined, or in a page where the
   browser gives no permission API: the bar is a content script) the caller falls back to <a download> and tells the file name. No native messaging, no other permission.
   Two environments, ONE api:  extension page (popup, options, file view): chrome.downloads / chrome.permissions directly.  Content script (bar): the same calls go through the worker
   (message {t:'settingsFile'}), which only saves when the permission has been granted before. */
const FILE_MESSAGE = 'settingsFile', FILE_NAME = /^benotable-reader-einstellungen-\d{4}-\d{2}-\d{2}\.json$/, MAX_FILE_BYTES = 70000;
/* never wait forever: a worker that sleeps or a permission prompt that nobody answers must not leave the export button without effect (the caller then falls back to the plain download) */
export const within = (promise, ms, fallback) => new Promise(resolve => { const timer = setTimeout(() => resolve(fallback), ms); Promise.resolve(promise).then(v => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(fallback); }); });
export const WORKER_WAIT_MS = 3000, PROMPT_WAIT_MS = 6000;
const dataUrl = body => 'data:application/json;charset=utf-8,' + encodeURIComponent(body);

/* Waits (at most `ms`) until the download is complete, so that "show in folder" has a finished file to select. */
function waitComplete(api, id, ms = 4000) {
  return new Promise(resolve => {
    let done = false; const end = v => { if (done) return; done = true; clearTimeout(timer); try { api.downloads.onChanged.removeListener(listener); } catch {} resolve(v); };
    const listener = delta => { if (delta.id === id && delta.state?.current === 'complete') end(true); else if (delta.id === id && delta.state?.current === 'interrupted') end(false); };
    const timer = setTimeout(() => end(false), ms);
    try { api.downloads.onChanged.addListener(listener); api.downloads.search({id}).then(r => { if (r?.[0]?.state === 'complete') end(true); }).catch(() => {}); } catch { end(false); }
  });
}
/* Worker side: save / show, only with the permission already granted. Returns the reply for the content script. */
export async function handleFileMessage(api, message) {
  if (!api?.permissions) return {ok: false, reason: 'unsupported'};
  const granted = await api.permissions.contains({permissions: ['downloads']}).catch(() => false);
  if (!granted || !api.downloads) return {ok: false, reason: 'permission'};   // without the grant chrome.downloads does not even exist
  if (message.op === 'show') { if (!Number.isSafeInteger(message.id) || message.id < 0) return {ok: false, reason: 'invalid'}; try { api.downloads.show(message.id); return {ok: true}; } catch { return {ok: false, reason: 'failed'}; } }
  if (message.op !== 'save' || typeof message.name !== 'string' || !FILE_NAME.test(message.name) || typeof message.body !== 'string' || message.body.length > MAX_FILE_BYTES) return {ok: false, reason: 'invalid'};
  try { JSON.parse(message.body); } catch { return {ok: false, reason: 'invalid'}; }
  try { const id = await api.downloads.download({url: dataUrl(message.body), filename: message.name, saveAs: false, conflictAction: 'uniquify'}); await waitComplete(api, id); return {ok: true, id}; } catch { return {ok: false, reason: 'failed'}; }
}
/* Page side. save(name, body) must be called DIRECTLY from the click handler (the permission prompt needs the user gesture). */
export function createFileApi(api = globalThis.chrome ?? globalThis.browser) {
  const direct = !!api?.permissions?.request;   // extension pages only; a content script has no permissions API (chrome.downloads itself only exists AFTER the grant)
  const viaWorker = message => within(api.runtime.sendMessage({t: FILE_MESSAGE, ...message}), WORKER_WAIT_MS, {ok: false, reason: 'timeout'}).then(r => r || {ok: false, reason: 'unsupported'});
  return {
    direct,
    async save(name, body) {
      if (!direct) return viaWorker({op: 'save', name, body});
      /* request FIRST and synchronously (the browser wants the click's user gesture; an await before it can lose it); when the browser refuses the call itself (no gesture) an earlier grant still counts */
      let granted = false; try { granted = await within(api.permissions.request({permissions: ['downloads']}), PROMPT_WAIT_MS, false); } catch { granted = false; }
      if (!granted) granted = await within(api.permissions.contains({permissions: ['downloads']}), 1500, false);
      if (!granted) return {ok: false, reason: 'denied'};
      return handleFileMessage(api, {op: 'save', name, body});
    },
    async show(id) {
      if (!Number.isSafeInteger(id)) return {ok: false, reason: 'invalid'};
      if (!direct) return viaWorker({op: 'show', id});
      return handleFileMessage(api, {op: 'show', id});
    },
  };
}
