/* Public data-only model provenance; no text or telemetry endpoint. */
const kokoro='https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/';
const piper='https://huggingface.co/rhasspy/piper-voices/resolve/e7229f7d33a10e145e109b886d661984201ac3c4/de/de_DE/thorsten/high/';
export const MODEL_CACHE='notable-reader-neural-models-v1';
export const RUNTIME_ASSETS=['neural-worker.js','vendor/neural/ort/ort.wasm.min.mjs','vendor/neural/ort/ort-wasm-simd-threaded.mjs','vendor/neural/ort/ort-wasm-simd-threaded.wasm','vendor/neural/piper/piper_phonemize.mjs','vendor/neural/piper/piper_phonemize.wasm','vendor/neural/piper/piper_phonemize.data'];
export const MODELS={
 piper:{id:'piper',name:'Thorsten · Deutsch',voiceURI:'notable:piper:thorsten-high',lang:'de-DE',localService:true,default:false,license:'Piper-Modell MIT · Sprachdatensatz CC0',source:'https://huggingface.co/rhasspy/piper-voices/blob/main/de/de_DE/thorsten/high/MODEL_CARD',kind:'piper',
  files:[{role:'model',url:piper+'de_DE-thorsten-high.onnx',bytes:113895201,sha256:'9df1c43c61149ef9b39e618e2b861fbe41e1fcea9390b2dac62e8761573ea4f1'},{role:'config',url:piper+'de_DE-thorsten-high.onnx.json',bytes:4875,sha256:'6de734444e4c3f9e33b7ebe2746dbc19b71e85f613e79c65acf623200b99a76a'}]},
 kokoro:{id:'kokoro',name:'Bella · Englisch (Kokoro FP32)',voiceURI:'notable:kokoro:af_bella',lang:'en-US',localService:true,default:false,license:'Kokoro-Modell Apache-2.0',source:'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX',kind:'kokoro',
  files:[{role:'model',url:kokoro+'onnx/model.onnx',bytes:325532232,sha256:'8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb'},{role:'style',url:kokoro+'voices/af_bella.bin',bytes:522240,sha256:'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b'},{role:'tokenizer',url:kokoro+'tokenizer.json',bytes:3497,sha256:'77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34'}]}
};
