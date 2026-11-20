import {authorizedFrame,installFrameEvents,withTimeout} from './frame-session.mjs';
import {registerExplainBroker} from './explain/broker.mjs';
import {handleWorkflowRequest, handleWorkflowMessage, handleReadingHistory, installWorkflowEvents, routeSession, releasePlayback} from './workflow-api.mjs';
import * as readerAPI from './engine-api.js';
import {FREE_CAPABILITIES} from './premium-browser.mjs';
import {clearLegacyProductData} from './session/engagement.mjs';
import {product} from './product-config.js';
import {marksFrom} from './session/mark-settings.mjs';
import {FIELDS, defaults as configDefaults, loadConfig, keyboardOff, cleanKeyboard, CONFIG_KEY, GENERATION_ID, validSettingsPatch} from './config.mjs';
import {cleanStyle} from './session/mark-style.mjs';
import {cleanOverlayTheme} from './session/overlay-theme.mjs';
import {handleFileMessage} from './session/settings-file.mjs';
import {handleInstalled, registerUninstallPage} from './lifecycle.mjs';
import {t, errorText, setUiLanguage, uiLanguages, formatLocales, catalogReady} from './i18n.js';
import {MODELS,modelByVoice} from './models/registry.js';
import {ERROR_STATUS_KEYS} from './engine/error-keys.mjs';

// Cached results contain technical codes only, never document URLs or titles.
const operations = new Map();
const running = new Map();
const pages = new Map(['popup.html', 'help.html','tools/reader/reader.html','sidebar.html','library/library.html'].map(name => [chrome.runtime.getURL(name), name]));
// Unlike manifest.version this identifies the JS that is actually executing. An unpacked
// update can leave Chromium's persisted worker on older compiled code until a real reload.
const RUNTIME_BUILD = 'reader-2.5.0-rc5-20261115.1';
installFrameEvents();
globalThis.notableRuntimeBuild = RUNTIME_BUILD;
let actionLanguage;
// A failed catalog fetch must not disable the worker: texts then fall back to their keys. Loaded on first use only
// (a worker that wakes for a tab or frame event does not parse 400 KB of texts).
const languageCodes = new Set();
const catalogLoaded = () => catalogReady.then(() => {for (const item of uiLanguages) languageCodes.add(item.code);}, () => {});
const generation=value=>typeof value==='string'&&GENERATION_ID.test(value)?value:null;
const boundCommands=new Set(['toggle','restart','stop','previousSection','nextSection','previousBlock','nextBlock','previousChapter','nextChapter','seekRelative','seekProgress','seekSection','seekChapter','export','exportDocument','openFocus','setOverlayVisible','prepare',
  'voiceCardGet','voiceCardClose','voiceCardKeep']);
const statusKeys=new Set(['ready','preparing','computing','computing_on','playing','paused','stopped','completed','reader_error','export_running','export_complete','export_cancelled','save_failed','prepare_failed','offline_download','offline_unreachable','gpu_missing','jspi_missing','gpu_failed','export_failed','document_unavailable','document_changed','document_too_large','document_images_unavailable','document_prepare_failed','document_export_running','document_export_complete','document_export_failed','document_export_cancelled','document_rasterized','appearance_figures_unavailable',
  'voice_downloading','voice_missing',...ERROR_STATUS_KEYS]);
const exactKeys=(value,required,optional=[])=>required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
function cleanSource(value,documentGeneration){return value?.bound===true&&['html','pdf'].includes(value.kind)&&generation(value.generation)&&value.generation===documentGeneration?{bound:true,kind:value.kind,generation:value.generation,overlayVisible:typeof value.overlayVisible==='boolean'?value.overlayVisible:null,overlayPending:value.overlayPending===true,focusOpen:value.focusOpen===true,...(Number.isSafeInteger(value.tabId)&&value.tabId>=0?{tabId:value.tabId}:{})}:null;}
const errorCodes = new Set(['unavailable','timeout','busy','request_conflict','unsupported','ambiguous','tab_changed','browser_unavailable','bridge_failed','prepare_failed','pdf_viewer','save_failed','closed','forbidden','protocol','invalid','export_failed','export_busy','export_unavailable','document_unavailable','document_failed','document_too_large','figure_unavailable','document_changed','document_images_unavailable','document_prepare_failed','document_export_failed','embedded_permission_required','page_access_required','file_access_required','private_window',
  'no_readable_text']);
// Coded frame/browser errors keep their code; anything unknown stays 'invalid'.
const failure = error => {
  const wrapped = error?.code ? readerAPI.readerError(error) : error;
  const code = wrapped instanceof readerAPI.ReaderError && errorCodes.has(wrapped.code) ? wrapped.code : 'invalid';
  // A PDF in the browser viewer: callers can offer the file view for exactly this address.
  const pdf = code === 'pdf_viewer' && typeof wrapped.pdf?.url === 'string' ? {pdf: {url: wrapped.pdf.url}} : {};
  const access = wrapped.access, frameAccess = code === 'embedded_permission_required' && access
    ? {frameAccess: {origins: access.origins, needsNavigation: access.needsNavigation}} : {};
  return {ok:false,code,message:errorText(code),...pdf,...frameAccess};
};
const errorFor = code => failure(new readerAPI.ReaderError(code));

const text = (value, limit = 120) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0,limit) : '';
const voiceId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(value);
/* The voice card and the download line of the bar (session snapshot), so popup and side panel can show the same
   offer: only registered voices, shipped samples and plain numbers pass. */
