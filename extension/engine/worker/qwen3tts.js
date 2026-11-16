/* beNotable! Reader engine · Qwen3-TTS 12Hz CustomVoice (talker + code predictor + codec decoder) · own code MIT.
 * Uses separately licensed ONNX Runtime Web (MIT) with the WebGPU backend and the Apache-2.0 Qwen3-TTS weights (never shipped, downloaded on request).
 * Written from the published model description (model card of the ONNX export: prompt layout, sampling, stop rule); no code of the export tooling is used.
 * Pure of globals: ORT is injected, so the same code runs in the worker and in Node tests with fake sessions.
 *
 * Per 80 ms frame: the talker (28 layers) gives code 0 from its logits, the code predictor (5 layers, fresh cache per frame) gives codes 1..15 in 15 sequential steps,
 * the next talker input is the sum of the 16 code embeddings plus the text pad embedding. All frames then pass the codec decoder (300-frame blocks, 25 frames of context).
 * Measured on WebGPU (RTX 3060, Chromium 155): the 15 predictor steps dominate (145-190 ms of 160-210 ms per frame), so synthesis is slower than real time
 * (RTF about 2-3). Speed-ups kept here: predictor on WebGPU with its KV cache kept on the GPU, embedding lookups precomputed into tables once at load.
 * Synthesis is always one voice at speed 1.0; tempo is applied at playback. */
import {chunkText,seededRandom,hashString,joinParts} from './pocket-family.js';
export const SAMPLE_RATE=24000,FRAME_SAMPLES=1920,MAX_CHUNK_TOKENS=64,SPEAKERS=['ryan','aiden','serena','vivian','uncle_fu','ono_anna','sohee'];
const abort=()=>new DOMException('Die lokale Berechnung wurde abgebrochen.','AbortError');
const REPETITION=1.05,TEMPERATURE=0.9,TOP_K=50,DECODER_BLOCK=50,DECODER_CONTEXT=25,MAX_FRAMES=900;

/* --- byte-level BPE (Qwen2 tokenizer.json): NFC, regex split, GPT-2 byte-to-unicode map, merge ranks --- */
const BYTE_CHARS=(()=>{
 const keep=[];for(let i=33;i<=126;i++)keep.push(i);for(let i=161;i<=172;i++)keep.push(i);for(let i=174;i<=255;i++)keep.push(i);
 const chars=keep.slice(),has=new Set(keep);let extra=0;
 for(let b=0;b<256;b++)if(!has.has(b)){keep.push(b);chars.push(256+extra++);}
 const map=new Array(256);keep.forEach((b,i)=>{map[b]=String.fromCharCode(chars[i]);});return map;
})();
export function createByteLevelBpe(json){
 const model=json.model;
 if(model?.type!=='BPE'||!model.vocab||!Array.isArray(model.merges))throw Error('Der Tokenizer des Sprachmodells hat ein unerwartetes Format.');
 const split=(json.pre_tokenizer?.pretokenizers||[json.pre_tokenizer]).find(step=>step?.type==='Split'&&step.pattern?.Regex!==undefined);
 if(!split)throw Error('Der Tokenizer des Sprachmodells hat ein unerwartetes Format.');
 /* inline case-insensitive groups are written out, so older engines (no RegExp modifiers) read the pattern too */
 const source=split.pattern.Regex.replace("(?i:'s|'t|'re|'ve|'m|'ll|'d)","(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])");
 const pattern=new RegExp(source,'gu'),vocab=new Map(Object.entries(model.vocab)),ranks=new Map();
 model.merges.forEach((merge,index)=>ranks.set(Array.isArray(merge)?merge[0]+' '+merge[1]:merge,index));
 const cache=new Map(),encoder=new TextEncoder();
 const bpe=word=>{
  const hit=cache.get(word);if(hit)return hit;
  let parts=Array.from(word);
  while(parts.length>1){
   let best=-1,rank=Infinity;
   for(let i=0;i<parts.length-1;i++){const r=ranks.get(parts[i]+' '+parts[i+1]);if(r!==undefined&&r<rank){rank=r;best=i;}}
   if(best<0)break;
   parts=[...parts.slice(0,best),parts[best]+parts[best+1],...parts.slice(best+2)];
  }
  const ids=parts.map(part=>vocab.get(part));
  if(ids.some(id=>id===undefined))throw Error('Der Tokenizer des Sprachmodells kennt ein Zeichen nicht.');
  if(cache.size>4096)cache.clear();cache.set(word,ids);return ids;
 };
 function encode(text){
  const out=[],normalized=json.normalizer?.type==='NFC'?text.normalize('NFC'):text;
  let last=0;
  const piece=value=>{if(!value)return;const mapped=Array.from(encoder.encode(value),byte=>BYTE_CHARS[byte]).join('');out.push(...bpe(mapped));};
  for(const match of normalized.matchAll(pattern)){if(match.index>last)piece(normalized.slice(last,match.index));piece(match[0]);last=match.index+match[0].length;}
  piece(normalized.slice(last));
  return out;
 }
 return {encode};
}

