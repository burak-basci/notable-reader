/* beNotable! Reader engine · synthesis pipelines · own code MIT. Uses separately licensed ONNX Runtime and the GPL eSpeak/Piper phonemizer.
 * Pure of globals: ORT and the phonemizer are injected, so the same code runs in the worker and in tests.
 * Synthesis is always at speed 1.0 (rate is applied at playback with pitch preservation), so cached audio and word times stay valid at any tempo. */
import {KITTEN_SYMBOLS} from '../models/registry.js';
import {createPhonon} from './pocket-family.js';
import {createQwen3Tts} from './qwen3tts.js';
import {alignOwners,sourcePhonemes,kokoroWordTimings,estimateWordTimings,shiftTimings} from '../timing.js';
const UTF8_DEC=new TextDecoder();
const KITTEN_INDEX=new Map(Array.from(KITTEN_SYMBOLS,(symbol,index)=>[symbol,index]));
const KOKORO_MAX_IDS=512,abort=()=>new DOMException('Die lokale Berechnung wurde abgebrochen.','AbortError');
/* A section of only symbols or punctuation ("* * *", "—") has nothing to pronounce: a short pause keeps the reading
   going. With letters or digits an empty result means the phonemizer failed, and that stays an error. */
const SPEAKABLE=/[\p{L}\p{N}]/u,PAUSE_SEC=0.25;
const pauseFor=(words,sampleRate=24000)=>({samples:new Float32Array(Math.round(sampleRate*PAUSE_SEC)),
 timings:words.map(()=>({start:0,end:PAUSE_SEC})),phonemes:words.map(()=>'')});
export const wordsOf=text=>text.match(/\S+/g)||[];

