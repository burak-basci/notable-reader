/* Voice catalogue · public data only, no text or telemetry endpoint · own code MIT.
 * One register record per voice x quality tier (flat, so downloader, cache store and worker stay as they are);
 * neural-models.js merges these records into MODELS and derives the voice view (voiceTiers).
 * Source of every file: a fixed Hugging Face revision with exact size and SHA-256 (LFS oid, small non-LFS files hashed ourselves);
 * generated from real Hub listings on 08.11.2026 (kokoro: onnx-community/Kokoro-82M-v1.0-ONNX, piper: rhasspy/piper-voices, kitten: KittenML) and checked by tests/voice-catalog.test.mjs.
 * Licence filter: only voices whose training data licence was read and is free to use (CC0, public domain, Apache, Unlicense, CC BY with attribution);
 * non-commercial, share-alike, unclear and excluded datasets are NOT in this file (see tests/voice-catalog.test.mjs for the rule).
 * Turkish (tr) is deliberately NOT here (checked): Piper tr_TR-dfki = CC BY-NC-SA 4.0 (MODEL_CARD, pinned revision); tr_TR-fettah and tr_TR-fahrettin (CC0 per card) were removed from rhasspy/piper-voices on 30.12.2025 "at request of contributors" (commit b145f2ac26), so there is no
 * grant to rely on; facebook/mms-tts-tur = CC BY-NC 4.0; 99eren99/piper-turkish-tts and its q8 copy state no licence; dcx514ai/* Piper models are gated with unknown data; Coqui/Pocket Turkish models were trained on serdarcaglar/turkish-tts-audiobooks ("rights of the source recordings are not cleared"). Turkish is read with the device voices of the browser.
 * New fields per record: voiceId (groups the tiers of one voice), family (kokoro|kitten|piper), display (voice name shown in the picker), gender (only where the source states it),
 * released (release month YYYY-MM, empty where unknown), sample (short listening sample, extension/samples/), language (espeak language for the Kokoro adapter), speakerId (Piper multi-speaker, unused here). */
const hf=(repo,revision)=>`https://huggingface.co/${repo}/resolve/${revision}/`;
const kokoro=hf('onnx-community/Kokoro-82M-v1.0-ONNX','1939ad2a8e416c0acfeecc08a694d14ef25f2231');
const piper=hf('rhasspy/piper-voices','e7229f7d33a10e145e109b886d661984201ac3c4');
const KOKORO_MODEL={
 fp32:{tier:'best',ramMB:1100,id:'',label:'Kokoro FP32',file:{role:'model',url:kokoro+'onnx/model.onnx',bytes:325532232,sha256:'8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb'}},
 q8:{tier:'balanced',ramMB:500,id:'q8-',label:'Kokoro kompakt',file:{role:'model',url:kokoro+'onnx/model_quantized.onnx',bytes:92361116,sha256:'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478'}}};
