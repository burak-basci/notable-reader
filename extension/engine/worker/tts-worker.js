/* beNotable! Reader engine worker · own code MIT. Uses separately licensed ONNX Runtime and the GPL eSpeak/Piper phonemizer.
 * Loads the model from the Cache API itself (no extra copy through the page), synthesises, answers with transferable PCM.
 * A `cancel` message is handled immediately (outside the queue), so a pending or multi-part job stops between its parts. */
import * as ort from '../../tools/reader/vendor/neural/ort/ort.wasm.min.mjs';
import createPiperPhonemize from '../../tools/reader/vendor/neural/piper/piper_phonemize.mjs';
import {RUNTIME_BASE} from '../models/registry.js';
import {createSynth} from './synth.js';
const base=new URL(RUNTIME_BASE,import.meta.url);
ort.env.wasm.wasmPaths=new URL('ort/',base).href;
ort.env.wasm.proxy=false;
ort.env.wasm.numThreads=1;
let cancelledUpTo=-1;const lines=[];
/* Cancelled request ids: the engine cancels single requests (one session's), never everything below a number. */
const cancelledIds=new Set(),pending=new Set();
/* The bundled eSpeak/Piper build keeps state between callMain() runs: one long-lived instance aborts after roughly 35 sections ("null function", "Aborted()",
   measured: 200/200 sections ok with a fresh instance per call, abort at call 32..158 without). A fresh instance costs ~44 ms, so every phonemize() call
   gets its own, and a call with many runs (Russian, see below) gets a new one every RUNS_PER_INSTANCE runs. Old instances are simply dropped (GC frees the WASM memory). */
const RUNS_PER_INSTANCE=16,PER_ENTRY=new Set(['ru']);
const createInstance=()=>createPiperPhonemize({noInitialRun:true,print:line=>{lines.push(line);},printErr:()=>{},locateFile:name=>new URL('piper/'+name,base).href});
/* One phonemizer call for many texts: the tool prints one JSON line per input, in order. */
async function phonemize(texts,language){
 let phonemizer=await createInstance(),runs=0;
 const run=async list=>{
  if(runs>=RUNS_PER_INSTANCE){phonemizer=await createInstance();runs=0;}
  runs++;lines.length=0;phonemizer.callMain(['-l',language,'--input',JSON.stringify(list.map(text=>({text:text.trim()}))),'--espeak_data','/espeak-ng-data']);return lines.map(line=>{try{return JSON.parse(line);}catch{return null;}});
 };
 /* Russian aborts with Aborted(OOM) as soon as one call carries more than three entries (measured); one entry per call runs (48/48). */
 const single=async text=>(await run([text]))[0]||{phonemes:[],phoneme_ids:[]};
 if(PER_ENTRY.has(String(language).split('-')[0].toLowerCase())){const out=[];for(const text of texts)out.push(await single(text));return out;}
 let out=await run(texts);
 /* Fallback when an input produced no line (e.g. punctuation only): one call per text keeps the result aligned with the input. */
 if(out.length!==texts.length||out.some(item=>!item||!Array.isArray(item.phonemes))){out=[];for(const text of texts)out.push(await single(text));}
 return out;
}
/* WebGPU runtime (ONNX Runtime Web 1.31.1, JSPI build = smallest WebGPU build, 17.9 MB WASM; needs WebAssembly JSPI: Chrome 137+) only for models that need it (Qwen3-TTS).
   JS glue AND WASM ship in the package (vendor/neural/ort-webgpu/, SHA-256 in runtime-hashes.json) and load from the extension origin: no code is fetched from outside. One instance per worker. */
let gpuOrt=null;
async function webgpuOrt(){
 if(!gpuOrt){
  const module=await import(new URL('ort-webgpu/ort.jspi.min.mjs',base).href);
  module.env.wasm.wasmPaths={mjs:new URL('ort-webgpu/ort-wasm-simd-threaded.jspi.mjs',base).href,wasm:new URL('ort-webgpu/ort-wasm-simd-threaded.jspi.wasm',base).href};
  module.env.wasm.numThreads=1;module.env.wasm.proxy=false;
  gpuOrt=module;
 }
 return gpuOrt;
}
const isCancelled=token=>token!==undefined&&(cancelledIds.has(token)||token<=cancelledUpTo);
const synth=createSynth({ort,phonemize,webgpuOrt,isCancelled});
/* Errors after which the WebAssembly runtime of this worker can not be trusted any more (abort, out of memory). */
const FATAL=/\bAborted\(|out of memory|memory access out of bounds/i;
const fatal=error=>error instanceof WebAssembly.RuntimeError||error instanceof RangeError||
 FATAL.test(String(error?.message));
async function readAssets(message){
 const cache=await caches.open(message.cacheName),init={kind:message.kind,threads:message.threads,prefer:message.prefer,voice:message.voice,idMap:message.idMap,language:message.language,speakerId:message.speakerId,params:message.params};
 for(const file of message.files){
  const response=await cache.match(file.url);
  if(!response)throw Error('Bitte das lokale Sprachmodell zuerst über den Downloadknopf laden.');
  if(file.role==='config'||file.role==='tokenizer')init[file.role]=await response.json();
  else{const bytes=await response.arrayBuffer();if(file.role==='model')init.model=new Uint8Array(bytes);else init[file.role==='style'?'style':file.role]=bytes;}
 }
 return init;
}
let queue=Promise.resolve();
self.addEventListener('message',event=>{
 const message=event.data;
 if(message.action==='cancel'){
  if(Array.isArray(message.ids)){for(const id of message.ids)if(pending.has(id))cancelledIds.add(id);}
  else if(Number.isFinite(message.upTo))cancelledUpTo=Math.max(cancelledUpTo,message.upTo);
  return;
 }
 if(message.action==='synthesize')pending.add(message.id);
 queue=queue.then(async()=>{
  try{
   if(message.action==='init'){self.postMessage({id:message.id,ok:true,...await synth.load(await readAssets(message))});return;}
   if(message.action==='synthesize'){
    const result=await synth.run({...message,generation:message.id}),{samples}=result;
    self.postMessage({id:message.id,ok:true,...result},[samples.buffer]);return;
   }
   if(message.action==='dispose'){await synth.unload();self.postMessage({id:message.id,ok:true,disposed:true});return;}
   throw Error('Unbekannter lokaler Sprachbefehl.');
  }catch(error){
   const aborted=error.name==='AbortError',stack=String(error.stack||'').split('\n').slice(0,4).join(' / ');
   const failure={ok:false,aborted,fatal:!aborted&&fatal(error),code:typeof error.code==='string'?error.code:undefined,stack};
   failure.error=error.message||'synthesis-failed';
   self.postMessage({id:message.id,...failure});
  }
  finally{pending.delete(message.id);cancelledIds.delete(message.id);}
 });
});
