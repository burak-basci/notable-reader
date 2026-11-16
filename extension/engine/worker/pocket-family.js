/* beNotable! Reader engine · flow-LM + Mimi speech family (Phonon, Pocket TTS) · own code MIT. Uses separately licensed ONNX Runtime.
 * No phonemizer (no eSpeak, so nothing GPL is needed for these voices): the text goes through the model's own SentencePiece/Unigram tokenizer
 * (tokenizer.json, normalizer rules and vocabulary come from the pinned model files, nothing is hard-coded here).
 * Pure of globals: ORT is injected, so the same code runs in the worker and in Node tests.
 * Two graphs, both stateful: `flow_lm` (causal transformer, one 32-dim latent per 80 ms frame + end-of-speech logit) and `mimi_decoder`
 * (latents -> 24 kHz PCM). Every `present*` output goes back in as `past*` input of the next call. */
export const FRAME_SAMPLES=1920,SAMPLE_RATE=24000,MAX_CHUNK_TOKENS=50;
const UTF8_ENC=new TextEncoder();
const abort=()=>new DOMException('Die lokale Berechnung wurde abgebrochen.','AbortError');

/* --- tokenizer.json (HF `tokenizers` format): Sequence of Replace/Strip/Prepend normalizers, Metaspace pre-tokenizer, Unigram model with byte fallback --- */
function compileNormalizer(spec){
 const steps=[];
 for(const step of spec?.normalizers||[spec].filter(Boolean)){
  if(step.type==='Replace'){
   const {Regex,String:literal}=step.pattern;
   if(Regex!==undefined){const re=new RegExp(Regex,'gu'),to=step.content;steps.push(text=>text.replace(re,()=>to));}
   else{const from=literal,to=step.content;steps.push(text=>text.split(from).join(to));}
  }
  else if(step.type==='Strip'){const left=step.strip_left!==false,right=step.strip_right!==false;steps.push(text=>left&&right?text.trim():left?text.trimStart():right?text.trimEnd():text);}
  else if(step.type==='Prepend'){const value=step.prepend;steps.push(text=>value+text);}
  else if(step.type==='NFC'||step.type==='NFKC'||step.type==='NFD'||step.type==='NFKD'){const form=step.type;steps.push(text=>text.normalize(form));}
  else if(step.type==='Lowercase')steps.push(text=>text.toLowerCase());
  else throw Error('Der Tokenizer des Sprachmodells verwendet einen nicht unterstützten Normalisierer: '+step.type);
 }
 return text=>steps.reduce((value,step)=>step(value),text);
}
export function createUnigramTokenizer(json){
 const model=json.model;
 if(model?.type!=='Unigram'||!Array.isArray(model.vocab))throw Error('Der Tokenizer des Sprachmodells hat ein unerwartetes Format.');
 const normalize=compileNormalizer(json.normalizer),replacement=json.pre_tokenizer?.replacement||'▁';
 const pieces=new Map(),special=new Set((json.added_tokens||[]).filter(t=>t.special).map(t=>t.content));
 let maxLength=1,minScore=0;
 model.vocab.forEach(([piece,score],id)=>{if(special.has(piece))return;pieces.set(piece,{id,score});maxLength=Math.max(maxLength,Array.from(piece).length);if(score<minScore)minScore=score;});
 const unk=model.unk_id??0,unkScore=minScore-10,byteFallback=model.byte_fallback===true;
 const byteId=byte=>pieces.get('<0x'+byte.toString(16).toUpperCase().padStart(2,'0')+'>')?.id;
 /* Metaspace: spaces become the replacement mark, the text is split in front of every mark. */
 const presplit=text=>{
  const marked=text.replace(/ /g,replacement);
  const withPrefix=marked.startsWith(replacement)?marked:replacement+marked,parts=[];
  for(const char of Array.from(withPrefix)){if(char===replacement||!parts.length)parts.push(char);else parts[parts.length-1]+=char;}
  return parts;
 };
 function viterbi(chars){
  const n=chars.length,best=new Float64Array(n+1).fill(-Infinity),from=new Int32Array(n+1).fill(-1),ids=new Array(n+1).fill(null);
  best[0]=0;
  for(let end=1;end<=n;end++){
   for(let start=Math.max(0,end-maxLength);start<end;start++){
    if(best[start]===-Infinity)continue;
    const hit=pieces.get(chars.slice(start,end).join(''));
    if(hit){const score=best[start]+hit.score;if(score>best[end]){best[end]=score;from[end]=start;ids[end]=[hit.id];}}
   }
   if(!pieces.has(chars[end-1])){/* unknown character: unk score, later expanded into its UTF-8 bytes */
    const score=best[end-1]+unkScore;if(score>best[end]){best[end]=score;from[end]=end-1;ids[end]=null;}
   }
  }
  const out=[];let at=n;
  while(at>0){const start=from[at];out.push(ids[at]??{unknown:chars.slice(start,at).join('')});at=start;}
  return out.reverse();
 }
 function encode(text){
  const out=[];
  for(const part of presplit(normalize(text))){
   if(!part)continue;
   for(const item of viterbi(Array.from(part))){
    if(Array.isArray(item)){out.push(item[0]);continue;}
    const bytes=Array.from(UTF8_ENC.encode(item.unknown),byteId);
    if(byteFallback&&bytes.every(id=>id!==undefined))out.push(...bytes);else out.push(unk);
   }
  }
  return out;
 }
 return {encode,normalize};
}