const KOKORO_TOKENIZER={role:'tokenizer',url:kokoro+'tokenizer.json',bytes:3497,sha256:'77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34'};
/* [voice, Anzeigename, eSpeak-Sprache, BCP-47, Geschlecht, Stil-Bytes, Stil-SHA-256, Hörprobe, Datengüte-Note laut hexgrad/Kokoro-82M VOICES.md (null = keine)]; af_bella gehört schon zum Register (ids kokoro / kokoro-q8). */
const KOKORO_VOICES=[
 ["af","af (Standardmischung)","en-us","en-US","f",524288,"a4f11d9d055a12bfa0db2668a3e4f0ef8fd1f1ccca69494479718e44dbf9e41a","samples/kokoro-fp32-af.opus",null],
 ["af_alloy","Alloy","en-us","en-US","f",522240,"c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45","samples/kokoro-fp32-af_alloy.opus","C"],
 ["af_aoede","Aoede","en-us","en-US","f",522240,"4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361","samples/kokoro-fp32-af_aoede.opus","C+"],
 ["af_heart","Heart","en-us","en-US","f",522240,"d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b","samples/kokoro-fp32-af_heart.opus","A"],
 ["af_jessica","Jessica","en-us","en-US","f",522240,"a240a5e3c15b43563d6e923bdca8ef5613a23471d9b77653694012435df23bd8","samples/kokoro-fp32-af_jessica.opus","D"],
 ["af_kore","Kore","en-us","en-US","f",522240,"9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e","samples/kokoro-fp32-af_kore.opus","C+"],
 ["af_nicole","Nicole","en-us","en-US","f",522240,"cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a","samples/kokoro-fp32-af_nicole.opus","B-"],
 ["af_nova","Nova","en-us","en-US","f",522240,"18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f","samples/kokoro-fp32-af_nova.opus","C"],
 ["af_river","River","en-us","en-US","f",522240,"00a2bcf82b1d86e8f19902ede58c65ccf6c0e43b44b7d74fad54e5d8933c9c30","samples/kokoro-fp32-af_river.opus","D"],
 ["af_sarah","Sarah","en-us","en-US","f",522240,"4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a","samples/kokoro-fp32-af_sarah.opus","C+"],
 ["af_sky","Sky","en-us","en-US","f",522240,"4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9","samples/kokoro-fp32-af_sky.opus","C-"],
 ["am_adam","Adam","en-us","en-US","m",522240,"162b035ed91cfc48b6046982184c645f72edcdd1b82843347f605d7bf7b15716","samples/kokoro-fp32-am_adam.opus","F+"],
 ["am_echo","Echo","en-us","en-US","m",522240,"3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3","samples/kokoro-fp32-am_echo.opus","D"],
 ["am_eric","Eric","en-us","en-US","m",522240,"e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832","samples/kokoro-fp32-am_eric.opus","D"],
 ["am_fenrir","Fenrir","en-us","en-US","m",522240,"c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43","samples/kokoro-fp32-am_fenrir.opus","C+"],
 ["am_liam","Liam","en-us","en-US","m",522240,"52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade","samples/kokoro-fp32-am_liam.opus","D"],
 ["am_michael","Michael","en-us","en-US","m",522240,"1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1","samples/kokoro-fp32-am_michael.opus","C+"],
 ["am_onyx","Onyx","en-us","en-US","m",522240,"da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6","samples/kokoro-fp32-am_onyx.opus","D"],
 ["am_puck","Puck","en-us","en-US","m",522240,"fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0","samples/kokoro-fp32-am_puck.opus","C+"],
 ["am_santa","Santa","en-us","en-US","m",522240,"61150cf726ab6c5ed7a99f90a304f91f5a72c00c592e89ec94e5df11c319227a","samples/kokoro-fp32-am_santa.opus","D-"],
 ["bf_alice","Alice","en-gb-x-rp","en-GB","f",522240,"08afa6ba24da61ea5e8efa139e5aadc938d83f0a6da5a900adaf763ac1da5573","samples/kokoro-fp32-bf_alice.opus","D"],
 ["bf_emma","Emma","en-gb-x-rp","en-GB","f",522240,"669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73","samples/kokoro-fp32-bf_emma.opus","B-"],
 ["bf_isabella","Isabella","en-gb-x-rp","en-GB","f",522240,"3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f","samples/kokoro-fp32-bf_isabella.opus","C"],
 ["bf_lily","Lily","en-gb-x-rp","en-GB","f",522240,"5e0ee32ebe64a467124976b14e69590746f1c4ce41a12b587a50c862edfea335","samples/kokoro-fp32-bf_lily.opus","D"],
 ["bm_daniel","Daniel","en-gb-x-rp","en-GB","m",522240,"6b3194bbceffb746733cbc22c8f593dd44e401a71d53895a2dca891bc595a1e8","samples/kokoro-fp32-bm_daniel.opus","D"],
 ["bm_fable","Fable","en-gb-x-rp","en-GB","m",522240,"f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1","samples/kokoro-fp32-bm_fable.opus","C"],
 ["bm_george","George","en-gb-x-rp","en-GB","m",522240,"c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc","samples/kokoro-fp32-bm_george.opus","C"],
 ["bm_lewis","Lewis","en-gb-x-rp","en-GB","m",522240,"b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97","samples/kokoro-fp32-bm_lewis.opus","D+"],
 ["ef_dora","Dora","es","es","f",522240,"f66ec66bd295acb18372e37008533a9a3228483ccd294e7538d5d9294ac9a532","samples/kokoro-fp32-ef_dora.opus",null],
 ["em_alex","Alex","es","es","m",522240,"27809e9eafdcbcfff90a3016c697568676531de2a2c39cee29c96c7bd6b83e95","samples/kokoro-fp32-em_alex.opus",null],
 ["em_santa","Santa","es","es","m",522240,"ad43b774e1ca24d05c6161297d8aeb770ac3d29bb95daf516727af5f7d543683","samples/kokoro-fp32-em_santa.opus",null],
 ["ff_siwis","Siwis","fr","fr","f",522240,"a35f5675ad08948e326ae75fd0ea16ba5d0042e4f76b5f3d1df77d0a48c54861","samples/kokoro-fp32-ff_siwis.opus","B-"],
 ["hf_alpha","Alpha","hi","hi","f",522240,"040be6a4425411cc01fda5fd06693c76bfa78572632852bc8cda9c99232ffb56","samples/kokoro-fp32-hf_alpha.opus","C"],
 ["hf_beta","Beta","hi","hi","f",522240,"cd83ae0bb9b2e4e4fb92b4973bd8d1822ca0036d3c498bf4fc89aa8e33917cc7","samples/kokoro-fp32-hf_beta.opus","C"],
 ["hm_omega","Omega","hi","hi","m",522240,"b02d9222d9ed00ce26b302173a862c2c93f96cc40b5c422b8d14910b9ff34137","samples/kokoro-fp32-hm_omega.opus","C"],
 ["hm_psi","Psi","hi","hi","m",522240,"644daf88ba8aeb7bd08950bbdcd4453bb280864e49dc4df93fabc6be32e03f37","samples/kokoro-fp32-hm_psi.opus","C"],
 ["if_sara","Sara","it","it","f",522240,"409b69248798fcdc2542330c76953d230710f19b057e59cb82fdc3c4cf71265c","samples/kokoro-fp32-if_sara.opus","C"],
 ["im_nicola","Nicola","it","it","m",522240,"bc578e510d52a96d6940d46f12e96d7b3df00905dbea075113226d100e6e1ab0","samples/kokoro-fp32-im_nicola.opus","C"],
 ["pf_dora","Dora","pt-br","pt-BR","f",522240,"3da7b5b2d91847ebf5646f57631af6ececae3c29a89cd300f06edf9aa6cfe9ee","samples/kokoro-fp32-pf_dora.opus",null],
 ["pm_alex","Alex","pt-br","pt-BR","m",522240,"0175c753f59c54e7fd5a995bedef0c5ff2fb67e0043dd3dcb2ae74ec2acbeb2a","samples/kokoro-fp32-pm_alex.opus",null],
 ["pm_santa","Santa","pt-br","pt-BR","m",522240,"8b012db3185778afe2e45a62cbad69db73021774fe68dda634bcc748a982eede","samples/kokoro-fp32-pm_santa.opus",null],
];
const kokoroRecord=([voice,name,language,lang,gender,bytes,sha256,sample,grade],tier)=>{const m=KOKORO_MODEL[tier],base=lang.split('-')[0];return {id:'kokoro-'+m.id+voice,name:`${name} · ${m.label}`,voiceURI:`notable:kokoro${tier==='q8'?'-q8':''}:${voice}`,voiceId:'kokoro:'+voice,family:'kokoro',display:name,gender,lang,languages:[base],language,localService:true,default:false,license:'Kokoro-Modell Apache-2.0',source:'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX',kind:'kokoro',tier:m.tier,ramMB:m.ramMB,sampleRate:24000,voices:1,sample,grade,
 files:[m.file,{role:'style',url:kokoro+'voices/'+voice+'.bin',bytes,sha256},KOKORO_TOKENIZER]};};
/* German Kokoro fine-tune "Kerstin" (crane-local-ai, repo created 06.08.2026; kikiri-tts recipe). Model card:
 * Apache-2.0, dataset Kerstin 1.0 CC0. Same graph as the v1.0 export (input_ids/style/speed -> waveform + duration,
 * opset 17), so the Kokoro adapter runs it and the duration output gives model word times. Its tokenizer.json is
 * byte-identical to the onnx-community one (same SHA-256), so the shared file is reused. German phoneme fixes:
 * kokoroGerman in worker/synth.js. Not the German default or offer: that stays with Burak's listening test. */
const kokoroDe=hf('crane-local-ai/Kokoro-82M-v1.0-German-ONNX','eeccb15741604cdc894053e1f4c72bb56c1a59be');
const KOKORO_DE_KERSTIN={id:'kokoro-df_kerstin',name:'Kerstin · Deutsch (Kokoro)',voiceURI:'notable:kokoro:df_kerstin',
 voiceId:'kokoro:df_kerstin',family:'kokoro',display:'Kerstin',gender:'f',lang:'de-DE',languages:['de'],language:'de',
 localService:true,default:false,
 license:'Kokoro-Feinabstimmung Apache-2.0 · Datensatz Kerstin 1.0 CC0 (laut Modellkarte)',
 source:'https://huggingface.co/crane-local-ai/Kokoro-82M-v1.0-German-ONNX',kind:'kokoro',tier:'best',ramMB:1100,
 sampleRate:24000,voices:1,released:'2026-08',sample:'samples/kokoro-fp32-df_kerstin.opus',grade:null,
 files:[{role:'model',url:kokoroDe+'onnx/model.onnx',bytes:336987079,
  sha256:'f541f868499a8186803c72166a09469821e971dbb1e4cd8eb7dcf593f49da0b1'},
  {role:'style',url:kokoroDe+'voices/df_kerstin.bin',bytes:522240,
   sha256:'f96576f656c58221b42ce46c74398dc2a6ffc03b8408abe530d85ebd717ca062'},
  KOKORO_TOKENIZER]};
