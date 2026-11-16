// Runtime choice stays latched to the current document until navigation.
import {getRuntimeState} from './native-runtime.mjs';
import {FilePlayerTransport,isOwnFileUrl} from './file-player-transport.mjs';
import {ArticlePlayerTransport} from './article-player-transport.mjs';
import {createBrowserGlobalTransport} from './browser-runtime.mjs';
const fail=code=>({ok:false,code});
export const runtimeBindingKey=id=>'notable.runtime.binding.'+id;
function nativeTransport(tabId){return{kind:'native',async send(value){try{return await chrome.runtime.sendMessage({...value,...(Number.isSafeInteger(tabId)&&value.tabId===undefined&&['snapshot','settings','control'].includes(value.type)?{tabId}:{})})||fail('closed');}catch{return fail('closed');}},snapshot(){return this.send({type:'snapshot'});},dispose(){}};}
export async function createRuntimeTransport(tabId){
 const runtime=await getRuntimeState();
 if(!Number.isSafeInteger(tabId))return runtime.mode==='native'?nativeTransport():createBrowserGlobalTransport();
 const tab=await chrome.tabs.get(tabId).catch(()=>null);if(!tab)return{kind:'unavailable',send:async()=>fail('tab_changed'),snapshot:async()=>fail('tab_changed'),dispose(){}};
 if(isOwnFileUrl(tab.url)){const file=new FilePlayerTransport(tabId);file.kind='file';file.dispose=()=>{};return file;}
 if(tab.url?.split(/[?#]/,1)[0]===chrome.runtime.getURL('focus.html'))return nativeTransport(tabId);
 const key=runtimeBindingKey(tabId),cached=(await chrome.storage.session.get(key))[key];let mode=cached?.url===tab.url&&['native','browser'].includes(cached.mode)?cached.mode:runtime.mode;
 // An existing isolated-world article owns its document, even after a mode change.
 try{const reply=await chrome.tabs.sendMessage(tabId,{channel:'notable-public-player',action:'snapshot'});if(reply?.ok&&reply.snapshot?.generation&&(reply.snapshot.visible||reply.snapshot.state?.playing||reply.snapshot.state?.paused))mode='browser';}catch{}
 await chrome.storage.session.set({[key]:{url:tab.url,mode}});
 if(mode==='native')return nativeTransport(tabId);
 try{const u=new URL(tab.url);if(/^https?:$/.test(u.protocol)&&!u.pathname.toLowerCase().endsWith('.pdf'))return new ArticlePlayerTransport(tabId);}catch{}
 const unavailable=createBrowserGlobalTransport(),snapshot=unavailable.snapshot.bind(unavailable);unavailable.snapshot=async()=>({...await snapshot(),targetContext:{type:'unsupported',supported:false,bound:false,ready:false,generation:null,code:'unsupported'}});const send=unavailable.send.bind(unavailable);unavailable.send=message=>message.type==='snapshot'?unavailable.snapshot():send(message);return unavailable;
}