/* --- text chunks: whole sentences up to MAX_CHUNK_TOKENS tokens (model limit about 50); an over-long sentence is cut at clause marks, then at words --- */
export function chunkText(text,count,limit=MAX_CHUNK_TOKENS){
 const sentences=text.replace(/\s+/g,' ').trim().match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g)||[];
 const out=[];let current='';
 const flush=()=>{if(current.trim())out.push(current.trim());current='';};
 const pieces=[];
 for(const raw of sentences){
  const sentence=raw.trim();if(!sentence)continue;
  if(count(sentence)<=limit){pieces.push(sentence);continue;}
  let part='';
  const emit=value=>{if(value.trim())pieces.push(value.trim());};
  for(const clause of sentence.match(/[^,;:]+[,;:]?/g)||[sentence]){
   if(count(clause)>limit){
    emit(part);part='';let words='';
    for(const word of clause.trim().split(' ')){const next=words?words+' '+word:word;if(words&&count(next)>limit){emit(words+',');words=word;}else words=next;}
    part=words;continue;
   }
   const next=part?part+' '+clause.trim():clause.trim();
   if(part&&count(next)>limit){emit(/[,;:]$/.test(part)?part.replace(/[;:]$/,','):part+',');part=clause.trim();}else part=next;
  }
  emit(part);
 }
 for(const piece of pieces){
  const next=current?current+' '+piece:piece;
  if(current&&count(next)>limit)flush();
  current=current?current+' '+piece:piece;
 }
 flush();
 return out;
}

