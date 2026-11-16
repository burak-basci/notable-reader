import {getRuntimeState} from './native-runtime.mjs';
import {appearanceDefaults,validAppearance} from './reader-api.js';
import * as premium from './premium-browser.mjs';
const PREFS='notableReaderV2',fail=code=>({ok:false,code});
const defaults={speed:1,volume:100,muted:false,follow:true,clickSeek:true,autoShow:false,language:'auto',voices:{},uiLanguage:'de',formatLocale:'auto',timeFormat:'auto',playerTheme:'system',appearance:{...appearanceDefaults}};
function voiceCatalog(online=false){const groups=new Map();for(const v of globalThis.speechSynthesis?.getVoices?.()||[]){if(!online&&v.localService!==true)continue;const code=v.lang.toLowerCase().replace('_','-');if(!/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/.test(code))continue;const text=v.voiceURI+'|'+v.lang+'|'+v.name;let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}const id='system:'+text.length+'-'+(hash>>>0).toString(16);if(!groups.has(code))groups.set(code,{code,label:code,voices:[]});groups.get(code).voices.push({id,label:v.name,note:v.localService?'Lokal auf dem Gerät':'Online · ausdrücklich freigegeben'});}return [...groups.values()];}
export function createBrowserGlobalTransport(){
 let revision=0;
 return{kind:'browser-global',async snapshot(){
  const saved=(await chrome.storage.local.get(PREFS))[PREFS]||{},runtime=await getRuntimeState();
  const settings={...defaults,...saved,speed:saved.rate??saved.speed??1,volume:Number.isFinite(saved.volume)?Math.round(saved.volume*100):100,appearance:{...appearanceDefaults,...saved.appearance},runtimeMode:runtime.mode};
  const catalog=voiceCatalog(saved.online===true),wanted=settings.language==='auto'?(globalThis.navigator?.language||'de'):settings.language,group=catalog.find(g=>g.voices.some(v=>v.id===saved.voice))||catalog.find(g=>g.code.startsWith(wanted.split('-')[0]))||catalog[0],voice=group?.voices.find(v=>v.id===saved.voice)||group?.voices[0];settings.voices={...(settings.voices||{}),...(group&&voice?{[group.code]:voice.id}:{})};
  const p=await premium.getStatus();return{ok:true,runtime,status:{version:1,productVersion:chrome.runtime.getManifest().version,ready:false,settings,appearance:settings.appearance,uiLanguage:settings.uiLanguage,catalog,engine:{ready:true,catalog,volumeMax:100,voice:voice?.id||'',voiceLabel:voice?.label||'',activeLanguage:group?.code||'auto'},playback:{playing:false,paused:false},sectionCount:0,sectionIndex:0,chapters:[],chapterIndex:-1,preferenceVersion:revision,premium:p,exportState:{state:'idle'},controls:{canToggle:false,appearanceFields:Object.keys(appearanceDefaults).filter(key=>!['focus','hidePageNumbers'].includes(key))},components:{browserPlayer:true,localView:true},statusKey:'ready',statusKind:'info',premiumActivation:{state:'idle'}}};
 },async send(message){
  if(message.type==='snapshot')return this.snapshot();
  if(message.type==='settings'){
   const values=message.values;if(!values||typeof values!=='object'||Array.isArray(values)||!Object.keys(values).length)return fail('invalid');
   const keys=['speed','volume','muted','follow','clickSeek','uiLanguage','formatLocale','timeFormat','playerTheme','appearance','language','voice'];if(Object.keys(values).some(k=>!keys.includes(k)))return fail('unsupported');
   if(values.speed!==undefined&&(!Number.isFinite(values.speed)||values.speed<.8||values.speed>4)||values.volume!==undefined&&(!Number.isInteger(values.volume)||values.volume<0||values.volume>100)||['muted','follow','clickSeek'].some(k=>values[k]!==undefined&&typeof values[k]!=='boolean')||values.appearance!==undefined&&!validAppearance(values.appearance))return fail('invalid');
   const catalog=await fetch(chrome.runtime.getURL('ui-locales.json')).then(r=>r.json());
   if(values.uiLanguage!==undefined&&!catalog.languages.some(l=>l.code===values.uiLanguage)||values.formatLocale!==undefined&&!catalog.formatLocales.includes(values.formatLocale)||values.timeFormat!==undefined&&!['auto','12h','24h'].includes(values.timeFormat)||values.playerTheme!==undefined&&!['system','light','dark'].includes(values.playerTheme))return fail('invalid');
   const old=(await chrome.storage.local.get(PREFS))[PREFS]||{},voices=voiceCatalog(old.online===true);if(values.language!==undefined&&values.language!=='auto'&&!voices.some(g=>g.code===values.language))return fail('invalid');const selectedVoice=typeof values.voice==='object'?values.voice?.id:values.voice;if(values.voice!==undefined&&!voices.some(g=>g.voices.some(v=>v.id===selectedVoice)))return fail('invalid');const next={...old,...values};if(values.voice!==undefined)next.voice=selectedVoice;if(values.speed!==undefined){next.rate=values.speed;delete next.speed;}if(values.volume!==undefined)next.volume=values.volume/100;if(values.appearance)next.appearance={...appearanceDefaults,...old.appearance,...values.appearance};await chrome.storage.local.set({[PREFS]:next});revision++;return this.snapshot();
  }
  if(message.type==='control'&&message.command==='toggleTheme'){const current=await this.snapshot(),mode=current.status.settings.appearance.mode,dark=mode==='dark'||mode==='auto'&&globalThis.matchMedia?.('(prefers-color-scheme:dark)').matches;return this.send({type:'settings',values:{appearance:{mode:dark?'light':'dark'}}});}
  if(message.type==='control'&&message.command==='activatePremium'){try{await premium.activate(message.value);return this.snapshot();}catch(e){return fail(e.code||'activation_failed');}}
  return fail('unsupported');
 },dispose(){}};
}