const cleanVoiceView = value => {
  const model = typeof value?.id === 'string' ? MODELS[value.id] : null;
  if (!model || model.experimental) return null;
  const sample = typeof value.sample === 'string' && /^samples\/[\w.-]{1,120}\.opus$/.test(value.sample) ? value.sample : '';
  return {id: model.id, name: text(value.name), mb: Number.isFinite(value.mb) && value.mb >= 0 ? Math.round(value.mb) : 0, sample};
};
function cleanVoiceCard(value) {
  const primary = cleanVoiceView(value?.primary);
  if (!primary || !['better', 'none'].includes(value.reason)) return null;
  const smaller = cleanVoiceView(value.smaller), downloading = cleanVoiceView({id: value.downloading})?.id || '';
  return {reason: value.reason, primary, smaller, downloading};
}
function cleanVoiceDownload(value) {
  const view = cleanVoiceView(value);
  return view && {...view, percent: Number.isFinite(value.percent) ? Math.max(0, Math.min(100, Math.round(value.percent))) : 0};
}
function cleanStatus(value) {
  return cleanStatusBase(value);
}
function cleanStatusBase(value) {
  const settings = value?.settings || {}, engine = value?.engine || {};
  const catalog = (Array.isArray(engine.catalog) ? engine.catalog : Array.isArray(value?.catalog) ? value.catalog : []).slice(0,96).filter(item => typeof item?.code === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(item.code)).map(item => ({code:item.code,label:text(item.label),default:voiceId(item.default) ? item.default : '',voices:(Array.isArray(item.voices) ? item.voices : []).slice(0,256).filter(voice => voiceId(voice?.id)).map(voice => ({id:voice.id,label:text(voice.label),engine:text(voice.engine,40),note:text(voice.note,200),...(['fast','balanced','best'].includes(voice.tier)?{tier:voice.tier}:{}),...(typeof voice.installed==='boolean'?{installed:voice.installed}:{}),...(Number.isFinite(voice.mb)&&voice.mb>0&&voice.mb<5000?{mb:Math.round(voice.mb)}:{}),...(Number.isFinite(voice.progress)&&voice.progress>=0&&voice.progress<=100?{progress:Math.round(voice.progress)}:{}),...(voice.queued===true?{queued:true}:{}),...(voice.recommended===true?{recommended:true}:{})}))}));
  // Without a stored choice (no bar opened yet) the browser language decides, English when it is not offered.
  const browserLanguage = String(globalThis.navigator?.language || '').split('-')[0].toLowerCase();
  const selectedUiLanguage = languageCodes.has(settings.uiLanguage) ? settings.uiLanguage : languageCodes.has(value?.uiLanguage) ? value.uiLanguage : languageCodes.has(browserLanguage) ? browserLanguage : 'en';
  setUiLanguage(selectedUiLanguage);
  if (actionLanguage !== selectedUiLanguage) {
    actionLanguage = selectedUiLanguage;
    void retitleActions(selectedUiLanguage).catch(()=>{});
  }
  const exported = value?.exportState || {};
  const playback=value?.playback || {};
  const number=(key)=>Number.isFinite(value?.[key] ?? playback[key]) && (value?.[key] ?? playback[key])>=0 ? (value?.[key] ?? playback[key]) : null;
  const count=Number.isSafeInteger(value?.sectionCount ?? playback.sectionCount) && (value?.sectionCount ?? playback.sectionCount)>=0 ? (value?.sectionCount ?? playback.sectionCount) : 0;
  const sectionIndex=Number.isSafeInteger(value?.sectionIndex ?? playback.sectionIndex) ? Math.max(0,Math.min(Math.max(0,count-1),value?.sectionIndex ?? playback.sectionIndex)) : 0;
  const chapters=(Array.isArray(value?.chapters)?value.chapters:[]).filter(item=>typeof item?.label==='string' && Number.isSafeInteger(item.sectionIndex) && item.sectionIndex>=0 && item.sectionIndex<count).map(item=>({label:text(item.label,160),sectionIndex:item.sectionIndex,level:Number.isSafeInteger(item.level)?Math.max(1,Math.min(6,item.level)):1,...(Number.isSafeInteger(item.page) && item.page>=0 ? {page:item.page}:{})}));
  const chapterIndex=Number.isSafeInteger(value?.chapterIndex) && value.chapterIndex>=0 && value.chapterIndex<chapters.length ? value.chapterIndex : -1;
  const ready=value?.ready===true && count>0;
  const controls=Object.fromEntries(['canToggle','canPreviousSection','canNextSection','canSeek','canExport','canCancelExport'].map(key=>[key,value?.controls?.[key]===true]));
  return {
    sourceTitle:text(value?.sourceTitle,300),
    sourceContext:cleanSource(value?.sourceContext,generation(value?.documentState?.generation)),
    playerTheme:['system','light','dark'].includes(settings.playerTheme??value?.playerTheme)?settings.playerTheme??value.playerTheme:'system',
    statusKey:statusKeys.has(value?.statusKey)?value.statusKey:value?.statusKind==='error'?'reader_error':'ready',statusKind:value?.statusKind==='error'?'error':'info',
    statusParams:Object.fromEntries(['completed','total','current','count','percent','mb'].filter(key=>Number.isFinite(value?.statusParams?.[key])&&value.statusParams[key]>=0).map(key=>[key,value.statusParams[key]])),
    selectionAvailable:value?.selectionAvailable===true,
    appearance:readerAPI.cleanAppearance(settings.appearance ?? value?.appearance),
    documentState:{state:['idle','loading','ready','error'].includes(value?.documentState?.state)?value.documentState.state:'idle',errorKey:errorCodes.has(value?.documentState?.errorKey)?value.documentState.errorKey:'',sectionCount:Number.isSafeInteger(value?.documentState?.sectionCount)?Math.max(0,value.documentState.sectionCount):0,imageCount:Number.isSafeInteger(value?.documentState?.imageCount)?Math.max(0,value.documentState.imageCount):0,generation:generation(value?.documentState?.generation)},
    ready,controls,chapters,chapterIndex,sectionIndex,sectionCount:count,currentSelection:{sectionIndex,sectionCount:count,chapterIndex},
    elapsedSeconds:number('elapsedSeconds'),totalSeconds:number('totalSeconds'),remainingSeconds:number('remainingSeconds'),progressFraction:number('progressFraction')===null?null:Math.min(1,number('progressFraction')),remainingEstimated:(value?.remainingEstimated ?? playback.remainingEstimated)===true,
    version:1,uiLanguage:selectedUiLanguage,uiLanguages:[...languageCodes],catalog,
    formatLocale:formatLocales.includes(settings.formatLocale ?? value?.formatLocale)?settings.formatLocale ?? value.formatLocale:'auto',timeFormat:['auto','12h','24h'].includes(settings.timeFormat ?? value?.timeFormat)?settings.timeFormat ?? value.timeFormat:'auto',preferenceVersion:Number.isSafeInteger(value?.preferenceVersion??value?.settingsVersion)&&(value.preferenceVersion??value.settingsVersion)>=0?(value.preferenceVersion??value.settingsVersion):0,
    lastError:errorCodes.has(value?.lastError?.code) ? {code:value.lastError.code} : null,
    settings:{
      overlayMode:settings.overlayMode==='light'?'light':'expert',
      appearance:readerAPI.cleanAppearance(settings.appearance ?? value?.appearance),
      reading:FIELDS.reading.check(settings.reading) ? settings.reading : undefined,
      followPosition:Number.isFinite(settings.followPosition)&&settings.followPosition>=10&&settings.followPosition<=90?settings.followPosition:33,
      followMode:['paragraph','section','line'].includes(settings.followMode)?settings.followMode:'paragraph',
      followMargin:Number.isInteger(settings.followMargin)&&settings.followMargin>=5&&settings.followMargin<=30?settings.followMargin:10,
      ...marksFrom({...settings,markVersion:2}),markVersion:2,normalizeSpeech:typeof settings.normalizeSpeech==='boolean'?settings.normalizeSpeech:true,
      markStyle:cleanStyle(settings.markStyle),overlayTheme:cleanOverlayTheme(settings.overlayTheme),keyboard:cleanKeyboard(settings.keyboard),bar:FIELDS.bar.check(settings.bar)?settings.bar:null,online:settings.online===true,   // the central configuration: the popup and the export read ALL of it from here
      speed:Number.isFinite(settings.speed) && settings.speed >= .5 ? Math.min(4, settings.speed) : null,
      ...Object.fromEntries(['follow','clickSeek','autoShow','focusMotion','muted'].map(key => [key,typeof settings[key] === 'boolean' ? settings[key] : null])),
      uiLanguage:selectedUiLanguage,
      playerTheme:['system','light','dark'].includes(settings.playerTheme??value?.playerTheme)?settings.playerTheme??value.playerTheme:'system',
      formatLocale:formatLocales.includes(settings.formatLocale)?settings.formatLocale:'auto',timeFormat:['auto','12h','24h'].includes(settings.timeFormat)?settings.timeFormat:'auto',
      language:settings.language === 'auto' || catalog.some(item => item.code === settings.language) ? settings.language : 'auto',
      voices:Object.fromEntries(catalog.filter(item => voiceId(settings.voices?.[item.code])).map(item => [item.code,settings.voices[item.code]])),
      volume:Number.isFinite(settings.volume) && settings.volume >= 0 && settings.volume <= 150 ? settings.volume : 100,
      ...Object.fromEntries(['pitch','bass','treble','sectionPause'].map(key => [key,FIELDS[key].check(settings[key]) ? settings[key] : 0])),
    },
    engine:{ready:engine.ready === true,voice:voiceId(engine.voice) ? engine.voice : '',voiceLabel:text(engine.voiceLabel),language:text(engine.language,12),activeLanguage:text(engine.activeLanguage,12),detectedLanguage:text(engine.detectedLanguage,12),catalog,providers:Array.isArray(engine.providers) ? engine.providers.filter(name => ['CUDAExecutionProvider','CPUExecutionProvider'].includes(name)) : []},
    capabilities:FREE_CAPABILITIES,
    exportState:{kind:exported.kind==='document'?'document':'audio',state:['idle','running','complete','cancelled','locked','error'].includes(exported.state) ? exported.state : 'idle',percent:Number.isFinite(exported.percent) ? Math.max(0,Math.min(100,exported.percent)) : 0,completedChunks:Number.isInteger(exported.completedChunks) && exported.completedChunks >= 0 ? exported.completedChunks : 0,totalChunks:Number.isInteger(exported.totalChunks) && exported.totalChunks >= 0 ? exported.totalChunks : 0,downloadReady:exported.downloadReady===true,errorKey:errorCodes.has(exported.errorKey) ? exported.errorKey : '',filename:typeof exported.filename==='string'?exported.filename.split(/[\\/]/).at(-1).slice(0,200):''},
    playback:{playing:playback.playing === true,paused:playback.paused === true,loading:playback.loading === true},
    voiceCard:cleanVoiceCard(value?.voiceCard),voiceDownload:cleanVoiceDownload(value?.voiceDownload),
    voiceMissing:Number.isFinite(value?.voiceMissing?.mb)&&value.voiceMissing.mb>=0?{mb:Math.round(value.voiceMissing.mb)}:null,
    components:Object.fromEntries(['extensionApi','bridge','watcher'].map(name => [name,value?.components?.[name] === true])),
  };
}

