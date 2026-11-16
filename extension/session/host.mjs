/* beNotable! Reader session · engine host (own code, MIT).
   Lives where Workers and audio exist: Chrome offscreen document (session/host.html), Firefox background page.
   Page sessions (content scripts) connect with runtime.connect({name:'notable-pipe'}); the pipeline is Engine + prefetch + audio.
   Model management answers runtime messages {target:'host', t}. No document text is stored; downloads happen only on ensureModel. */
import {TtsEngine} from '../engine/tts-engine.js';
import {createLocalPipeline, servePort, PIPE_PORT} from '../playback/index.js';
import {AudioCache} from '../playback/audio-cache.js';
import {createKeepAlive} from '../platform/keepalive.mjs';
import {MODELS, modelBytes} from '../models/registry.js';
import {recentSummary, runBenchmark} from './diagnose-engine.mjs';
import {serveTutor} from '../explain/tutor-host.mjs';
import {serveExports} from './host-export.mjs';
/* Download failures the settings can explain; anything else is a generic download failure. */
const DOWNLOAD_CODES = ['offline', 'unreachable', 'busy', 'hash', 'size', 'incomplete', 'stalled', 'quota'];

let started = null;
export function startHost(api = globalThis.chrome,{settingsConfig}={}) {
  if (started) return started;
  const engine = new TtsEngine(), sessions = new Set(), stats = [];
  /* ONE audio cache for every session of this host: finished sections survive a closed bar, a reload, a voice switched away and back, the guided
     explanation and the engine's idle unload (256 MiB, least recently used, 30 min expiry; audio-cache.js). Memory only, never written to disk. */
  const cache = new AudioCache();
  const synthesize = engine.synthesize.bind(engine);      // real-time factor of every synthesized section (numbers only, no text)
  const note = (request, r, ms) => { stats.push({modelId: request.modelId, tier: request.tier || 'near', normalize: request.normalize !== false, ms, sec: r.durationSec, kind: r.timingKind, at: Date.now(), ...(r.pieces ? {pieces: r.pieces} : {}), ...(request.chunked || request.idle ? {background: true} : {}), ...(r.stats ? {phases: r.stats} : {})}); if (stats.length > 400) stats.shift(); };
  /* every piece of a section that arrives in pieces counts with its own audio and synthesis time */
  const follow = (request, tail) => tail?.then(part => { note({...request, tier: (request.tier || 'near') + '-piece'}, part, part.unitMs ?? part.ms); follow(request, part.tail); }, () => {});
  engine.synthesize = async request => { const r = await synthesize(request); note(request, r, r.ms); follow(request, r.tail); return r; };
  const keep = createKeepAlive({ping: () => api.runtime.getPlatformInfo()});
  const holds = new Map(), pauseTimers = new Map(), PAUSE_HOLD_MS = 15 * 60 * 1000;
  /* A paused session keeps its voice loaded (resume without a cold model load) for as long as the pause hold lasts.
     The file view's "unload when idle" switch turns this off: then only the engine's own idle timeout counts. */
  const warmHolds = new Map(); let unloadWhilePaused = false;
  const keepWarm = pipeline => {
    if (!unloadWhilePaused && !warmHolds.has(pipeline)) warmHolds.set(pipeline, engine.keepWarm());
  };
  const coolDown = pipeline => { warmHolds.get(pipeline)?.(); warmHolds.delete(pipeline); };
  const active = state => ['playing', 'loading'].includes(state);
  const pipelines = new Set();      // live pipelines (look-ahead status for diagnostics: section numbers and byte counts only)
  /* Battery: discharging and at most 20 % -> background look-ahead pauses (a playing session keeps its near window). Browsers expose no power-saver mode;
     getBattery is the closest signal (Chromium; Firefox has none: nothing changes there). */
  const power = {low: false};
  void (async () => {
    try {
      const battery = await globalThis.navigator?.getBattery?.(); if (!battery) return;
      const update = () => { const low = battery.charging === false && battery.level <= 0.2; if (low === power.low) return; power.low = low; for (const p of pipelines) p.setPower?.({low}); };
      battery.addEventListener?.('levelchange', update); battery.addEventListener?.('chargingchange', update); update();
    } catch {}
  })();
  const hold = (pipeline) => {
    const release = holds.get(pipeline); if (release) return;
    holds.set(pipeline, keep.hold('session'));
  };
  const free = pipeline => { clearTimeout(pauseTimers.get(pipeline)); pauseTimers.delete(pipeline); holds.get(pipeline)?.(); holds.delete(pipeline); coolDown(pipeline); };
  const bgHolds = new Map();
  const listing = async () => {
    const installed = await engine.installed(), usage = await engine.usage().catch(() => ({bytes: 0})), caps = await engine.capabilities().catch(() => null);
    return {installed: [...installed], caps: caps ? {threads: caps.threads === true, webgpu: caps.webgpu === true, jspi: caps.jspi === true, cores: caps.cores, memoryGB: caps.memoryGB} : null, bytes: usage.bytes ?? 0, quota: usage.quota ?? null, persisted: usage.persisted ?? null,
      models: Object.values(MODELS).map(m => ({id: m.id, bytes: modelBytes(m), ramMB: m.ramMB, tier: m.tier, lang: m.lang}))};
  };
  let modelJob = null;const modelQueue=[];
  const modelState = () => modelJob ? {...modelJob,queued:[...modelQueue]} : null;
  // Chrome offscreen documents only expose runtime: configuration writes belong to
  // the worker. Firefox's host shares its background context and uses the callback.
  const saveModelChoice=async(command,modelId,installed)=>{const result=await(settingsConfig?settingsConfig(command,modelId,installed):api.runtime.sendMessage({target:'settingsConfig',command,modelId,...(installed?{installed:[...installed]}:{})}));if(!result?.ok)throw Object.assign(new Error('Configuration unavailable'),{code:'save_failed'});};
  // Settings may manage cached voices without creating a dummy reading session or audio.
  const settingsModels = async () => ({ok:true,...await listing(),download:modelState()});
  const settingsModelControl = async (command,modelId) => {
    if(!MODELS[modelId]||!['downloadVoice','cancelDownload','removeVoice'].includes(command))return {ok:false,code:'invalid'};
    if(command==='downloadVoice'){
      if(modelJob?.state==='running'){if(modelJob.modelId!==modelId&&!modelQueue.includes(modelId))modelQueue.push(modelId);return {ok:true,download:modelState()};}
      if(engine.installing)return {ok:false,code:'busy'};
      const job=modelJob={modelId,state:'running',phase:'preparing',loaded:0,total:modelBytes(MODELS[modelId])},release=keep.hold('model-download');
      void engine.install(modelId,{onProgress:p=>{if(modelJob!==job)return;job.phase=typeof p.phase==='string'?p.phase:'download';if(Number.isFinite(p.loaded))job.loaded=p.loaded;if(Number.isFinite(p.total))job.total=p.total;}})
        .then(async()=>{if(modelJob===job){if(!modelQueue.length)await saveModelChoice('select',modelId);Object.assign(job,{state:'ready',phase:'ready',loaded:job.total});}})
        .catch(error=>{if(modelJob===job)Object.assign(job,{state:error?.name==='AbortError'?'cancelled':'error',phase:'',code:DOWNLOAD_CODES.includes(error?.code)?error.code:error?.name==='AbortError'?'cancelled':'download_failed'});})
        .finally(()=>{release();const next=modelQueue.shift();if(next)void settingsModelControl('downloadVoice',next);});
      return {ok:true,download:modelState()};
    }
    if(command==='cancelDownload'){
      const queued=modelQueue.indexOf(modelId);if(queued>=0){modelQueue.splice(queued,1);return {ok:true,download:modelState()};}
      if(modelJob?.state!=='running'||modelJob.modelId!==modelId)return {ok:false,code:'unavailable'};
      engine.cancelInstall();return {ok:true,download:modelState()};
    }
    if(engine.installing||modelJob?.state==='running'||[...pipelines].some(p=>['playing','loading','paused'].includes(p.state)))return {ok:false,code:'busy'};
    await engine.remove(modelId);cache.dropModel(modelId);await saveModelChoice('remove',modelId,await engine.installed());
    return settingsModels();
  };
  api.runtime.onConnect.addListener(port => {
    if (port.name !== PIPE_PORT) return;
    let mine = null;      // the pipeline of THIS port: servePort drops its own reference first when the port closes, so the set must not rely on served.pipeline (a disposed pipeline stayed in the diagnostics list)
    const served = servePort(port, {createPipeline: () => {
      const othersActive = () => [...pipelines].some(other => other !== pipeline && active(other.state));
      const pipeline = mine = createLocalPipeline({engine, othersActive, cache});
      pipelines.add(pipeline); if (power.low) pipeline.setPower({low: true});
      /* background look-ahead of a session that does not play keeps a Firefox event page alive while it runs (Chrome's offscreen host needs no hold) */
      pipeline.addEventListener('prefetch', () => { const running = (pipeline.prefetch?.status().inflight.length || 0) > 0 && !active(pipeline.state); if (running && !bgHolds.has(pipeline)) bgHolds.set(pipeline, keep.hold('background')); else if (!running && bgHolds.has(pipeline)) { bgHolds.get(pipeline)(); bgHolds.delete(pipeline); } });
      pipeline.addEventListener('state', e => {
        const st = e.detail.state; clearTimeout(pauseTimers.get(pipeline)); pauseTimers.delete(pipeline);
        if (!active(st)) for (const other of pipelines) if (other !== pipeline) other.prefetch?.pump();      // a session stopped playing: background work of the others may go on
        if (['playing', 'loading'].includes(st)) { hold(pipeline); coolDown(pipeline); }
        else if (st === 'paused') { hold(pipeline); keepWarm(pipeline); pauseTimers.set(pipeline, setTimeout(() => free(pipeline), PAUSE_HOLD_MS)); }   // a short pause must not unload a Firefox event page (port is lost then)
        else free(pipeline);
      });
      return pipeline;
    }, onSession: id => sessions.add(id)});
    port.onDisconnect.addListener(() => { const pipeline = served.pipeline || mine; if (pipeline) { free(pipeline); bgHolds.get(pipeline)?.(); bgHolds.delete(pipeline); pipelines.delete(pipeline); for (const other of pipelines) other.prefetch?.pump(); } });
  });
  /* guided explanation: model status, explicit model download and the model worker (explain/tutor-host.mjs) */
  const tutor = serveTutor(api, {hold: label => keep.hold(label)});
  /* downloads of the page bar (round 4): made here with the engine that already holds the voice, saved by the browser, no reader tab */
  serveExports(api, {engine, hold: label => keep.hold(label)});
  api.runtime.onMessage.addListener((m, sender, respond) => {
    if (m?.target !== 'host') return false;
    (async () => {
      try {
        if (m.t === 'models' && m.fresh === true) await engine.capabilities({force: true}).catch(() => {});      // a voice that needs WebGPU is about to start: ask the GPU again now
        if (m.t === 'models') return respond({ok: true, ...await listing()});
        // destructive commands only from the extension's own pages (popup, options, reader); a content script in a web page has sender.url = page URL
        const own = sender?.id === api.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(api.runtime.getURL(''));
        if(m.t==='settingsModels'||m.t==='settingsModelControl'){
          const ownWorker=sender?.id===api.runtime.id&&!sender.tab&&sender.url===undefined;
          if(!own&&!ownWorker)return respond({ok:false,code:'forbidden'});
          return respond(m.t==='settingsModels'?await settingsModels():await settingsModelControl(m.command,m.modelId));
        }
        if ((m.t === 'remove' || m.t === 'clear') && !own) return respond({ok: false, code: 'forbidden'});
        // the voice list in the bar (content script) may free ONE voice: the click that asks for it is a confirmed, trusted user click on the extension's own surface; a page can not send runtime messages
        if (m.t === 'removeVoice' && typeof m.modelId === 'string' && /^[a-z0-9_:.-]{1,64}$/.test(m.modelId) && sender?.id === api.runtime.id) { await engine.remove(m.modelId); cache.dropModel(m.modelId); return respond({ok: true, ...await listing()}); }
        if (m.t === 'cancelInstall' && sender?.id === api.runtime.id) { engine.cancelInstall(); return respond({ok: true}); }
        if (m.t === 'remove' && typeof m.modelId === 'string') { await engine.remove(m.modelId); cache.dropModel(m.modelId); return respond({ok: true, ...await listing()}); }
        if (m.t === 'clear') { await engine.clear(); cache.clear(); return respond({ok: true, ...await listing()}); }
        /* file view privacy switch: the engine always unloads when idle; "on" also unloads voices of paused sessions */
        if (m.t === 'idleUnload' && own) {
          unloadWhilePaused = m.enabled === true;
          if (unloadWhilePaused) for (const p of [...warmHolds.keys()]) coolDown(p);
          return respond({ok: true});
        }
        /* the file view starts an audio export with its own engine: free this one first unless a session needs it */
        if (m.t === 'release' && own) {
          const busy = engine.busy > 0 || engine.installing || [...pipelines].some(p => active(p.state));
          if (!busy) { for (const p of [...warmHolds.keys()]) coolDown(p); engine.terminate(); }
          return respond({ok: true, released: !busy});
        }
        /* Diagnosis (settings, popup, help; own pages only): numbers of the engine, no text. `benchmark` loads an installed Experimental voice and measures it with a fixed sentence. */
        if (m.t === 'diagnose' && own) {
          const caps = await engine.capabilities().catch(() => null), loaded = engine.loaded, last = [...stats].reverse().find(item => item.phases && MODELS[item.modelId]?.needs?.webgpu);
          return respond({ok: true, loaded, caps: caps ? {threads: caps.threads === true, webgpu: caps.webgpu === true, jspi: caps.jspi === true, cores: caps.cores, memoryGB: caps.memoryGB} : null, recent: last ? recentSummary(stats, last.modelId) : null, lastPhases: last?.phases || null});
        }
        if (m.t === 'benchmark' && own) {
          const installed = await engine.installed(), id = typeof m.modelId === 'string' && installed.has(m.modelId) ? m.modelId : [...installed].find(modelId => MODELS[modelId]?.needs?.webgpu);
          if (!id) return respond({ok: true, bench: {ok: false, code: 'no-model'}});
          try { return respond({ok: true, bench: await runBenchmark(engine, id)}); } catch (error) { return respond({ok: true, bench: {ok: false, code: error?.code || error?.name || 'failed'}}); }
        }
        if (m.t === 'stats') return respond({ok: true, stats, loaded: engine.loaded});
        if (m.t === 'loaded') return respond({ok: true, loaded: engine.loaded});
        if (m.t === 'prefetch') return respond({ok: true, pipelines: [...pipelines].map(p => p.prefetchStatus()), cache: cache.stats(), lowPower: power.low});
        respond({ok: false, code: 'invalid'});
      } catch (error) { respond({ok: false, code: error?.code || 'host-failed'}); }
    })();
    return true;                                                       // async response
  });
  /* One-time cleanup of superseded voice files: only when nothing plays, loads, is paused or downloads; else retry
     later (12 tries, 60 s apart, per start). Never throws. */
  const idle = () => !(engine.busy > 0 || engine.installing || modelJob?.state === 'running'
    || [...pipelines].some(p => ['playing', 'loading', 'paused'].includes(p.state)));
  const pruneIdle = (tries = 12, delay = 30000) => setTimeout(async () => {
    const done = await engine.store.pruneSuperseded({isBusy: () => !idle()}).catch(() => false);
    if (done) engine.installed().catch(() => {});
    else if (tries > 1) pruneIdle(tries - 1, 60000);
  }, delay);
  pruneIdle();
  started = {engine,settingsModels,settingsModelControl,tutor};
  return started;
}
