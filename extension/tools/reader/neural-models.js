/* Central model register · public data only, no text or telemetry endpoint.
 * One record per model; the picker, the downloader and the worker are driven from this data.
 * Every file is pinned to a fixed Hugging Face revision with exact size and SHA-256 (taken from the LFS oid). */
import {NEW_MODELS,FAMILIES,RELEASED_FAMILY,PIPER_RELEASED} from './neural-voices.js';
import {retrainedPiper,SUPERSEDED_PIPER_URLS} from './neural-voices.js';
export {FAMILIES};
import {POCKET_MODELS,POCKET_FAMILIES} from './neural-voices-pocket.js';
import {ADDITIONAL_MODELS,SUPERSEDED_ADDITIONAL_URLS} from '../../models/voice-catalog.mjs';
const hf=(repo,revision)=>`https://huggingface.co/${repo}/resolve/${revision}/`;
const kokoro=hf('onnx-community/Kokoro-82M-v1.0-ONNX','1939ad2a8e416c0acfeecc08a694d14ef25f2231');
const piper=hf('rhasspy/piper-voices','e7229f7d33a10e145e109b886d661984201ac3c4')+'de/de_DE/';
const kitten=hf('KittenML/kitten-tts-nano-0.8-int8','84781d74e29ee25217551556398b42f80593a813');
const kittenMicro=hf('KittenML/kitten-tts-micro-0.8','1ccf72b2c2048fd17efac7de2fab32d10e225084'),kittenMini=hf('KittenML/kitten-tts-mini-0.8','c02725660cea441db4c383af69f1f26f5cd00947');
export const MODEL_CACHE='notable-reader-neural-models-v1';
export const RUNTIME_ASSETS=['neural-models.js','neural-voices.js','neural-voices-pocket.js','../../models/voice-catalog.mjs','vendor/neural/ort-webgpu/ort.jspi.min.mjs','vendor/neural/ort-webgpu/ort-wasm-simd-threaded.jspi.mjs','vendor/neural/ort-webgpu/ort-wasm-simd-threaded.jspi.wasm','vendor/neural/ort/ort.wasm.min.mjs','vendor/neural/ort/ort-wasm-simd-threaded.mjs','vendor/neural/ort/ort-wasm-simd-threaded.wasm','vendor/neural/piper/piper_phonemize.mjs','vendor/neural/piper/piper_phonemize.wasm','vendor/neural/piper/piper_phonemize.data'];
/* ramMB = measured growth of the whole headless Chromium process tree after loading the model and synthesising one paragraph
 * (tests/models-real.cjs, 07.11.2026), rounded up; an orientation, not a guarantee. */
/* Quality tiers shown in the picker. */
export const TIERS=['fast','balanced','best'];
/* Symbol table of the StyleTTS2-based Kitten models (pad, punctuation, Latin letters, IPA); the index is the token id. */
export const KITTEN_SYMBOLS="$;:,.!?¡¿—…\"«»\"\" ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";
const piperVoice=(id,name,voiceURI,folder,file,model,config,extra)=>({id,name,voiceURI,lang:'de-DE',languages:['de'],localService:true,default:false,kind:'piper',source:'https://huggingface.co/rhasspy/piper-voices/blob/main/de/de_DE/'+folder+'/MODEL_CARD',
 files:[{role:'model',url:piper+folder+'/'+file+'.onnx',bytes:model[0],sha256:model[1]},{role:'config',url:piper+folder+'/'+file+'.onnx.json',bytes:config[0],sha256:config[1]}],...extra});
