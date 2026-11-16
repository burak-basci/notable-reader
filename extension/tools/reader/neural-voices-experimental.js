/* Voice catalogue part 3 · stage "Experimentell" (large models, WebGPU) · public data only, own code MIT.
 * Large and 4-bit models are offered as an OPTIONAL stage so that every user can judge them by ear.
 * Rules for every record here: `experimental: true`; never preselected, never recommended, never loaded
 * automatically, downloaded only after an explicit click (size and notes are shown first); `needs.webgpu` is checked before a worker starts.
 * Adapter: extension/engine/worker/qwen3tts.js (kind `qwen3tts`, no phonemizer).
 * Qwen3-TTS-12Hz-0.6B-CustomVoice, 4-bit ONNX export for WebGPU by danyalmalik (model card: Apache-2.0, "modified files" of Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice, Apache-2.0):
 *   weights  danyalmalik/Qwen3-TTS-12Hz-0.6B-CustomVoice-ONNX-WebGPU @ ccdd14012062ee383dda616d7799cc955924af8a
 *   decoder  danyalmalik/Qwen3-TTS-Tokenizer-12Hz-ONNX-WebGPU        @ b2aa169358f3ba36110a9c9ce7d5a75209e39b7f (tok_decoder_q4.onnx)
 *   runtime  onnxruntime-web 1.31.1 (MIT): JS glue and the JSPI WASM (17.9 MB) ship IN the package (vendor/neural/ort-webgpu/); nothing is fetched from a third host.
 * Sizes and SHA-256: Hugging Face LFS oids (checked against the hub API and our own download); the two small non-LFS files hashed ourselves.
 * All nine built-in speakers are registered for English and German (see SPEAKERS below for what was measured per speaker).
 * `measured` holds ONLY own measurements with their source file; no statement about how a voice sounds. */
const hf=(repo,revision)=>`https://huggingface.co/${repo}/resolve/${revision}/`;
const Q=hf('danyalmalik/Qwen3-TTS-12Hz-0.6B-CustomVoice-ONNX-WebGPU','ccdd14012062ee383dda616d7799cc955924af8a');
const T=hf('danyalmalik/Qwen3-TTS-Tokenizer-12Hz-ONNX-WebGPU','b2aa169358f3ba36110a9c9ce7d5a75209e39b7f');
const Q17=hf('danyalmalik/Qwen3-TTS-12Hz-1.7B-CustomVoice-ONNX-WebGPU','098e415f848952a940a9ba685f65ec23e00fa582');
const FILES=[
 {role:'config',url:Q+'config.json',bytes:4908,sha256:'81aca2b6fac304944d8acf345272d8a9a727d5fc2e2e66b222ab4729340c7455'},
 {role:'tokenizer',url:Q+'tokenizer.json',bytes:11423986,sha256:'09267689b8362020b9763b65dd5be7e086b31e28d72e02837a9e781de9a91bc7'},
 {role:'textEmbed',url:Q+'text_embed_q4.onnx',bytes:97239399,sha256:'6a0d7fa5c29e1a60ccce507a92827ddb432ddf49dfea8c166a886c5c7d138df9'},
 {role:'codecEmbed',url:Q+'codec_embed_q4.onnx',bytes:21627240,sha256:'e5f424a00c8c565f1d660f6dffd69ff3be9bceeacdd55b5c0eb936bd72958cd5'},
 {role:'talker',url:Q+'talker/model.onnx',bytes:276512,sha256:'2edc5aed01da638848a17123ee0673782d6d5a406339969e4198e555a2ab8ff3'},
 {role:'talkerData',url:Q+'talker/model.onnx.data',bytes:301203456,sha256:'026537338baf696232457b7e624a9c8794f16caa358a5a8cc88d92f61a091e3c'},
 {role:'predictor',url:Q+'code_predictor/model.onnx',bytes:56354,sha256:'6ac4c6c4cc831ff024015537d1ae16c0d3e72b17e4ef512c4c5924a26a7b7a4c'},
 {role:'predictorData',url:Q+'code_predictor/model.onnx.data',bytes:157483008,sha256:'35284527836a5c52836f58d4fe0e140eb3a9a442cbeed44cd8d494c5eb056bf8'},
 {role:'decoder',url:T+'tok_decoder_q4.onnx',bytes:100611208,sha256:'75b53ce2ef29c390eeda17c6ffd76a34cf05cef9e0da0de05c42dfe563084a93'},
];
/* Qwen3-TTS 1.7B (same graphs, talker width 2048, plus the projection graph to the predictor's width): weights @ 098e415f848952a940a9ba685f65ec23e00fa582 (21.10.2026), Apache-2.0 (card + LICENSE read.2026), same decoder, tokenizer and runtime file. */
const FILES17=[
 {role:'config',url:Q17+'config.json',bytes:4908,sha256:'17a07f527a1c25ea30b4e023a184482a23d3e279d697b1dc81b1bde498d29cf9'},
 FILES[1],
 {role:'textEmbed',url:Q17+'text_embed_q4.onnx',bytes:194478439,sha256:'d414d3c004a263adde99467f86bc1870a3f0c0c386152babdb3809c586cde296'},
 {role:'codecEmbed',url:Q17+'codec_embed_q4.onnx',bytes:64881305,sha256:'1f3bda3cfb2f4a09eb43734b2c3b991e5d9b8fb9811e8d7b8c3402ad2abaf551'},
 {role:'talker',url:Q17+'talker/model.onnx',bytes:277123,sha256:'d2f997433acf81ed61034b21d8903cac9143f0b5b515358ce496a18321a391b3'},
 {role:'talkerData',url:Q17+'talker/model.onnx.data',bytes:924188672,sha256:'9f18ddd03c6e1b4a35804da668d63444973e835d3842ef684b2f124f0ff6a0cb'},
 {role:'predictor',url:Q17+'code_predictor/model.onnx',bytes:56354,sha256:'6ac4c6c4cc831ff024015537d1ae16c0d3e72b17e4ef512c4c5924a26a7b7a4c'},
 {role:'predictorData',url:Q17+'code_predictor/model.onnx.data',bytes:157483008,sha256:'33fad8842b38c691750ab466379db80324fb685ada4b250bc96b975630d949bb'},
 {role:'project',url:Q17+'cp_project_q4.onnx',bytes:1315139,sha256:'ed0a9a957eb5ebac177f37c044ad1227defd7595fc8946f63253a353123d837d'},
 FILES[8]
];
/* Own measurements only (this machine: RTX 3060 12 GB, Chromium 155 headless, 16 cores, model already in the browser cache, other jobs running): real-time factor = compute seconds per audio second
 * (>1 = slower than real time); cold start = worker start + model load + first short sentence; VRAM = nvidia-smi board total minus the idle desktop (2.3 GB), polled every 250 ms; WER not recorded here (see report). Source: tests/models-qwen3tts-real.cjs. */