/* --- sampling: temperature + top-k over a logits row, mask -Infinity entries; `random` is a [0,1) generator --- */
export function sampleTopK(logits,random,temperature=TEMPERATURE,k=TOP_K){
 const top=[];
 for(let i=0;i<logits.length;i++){
  const value=logits[i];if(value===-Infinity||Number.isNaN(value))continue;
  if(top.length===k&&value<=logits[top[k-1]])continue;
  let at=top.length===k?k-1:top.length;while(at>0&&logits[top[at-1]]<value)at--;
  top.splice(at,0,i);if(top.length>k)top.pop();
 }
 if(!top.length)throw Error('Die lokale Sprachausgabe lieferte keine gültige Wahrscheinlichkeit.');
 const peak=logits[top[0]]/temperature,weights=top.map(i=>Math.exp(logits[i]/temperature-peak));
 let draw=random()*weights.reduce((a,b)=>a+b,0);
 for(let i=0;i<top.length;i++){draw-=weights[i];if(draw<0)return top[i];}
 return top[top.length-1];
}
const sum=(...rows)=>{const out=new Float32Array(rows[0].length);for(const row of rows)for(let i=0;i<out.length;i++)out[i]+=row[i];return out;};

const clock=()=>globalThis.performance.now();
/* Phase times of one run() call, in ms (measured with performance.now, always on: a handful of additions per frame). Read by the diagnosis panel and the status line. */
const newStats=()=>({tokenizeMs:0,textEmbedMs:0,prefillMs:0,talkerMs:0,talkerReadMs:0,predictorMs:0,predictorReadMs:0,samplingMs:0,decodeMs:0,frames:0,predictorRuns:0,chunks:0,audioSec:0,totalMs:0});
export function createQwen3Tts({ort,isCancelled=()=>false}){
 let stats=newStats(),predictorRead=false,debug=false,decoderBlock=DECODER_BLOCK;const mark=(...parts)=>{if(debug)console.info('[qwen]',Date.now(),...parts);};/* phase marks for the local measurement (params.debug), never on by default */
 let sessions=null,config=null,tokenizer=null,tables=null,speaker='ryan',language='english',backend='webgpu';
 const check=generation=>{if(isCancelled(generation))throw abort();};
 const ids64=values=>new ort.Tensor('int64',BigInt64Array.from(values,BigInt),[1,values.length]);
 /* load(init): init = {config, tokenizer, textEmbed, codecEmbed, talker, talkerData, predictor, predictorData, decoder, params:{speaker,language}} (bytes or JSON).
  * The WebGPU backend is required: the embedding graphs use GatherBlockQuantized, which the WASM CPU backend does not implement (measured). No silent fallback. */
 async function load(init){
  config=init.config;tokenizer=createByteLevelBpe(init.tokenizer);
  debug=init.params?.debug===true;predictorRead=init.params?.predictorHidden==='read';decoderBlock=init.params?.decoderBlock||DECODER_BLOCK;speaker=init.params?.speaker||'ryan';language=init.params?.language||'english';
  const talkerConfig=config?.talker_config;
  if(!talkerConfig?.spk_id?.[speaker]||talkerConfig.codec_language_id?.[language]===undefined)throw Error('Sprecher oder Sprache sind in diesem Sprachmodell nicht vorhanden.');
  for(const key of ['textEmbed','codecEmbed','talker','talkerData','predictor','predictorData','decoder'])if(!init[key])throw Error('Die Dateien des Sprachmodells sind unvollständig.');
  /* VRAM (RTX 3060 12 GB, measured): ORT's default 'bucket' and 'simple' caches keep every freed buffer; the talker KV cache grows by one row per frame, so ~30 MB/frame piled up and a 300-frame decoder block took 2.6 GB more: out of memory after two sentences.
   'lazyRelease' frees buffers at the end of each run: generation then stays flat (3.4 GB board total after load), the decoder is the peak and scales with the block length (125 frames: +4.8 GB, hence 50-frame blocks). 'disabled' destroys buffers still queued for the GPU (measured error). */
  const cacheMode=init.params?.bufferCache||'lazyRelease',gpu={executionProviders:[{name:'webgpu',storageBufferCacheMode:cacheMode}],graphOptimizationLevel:'all'},kv=(layers,prefix='present')=>Object.fromEntries(Array.from({length:layers},(_,i)=>[[`${prefix}.${i}.key`,'gpu-buffer'],[`${prefix}.${i}.value`,'gpu-buffer']]).flat());
  const make=(bytes,options,data)=>ort.InferenceSession.create(new Uint8Array(bytes),{...gpu,...options,...(data?{externalData:[{path:'model.onnx.data',data:new Uint8Array(data)}]}:{})});
  sessions={};
  try{
   sessions.textEmbed=await make(init.textEmbed);
   sessions.codecEmbed=await make(init.codecEmbed);
   sessions.talker=await make(init.talker,init.params?.talkerKv==='cpu'?{}:{preferredOutputLocation:kv(talkerConfig.num_hidden_layers)},init.talkerData);
   sessions.predictor=await make(init.predictor,{preferredOutputLocation:{...kv(talkerConfig.code_predictor_config.num_hidden_layers),...(init.params?.predictorHidden==='read'?{}:{hidden_states:'gpu-buffer'})}},init.predictorData);
   sessions.decoder=await make(init.decoder);
   if(init.project)sessions.project=await make(init.project);/* 1.7B only: talker width 2048 -> code predictor width 1024 */
  }catch(error){await unload();throw Object.assign(Error('Dieses Sprachmodell braucht WebGPU und konnte hier nicht gestartet werden: '+(error?.message||error)),{code:'webgpu-failed'});}
  await buildTables();
  return {backend,gpu:await adapterFacts(),inputs:sessions.talker.inputNames,outputs:sessions.talker.outputNames};
 }
 /* The adapter ORT really uses: its device reports it (adapterInfo); else the same request ORT makes. Plain facts for the diagnosis; the browser leaves `description` empty. */
 async function adapterFacts(){
  let info=null;
  try{info=ort.env?.webgpu?.device?.adapterInfo||ort.env?.webgpu?.adapter?.info||null;}catch{}
  if(!info)try{info=(await globalThis.navigator?.gpu?.requestAdapter?.({powerPreference:ort.env?.webgpu?.powerPreference}))?.info||null;}catch{}
  return info?{vendor:String(info.vendor||''),architecture:String(info.architecture||''),device:String(info.device||''),description:String(info.description||''),fallback:info.isFallbackAdapter===true}:null;
 }
 /* Embedding lookups through a WebGPU graph cost 5-10 ms each (measured); the tables are computed once: rows 0..3071 = talker codec embedding, then 15 x 2048 predictor rows. */
 async function buildTables(){
  const talkerConfig=config.talker_config,rows=talkerConfig.vocab_size+(talkerConfig.num_code_groups-1)*talkerConfig.code_predictor_config.vocab_size,width=talkerConfig.hidden_size;
  const codec=new Float32Array(rows*width),pw=talkerConfig.code_predictor_config.hidden_size;let predictor=null;
  for(let start=0;start<rows;start+=2048){
   const list=Array.from({length:Math.min(2048,rows-start)},(_,i)=>start+i),out=await sessions.codecEmbed.run({ids:ids64(list)});
   codec.set(out.embeds.data,start*width);
   if(out.cp_embeds){predictor??=new Float32Array(rows*pw);predictor.set(out.cp_embeds.data,start*pw);}
   for(const tensor of Object.values(out))tensor.dispose?.();
  }
  if(!predictor&&pw!==width)throw Error('Das Sprachmodell liefert keine Embeddings für den Code-Predictor.');
  tables={codec,predictor:predictor||codec,width,predictorWidth:pw};
 }
 const row=(table,id)=>{const width=table===tables.predictor&&table!==tables.codec?tables.predictorWidth:tables.width;return table.subarray(id*width,(id+1)*width);};
 async function textRows(list){
  const out=await sessions.textEmbed.run({ids:ids64(list)}),data=out.embeds.data,width=data.length/list.length,rows=list.map((_,i)=>data.slice(i*width,(i+1)*width));
  for(const tensor of Object.values(out))tensor.dispose?.();return rows;
 }
 /* One decoder stack with a growing KV cache that stays on the GPU between calls. */
 function stack(session,layers,width,source,phase,wantHidden=true){
  const names=[];for(let i=0;i<layers;i++){names.push(`past_key_values.${i}.key`,`past_key_values.${i}.value`);}
  const heads=source.num_key_value_heads,headDim=source.head_dim;
  let cache=Object.fromEntries(names.map(name=>[name,new ort.Tensor('float32',new Float32Array(0),[1,heads,0,headDim])])),length=0;
  const free=()=>{for(const tensor of Object.values(cache))tensor.dispose?.();cache={};};
  return {
   async run(rows){
    const t0=clock(),embeds=new Float32Array(rows.length*width);rows.forEach((value,i)=>embeds.set(value,i*width));
    const out=await session.run({inputs_embeds:new ort.Tensor('float32',embeds,[1,rows.length,width]),attention_mask:new ort.Tensor('int64',new BigInt64Array(length+rows.length).fill(1n),[1,length+rows.length]),...cache});
    free();
    cache=Object.fromEntries(names.map(name=>[name,out[name.replace('past_key_values','present')]]));length+=rows.length;
    const t1=clock(),logitCount=out.logits.size/rows.length,logits=await out.logits.getData();
    /* the code predictor never uses its hidden state: it stays on the GPU (see preferredOutputLocation) and is dropped without a read-back */
    const result={logits:logits.slice(logits.length-logitCount)};
    if(wantHidden){const hiddenCount=out.hidden_states.size/rows.length,hidden=await out.hidden_states.getData();result.hidden=hidden.slice(hidden.length-hiddenCount);}
    out.logits.dispose();out.hidden_states.dispose();
    stats[phase+'Ms']+=t1-t0;stats[phase+'ReadMs']+=clock()-t1;return result;
   },
   dispose:free
  };
 }
 /* The talker's hidden state as the code predictor's first input (1.7B: through the small projection graph, 0.6B: widths match). */
 async function project(hidden){
  if(!sessions.project)return hidden;
  const session=sessions.project,out=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',Float32Array.from(hidden),[1,1,hidden.length])}),data=await out[session.outputNames[0]].getData(),projected=Float32Array.from(data);
  for(const tensor of Object.values(out))tensor.dispose?.();return projected;
 }
 /* One chunk of text -> PCM. */
 async function chunk(raw,generation,random){
  const talkerConfig=config.talker_config,predictorConfig=talkerConfig.code_predictor_config,width=talkerConfig.hidden_size;
  const tTok=clock(),bodyIds=tokenizer.encode(raw),roleIds=[config.im_start_token_id,...tokenizer.encode('assistant\n')];stats.tokenizeMs+=clock()-tTok;
  const tEmb=clock();
  const [bos,eos,pad]=await textRows([config.tts_bos_token_id,config.tts_eos_token_id,config.tts_pad_token_id]);
  const codecIds=[talkerConfig.codec_think_id,talkerConfig.codec_think_bos_id,talkerConfig.codec_language_id[language],talkerConfig.codec_think_eos_id,talkerConfig.spk_id[speaker],talkerConfig.codec_pad_id,talkerConfig.codec_bos_id];
  const prompt=[...await textRows(roleIds)];
  codecIds.slice(0,-1).forEach((id,i)=>prompt.push(sum(i<codecIds.length-2?pad:bos,row(tables.codec,id))));
  const body=await textRows(bodyIds);
  [...body,eos].forEach(value=>prompt.push(sum(value,row(tables.codec,talkerConfig.codec_pad_id))));
  prompt.push(sum(pad,row(tables.codec,talkerConfig.codec_bos_id)));stats.textEmbedMs+=clock()-tEmb;
  const talker=stack(sessions.talker,talkerConfig.num_hidden_layers,width,talkerConfig,'talker'),frames=[],seen=new Set(),stop=talkerConfig.codec_eos_token_id,vocab=talkerConfig.vocab_size,predictorVocab=predictorConfig.vocab_size;
  const limit=Math.min(MAX_FRAMES,25+9*bodyIds.length);
  try{
   mark('prefill',prompt.length);const tPre=clock();let {logits,hidden}=await talker.run(prompt);stats.prefillMs+=clock()-tPre;mark('prefill done');
   for(let step=0;step<limit;step++){
    check(generation);
    const tSample=clock();
    for(const id of seen)logits[id]=logits[id]<0?logits[id]*REPETITION:logits[id]/REPETITION;
    for(let id=vocab-1024;id<vocab;id++)if(id!==stop)logits[id]=-Infinity;
    if(step<2)logits[stop]=-Infinity;
    const first=sampleTopK(logits,random);stats.samplingMs+=clock()-tSample;
    if(first===stop)break;
    const frame=[first],cp=stack(sessions.predictor,predictorConfig.num_hidden_layers,tables.predictorWidth,predictorConfig,'predictor',predictorRead);
    try{
     let input=[await project(hidden),row(tables.predictor,first)];
     for(let group=0;group<talkerConfig.num_code_groups-1;group++){
      const {logits:heads}=await cp.run(input);stats.predictorRuns++;
      const tS=clock(),code=sampleTopK(heads.subarray(group*predictorVocab,(group+1)*predictorVocab),random);stats.samplingMs+=clock()-tS;
      frame.push(code);
      if(group<talkerConfig.num_code_groups-2)input=[row(tables.predictor,vocab+group*predictorVocab+code)];
     }
    }finally{cp.dispose();}
    frames.push(frame);seen.add(first);if(frames.length%25===0)mark('frames',frames.length);
    const embeds=frame.map((code,group)=>row(tables.codec,group===0?code:vocab+(group-1)*predictorVocab+code));
    ({logits,hidden}=await talker.run([sum(...embeds,pad)]));
   }
  }finally{talker.dispose();}
  check(generation);stats.frames+=frames.length;
  const tDec=clock(),pcm=await decode(frames,generation);stats.decodeMs+=clock()-tDec;return pcm;
 }
 /* Frames -> PCM in blocks (the decoder is convolutional: 25 frames of left context hide the block borders). */
 async function decode(frames,generation){
  const parts=[],groups=config.talker_config.num_code_groups;
  for(let start=0;start<frames.length;start+=decoderBlock){
   check(generation);
   mark('decode block',start,frames.length);const from=Math.max(0,start-DECODER_CONTEXT),block=frames.slice(from,start+decoderBlock),codes=new BigInt64Array(groups*block.length);
   block.forEach((frame,t)=>frame.forEach((code,g)=>{codes[g*block.length+t]=BigInt(code);}));
   const out=(await sessions.decoder.run({codes:new ort.Tensor('int64',codes,[1,groups,block.length])})).audio;
   parts.push((await out.getData()).slice((start-from)*FRAME_SAMPLES));out.dispose();
  }
  return joinParts(parts);
 }
 /* Same text preparation idea as the other families: one line, closing full stop after a letter or digit. */
 const prepare=raw=>{const text=raw.trim().replace(/\s+/g,' ');return text&&/[\p{L}\p{N}]$/u.test(text)?text+'.':text;};
 /* {text,generation} -> {samples,sampleRate,chunks}. Whole sentences up to MAX_CHUNK_TOKENS tokens; a cancelled generation stops between two frames. */
 async function run({text,generation}){
  stats=newStats();const t0=clock(),random=seededRandom(hashString(text)),pieces=chunkText(prepare(text),value=>tokenizer.encode(value).length,MAX_CHUNK_TOKENS),parts=[];
  /* measured: two concurrent session.run() calls on one ORT-web instance (JSPI) never return, so the chunks run one after the other; parallel sections use a second worker (TtsEngine pool) */
  for(const piece of pieces){check(generation);parts.push(await chunk(piece,generation,random));}
  const samples=joinParts(parts);stats.chunks=pieces.length;stats.totalMs=clock()-t0;stats.audioSec=samples.length/SAMPLE_RATE;
  return {samples,sampleRate:SAMPLE_RATE,chunks:pieces.length,stats:{...stats}};
 }
 async function unload(){
  const gone=sessions;sessions=null;tables=null;
  if(gone)for(const session of Object.values(gone))await session.release?.();
 }
 return {load,run,unload,get backend(){return backend;},tokenizer:()=>tokenizer};
}