/* Per-tab action titles follow the UI language. The applied language survives worker restarts, so a waking
   worker does not rewrite every tab (and its saved error codes) again. */
const ACTION_LANGUAGE_KEY = 'notableActionLanguage';
async function retitleActions(language) {
  if ((await chrome.storage.session.get(ACTION_LANGUAGE_KEY))[ACTION_LANGUAGE_KEY] === language) return;
  await chrome.storage.session.set({[ACTION_LANGUAGE_KEY]: language});
  // Only IDs are needed: no document URL/title is read or retained here.
  await chrome.action.setTitle({title:product.name+' · '+t('extPopupTitle')}).catch(()=>{});
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab=>{
    const known=operations.get(tab.id);
    if (known) return actionState(tab.id,known.state,known.code,known.kind);
    return chrome.action.setTitle({tabId:tab.id,title:product.name+' · '+t('extPopupTitle')}).catch(()=>{});
  }));
}
/* One request at a time per kind; a lean poll (no voice catalog) never answers a caller that needs the catalog. */
const statusRequests = new Map();
async function status({catalog = true} = {}) {
  const kind = catalog ? 'full' : 'lean';
  if (!statusRequests.has(kind)) {
    statusRequests.set(kind, catalogLoaded().then(() => readerAPI.status({catalog}))
      .then(value => ({ok: true, status: cleanStatus(value)})).catch(failure)
      .finally(() => {statusRequests.delete(kind);}));
  }
  return statusRequests.get(kind);
}

async function actionState(tabId, state, code, kind = 'show') {
  await catalogLoaded();
  try {
    const pending = state === 'pending', failed = state === 'error';
    await chrome.action.setBadgeBackgroundColor({tabId, color: failed ? '#a84630' : '#256249'});
    await chrome.action.setBadgeText({tabId, text: pending ? '…' : failed ? '!' : ''});
    await chrome.action.setTitle({tabId, title: `${product.name} · ${pending ? t(kind === 'hide' ? 'extClosing' : 'extOpening') : failed ? errorText(code) + ' [' + code + ']' : t(state === 'hidden' ? 'extReaderHidden' : 'extReaderReady')}`});
  } catch { /* Closed tabs no longer have an action. */ }
}

function remember(tabId, operation) {
  if (!operations.has(tabId) && operations.size >= 128) {
    const removable = [...operations.keys()].find(id => !running.has(id));
    if (removable !== undefined) operations.delete(removable);
  }
  operations.set(tabId, operation);
}

