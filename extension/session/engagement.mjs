// Remove only obsolete Reader account/counter records, never settings, history or models.
const OBSOLETE_KEYS=Object.freeze(['notable.reader.premium.v1','notableEngagement']);
export async function clearLegacyProductData(api=globalThis.chrome||globalThis.browser){
 try{await api?.storage?.local?.remove(OBSOLETE_KEYS);}catch{}
 try{for(const key of OBSOLETE_KEYS)globalThis.localStorage?.removeItem(key);}catch{}
}
