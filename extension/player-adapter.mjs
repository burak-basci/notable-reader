// One transport adapter; the UI is the actual shared native player renderer.
import {mountPlayerSurface} from './player-surface.mjs';
import {createFormatting} from './formatting.mjs';
import {createAppearanceController} from './appearance.mjs';
import {errorText,catalogData} from './i18n.js';
const catalogPromise=catalogData;
const browserLanguage=()=>{const code=String(navigator.language||'').split('-')[0].toLowerCase();return ['de','en','fr','es','it','pt'].includes(code)?code:'de';};
const docCommands=new Set(['toggle','stop','restart','previousSection','nextSection','previousBlock','nextBlock','previousChapter','nextChapter','seekRelative','seekSection','seekChapter','seekProgress','export','exportDocument','openFocus','setOverlayVisible','downloadResult']);
const settingsCommands={overlayMode:'overlayMode',playerTheme:'playerTheme',speed:'speed',follow:'follow',followPosition:'followPosition',followMode:'followMode',followMargin:'followMargin',clickseek:'clickSeek',clickSeek:'clickSeek',autoShow:'autoShow',uiLanguage:'uiLanguage',formatLocale:'formatLocale',timeFormat:'timeFormat',language:'language',volume:'volume',mute:'muted',appearance:'appearance',pitch:'pitch',bass:'bass',treble:'treble',sectionPause:'sectionPause'};

export function nativePlayerState(status,context={}){
 const preferences=status?.settings||{},engine=status?.engine||{},connected=context.connected!==false&&!!status;
 const sourceGeneration=context.sourceGeneration||null;
 const sourceTarget=['source','file'].includes(context.targetContext?.type);
 const sourceBound=!sourceTarget||context.targetContext.bound===true&&context.targetContext.ready===true;
 const bound=sourceBound;
 const usable=connected&&context.targetContext?.supported!==false&&bound&&status?.ready===true;
 const initialSource=connected&&context.targetContext?.type==='source'&&context.targetContext.supported===true;
 const allowed=usable||initialSource,controls=Object.fromEntries(['canPreviousSection','canNextSection','canSeek','canExport','canCancelExport'].map(key=>[key,usable&&status?.controls?.[key]===true]));controls.canToggle=allowed&&status?.exportState?.state!=='running'&&(initialSource||status?.controls?.canToggle===true);
 let code=context.errorCode||(!bound&&sourceGeneration?'document_changed':null);
 const state={...preferences,uiLanguage:status?.uiLanguage||preferences.uiLanguage||browserLanguage(),formatLocale:status?.formatLocale||preferences.formatLocale||'auto',timeFormat:status?.timeFormat||preferences.timeFormat||'auto',appearance:status?.appearance||preferences.appearance,
  catalog:status?.catalog||engine.catalog||[],language:preferences.language||engine.language||'auto',activeLanguage:engine.activeLanguage,detectedLanguage:engine.detectedLanguage,voice:engine.voice,voiceLabel:engine.voiceLabel,
  playerTheme:preferences.playerTheme||status?.playerTheme||'system',volumeMax:engine.volumeMax===100?100:150,preferenceVersion:status?.preferenceVersion||0,playing:usable&&status?.playback?.playing===true,focusOpen:usable&&status?.sourceContext?.focusOpen===true,paused:usable&&status?.playback?.paused===true,loading:usable&&status?.playback?.loading===true&&status?.playback?.playing!==true&&status?.playback?.paused!==true,
  sectionCount:usable?status.sectionCount:0,sectionIndex:usable?status.sectionIndex:0,chapters:usable?status.chapters:[],chapterIndex:usable?status.chapterIndex:-1,
  elapsedSeconds:usable?status.elapsedSeconds:null,totalSeconds:usable?status.totalSeconds:null,remainingSeconds:usable?status.remainingSeconds:null,remainingEstimated:status?.remainingEstimated===true,progressFraction:usable?status.progressFraction:null,
  capabilities:status?.capabilities||{audioExport:true,documentExport:true},exportState:usable?status?.exportState||{state:'idle'}:{state:'idle'},controls,selectionAvailable:false,
  statusKey:code?code:!usable?'ready':status?.statusKey||(status.playback?.paused?'paused':status.playback?.playing?'playing':'ready'),statusKind:code?'error':usable?status?.statusKind||'info':'info',statusParams:usable?status?.statusParams||{}:{},status:code?errorText(code):undefined};
 if(code)state.status=errorText(code);
 return state;
}