async function savedOperation(tabId) {
  if (!Number.isInteger(tabId)) return null;
  const existing = operations.get(tabId);
  if (existing && (!['ready', 'hidden'].includes(existing.state) || Date.now() - existing.at < 30000)) return existing;
  if (existing) operations.delete(tabId);
  // If Chromium suspended the worker, recover its last fixed error code from
  // the tab's action. A pending badge without an owned job is interrupted.
  try {
    const badge = await chrome.action.getBadgeText({tabId});
    if (badge !== '!' && badge !== '…') return null;
    const title = await chrome.action.getTitle({tabId});
    const savedCode = title.match(/\[([a-z_]+)\]$/)?.[1];
    const code = badge === '…' ? 'closed' : errorCodes.has(savedCode) ? savedCode : 'bridge_failed';
    const operation = {state: 'error', code, at: Date.now()};
    remember(tabId, operation);
    if (badge === '…') await actionState(tabId, 'error', code);
    return operation;
  } catch { return null; }
}

async function tabAction(tabId, kind) {
  if (!Number.isInteger(tabId) || tabId < 0) return errorFor('invalid');
  if (running.has(tabId)) return running.get(tabId).kind === kind ? {ok: true, operation: await savedOperation(tabId)} : errorFor('busy');
  let tab;
  try { tab = await chrome.tabs.get(tabId); }
  catch { return errorFor('tab_changed'); }
  if (!tab.active) return errorFor('tab_changed');
  if (running.has(tabId)) return running.get(tabId).kind === kind ? {ok: true, operation: await savedOperation(tabId)} : errorFor('busy');
  if (running.size >= 8) return errorFor('busy');
  const token = crypto.randomUUID();
  running.set(tabId, {token, kind});
  const pending = {state: 'pending', code: 'pending', kind, at: Date.now()};
  remember(tabId, pending);
  await actionState(tabId, 'pending', undefined, kind);
  // The popup may close: the worker owns the job, not its response port.
  void (async () => {
    try {
      await readerAPI[kind](tab, () => {
        // Pending network work alone doesn't retain a Manifest V3 worker.
        // A bounded action update keeps ownership until completion or timeout.
        if (running.get(tabId)?.token === token) void actionState(tabId, 'pending', undefined, kind);
      });
      let current;
      try { current = await chrome.tabs.get(tabId); }
      catch { throw new readerAPI.ReaderError('tab_changed'); }
      if (current.url !== tab.url || current.title !== tab.title) throw new readerAPI.ReaderError('tab_changed');
      if (running.get(tabId)?.token !== token) return;
      const state = kind === 'hide' ? 'hidden' : 'ready';
      remember(tabId, {state, code: kind === 'hide' ? 'applied' : 'ready', kind, at: Date.now()});
      await actionState(tabId, state, undefined, kind);
    } catch (error) {
      if (running.get(tabId)?.token !== token) return;
      const result = failure(error);
      remember(tabId, {state: 'error', code: result.code, kind, at: Date.now()});
      await actionState(tabId, 'error', result.code);
    } finally {
      if (running.get(tabId)?.token === token) running.delete(tabId);
    }
  })();
  return {ok: true, operation: pending};
}

// The accepted keys and value checks come from the one central configuration schema (config.mjs).
const validSettings = value => validSettingsPatch(value, {uiLanguages: [...languageCodes], formatLocales});

async function selectedTab(message,page,sender){
  if(!['popup.html','sidebar.html'].includes(page))return null;
  if(message.tabId!==undefined)return chrome.tabs.get(message.tabId).catch(()=>null);
  const tabs=await chrome.tabs.query({active:true,currentWindow:true});return tabs[0]||null;
}
async function targetContext(tab,status){
  const source=status?.sourceContext;
  if(!tab||tab.active!==true)return {type:'unsupported',supported:false,bound:false,ready:false,generation:null,code:'tab_changed'};
  try{
    const url=new URL(tab.url);
    if(['http:','https:','file:'].includes(url.protocol)&&!url.username&&!url.password&&tab.url.length<=8192){
      // The status was answered through this tab's proven document binding. URL and title are no identity:
      // same-document navigation keeps the document, a replacement fails the binding proof instead.
      const bound=!!source&&source.tabId===tab.id;
      return {type:'source',supported:true,bound,ready:bound&&status?.ready===true,generation:bound?source.generation:null,code:null};
    }
  }catch{}
  return {type:'unsupported',supported:false,bound:false,ready:false,generation:null,code:'unsupported'};
}
const answered=result=>result?.pending
  ?{ok:true,pending:true,status:cleanStatus({})}:{ok:true,status:cleanStatus(result)};
