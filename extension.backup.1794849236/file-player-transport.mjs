// Own-file-page bridge only. Never sends file text or commands to the native reader.
import {validAppearance} from './reader-api.js';
import {uiLanguages,formatLocales,catalogReady} from './i18n.js';
await catalogReady;
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{16,64}$/i.test(value);
const ownUrl=()=>new URL(chrome.runtime.getURL('tools/reader/reader.html'));
export function isOwnFileUrl(value){try{const u=new URL(value),own=ownUrl();return u.protocol===own.protocol&&u.hostname===own.hostname&&[own.pathname,'/reader.html'].includes(u.pathname)&&!u.username&&!u.password;}catch{return false;}}
const codeMap={stale_generation:'document_changed',import_busy:'busy',unavailable:'document_unavailable',invalid_command:'invalid',invalid_value:'invalid'};
const codeFor=value=>codeMap[value]||(['document_changed','document_unavailable','tab_changed','protocol','ambiguous','activation_failed','premium_locked','premium_unavailable','busy','closed','invalid'].includes(value)?value:'invalid');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const copy=value=>structuredClone(value);
const commands=new Set(['toggle','stop','restart','previousSection','nextSection','seekSection','seekChapter','seekProgress','export','exportDocument','cancelExport','toggleTheme','openFocus','downloadResult']);
const settingsMap={speed:'speed',follow:'follow',clickSeek:'clickseek',uiLanguage:'uiLanguage',formatLocale:'formatLocale',timeFormat:'timeFormat',playerTheme:'playerTheme',language:'language',volume:'volume',muted:'mute',appearance:'appearance'};
export function statusFrom(snapshot){
 const s=snapshot.state||{},catalog=Array.isArray(s.catalog)?s.catalog:[],active=s.activeLanguage||s.language||'auto',settings={speed:s.speed,volume:s.volume,muted:s.muted===true,language:s.language||'auto',voices:{[active]:s.voice},follow:s.follow!==false,clickSeek:s.clickSeek!==false,uiLanguage:s.uiLanguage||'de',formatLocale:s.formatLocale||'auto',timeFormat:s.timeFormat||'auto',playerTheme:s.playerTheme||'system',autoShow:false,appearance:copy(s.appearance||{})};
 return {version:1,settings,appearance:settings.appearance,uiLanguage:settings.uiLanguage,catalog,engine:{ready:true,catalog,volumeMax:s.volumeMax===100?100:150,voice:s.voice||'',voiceLabel:s.voiceLabel||'',language:settings.language,activeLanguage:active,detectedLanguage:s.detectedLanguage,providers:[]},ready:snapshot.ready===true,sectionCount:snapshot.ready?s.sectionCount||0:0,sectionIndex:snapshot.ready?s.sectionIndex||0:0,chapters:snapshot.ready?s.chapters||[]:[],chapterIndex:snapshot.ready?s.chapterIndex??-1:-1,elapsedSeconds:s.elapsedSeconds,totalSeconds:s.totalSeconds,remainingSeconds:s.remainingSeconds,remainingEstimated:s.remainingEstimated,progressFraction:s.progressFraction,preferenceVersion:s.preferenceVersion||0,playback:{playing:s.playing===true,paused:s.paused===true},premium:s.premium||{enabled:false,status:'unavailable'},exportFormats:s.exportFormats,selectionAvailable:s.selectionAvailable===true,exportState:{...copy(s.exportState||{state:'idle'}),resultReady:snapshot.resultReady===true,filename:snapshot.filename||s.exportState?.filename||''},controls:{canToggle:snapshot.ready===true&&s.controls?.canToggle!==false,canPreviousSection:snapshot.ready===true,canNextSection:snapshot.ready===true,canSeek:snapshot.ready===true,canExport:snapshot.ready===true&&s.premium?.enabled===true,canCancelExport:s.exportState?.state==='running',...(Array.isArray(s.controls?.appearanceFields)?{appearanceFields:s.controls.appearanceFields}:{})},sourceContext:{bound:true,kind:'file',generation:snapshot.generation,overlayVisible:snapshot.visible===true},documentState:{state:snapshot.ready?'ready':'idle',generation:snapshot.generation},statusKey:s.statusKey||'ready',statusKind:s.statusKind||'info',statusParams:s.statusParams||{},components:{browserPlayer:true,localView:true},fileResultReady:snapshot.resultReady===true,fileResultFilename:snapshot.filename||s.exportState?.filename||'',premiumActivation:snapshot.premiumActivation||{state:'idle'}};
}
export class FilePlayerTransport{
 constructor(tabId){this.kind='file';this.tabId=tabId;this.instanceId=null;this.queue=Promise.resolve();}
 async resolve(expected=null){
  const tab=await chrome.tabs.get(this.tabId).catch(()=>null);if(!tab||!tab.active||!isOwnFileUrl(tab.url))fail('tab_changed');
  const matches=[];for(const view of chrome.extension.getViews({type:'tab'})){try{if(view.closed||!isOwnFileUrl(view.location.href))continue;const current=await view.chrome.tabs.getCurrent();if(current?.id!==this.tabId)continue;const bridge=view.notableFileApp?.bridge;if(bridge?.version===1&&uuid(bridge.instanceId))matches.push({view,bridge});}catch{}}
  if(matches.length!==1)fail(matches.length?'ambiguous':'document_unavailable');const found=matches[0],snapshot=copy(await found.bridge.getSnapshot());
  const latest=await chrome.tabs.get(this.tabId).catch(()=>null);if(!latest||!latest.active||latest.url!==tab.url||!isOwnFileUrl(found.view.location.href))fail('tab_changed');
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||!uuid(snapshot.generation)||typeof snapshot.ready!=='boolean'||typeof snapshot.visible!=='boolean'||!snapshot.state||typeof snapshot.state!=='object'||!Number.isSafeInteger(snapshot.state.sectionCount)||snapshot.state.sectionCount<0||snapshot.instanceId&&snapshot.instanceId!==found.bridge.instanceId)fail('protocol');
  if(this.instanceId===null)this.instanceId=found.bridge.instanceId;if(found.bridge.instanceId!==this.instanceId)fail('document_changed');
  if(expected&&(expected.instanceId!==found.bridge.instanceId||expected.generation!==snapshot.generation))fail('document_changed');
  return {...found,snapshot,binding:{instanceId:this.instanceId,generation:snapshot.generation}};
 }
 reply(snapshot){return {ok:true,status:statusFrom(snapshot),fileSnapshot:snapshot,targetContext:{type:'file',supported:true,bound:true,ready:snapshot.ready===true,generation:snapshot.generation,instanceId:this.instanceId},title:snapshot.title||''};}
 async snapshot(){try{return this.reply((await this.resolve()).snapshot);}catch(e){return{ok:false,code:e.code||'document_unavailable',targetContext:{type:'file',supported:true,bound:false,ready:false,generation:null,instanceId:this.instanceId}};}}
 validateSettings(values,state){
  if(!values||typeof values!=='object'||Array.isArray(values)||!Object.keys(values).length)fail('invalid');const result=[];
  for(const [key,value]of Object.entries(values)){
   if(key==='voice'){const lang=values.language||state.activeLanguage||state.language,entry=state.catalog?.find(g=>g.code===lang);if(typeof value!=='string'||!entry?.voices.some(v=>v.id===value))fail('invalid');result.push(['voice',{language:lang,id:value}]);continue;}
   if(!Object.hasOwn(settingsMap,key))fail('invalid');if(key==='language'&&Object.hasOwn(values,'voice'))continue;
   if(key==='speed'&&(!Number.isFinite(value)||value<.8||value>4||Math.abs(value*20-Math.round(value*20))>1e-6))fail('invalid');
   if(key==='volume'&&(!Number.isInteger(value)||value<0||value>150||value%5))fail('invalid');
   if(['muted','follow','clickSeek'].includes(key)&&typeof value!=='boolean')fail('invalid');
   if(key==='uiLanguage'&&!uiLanguages.some(l=>l.code===value)||key==='formatLocale'&&!formatLocales.includes(value)||key==='timeFormat'&&!['auto','12h','24h'].includes(value)||key==='playerTheme'&&!['system','light','dark'].includes(value))fail('invalid');
   if(key==='language'&&value!=='auto'&&!state.catalog?.some(g=>g.code===value))fail('invalid');if(key==='appearance'&&!validAppearance(value))fail('invalid');result.push([settingsMap[key],value]);
  }return result;
 }
 async send(message,expected){
  if(!message||typeof message!=='object'||Array.isArray(message))return{ok:false,code:'invalid'};if(message.type==='snapshot')return this.snapshot();
  let gesture;try{gesture=(await this.resolve(expected||message.fileContext)).binding;if(message.sourceGeneration!==undefined&&message.sourceGeneration!==gesture.generation)fail('document_changed');}catch(e){return{ok:false,code:e.code||'document_changed'};}
  const run=async()=>{try{
   let resolved=await this.resolve(gesture);const {bridge,snapshot}=resolved;let response;
   if(message.type==='settings'){
    const operations=this.validateSettings(message.values,snapshot.state);for(const [command,value]of operations){resolved=await this.resolve(gesture);response=await resolved.bridge.execute(command,copy(value),gesture.generation);if(response?.ok!==true)fail(codeFor(response?.code));}
   }else if(message.type==='control'){
    const {command,value}=message;if(command==='activatePremium'){if(typeof value!=='string'||!/^[A-Za-z0-9._-]{8,1800}$/.test(value))fail('activation_failed');response=await bridge.activate(value,gesture.generation);}
    else if(command==='setOverlayVisible'){if(typeof value!=='boolean')fail('invalid');response=await bridge.setVisible(value,gesture.generation);}
    else{if(!commands.has(command))fail('invalid');if(command==='export'&&!['mp3','wav'].includes(value)||command==='exportDocument'&&!['pdf','html'].includes(value))fail('invalid');if(['seekSection','seekChapter'].includes(command)&&(!Number.isSafeInteger(value)||value<0))fail('invalid');if(command==='seekProgress'&&(!Number.isFinite(value)||value<0||value>1))fail('invalid');response=await bridge.execute(command,copy(value),gesture.generation);}
    if(response?.ok!==true)fail(codeFor(response?.code));
   }else fail('invalid');
   return this.reply((await this.resolve(gesture)).snapshot);
  }catch(e){return{ok:false,code:e.code||'document_changed'};}};
  if(message.type==='control'&&['stop','cancelExport'].includes(message.command))return run();
  const next=this.queue.catch(()=>{}).then(run);this.queue=next.catch(()=>{});return next;
 }
}
