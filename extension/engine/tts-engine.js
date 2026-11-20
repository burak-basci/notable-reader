/* beNotable! Reader engine · TtsEngine · own code MIT.
 * One warm worker (ONNX Runtime Web, Kokoro/Piper/Kitten) behind a small promise API. Runs in any extension page that may create a
 * Worker (offscreen document, Firefox event page, reader/focus pages). It never touches the DOM or audio output: it returns PCM
 * and word times, playback belongs to extension/playback.
 * Generations: every request carries a number; cancel(g) rejects every request with generation <= g (queued or running) with an
 * AbortError and tells the worker to stop between parts (a worker busy with a cancelled, not nearly finished run is stopped and re-created). Use a higher generation for the next request.
 * req.owner (an object, e.g. one pipeline or one export run): cancel(g,{owner}) rejects only that owner's
 * requests <= g, so a session that stops or starts never cancels the synthesis another tab is listening to.
 * Without an owner the engine-wide rule applies.
 * req.signal (AbortSignal): cancels ONE request (queued: dropped; running: rejected with AbortError, the worker is re-created unless it is nearly done) without touching others; used by the
 * look-ahead scheduler to drop the lowest priority work at once. req.head / req.startWord split the synthesis of a section (first sentence first): the result then carries `tail`, a promise of the rest from the same worker. */
import {capabilities as probe} from './capabilities.js';
import {MODELS,getModel,voiceInfo,modelBytes,engineError} from './models/registry.js';
import {ModelStore} from './models/store.js';
import {prepareSpeech} from './speech-normalize.mjs';
import {planUnits,sentenceUnits} from './speech-units.mjs';
const MAX_WORKERS=2;
/* Queue order across sessions: what is needed for the audio now goes before look-ahead work of any session. */
const TIER_RANK={near:0,visible:1,rest:2,behind:3};
const BACKGROUND_TIERS=new Set(['visible','rest','behind']);
/* Real-time factor before this device measured one (one worker with 4 WASM threads, four cores of a desktop CPU, 15.11.2026): only decides the pool and the
   start buffer of the very first start; the measured value replaces it after the first units. Kokoro q8 is the slow one in WASM (its int8 kernels barely
   use threads), so its first start gets its pair of workers and a short buffer instead of a stop after the first sentence. */
const RTF_PRIOR={'kokoro-q8':1,kokoro:0.55,piper:0.4};
const crashed=()=>engineError('worker-crashed','The local voice worker stopped unexpectedly.');
const lead=count=>Array.from({length:count},()=>({start:0,end:0}));
/* A held background job waits at most this long in the queue before it is given up (its owner asks again when it may); meanwhile the model stays loaded. */
const HOLD_MAX_MS=5*60*1000;
/* Voices that read on the graphics card (WebGPU) when the device has a real adapter and WebAssembly JSPI (the WebGPU runtime of the package is the JSPI build
   of ONNX Runtime Web 1.31.1). Measured 15.11.2026 in Chromium on an RTX 3060 (tests/perf/gpu-voice-bench.cjs): Piper Thorsten high real-time factor 0.026-0.035
   on the GPU against 0.40 with 4 WASM threads, the same signal (noise 0: SNR 90 dB, same length), 30 sections of 8-83 words without an error on an own device
   with the adapter's buffer limits (the default limits failed on the longest section). Kokoro is not listed: FP32 failed on a 41-word sentence with the
   default limits, q8 was slower on the GPU (0.45-0.57) than on WASM. A failed load, an implausible test sentence or a lost device falls back to WASM. */