/* Kitten: ein Modell pro Stufe enthält alle 8 Stimmen (voices.npz); jede Stimme ist ein eigener Eintrag auf denselben Dateien, ein weiterer Stimmenwechsel kostet 0 Byte. */
const kittenRepo={nano:hf('KittenML/kitten-tts-nano-0.8-int8','84781d74e29ee25217551556398b42f80593a813'),micro:hf('KittenML/kitten-tts-micro-0.8','1ccf72b2c2048fd17efac7de2fab32d10e225084'),mini:hf('KittenML/kitten-tts-mini-0.8','c02725660cea441db4c383af69f1f26f5cd00947')};
const KITTEN_TIER={nano:{tier:'fast',ramMB:250,speed:.8,model:['kitten_tts_nano_v0_8.onnx',24369971,'f7b0afcbee92870b32b8e0276d855b954dc25470c9f051b376ac7eee537c76fc'],voices:[3278902,'8aa7cee235abb0739cb51e6559685f65a4dacd95568833d05699b1633f519b3f']},
 micro:{tier:'fast',ramMB:250,speed:1,model:['kitten_tts_micro_v0_8.onnx',41384970,'95481626fee1ba70ce683e69c534fc7cb38433c46ce42d3abbeafb4b9f1a4123'],voices:[3278902,'112710c1be8ad0e967c190fb0fd95cbe5848ec4791b93209f20b28b7da20dac1']},
 mini:{tier:'balanced',ramMB:350,speed:1,model:['kitten_tts_mini_v0_8.onnx',78268016,'0f5bbae4fc4800c98dbc544a87ecfa79510de2fb8222db30d12e5bfe9177df91'],voices:[3278902,'40ad2638952b77b7b2f30127e2608e169fc69dd256b53bd8aaa3409a33193c42']}};
/* [Alias, Stimmenname in voices.npz, Geschlecht]; Bella gehört schon zum Register (ids kitten-nano/-micro/-mini). */
const KITTEN_VOICES=[
 ["Jasper","expr-voice-2-m","m","samples/kitten-mini-jasper.opus"],
 ["Luna","expr-voice-3-f","f","samples/kitten-mini-luna.opus"],
 ["Bruno","expr-voice-3-m","m","samples/kitten-mini-bruno.opus"],
 ["Rosie","expr-voice-4-f","f","samples/kitten-mini-rosie.opus"],
 ["Hugo","expr-voice-4-m","m","samples/kitten-mini-hugo.opus"],
 ["Kiki","expr-voice-5-f","f","samples/kitten-mini-kiki.opus"],
 ["Leo","expr-voice-5-m","m","samples/kitten-mini-leo.opus"],
];
const kittenRecord=([alias,voice,gender,sample],size)=>{const t=KITTEN_TIER[size],repo=kittenRepo[size];return {id:`kitten-${size}-${alias.toLowerCase()}`,name:`${alias} · Englisch (Kitten ${size})`,voiceURI:`notable:kitten-${size}:${alias.toLowerCase()}`,voiceId:'kitten:'+alias.toLowerCase(),family:'kitten',display:alias,variant:size,gender,lang:'en-US',languages:['en'],localService:true,default:false,license:'Kitten-TTS-Modell Apache-2.0',source:'https://huggingface.co/KittenML/kitten-tts-'+size+(size==='nano'?'-0.8-int8':'-0.8'),kind:'kitten',tier:t.tier,ramMB:t.ramMB,sampleRate:24000,voices:8,voice:{name:voice,speed:t.speed},sample,
 files:[{role:'model',url:repo+t.model[0],bytes:t.model[1],sha256:t.model[2]},{role:'voices',url:repo+'voices.npz',bytes:t.voices[0],sha256:t.voices[1]}]};};
