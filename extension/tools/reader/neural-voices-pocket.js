/* Voice catalogue part 2 · flow-LM family (Phonon; Pocket TTS follows in the same file) · public data only, own code MIT.
 * Adapter: extension/engine/worker/pocket-family.js (kind `phonon`). No phonemizer, no eSpeak: the model's own tokenizer.json is used.
 * Every file is pinned to a fixed Hugging Face revision with exact size and SHA-256 (LFS oid; small non-LFS files hashed ourselves).
 * Phonon 31M English (Gradium, 19.10.2026): model and voices Apache-2.0 (model card gradium/phonon-31m-en and gradium/phonon-voices);
 * the card says Phonon builds on Kyutai's Pocket TTS and the Mimi codec, therefore THIRD_PARTY_NOTICES.md also names Kyutai (CC-BY-4.0, conservative).
 * REVISION IS PINNED ON PURPOSE: `main` of onnx-community/phonon-31m-en-ONNX changed on 02.11.2026 (other file names, other config) and no longer fits this adapter.
 * Revision 4f0cda7c60dd (26.10.2026, "Pipeline-first usage") is the last one with flow_lm*.onnx + config.phonon; checked by tests/models-pocket-family.test.mjs.
 * Not included on purpose: Phonon 40M (CC-BY-NC), the 12 English character voices and the 64 voices designed for other languages (this model speaks English only). */
const hf=(repo,revision)=>`https://huggingface.co/${repo}/resolve/${revision}/`;
const phonon=hf('onnx-community/phonon-31m-en-ONNX','4f0cda7c60dddb4862d0e68ff9ff60c32ffdc9f4');
const COMMON=[{role:'tokenizer',url:phonon+'tokenizer.json',bytes:303009,sha256:'401de2690406fccc33f139921ba2d4fc22784b5c32f52c7b6db33ff0f635bf4a'},{role:'config',url:phonon+'config.json',bytes:4952,sha256:'1c942e652a16d0ff56fb492a248d14d1b603e66427525f085ccb0def71187852'}];
const DECODER={role:'decoder',url:phonon+'onnx/mimi_decoder.onnx',bytes:41267821,sha256:'842ba85dc849f9ed19d2a34dfaed2985fde729de75c7647f6033707454ec1d3d'};
/* Only the fp32 graphs are registered: measured in headless Chromium, WASM, one thread (page without cross-origin isolation), loaded machine:
 * fp32 real-time factor 0.52-0.62 (CPU time per audio second 0.54-0.60), q4 (4-bit weights) 1.15-2.02, i.e. NOT real time on WASM (the model card says the same: use q4/q4f16 only on WebGPU).
 * The adapter can run q4 (external data file, covered by tests); register it only together with a verified WebGPU path. */
const PHONON_TIER={
 fp32:{tier:'best',ramMB:800,id:'',label:'Phonon',flow:[{role:'flow',url:phonon+'onnx/flow_lm.onnx',bytes:120089751,sha256:'27f933db151b81d30606b27f9a490dc9d73d93a4ee302c4f5ac29401fa858974'}]}};
