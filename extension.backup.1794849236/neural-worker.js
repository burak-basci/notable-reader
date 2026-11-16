/* Notable Reader neural runtime · Copyright (c) 2026 Burak Basci · MIT.
 * Uses separately licensed ONNX Runtime and GPL eSpeak/Piper phonemizer. */
import * as ort from './vendor/neural/ort/ort.wasm.min.mjs';
import createPiperPhonemize from './vendor/neural/piper/piper_phonemize.mjs';
ort.env.wasm.wasmPaths=new URL('./vendor/neural/ort/',import.meta.url).href;
ort.env.wasm.numThreads=1;
ort.env.wasm.proxy=false;
let session=null,modelKind='',modelConfig=null,styleData=null,vocab=null,phonemizer=null,phonemeResult=null;
async function phonemes(text,language){
 if(!phonemizer)phonemizer=await createPiperPhonemize({
  noInitialRun:true,
  print:line=>{try{phonemeResult=JSON.parse(line);}catch{}},
  printErr:()=>{},
  locateFile:name=>new URL('./vendor/neural/piper/'+name,import.meta.url).href
 });
 phonemeResult=null;
 phonemizer.callMain(['-l',language,'--input',JSON.stringify([{text:text.trim()}]),'--espeak_data','/espeak-ng-data']);
 if(!phonemeResult)throw Error('Die lokale Textaufbereitung hat kein Ergebnis geliefert.');
 return phonemeResult;
}
async function initialize(message){
 if(session){await session.release();session=null;}
 modelKind=message.kind;modelConfig=message.config||null;styleData=message.style?new Float32Array(message.style):null;vocab=message.tokenizer?.model?.vocab||null;
 session=await ort.InferenceSession.create(new Uint8Array(message.model),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
 return {inputs:session.inputNames,outputs:session.outputNames};
}
async function synthesize(message){
 if(!session)throw Error('Bitte zuerst das lokale Sprachmodell laden.');
 const rate=Math.max(.8,Math.min(4,Number(message.rate)||1)),started=performance.now();
 let feeds,sampleRate;
 if(modelKind==='kokoro'){
  const raw=await phonemes(message.text,'en-us');
  const value=(raw.phonemes||[]).join('').replace(/ʲ/g,'j').replace(/r/g,'ɹ').replace(/x/g,'k').replace(/ɬ/g,'l');
  if(!value)throw Error('Die lokale englische Phonemaufbereitung ist nicht verfügbar.');
  const ids=[0,...Array.from(value).filter(c=>Object.hasOwn(vocab,c)).map(c=>vocab[c]),0];
  if(ids.length>512)throw Error('Dieser Abschnitt enthält zu viele Sprachzeichen. Bitte einen kürzeren Abschnitt wählen.');
  const offset=256*Math.min(ids.length-2,509),style=styleData.slice(offset,offset+256);
  feeds={input_ids:new ort.Tensor('int64',BigInt64Array.from(ids.map(BigInt)),[1,ids.length]),style:new ort.Tensor('float32',style,[1,256]),speed:new ort.Tensor('float32',Float32Array.of(rate),[1])};
  sampleRate=24000;
 }else{
  const raw=await phonemes(message.text,modelConfig.espeak.voice),ids=raw.phoneme_ids;
  if(!Array.isArray(ids)||!ids.length)throw Error('Die lokale deutsche Phonemaufbereitung ist nicht verfügbar.');
  feeds={input:new ort.Tensor('int64',BigInt64Array.from(ids.map(BigInt)),[1,ids.length]),input_lengths:new ort.Tensor('int64',BigInt64Array.of(BigInt(ids.length)),[1]),scales:new ort.Tensor('float32',Float32Array.of(modelConfig.inference.noise_scale,modelConfig.inference.length_scale/rate,modelConfig.inference.noise_w),[3])};
  if(session.inputNames.includes('sid'))feeds.sid=new ort.Tensor('int64',BigInt64Array.of(0n),[1]);
  sampleRate=modelConfig.audio.sample_rate;
 }
 const output=await session.run(feeds),tensor=output[modelKind==='kokoro'?'waveform':'output']||output[session.outputNames[0]],samples=new Float32Array(tensor.data);
 let peak=0;for(const value of samples)peak=Math.max(peak,Math.abs(value));
 return {samples,sampleRate,sampleCount:samples.length,duration:samples.length/sampleRate,peak,milliseconds:performance.now()-started};
}
let queue=Promise.resolve();
self.addEventListener('message',event=>{const message=event.data;queue=queue.then(async()=>{
 try{const result=message.action==='init'?await initialize(message):message.action==='synthesize'?await synthesize(message):message.action==='dispose'?(await session?.release(),session=null,{disposed:true}):null;if(!result)throw Error('Unbekannter lokaler Sprachbefehl.');
  self.postMessage({id:message.id,ok:true,...result},result.samples?[result.samples.buffer]:[]);
 }catch(error){self.postMessage({id:message.id,ok:false,error:error.message||'Die lokale Sprachausgabe ist fehlgeschlagen.'});}
});});