/* Stop from a tab without its own session reaches the session that is actually reading (e.g. in another tab). */
async function stopCurrent(fresh){
  const tabId=await readerAPI.currentTab();
  if(tabId===null)return {ok:true,status:fresh};
  try{
    const result=await readerAPI.control('stop');
    void releasePlayback(tabId).catch(()=>{});
    return {ok:true,status:cleanStatus(result)};
  }
  catch(error){if(error?.code==='document_unavailable')return {ok:true,status:fresh};throw error;}
}
async function routedControl(message,page,sender){
  const command=message.command;
  const opening=command==='setOverlayVisible'&&message.value===true;
  if(!boundCommands.has(command))return answered(await readerAPI.control(command,message.value));
  if(!['popup.html','sidebar.html'].includes(page))return answered(await readerAPI.control(command,message.value,message.sourceGeneration));
  const tab=await selectedTab(message,page,sender),fresh=cleanStatus(await readerAPI.status()),target=await targetContext(tab,fresh);
  if(message.sourceURL!==undefined&&message.sourceURL!==tab?.url)return errorFor('tab_changed');
  if(!target.supported)return errorFor(target.code);
  if(command==='stop'&&!target.bound)return stopCurrent(fresh);
  if(command==='prepare'){if(target.type!=='source')return errorFor(target.code||'unsupported');if(target.bound)return {ok:true,status:fresh,targetContext:target};}   // popup opened: read the page into a hidden session (no overlay, no audio) so voices, chapters and settings work like on the bar
  if(!target.bound&&!(['toggle','restart','openFocus','prepare'].includes(command)||command==='setOverlayVisible'&&message.value===true))return errorFor('document_changed');
  if(target.bound&&!opening&&message.sourceGeneration!==undefined&&message.sourceGeneration!==target.generation)return errorFor('document_changed');
  if(command==='setOverlayVisible'&&!opening&&target.bound)return {ok:true,status:cleanStatus(await readerAPI.control(command,message.value,target.generation)),targetContext:target};
  // A deliberate source action, never popup opening, prepares the exact active
  // original tab first. The backend reuses already-bound text without recapture.
  // A second deliberate action while the same tab is still being prepared (popup opened and clicked within ms) waits for that preparation instead of failing.
  for(let wait=0;wait<2&&running.get(tab.id)?.kind==='show'&&running.get(tab.id).done;wait++)await running.get(tab.id).done;
  if(running.has(tab.id)||running.size>=8)return errorFor('busy');
  const token=crypto.randomUUID();let finish;const done=new Promise(resolve=>{finish=resolve;});running.set(tab.id,{token,kind:'show',done});
  remember(tab.id,{state:'pending',code:'pending',kind:'show',at:Date.now()});
  const complete=async()=>{if(running.get(tab.id)?.token===token){remember(tab.id,{state:'ready',kind:'show',at:Date.now()});await actionState(tab.id,'ready');}};
  try{
    await readerAPI.show(tab,()=>{if(running.get(tab.id)?.token===token)void actionState(tab.id,'pending');},{overlay:command==='setOverlayVisible'});
    const current=await chrome.tabs.get(tab.id).catch(()=>null);
    if(!current||!current.active||running.get(tab.id)?.token!==token)throw new readerAPI.ReaderError('tab_changed');
    const ready=cleanStatus(await readerAPI.status());
    if(!ready.sourceContext||!ready.ready||ready.sourceContext.tabId!==tab.id)throw new readerAPI.ReaderError('document_unavailable');
    if(!['toggle','restart','openFocus','setOverlayVisible','prepare'].includes(command)&&ready.sourceContext.generation!==target.generation)throw new readerAPI.ReaderError('document_changed');
    // A request naming a document generation never controls a different (replacement) document.
    const named=message.sourceGeneration;
    if(!opening&&command!=='prepare'&&named!==undefined&&ready.sourceContext.generation!==named){
      throw new readerAPI.ReaderError('document_changed');
    }
    const unchanged=await chrome.tabs.get(tab.id).catch(()=>null);
    if(!unchanged||!unchanged.active||running.get(tab.id)?.token!==token)throw new readerAPI.ReaderError('tab_changed');
    // Native queued execution also checks this generation: a source change
    // after this status request cannot apply the command to another document.
    if(command==='prepare'){await complete();return {ok:true,status:ready,targetContext:await targetContext(current,ready)};}
    const result=await readerAPI.control(command,message.value,ready.sourceContext.generation);
    await complete();
    if(command==='stop')void releasePlayback(tab.id).catch(()=>{});
    // Still starting inside the page (voice confirmation, download, cold engine): report the known state.
    if(result?.pending)return {ok:true,pending:true,status:ready,targetContext:await targetContext(current,ready)};
    return {ok:true,status:cleanStatus(result),targetContext:await targetContext(current,cleanStatus(result))};
  }catch(error){if(running.get(tab.id)?.token===token){const code=errorCodes.has(error?.code)?error.code:'bridge_failed';remember(tab.id,{state:'error',code,kind:'show',at:Date.now()});await actionState(tab.id,'error',code);}throw error;}
  finally{if(running.get(tab.id)?.token===token)running.delete(tab.id);finish();}
}

const withoutCatalog=status=>({...status,catalog:[],engine:{...status.engine,catalog:[]}});
/* A successful explicit action replaces an earlier failure of the same tab in badge and popup. */
async function settleOperation(message,page,sender){
  const tabId=Number.isSafeInteger(message.tabId)?message.tabId:(await selectedTab(message,page,sender))?.id;
  if(!Number.isSafeInteger(tabId)||running.has(tabId))return;
  const known=operations.get(tabId);
  if(known?known.state!=='error':await chrome.action.getBadgeText({tabId})!=='!')return;
  remember(tabId,{state:'ready',kind:'show',at:Date.now()});await actionState(tabId,'ready');
}
async function dispatch(message, page, sender) {
  await catalogLoaded();
  if (!message || typeof message !== 'object' || Array.isArray(message)) return errorFor('invalid');
  if(page==='popup.html'&&message.type==='frameAccess'&&exactKeys(message,['type'],['tabId'])){const tab=await selectedTab(message,page,sender);if(!tab?.active)return errorFor('tab_changed');try{return {ok:true,frameAccess:await readerAPI.frameAccess(tab)};}catch(error){if(errorCodes.has(error?.code)){const wrapped=new readerAPI.ReaderError(error.code);if(error.access)wrapped.access=error.access;throw wrapped;}throw error;}}
  const workflow = await handleWorkflowRequest(message,page,sender);
  if (workflow !== null) {
    if (workflow?.ok === true) await settleOperation(message, page, sender).catch(() => {});
    return workflow;
  }
  if (page === 'popup.html' && message.type === 'settingsSnapshot' && exactKeys(message,['type'],['tabId'])) {
    if(message.tabId!==undefined&&(!Number.isSafeInteger(message.tabId)||message.tabId<0))return errorFor('invalid');
    const hosted=await existingSettingsModels();
    const tab=await settingsSourceTab(message.tabId),source=tab?await routeSession(tab,undefined,undefined,'status').catch(()=>null):null;
    return {ok:true,runtimeBuild:RUNTIME_BUILD,settings:{...configDefaults(),...await loadConfig(chrome.storage.local)},documentContext:{detectedLanguage:source?.engine?.detectedLanguage||source?.snapshot?.detectedLanguage||source?.snapshot?.engine?.detectedLanguage||'',activeLanguage:source?.engine?.activeLanguage||source?.snapshot?.engine?.activeLanguage||'',documentId:source?.ok?String(source.generation||'')+'|'+String(source.fingerprint||source.snapshot?.fingerprint||''):''},...(hosted?.ok?{installed:hosted.installed,download:hosted.download,caps:hosted.caps}:{})};
  }
  if (page === 'popup.html' && message.type === 'settingsControl' && exactKeys(message,['type','command'],['value','tabId'])) {
    const {command,value}=message,modelCommand=['downloadVoice','cancelDownload','removeVoice'].includes(command);
    if (message.tabId!==undefined&&(!Number.isSafeInteger(message.tabId)||message.tabId<0)) return errorFor('invalid');
    if (!modelCommand||!readerAPI.validControl(command,value)) return errorFor('invalid');
    const model=MODELS[value]||modelByVoice(value);if(!model)return errorFor('invalid');
    const host=await ensureHost(),result=host?await host.settingsModelControl(command,model.id):await chrome.runtime.sendMessage({target:'host',t:'settingsModelControl',command,modelId:model.id});
    return result?.ok?{...result,runtimeBuild:RUNTIME_BUILD,settings:{...configDefaults(),...await loadConfig(chrome.storage.local)}}:errorFor(result?.code||'unavailable');
  }
  if(page==='tools/reader/reader.html')return errorFor('invalid');
  if (message.type === 'snapshot') {
    if(!exactKeys(message,['type'],['tabId','catalog'])||message.catalog!==undefined&&typeof message.catalog!=='boolean'||message.tabId!==undefined&&(!Number.isSafeInteger(message.tabId)||message.tabId<0))return errorFor('invalid');
    const tabId = ['popup.html','sidebar.html'].includes(page) && Number.isInteger(message.tabId) ? message.tabId : null;
    const lean = message.catalog === false || page === 'sidebar.html';
    const [connection, operation] = await Promise.all([status({catalog: !lean}), savedOperation(tabId)]);
    const selected=await selectedTab(message,page,sender);
    const surface=['popup.html','sidebar.html'].includes(page);
    const context=surface?{targetContext:await targetContext(selected,connection.status)}:{};
    // Polls that never show voices skip the full voice catalog (hundreds of entries per answer).
    if(connection.ok&&lean){
      return {...connection,status:withoutCatalog(connection.status),runtimeBuild:RUNTIME_BUILD,operation,...context};
    }
    return {...connection, runtimeBuild:RUNTIME_BUILD, operation,...context};
  }
  if (['show', 'hide'].includes(message.type) && page === 'popup.html'&&exactKeys(message,['type','tabId'])) return tabAction(message.tabId, message.type);
  if (message.type === 'settings' && page !== 'help.html' && exactKeys(message,['type','values'],['tabId'])&&validSettings(message.values)) {
    return {ok: true, status: cleanStatus(await readerAPI.settings(message.values))};
  }
  if (message.type === 'control' && page !== 'help.html' && exactKeys(message,['type','command'],['value','tabId','sourceGeneration','sourceURL'])&&(message.tabId===undefined||Number.isSafeInteger(message.tabId)&&message.tabId>=0)&&(message.sourceGeneration===undefined||generation(message.sourceGeneration))&&readerAPI.validControl(message.command,message.value)) {
    if(message.command==='authorizeExport')return errorFor('invalid');
    return routedControl(message,page,sender);
  }
  return errorFor('invalid');
}