/* Minimal .npz reader: one stored or deflated float32 matrix by name (Kitten voice styles). */
export async function npzMatrix(buffer,name){
 const view=new DataView(buffer),bytes=new Uint8Array(buffer);let end=buffer.byteLength-22;
 while(end>=0&&view.getUint32(end,true)!==0x06054b50)end--;
 if(end<0)throw Error('Die Stimmendatei ist beschädigt.');
 let at=view.getUint32(end+16,true);
 for(let n=view.getUint16(end+10,true);n>0;n--){
  if(view.getUint32(at,true)!==0x02014b50)break;
  const method=view.getUint16(at+10,true),size=view.getUint32(at+20,true),nameLength=view.getUint16(at+28,true),local=view.getUint32(at+42,true);
  if(UTF8_DEC.decode(bytes.subarray(at+46,at+46+nameLength))===name+'.npy'){
   const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);let raw=bytes.subarray(start,start+size);
   if(method===8)raw=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
   else if(method!==0)throw Error('Die Stimmendatei verwendet ein nicht unterstütztes Format.');
   const header=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),headerLength=header.getUint16(8,true),text=UTF8_DEC.decode(raw.subarray(10,10+headerLength));
   const shape=/'shape':\s*\((\d+),\s*(\d+)/.exec(text);
   if(!shape||!/<f4/.test(text))throw Error('Die Stimmendatei hat ein unerwartetes Datenformat.');
   const data=new Float32Array(raw.slice(10+headerLength).buffer);
   return {data,rows:Number(shape[1]),width:Number(shape[2])};
  }
  at+=46+nameLength+view.getUint16(at+30,true)+view.getUint16(at+32,true);
 }
 throw Error('Die gewählte Stimme fehlt in der Stimmendatei.');
}
/* Kitten: sentences up to 400 characters, each ending in punctuation (reference implementation). */
export function kittenChunks(text){
 const out=[];
 for(const sentence of text.replace(/\s+/g,' ').trim().match(/[^.!?]+[.!?]*["')\]]*|[^.!?]+$/g)||[]){
  const part=sentence.trim();if(!part)continue;
  let current='';for(const word of part.split(' ')){if(current&&current.length+word.length+1>400){out.push(current);current=word;}else current=current?current+' '+word:word;}
  if(current)out.push(current);
 }
 return out.map(chunk=>/[.!?,;:]$/.test(chunk)?chunk:chunk+',');
}
/* Piper 1.5 configs list `vowel_clusters` (["a","ɪ"] ...): adjacent phonemes of a cluster become ONE symbol ("aɪ") with
   its own id, as piper1-gpl does before the id lookup (_merge_known_vowel_clusters, longest match first). */
export function mergeVowelClusters(list,clusters,map){
 const known=(clusters||[]).filter(c=>Array.isArray(c)&&c.length>1&&map[c.join('')]);
 if(!known.length)return list;
 const keys=new Set(known.map(c=>c.join('\u0000'))),longest=Math.max(...known.map(c=>c.length)),out=[];
 for(let i=0;i<list.length;){
  let n=Math.min(longest,list.length-i);
  while(n>1&&!keys.has(list.slice(i,i+n).join('\u0000')))n--;
  out.push(n>1?list.slice(i,i+n).join(''):list[i]);i+=n>1?n:1;
 }
 return out;
}
/* German Kokoro fine-tunes (kikiri-tts recipe) were trained on misaki EspeakG2P('de') output: eSpeak-NG 1.52 with
   tie marks, where tied pairs became one symbol (a^ɪ I, a^ʊ W, t^s ʦ, d^ʒ ʤ, t^ʃ ʧ) and ʏ became y. The shipped
   phonemizer writes no tie marks, so the pairs are merged by sequence. Measured on that eSpeak: aɪ, aʊ, dʒ are
   always tied; tʃ only at the start of a word (Tschüss, not deutsch/Matsch); ts is tied except in word-final -ts
   after a consonant or long vowel (nachts, stets), which is merged here too (ʦ and t+s sound almost alike). */
export const kokoroGerman=value=>value.replace(/ʏ/g,'y').replace(/aɪ/g,'I').replace(/aʊ/g,'W').replace(/dʒ/g,'ʤ')
 .replace(/ts/g,'ʦ').replace(/(^|[^\p{L}\p{M}])tʃ/gu,'$1ʧ');
/* Voices with their own symbol table (eva_k): ids from the voice config; sentence ends insert EOS+BOS like the phonemizer. */
export function piperIds(list,map,clusters){
 if(clusters)list=mergeVowelClusters(list,clusters,map);
 const ids=[1,0];
 list.forEach((symbol,index)=>{const mapped=map[symbol];if(!mapped)return;ids.push(...mapped,0);if('.?!'.includes(symbol)&&index<list.length-1)ids.push(2,1,0);});
 ids.push(2);return ids;
}
/* Cuts near-silence at both ends (Kokoro starts with ~0.3 s of pad) so consecutive sections join without a gap; 25 ms head / 60 ms tail stay. */
export function trimSilence(samples,sampleRate,peak){
 const limit=Math.max(0.002,peak*0.015),head=Math.round(sampleRate*0.025),tail=Math.round(sampleRate*0.06);
 let a=0,b=samples.length;
 while(a<b&&Math.abs(samples[a])<limit)a++;
 while(b>a&&Math.abs(samples[b-1])<limit)b--;
 if(a>=b)return {samples,cut:0};
 a=Math.max(0,a-head);b=Math.min(samples.length,b+tail);
 return {samples:a===0&&b===samples.length?samples:samples.slice(a,b),cut:a/sampleRate};
}
const peakOf=samples=>{let peak=0;for(let i=0;i<samples.length;i++){const v=Math.abs(samples[i]);if(v>peak)peak=v;}return peak;};
function concat(parts){const total=parts.reduce((n,p)=>n+p.length,0),out=new Float32Array(total);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;}

/* GPU session of a phonemizer voice (Piper): the WebGPU execution provider of the package's WebGPU runtime on an own device with the adapter's buffer limits
   (the default limits failed on the longest sections, measured), storage buffers released after each run (lazyRelease: 1.0-1.6 GB of video memory instead
   of 1.3-3.7 GB with the default bucket cache, same speed). gpu: {limits?: boolean, cache?: string} overrides for measurements. */
const GPU_DEFAULTS={limits:true,cache:'lazyRelease'};
/* The test sentence of a GPU load: digits are spoken in every eSpeak language. Plausible = finite samples, 0.3-10 s, peak 0.02-4, some energy. */
const PROBE_TEXT='1, 2, 3.';
export function plausibleAudio(samples,sampleRate){
 let peak=0,sum=0;for(let i=0;i<samples.length;i++){const v=samples[i];if(!Number.isFinite(v))return {ok:false,code:'webgpu-nan'};const a=Math.abs(v);if(a>peak)peak=a;sum+=v*v;}
 const sec=samples.length/sampleRate,rms=Math.sqrt(sum/Math.max(1,samples.length)),ok=sec>0.3&&sec<10&&peak>0.02&&peak<4&&rms>0.002;
 return {ok,code:ok?'':'webgpu-implausible',sec:+sec.toFixed(2),peak:+peak.toFixed(3)};
}
export function createSynth({ort,phonemize,isCancelled=()=>false,now=()=>performance.now(),webgpuOrt=null,gpuApi=()=>globalThis.navigator?.gpu}){
 let family=null;/* own adapters without phonemizer: flow-LM family (Phonon) and Qwen3-TTS (WebGPU) */
 let session=null,kind='',config=null,style=null,vocab=null,kitten=null,configIds=false,backend='wasm',language='en-us',speakerId=0;
 /* rt: the ONNX Runtime of the current session (the WASM build, or the WebGPU runtime for a GPU session): tensors must come from the same runtime.
    gpu: {device, lost, model} of a GPU session (the model bytes stay for a switch to WASM when the GPU fails while reading). */
 let rt=ort,gpu=null;
 const check=generation=>{if(isCancelled(generation))throw abort();};
 async function dropGpu(){const state=gpu;gpu=null;if(!state)return;if(session&&backend==='webgpu'){const old=session;session=null;try{await old.release();}catch{}}try{state.device?.destroy?.();}catch{}rt=ort;backend='wasm';}
 async function unload(){const gone=family;family=null;if(gone)await gone.unload();await dropGpu();const old=session;session=null;kind='';style=null;vocab=null;kitten=null;config=null;if(old)await old.release();}
 /* A GPU session for this model, tested with a short sentence; throws (code webgpu-*) when there is no real adapter or the test fails. */
 async function openGpu(init){
  const options={...GPU_DEFAULTS,...(init.gpu||{})},api=gpuApi();
  const adapter=await api?.requestAdapter?.({powerPreference:'high-performance'});
  if(!adapter||adapter.isFallbackAdapter||adapter.info?.isFallbackAdapter)throw Object.assign(Error('webgpu-unavailable'),{code:'webgpu-unavailable'});
  const gpuRt=await webgpuOrt(init);if(init.threads)gpuRt.env.wasm.numThreads=init.threads;
  const limits=adapter.limits,device=options.limits?await adapter.requestDevice({requiredLimits:{maxBufferSize:limits.maxBufferSize,maxStorageBufferBindingSize:limits.maxStorageBufferBindingSize}}):undefined;
  const state={device,lost:'',model:init.model};device?.lost?.then(info=>{state.lost=String(info?.reason||'lost');},()=>{});
  gpu=state;rt=gpuRt;backend='webgpu';
  session=await gpuRt.InferenceSession.create(init.model,{executionProviders:[{name:'webgpu',...(device?{device}:{}),...(options.cache?{storageBufferCacheMode:options.cache}:{})}],graphOptimizationLevel:'all'});
  const t=now(),probe=await runModel({text:PROBE_TEXT,words:wordsOf(PROBE_TEXT)}),verdict=plausibleAudio(probe.samples,probe.sampleRate);
  if(!verdict.ok)throw Object.assign(Error(verdict.code),{code:verdict.code});
  return {probeMs:Math.round(now()-t),probe:verdict};
 }
 /* init: {kind, model:Uint8Array, config?, style?:ArrayBuffer, tokenizer?, voices?:ArrayBuffer, voice?, idMap?, threads, prefer}
  * prefer 'webgpu' tries the GPU first and falls back to WASM; the actually used backend is reported, never assumed. */
 async function load(init){
  await unload();
  kind=init.kind;config=init.config||null;configIds=init.idMap==='config';language=init.language||'en-us';speakerId=init.speakerId||0;/* espeak language (Kokoro, from the register) and speaker number (Piper multi-speaker models) */
  style=init.style?new Float32Array(init.style):null;vocab=init.tokenizer?.model?.vocab||null;
  if(kind==='phonon'){
   if(init.threads)ort.env.wasm.numThreads=init.threads;
   family=createPhonon({ort,isCancelled});
   const info=await family.load(init,ep=>({executionProviders:[ep],graphOptimizationLevel:'all'}));
   return {backend:family.backend,threads:ort.env.wasm.numThreads,...info};
  }
  if(kind==='qwen3tts'){
   if(!webgpuOrt)throw Object.assign(Error('webgpu-unavailable'),{code:'webgpu-unavailable'});
   family=createQwen3Tts({ort:await webgpuOrt(init),isCancelled});
   const info=await family.load(init);
   return {...info,threads:1};
  }
  if(kind==='kitten'){const matrix=await npzMatrix(init.voices,init.voice.name);kitten={...matrix,speed:init.voice.speed||1};}
  if(init.threads)ort.env.wasm.numThreads=init.threads;
  const options=ep=>({executionProviders:[ep],graphOptimizationLevel:'all'});
  backend='wasm';rt=ort;let gpuFallback='',gpuInfo=null;
  /* prefer 'webgpu' (the engine asks for it only where it was measured faster): the GPU session must load and read its test sentence plausibly, else WASM */
  if(init.prefer==='webgpu'&&webgpuOrt){try{gpuInfo=await openGpu(init);}catch(error){gpuFallback=String(error?.code||error?.message||'webgpu-failed').slice(0,60);await dropGpu();session=null;}}
  if(!session)session=await ort.InferenceSession.create(init.model,options('wasm'));
  return {backend,threads:ort.env.wasm.numThreads,inputs:session.inputNames,outputs:session.outputNames,...(gpuFallback?{gpuFallback}:{}),...(gpuInfo?{gpuProbeMs:gpuInfo.probeMs}:{})};
 }
 /* --- Kokoro: audio + model durations -> exact word times --- */
 const kokoroNormalize=raw=>language.startsWith('en')?raw.replace(/ʲ/g,'j').replace(/r/g,'ɹ').replace(/x/g,'k').replace(/ɬ/g,'l'):language==='de'?kokoroGerman(raw.replace(/ʲ/g,'j')):raw.replace(/ʲ/g,'j');
 async function kokoroSpan(words,text,generation){
  check(generation);
  const results=await phonemize([text,...words],language);
  const known=value=>Array.from(kokoroNormalize(value)).filter(c=>Object.hasOwn(vocab,c)).join('');
  const target=Array.from(known(results[0].phonemes.join('')));
  if(!target.length&&!SPEAKABLE.test(text))return pauseFor(words);
  if(!target.length)throw Error('Die lokale englische Phonemaufbereitung ist nicht verfügbar.');
  const idCount=target.length+2;
  if(idCount>KOKORO_MAX_IDS){
   if(words.length<2)return kokoroLong(target,words,results,generation);
   const half=Math.ceil(words.length/2),left=await kokoroSpan(words.slice(0,half),words.slice(0,half).join(' '),generation),right=await kokoroSpan(words.slice(half),words.slice(half).join(' '),generation),offset=left.samples.length/24000;
   return {samples:concat([left.samples,right.samples]),timings:left.timings&&right.timings?[...left.timings,...right.timings.map(({start,end})=>({start:start+offset,end:end+offset}))]:null,phonemes:[...left.phonemes,...right.phonemes]};
  }
  const {source,owners:sourceOwners}=sourcePhonemes(results.slice(1).map(r=>r.phonemes.join('')),known);
  const owners=alignOwners(source,sourceOwners,target.join(''));
  const ids=[0,...target.map(c=>vocab[c]),0],offset=256*Math.min(idCount-2,509);
  const output=await session.run({input_ids:new rt.Tensor('int64',BigInt64Array.from(ids.map(BigInt)),[1,ids.length]),style:new rt.Tensor('float32',style.slice(offset,offset+256),[1,256]),speed:new rt.Tensor('float32',Float32Array.of(1),[1])});
  check(generation);
  const samples=new Float32Array(output.waveform.data);
  const timings=output.duration?kokoroWordTimings(output.duration.data,[null,...owners,null],samples.length,24000,words.length):null;
  return {samples,timings,phonemes:results.slice(1).map(r=>r.phonemes.join(''))};
 }
 /* One "word" with more phonemes than the model takes at once (a long URL or code spelled out): it is spoken in
    pieces and owns the whole audio, instead of stopping the reading with an error. */
 async function kokoroLong(target,words,results,generation){
  const pieces=[],size=KOKORO_MAX_IDS-2;
  for(let at=0;at<target.length;at+=size){
   check(generation);
   const part=target.slice(at,at+size),ids=[0,...part.map(c=>vocab[c]),0],offset=256*Math.min(part.length,509);
   const feeds={input_ids:new rt.Tensor('int64',BigInt64Array.from(ids.map(BigInt)),[1,ids.length]),
    style:new rt.Tensor('float32',style.slice(offset,offset+256),[1,256]),
    speed:new rt.Tensor('float32',Float32Array.of(1),[1])};
   pieces.push(new Float32Array((await session.run(feeds)).waveform.data));
  }
  check(generation);
  const samples=concat(pieces),end=samples.length/24000;
  return {samples,timings:words.map(()=>({start:0,end})),phonemes:results.slice(1).map(r=>r.phonemes.join(''))};
 }
 async function runKokoro({text,words,generation}){
  const {samples,timings,phonemes}=await kokoroSpan(words,text,generation);
  /* a model export without a duration output degrades to the estimate instead of failing */
  return {samples,sampleRate:24000,timings,phonemes,timingKind:timings?'model':'estimated'};
 }
 /* --- Piper --- */
 async function runPiper({text,words,generation}){
  check(generation);
  const results=await phonemize([text,...words],config.espeak.voice),raw=results[0],ids=configIds?piperIds(raw.phonemes,config.phoneme_id_map,config.vowel_clusters):raw.phoneme_ids;
  if(!Array.isArray(ids)||!ids.length)throw Error('Die lokale deutsche Phonemaufbereitung ist nicht verfügbar.');
  const feeds={input:new rt.Tensor('int64',BigInt64Array.from(ids.map(BigInt)),[1,ids.length]),input_lengths:new rt.Tensor('int64',BigInt64Array.of(BigInt(ids.length)),[1]),scales:new rt.Tensor('float32',Float32Array.of(config.inference.noise_scale,config.inference.length_scale,config.inference.noise_w),[3])};
  if(session.inputNames.includes('sid'))feeds.sid=new rt.Tensor('int64',BigInt64Array.of(BigInt(speakerId)),[1]);
  const output=await session.run(feeds);check(generation);
  const samples=new Float32Array((output.output||output[session.outputNames[0]]).data),sampleRate=config.audio.sample_rate;
  return {samples,sampleRate,phonemes:results.slice(1).map(r=>r.phonemes.join('')),timings:undefined,timingKind:'estimated'};
 }
 /* --- Kitten --- */
 async function runKitten({text,words,generation}){
  const parts=[];let total=0;
  for(const chunk of kittenChunks(text)){
   check(generation);
   const [raw]=await phonemize([chunk],'en-us'),value=raw.phonemes.join('');
   const symbols=value.match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu)||[];
   const ids=[0,...Array.from(symbols.join(' '),symbol=>KITTEN_INDEX.get(symbol)).filter(index=>index!==undefined),10,0];
   if(ids.length<4)continue;
   const row=Math.min(chunk.length,kitten.rows-1),rowStyle=kitten.data.slice(row*kitten.width,(row+1)*kitten.width);
   const output=await session.run({input_ids:new rt.Tensor('int64',BigInt64Array.from(ids.map(BigInt)),[1,ids.length]),style:new rt.Tensor('float32',rowStyle,[1,kitten.width]),speed:new rt.Tensor('float32',Float32Array.of(kitten.speed),[1])});
   const wave=output.waveform.data,keep=Math.max(0,wave.length-5000);/* the model appends a silent tail */
   parts.push(wave.slice(0,keep));total+=keep;
  }
  if(!total&&!SPEAKABLE.test(text))return {...pauseFor(words),sampleRate:24000,timingKind:'estimated'};
  if(!total)throw Error('Die lokale englische Phonemaufbereitung ist nicht verfügbar.');
  const phonemes=(await phonemize(words,'en-us')).map(r=>r.phonemes.join(''));
  return {samples:concat(parts),sampleRate:24000,phonemes,timings:undefined,timingKind:'estimated'};
 }
 /* --- Phonon: audio only, word times are estimated from letter counts and the pauses in the audio --- */
 async function runPhonon({text,words,generation}){/* also Qwen3-TTS: audio only, estimated word times */
  const out=await family.run({text,generation});
  return {samples:out.samples,sampleRate:out.sampleRate,phonemes:words.map(word=>Math.max(1,Array.from(word).filter(char=>/[\p{L}\p{N}]/u.test(char)).length)),timings:undefined,timingKind:'estimated',stats:out.stats};
 }
 /* req: {text, words?, generation}. Result: {samples,sampleRate,durationSec,wordTimings,timingKind,peak,ms}. */
 async function run(req){
  if(!session&&!family)throw Error('Bitte zuerst das lokale Sprachmodell laden.');
  const started=now(),text=req.text.trim(),words=req.words?.length?req.words:wordsOf(text),generation=req.generation;
  if(!text)throw Error('Kein Text zum Vorlesen.');
  const job={text,words,generation};let fellBack='';
  let result;
  try{result=family?await runPhonon(job):await runModel(job);}
  catch(error){
   /* the GPU failed while reading (a lost device, a buffer it can not allocate): this worker goes on with WASM for good and reads the same unit again */
   if(backend!=='webgpu'||!gpu?.model||error?.name==='AbortError')throw error;
   fellBack=String(gpu.lost||error?.message||'webgpu-failed').slice(0,60);const model=gpu.model;await dropGpu();
   session=await ort.InferenceSession.create(model,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
   result=await runModel(job);
  }
  let {samples}=result,peak=peakOf(samples),cut=0;
  const trimmed=trimSilence(samples,result.sampleRate,peak);samples=trimmed.samples;cut=trimmed.cut;
  const durationSec=samples.length/result.sampleRate;
  let timings=result.timings,timingKind=result.timingKind;
  if(timings)timings=shiftTimings(timings,cut,durationSec);
  else if(words.length){timings=estimateWordTimings(words,result.phonemes,durationSec,{pcm:samples,sampleRate:result.sampleRate});timingKind='estimated';}
  else timingKind='none';
  if(!timings)timingKind='none';
  return {samples,sampleRate:result.sampleRate,durationSec,wordTimings:timings||null,timingKind,peak,ms:now()-started,...(result.stats?{stats:result.stats}:{}),...(fellBack?{gpuFallback:fellBack,backend:'wasm'}:{})};
 }
 function runModel(job){return kind==='kokoro'?runKokoro(job):kind==='kitten'?runKitten(job):runPiper(job);}
 return {load,run,unload,get backend(){return backend;}};
}