const MEASURED={'06b':{date:'2026-11-10',rtf:[0.71,1.17],/* one section alone 1.05-1.2 (was 1.6 before the predictor read-back fix), two sections in parallel on two workers 0.71; before the read-back fix 1.68-2.77 */coldStartMs:[5035,14839],vramAfterLoadMB:1100,vramPeakMB:3800,source:'tests/models-qwen3tts-real.cjs, report GROSSMODELLE-OPTION.md'},
 '17b':{date:'2026-11-09',rtf:[1.47,2.16],coldStartMs:[5183,10702],vramAfterLoadMB:1700,vramPeakMB:4500,source:'tests/models-qwen3tts-real.cjs, report GROSSMODELLE-OPTION.md'}};
/* Honest labels shown before the download. `notes` are keys for the picker (it localises them); `foreignSpeaker` = German is spoken by a non-German built-in speaker (accent possible). */
const NOTES=['webgpu','large-download','slower-than-realtime','long-text-errors'];
const SIZES={'06b':{label:'0.6B',files:FILES,ramMB:3500,source:'https://huggingface.co/danyalmalik/Qwen3-TTS-12Hz-0.6B-CustomVoice-ONNX-WebGPU'},'17b':{label:'1.7B',files:FILES17,ramMB:5500,source:'https://huggingface.co/danyalmalik/Qwen3-TTS-12Hz-1.7B-CustomVoice-ONNX-WebGPU'}};
/* The nine built-in speakers (config.json spk_id; native language per Qwen model card). Only ryan and aiden were measured individually (RTF, Whisper aid, technical-sentence sample); the other seven carry the
 * per-size measurement of the same files (the speaker changes only one conditioning vector) and one short sample each. eric and dylan are Chinese dialect speakers (config: spk_is_dialect). */
const SPEAKERS=[['ryan','Ryan','m','english',true],['aiden','Aiden','m','english',true],['serena','Serena','f','chinese'],['vivian','Vivian','f','chinese'],['uncle_fu','Uncle Fu','m','chinese'],['ono_anna','Ono Anna','f','japanese'],['sohee','Sohee','f','korean'],['eric','Eric','m','chinese (Sichuan dialect)'],['dylan','Dylan','m','chinese (Beijing dialect)']];
const speaker=(key,name,gender,native,measuredSpeaker,language,size)=>{
 const german=language==='de',slug=`${key}-${language}`,{label,files,ramMB,source}=SIZES[size],foreign=german||native!=='english';
 return {id:`qwen3-${size}-`+slug,name:`${name} · ${german?'Deutsch':'Englisch'} (Qwen3-TTS ${label}, experimentell)`,voiceURI:`notable:qwen3tts-${size}:${slug}`,voiceId:'qwen3tts:'+slug,variant:label,family:'qwen3tts',display:name,gender,
  lang:german?'de-DE':'en-US',languages:[german?'de':'en'],localService:true,default:false,kind:'qwen3tts',tier:'best',experimental:true,cooperativeCancel:true,released:'2026-01',
  params:{speaker:key,language:german?'german':'english'},needs:{webgpu:true},notes:foreign?[...NOTES,'foreign-speaker']:NOTES,nativeLanguage:native,...(foreign?{foreignSpeaker:true}:{}),
  sample:`samples/qwen3-${size}-${slug}.opus`,...(measuredSpeaker?{sampleTech:`samples/qwen3-${size}-${slug}-tech.opus`}:{}),ramMB,sampleRate:24000,voices:1,measured:MEASURED[size]||null,
  license:'Qwen3-TTS-Modell Apache-2.0 (Alibaba/Qwen); ONNX-Export 4-Bit Apache-2.0 (danyalmalik); ONNX Runtime Web MIT',
  source,files};
};
const records=['06b','17b'].flatMap(size=>['en','de'].flatMap(language=>SPEAKERS.map(([key,name,gender,native,measuredSpeaker])=>speaker(key,name,gender,native,measuredSpeaker,language,size))));
export const EXPERIMENTAL_MODELS=Object.fromEntries(records.map(record=>[record.id,record]));
export const EXPERIMENTAL_FAMILIES={qwen3tts:'Qwen3-TTS'};