/* Piper: [Schlüssel, Name, BCP-47, Qualität, Modell-Bytes, Modell-SHA-256, Config-Bytes, Config-SHA-256, Samplerate, idMap aus Config?, Datensatzlizenz, Lizenzklasse, Hörprobe]. Pfad = Schlüssel nach Piper-Schema. */
const PIPER_VOICES=[
 ["cs_CZ-jirka-medium","jirka","cs-CZ","medium",63201294,"cbd5c900acacc8e8cbecd64347abb8de39c00a9d3104bed06fee92e4f319efc8",5025,"fb38b1799b7354808227c065efa97b1ffa2b0cde59505babb56a36d35af9c637",22050,1,"CC0","ok","samples/piper-cs_CZ-jirka-medium.opus","cs/cs_CZ/jirka/medium"],
 ["cs_CZ-kasandra-medium","kasandra","cs-CZ","medium",63511038,"09d08aa23691ed2d53fb3db242cfe82b189adf9c1812dd5fe928b5789ed76df7",3232,"5039f9e49def4f4f8438db031868800a13bf4c6246b62afdb0947f4c5478770e",22050,1,"Creative Commons Attribution 4.0 International (CC BY 4.0)","attribution","samples/piper-cs_CZ-kasandra-medium.opus","cs/cs_CZ/kasandra/medium"],
 ["de_DE-kerstin-low","kerstin","de-DE","low",63104526,"d352a7641892cebf2903859af94e9ba81a141110215fe3943bcda7f7da401b7a",4158,"56e708556b7b9b7a53c4f8957e021421e69f11a600962bba554cffbe72cf2d47",16000,1,"CC0","ok","samples/piper-de_DE-kerstin-low.opus","de/de_DE/kerstin/low"],
 ["en_GB-alba-medium","alba","en-GB","medium",63201294,"401369c4a81d09fdd86c32c5c864440811dbdcc66466cde2d64f7133a66ad03b",4888,"aa965a2f02ecced632c2694e1fc72bbff6d65f265fab567ca945918c73dd89f4",22050,0,"https://creativecommons.org/licenses/by/4.0/","attribution","samples/piper-en_GB-alba-medium.opus","en/en_GB/alba/medium"],
 ["en_GB-cori-high","cori","en-GB","high",114219352,"470b4dd634c98f8a4850d7626ffc3dfc90774628eeef6605a6dd8f88f30a5903",4963,"9e7fb5b5671612c22f3c81cbe46c1ae87b031a4632bcb509e499dad6f1e2adec",22050,1,"public domain","ok","samples/piper-en_GB-cori-high.opus","en/en_GB/cori/high"],
 ["en_GB-cori-medium","cori","en-GB","medium",63531379,"1899f98e5fb8310154f3c2973f4b8a929ba7245e722b3d3a85680b833d95f10d",4966,"e262c16d7f192f69d4edd6b4ef8a5915379e67495fcc402f1ab15eeb33da3d36",22050,1,"public domain","ok","samples/piper-en_GB-cori-medium.opus","en/en_GB/cori/medium"],
 ["en_GB-jenny_dioco-medium","jenny_dioco","en-GB","medium",63201294,"469c630d209e139dd392a66bf4abde4ab86390a0269c1e47b4e5d7ce81526b01",4895,"a9a7a93a317c9a3cb6563e37eb057df9ef09c06188a8a4341b0fcb58cba54dd4",22050,0,"See URL","attribution","samples/piper-en_GB-jenny_dioco-medium.opus","en/en_GB/jenny_dioco/medium"],
 ["en_US-bryce-medium","bryce","en-US","medium",63531379,"dc9caa6c313199ffb5ac698b6e542fa6cba388aeaf2731e25262e33b9810aef1",4966,"7ceb1bc4af6d4e41b6d1edbb86c67e91e01eaa71f66db4cd0ae92ac704d415be",22050,1,"public domain","ok","samples/piper-en_US-bryce-medium.opus","en/en_US/bryce/medium"],
 ["en_US-joe-medium","joe","en-US","medium",63201294,"58afce0321b8d9c46d7cdf9c16500cc55a793b4220212dba6b70fb788b3baf06",4794,"3d6d5410b3795cb1950595247ef8f06190719e6fdbfa3a2356d8ec368e1aad33",22050,1,"CC0","ok","samples/piper-en_US-joe-medium.opus","en/en_US/joe/medium"],
 ["en_US-john-medium","john","en-US","medium",63531379,"789c6c875726e627ddee93d51d8727859abe9c091c3d141591f4b83c2072e988",4965,"af60f177b6b550f3d7a302720c0fb89e7f94a82b5dca464775ef63b1c69ba09a",22050,1,"public domain","ok","samples/piper-en_US-john-medium.opus","en/en_US/john/medium"],
 ["en_US-kathleen-low","kathleen","en-US","low",63104526,"87adf17f5326bc0782282147a8b9788406236245f0f9b0e68dacb651bc1de8b6",4169,"39ebab88416edce0f63781754651788620cb97b9bb73ddf3c01f28e29a648feb",16000,1,"CC0","ok","samples/piper-en_US-kathleen-low.opus","en/en_US/kathleen/low"],
 ["en_US-kristin-medium","kristin","en-US","medium",63531379,"5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4",4968,"5681426d4aead22195de70531eeeeddb46493cfaffc5764b2ea3db73428b651c",22050,1,"public domain","ok","samples/piper-en_US-kristin-medium.opus","en/en_US/kristin/medium"],
 ["en_US-ljspeech-high","ljspeech","en-US","high",114199011,"5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a",4970,"7e1f4634af596d83cca997fb7a931ba80b70f8a316a2655ee69c55365e0ace14",22050,1,"public domain","ok","samples/piper-en_US-ljspeech-high.opus","en/en_US/ljspeech/high"],
 ["en_US-ljspeech-medium","ljspeech","en-US","medium",63531379,"6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22",4972,"141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860",22050,1,"public domain","ok","samples/piper-en_US-ljspeech-medium.opus","en/en_US/ljspeech/medium"],
 ["en_US-mike-medium","mike","en-US","medium",63221984,"3157e69e2c580cab297483f4b301ee975a4590c17d35a9757e33347d0e90fae2",5439,"0a2538c0b1e06a6cab7c46b97c79abd5e6a34a6c05b74b9376874c7099d81dad",22050,1,"CC0","ok","samples/piper-en_US-mike-medium.opus","en/en_US/mike/medium"],
 ["en_US-norman-medium","norman","en-US","medium",63531379,"b9739443232a80a59c7d18810dd856899bf16a7964725f5ab81ea49b1351cb71",4968,"6c2db7f558a4a8deb9fe822583c1c5105f6c4e834dd0f9de8ad17a888ee9fe1d",22050,1,"public domain","ok","samples/piper-en_US-norman-medium.opus","en/en_US/norman/medium"],
 ["en_US-sam-medium","sam","en-US","medium",62950044,"56417b3b4afe8ec6bb4cabf06e17d67261fdd5bf334592abcfc80052fba11163",5040,"8c7fb47f19683b0b81037c5564f9a5ad4699a9da685e0e5da0a72fd3c3f5c1c4",22050,1,"https://www.apache.org/licenses/LICENSE-2.0.txt","ok","samples/piper-en_US-sam-medium.opus","en/en_US/sam/medium"],
 ["es_ES-carlfm-x_low","carlfm","es-ES","x_low",28130791,"d69677323a907cd4963f42b29c20a98b5d6bfa7f3e64df339915e4650c00d125",4159,"d9bdfa9ff01eb2bc9e62e7d2593939d1e4c4d8eb7cf75f972731539d12399966",16000,1,"Public domain","ok","samples/piper-es_ES-carlfm-x_low.opus","es/es_ES/carlfm/x_low"],
 ["es_ES-davefx-medium","davefx","es-ES","medium",63201294,"6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917",4817,"0e0dda87c732f6f38771ff274a6380d9252f327dca77aa2963d5fbdf9ec54842",22050,1,"CC0","ok","samples/piper-es_ES-davefx-medium.opus","es/es_ES/davefx/medium"],
 ["es_ES-mls_10246-low","mls_10246","es-ES","low",63104526,"3f9d76d2778778942297aab052aa7b2e67248d3f43614c889ee82901a230e197",4160,"a865944d7f6972af347263b0b8152466dabba3b78b8fe5a6985f7d3b19fd06a1",16000,1,"CC BY 4.0","attribution","samples/piper-es_ES-mls_10246-low.opus","es/es_ES/mls_10246/low"],
 ["es_ES-mls_9972-low","mls_9972","es-ES","low",63104526,"afdd61beb26d3aba18245c0352a8173e7f96196fbe4979e115590e8f775c95f0",4159,"32234a0701c480bb6ba62d4f05d0c03a95369f2133aa655370db1c00b2193340",16000,1,"CC BY 4.0","attribution","samples/piper-es_ES-mls_9972-low.opus","es/es_ES/mls_9972/low"],
 ["es_MX-ald-medium","ald","es-MX","medium",63201294,"019b3803293c93e34a206dd2e53a3889209a514e786fd7144f7b70196c579b63",4878,"5a71498158e04afc8099bfd019c7e87c68eb9d042505a2b1a87e5c1ac2b1a61d",22050,0,"http://unlicense.org","ok","samples/piper-es_MX-ald-medium.opus","es/es_MX/ald/medium"],
 ["es_MX-claude-high","claude","es-MX","high",63122309,"3ef40a71ea63852cd8ab7e6fa7d2ecdcfa67a0b47c9c48e3f10e02ee02083ea0",4963,"1afc81f703c0e4cb3b4d7c0dca096b8b54a98806807f0170cf5eb5557723c12d",22050,1,"apache-2.0","ok","samples/piper-es_MX-claude-high.opus","es/es_MX/claude/high"],
 ["fr_FR-gilles-low","gilles","fr-FR","low",63104526,"5cd711846720e261c2a176f6924c198a7424d0a75dd4b0a5357a5fb9cb739285",4158,"5a47cc0789e91267d17666bbec842dd92950669271a09023eb6970ee364cf88a",16000,1,"CC0","ok","samples/piper-fr_FR-gilles-low.opus","fr/fr_FR/gilles/low"],
 ["fr_FR-mls_1840-low","mls_1840","fr-FR","low",63104526,"dcea3d495b760f168179b6bd27c7daefa1d8304ce6ec48867e42bae7cb2e507a",4160,"294a643de0ae6a4a885d841d9b74470263efe35c81e7cf37dd43e2d663fbd8b3",16000,1,"CC BY 4.0","attribution","samples/piper-fr_FR-mls_1840-low.opus","fr/fr_FR/mls_1840/low"],
 ["fr_FR-siwis-low","siwis","fr-FR","low",28130791,"a7b7dcaf87229b32af8275cb1a719371234ea677bc0313d2289d5c50ab0ac53d",4157,"9722527d748c284f6dd7639c4b4e661853d4f7d4514079571f67d6a97a652b69",16000,1,"CC-BY 4.0","attribution","samples/piper-fr_FR-siwis-low.opus","fr/fr_FR/siwis/low"],
 ["fr_FR-siwis-medium","siwis","fr-FR","medium",63201294,"641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99",4875,"39479916c2db192b5ac9764daddd0c744d83e023ad890c6976c0633ae4df8959",22050,0,"CC-BY 4.0","attribution","samples/piper-fr_FR-siwis-medium.opus","fr/fr_FR/siwis/medium"],
 ["it_IT-serena-high","serena","it-IT","high",114204024,"7462fbdf03727fb4c0c161286ad538fe6436b7e4b1c3059ef52930032475955f",5252,"60597bac737a20766591fe24d1315df9a3811dc3509e69bc394cdee19eccbae7",22050,1,"CC-BY-4.0","attribution","samples/piper-it_IT-serena-high.opus","it/it_IT/serena/high"],
 ["it_IT-serena-medium","serena","it-IT","medium",63516051,"fe4e26b2c1236e2a44d2e295cad564d94a0d8b0a9fca1ccdfd70dd4af3116eb5",5254,"14cb4995874138b2792ae07753b5540942124761af9ae6609f9b520f28837881",22050,1,"CC-BY-4.0","attribution","samples/piper-it_IT-serena-medium.opus","it/it_IT/serena/medium"],
 ["nl_BE-nathalie-medium","nathalie","nl-BE","medium",63201294,"49cf48023861f9fd42e13a8632f068fee67d1ce244a6ee38f29595afbf0a6be4",4879,"4704af2736022e910a3f32672480d5530dd39da5c2bcc079f315f604166ff0de",22050,0,"CC0","ok","samples/piper-nl_BE-nathalie-medium.opus","nl/nl_BE/nathalie/medium"],
 ["nl_BE-nathalie-x_low","nathalie","nl-BE","x_low",20628813,"7d005d2d9b3db4326fc4a1ac86b61ab40252ccf97b76d527f4ffd76d4e3f7dbe",4163,"390d21992bd734a49c015fcd7027e4af7b2779f5867ff762e6453e323f554bd8",16000,1,"CC0","ok","samples/piper-nl_BE-nathalie-x_low.opus","nl/nl_BE/nathalie/x_low"],
 ["nl_BE-rdh-medium","rdh","nl-BE","medium",63221984,"59fcf2d6037e1c12386e3d2cf6721c727f286cfeec9db5617407d3bfb4c32559",5457,"83a5719c3cf138cc5fd4a9ad7d6752982a7fb5ccf94b6b6d4a9637bcee1b5d46",22050,1,"CC0 1.0 Universal","ok","samples/piper-nl_BE-rdh-medium.opus","nl/nl_BE/rdh/medium"],
 ["nl_BE-rdh-x_low","rdh","nl-BE","x_low",20628813,"fe43651248219b4e816e47d9708f2812f2a09af99470ed822113f3e913430d52",4158,"15724b7ef0247d566d9c2bac252c1b0b6ec9ceb7ccbb2c0a0d1ed57bf03b4f5d",16000,1,"CC0 1.0 Universal","ok","samples/piper-nl_BE-rdh-x_low.opus","nl/nl_BE/rdh/x_low"],
 ["nl_NL-mls_5809-low","mls_5809","nl-NL","low",63104526,"b7860ada7fa27e5e29b08e7531b0e0d74b3f0602e466a22ff95f59f80a0c4327",4165,"d2192a4ed90b26166243be2cef9d71bcc4fbbbaa9461c413050bac758fafc1c3",16000,1,"CC BY 4.0","attribution","samples/piper-nl_NL-mls_5809-low.opus","nl/nl_NL/mls_5809/low"],
 ["nl_NL-pim-medium","pim","nl-NL","medium",63516050,"403e58c3675c394f505c2428117bf34cc56e9542dcf6eadbdd3a84706c12e048",5037,"08b58456ca00cf77123826b1712758f99d5fd19ddfb7ec7da8e1a715b047f642",22050,1,"CC0","ok","samples/piper-nl_NL-pim-medium.opus","nl/nl_NL/pim/medium"],
 ["nl_NL-ronnie-medium","ronnie","nl-NL","medium",62950044,"ac9aba346d2088ed1ddea646a843ef97dc8e1514cc75e969c90a0c843bb5cbf5",5040,"4329a4deb198d119b7f7364173e388afb8efec9eca10e849f9394aa1a92bb7bc",22050,1,"CC0","ok","samples/piper-nl_NL-ronnie-medium.opus","nl/nl_NL/ronnie/medium"],
 ["pl_PL-darkman-medium","darkman","pl-PL","medium",63201294,"db505438a5364e8e2e0242c4324130a873ed660dfbe8d9689cef428ffb1b645f",4816,"70f999f11fa8ad13d3ef779041ee93c9f38be5abdbacdfad42449712fe91c81b",22050,1,"CC0","ok","samples/piper-pl_PL-darkman-medium.opus","pl/pl_PL/darkman/medium"],
 ["pl_PL-gosia-medium","gosia","pl-PL","medium",63201294,"38f66464240ed74f186e6b7dc13c6e3b22e023426299f25c2b3cc9dfa9373fbc",4814,"1aefb31a9d53ffe44a8163ff73ec833acb7a6253848f6bb0403d8a66f9c7510d",22050,1,"CC0","ok","samples/piper-pl_PL-gosia-medium.opus","pl/pl_PL/gosia/medium"],
 ["pl_PL-mc_speech-medium","mc_speech","pl-PL","medium",63201294,"a6b043358bc81e6c111a5140606a21959ce7f34969b8b7207f62869787cc3907",4961,"b8bb11228e15c505219846a88fdc129e93f57e774ed7f9bac263156d1aa3d324",22050,1,"CC0","ok","samples/piper-pl_PL-mc_speech-medium.opus","pl/pl_PL/mc_speech/medium"],
 ["pl_PL-mls_6892-low","mls_6892","pl-PL","low",63104526,"b572ab1a0f1d3b722b2a545e0b38834e6f932852cd0f11a44c022baa8f104c10",4157,"52f7b16a1590277028fce10a259c41d755c3d565c6f4eff9806e1c1d433ea7a2",16000,1,"CC BY 4.0","attribution","samples/piper-pl_PL-mls_6892-low.opus","pl/pl_PL/mls_6892/low"],
 ["pt_BR-cadu-medium","cadu","pt-BR","medium",62950044,"765f0809a6ea9035d4a6d0d008dbf8876e68b2dd32029312672fa8f405bdb535",5040,"5fe03aa3d4901880554905b12075713cd552598c8a350455a1ec73f8b4e6be19",22050,1,"CC0","ok","samples/piper-pt_BR-cadu-medium.opus","pt/pt_BR/cadu/medium"],
 ["pt_BR-edresson-low","edresson","pt-BR","low",63104526,"de4cecee38b30bb1a6378a337af605d59f0c377df702c6a6752870db8991cd84",4168,"f138992d2e777d1e3aa0bbb14c2d324307b0f342c1bcf20978765b3bea506c56",16000,1,"CC BY 4.0","attribution","samples/piper-pt_BR-edresson-low.opus","pt/pt_BR/edresson/low"],
 ["pt_BR-faber-medium","faber","pt-BR","medium",63201294,"858555e3a064209c57088fe6bd70c4c3dc54d03eaa00c45d5ecaf43a33f95aa7",4855,"7e694de195ae3fc36dd732c445eb04fb49b649854893cb5506b978f0d50a1d6f",22050,1,"CC0","ok","samples/piper-pt_BR-faber-medium.opus","pt/pt_BR/faber/medium"],
 ["pt_BR-jeff-medium","jeff","pt-BR","medium",62950044,"3a6f4c46355813c2b7bbc4d16b6d13d60ed72074b952a393baace82a7d0c94b5",5041,"7bf8145b572b36806f5ce0f1d3322b6711975bc7d0473e8d36fced4a9ec0030d",22050,1,"CC0","ok","samples/piper-pt_BR-jeff-medium.opus","pt/pt_BR/jeff/medium"],
 ["pt_PT-tugão-medium","tugão","pt-PT","medium",63201294,"223a7aaca69a155c61897e8ada7c3b13bc306e16c72dbb9c2fed733e2b0927d4",5026,"fe0918dfc0f1a89264a6eea4afe8e95d8e9fed3cc6c81b5c2f87fcb2b50c7320",22050,1,"CC0","ok","samples/piper-pt_PT-tugao-medium.opus","pt/pt_PT/tugão/medium"],
 ["ru_RU-denis-medium","denis","ru-RU","medium",63201294,"15fab56e11a097858ee115545d0f697fc2a316c41a291a5362349fb870411b0a",4823,"831c860dac0b5073eaa81610a0a638ec23d90a6cf8e5f871b4485c2cec3767c8",22050,1,"CC0","ok","samples/piper-ru_RU-denis-medium.opus","ru/ru_RU/denis/medium"],
 ["ru_RU-dmitri-medium","dmitri","ru-RU","medium",63201294,"f073356ebc4bd0f80c5af58df2953a5988bd5bdab1eb38635ce960b071fbefcb",4824,"667ef3117bc642c2892dff7690d8bdc8ca4228aeaa783b2dc1416df632855e0d",22050,1,"CC0","ok","samples/piper-ru_RU-dmitri-medium.opus","ru/ru_RU/dmitri/medium"],
 ["sv_SE-nst-medium","nst","sv-SE","medium",63104526,"df011f56825a59dd1efc080c38a65a1ef70407e60f63050e9246f43a3d7e471e",4157,"d45dd74cbb4eca58694bf04a97e243044092476f28a55ae26424f0653086980a",22050,1,"CC0","ok","samples/piper-sv_SE-nst-medium.opus","sv/sv_SE/nst/medium"],
 ["uk_UA-lada-x_low","lada","uk-UA","x_low",20628813,"f8d015d3fc19ea6bd8ac3ca1fd0c0fbac5054c609599ee73799235fd2cf5c786",4186,"2df74b622e78930e8a62432d1cc8380f79f34f02c8c58ebd68e6ccbc857d80aa",16000,1,"Apache 2.0","ok","samples/piper-uk_UA-lada-x_low.opus","uk/uk_UA/lada/x_low"],
 ["uk_UA-mykyta-high","mykyta","uk-UA","high",114204024,"081d253cd246d7d4d698c6dd147b74cad498dafd213527887a3a490519138243",4904,"b5db6b4efb02d4a0e8f128253fd64e82dfa72d1105e9060b0c6fd9610eec6a4f",22050,0,"Apache 2.0","ok","samples/piper-uk_UA-mykyta-high.opus","uk/uk_UA/mykyta/high"],
 ["uk_UA-oleksa-high","oleksa","uk-UA","high",114204024,"e5524d8d6b3685abd6daa616edae22c782b1eaa1541c0e5922183cf5f2d155b7",4904,"296374263ad11d2c6c187a9e4cedf72a5b7ba3ddfc438da5eb8bf32fda3ede42",22050,0,"Apache 2.0","ok","samples/piper-uk_UA-oleksa-high.opus","uk/uk_UA/oleksa/high"],
 ["uk_UA-tetiana-high","tetiana","uk-UA","high",114204024,"1206d8447b99632badeb63d6132241f76cf551874e5254eb8836db36aed7c85c",4905,"c96a051028976afc74269f73470651384deb6872431f890cad3b6424d09e812b",22050,0,"Apache 2.0","ok","samples/piper-uk_UA-tetiana-high.opus","uk/uk_UA/tetiana/high"],
 /* added 13.11.2026 from the retrained hub state (revision and bases: PIPER_RETRAINED below) */
 ["en_US-kathleen-medium","kathleen","en-US","medium",63221984,
  "173115e17ff8efb7aa895a4957fb0bccf7c6d9048d82f8c5821902a68f959cc3",
  5470,"912b873d778a72bdc09cc11352093d262d596a09fe91467fd818ff4c1c836231",22050,1,"CC0","ok",
  "samples/piper-en_US-kathleen-medium.opus","en/en_US/kathleen/medium"],
 ["nl_BE-flemishguy-medium","flemishguy","nl-BE","medium",63221984,
  "09bdb83402af60c587dbb672cbca7d60d5c7911e2105d41d5beb9532c2b5e2c4",
  5464,"3025f4b6b9737b352e3e89b1dc40916f7b55fda049b21e521a40585c7c877a91",22050,1,"CC0","ok",
  "samples/piper-nl_BE-flemishguy-medium.opus","nl/nl_BE/flemishguy/medium"],
 ["en_US-hifi_tts_92-medium","hifi_tts_92","en-US","medium",63221984,
  "14d19c09e5b08c9416ef856fd669118f91813b0772714e3d989adbd70f05ff91",
  5473,"b21f81aea9870e24198645738bd5b95591982ceece2d240fb8eddc59ed50d73f",22050,1,"CC BY 4.0","attribution",
  "samples/piper-en_US-hifi_tts_92-medium.opus","en/en_US/hifi_tts_92/medium"],
];
/* Piper voices that rhasspy retrained on free base models (hub commits 09.-13.11.2026, "Retrain voices from the rdh
 * and hifi_tts_92 bases"; hifi_tts_92 card: "Base model for finetuning, replacing lessac"). rdh = nl_BE, one
 * Flemish speaker, CC0; hifi_tts_92 = Hi-Fi TTS reader 92 (NVIDIA), CC BY 4.0. Value: [base, model bytes, model
 * SHA-256 (LFS oid), config bytes, config SHA-256 (hashed), dataset licence if the new card names another]. All are
 * Piper 1.5 configs (own id map, vowel_clusters), so idMap is always 'config'. Model AND config move to the new
 * revision together: the cache is keyed by URL, so an installed old pair is never mixed with the new one, it simply
 * counts as not installed; the old URLs stay in PIPER_VOICES and are listed in SUPERSEDED_PIPER_URLS for a later
 * cache cleanup. it_IT-paola and nl_NL-alex are retrained in models/voice-catalog.mjs (their proof is in
 * tests/reader-polish/voices/catalog-source.json). */
