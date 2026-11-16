// Browser article → the existing native-shaped shell contract. No native fallback.
import {createBrowserGlobalTransport} from './browser-runtime.mjs';
const CHANNEL='notable-public-player';
const KNOWN_IDS=new Set(['bbobdmpbadoijfffgfeefcenegbbjddd','hgkfghgifkifgmklfgglilnmjglojonm']);
const SETTINGS={speed:'speed',volume:'volume',muted:'mute',voice:'voice',language:'language',follow:'follow',clickSeek:'clickseek',uiLanguage:'uiLanguage',formatLocale:'formatLocale',timeFormat:'timeFormat',playerTheme:'playerTheme',appearance:'appearance'};
const DOCUMENT=new Set(['toggle','stop','restart','previousSection','nextSection','seekSection','seekChapter','seekProgress','openFocus','export','exportDocument','cancelExport','resetBar','selection']);
const fail=code=>{throw Object.assign(Error(code),{code});};
export function isArticleUrl(value){try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&u.hostname!=='chromewebstore.google.com'&&!(u.hostname==='chrome.google.com'&&u.pathname.startsWith('/webstore'))&&!u.pathname.toLowerCase().endsWith('.pdf');}catch{return false;}}
export function articleNativeStatus(snapshot,base={}){
 const s=snapshot.state||{},catalog=s.catalog||[],active=s.activeLanguage||s.language||'auto',ready=snapshot.ready===true,settings={...base.settings,speed:s.speed,volume:s.volume,muted:s.muted===true,language:s.language||'auto',voices:{...(base.settings?.voices||{}),[active]:s.voice},follow:s.follow!==false,clickSeek:s.clickSeek!==false,autoShow:false,uiLanguage:s.uiLanguage||'de',formatLocale:s.formatLocale||'auto',timeFormat:s.timeFormat||'auto',playerTheme:s.playerTheme||'system',appearance:s.appearance};
 return {...base,version:1,settings,appearance:settings.appearance,uiLanguage:settings.uiLanguage,catalog,engine:{ready:true,catalog,volumeMax:100,voice:s.voice||'',voiceLabel:s.voiceLabel||'',language:settings.language,activeLanguage:active,detectedLanguage:s.detectedLanguage,providers:[]},ready,sectionCount:ready?s.sectionCount||0:0,sectionIndex:ready?s.sectionIndex||0:0,chapters:ready?s.chapters||[]:[],chapterIndex:ready?s.chapterIndex??-1:-1,elapsedSeconds:s.elapsedSeconds,totalSeconds:s.totalSeconds,remainingSeconds:s.remainingSeconds,remainingEstimated:s.remainingEstimated===true,progressFraction:s.progressFraction,preferenceVersion:s.preferenceVersion||0,playback:{playing:s.playing===true,paused:s.paused===true},premium:base.premium||{enabled:false,status:'free'},exportState:s.exportState||{state:'idle'},exportFormats:[],controls:{canToggle:ready,canPreviousSection:ready,canNextSection:ready,canSeek:ready,canExport:false,canCancelExport:false,appearanceFields:s.controls?.appearanceFields},sourceContext:{bound:true,kind:'html',generation:snapshot.generation,overlayVisible:snapshot.visible===true},documentState:{state:ready?'ready':'idle',generation:snapshot.generation},statusKey:s.statusKey||'ready',statusKind:s.statusKind||'info',statusParams:s.statusParams||{},components:{browserPlayer:true,localView:true},selectionAvailable:s.selectionAvailable===true};
}
export class ArticlePlayerTransport{
 constructor(tabId){this.tabId=tabId;this.kind='article';this.binding=null;this.url=null;this.queue=Promise.resolve();this.global=createBrowserGlobalTransport();this.disposed=false;}
 async current(allowInactive=false){if(this.disposed||!KNOWN_IDS.has(chrome.runtime.id))fail('forbidden');const tab=await chrome.tabs.get(this.tabId).catch(()=>null);if(!tab||!allowInactive&&!tab.active||!isArticleUrl(tab.url))fail('tab_changed');if(this.url===null)this.url=tab.url;if(tab.url!==this.url)fail('document_changed');return tab;}
 async query(){const tab=await this.current();let response;try{response=await chrome.tabs.sendMessage(this.tabId,{channel:CHANNEL,action:'snapshot'});}catch{return {tab,response:null};}await this.current();return{tab,response};}
 async reply(response,tab){const base=await this.global.snapshot();if(!base.ok)return base;const snapshot=response.snapshot;return{ok:true,status:articleNativeStatus(snapshot,base.status),articleSnapshot:snapshot,title:snapshot.title||tab.title||'',targetContext:{type:'source',supported:true,bound:true,ready:snapshot.ready===true,generation:snapshot.generation,instanceId:response.instanceId}};}
 async snapshot(){try{const {tab,response}=await this.query();if(!response?.ok||!response.snapshot){this.binding=null;const base=await this.global.snapshot();return{...base,title:tab.title||'',targetContext:{type:'source',supported:true,bound:false,ready:false,generation:null},...(base.ok?{status:{...base.status,ready:false,sectionCount:0,sourceContext:null,documentState:{state:'idle',generation:null}}}:{})};}
  if(typeof response.instanceId!=='string'||typeof response.snapshot.generation!=='string')fail('protocol');if(this.binding&&(this.binding.instanceId!==response.instanceId||this.binding.generation!==response.snapshot.generation))fail('document_changed');this.binding={instanceId:response.instanceId,generation:response.snapshot.generation};return this.reply(response,tab);
 }catch(error){return{ok:false,code:error.code||'unavailable',targetContext:{type:'source',supported:true,bound:false,ready:false,generation:null}};}}
 async attach(){await this.current();await chrome.scripting.executeScript({target:{tabId:this.tabId},files:['vendor/Readability.js','core.js','content-reader.js']});await this.current();this.binding=null;const result=await this.snapshot();if(!result.ok||!this.binding||result.status?.sourceContext?.overlayVisible!==true)fail('document_unavailable');return result;}
 async execute(command,value){const tab=await this.current();if(!this.binding)fail('document_unavailable');const binding={...this.binding};const response=await chrome.tabs.sendMessage(this.tabId,{channel:CHANNEL,action:'command',command,value,...binding});await this.current(response?.pending===true&&['openFocus','export','exportDocument'].includes(command));if(response?.ok!==true)fail(response?.code||'unavailable');if(response.snapshot?.generation!==binding.generation)fail('document_changed');return this.reply({...response,instanceId:binding.instanceId},tab);}
 async send(message,expectedBinding){
  if(message?.type==='snapshot')return this.snapshot();
  const expected=expectedBinding||this.binding&&{...this.binding},run=async()=>{try{
   await this.current();if(message.type==='settings'){
    if(expected&&(!this.binding||expected.instanceId!==this.binding.instanceId||expected.generation!==this.binding.generation))fail('document_changed');
    const values=message.values;if(!values||typeof values!=='object'||Array.isArray(values))fail('invalid');
    if(!this.binding)return this.global.send(message);
    for(const [key,value]of Object.entries(values)){
     if(key==='language'&&Object.hasOwn(values,'voice'))continue;if(!SETTINGS[key])fail('invalid');
     const selected=key==='voice'?{language:values.language||(await this.snapshot()).status?.engine.activeLanguage,id:typeof value==='string'?value:value?.id}:value;
     await this.execute(SETTINGS[key],selected);
    }return this.snapshot();
   }
   if(message.type!=='control')return this.global.send(message);
   const {command,value}=message;if(command==='activatePremium')return this.global.send(message);
   if(command==='setOverlayVisible'){
    if(typeof value!=='boolean')fail('invalid');if(value){await this.attach();return this.snapshot();}
    if(!this.binding)return this.snapshot();const tab=await this.current(),binding={...this.binding},response=await chrome.tabs.sendMessage(this.tabId,{channel:CHANNEL,action:'visible',value,...binding});await this.current();if(!response?.ok||response.snapshot?.generation!==binding.generation||response.snapshot?.visible!==value)fail('document_changed');return this.reply({...response,instanceId:binding.instanceId},tab);
   }
   if(!DOCUMENT.has(command))return this.global.send(message);
   if(!this.binding&&['toggle','restart','openFocus'].includes(command))await this.attach();
   if(expected&&this.binding&&(expected.instanceId!==this.binding.instanceId||expected.generation!==this.binding.generation)||message.sourceGeneration&&message.sourceGeneration!==this.binding?.generation)fail('document_changed');
   return this.execute(command,value);
  }catch(error){return{ok:false,code:error.code||'unavailable'};}};
  if(message?.type==='control'&&['stop','cancelExport'].includes(message.command))return run();const operation=this.queue.catch(()=>{}).then(run);this.queue=operation.catch(()=>{});return operation;
 }
 dispose(){this.disposed=true;this.global.dispose?.();}
}