// Engine host (own code): Chrome keeps Worker + audio in an offscreen document, Firefox in this background page.
let hostReady,backgroundHost;
async function saveModelChoice(command,modelId,installed=[]){
  const model=MODELS[modelId];if(!model||!['select','remove'].includes(command))return {ok:false};
  const config=await loadConfig(chrome.storage.local);let voices={...config.voices};
  if(command==='select')voices[model.lang]=model.voiceURI;
  else{const remaining=new Set(installed),gone=new Set(Object.values(MODELS).filter(m=>m.id===modelId||!remaining.has(m.id)&&m.files.length===model.files.length&&m.files.every(f=>model.files.some(g=>g.url===f.url))).map(m=>m.voiceURI));voices=Object.fromEntries(Object.entries(voices).filter(([,voice])=>!gone.has(voice)));}
  await chrome.storage.local.set({[CONFIG_KEY]:{...config,voices}});return {ok:true};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.target!=='settingsConfig')return false;
  if(sender.id!==chrome.runtime.id||sender.tab||sender.url!==chrome.runtime.getURL('session/host.html')||!exactKeys(message,['target','command','modelId'],['installed'])||message.installed!==undefined&&(!Array.isArray(message.installed)||message.installed.some(id=>!MODELS[id])))return false;
  saveModelChoice(message.command,message.modelId,message.installed).then(respond,()=>respond({ok:false}));return true;
});
async function settingsSourceTab(tabId){
  let tab=tabId!==undefined?await chrome.tabs.get(tabId).catch(()=>null):(await chrome.tabs.query({active:true,currentWindow:true}))[0];
  const safe=t=>t&&(/^https?:\/\//.test(t.url||'')||t.url?.split(/[?#]/,1)[0]===chrome.runtime.getURL('tools/reader/reader.html'));
  if(!safe(tab)&&tabId===undefined){const stored=await chrome.storage.session.get('sessionTab');tab=Number.isSafeInteger(stored.sessionTab)?await chrome.tabs.get(stored.sessionTab).catch(()=>null):null;}
  return safe(tab)?tab:null;
}
async function existingSettingsModels(){
  // Opening Settings must never create a host, worker, model download or audio source.
  if(backgroundHost)return backgroundHost.settingsModels().catch(()=>null);
  if(!chrome.runtime.getContexts)return null;
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}).catch(()=>[]);
  if(!contexts?.length)return null;
  return chrome.runtime.sendMessage({target:'host',t:'settingsModels'}).catch(()=>null);
}
function ensureHost() {
  if (hostReady) return hostReady;
  hostReady = (async () => {
    if (typeof document !== 'undefined') { const {startHost} = await import('./session/host.mjs'); return backgroundHost=startHost(chrome,{settingsConfig:saveModelChoice}); }
    if (!chrome.offscreen) throw new Error('no-host');
    const existing = await chrome.runtime.getContexts?.({contextTypes: ['OFFSCREEN_DOCUMENT']});
    if (!existing?.length) await chrome.offscreen.createDocument({url: 'session/host.html', reasons: ['AUDIO_PLAYBACK', 'WORKERS'], justification: 'Lokale Sprachsynthese (WASM-Worker) und Audiowiedergabe fuer die Vorleseleiste'});
  })().finally(() => { hostReady = undefined; });
  return hostReady;
}
if (typeof document !== 'undefined') void ensureHost().catch(() => {});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.t !== 'ensureHost' || sender.id !== chrome.runtime.id) return false;
  ensureHost().then(() => sendResponse({ok: true}), () => sendResponse({ok: false}));
  return true;
});

