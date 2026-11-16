// Follow active reading surfaces. Watcher reads metadata only, never document text.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createPdfJsAdapter} from './pdfjs-adapter.mjs';
import {collectHtmlBlocks,artifactFrame} from './html-content.mjs';

const execute = promisify(execFile);
const cdpOrigin=process.env.READER_CDP_ENDPOINT||'http://127.0.0.1:9333';
const cdpPort=cdpOrigin.match(/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/)?.[1];
if(!cdpPort||Number(cdpPort)>65535)throw Error('Invalid loopback CDP endpoint');
const DEFAULT_ENDPOINT=cdpOrigin+'/json/list';
const PDF_EXTENSION = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';
const PAGE_STATE = '({visible:document.visibilityState==="visible",focused:document.hasFocus()})';
const PDFJS_STATE = `(()=>{const url=location.origin+location.pathname;const v=(${createPdfJsAdapter.toString()})(url);return {url:v?.originalUrl||null,ready:!!v,generation:performance.timeOrigin,rendererInstance:v?.rendererInstance||null};})()`;
const PDF_STATE = `(()=>{const v=document.querySelector('pdf-viewer');return {
  url:typeof v?.originalUrl==='string'?v.originalUrl:null,
  ready:!!(v?.viewport&&v.shadowRoot&&v.documentDimensions?.pageDimensions?.length),
  generation:performance.timeOrigin
};})()`;
const HTML_STATE = `(()=>{if(!/^https?:$/.test(location.protocol))return {ready:false};const {ready}=(${collectHtmlBlocks.toString()})({metadataOnly:true});return {
  url:location.origin+location.pathname,ready,generation:performance.timeOrigin
};})()`;

async function desktopClients(signal) {
  const {stdout} = await execute('hyprctl', ['clients', '-j'], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 2 * 1024 * 1024, signal,
  });
  return JSON.parse(stdout);
}

function metadata(target, expression, signal, sockets) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Stopped')); return; }
    let socket, done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (socket) {
        sockets.delete(socket);
        try { socket.close(); } catch {}
      }
      if (error) reject(new Error('Browser metadata unavailable'));
      else resolve(value);
    };
    const abort = () => finish(true);
    const timer = setTimeout(abort, 3000);
    signal.addEventListener('abort', abort, {once: true});
    try {
      socket = new WebSocket(target.webSocketDebuggerUrl);
      sockets.add(socket);
      socket.addEventListener('open', () => {
        if (done) return;
        try {
          socket.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {
            expression, returnByValue: true,
          }}));
        } catch { finish(true); }
      });
      socket.addEventListener('message', event => {
        if (done) return;
        try {
          const message = JSON.parse(event.data);
          if (message.id !== 1) return;
          if (message.error || message.result?.exceptionDetails) finish(true);
          else finish(false, message.result?.result?.value);
        } catch { finish(true); }
      });
      socket.addEventListener('error', () => finish(true));
      socket.addEventListener('close', () => finish(true));
    } catch { finish(true); }
  });
}

export function createWatcher({endpoint = DEFAULT_ENDPOINT, readClients = desktopClients,
                               intervalMs = 1000, emit = message => {
                                 process.stdout.write(JSON.stringify(message) + '\n');
                               }} = {}) {
  let stopped = false, timer = null, lastKey = null, lastContext = null, running = null;
  const controller = new AbortController(), sockets = new Set();
  const signal = controller.signal;

  async function inspect() {
    const [targets, clients] = await Promise.all([
      fetch(endpoint, {signal: AbortSignal.any([signal, AbortSignal.timeout(3000)])})
        .then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); }),
      readClients(signal),
    ]);
    if (stopped || !Array.isArray(targets) || !Array.isArray(clients)) return;
    if(lastContext&&(!targets.some(t=>t.id===lastContext.targetId)||
      (lastContext.viewerTargetId&&!targets.some(t=>t.id===lastContext.viewerTargetId)))){
      emit({type:'gone',targetId:lastContext.targetId,context:lastContext});lastContext=null;lastKey=null;
    }
    const brave = clients.filter(client => client.class === 'brave-browser' &&
      client.mapped !== false && client.hidden !== true &&
      Number.isFinite(client.focusHistoryID) && client.focusHistoryID >= 0)
      .sort((a, b) => a.focusHistoryID - b.focusHistoryID)[0];
    if (!brave || typeof brave.title !== 'string') return;
    const title = brave.title.replace(/ - Brave$/, '');
    const pages = targets.filter(target => target.type === 'page' && target.title === title);
    let page;
    if (pages.length === 1) page = pages[0];
    else if (pages.length > 1) {
      const states = await Promise.all(pages.map(async candidate => {
        try { return {page: candidate, state: await metadata(candidate, PAGE_STATE, signal, sockets)}; }
        catch { return {page: candidate, state: null}; }
      }));
      const visible = states.filter(item => item.state?.visible === true);
      const focused = visible.filter(item => item.state?.focused === true);
      if (focused.length === 1) page = focused[0].page;
      else if (visible.length === 1) page = visible[0].page;
    }
    if (!page) return;
    const viewers = targets.filter(target => target.parentId === page.id &&
      typeof target.url === 'string' && target.url.startsWith(PDF_EXTENSION));
    if (viewers.length > 1) return;
    const viewer = viewers[0] || page;
    const frame = viewers.length ? null : artifactFrame(page, targets);
    const renderer = viewers.length ? null : (await metadata(page, PDFJS_STATE, signal, sockets).catch(()=>null))?.ready ? 'pdfjs' : null;
    const state = viewers.length ? await metadata(viewer, PDF_STATE, signal, sockets) :
      renderer ? await metadata(page, PDFJS_STATE, signal, sockets) : await metadata(frame || page, HTML_STATE, signal, sockets);
    if(stopped)return;
    if(state?.ready!==true||typeof state.url!=='string'||!state.url){
      if(lastContext?.targetId===page.id){emit({type:'gone',targetId:lastContext.targetId,context:lastContext});lastContext=null;lastKey=null;}
      return;
    }
    const context = renderer || viewers.length ?
      {targetId: page.id, viewerTargetId: viewer.id, kind: 'pdf', url: state.url,documentGeneration:state.generation, ...(renderer ? {renderer,rendererInstance:state.rendererInstance} : {})} :
      frame ? {targetId: page.id, viewerTargetId: null, frameTargetId: frame.id, frameUrl: state.url, kind: 'html', url: page.url.split(/[?#]/)[0], documentGeneration:state.generation} :
      {targetId: page.id, viewerTargetId: null, kind: 'html', url: state.url,documentGeneration:state.generation};
    const key = JSON.stringify([context.targetId, context.viewerTargetId, context.frameTargetId, context.url, state.generation, state.rendererInstance]);
    if (key !== lastKey) {
      lastKey = key;lastContext=context;
      emit({type: 'context', context});
    }
  }

  async function tick() {
    try { await inspect(); } catch { /* Retry without logging browser metadata. */ }
    finally { if (!stopped) timer = setTimeout(startTick, Math.max(100, intervalMs)); }
  }
  function startTick() {
    if (!stopped) running = tick();
  }
  startTick();
  return {
    async close() {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
      for (const socket of sockets) { try { socket.close(); } catch {} }
      sockets.clear();
      await running;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const watcher = createWatcher();
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    process.stdin.pause();
    void watcher.close();
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
  process.stdout.on('error', close);
  process.stdin.on('end', close);
  process.stdin.on('error', close);
  process.stdin.resume();
}