export const PIPER_REVISION_RETRAINED='6b9cfaacb4fb2e02a9621227e3c1a48bec9710c3';
const piperRetrained=hf('rhasspy/piper-voices',PIPER_REVISION_RETRAINED);
export const PIPER_RETRAINED={
 "cs_CZ-jirka-medium":['hifi_tts_92',63221984,'9bc0b76bb8f26e1d542bf7ed2ce8a6c764605a5f6edcc7663bd637d0b684c5d9',5465,
  '4486971d79354d2f6d376fdd74f90acc6beb4308ba64083cfb03765e2c25cec1'],
 "de_DE-thorsten-medium":['rdh',63221984,'fd270eb3d1ebf91d763f8a0f949b1b1bebdfefaea18c3aaf8577dd34536e064f',5460,
  'cf245c91668e74cb6716f38647ae3d6d9bac42965872596f65f9ab2b7d7221ed'],
 "en_GB-alba-medium":['hifi_tts_92',63221984,'1f9da809b6da1ef4190bb5dd6cce4f4af803274539e9cf9e0693085150bac3d7',5471,
  '6214603a0dd60e9dcd05502e23ef07fbe3d9af36d3189c8cc3eb129e1a099d6f'],
 "en_GB-cori-medium":['hifi_tts_92',63221984,'2e0a55e140de672aa19b182602b407607bd2e6c35fc6020c0b1516053c02e995',5471,
  'f89b01c5e483c75ce9085ff89c79446c1a95a1cb4a362f629dac3b5a4b5dde75','CC BY 4.0 (Hi-Fi TTS, NVIDIA)'],
 "en_GB-jenny_dioco-medium":['hifi_tts_92',63221984,
  '62ba183a504cfcd8816ec1b50ee856ed318ccc9dd22fd0bedd7d839c95dfa20e',5478,
  'e489b3990e455d6378f12dbb4afa11e8e692a0168f1ed8e5c285dd2f08547567'],
 "en_US-joe-medium":['rdh',63221984,'abf4b998e34045cbd00eaf050de2de620f81ded6eb8b85a24b022a1c2b3f08d2',5465,
  '7b5f0293c0bf5bda8e377be1696da84af798befeef31038e43beefc01fe858da'],
 "es_ES-davefx-medium":['rdh',63221984,'d2c9224e122321aac3c33343957fff4d0f465226cb74c66b0f520ca3f8c0dd07',5458,
  '531c4051502e1acbc10b42437f11679bfce9e3919e1796e51fabd73e01e7fd2e'],
 "fr_FR-siwis-medium":['hifi_tts_92',63221984,'b1d946fd68d0347155fa59bce0a018924abbef3c1561181db45ca463d83963ef',5458,
  'df814aa3dfedd00510a07144442cc0a220ff21e43d03c3b078444fc0be68fc37'],
 "nl_BE-nathalie-medium":['hifi_tts_92',63221984,
  '2f12aea027806c24a0e9fb00080d2ee4cb0954604cc74e2fcdfe40b5d1015a09',5462,
  '862b19c3386b929624169146c3811e643f22e942e15beb2895110af219d9c6fa'],
 "nl_NL-pim-medium":['rdh',63221984,'1e1ed370c3b60ca734e525bdcd1f05f71b42bfb0a15693f1e89c012d72052d2a',5461,
  '30e5689c492f27d9c6cb8e23de78087162d3205fa8e169c33fd80bd80cbb133b'],
 "nl_NL-ronnie-medium":['rdh',63221984,'c6b69203247c9ff9aaadf59ec51147fffb16bb2c2892eb92d5b75d2f9d096622',5464,
  '65561cb497fde442608abad1f4eb6d7193e53edbc9ad374a5ae9ee4914fe2586'],
 "pl_PL-darkman-medium":['rdh',63221984,'cf757ee307e3a7c23d5d8f69934deab51683d01c1c6be376d3e13146020f1530',5457,
  '0d98a67829a1b7ffbce7faacf4ea7bb7a7ce2ebc1598ad0289c0f6c1f352dbd0'],
 "pt_BR-cadu-medium":['rdh',63221984,'d5a662e3f606d5a49dd29ba9ce90c304ae45dd9543f8b0c773bcb0de282499de',5465,
  '9fa837b7c1237ea5978bcd7be38c130798e8faa064f754873bb4ce5fc498bd88'],
 "pt_BR-faber-medium":['hifi_tts_92',63221984,'75e913eb463db0b6ac7ddf68d3e4c9ac19ace36dc3b710a81039b448352b8ffc',5466,
  'fa8a8fecb01ae198bc416381e368d3206f85bad1449a0f11e1f6a9edf85a32f1'],
 "pt_BR-jeff-medium":['rdh',63221984,'82ddcdb01a0342f078bd89ce2815eda27185818d15e15f06fb9a72ac3bce94e1',5465,
  '078ea4e42a680ca3cb662a8929237c32e2c0d581f5363f2f55f09bc266497bf6'],
 "pt_PT-tugão-medium":['hifi_tts_92',63221984,'f90d87efaa88ba0d24018f7e74a0ea3feeddeb407bf46332322a3824e9451219',5466,
  'bfb193603c4f1454284bd1074060b0dd525f93b9d3e35bcffc1458ae7d48786e'],
 "ru_RU-denis-medium":['rdh',63221984,'879bc365cb14d1380e3f5ed6044162ccf54c99f6161871569b7f830aec3ce841',5464,
  'e4fb4ab60262d1ab802c8c39301976c4135e545bc834a33c6eedc1f764df3bd6'],
 "ru_RU-dmitri-medium":['hifi_tts_92',63221984,'9ed9941bac7373f2ec1be36627e0e71a349a59ca5522d4363fd50701db05193a',5465,
  'b7ed744f65ec73deb57fc8e419a5db5c0c5532026cf1cd21247f75937b6fbee2'],
 "en_US-kathleen-medium":['hifi_tts_92',63221984,
  '173115e17ff8efb7aa895a4957fb0bccf7c6d9048d82f8c5821902a68f959cc3',5470,
  '912b873d778a72bdc09cc11352093d262d596a09fe91467fd818ff4c1c836231'],
 "nl_BE-flemishguy-medium":['rdh',63221984,'09bdb83402af60c587dbb672cbca7d60d5c7911e2105d41d5beb9532c2b5e2c4',5464,
  '3025f4b6b9737b352e3e89b1dc40916f7b55fda049b21e521a40585c7c877a91'],
 "en_US-hifi_tts_92-medium":['scratch',63221984,'14d19c09e5b08c9416ef856fd669118f91813b0772714e3d989adbd70f05ff91',5473,
  'b21f81aea9870e24198645738bd5b95591982ceece2d240fb8eddc59ed50d73f'],
};
/* first added in the retrained state: there is no older revision of these files */
const PIPER_ADDED_RETRAINED=new Set(['en_US-kathleen-medium','nl_BE-flemishguy-medium','en_US-hifi_tts_92-medium']);
const PIPER_BASES={rdh:'Basis rdh (CC0)',hifi_tts_92:'Basis hifi_tts_92 (Hi-Fi TTS, NVIDIA, CC BY 4.0, Namensnennung)',
 scratch:'ohne Basismodell trainiert'};