// Page session (top frame) -> worker: source-bound export hand-off to the reader page.
// A hostile page can reach the open shadow root of the bar and fire synthetic clicks (isTrusted=false) on "open focus view";
// without a limit that opens one tab per click. At most 3 reader tabs per page tab in 10 s.
const lastOpen = new Map();
function openAllowed(tabId) {
  const now = Date.now(), recent = (lastOpen.get(tabId) || []).filter(at => now - at < 10000);
  if (recent.length >= 3) { lastOpen.set(tabId, recent); return false; }
  if (lastOpen.size >= 256 && !lastOpen.has(tabId)) lastOpen.delete(lastOpen.keys().next().value);
  recent.push(now); lastOpen.set(tabId, recent); return true;
}
function openRefused(tabId) { const list = lastOpen.get(tabId); if (list) list.pop(); }
chrome.tabs.onRemoved.addListener(tabId => lastOpen.delete(tabId));
/* "Open the flags page" from the voice list (WebGPU missing): only our own pages, only two known flags, only a flags URL. Brave answers to brave://, Chrome/Edge-like browsers to chrome://; if the first scheme is refused, the other is tried. */
const FLAG_IDS = {vulkan: 'enable-vulkan', webgpu: 'enable-unsafe-webgpu'};
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.t !== 'openFlags' || sender.id !== chrome.runtime.id) return false;
  const id = FLAG_IDS[message.flag]; if (!id) { sendResponse({ok: false}); return true; }
  const schemes = message.brave === true ? ['brave', 'chrome'] : ['chrome', 'brave'];
  (async () => { for (const scheme of schemes) { try { await chrome.tabs.create({url: scheme + '://flags/#' + id}); return {ok: true, scheme}; } catch {} } return {ok: false}; })().then(sendResponse);
  return true;
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // The reader tab (extension page) asks to close itself and return to the page tab it was opened from: only from reader.html, only for its own tab.
  if (message?.t === 'closeFocus' && sender.id === chrome.runtime.id && sender.tab && sender.frameId === 0 && typeof sender.url === 'string' && sender.url.split(/[?#]/, 1)[0] === chrome.runtime.getURL('tools/reader/reader.html')) {
    readerAPI.closeFocus(sender.tab.id, message.charStart).then(sendResponse, () => sendResponse({ok: false, code: 'closed'})); return true;
  }
  /* Round 4 (owner request): a download of the page bar never opens the reader view or changes the tab. Chrome: the engine host (offscreen
     document, where the voice already lives) makes the file and the browser saves it; its progress goes back to the asking page (and frame).
     Firefox has no offscreen document: its reader tab makes the file in the background (no tab change). */
  if (message?.t === 'hostExport' && sender.id === chrome.runtime.id && sender.tab) {
    const go = () => { void (async () => {
      const format = message.format, text = typeof message.doc?.text === 'string' ? message.doc.text : '', html = typeof message.html === 'string' ? message.html : '';
      if (!['mp3', 'wav', 'pdf', 'html'].includes(format) || (format === 'html' ? !html || html.length > 48e6 : !text.trim() || text.length > 6e6)) return sendResponse({ok: false, code: 'invalid'});
      if (!chrome.offscreen) { const r = await readerAPI.openExport(message.doc, format, sender.tab.id, {active: false}); return sendResponse({ok: true, token: r?.token}); }
      await ensureHost();
      const token = typeof message.token === 'string' && /^[0-9a-f-]{36}$/.test(message.token) ? message.token : crypto.randomUUID(), title = String(message.title || '').slice(0, 300) || 'beNotable! Reader';
      const reply = await chrome.runtime.sendMessage({target: 'host-export', t: 'start', token, tabId: sender.tab.id, frameId: Number.isSafeInteger(sender.frameId) ? sender.frameId : 0, format, title,
        ...(format === 'html' ? {html} : {doc: {text}}), modelId: typeof message.modelId === 'string' ? message.modelId.slice(0, 80) : '', reading: message.reading, normalize: message.normalize !== false,
        lang: String(message.lang || '').slice(0, 20), appearance: message.appearance && typeof message.appearance === 'object' ? message.appearance : null});
      sendResponse(reply?.ok ? {ok: true, token} : {ok: false, code: reply?.code === 'busy' ? 'busy' : 'export_failed'});
    })().catch(error => sendResponse({ok: false, code: errorCodes.has(error?.code) ? error.code : 'export_failed'})); };
    if (sender.frameId > 0) void authorizedFrame(sender, message.generation, {}).then(allowed => allowed ? go() : sendResponse({ok: false, code: 'forbidden'})); else go();
    return true;
  }
  /* progress of a host-made file -> the page (and frame) that asked for it */
  if (message?.t === 'exportRelay' && sender.id === chrome.runtime.id && !sender.tab && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL('session/host.html')) && Number.isSafeInteger(message.tabId)) {
    void chrome.tabs.sendMessage(message.tabId, {target: 'session', t: 'exportJob', token: message.token, job: message.job}, {frameId: Number.isSafeInteger(message.frameId) ? message.frameId : 0}).catch(() => {});
    return false;
  }
  if (sender.id !== chrome.runtime.id || !sender.tab || !['openExport', 'openFocus'].includes(message?.t)) return false;
  if(sender.frameId>0){void authorizedFrame(sender,message.generation,{}).then(allowed=>{if(!allowed)sendResponse({ok:false,code:'forbidden'});else runSourceRequest();});return true;}
  return runSourceRequest();
  function runSourceRequest(){
  if (!openAllowed(sender.tab.id)) { sendResponse({ok: false, code: 'busy'}); return true; }
  const task = message.t === 'openFocus' ? readerAPI.openFocus(message.doc, sender.tab).then(r => ({ok: true, reused: r?.reused === true})) : readerAPI.openExport(message.doc, message.format, sender.tab.id, {active: false}).then(r => ({ok: true, token: r?.token}));   // never a tab change (round 4)
  task.then(sendResponse, error => {
    openRefused(sender.tab.id);
    const fallback = message.t === 'openFocus' ? 'document_failed' : 'export_failed';
    sendResponse({ok: false, code: errorCodes.has(error?.code) ? error.code : fallback});
  });   // a refused attempt (locked export, empty text) opens no tab and must not block the next one
  return true;
  }
});