export const MODELS={
 piper:piperVoice('piper','Thorsten · Deutsch','notable:piper:thorsten-high','thorsten/high','de_DE-thorsten-high',[113895201,'9df1c43c61149ef9b39e618e2b861fbe41e1fcea9390b2dac62e8761573ea4f1'],[4875,'6de734444e4c3f9e33b7ebe2746dbc19b71e85f613e79c65acf623200b99a76a'],{tier:'best',ramMB:400,sampleRate:22050,voices:1,license:'Piper-Modell MIT · Sprachdatensatz CC0',voiceId:'piper:de_de-thorsten',family:'piper',display:'Thorsten',sample:'samples/register-piper-thorsten-high.opus'}),
 kokoro:{id:'kokoro',name:'Bella · Englisch (Kokoro FP32)',voiceURI:'notable:kokoro:af_bella',voiceId:'kokoro:af_bella',family:'kokoro',display:'Bella',gender:'f',sample:'samples/register-kokoro-fp32-bella.opus',lang:'en-US',languages:['en'],localService:true,default:false,license:'Kokoro-Modell Apache-2.0',source:'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX',kind:'kokoro',tier:'best',ramMB:1100,sampleRate:24000,voices:1,
  files:[{role:'model',url:kokoro+'onnx/model.onnx',bytes:325532232,sha256:'8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb'},{role:'style',url:kokoro+'voices/af_bella.bin',bytes:522240,sha256:'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b'},{role:'tokenizer',url:kokoro+'tokenizer.json',bytes:3497,sha256:'77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34'}]},
 'kokoro-q8':{id:'kokoro-q8',name:'Bella · Englisch (Kokoro kompakt)',voiceURI:'notable:kokoro-q8:af_bella',voiceId:'kokoro:af_bella',family:'kokoro',display:'Bella',gender:'f',sample:'samples/register-kokoro-q8-bella.opus',lang:'en-US',languages:['en'],localService:true,default:false,license:'Kokoro-Modell Apache-2.0',source:'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX',kind:'kokoro',tier:'balanced',ramMB:500,sampleRate:24000,voices:1,
  files:[{role:'model',url:kokoro+'onnx/model_quantized.onnx',bytes:92361116,sha256:'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478'},{role:'style',url:kokoro+'voices/af_bella.bin',bytes:522240,sha256:'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b'},{role:'tokenizer',url:kokoro+'tokenizer.json',bytes:3497,sha256:'77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34'}]},
 'kitten-nano':{id:'kitten-nano',name:'Bella · Englisch (Kitten nano)',voiceURI:'notable:kitten-nano:bella',voiceId:'kitten:bella',family:'kitten',display:'Bella',variant:'nano',gender:'f',sample:'samples/register-kitten-nano-bella.opus',lang:'en-US',languages:['en'],localService:true,default:false,license:'Kitten-TTS-Modell Apache-2.0',source:'https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8',kind:'kitten',tier:'fast',ramMB:250,sampleRate:24000,voices:8,voice:{name:'expr-voice-2-f',speed:.8},
  files:[{role:'model',url:kitten+'kitten_tts_nano_v0_8.onnx',bytes:24369971,sha256:'f7b0afcbee92870b32b8e0276d855b954dc25470c9f051b376ac7eee537c76fc'},{role:'voices',url:kitten+'voices.npz',bytes:3278902,sha256:'8aa7cee235abb0739cb51e6559685f65a4dacd95568833d05699b1633f519b3f'}]},
 'kitten-micro':{id:'kitten-micro',name:'Bella · Englisch (Kitten micro)',voiceURI:'notable:kitten-micro:bella',voiceId:'kitten:bella',family:'kitten',display:'Bella',variant:'micro',gender:'f',sample:'samples/register-kitten-micro-bella.opus',lang:'en-US',languages:['en'],localService:true,default:false,license:'Kitten-TTS-Modell Apache-2.0',source:'https://huggingface.co/KittenML/kitten-tts-micro-0.8',kind:'kitten',tier:'fast',ramMB:250,sampleRate:24000,voices:8,voice:{name:'expr-voice-2-f',speed:1},
  files:[{role:'model',url:kittenMicro+'kitten_tts_micro_v0_8.onnx',bytes:41384970,sha256:'95481626fee1ba70ce683e69c534fc7cb38433c46ce42d3abbeafb4b9f1a4123'},{role:'voices',url:kittenMicro+'voices.npz',bytes:3278902,sha256:'112710c1be8ad0e967c190fb0fd95cbe5848ec4791b93209f20b28b7da20dac1'}]},
 'kitten-mini':{id:'kitten-mini',name:'Bella · Englisch (Kitten mini)',voiceURI:'notable:kitten-mini:bella',voiceId:'kitten:bella',family:'kitten',display:'Bella',variant:'mini',gender:'f',sample:'samples/register-kitten-mini-bella.opus',lang:'en-US',languages:['en'],localService:true,default:false,license:'Kitten-TTS-Modell Apache-2.0',source:'https://huggingface.co/KittenML/kitten-tts-mini-0.8',kind:'kitten',tier:'balanced',ramMB:350,sampleRate:24000,voices:8,voice:{name:'expr-voice-2-f',speed:1},
  files:[{role:'model',url:kittenMini+'kitten_tts_mini_v0_8.onnx',bytes:78268016,sha256:'0f5bbae4fc4800c98dbc544a87ecfa79510de2fb8222db30d12e5bfe9177df91'},{role:'voices',url:kittenMini+'voices.npz',bytes:3278902,sha256:'40ad2638952b77b7b2f30127e2608e169fc69dd256b53bd8aaa3409a33193c42'}]},
 'piper-medium':piperVoice('piper-medium','Thorsten · Deutsch (kompakt)','notable:piper:thorsten-medium','thorsten/medium','de_DE-thorsten-medium',[63201294,'7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819'],[4819,'974adee790533adb273a1ac88f49027d2a1b8f0f2cf4905954a4791e79264e85'],{tier:'balanced',ramMB:400,sampleRate:22050,voices:1,license:'Piper-Modell MIT · Sprachdatensatz CC0',voiceId:'piper:de_de-thorsten',family:'piper',display:'Thorsten',sample:'samples/register-piper-thorsten-medium.opus'}),
 'piper-eva':piperVoice('piper-eva','Eva · Deutsch (sehr klein)','notable:piper:eva_k-x_low','eva_k/x_low','de_DE-eva_k-x_low',[20628813,'e88cf290fbfb768bf111330d2e8a46e376b0d85e3423a28bfebbc863a260dad8'],[4158,'ef14b3dcb279ab4b18422a7a132877bee7a148821bd91152fb7ae9c4b3d79625'],{tier:'fast',ramMB:300,sampleRate:16000,voices:1,idMap:'config',license:'Piper-Modell MIT · Sprachdatensatz M-AILABS (Lizenz ungeklärt: das Register nannte BSD-3-Clause, die Modellkarte nennt nur „See URL“, die M-AILABS-Seite war am 08.11.2026 nicht abrufbar)',licenseStatus:'unclear',voiceId:'piper:de_de-eva_k',family:'piper',display:'Eva',sample:'samples/register-piper-eva-xlow.opus'})
};
/* Release month of the eight original records (same sources as in neural-voices.js). */
for(const [id,model] of Object.entries(MODELS)){const key=model.family==='piper'?{piper:'de_DE-thorsten-high','piper-medium':'de_DE-thorsten-medium','piper-eva':'de_DE-eva_k-x_low'}[id]:'',released=key?PIPER_RELEASED[key]:RELEASED_FAMILY[model.family];if(released)model.released=released;}
/* Voice catalogue (neural-voices.js): one record per voice x tier; the eight records above keep their ids, voiceURIs and files, so stored choices stay valid. */
/* Thorsten medium was retrained by rhasspy on the free rdh base (13.11.2026 state, see PIPER_RETRAINED); same id
   and voiceURI. */
