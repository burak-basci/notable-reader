// One transport adapter; the UI is the actual shared native player renderer.
import {mountPlayerSurface} from './player-surface.mjs';
import {createFormatting} from './formatting.mjs';
import {createAppearanceController} from './appearance.mjs';
import {errorText} from './i18n.js';
const catalogPromise=fetch(new URL('./ui-locales.json',import.meta.url)).then(response=>{if(!response.ok)throw Error('Catalog unavailable');return response.json();});
const docCommands=new Set(['toggle','stop','restart','previousSection','nextSection','seekSection','seekChapter','seekProgress','export','exportDocument','openFocus','setOverlayVisible','downloadResult','selection']);
const settingsCommands={playerTheme:'playerTheme',speed:'speed',follow:'follow',clickseek:'clickSeek',clickSeek:'clickSeek',autoShow:'autoShow',uiLanguage:'uiLanguage',formatLocale:'formatLocale',timeFormat:'timeFormat',language:'language',volume:'volume',mute:'muted',appearance:'appearance'};

export function nativePlayerState(status,context={}){
 const preferences=status?.settings||{},engine=status?.engine||{},connected=context.connected!==false&&!!status;
 const sourceGeneration=context.sourceGeneration||null,current=status?.sourceContext?.generation||status?.documentState?.generation||null;
 const isFocus=context.view==='focus'||context.targetContext?.type==='focus';
 const sourceTarget=['source','file'].includes(context.targetContext?.type);
 const sourceBound=!sourceTarget||context.targetContext.bound===true&&context.targetContext.ready===true;
 const bound=sourceBound&&(!isFocus||!!sourceGeneration&&sourceGeneration===current&&context.contentReady!==false);
 const usable=connected&&context.targetContext?.supported!==false&&bound&&status?.ready===true;
 const initialSource=connected&&context.targetContext?.type==='source'&&context.targetContext.supported===true;
 const allowed=usable||initialSource,controls=Object.fromEntries(['canPreviousSection','canNextSection','canSeek','canExport','canCancelExport'].map(key=>[key,usable&&status?.controls?.[key]===true]));controls.canToggle=allowed&&status?.exportState?.state!=='running'&&(initialSource||status?.controls?.canToggle===true);
 let code=context.errorCode||(!bound&&sourceGeneration?'document_changed':null);
 const state={...preferences,uiLanguage:status?.uiLanguage||preferences.uiLanguage||'de',formatLocale:status?.formatLocale||preferences.formatLocale||'auto',timeFormat:status?.timeFormat||preferences.timeFormat||'auto',appearance:status?.appearance||preferences.appearance,
  catalog:status?.catalog||engine.catalog||[],language:preferences.language||engine.language||'auto',activeLanguage:engine.activeLanguage,detectedLanguage:engine.detectedLanguage,voice:engine.voice,voiceLabel:engine.voiceLabel,
  playerTheme:preferences.playerTheme||status?.playerTheme||'system',volumeMax:engine.volumeMax===100?100:150,preferenceVersion:status?.preferenceVersion||0,playing:usable&&status?.playback?.playing===true,paused:usable&&status?.playback?.paused===true,
  sectionCount:usable?status.sectionCount:0,sectionIndex:usable?status.sectionIndex:0,chapters:usable?status.chapters:[],chapterIndex:usable?status.chapterIndex:-1,
  elapsedSeconds:usable?status.elapsedSeconds:null,totalSeconds:usable?status.totalSeconds:null,remainingSeconds:usable?status.remainingSeconds:null,remainingEstimated:status?.remainingEstimated===true,progressFraction:usable?status.progressFraction:null,
  premium:status?.premium||{enabled:false},exportState:usable?status?.exportState||{state:'idle'}:{state:'idle'},controls:{...controls,...(Array.isArray(status?.controls?.appearanceFields)?{appearanceFields:status.controls.appearanceFields}:{})},selectionAvailable:status?.selectionAvailable===true,exportFormats:status?.exportFormats,
  statusKey:code?code:!usable?'ready':status?.statusKey||(status.playback?.paused?'paused':status.playback?.playing?'playing':'ready'),statusKind:code?'error':usable?status?.statusKind||'info':'info',statusParams:usable?status?.statusParams||{}:{},status:code?errorText(code):undefined};
 if(code)state.status=errorText(code);
 return state;
}

// Resolve only the already rendered own focus tab; never capture/rebind a URL.
export async function resolveBoundFocusView({tabId,sourceGeneration}={}){
 if(!Number.isInteger(tabId)||typeof sourceGeneration!=='string')return null;
 const expected=chrome.runtime.getURL('focus.html')+'#doc='+sourceGeneration;
 for(const view of chrome.extension.getViews({type:'tab'})){
  try{
   if(view.location.href!==expected||view.document.querySelector('#focus-document')?.dataset.generation!==sourceGeneration)continue;
   const current=await view.chrome.tabs.getCurrent();if(current?.id!==tabId)continue;
   return view;
  }catch{/* Closed/stale views cannot supply a source index. */}
 }
 return null;
}