export async function mountBoundPlayer({mount,variant='overlay',view='source',settingsMode='popover',settingsScope='all',getContext=()=>({}),appearanceController=null,onStatus=()=>{},onFailure=()=>{},onOpenFocus=null,onClose=()=>{},onLocalChange=()=>{},onKeyboardSettings=null,transport=null}={}){
 const locales=await catalogPromise;
 const send=transport||(async(message)=>{try{return await chrome.runtime.sendMessage(message)||{ok:false,code:'closed'};}catch{return {ok:false,code:'closed'};}});
 let latest=null,connected=false,localError=null,queue=Promise.resolve(),destroyed=false,uiAppearance=null;
 const appearance=appearanceController?{defaults:appearanceController.defaults,update(value){appearanceController.update(value);uiAppearance?.update(value);},snapshot(){return appearanceController.snapshot();}}:null;
 const context=()=>({view,connected,...getContext()});
 const surface=mountPlayerSurface({mount,variant,settingsMode,settingsScope,locales,formattingFactory:createFormatting,appearanceFactory:appearance?null:createAppearanceController,appearanceController:appearance,onClose,onSelection:()=>false,ownPage:true,onLocalChange,onKeyboardSettings,onCommand:(command,value)=>{void commandAction(command,value);}});
 if(appearance)uiAppearance=createAppearanceController({document,kind:'html',uiHost:surface.host,contentRoot:document.createElement('div')});
 let wasOffline=false;
 function update(status,options={}){
  if(destroyed)return;latest=status;connected=options.connected??!!status;
  if(options.clearError)localError=null;
  if(connected&&wasOffline)surface.shadow.querySelectorAll('button,input,select').forEach(node=>{node.disabled=false;});
  const state=nativePlayerState(status,{...context(),...options,errorCode:localError||options.errorCode});surface.update(state);
  const ctx=context(),isFile=ctx.targetContext?.type==='file';
  if(!connected){surface.shadow.querySelectorAll('button,input,select').forEach(node=>{if(!node.matches('.settingsToggle,.closeReader'))node.disabled=true;});}
  else{surface.refs.restart.disabled=state.exportState?.state==='running'||isFile&&!state.sectionCount;surface.refs.stop.disabled=state.exportState?.state==='running'||!state.sectionCount;}
  wasOffline=!connected;
 }
 function failed(code){localError=code||'invalid';update(latest,{connected});onFailure(localError);}
 async function apply(message){
  const result=await send(message);if(destroyed)return result;
  if(result.ok){localError=null;if(result.status){latest=result.status;connected=true;onStatus(result.status);}update(latest,{connected,clearError:true});}
  else failed(result.code);
  return result;
 }
 function commandAction(command,value){
  // Capture source identity at the user gesture, not later after queued work.
  const gesture={...context()},isFile=gesture.targetContext?.type==='file',fileFields=isFile?{fileContext:{instanceId:gesture.targetContext.instanceId,generation:gesture.targetContext.generation}}:{},generation=gesture.targetContext?.bound?gesture.targetContext.generation:null;
  const run=async()=>{
   if(destroyed)return;
   // openFocus is a real switch everywhere: from the focus tab it closes that tab and returns to the document tab.
   if(command==='openFocus')surface.closePopovers();
   if(command==='selection'){failed('unsupported');return;}
   if(command==='volume')return apply({type:'settings',...fileFields,values:{volume:value,...(value>0?{muted:false}:{})}});
   if(Object.hasOwn(settingsCommands,command))return apply({type:'settings',...fileFields,values:{[settingsCommands[command]]:value}});
   if(command==='voice')return apply({type:'settings',...fileFields,values:{language:value?.language,voice:value?.id}});
   const fields={...fileFields,...(Number.isInteger(gesture.tabId)?{tabId:gesture.tabId}:{}),...(generation&&docCommands.has(command)?{sourceGeneration:generation}:{})};
   return apply({type:'control',command,...(value===undefined?{}:{value}),...fields});
  };
  if(isFile&&['stop','cancelExport'].includes(command))return run();
  queue=queue.catch(()=>{}).then(run);return queue;
 }
 return {surface,update,command:commandAction,closePopovers:()=>surface.closePopovers(),destroy(){destroyed=true;surface.destroy();uiAppearance?.destroy();}};
}
