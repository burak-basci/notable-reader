/* Model register of the extension · own code MIT.
 * The data (pinned Hugging Face revisions, exact bytes, SHA-256, licenses) stays in tools/reader/neural-models.js,
 * the single source of truth that the website build also uses. This module adds what the model management needs:
 * the shared-file lookup. No second copy of the data. */
import {MODELS,PLANNED_MODELS,TIERS,MODEL_CACHE,RUNTIME_ASSETS,KITTEN_SYMBOLS,modelBytes,modelByVoice,modelsOfTier,recommendTier} from '../tools/reader/neural-models.js';
export {MODELS,PLANNED_MODELS,TIERS,MODEL_CACHE,RUNTIME_ASSETS,KITTEN_SYMBOLS,modelBytes,modelByVoice,modelsOfTier,recommendTier};
/* Files only `id` needs, i.e. not used by another model in `installedIds`. */
export function exclusiveFiles(id,installedIds,registry=MODELS){
 const urls=m=>m.files.map(file=>file.url).sort().join('\n'),mine=urls(registry[id]);   // a sibling with the identical file set (Kitten voices) is the same installation and does not keep the files
 const keep=new Set([...installedIds].filter(other=>other!==id&&registry[other]&&urls(registry[other])!==mine).flatMap(other=>registry[other].files.map(file=>file.url)));
 return registry[id].files.filter(file=>!keep.has(file.url));
}