// Settings file from the bar (content script): saved / shown only when the optional permission "downloads" was granted before (requested on an extension page, see session/settings-file.mjs). At most 3 per 10 s and tab.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.t !== 'settingsFile' || sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return false;
  if (!openAllowed(sender.tab.id)) { sendResponse({ok: false, reason: 'busy'}); return true; }
  handleFileMessage(chrome, message).then(sendResponse, () => sendResponse({ok: false, reason: 'failed'}));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'host' || message?.target === 'session' || message?.target === 'settingsConfig') return false;
  if (['claimAudio','saveChapter','cancelChapter','getChapter','continueChapter','captureArea'].includes(message?.t)) return false;              // answered by the engine host, never by this worker
  if (message?.t === 'readingHistory') return false;          // dedicated history listener owns this reply, including own file pages
  if (message?.t === 'settingsFile') return false;           // answered by the settings-file listener above (two answers to one message: the first one wins)
  // Owned by their dedicated listeners above; a second (faster) answer from dispatch would replace theirs.
  const owned = ['closeFocus', 'openFlags', 'ensureHost', 'openExport', 'openFocus', 'readerExplainVerify'];
  if (owned.includes(message?.t ?? message?.type)) return false;
  const page = sender.id === chrome.runtime.id && typeof sender.url === 'string'
    ? pages.get(sender.url.split(/[?#]/, 1)[0]) : undefined;
  // Chromium may expose the preceding fragment in sender.tab during a same-
  // document hash update. Match the trusted top-level resource; never admit a web-page iframe.
  if (!page || sender.tab && (sender.frameId!==undefined&&sender.frameId!==0 || typeof sender.tab.url!=='string'||sender.tab.url.split(/[?#]/,1)[0]!==sender.url.split(/[?#]/,1)[0])) return false;
  dispatch(message, page, sender).then(sendResponse).catch(error => sendResponse(failure(error)));
  return true;
});

// Global shortcuts (manifest commands): the same commands the keyboard layer of the bar sends, but also while the page or the browser UI has the focus.
// They obey the keyboard switch of the central configuration (pageSettings.keyboard.enabled); an action the user has rebound no longer answers to its old global key. Sentence navigation needs a session; play without one opens the bar paused.
const globalCommands = {'toggle-play': 'toggle', 'previous-section': 'previousSection', 'next-section': 'nextSection'};
async function onGlobalCommand(name, tab) {
  const command = globalCommands[name]; if (!command) return;
  try {
    const config = await loadConfig(chrome.storage.local); if (keyboardOff(config)) return;
    const own = {'toggle-play': 'playPause', 'previous-section': 'previousSection', 'next-section': 'nextSection'}[name]; if (config.keyboard?.keys?.[own]) return;
    if (!Number.isSafeInteger(tab?.id)) tab = (await chrome.tabs.query({active: true, currentWindow: true}))[0];
    if (!tab || !Number.isSafeInteger(tab.id)) return;
    // Like media keys, the shortcut acts on the audio that is playing or paused, in whichever tab it is.
    if (await readerAPI.currentTab() !== null) {
      const live = (await readerAPI.status().catch(() => null))?.playback;
      if (live?.playing || live?.paused || live?.loading) { await readerAPI.control(command); return; }
    }
    try {
      const asked = chrome.tabs.sendMessage(tab.id, {target: 'session', t: 'control', command});
      const answer = await withTimeout(asked, 4000);
      if (answer?.ok) return;
    } catch {}
    if (command !== 'toggle') return;
    await readerAPI.show(tab);   // no bar yet: Play only opens it (paused, ready); the next press plays (owner request, round 3)
  } catch (error) {
    // A shortcut has no surface of its own: show the failure on the toolbar button of the targeted tab.
    if (!Number.isSafeInteger(tab?.id)) return;
    const code = failure(error).code;
    remember(tab.id, {state: 'error', code, at: Date.now()}); void actionState(tab.id, 'error', code);
  }
}
chrome.commands?.onCommand?.addListener(onGlobalCommand);
globalThis.notableGlobalCommand = onGlobalCommand;       // test hook: the system key itself cannot be pressed in a headless browser

chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.status !== 'loading' && typeof changes.url !== 'string') return;
  // A running preparation keeps its marker: its own document proofs decide and it always releases the marker.
  // Navigation within the same document (hash, pushState) must not abort it.
  if (running.has(tabId)) return;
  operations.delete(tabId);
  void chrome.action.setBadgeText({tabId, text: ''}).catch(() => {});
  void catalogLoaded().then(() => chrome.action.setTitle({tabId, title: `${product.name} · ${t('extPopupTitle')}`})).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => {running.delete(tabId); operations.delete(tabId);});

// First install: the welcome page opens once (lifecycle.mjs). Registered at the top level so the browser can wake a stopped worker for the event.
const WELCOME_IN_DEVELOPMENT_INSTALLS = false;        // tests/welcome-e2e.cjs flips this in a copy to drive the real event
// Upgrade cleanup is local and never contacts an account or tracking endpoint. It runs on install/update and
// browser start only, not on every worker wake-up.
chrome.runtime.onInstalled.addListener(details => {
  void clearLegacyProductData(chrome);
  void handleInstalled(details, {welcomeInDevelopment: WELCOME_IN_DEVELOPMENT_INSTALLS});
});
chrome.runtime.onStartup.addListener(() => {
  void clearLegacyProductData(chrome); void registerUninstallPage(chrome);
});
globalThis.notableOnInstalled = handleInstalled;       // test hook: a real install event cannot be repeated in a running test browser

// Explicit workflows from our content-script session only.
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || !['claimAudio','saveChapter','cancelChapter','getChapter','continueChapter','captureArea'].includes(m?.t))return false;
  (async()=>{if(sender.frameId>0&&(m.t!=='claimAudio'||!await authorizedFrame(sender,m.generation)))return {ok:false,code:'forbidden'};if(!sender.tab){if(m.t!=='claimAudio'||sender.url?.split(/[?#]/)[0]!==chrome.runtime.getURL('tools/reader/reader.html'))return {ok:false};const matches=(await chrome.tabs.query({})).filter(t=>t.url===sender.url);if(matches.length!==1)return {ok:false};sender={...sender,tab:matches[0]};}return handleWorkflowMessage(m,sender);})().then(reply,()=>reply({ok:false,code:'invalid'}));return true;
});
installWorkflowEvents();

chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(m?.t!=='readingHistory'||sender.id!==chrome.runtime.id)return false;
 handleReadingHistory(m,sender).then(reply,()=>reply({ok:false,code:'history_storage_failed'}));return true;
});

// Only the live selected PageSession may open an extension-origin fallback.
registerExplainBroker({authorizeFrame:({sender,epoch})=>authorizedFrame(sender,typeof epoch==='string'?epoch.split('|')[0]:null),authorize:async({sender,epoch})=>{
 const tab=await chrome.tabs.get(sender.tab.id).catch(()=>null);
 if(!tab||sender.frameId===0&&tab.url!==sender.url)return false;
 const source=await routeSession(tab,undefined,undefined,'status').catch(()=>null);
 return source?.ok===true&&source.ready===true&&source.explainEpoch===epoch;
}});