/* Small deterministic generator (mulberry32) so one text always gives the same audio: cached sections and a repeated read stay identical. */
export function seededRandom(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
export const hashString=text=>{let h=2166136261>>>0;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h;};
export const gaussian=random=>Math.sqrt(-2*Math.log(1-random()))*Math.cos(2*Math.PI*random());
export function joinParts(parts){const total=parts.reduce((n,p)=>n+p.length,0),out=new Float32Array(total);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;}

/* --- shared graph helpers --- */
export const tensors=ort=>({
 f32:(dims,data)=>new ort.Tensor('float32',data??new Float32Array(dims.reduce((a,b)=>a*b,1)),dims),
 i64:(values,dims)=>new ort.Tensor('int64',BigInt64Array.from(values,BigInt),dims)
});
export const emptyCache=(t,{num_layers,num_heads,head_dim})=>Object.fromEntries(Array.from({length:num_layers},(_,i)=>['key','value'].map(k=>[`past_key_values.${i}.${k}`,t.f32([1,num_heads,0,head_dim])])).flat());
export const nextState=outputs=>Object.fromEntries(Object.entries(outputs).filter(([name])=>name.startsWith('present')).map(([name,value])=>[name.replace('present.','past_key_values.').replace('present_','past_'),value]));

/* Trailing and leading near-silence of one chunk is cut so that chunks of a section join with a short, natural gap. */
function trimChunk(samples,head=Math.round(SAMPLE_RATE*0.02),tail=Math.round(SAMPLE_RATE*0.12)){
 let peak=0;for(let i=0;i<samples.length;i++){const v=Math.abs(samples[i]);if(v>peak)peak=v;}
 const limit=Math.max(0.002,peak*0.02);let a=0,b=samples.length;
 while(a<b&&Math.abs(samples[a])<limit)a++;
 while(b>a&&Math.abs(samples[b-1])<limit)b--;
 if(a>=b)return samples;
 return samples.slice(Math.max(0,a-head),Math.min(samples.length,b+tail));
}

/* --- Phonon (Gradium, 31M, English): flow_lm + mimi_decoder, one voice file = [1,512,frames] float32 --- */
export function createPhonon({ort,isCancelled=()=>false}){
 const t=tensors(ort);
 let flow=null,mimi=null,cfg=null,tokenizer=null,voiceState=null,backend='wasm';
 const check=generation=>{if(isCancelled(generation))throw abort();};
 const tokenCount=text=>tokenizer.encode(prepare(text)).length;
 /* Same text preparation as the model's runtime: one line, first letter upper case, final full stop after a letter or digit. */
 const prepare=raw=>{let text=raw.trim().replace(/\s+/g,' ');if(!text)return text;text=text[0].toUpperCase()+text.slice(1);return text+(/[\p{L}\p{N}]$/u.test(text)?'.':'');};
 const runFlow=(past,{text=[],voiceLatents=t.f32([1,cfg.voice_dim,0]),latent=t.f32([1,0,cfg.latent_dim]),noise=t.f32([1,cfg.latent_dim])})=>flow.run({text_ids:t.i64(text,[1,text.length]),voice_latents:voiceLatents,latent,noise,num_speakers:t.i64([1],[1]),duration_delta:t.f32([1]),...past});
 async function load(init,options){
  cfg=init.config?.phonon;
  if(!cfg||!init.tokenizer||!init.flow||!init.decoder||!init.voiceData)throw Error('Die Dateien des Sprachmodells sind unvollständig.');
  tokenizer=createUnigramTokenizer(init.tokenizer);
  const flowOptions=init.flowData?{...options('wasm'),externalData:[{path:init.flowDataName||'flow_lm_q4.onnx_data',data:new Uint8Array(init.flowData)}]}:options('wasm');
  backend='wasm';
  if(init.prefer==='webgpu'){
   try{flow=await ort.InferenceSession.create(new Uint8Array(init.flow),{...flowOptions,executionProviders:['webgpu']});mimi=await ort.InferenceSession.create(new Uint8Array(init.decoder),options('webgpu'));backend='webgpu';}
   catch{if(flow)await flow.release();flow=mimi=null;}
  }
  if(!flow){flow=await ort.InferenceSession.create(new Uint8Array(init.flow),flowOptions);mimi=await ort.InferenceSession.create(new Uint8Array(init.decoder),options('wasm'));}
  const data=new Float32Array(init.voiceData);
  if(data.length%cfg.voice_dim)throw Error('Die Stimmendatei hat ein unerwartetes Format.');
  voiceState=nextState(await runFlow(emptyCache(t,cfg.flow_lm),{voiceLatents:t.f32([1,cfg.voice_dim,data.length/cfg.voice_dim],data)}));
  return {backend,inputs:flow.inputNames,outputs:flow.outputNames};
 }
 async function chunk(raw,generation,random){
  const text=prepare(raw);
  if(!text)return new Float32Array(0);
  const ids=tokenizer.encode(text);
  let state=nextState(await runFlow(voiceState,{text:ids}));
  let latent=t.f32([1,1,cfg.latent_dim],new Float32Array(cfg.latent_dim).fill(NaN));/* NaN = start of speech */
  const scale=Math.sqrt(cfg.temperature),frames=[],limit=Math.ceil((ids.length/3+2)*cfg.frame_rate);
  let countdown=null;
  for(let frame=0;frame<limit;frame++){
   check(generation);
   const noise=t.f32([1,cfg.latent_dim],Float32Array.from({length:cfg.latent_dim},()=>gaussian(random)*scale));
   const step=await runFlow(state,{latent,noise});
   state=nextState(step);latent=step.latent_out;frames.push(Float32Array.from(latent.data));
   if(countdown===null&&step.eos_logit.data[0]>cfg.eos_threshold)countdown=text.split(' ').length<=4?3:1;
   if(countdown!==null&&countdown--===0)break;
  }
  check(generation);
  const all=joinParts(frames),codec={past_offset:t.i64([0],[1]),...emptyCache(t,cfg.mimi_decoder)};
  for(const [name,dims] of Object.entries(cfg.mimi_decoder.conv_states))codec[name]=t.f32(dims);
  const decoded=await mimi.run({latent:t.f32([1,frames.length,cfg.latent_dim],all),...codec});
  return Float32Array.from(decoded.audio.data);
 }
 /* {text,generation} -> {samples,sampleRate,chunks}. One chunk = whole sentences up to about 50 tokens. */
 async function run({text,generation}){
  const random=seededRandom(hashString(text)),parts=[],sentences=chunkText(text,tokenCount);
  for(const piece of sentences){check(generation);parts.push(trimChunk(await chunk(piece,generation,random)));}
  return {samples:joinParts(parts),sampleRate:SAMPLE_RATE,chunks:sentences.length};
 }
 async function unload(){const a=flow,b=mimi;flow=mimi=null;voiceState=null;if(a)await a.release();if(b)await b.release();}
 return {load,run,unload,get backend(){return backend;},tokenizer:()=>tokenizer};
}
