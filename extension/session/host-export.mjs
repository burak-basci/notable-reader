/* Downloads of the page bar, made where the voice already lives (round 4, owner request: "es kann doch einfach direkt von dort runter laden"):
   the engine host (Chrome offscreen document) builds the file and hands it to the browser's downloads, no reader tab opens and no tab changes.
   MP3 / WAV: the host's own engine (the voice is already loaded for reading); PDF: the reading text in the page's current appearance (Night mode
   colors); HTML: the snapshot the page made of itself (session/page-snapshot.mjs). Progress goes to the asking page through the service worker
   (an offscreen document has no tabs API); Cancel / "Save again" come from that page with the job's token. Own code, MIT. */
const UTF8 = new TextEncoder();
/* the same file names as the file view (tools/reader/reader.js safeName): Windows-safe, at most 120 bytes */
export function exportName(title, format) {
  let base = ''; for (const ch of String(title || '').replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()) { if (UTF8.encode(base + ch).length > 120) break; base += ch; }
  base = base.replace(/[. ]+$/, '') || 'notable-reader'; if (/^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i.test(base.split('.')[0].trim())) base = '_' + base;
  return base + '.' + format;
}

export function serveExports(api, {engine, hold = () => () => {}, document: doc = globalThis.document}) {
  const jobs = new Map();
  const relay = (job, state) => { job.state = state.state; try { Promise.resolve(api.runtime.sendMessage({t: 'exportRelay', token: job.token, tabId: job.tabId, frameId: job.frameId, job: state})).catch(() => {}); } catch {} };
  /* the browser's own download of a file made here (no permission: an anchor in this extension document) */
  const save = (blob, filename) => { const url = URL.createObjectURL(blob), a = doc.createElement('a'); a.href = url; a.download = filename; doc.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 120000); };
  async function run(job, m) {
    const kind = ['mp3', 'wav'].includes(m.format) ? 'audio' : 'document', release = hold('export');
    relay(job, {state: 'running', kind, percent: 0, completedChunks: 0, totalChunks: 1});
    try {
      let blob, filename = exportName(m.title, m.format);
      if (m.format === 'html') blob = new Blob([m.html], {type: 'text/html;charset=utf-8'});
      else if (m.format === 'pdf') {
        const {documentPdf} = await import('../tools/reader/document-export.mjs');
        const result = await documentPdf(m.doc.text, m.title, m.appearance || {}, {signal: job.controller.signal, onProgress: info => relay(job, {state: 'running', kind, ...pick(info)})});
        blob = result.blob;
      } else {
        const {AudiobookExporter} = await import('../export/index.mjs');
        job.exporter = new AudiobookExporter({engine});
        const result = await job.exporter.export({text: m.doc.text, title: m.title, modelId: m.modelId, format: m.format, split: 'single', detectChapters: true, signal: job.controller.signal, reading: m.reading, normalize: m.normalize !== false, lang: m.lang || '', onProgress: info => relay(job, {state: 'running', kind, ...pick(info)})});
        const file = result.files[0]; blob = file.blob; filename = file.filename || filename;
        try { const {saveAudio} = await import('../library/store.mjs'); await saveAudio({blob, title: m.title, voice: m.modelId, format: m.format, filename}); } catch {}   // the library keeps finished audio, as from the file view
      }
      if (job.controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
      job.result = {blob, filename}; save(blob, filename);
      relay(job, {state: 'complete', kind, percent: 100, filename, resultReady: true});
    } catch (error) {
      const cancelled = job.controller.signal.aborted || error?.name === 'AbortError';
      relay(job, {state: cancelled ? 'cancelled' : 'error', kind, errorKey: cancelled ? '' : 'export_failed'});
    } finally { job.exporter = null; release(); }
  }
  const pick = info => Object.fromEntries(['percent', 'completedChunks', 'totalChunks'].filter(k => Number.isFinite(info?.[k])).map(k => [k, info[k]]));
  api.runtime.onMessage.addListener((m, sender, respond) => {
    /* start: only from the service worker (it checked the asking page and frame) */
    if (m?.target === 'host-export' && m.t === 'start' && sender?.id === api.runtime.id && !sender.tab) {
      if ([...jobs.values()].some(job => job.state === 'running')) { respond({ok: false, code: 'busy'}); return false; }
      const job = {token: m.token, tabId: m.tabId, frameId: m.frameId, controller: new AbortController(), state: 'running', result: null};
      for (const [token, old] of jobs) if (old.tabId === m.tabId) jobs.delete(token);
      jobs.set(m.token, job); void run(job, m); respond({ok: true}); return false;
    }
    /* Cancel / "Save again" from the page that asked (its tab and the job's token) */
    if (m?.t === 'exportCommand' && sender?.id === api.runtime.id && sender.tab) {
      const job = jobs.get(m.token); if (!job || job.tabId !== sender.tab.id) return false;
      if (m.command === 'cancel') { job.controller.abort(); job.exporter?.cancel?.(); respond({ok: true}); }
      else if (m.command === 'download' && job.result) { save(job.result.blob, job.result.filename); respond({ok: true}); }
      else respond({ok: false});
      return false;
    }
    return false;
  });
  return {jobs};
}
