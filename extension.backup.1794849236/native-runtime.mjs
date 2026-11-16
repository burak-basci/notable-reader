// Explicit capability preference; never forwarded as native playback settings.
export const PRIVATE_ID='bbobdmpbadoijfffgfeefcenegbbjddd',PUBLIC_ID='hgkfghgifkifgmklfgglilnmjglojonm';
export const RUNTIME_KEY='notable.reader.runtime.v1',LOOPBACK_PERMISSION={origins:['http://127.0.0.1/*']};
export async function getRuntimeState(){
 const known=[PRIVATE_ID,PUBLIC_ID].includes(chrome.runtime.id),raw=(await chrome.storage.local.get(RUNTIME_KEY))[RUNTIME_KEY];
 const mode=['native','browser'].includes(raw?.mode)?raw.mode:chrome.runtime.id===PRIVATE_ID?'native':'browser';
 const nativePermissionGranted=known&&await chrome.permissions.contains(LOOPBACK_PERMISSION).catch(()=>false);
 return{mode,nativePermissionGranted,canSelectNative:known,nativeEnabled:known&&mode==='native'&&nativePermissionGranted};
}
export async function setRuntimeMode(mode){
 if(!['native','browser'].includes(mode))return{ok:false,code:'invalid'};
 const current=await getRuntimeState();if(mode==='native'&&!current.nativeEnabled&&!current.nativePermissionGranted)return{ok:false,code:'native_permission_required'};
 if(!current.canSelectNative)return{ok:false,code:'forbidden'};
 await chrome.storage.local.set({[RUNTIME_KEY]:{mode}});return{ok:true,runtime:await getRuntimeState()};
}