const GPU_KINDS=new Set(['piper']);
export const COMPUTE_PATHS=Object.freeze(['auto','gpu','cpu']);
/* Pieces of one joined job -> one result: PCM end to end, word times shifted by the audio before each piece (null as soon as one piece has none). */
function joinParts(parts,from,pad){
 const total=parts.reduce((sum,part)=>sum+part.pcm.length,0),pcm=new Float32Array(total);let at=0,shift=0,timings=[],ms=0,peak=0;
 for(const part of parts){pcm.set(part.pcm,at);at+=part.pcm.length;timings=timings&&part.wordTimings?timings.concat(part.wordTimings.map(({start,end})=>({start:start+shift,end:end+shift}))):null;shift+=part.durationSec;ms+=part.ms||0;peak=Math.max(peak,part.peak||0);}
 const first=parts[0];
 return {...first,pcm,durationSec:total/first.sampleRate,wordTimings:timings&&from?pad(from).concat(timings):timings,timingKind:timings?first.timingKind:'none',peak,ms,fromWord:from,pieces:parts.length};
}
const abort=message=>new DOMException(message||'Die lokale Berechnung wurde abgebrochen.','AbortError');
export class TtsEngine extends EventTarget{
 constructor({store=new ModelStore(),workerUrl=new URL('./worker/tts-worker.js',import.meta.url),createWorker=url=>new Worker(url,{type:'module'}),capabilitiesFn=probe,prefer='wasm',idleUnloadMs=90000,pool='auto',speechNormalize=true}={}){
  super();
  Object.assign(this,{store,workerUrl,createWorker,capabilitiesFn,prefer,pool,speechNormalize});
  this.slots=[];this.queue=[];this.poolBlocked=new Set();this.serial=0;
  this.cancelledUpTo=-1;this.highest=-1;this.epoch=0;this.disposed=false;this.installing=null;
  this.installedIds=new Set();this.idleMs=idleUnloadMs;this.idleTimer=0;this.busy=0;this.caps=null;
  this.msPerChar=new Map();this.rtf=new Map();this.rtfSeen=new Map();this.rtfRaw=new Map();/* rtfRaw: every unit of 2+ s, warm-up included (biased high): a first estimate until `rtf` is measured *//* measured synthesis speed per model (EMA): decides whether killing a cancelled run beats waiting for it */
  this.owners=new WeakMap();this.warmHolds=0;
  /* compute path (setting "Rechenweg"): auto = the graphics card for the voices measured faster there, gpu = the same, also after a failed attempt,
     cpu = never; gpuFailed: models whose GPU attempt failed in this host (load, test sentence, a lost device): they read on WASM until the setting changes */
  this.compute='auto';this.gpuFailed=new Map();
 }
 /* The runtime a new worker of this model loads ('webgpu' or 'wasm'): see GPU_KINDS. An engine created with prefer 'webgpu' (tests) asks for it always. */
 backendFor(model){
  if(this.prefer==='webgpu')return 'webgpu';
  if(this.compute==='cpu'||!GPU_KINDS.has(model?.kind)||!this.caps?.webgpu||!this.caps?.jspi)return 'wasm';
  return this.compute==='gpu'||!this.gpuFailed.has(model.id)?'webgpu':'wasm';
 }
 /* The setting changed: workers on the other runtime are re-created (an idle one now, a busy one after its job); a failed GPU attempt may be tried again with 'gpu'. */
 setCompute(value){
  if(!COMPUTE_PATHS.includes(value)||value===this.compute)return;
  this.compute=value;if(value!=='auto')this.gpuFailed.clear();
  for(const slot of [...this.slots]){
   if(slot.dead||!slot.modelId)continue;let model;try{model=getModel(slot.modelId);}catch{continue;}
   if((slot.info?.backend||'wasm')===this.backendFor(model))continue;
   if(slot.busy)slot.retire=true;else{this.slots=this.slots.filter(other=>other!==slot);this.dropSlot(slot);}
  }
 }
 /* A worker reports the runtime it really uses: a GPU attempt that ended on WASM is remembered, and the measured speed of the other runtime is forgotten. */
 noteBackend(slot,modelId,info){
  const backend=info?.backend||'wasm';
  if(info?.gpuFallback)this.gpuFailed.set(modelId,String(info.gpuFallback).slice(0,60));
  if(this.backendSeen?.get(modelId)!==backend){(this.backendSeen??=new Map()).set(modelId,backend);for(const map of [this.rtf,this.rtfRaw,this.rtfSeen,this.msPerChar])map.delete(modelId);}
  if(slot.info)slot.info.backend=backend;
 }
 /* Register plus installed flag (flags refresh after installed()/install()/remove()). */
 voices(){return Object.values(MODELS).map(model=>voiceInfo(model,this.installedIds.has(model.id)));}
 async installed(){this.installedIds=await this.store.installed();return new Set(this.installedIds);}
 async install(modelId,{signal,onProgress=()=>{}}={}){
  const model=getModel(modelId);
  if(this.installing)throw engineError('busy','Ein Modelldownload läuft bereits.');
  const epoch=this.epoch,own=new AbortController(),relay=()=>own.abort();signal?.addEventListener('abort',relay);
  this.installing=own;
  try{
   await this.store.install(model,{signal:own.signal,onProgress:progress=>{if(epoch===this.epoch){onProgress(progress);this.dispatchEvent(new CustomEvent('download',{detail:{modelId,...progress}}));}}});
   if(epoch!==this.epoch||own.signal.aborted)throw abort('Abgebrochen');
   this.installedIds.add(modelId);this.dispatchEvent(new Event('voiceschanged'));
  }finally{signal?.removeEventListener('abort',relay);this.installing=null;}
 }
 cancelInstall(){this.installing?.abort();}
 async remove(modelId){
  const model=getModel(modelId);
  if(this.slots.some(slot=>slot.modelId===modelId||slot.starting===modelId))this.terminate();
  await this.store.remove(model,Object.values(MODELS).filter(other=>this.installedIds.has(other.id)));
  await this.installed();this.dispatchEvent(new Event('voiceschanged'));
 }
 /* Deletes every model and invalidates running work; a late worker can not be created afterwards (epoch check). */
 async clear(){
  this.epoch++;this.cancelInstall();this.cancel();this.terminate();
  await this.store.clearAll();this.installedIds.clear();this.dispatchEvent(new Event('voiceschanged'));
 }
 usage(){return this.store.usage();}
 setIdleUnload(ms){this.idleMs=Math.max(0,Number(ms)||0);this.scheduleUnload();}
 scheduleUnload(){
  clearTimeout(this.idleTimer);this.idleTimer=0;
  if(!this.idleMs||!this.slots.length||this.disposed||this.warmHolds)return;
  this.idleTimer=setTimeout(()=>{this.idleTimer=0;if(this.slots.length&&!this.busy)this.terminate();else this.scheduleUnload();},this.idleMs);
 }
 /* Keeps loaded workers past the idle timeout (a paused session resumes without a cold model load).
  * Returns the release. */
 keepWarm(){
  let held=true;this.warmHolds++;clearTimeout(this.idleTimer);this.idleTimer=0;
  return ()=>{if(!held)return;held=false;this.warmHolds--;this.scheduleUnload();};
 }
 ownerState(owner){
  let state=this.owners.get(owner);if(!state)this.owners.set(owner,state={upTo:-1,highest:-1});
  return state;
 }
 /* A running ONNX call can not be interrupted in the WASM runtime. Waiting for it made the next start wait 15-23 s behind dead work, so a worker that is
  * busy with a cancelled request is stopped and re-created (about one init: 0.3-1 s) unless it is nearly done (predicted rest shorter than that init). */
 cancel(generation,{owner}={}){
  if(owner&&typeof owner==='object'){
   const state=this.ownerState(owner);state.upTo=Math.max(state.upTo,generation===undefined?state.highest:generation);
  }else{
   const upTo=generation===undefined?Math.max(this.highest,this.cancelledUpTo):generation;
   this.cancelledUpTo=Math.max(this.cancelledUpTo,upTo);
  }
  for(const slot of [...this.slots]){
   let running=null;const ids=[];
   for(const [id,request] of slot.requests){
    if(!this.isCancelled(request.generation,request.owner))continue;
    slot.requests.delete(id);ids.push(id);request.reject(abort());if(request.running)running=request;
   }
   if(ids.length)slot.worker?.postMessage({action:'cancel',ids});
   if(running&&this.worthKilling(slot,running)){this.slots=this.slots.filter(other=>other!==slot);this.dropSlot(slot);}
  }
 }
 /* One request only (req.signal): queued -> removed; running -> its slot request is dropped and the worker killed unless nearly done (same rule as cancel()). */
 abortJob(job){
  const queued=this.queue.indexOf(job);if(queued>=0){this.queue.splice(queued,1);job.reject(abort());return;}
  for(const slot of [...this.slots])for(const [id,request] of slot.requests)if(request.job===job){
   slot.requests.delete(id);request.reject(abort());
   if(request.running&&this.worthKilling(slot,request)){this.slots=this.slots.filter(other=>other!==slot);this.dropSlot(slot);}
   else slot.worker?.postMessage({action:'cancel',ids:[id]});
  }
 }
 worthKilling(slot,request){
  /* adapters that check the cancel flag between frames (Qwen3-TTS) stop within one frame: re-creating the worker would cost a full model load (seconds) */
  if(MODELS[request.modelId]?.cooperativeCancel===true)return false;
  const speed=this.msPerChar.get(request.modelId);
  if(!(speed>0)||!(request.chars>0))return true;
  return request.chars*speed-(performance.now()-request.started)>(slot.initMs||800);
 }
 /* Stops every worker (all pending requests reject with AbortError). */
 terminate(){
  clearTimeout(this.idleTimer);this.idleTimer=0;
  const slots=this.slots;this.slots=[];
  for(const slot of slots)this.dropSlot(slot);
 }
 dropSlot(slot,reason){
  try{slot.worker?.terminate();}catch{}
  slot.dead=true;
  for(const request of slot.requests.values())request.reject(reason||abort('Die lokale Stimme wurde angehalten.'));
  slot.requests.clear();
 }
 call(slot,message,generation,job){
  return new Promise((resolve,reject)=>{const id=++this.serial,running=message.action==='synthesize';slot.requests.set(id,{resolve,reject,generation,owner:job?.owner,job,running,modelId:slot.modelId,chars:running?message.text.length:0,started:performance.now()});slot.worker.postMessage({...message,id});});
 }
 isCancelled(generation,owner){
  if(generation===undefined)return false;
  if(generation<=this.cancelledUpTo)return true;
  return !!owner&&typeof owner==='object'&&generation<=(this.owners.get(owner)?.upTo??-1);
 }
 /* Workers for one model: one threaded worker where WASM threads exist; otherwise (Firefox extension pages: no cross-origin isolation, measured
  * RTF ~1.5 with one thread) two single-thread workers working on different sections in parallel, only for models up to 500 MB RAM and
  * when the device does not report less than 8 GB. Never more than two (RAM x2).
  * Threaded engines (Chromium) get a second worker only when ONE worker would not keep up at the chosen tempo (measured real-time factor of this model
  * x tempo > 0.85, before the first measurement 0.6 as typical), for small models on 4+ cores; the extra worker gets its share of the threads. */
 poolLimit(model,job){
  if(this.pool!=='auto')return Math.max(1,Math.min(MAX_WORKERS,Number(this.pool)||1));
  const caps=this.caps;
  if(!caps)return 1;/* capabilities unknown: never start a second worker on a guess */
  /* background look-ahead (nobody waits for it) on 8+ cores: a pair even when one worker keeps up with the tempo, so a page is prepared in the time a person
     looks at it; the first worker has 4 threads, so half of the cores stay free (16 cores: 4 + 4 threads) and the work pauses between sentences while the user interacts */
  if(caps.threads&&job?.join&&BACKGROUND_TIERS.has(job.tier)&&model.ramMB<=500&&caps.memoryGB>=8&&(caps.cores||1)>=8&&!model.needs?.webgpu)return MAX_WORKERS;      // only jobs in pieces: they hand the worker over between pieces, so needed audio never waits long behind them
  /* GPU models (Qwen3-TTS): one section needs 70-80 % of its time waiting for tiny GPU steps, a second worker fills that gap. Measured (RTX 3060, 0.6B): two sections in
   * parallel RTF 0.71 instead of 1.17 for one; a third worker adds little (0.61) and costs another 2.6 GB of video memory, so never more than two. Only on 8+ cores and 8+ GB RAM,
   * only for the 0.6B models (ramMB <= 4000: video memory peak 3.8 GB each; the 1.7B models peak at 4.5 GB, two of them would not fit a 12 GB card next to the desktop) and not after a second worker failed to start here (`poolBlocked`, e.g. too little video memory). */
  if(model.needs?.webgpu)return caps.webgpu&&model.ramMB<=4000&&(caps.cores||1)>=8&&!(caps.memoryGB<8)&&!this.poolBlocked?.has(model.id)?MAX_WORKERS:1;
  /* Firefox reports no deviceMemory: unknown memory counts as tight; only 8+ cores (rarely under 8 GB) get a pair */
  const roomy=caps.memoryGB===undefined?(caps.cores||1)>=8:caps.memoryGB>=8&&(caps.cores||1)>=4;
  /* Without cross-origin isolation (Chrome extension pages since 2.5: COOP/COEP made the host hang) every worker has ONE thread. Kokoro FP32 then
     synthesizes at RTF 1.5-2.3 (measured 20.11.2026, 16 cores): one worker cannot keep up even at 1x and English reading stopped every few seconds.
     A pair halves that; the large model (1.1 GB per worker) only on 8+ cores, where the memory for two is there as well. */
  if(!caps.threads)return (model.ramMB<=500||model.ramMB<=1200&&(caps.cores||1)>=8)&&roomy?2:1;
  const need=(this.rateHint||1)*(this.rtf?.get(model.id)??this.rtfRaw?.get(model.id)??RTF_PRIOR[model.id]??0.6);
  /* 4+ cores (was 8+): measured 15.11.2026 on four cores, Kokoro q8 (threads barely help it): one worker with 4 threads RTF 0.875, a pair with 2 threads each 0.585
     together; Thorsten high scales with threads (0.38 alone) and stays single up to 2x. */
  return need>0.85&&model.ramMB<=500&&caps.memoryGB>=8&&(caps.cores||1)>=4?2:1;
 }
 /* WASM threads of one worker: all of them for a single worker, a quarter of the cores each for a pair (2 x 4 threads on 16 cores, 2 x 2 on 8). */
 /* The first worker carries the first section (time to the first sound) and always gets all threads;
  * only the extra worker shares. */
 threadsFor(model,extra=false){
  const caps=this.caps||{},all=caps.numThreads||1;
  return caps.threads&&extra&&this.poolLimit(model)>1?Math.max(2,Math.min(all,Math.floor((caps.cores||8)/4))):all;
 }
 /* Measured speed of a model on this device: real-time factor (synthesis seconds per audio second, long units after warm-up) and milliseconds of synthesis
  * per input character (all units). undefined before the first measurement. Playback uses it to decide how finely to split a section it needs soon. */
 speed(modelId){const rtf=this.rtf.get(modelId)??this.rtfRaw.get(modelId)??RTF_PRIOR[modelId],msPerChar=this.msPerChar.get(modelId);return {rtf:rtf>0?rtf:undefined,msPerChar:msPerChar>0?msPerChar:undefined};}
 /* How many sections of this model can be synthesized at once (playback asks before it fills its look-ahead window). */
 poolFor(modelId,{rate,background=false}={}){if(Number.isFinite(rate))this.rateHint=rate;try{const model=getModel(modelId);return Math.max(this.poolLimit(model),background?this.poolLimit(model,{tier:'rest',join:true}):1);}catch{return 1;}}
 /* Idle slot already holding the model, else a new slot while below the limit, else an idle slot of another model (re-created), else null (wait). */
 pickSlot(modelId,model,job){
  const idle=this.slots.filter(slot=>!slot.busy&&!slot.dead&&!slot.retire),same=idle.find(slot=>slot.modelId===modelId);
  if(same)return same;
  const forModel=this.slots.filter(slot=>slot.modelId===modelId||slot.starting===modelId).length,other=idle.find(slot=>slot.modelId!==modelId);
  if(this.slots.some(slot=>slot.warming===modelId&&!slot.dead))return null;/* the model is being loaded ahead of time: wait for that worker instead of loading a second copy */
  /* parallel: a number or a function asked at pick time (a queued request may lose its limit once audio plays) */
  const cap=typeof job?.parallel==='function'?job.parallel():job?.parallel;
  const limit=Math.min(this.poolLimit(model,job),cap>0?cap:MAX_WORKERS);
  if(forModel>=limit)return null;
  /* needed audio does not start a cold second worker (a model load: seconds, measured 15 s to the first tour step with Kokoro q8 on four cores) while every
     worker of this model runs background pieces: those hand their worker over at the end of the current piece (shouldYield) */
  if(this.pool==='auto'&&forModel>0&&(TIER_RANK[job?.tier]??0)===0){const mine=this.slots.filter(slot=>!slot.dead&&slot.modelId===modelId);if(mine.length&&mine.every(slot=>slot.job?.join&&!slot.job.urgent?.()))return null;
   /* ... nor while a threaded worker of this model is still loading it: measured with Kokoro q8 on four cores, a guided explanation started 3 s after the bar
      opened loaded a second q8 worker next to the first one's load and spoke after 14-16 s (both loads fight for the same cores; Firefox's two single-thread
      workers load side by side, as designed). A rule "wait while the busy worker is free sooner than a load takes" kept q8 from ever forming the pair it
      needs at 1.5x (measured: a 16.7 s gap) and is not used. */
   if(this.caps?.threads&&this.slots.some(slot=>!slot.dead&&slot.starting===modelId&&!slot.modelId))return null;}
  if(other){this.slots=this.slots.filter(slot=>slot!==other);this.dropSlot(other);return this.newSlot(modelId,forModel>0);}/* a model switch frees the old model's memory first */
  return this.slots.length<MAX_WORKERS?this.newSlot(modelId,forModel>0):null;
 }
 /* The first piece of a start (req.first: the user just asked for audio and nothing plays yet, e.g. a step of a guided explanation, Play) finds every worker
    of its model busy, all of them with work nobody listens to yet (background pieces, the open bar's start) and none of them free soon. Such a piece can not
    be interrupted and takes seconds with a slow voice (measured 15.11.2026, Kokoro q8 on four cores: 5 words = 2.8-4.4 s next to the second worker; the first
    step of a guided explanation waited for it: 3.4 s or 5.8 s depending on the moment of the click). The worker is re-created for the start (a model load:
    q8 0.5 s) with all threads; the background jobs go back into the queue with the pieces they have. Threaded engines (Chromium) only. */
 preempt(job){
  if(this.pool!=='auto'||!this.caps?.threads||!job.first||(TIER_RANK[job.tier]??0)!==0||job.join||job.hold)return null;
  const mine=this.slots.filter(slot=>!slot.dead&&(slot.modelId===job.modelId||slot.starting===job.modelId));
  if(!mine.length||mine.some(slot=>!slot.busy||slot.warming||!slot.modelId))return null;      // a free, warming or loading worker of this model comes sooner
  if(mine.some(slot=>this.remainingMs(slot)<=(slot.initMs||800)+300))return null;      // one is free about as soon as a new one could load the model
  const cap=typeof job.parallel==='function'?job.parallel():job.parallel;if(cap>0&&mine.filter(slot=>slot.job?.owner===job.owner&&!slot.job.join&&!slot.job.hold).length>=cap)return null;      // its owner's own limit (one worker while the first piece of a start is made)
  const free=mine.filter(slot=>{const other=slot.job;return other&&(other.join||other.hold)&&!other.urgent?.()&&!(!other.join&&other.delivered);});
  if(free.length!==mine.length)return null;      // a worker runs needed audio (or a chain that can not be resumed): never taken
  /* all of them: the first piece runs on ONE worker with all threads, nothing next to it (measured: with the second worker still running its background piece the
     first 5 words took 2.7 s instead of 2.0 s); the pair forms again when the next pieces need it */
  for(const victim of free){victim.preempted=true;this.slots=this.slots.filter(slot=>slot!==victim);this.dropSlot(victim);}
  this.preemptions=(this.preemptions||0)+1;
  return this.newSlot(job.modelId,false);
 }
 /* The first piece of a start runs without background work next to it when the workers of its model have more threads than the device has cores (four cores:
    4 + 2 threads): background pieces of the other workers are stopped the same way (their jobs wait in the queue again). Measured 15.11.2026 with Kokoro q8:
    the start on the free 2-thread worker next to a background piece of the 4-thread one made its first 5 words in 2.6 s and the next 5 in 4.2 s (2.8 s
    silence after the first piece). With room for all threads (8+ cores) nothing is stopped. */
 clearFor(job,slot){
  if(this.pool!=='auto'||!this.caps?.threads||!job.first)return;
  const others=this.slots.filter(other=>other!==slot&&!other.dead&&other.modelId===job.modelId&&other.busy&&other.job&&(other.job.join||other.job.hold)&&!other.job.urgent?.()&&!(!other.job.join&&other.job.delivered));
  if(!others.length)return;
  let model=null;try{model=getModel(job.modelId);}catch{return;}
  const threads=this.slots.filter(other=>!other.dead).reduce((sum,other)=>sum+(other.info?.threads||this.threadsFor(model,other.extra)),0);
  if(threads<=(this.caps.cores||1))return;
  for(const other of others){if(this.remainingMs(other)<=(other.initMs||800)+300)continue;other.preempted=true;this.slots=this.slots.filter(item=>item!==other);this.dropSlot(other);this.preemptions=(this.preemptions||0)+1;}
 }
 /* Predicted milliseconds until this worker finishes its running unit: measured milliseconds per character of the model, times the number of its workers
    busy right now (a pair on four cores runs each worker 1.5-2.7x slower than one alone, measured), minus the time it runs already. Infinity when unknown. */
 remainingMs(slot){
  const busy=Math.max(1,this.slots.filter(other=>!other.dead&&other.busy&&other.modelId===slot.modelId).length);let best=Infinity;
  for(const request of slot.requests.values()){if(!request.running)continue;const speed=this.msPerChar.get(request.modelId);if(speed>0)best=Math.min(best,Math.max(0,request.chars*speed*busy-(performance.now()-request.started)));}
  return best;
 }
 newSlot(modelId,extra=false){
  const slot={worker:null,modelId:'',starting:modelId,busy:false,dead:false,requests:new Map(),info:null,extra};
  this.slots.push(slot);return slot;
 }
 /* The worker is created only after the model check and the last cancel/dispose guard, so a cleared or disposed engine never spawns one late. */
 attach(slot){
  const worker=this.createWorker(this.workerUrl);slot.worker=worker;
  worker.addEventListener('message',event=>{
   const request=slot.requests.get(event.data.id);if(!request)return;
   slot.requests.delete(event.data.id);
   if(event.data.ok&&request.running&&request.chars>0&&event.data.ms>0){const speed=event.data.ms/request.chars,old=this.msPerChar.get(request.modelId);this.msPerChar.set(request.modelId,old?old*0.5+speed*0.5:speed);if(event.data.durationSec>=2){const raw=event.data.ms/1000/event.data.durationSec,was=this.rtfRaw.get(request.modelId);this.rtfRaw.set(request.modelId,was?was*0.5+raw*0.5:raw);}if(event.data.durationSec>=6){/* only long units count (a short first sentence carries fixed costs); the first run of a fresh worker is slower (warm-up): from the second sample on */
    const factor=event.data.ms/1000/event.data.durationSec,seen=this.rtfSeen.get(request.modelId)||0,was=this.rtf.get(request.modelId);this.rtfSeen.set(request.modelId,seen+1);
    if(seen>=1)this.rtf.set(request.modelId,was?was*0.5+factor*0.5:factor);}}
   /* A WebAssembly abort or allocation failure leaves the runtime unusable: drop that worker instead of
      failing every later section with it. */
   if(!event.data.ok&&event.data.fatal&&!slot.dead){request.reject(crashed());this.crash(slot);return;}
   /* a string code from the worker (e.g. webgpu-unavailable) wins over the generic one */
   const gpu=getModel(request.modelId||slot.modelId||slot.starting)?.needs?.webgpu;
   const code=typeof event.data.code==='string'?event.data.code:gpu?'webgpu-failed':'worker';
   event.data.ok?request.resolve(event.data):request.reject(event.data.aborted?abort(event.data.error):Object.assign(engineError(code,event.data.error),{detail:event.data.stack}));
  });
  const lost=event=>{event?.preventDefault?.();if(!slot.dead)this.crash(slot);};
  worker.addEventListener('error',lost);worker.addEventListener('messageerror',lost);
 }
 /* A crashed worker rejects its requests with code 'worker-crashed' (not AbortError: the user did not stop
  * anything) and is never reused. */
 crash(slot){
  this.slots=this.slots.filter(other=>other!==slot);this.dropSlot(slot,crashed());
  const modelId=slot.modelId||slot.starting;
  this.dispatchEvent(new CustomEvent('error',{detail:{code:'worker-crashed',modelId}}));this.pump();
 }
 async prepare(slot,modelId,generation,epoch){
  const guard=()=>{if(this.disposed||epoch!==this.epoch||slot.dead||this.isCancelled(generation))throw abort();};guard();
  if(slot.modelId===modelId)return;
  const model=getModel(modelId);
  if(!await this.store.has(model))throw engineError('not-installed','Bitte das Sprachmodell zuerst ausdrücklich herunterladen.');
  /* Experimental models that need the GPU are refused with a plain message instead of failing late inside the worker. */
  if(model.needs?.webgpu&&this.caps?.webgpu===false){this.caps=await this.capabilitiesFn().catch(()=>this.caps);this.capsAt=performance.now();}/* the adapter can appear a moment after start (headless Chromium: seconds): ask once more before refusing */
  if(model.needs?.webgpu&&this.caps?.jspi===false)throw engineError('jspi-unavailable','Diese Stimme braucht WebAssembly-JSPI (Chrome 137 oder neuer), das in diesem Browser nicht verfügbar ist.');
  if(model.needs?.webgpu&&this.caps?.webgpu===false)throw engineError('webgpu-unavailable','Diese Stimme braucht WebGPU, aber der Browser liefert keinen Grafikadapter (WebGPU ist aus oder Vulkan fehlt).');
  guard();
  this.attach(slot);
  const payload={action:'init',cacheName:this.store.cacheName,kind:model.kind,files:model.files.map(({role,url})=>({role,url})),threads:this.threadsFor(model,slot.extra),prefer:this.backendFor(model)};
  if(model.params)payload.params=model.params;if(model.voice)payload.voice=model.voice;if(model.idMap)payload.idMap=model.idMap;if(model.language)payload.language=model.language;if(model.speakerId!==undefined)payload.speakerId=model.speakerId;
  const t0=performance.now();slot.info=await this.call(slot,payload,undefined);slot.modelId=modelId;slot.initMs=performance.now()-t0;this.noteBackend(slot,modelId,slot.info);guard();
  this.dispatchEvent(new CustomEvent('loaded',{detail:{modelId,backend:slot.info?.backend||'wasm',gpu:slot.info?.gpu||null,initMs:Math.round(slot.initMs)}}));
 }
 /* Queue position by tier: what is needed for the audio now goes before look-ahead work (a resumed background job goes behind its equals). */
 /* Inside one tier the reading order (req.seq: the section, pieces as fractions of it) goes first: a later section that became needed first must not put its
    pieces before the next piece of the section that plays now. Jobs without seq keep their arrival order at the end of their tier. */
 enqueue(entry){const rank=TIER_RANK[entry.tier]??0,seq=entry.seq??Infinity;let at=this.queue.length;while(at>0){const other=this.queue[at-1],r=TIER_RANK[other.tier]??0;if(r>rank||r===rank&&(other.seq??Infinity)>seq)at--;else break;}this.queue.splice(at,0,entry);}
 /* A background job in pieces (job.join) gives its worker back between two pieces when a more urgent request waits for this model, or while its owner
    holds it (hold(): the user interacts with the page, the tab is hidden); it continues later from the next piece on the same or another worker. */
 shouldYield(job){
  if(!job.join||job.urgent?.())return false;
  if(job.hold?.())return true;
  const rank=TIER_RANK[job.tier]??0;
  return rank>0&&this.queue.some(other=>other!==job&&(TIER_RANK[other.tier]??0)<rank&&!other.hold?.());
 }
 /* A joined background job that became needed: what is there resolves the request as the head (partial, with `tail`), the remaining pieces follow as a chain. */
 async streamRest(slot,job,from){
  const later=()=>{let settle;const promise=new Promise((resolve,reject)=>{settle={resolve,reject};});promise.catch(()=>{});return [promise,settle];};
  const head=joinParts(job.parts,job.from,lead);let [tail,settle]=later();
  this.busy++;job.delivered=true;job.streamed=true;job.resolve({...head,partial:true,tail});
  /* the remaining pieces as jobs of their own at the front of the queue: this worker and a free one of the pool make them side by side */
  const entries=[],subs=job.units.slice(from).map((unit,k)=>new Promise((resolve,reject)=>{entries.push({modelId:job.modelId,units:[unit],from:0,join:false,lang:job.lang,generation:job.generation,epoch:job.epoch,signal:job.signal,resolve,reject,owner:job.owner,tier:'near',parallel:job.parallel,piece:from+k,seq:Number.isFinite(job.seq)?job.seq+(from+k)/1000:undefined});}));
  for(const sub of subs)sub.catch(()=>{});
  for(const entry of entries)this.enqueue(entry);
  queueMicrotask(()=>this.pump());
  try{
   let timings=head.wordTimings,shift=head.durationSec,ms=head.ms;
   for(let index=from;index<job.units.length;index++){
    const part=await subs[index-from],last=index===job.units.length-1,offset=shift;
    timings=timings&&part.wordTimings?timings.concat(part.wordTimings.map(({start,end})=>({start:start+offset,end:end+offset}))):null;ms+=part.ms;shift+=part.durationSec;
    let next=null,nextSettle=null;if(!last)[next,nextSettle]=later();
    settle.resolve({...part,wordTimings:timings,timingKind:timings?part.timingKind:'none',ms,unitMs:part.ms,offset,...(last?{}:{partial:true,tail:next})});settle=nextSettle;
   }
  }catch(error){settle?.reject(error);for(const entry of entries)this.abortJob(entry);}
  finally{this.busy--;this.scheduleUnload();}
 }
 /* Starts as many queued jobs as there are suitable slots. */
 pump(){
  let waiting=false;
  for(let i=0;i<this.queue.length;){
   const job=this.queue[i];
   if(this.disposed||job.epoch!==this.epoch||this.isCancelled(job.generation,job.owner)||job.signal?.aborted){this.queue.splice(i,1);job.reject(abort());continue;}
   /* a held background job waits in the queue (at most HOLD_MAX_MS, then it is given up: its owner asks again later) */
   if(job.hold?.()&&!job.urgent?.()){job.heldSince??=performance.now();if(performance.now()-job.heldSince>HOLD_MAX_MS){this.queue.splice(i,1);job.reject(abort('held too long'));continue;}waiting=true;i++;continue;}
   job.heldSince=undefined;
   let model;try{model=getModel(job.modelId);}catch(error){this.queue.splice(i,1);job.reject(error);continue;}
   const slot=this.pickSlot(job.modelId,model,job)||this.preempt(job);
   if(!slot){i++;continue;}
   this.queue.splice(i,1);slot.busy=true;slot.job=job;this.clearFor(job,slot);this.run(slot,job);
  }
  clearTimeout(this.holdTimer);this.holdTimer=waiting&&!this.disposed?setTimeout(()=>this.pump(),250):0;
 }
 async run(slot,job){
  try{
   this.caps??=await this.capabilitiesFn();
   await this.prepare(slot,job.modelId,job.generation,job.epoch);
   if(job.join){
    /* pieces joined into one result; between two pieces the worker may be handed over (shouldYield): the job goes back into the queue with what it has.
       When the section becomes needed meanwhile (job.urgent(): playback reached its window), the pieces made so far are handed out at once as the head and
       the rest follows as a tail chain from this worker (as a split request would), instead of the whole section at the end. */
    job.parts??=[];
    for(let index=job.parts.length;index<job.units.length;index++){
     if(index>0&&job.urgent?.()){void this.streamRest(slot,job,index);return;}
     if(index>0&&this.shouldYield(job)){job.yields=(job.yields||0)+1;this.enqueue(job);return;}
     job.parts.push(await this.unit(slot,job,index));
    }
    job.resolve(joinParts(job.parts,job.from,lead));return;
   }
   const first=await this.unit(slot,job,0),pad=timings=>timings&&job.from?lead(job.from).concat(timings):timings;
   if(job.units.length<2){job.resolve({...first,wordTimings:pad(first.wordTimings),fromWord:job.from});return;}
   /* Several units: the first (head) resolves the request at once, every further piece follows from the SAME worker as `tail` (a promise; a piece that is not the
      last carries the next `tail` itself), so no other section starts in between. Each piece reports the word times of ALL words so far in section time. */
   const later=()=>{let settle;const promise=new Promise((resolve,reject)=>{settle={resolve,reject};});promise.catch(()=>{});return [promise,settle];};
   let [tail,settle]=later();
   const head={...first,wordTimings:pad(first.wordTimings),fromWord:job.from,partial:true,tail};
   this.busy++;job.delivered=true;job.resolve(head);
   try{
    let timings=head.wordTimings,shift=first.durationSec,ms=first.ms;
    for(let index=1;index<job.units.length;index++){
     const part=await this.unit(slot,job,index),last=index===job.units.length-1,offset=shift;
     timings=timings&&part.wordTimings?timings.concat(part.wordTimings.map(({start,end})=>({start:start+offset,end:end+offset}))):null;ms+=part.ms;shift+=part.durationSec;
     let next=null,nextSettle=null;if(!last)[next,nextSettle]=later();
     settle.resolve({...part,wordTimings:timings,timingKind:timings?part.timingKind:'none',ms,unitMs:part.ms,offset,...(last?{}:{partial:true,tail:next})});settle=nextSettle;
    }
   }catch(error){settle?.reject(error);throw error;}
   finally{this.busy--;this.scheduleUnload();}
  }catch(error){
   /* its worker was taken for needed audio (preempt): the job waits in the queue again, a joined one with the pieces it has */
   if(slot.preempted&&!job.delivered&&!this.disposed&&job.epoch===this.epoch&&!this.isCancelled(job.generation,job.owner)&&!job.signal?.aborted){this.enqueue(job);return;}
   if(!slot.dead&&slot.modelId!==job.modelId){this.slots=this.slots.filter(other=>other!==slot);this.dropSlot(slot);}/* a half-initialised worker is never reused */
   /* a SECOND worker that can not start (video memory, device lost) must not fail the section: the pool shrinks to one worker for this model and the job runs there */
   if(slot.extra&&slot.modelId!==job.modelId&&error?.name!=='AbortError'&&!job.retried&&!this.disposed&&job.epoch===this.epoch){this.poolBlocked.add(job.modelId);job.retried=true;this.queue.unshift(job);return;}
   /* one crash can be a passing memory peak: the job runs once more on a fresh worker before the error shows */
   const retry=error?.code==='worker-crashed'&&!job.delivered&&!job.crashRetried&&!this.disposed;
   if(retry&&job.epoch===this.epoch){job.crashRetried=true;this.queue.unshift(job);return;}
   job.reject(error);
  }finally{slot.busy=false;slot.job=null;if(slot.retire&&!slot.dead){this.slots=this.slots.filter(other=>other!==slot);this.dropSlot(slot);}this.pump();}
 }
 async unit(slot,job,index){
  const {text,words}=job.units[index];
  if(job.signal?.aborted)throw abort();
  // Hard line breaks inside a sentence become spaces (1:1 per character, so word offsets stay valid): not a clause boundary for the phonemizer.
  const result=await this.call(slot,{action:'synthesize',text:text.replace(/[\r\n\t\u2028\u2029]/g,' '),words,lang:job.lang,generation:job.generation},job.generation,job);
  if(this.disposed||job.epoch!==this.epoch||this.isCancelled(job.generation,job.owner)||job.signal?.aborted)throw abort();
  if(result.gpuFallback)this.noteBackend(slot,job.modelId,{backend:'wasm',gpuFallback:result.gpuFallback});      // the worker lost the GPU while reading and finished this unit on WASM
  return {pcm:result.samples,sampleRate:result.sampleRate,durationSec:result.durationSec,wordTimings:result.wordTimings,timingKind:result.timingKind,peak:result.peak,ms:result.ms,stats:result.stats};
 }
 /* req: {modelId, text, words?, lang?, generation}. -> {pcm, sampleRate, durationSec, wordTimings|null, timingKind, peak}.
  * `words` (token list of `text`) makes wordTimings exactly as long as `words`; without it the engine splits on whitespace. */
 synthesize(req){
  const {modelId,generation=0}=req;
  let {text,words}=req;
  /* Technical terms are rewritten for the SPOKEN text only (file names, paths, acronyms ...): one spoken string per input word, so word times and the highlight stay 1:1.
   * req.normalize overrides the engine default (this.speechNormalize); the language is the one of the voice, not of the page. */
  if(req.normalize===undefined?this.speechNormalize!==false:req.normalize!==false){
   let language=req.lang;try{language=getModel(modelId).lang||language;}catch{}
   const prepared=prepareSpeech({text,words},language);text=prepared.text;words=prepared.words;
  }
  /* req.head (words) and req.startWord: split the SYNTHESIS of this section, see speech-units.mjs. Without them the section is one unit, as before.
     req.grow (>= 1): progressive pieces after the head (each about `grow` times the one before), so no piece waits for a long rest; req.spread lets
     those pieces run on different workers (spread()). */
  /* req.chunked (background work, no head): short pieces joined into one result, the worker can be handed over between them (see shouldYield). */
  const plan=req.chunked&&!req.head&&!req.startWord?sentenceUnits(text,words,req.chunkWords):planUnits(text,words,{from:req.startWord,head:req.head,grow:req.grow,most:req.most});
  const owner=req.owner&&typeof req.owner==='object'?req.owner:undefined;
  this.highest=Math.max(this.highest,generation);
  if(owner){const state=this.ownerState(owner);state.highest=Math.max(state.highest,generation);}
  if(this.isCancelled(generation,owner))return Promise.reject(abort());
  this.busy++;clearTimeout(this.idleTimer);
  const epoch=this.epoch,done=()=>{this.busy--;this.scheduleUnload();};
  /* capabilities first, so the very first burst of requests can already use the pool */
  const ready=this.caps?null:this.capabilities().catch(()=>{this.caps={};});
  if(req.spread&&plan&&!plan.join&&plan.units.length>1){const head=this.spread(req,{modelId,plan,generation,epoch,owner,ready});head.then(done,done);return head;}
  const job=new Promise((resolve,reject)=>{
   const enqueue=()=>{const entry={modelId,units:plan?plan.units:[{text,words}],from:plan?plan.from:0,join:plan?.join===true,lang:req.lang,generation,epoch,signal:req.signal,resolve,reject};
   Object.assign(entry,{owner,tier:req.tier,parallel:req.parallel,hold:typeof req.hold==='function'?req.hold:undefined,urgent:typeof req.urgent==='function'?req.urgent:undefined,seq:Number.isFinite(req.seq)?req.seq:undefined,first:req.first===true});
   if(req.signal){if(req.signal.aborted){reject(abort());return;}req.signal.addEventListener('abort',()=>this.abortJob(entry),{once:true});}
   this.enqueue(entry);this.pump();};
   ready?ready.then(enqueue):enqueue();
  });
  job.then(done,done);
  return job;
 }
 /* req.spread: the pieces of a section (head + growing pieces) may run on DIFFERENT workers of the pool. Every piece is its own queued job (same tier, owner,
    generation and parallel limit, enqueued together, so no later section gets between them); the results are handed out in order: the head resolves the
    request, each further piece resolves the `tail` of the one before (word times of all words so far in section time, as with one worker). With one worker
    (or parallel: 1 before the first sound) this is the same order as the chain on one worker; with a pair the next piece is made while the first plays. */
 spread(req,{modelId,plan,generation,epoch,owner,ready}){
  const entries=[],later=()=>{let settle;const promise=new Promise((resolve,reject)=>{settle={resolve,reject};});promise.catch(()=>{});return [promise,settle];};
  /* req.hold / req.urgent (a start nobody listens to yet): each piece waits in the queue while held, as a background job does between its pieces */
  const hold=typeof req.hold==='function'?req.hold:undefined,urgent=typeof req.urgent==='function'?req.urgent:undefined;
  const subs=plan.units.map((unit,index)=>new Promise((resolve,reject)=>{entries.push({modelId,units:[unit],from:index?0:plan.from,join:false,lang:req.lang,generation,epoch,signal:req.signal,resolve,reject,owner,tier:req.tier,parallel:req.parallel,piece:index,seq:Number.isFinite(req.seq)?req.seq+index/1000:undefined,hold,urgent,first:index===0&&req.first===true});}));
  for(const sub of subs)sub.catch(()=>{});
  const start=()=>{
   if(req.signal?.aborted){for(const entry of entries)entry.reject(abort());return;}
   req.signal?.addEventListener('abort',()=>{for(const entry of entries)this.abortJob(entry);},{once:true});
   for(const entry of entries)this.enqueue(entry);this.pump();
  };
  ready?ready.then(start):start();
  subs[0].catch(()=>{for(const entry of entries.slice(1))this.abortJob(entry);});
  return subs[0].then(first=>{
   let [tail,settle]=later();this.busy++;
   (async()=>{
    let timings=first.wordTimings,shift=first.durationSec,ms=first.ms;
    try{
     for(let index=1;index<subs.length;index++){
      const part=await subs[index],last=index===subs.length-1,offset=shift;
      timings=timings&&part.wordTimings?timings.concat(part.wordTimings.map(({start,end})=>({start:start+offset,end:end+offset}))):null;ms+=part.ms;shift+=part.durationSec;
      let next=null,nextSettle=null;if(!last)[next,nextSettle]=later();
      settle.resolve({...part,wordTimings:timings,timingKind:timings?part.timingKind:'none',ms,unitMs:part.ms,offset,...(last?{}:{partial:true,tail:next})});settle=nextSettle;
     }
    }catch(error){settle?.reject(error);for(const entry of entries)this.abortJob(entry);}
    finally{this.busy--;this.scheduleUnload();}
   })();
   return {...first,fromWord:plan.from,partial:true,tail};
  });
 }
 /* Cached, except a negative WebGPU answer: the adapter can appear a moment after start (GPU process not ready), so "no" is asked again, "yes" never. */
 /* Device facts for the voice list (every page and every popup asks the host for them). A "no WebGPU" answer is asked again on the next call (the GPU process may not have
  * been ready the first time), but requestAdapter() can take hundreds of milliseconds up to seconds on a slow or absent GPU stack (Linux without working Vulkan): then the
  * answer is shared between concurrent callers and probed again at most every 15 s, so the voice list never waits for it on every open.
  * `force`: the user just tried to start a WebGPU voice - ask again now. */
 async capabilities({force=false}={}){
  const slow=(this.capsMs||0)>300,stale=!this.caps||force||(this.caps.webgpu===false&&(!slow||performance.now()-(this.capsAt||0)>15000));
  if(stale){
   const started=performance.now();
   this.capsProbe??=this.capabilitiesFn().then(caps=>{this.caps=caps;this.capsAt=performance.now();this.capsMs=this.capsAt-started;return caps;},error=>{if(!this.caps)throw error;return this.caps;}).finally(()=>{this.capsProbe=null;});
   return this.capsProbe;
  }
  return this.caps;
 }
 /* Loaded backend/threads of the warm worker, or null. */
 get loaded(){const slot=this.slots.find(item=>item.info&&item.modelId);return slot?{modelId:slot.modelId,backend:slot.info.backend,gpu:slot.info.gpu||null,threads:slot.info.threads,workers:this.slots.filter(item=>item.modelId===slot.modelId).length,initMs:Math.round(slot.initMs||0),...(this.gpuFailed.has(slot.modelId)?{gpuFallback:this.gpuFailed.get(slot.modelId)}:{})}:null;}
 /* Loads a model into a worker BEFORE the first section is asked for (the bar is open, the voice is chosen) and compiles the GPU shaders with a short warm-up sentence, so the first real
  * section does not pay the cold start (measured 4.7-10.5 s for Qwen3-TTS). Silent, nothing is played; false when nothing was started (already warm, not installed, no free worker, error). */
 async warm(modelId,{evict=true}={}){
  let model;try{model=getModel(modelId);}catch{return false;}
  if(this.disposed||this.installing)return false;
  this.caps??=await this.capabilitiesFn().catch(()=>({}));
  if(this.slots.some(slot=>!slot.dead&&(slot.modelId===modelId||slot.starting===modelId)))return false;
  /* evict:false (warm-up on bar open): a worker holding another voice may belong to a session in another tab */
  if(!evict&&this.slots.some(slot=>!slot.dead))return false;
  const epoch=this.epoch,slot=this.pickSlot(modelId,model);if(!slot)return false;
  slot.busy=true;slot.warming=modelId;this.busy++;clearTimeout(this.idleTimer);
  try{
   await this.prepare(slot,modelId,undefined,epoch);
   if(model.needs?.webgpu)await this.call(slot,{action:'synthesize',text:'Ready.',words:['Ready.']},undefined);
   return true;
  }catch{
   if(!slot.dead&&slot.modelId!==modelId){this.slots=this.slots.filter(other=>other!==slot);this.dropSlot(slot);}
   return false;
  }finally{slot.busy=false;slot.warming=null;this.busy--;this.scheduleUnload();this.pump();}
 }
 /* A voice that needs a pair of workers at this tempo (poolLimit 2: one worker can not keep up) gets its second worker loaded while nothing is needed yet
    (the bar is open, Play not pressed): a cold load at the start of playback took seconds of CPU from the first worker. false when nothing was started. */
 async warmPair(modelId){
  let model;try{model=getModel(modelId);}catch{return false;}
  if(this.disposed||this.installing||this.queue.length)return false;
  const mine=this.slots.filter(slot=>!slot.dead&&(slot.modelId===modelId||slot.starting===modelId));
  if(mine.length!==1||!mine[0].modelId||this.poolLimit(model,{tier:'near'})<2||this.slots.length>=MAX_WORKERS)return false;
  const epoch=this.epoch,slot=this.newSlot(modelId,true);slot.busy=true;slot.warming=modelId;this.busy++;clearTimeout(this.idleTimer);
  try{await this.prepare(slot,modelId,undefined,epoch);return true;}
  catch{if(!slot.dead&&slot.modelId!==modelId){this.slots=this.slots.filter(other=>other!==slot);this.dropSlot(slot);}return false;}
  finally{slot.busy=false;slot.warming=null;this.busy--;this.scheduleUnload();this.pump();}
 }
 get worker(){return this.slots.find(slot=>slot.worker)?.worker||null;}
 async dispose(){this.disposed=true;this.epoch++;this.cancelInstall();this.cancel();this.terminate();clearTimeout(this.idleTimer);}
}
export {capabilities,threadCount} from './capabilities.js';
export {estimateWordTimings,kokoroWordTimings} from './timing.js';
export {MODELS,modelBytes};
