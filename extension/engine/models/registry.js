/* beNotable! Reader engine · model register · own code MIT.
 * The register stays the single source of truth in tools/reader/neural-models.js (pinned revisions, sizes, SHA-256, tiers, RAM);
 * the engine re-exports it so no second copy can drift. New or larger/smaller models = one record there (+ an adapter `kind` in worker/synth.js). */
export {MODELS,PLANNED_MODELS,TIERS,MODEL_CACHE,RUNTIME_ASSETS,KITTEN_SYMBOLS,modelBytes,modelByVoice,modelsOfTier,recommendTier} from '../../tools/reader/neural-models.js';
import {MODELS,modelBytes} from '../../tools/reader/neural-models.js';
/* Adapter kinds the worker can run. A register record with another kind is refused instead of silently failing late. */
export const SUPPORTED_KINDS=Object.freeze(['piper','kokoro','kitten','phonon','qwen3tts']);
/* Where the worker finds ORT and the phonemizer, relative to engine/worker/. One shared copy for the whole extension. */
export const RUNTIME_BASE='../../tools/reader/vendor/neural/';
export function getModel(id){
 const model=MODELS[id];
 if(!model)throw engineError('unknown-model','Unbekanntes Sprachmodell.');
 if(!SUPPORTED_KINDS.includes(model.kind))throw engineError('unsupported-kind','Dieses Sprachmodell wird von der Engine nicht unterstützt.');
 return model;
}
export function engineError(code,message){const error=new Error(message);error.code=code;return error;}
/* Public voice description: register record plus the download size; `installed` is added by the engine. */
export const voiceInfo=(model,installed)=>({id:model.id,name:model.name,voiceURI:model.voiceURI,lang:model.lang,languages:[...model.languages],tier:model.tier,kind:model.kind,bytes:modelBytes(model),ramMB:model.ramMB,experimental:model.experimental===true,needs:model.needs||null,measured:model.measured||null,sampleRate:model.sampleRate,license:model.license,source:model.source,installed});