/* [Anzeigename, Datei in voices/, BCP-47, Geschlecht (leer = Standardstimme des Modells), Bytes, SHA-256]; 12 US + 13 UK Stimmen der Gradium-Liste plus die Standardstimme. */
const PHONON_VOICES=[
["Standard","default.bin","en-us","",256000,"d9291d795d2b3b3ca5aaf0d61c44b378918c840824e7c0bc41cfb63e5b0c560b"],
["Zoey","NbpkqMVS3CJeq2j8.bin","en-us","f",256000,"2023c0fddede488a609b911803345ebc333b406fbfb39d3444fae5c7459000db"],
["Juniper","NIWIOv5vTi5eRMj8.bin","en-us","f",256000,"762de2a472be583d3e358ad1c1e3fca0e16e7d0be7c96c70ff5116ce7437e633"],
["Everly","vjFyp2BcCyTlUmYb.bin","en-us","f",256000,"a2bbd50a8587c0236c0d84ed81e10d91bce89ff92bb6604f830c4dcc0fc294e2"],
["Harper","4SZHfMpw-p46Ywgs.bin","en-us","f",256000,"331b969dbe31746edfdff9937fa8c27029d21c1fb3f41a6aa3dee6def0d17ce2"],
["Hadley","bXwrkHhURL1VFJdG.bin","en-us","f",256000,"6c0812d2a2da1659202b46b8e08c68708a6ba30cf684ffc05737a1e7eda01383"],
["Delia","nGzMHMPAWGaJFHOo.bin","en-us","f",256000,"a5e6eadb0436a229373833fe0cb790d3317e04ab227d4c8fbd2e3e68411dd329"],
["Easton","LMDIYE0Oa377Qh6Z.bin","en-us","m",256000,"6467e69cb22525b9a2784f661a543c0b018cba655ccc30be2e153ed2ac0f30ef"],
["Micah","40QrMVgAxFiUnP9f.bin","en-us","m",256000,"186b193668d0e53f7570d24aa0f68609b6111208740eede15c15d52861c0457a"],
["Trevor","0zLApsZfVLLNaEGl.bin","en-us","m",256000,"fc996d45cca76d38aa33f9cbedf5ac9c70bd692029287c8d4c49bc2a06b90206"],
["Russell","_6Aslh2DxfmnRLmP.bin","en-us","m",256000,"c1d99829cddde28781e82aa81f020fb33a529b79c980406e0e03fb57f3dc1e08"],
["Preston","qIxlZ7Ei8KvWlyQH.bin","en-us","m",256000,"1b81d1228569972a7abeb81a854d34f18f37c1f6f7243a02b31c184308ebbae7"],
["Miles","d9XCyhjo4JhkHF1d.bin","en-us","m",256000,"ab542932f553e16be04d530ea2cddf1fbfc655d13074343d416bb76efaee86ae"],
["Maeve","6PWnV0Nq4wu7RVBT.bin","en-gb","f",256000,"f00756d86bcd873c0ab3c240a52a7470ac7f02e8cb12718e86d7563ecd9fa932"],
["Freya","GgfEkEJtxZR7gnpy.bin","en-gb","f",256000,"ad1c36dc0e9a601ee13c75a418314263b7555ab44ee4428490c27c36d9b0ffa6"],
["Pippa","uem82D50GRv2Dwma.bin","en-gb","f",256000,"d6f8b84bd21462f3adf3b9a1b867ed01cfb57f7bc07ec000e7745d792f6be6d3"],
["Elodie-Rose","y9bQqIDnyxwqK01t.bin","en-gb","f",256000,"67398bd736ee16da7c4311f7810b5e4c31f7470780e36538f1a9ad5574f857ea"],
["Imogen","gDT1nz7Ie36ZhL-C.bin","en-gb","f",256000,"3158772a170e412789815f86182f953c8b55abf1d657817b7d0c4fa80498a06c"],
["Lottie","m9MxpY6IUGXtWp76.bin","en-gb","f",256000,"4a5e5aa843c7f0435301924a168b02578a532b4bd9e174af8036738214383625"],
["Alfie","X6NceqF285Gr04gb.bin","en-gb","m",256000,"58792454eab6b4f10235bec6f37c50794965ad60e24af349acaf784cdae3539b"],
["Hugh","YyKcxPG7iIgS3jsK.bin","en-gb","m",256000,"f73e14157996adc0b4269acbe3d5b6d7d069e814452edd811686aaa913090af4"],
["Edwin","zUCxzrOrugTSis03.bin","en-gb","m",256000,"4c24cb5301e5a0412d4db3161f76b710f6674b25226c9ea6851c900873c7c0fb"],
["Spencer","JOW0vchyswkQUMDS.bin","en-gb","m",256000,"40de871900a04e3ba8ca5c4cb2cbff899d2c1f0e763584758fb775f0a641c99d"],
["Toby","dME3IWyZBvmh1n1q.bin","en-gb","m",256000,"235d93042993b414466b634d85a819525962f4eabd49f6b72bc04dcc452b493b"],
["Teddy","Zn7g6NxLqXlJb7Qi.bin","en-gb","m",256000,"b9e3ac95e09b85eea9bf92b79ac498bea93ab8c3c6e1402e14af5968bdcc0f14"],
["Bryony","gfP44RlHwr2kEwk7.bin","en-gb","f",256000,"03e842cf581b6ca3071706e8314c5536dc9b0b649aef602477100e6c22406bd2"],
];
const slug=name=>name.toLowerCase().replace(/[^a-z0-9]+/g,'');
const phononRecord=([name,file,lang,gender,bytes,sha256],tier)=>{const t=PHONON_TIER[tier],key=slug(name);return {id:'phonon-'+t.id+key,name:`${name} · Englisch (${t.label})`,voiceURI:`notable:phonon:${key}`,voiceId:'phonon:'+key,family:'phonon',display:name,...(gender?{gender}:{}),lang:lang==='en-gb'?'en-GB':'en-US',languages:['en'],localService:true,default:false,license:'Phonon-Modell und Stimmen Apache-2.0 (Gradium); baut auf Kyutai Pocket TTS/Mimi (CC-BY-4.0)',source:'https://huggingface.co/onnx-community/phonon-31m-en-ONNX',kind:'phonon',tier:t.tier,ramMB:t.ramMB,sampleRate:24000,voices:PHONON_VOICES.length,released:'2026-10',sample:'samples/phonon-'+key+'.opus',
 files:[...t.flow,DECODER,...COMMON,{role:'voiceData',url:phonon+'voices/'+file,bytes,sha256}]};};
const records=[];
for(const v of PHONON_VOICES)records.push(phononRecord(v,'fp32'));
export const POCKET_MODELS=Object.fromEntries(records.map(record=>[record.id,record]));
export const POCKET_FAMILIES={phonon:'Phonon'};