/* Record of a retrained voice: same id, voiceURI and sample path, files at the retrained revision. folder = hub
   folder. */
export function retrainedPiper(record,key,folder){
 const entry=PIPER_RETRAINED[key];if(!entry)return record;
 const [base,mb,msha,cb,csha,dataset]=entry,at=piperRetrained+folder+'/'+key;
 const license=dataset?'Piper-Modell MIT · Datensatz '+dataset+' (Namensnennung)':record.license;
 return {...record,idMap:'config',released:'2026-11',license:license+' · '+PIPER_BASES[base],
  source:piperRetrained+folder+'/MODEL_CARD',retrained:{revision:PIPER_REVISION_RETRAINED,base},
  files:[{role:'model',url:at+'.onnx',bytes:mb,sha256:msha},{role:'config',url:at+'.onnx.json',bytes:cb,sha256:csha}]};
}
/* Display name of a Piper voice: 'eva_k' -> 'Eva', 'jenny_dioco' -> 'Jenny (Dioco)' (the CC BY dataset asks for the name Dioco in the interface), others capitalised. */
const piperName=name=>{const [first,...rest]=name.split('_'),cap=word=>word[0].toUpperCase()+word.slice(1);if(first==='jenny'&&rest[0]==='dioco')return 'Jenny (Dioco)';if(first==='ljspeech')return 'LJ Speech';if(first==='mls')return 'MLS '+rest.join(' ');if(first==='mc'&&rest[0]==='speech')return 'MC Speech';if(first==='hifi'&&rest[0]==='tts')return 'Hi-Fi TTS '+rest.slice(1).join(' ');return cap(first)+(rest.length&&rest[0].length>1?' '+rest.map(cap).join(' '):'');};
/* Readable dataset licence from the raw model-card field (URLs and long names folded); Jenny (Dioco) carries only 'See URL' on the card, its README  asks for the name Dioco. */
const licenseName=(raw,key)=>/jenny_dioco/.test(key)?'Jenny (Dioco)':/creativecommons\.org\/licenses\/by\/|Attribution 4\.0|CC[- ]BY[- ]4\.0/i.test(raw)?'CC BY 4.0':/CC0/i.test(raw)?'CC0':/apache/i.test(raw)?'Apache 2.0':/unlicense/i.test(raw)?'Unlicense':/public domain/i.test(raw)?'gemeinfrei (public domain)':raw;
const piperRecord=([key,name,lang,quality,mb,msha,cb,csha,rate,idMap,license,licenseClass,sample,folder])=>{const file=key,tier={x_low:'fast',low:'fast',medium:'balanced',high:'best'}[quality],q=quality.replace('_','');const lower=key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''),shown=piperName(name);return {id:'piper-'+lower,name:`${shown} · ${lang} (${quality})`,voiceURI:`notable:piper:${lower}`,voiceId:'piper:'+lower.replace(/-(x_low|low|medium|high)$/,''),family:'piper',display:shown,lang,languages:[lang.split('-')[0]],localService:true,default:false,kind:'piper',tier,ramMB:quality==='x_low'?300:400,ramMeasured:false,sampleRate:rate,voices:1,...(idMap?{idMap:'config'}:{}),license:'Piper-Modell MIT · Datensatz '+licenseName(license,key)+(licenseClass==='attribution'?' (Namensnennung)':''),source:piper+folder+'/MODEL_CARD',sample,
 files:[{role:'model',url:piper+folder+'/'+key+'.onnx',bytes:mb,sha256:msha},{role:'config',url:piper+folder+'/'+key+'.onnx.json',bytes:cb,sha256:csha}]};};