const legacyThorstenMedium=MODELS['piper-medium'].files.map(file=>file.url);
MODELS['piper-medium']=retrainedPiper(MODELS['piper-medium'],'de_DE-thorsten-medium','de/de_DE/thorsten/medium');
Object.assign(MODELS,NEW_MODELS);
/* Flow-LM family (Phonon, Pocket TTS): own file, own adapter (engine/worker/pocket-family.js), no phonemizer. */
Object.assign(MODELS,POCKET_MODELS);Object.assign(FAMILIES,POCKET_FAMILIES);
/* Verified local Piper expansion, including actual multi-speaker IDs. Experimental families are no longer selectable. */
Object.assign(MODELS,ADDITIONAL_MODELS);
/* Piper voices whose BASE checkpoint was trained on non-commercial data and that rhasspy has not retrained yet
 * (13.11.2026). The weights are MIT, the base data is not: lessac = Blizzard 2013 Lessac licence (research only;
 * "any commercial purpose, including the development ... of voice synthesis" is excluded), ryan = RyanSpeech, CC
 * BY-NC-SA 4.0. Evidence per voice: its MODEL_CARD ("Finetuned from U.S. English lessac/Ryan voice"), es_MX-ald via
 * the former lessac-based davefx. Data for a later recommendation rule only: no voice is hidden or removed here. */
const NC_BASES={lessac:{license:'Blizzard 2013 Lessac (nur Forschung)',
 url:'https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html'},
 ryan:{license:'RyanSpeech CC BY-NC-SA 4.0',
  url:'https://huggingface.co/rhasspy/piper-voices/blob/6b9cfaacb4fb2e02a9621227e3c1a48bec9710c3/'+
   'en/en_US/ryan/low/MODEL_CARD'}};
export const NC_BASE_OF={'de_DE-thorsten-high':'lessac','cs_CZ-jirka-low':'lessac','en_US-mike-medium':'lessac',
 'en_US-sam-medium':'lessac','pl_PL-gosia-medium':'lessac','pl_PL-mc_speech-medium':'lessac',
 'es_MX-ald-medium':'lessac',
 'de_DE-kerstin-low':'ryan','de_DE-thorsten-low':'ryan','en_US-kathleen-low':'ryan','es_ES-mls_10246-low':'ryan',
 'es_ES-mls_9972-low':'ryan','fr_FR-gilles-low':'ryan','fr_FR-mls_1840-low':'ryan','fr_FR-siwis-low':'ryan',
 'nl_NL-mls_5809-low':'ryan','nl_NL-mls_7432-low':'ryan','pl_PL-mls_6892-low':'ryan','pt_BR-edresson-low':'ryan'};