export async function visibleBoundFocusSection(context={}){
 const view=await resolveBoundFocusView(context);if(!view)return null;
 for(const node of view.document.querySelectorAll('.focus-document-section')){
  const anchors=JSON.parse(node.dataset.nativeSections||'[]'),rect=node.getBoundingClientRect();
  if(Array.isArray(anchors)&&anchors.length&&anchors.every(n=>Number.isSafeInteger(n)&&n>=0)&&rect.bottom>0&&rect.top<view.innerHeight-170)return anchors[0];
 }
 return null;
}

export async function mountBoundPlayer({mount,variant='overlay',view='source',settingsMode='popover',settingsScope='all',getContext=()=>({}),appearanceController=null,onStatus=()=>{},onFailure=()=>{},onOpenFocus=null,onClose=()=>{},getVisibleSourceSection=null,onLocalChange=()=>{},transport=null}={}){
 const locales=await catalogPromise;
 const send=transport||(async(message)=>{try{return await chrome.runtime.sendMessage(message)||{ok:false,code:'closed'};}catch{return {ok:false,code:'closed'};}});
 let latest=null,connected=false,localError=null,queue=Promise.resolve(),destroyed=false,uiAppearance=null;
 const appearance=appearanceController?{defaults:appearanceController.defaults,update(value){appearanceController.update(value);uiAppearance?.update(value);},snapshot(){return appearanceController.snapshot();}}:null;
 const context=()=>({view,connected,...getContext()});
 const surface=mountPlayerSurface({mount,variant,settingsMode,settingsScope,locales,formattingFactory:createFormatting,appearanceFactory:appearance?null:createAppearanceController,appearanceController:appearance,onClose,onSelection:()=>false,onLocalChange,onCommand:(command,value)=>{void commandAction(command,value);}});
 if(appearance)uiAppearance=createAppearanceController({document,kind:'html',uiHost:surface.host,contentRoot:document.createElement('div')});
 let wasOffline=false;
 function update(status,options={}){
  if(destroyed)return;latest=status;connected=options.connected??!!status;
  if(options.clearError)localError=null;
  if(connected&&wasOffline)surface.shadow.querySelectorAll('button,input,select').forEach(node=>{node.disabled=false;});
  const state=nativePlayerState(status,{...context(),...options,errorCode:localError||options.errorCode});surface.update(state);
  const ctx=context(),isFocus=view==='focus'||ctx.targetContext?.type==='focus',isFile=ctx.targetContext?.type==='file';
  if(!connected){surface.shadow.querySelectorAll('button,input,select').forEach(node=>{if(!node.matches('.settingsToggle,.closeReader'))node.disabled=true;});}
  else{surface.refs.restart.disabled=state.exportState?.state==='running'||(isFocus||isFile)&&(!state.sectionCount||view==='focus'&&!Number.isSafeInteger(getVisibleSourceSection?.()));surface.refs.stop.disabled=state.exportState?.state==='running'||!state.sectionCount;}
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
  const gesture={...context()},isFile=gesture.targetContext?.type==='file',fileFields=isFile?{fileContext:{instanceId:gesture.targetContext.instanceId,generation:gesture.targetContext.generation}}:{},isFocus=gesture.view==='focus'||gesture.targetContext?.type==='focus',generation=isFocus?gesture.sourceGeneration||gesture.targetContext?.generation||null:gesture.targetContext?.bound?gesture.targetContext.generation:null;
  const run=async()=>{
   if(destroyed)return;
   if(command==='openFocus'&&onOpenFocus&&(view==='focus'||gesture.targetContext?.type==='focus')){surface.closePopovers();return onOpenFocus();}
   if(command==='selection'&&!latest?.selectionAvailable){failed('unsupported');return;}
   if(command==='volume')return apply({type:'settings',...fileFields,values:{volume:value,...(value>0?{muted:false}:{})}});
   if(Object.hasOwn(settingsCommands,command))return apply({type:'settings',...fileFields,values:{[settingsCommands[command]]:value}});
   if(command==='voice')return apply({type:'settings',...fileFields,values:{language:value?.language,voice:value?.id}});
   const fields={...fileFields,...(Number.isInteger(gesture.tabId)?{tabId:gesture.tabId}:{}),...(generation&&docCommands.has(command)?{sourceGeneration:generation}:{})};
   if(command==='restart'&&isFocus){
    const index=await getVisibleSourceSection?.(gesture);if(!Number.isSafeInteger(index)){failed('document_unavailable');return;}
    const moved=await apply({type:'control',command:'seekSection',value:index,...fields});
    if(moved?.ok&&(!moved.status?.playback?.playing||moved.status.playback.paused))return apply({type:'control',command:'toggle',...fields});
    return moved;
   }
   const selectedValue=command==='exportDocument'&&isFocus?{format:value,view:'focus'}:value;
   return apply({type:'control',command,...(selectedValue===undefined?{}:{value:selectedValue}),...fields});
  };
  if(isFile&&['stop','cancelExport'].includes(command))return run();
  queue=queue.catch(()=>{}).then(run);return queue;
 }
 return {surface,update,command:commandAction,closePopovers:()=>surface.closePopovers(),destroy(){destroyed=true;surface.destroy();uiAppearance?.destroy();}};
}