/* Release month (YYYY-MM) of the model weights, for the novelty display (three bars: up to 12 months old, two: up to 24, one: older; computed against today's date in the picker).
 * Sources: Kokoro v1.0 = upload of kokoro-v1_0.pth to hexgrad/Kokoro-82M on 2025-01-28; Kitten TTS v0.8 = creation of the three KittenML/kitten-tts-*-0.8 repos on 2026-02-19;
 * Piper = month in which the commit that added the .onnx file entered the git history of rhasspy/piper-voices (git log --diff-filter=A, pinned revision). Unknown = field stays empty (no guessing). */
export const RELEASED_FAMILY={kokoro:'2025-01',kitten:'2026-02'};
export const PIPER_RELEASED={
 "cs_CZ-jirka-medium":"2023-08",
 "cs_CZ-kasandra-medium":"2026-07",
 "de_DE-eva_k-x_low":"2023-06",
 "de_DE-kerstin-low":"2023-06",
 "de_DE-thorsten-high":"2023-08",
 "de_DE-thorsten-medium":"2023-06",
 "en_GB-alba-medium":"2023-06",
 "en_GB-cori-high":"2024-03",
 "en_GB-cori-medium":"2024-03",
 "en_GB-jenny_dioco-medium":"2023-06",
 "en_US-bryce-medium":"2024-05",
 "en_US-joe-medium":"2023-06",
 "en_US-john-medium":"2024-05",
 "en_US-kathleen-low":"2023-06",
 "en_US-kristin-medium":"2024-03",
 "en_US-ljspeech-high":"2024-03",
 "en_US-ljspeech-medium":"2024-03",
 "en_US-mike-medium":"2026-07",
 "en_US-norman-medium":"2024-05",
 "en_US-sam-medium":"2025-05",
 "es_ES-carlfm-x_low":"2023-06",
 "es_ES-davefx-medium":"2023-06",
 "es_ES-mls_10246-low":"2023-06",
 "es_ES-mls_9972-low":"2023-06",
 "es_MX-ald-medium":"2023-06",
 "es_MX-claude-high":"2024-03",
 "fr_FR-gilles-low":"2023-06",
 "fr_FR-mls_1840-low":"2023-06",
 "fr_FR-siwis-low":"2023-06",
 "fr_FR-siwis-medium":"2023-06",
 "it_IT-serena-high":"2026-08",
 "it_IT-serena-medium":"2026-08",
 "nl_BE-nathalie-medium":"2023-06",
 "nl_BE-nathalie-x_low":"2023-06",
 "nl_BE-rdh-medium":"2023-06",
 "nl_BE-rdh-x_low":"2023-06",
 "nl_NL-mls_5809-low":"2023-06",
 "nl_NL-pim-medium":"2025-04",
 "nl_NL-ronnie-medium":"2025-04",
 "pl_PL-darkman-medium":"2023-06",
 "pl_PL-gosia-medium":"2023-06",
 "pl_PL-mc_speech-medium":"2023-10",
 "pl_PL-mls_6892-low":"2023-06",
 "pt_BR-cadu-medium":"2025-04",
 "pt_BR-edresson-low":"2023-06",
 "pt_BR-faber-medium":"2023-06",
 "pt_BR-jeff-medium":"2025-04",
 "pt_PT-tugão-medium":"2023-08",
 "ru_RU-denis-medium":"2023-06",
 "ru_RU-dmitri-medium":"2023-06",
 "sv_SE-nst-medium":"2023-06",
 "uk_UA-lada-x_low":"2023-07",
 "uk_UA-mykyta-high":"2026-05",
 "uk_UA-oleksa-high":"2026-05",
 "uk_UA-tetiana-high":"2026-05"
};
const records=[];
for(const v of KOKORO_VOICES)for(const tier of ['fp32','q8'])records.push({...kokoroRecord(v,tier),released:RELEASED_FAMILY.kokoro});
records.push(KOKORO_DE_KERSTIN);
for(const v of KITTEN_VOICES)for(const size of ['nano','micro','mini'])records.push({...kittenRecord(v,size),released:RELEASED_FAMILY.kitten});
for(const v of PIPER_VOICES)records.push(retrainedPiper({...piperRecord(v),
 ...(PIPER_RELEASED[v[0]]?{released:PIPER_RELEASED[v[0]]}:{})},v[0],v[13]));
/* cached files of the former (lessac/ryan based) revision of every retrained voice: never used again by any record */
export const SUPERSEDED_PIPER_URLS=PIPER_VOICES.filter(v=>PIPER_RETRAINED[v[0]]&&!PIPER_ADDED_RETRAINED.has(v[0]))
 .flatMap(v=>[piper+v[13]+'/'+v[0]+'.onnx',piper+v[13]+'/'+v[0]+'.onnx.json']);
export const NEW_MODELS=Object.fromEntries(records.map(record=>[record.id,record]));
export const FAMILIES={kokoro:'Kokoro',kitten:'Kitten',piper:'Piper'};