const piperKey=model=>decodeURIComponent(model.files[0].url.split('/').pop()).replace(/\.onnx$/,'');
for(const model of Object.values(MODELS)){
 const base=model.kind==='piper'&&!model.retrained&&NC_BASE_OF[piperKey(model)];
 if(base){model.basisNonCommercial=true;model.basisSource={base,...NC_BASES[base],card:model.source};}
}
/* ONE switch for the 19 voices above (code review 2.5.5, R6, standard set 20.11.2026: offered and labelled). false = they are not offered at all: the register
   drops them before anything (voice list, engine, recommendations, export) sees them. A voice already chosen falls back like any voice that is gone. */
export const OFFER_NONCOMMERCIAL_BASE=true;
if(!OFFER_NONCOMMERCIAL_BASE)for(const [key,model] of Object.entries(MODELS))if(model.basisNonCommercial)delete MODELS[key];
/* Cached files no record uses any more (former revision of retrained voices): input for a later cleanup of the
   cache. */
export const SUPERSEDED_URLS=Object.freeze([...legacyThorstenMedium,...SUPERSEDED_PIPER_URLS,
 ...SUPERSEDED_ADDITIONAL_URLS]);
/* Roadmap, not shipped: candidates found by research (07.11.2026) that have no local, verified function yet.
 * They appear in the picker as "planned" and can neither be downloaded nor selected. Promote one into MODELS only after a real browser test. */
export const PLANNED_MODELS=[
 {id:'pocket-tts-de-int8',name:'Pocket TTS Deutsch (Kyutai, INT8-ONNX)',languages:['de','en','fr','it','pt','es'],approxMB:130,license:'CC-BY-4.0',source:'https://huggingface.co/KevinAHM/pocket-tts-onnx',needs:'browser'},
 {id:'chatterbox-multilingual-q4',name:'Chatterbox Multilingual (Resemble AI, q4-ONNX)',languages:['de','en','fr','es','it','pt','nl','pl','tr','ru','sv','ja','zh'],approxMB:1550,license:'MIT',source:'https://huggingface.co/onnx-community/chatterbox-multilingual-ONNX',needs:'browser'}
];
export const modelBytes=model=>model.files.reduce((sum,file)=>sum+file.bytes,0);
export const modelByVoice=voiceURI=>Object.values(MODELS).find(model=>model.voiceURI===voiceURI);
/* Models of a tier, German before English so the picker order is stable. */
export const modelsOfTier=tier=>Object.values(MODELS).filter(model=>model.tier===tier).sort((a,b)=>a.languages[0].localeCompare(b.languages[0]));
/* Pure recommendation from coarse, local-only device hints (never sent anywhere). deviceMemory is capped at 8 by browsers. */
export function recommendTier({memory,cores,threads}={}){
 if((memory!==undefined&&memory<4)||(cores!==undefined&&cores<4))return 'fast';
 /* Without WASM threads (Firefox extension pages) the largest models miss real time; never recommend them there. */
 if(memory!==undefined&&memory>=8&&cores!==undefined&&cores>=8)return threads===false?'balanced':'best';
 return 'balanced';
}

/* Voice view of the flat register: one entry per voice with its tiers. Per tier the largest model counts as the tier; smaller models of the same tier
 * (Kitten nano next to micro) are listed in `smaller`, so the picker shows three honest steps and the smaller size as an extra choice.
 * The same name in two families (Bella: Kokoro and Kitten) stays two voices; tiers never cross families. */
export function voiceTiers(models=MODELS){
 const by=new Map();
 for(const model of Object.values(models)){
  if(!model.voiceId)continue;
  let voice=by.get(model.voiceId);
  if(!voice){voice={voiceId:model.voiceId,name:model.display||model.name,family:model.family||'',lang:model.lang,languages:[...model.languages],gender:model.gender,tiers:{},smaller:[]};by.set(model.voiceId,voice);}
  const entry={id:model.id,voiceURI:model.voiceURI,tier:model.tier,bytes:modelBytes(model),sample:model.sample||'',variant:model.variant||'',license:model.license,licenseStatus:model.licenseStatus||'free'},current=voice.tiers[model.tier];
  if(!current)voice.tiers[model.tier]=entry;
  else if(entry.bytes>current.bytes){voice.smaller.push(current);voice.tiers[model.tier]=entry;}
  else voice.smaller.push(entry);
 }
 return [...by.values()];
}
