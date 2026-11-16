import {getRuntimeState,setRuntimeMode} from './native-runtime.mjs';
import {installArticleHandoff} from './article-handoff.mjs';
installArticleHandoff();
import * as readerAPI from './reader-api.js';
import {product} from './product-config.js';
import {t, errorText, setUiLanguage, uiLanguages, formatLocales, catalogReady} from './i18n.js';

// Cached results contain technical codes only, never document URLs or titles.
const operations = new Map();
const running = new Map();
// Only successful native Ready ACKs establish tab-to-document correspondence.
// Worker suspension deliberately forgets ordinary tabs; focus has an opaque hash.
const verifiedSources=new Map();
// URL/title equality cannot identify a replacement document after a reload.
const invalidatedSources=new Set();
const pages = new Map(['popup.html', 'options.html', 'help.html','focus.html','reader.html','tools/reader/reader.html'].map(name => [chrome.runtime.getURL(name), name]));
let statusRequest, documentRequest, actionLanguage;
const documentTransfers=new Map();
const generation=value=>typeof value==='string'&&/^[a-f0-9-]{16,64}$/i.test(value)?value:null;
const ownFocus=chrome.runtime.getURL('focus.html');
const boundCommands=new Set(['toggle','restart','stop','previousSection','nextSection','seekProgress','seekSection','seekChapter','export','exportDocument','openFocus','setOverlayVisible']);
const statusKeys=new Set(['ready','preparing','playing','paused','stopped','completed','reader_error','export_running','export_complete','export_cancelled','premium_locked','save_failed','prepare_failed','export_failed','activation_failed','premium_unavailable','document_unavailable','document_changed','document_too_large','document_images_unavailable','document_prepare_failed','document_export_running','document_export_complete','document_export_failed','document_export_cancelled','document_rasterized','appearance_figures_unavailable']);
const exactKeys=(value,required,optional=[])=>required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const focusUrl=value=>typeof value==='string'&&value.split(/[?#]/,1)[0]===ownFocus;
function cleanSource(value,documentGeneration){return value?.bound===true&&['html','pdf'].includes(value.kind)&&generation(value.generation)&&value.generation===documentGeneration?{bound:true,kind:value.kind,generation:value.generation,overlayVisible:typeof value.overlayVisible==='boolean'?value.overlayVisible:null,overlayPending:value.overlayPending===true,...(typeof value.sourceKey==='string'&&/^[a-f0-9]{64}$/.test(value.sourceKey)?{sourceKey:value.sourceKey}:{})}:null;}
const errorCodes = new Set(['unavailable','timeout','busy','request_conflict','unsupported','ambiguous','tab_changed','browser_unavailable','bridge_failed','prepare_failed','save_failed','closed','forbidden','protocol','invalid','premium_required','premium_locked','premium_unavailable','activation_failed','export_failed','export_busy','export_unavailable','document_unavailable','document_failed','document_too_large','figure_unavailable','document_changed','document_images_unavailable','document_prepare_failed','document_export_failed']);
const failure = error => {const code = error instanceof readerAPI.ReaderError && errorCodes.has(error.code) ? error.code : 'invalid';return {ok: false, code, message: errorText(code)};};
const errorFor = code => failure(new readerAPI.ReaderError(code));

const languageCodes = new Set();
void catalogReady.then(() => {for (const item of uiLanguages) languageCodes.add(item.code);});
const text = (value, limit = 120) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0,limit) : '';
const voiceId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(value);
function premiumUrl(value) {
  try {const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'reader-premium.benotable.de' && !url.username && !url.password && url.port === '' && url.href.length <= 16000 ? url.href : null;}
  catch {return null;}
}
function cleanStatus(value) {
  const settings = value?.settings || {}, engine = value?.engine || {};
  const catalog = (Array.isArray(engine.catalog) ? engine.catalog : Array.isArray(value?.catalog) ? value.catalog : []).slice(0,32).filter(item => typeof item?.code === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(item.code)).map(item => ({code:item.code,label:text(item.label),default:voiceId(item.default) ? item.default : '',voices:(Array.isArray(item.voices) ? item.voices : []).slice(0,64).filter(voice => voiceId(voice?.id)).map(voice => ({id:voice.id,label:text(voice.label),engine:text(voice.engine,40),note:text(voice.note,200)}))}));
  const selectedUiLanguage = languageCodes.has(settings.uiLanguage) ? settings.uiLanguage : languageCodes.has(value?.uiLanguage) ? value.uiLanguage : 'de';
  setUiLanguage(selectedUiLanguage);
  if (actionLanguage !== selectedUiLanguage) {
    actionLanguage = selectedUiLanguage;
    // Only IDs are needed: no document URL/title is read or retained here.
    void chrome.action.setTitle({title:product.name+' · '+t('extPopupTitle')}).catch(()=>{});
    void chrome.tabs.query({}).then(tabs=>Promise.all(tabs.map(tab=>{
      const known=operations.get(tab.id);
      return known ? actionState(tab.id,known.state,known.code,known.kind) : chrome.action.setTitle({tabId:tab.id,title:product.name+' · '+t('extPopupTitle')});
    }))).catch(()=>{});
  }
  const premium = value?.premium || {}, activation = value?.premiumActivation || {}, exported = value?.exportState || {};
  const tier = ['subscription','lifetime','owner'].includes(premium.tier) ? premium.tier : null;
  const enabled = premium.enabled === true && premium.status === 'active' && tier !== null;
  const playback=value?.playback || {};
  const number=(key)=>Number.isFinite(value?.[key] ?? playback[key]) && (value?.[key] ?? playback[key])>=0 ? (value?.[key] ?? playback[key]) : null;
  const count=Number.isSafeInteger(value?.sectionCount ?? playback.sectionCount) && (value?.sectionCount ?? playback.sectionCount)>=0 ? (value?.sectionCount ?? playback.sectionCount) : 0;
  const sectionIndex=Number.isSafeInteger(value?.sectionIndex ?? playback.sectionIndex) ? Math.max(0,Math.min(Math.max(0,count-1),value?.sectionIndex ?? playback.sectionIndex)) : 0;
  const chapters=(Array.isArray(value?.chapters)?value.chapters:[]).filter(item=>typeof item?.label==='string' && Number.isSafeInteger(item.sectionIndex) && item.sectionIndex>=0 && item.sectionIndex<count).map(item=>({label:text(item.label,160),sectionIndex:item.sectionIndex,level:Number.isSafeInteger(item.level)?Math.max(1,Math.min(6,item.level)):1,...(Number.isSafeInteger(item.page) && item.page>=0 ? {page:item.page}:{})}));
  const chapterIndex=Number.isSafeInteger(value?.chapterIndex) && value.chapterIndex>=0 && value.chapterIndex<chapters.length ? value.chapterIndex : -1;
  const ready=value?.ready===true && count>0;
  const controls=Object.fromEntries(['canToggle','canPreviousSection','canNextSection','canSeek','canExport','canCancelExport'].map(key=>[key,value?.controls?.[key]===true]));
  return {
    sourceContext:cleanSource(value?.sourceContext,generation(value?.documentState?.generation)),
    playerTheme:['system','light','dark'].includes(settings.playerTheme??value?.playerTheme)?settings.playerTheme??value.playerTheme:'system',
    statusKey:statusKeys.has(value?.statusKey)?value.statusKey:value?.statusKind==='error'?'reader_error':'ready',statusKind:value?.statusKind==='error'?'error':'info',
    statusParams:Object.fromEntries(['completed','total','current','count','percent'].filter(key=>Number.isFinite(value?.statusParams?.[key])&&value.statusParams[key]>=0).map(key=>[key,value.statusParams[key]])),
    selectionAvailable:value?.selectionAvailable===true,
    appearance:readerAPI.cleanAppearance(settings.appearance ?? value?.appearance),
    documentState:{state:['idle','loading','ready','error'].includes(value?.documentState?.state)?value.documentState.state:'idle',errorKey:errorCodes.has(value?.documentState?.errorKey)?value.documentState.errorKey:'',sectionCount:Number.isSafeInteger(value?.documentState?.sectionCount)?Math.max(0,value.documentState.sectionCount):0,imageCount:Number.isSafeInteger(value?.documentState?.imageCount)?Math.max(0,value.documentState.imageCount):0,generation:generation(value?.documentState?.generation)},
    ready,controls,chapters,chapterIndex,sectionIndex,sectionCount:count,currentSelection:{sectionIndex,sectionCount:count,chapterIndex},
    elapsedSeconds:number('elapsedSeconds'),totalSeconds:number('totalSeconds'),remainingSeconds:number('remainingSeconds'),progressFraction:number('progressFraction')===null?null:Math.min(1,number('progressFraction')),remainingEstimated:(value?.remainingEstimated ?? playback.remainingEstimated)===true,
    productVersion:/^\d+\.\d+\.\d+$/.test(value?.productVersion)?value.productVersion:null,buildHash:/^[a-f0-9]{64}$/.test(value?.buildHash)?value.buildHash:null,protocolVersion:1,
    version:1,uiLanguage:selectedUiLanguage,uiLanguages:[...languageCodes],catalog,
    formatLocale:formatLocales.includes(settings.formatLocale ?? value?.formatLocale)?settings.formatLocale ?? value.formatLocale:'auto',timeFormat:['auto','12h','24h'].includes(settings.timeFormat ?? value?.timeFormat)?settings.timeFormat ?? value.timeFormat:'auto',preferenceVersion:Number.isSafeInteger(value?.preferenceVersion??value?.settingsVersion)&&(value.preferenceVersion??value.settingsVersion)>=0?(value.preferenceVersion??value.settingsVersion):0,
    lastError:errorCodes.has(value?.lastError?.code) ? {code:value.lastError.code} : null,
    settings:{
      appearance:readerAPI.cleanAppearance(settings.appearance ?? value?.appearance),
      speed:Number.isFinite(settings.speed) && settings.speed >= .8 && settings.speed <= 4 ? settings.speed : null,
      ...Object.fromEntries(['follow','clickSeek','autoShow','muted'].map(key => [key,typeof settings[key] === 'boolean' ? settings[key] : null])),
      uiLanguage:selectedUiLanguage,
      playerTheme:['system','light','dark'].includes(settings.playerTheme??value?.playerTheme)?settings.playerTheme??value.playerTheme:'system',
      formatLocale:formatLocales.includes(settings.formatLocale)?settings.formatLocale:'auto',timeFormat:['auto','12h','24h'].includes(settings.timeFormat)?settings.timeFormat:'auto',
      language:settings.language === 'auto' || catalog.some(item => item.code === settings.language) ? settings.language : 'auto',
      voices:Object.fromEntries(catalog.filter(item => voiceId(settings.voices?.[item.code])).map(item => [item.code,settings.voices[item.code]])),
      volume:Number.isFinite(settings.volume) && settings.volume >= 0 && settings.volume <= 150 ? settings.volume : 100,
    },
    engine:{ready:engine.ready === true,voice:voiceId(engine.voice) ? engine.voice : '',voiceLabel:text(engine.voiceLabel),language:text(engine.language,12),activeLanguage:text(engine.activeLanguage,12),detectedLanguage:text(engine.detectedLanguage,12),catalog,providers:Array.isArray(engine.providers) ? engine.providers.filter(name => ['CUDAExecutionProvider','CPUExecutionProvider'].includes(name)) : []},
    premium:{enabled,status:enabled ? 'active' : premium.status === 'free' ? 'free' : 'unavailable',tier:enabled ? tier : null,priceLabel:premium.priceLabel === '2,99 € / Monat' ? premium.priceLabel : '',checkoutUrl:premiumUrl(premium.checkoutUrl),lifetimeUrl:premiumUrl(premium.lifetimeUrl),portalUrl:enabled && tier === 'subscription' ? premiumUrl(premium.portalUrl) : null,accountUrl:product.account||'https://reader-premium.benotable.de/account',donationUrl:product.support},
    premiumActivation:{state:['idle','running','complete','error'].includes(activation.state) ? activation.state : 'idle',errorKey:['activation_failed','premium_unavailable'].includes(activation.errorKey) ? activation.errorKey : ''},
    exportState:{kind:exported.kind==='document'?'document':'audio',state:['idle','running','complete','cancelled','locked','error'].includes(exported.state) ? exported.state : 'idle',percent:Number.isFinite(exported.percent) ? Math.max(0,Math.min(100,exported.percent)) : 0,completedChunks:Number.isInteger(exported.completedChunks) && exported.completedChunks >= 0 ? exported.completedChunks : 0,totalChunks:Number.isInteger(exported.totalChunks) && exported.totalChunks >= 0 ? exported.totalChunks : 0,errorKey:errorCodes.has(exported.errorKey) ? exported.errorKey : ''},
    playback:{playing:playback.playing === true,paused:playback.paused === true},
    components:Object.fromEntries(['extensionApi','bridge','watcher'].map(name => [name,value?.components?.[name] === true])),
  };
}

async function status() {
  if (!statusRequest) {
    statusRequest = readerAPI.status().then(value => ({ok: true, status: cleanStatus(value)})).catch(failure).finally(() => {statusRequest = undefined;});
  }
  return statusRequest;
}

async function actionState(tabId, state, code, kind = 'show') {
  await catalogReady;
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
  if(focusUrl(tab.url))return errorFor('invalid'); // Local surface close is not native document detach.
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

function validSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(key => ['speed','follow','clickSeek','autoShow','uiLanguage','playerTheme','language','voice','volume','muted','formatLocale','timeFormat','appearance'].includes(key)) &&
    (value.appearance===undefined || readerAPI.validAppearance(value.appearance)) &&
    (value.speed === undefined || Number.isFinite(value.speed) && value.speed >= .8 && value.speed <= 4 && Math.abs(value.speed * 20 - Math.round(value.speed * 20)) < 1e-6) &&
    ['follow','clickSeek','autoShow','muted'].every(key => value[key] === undefined || typeof value[key] === 'boolean') &&
    (value.uiLanguage === undefined || languageCodes.has(value.uiLanguage)) &&
    (value.playerTheme===undefined||['system','light','dark'].includes(value.playerTheme)) &&
    (value.formatLocale === undefined || formatLocales.includes(value.formatLocale)) &&
    (value.timeFormat === undefined || ['auto','12h','24h'].includes(value.timeFormat)) &&
    (value.language === undefined || value.language === 'auto' || typeof value.language === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value.language)) &&
    (value.voice === undefined || voiceId(value.voice)&&typeof value.language==='string'&&/^[a-z]{2}(?:-[a-z]{2})?$/.test(value.language)||value.voice&&typeof value.voice==='object'&&!Array.isArray(value.voice)&&exactKeys(value.voice,['language','id'])&&typeof value.voice.language==='string'&&/^[a-z]{2}(?:-[a-z]{2})?$/.test(value.voice.language)&&typeof value.voice.id==='string'&&/^[a-z0-9_:.-]{1,64}$/.test(value.voice.id)) &&
    (value.volume === undefined || Number.isInteger(value.volume) && value.volume >= 0 && value.volume <= 150);
}

function cleanDocument(value){
  const fail=()=>{throw new readerAPI.ReaderError('protocol');};
  if(!value||!generation(value.generation)||value.complete!==true||typeof value.title!=='string'||value.title.length>4096||!['pdf','html'].includes(value.sourceKind)||!Array.isArray(value.sections))return fail();
  const sections=value.sections.map(section=>{
    if(!section||!Number.isSafeInteger(section.index)||section.index<0||typeof section.text!=='string'||(section.heading!==undefined&&typeof section.heading!=='string')||(section.level!==undefined&&(!Number.isSafeInteger(section.level)||section.level<1||section.level>6))||(section.page!==undefined&&(!Number.isSafeInteger(section.page)||section.page<1))||!Array.isArray(section.images))return fail();
    const images=section.images.map(image=>{
      if(!image||typeof image.src!=='string'||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.src)||(image.alt!==undefined&&typeof image.alt!=='string')||(image.caption!==undefined&&typeof image.caption!=='string')||(image.kind!==undefined&&!['image','diagram'].includes(image.kind)))return fail();
      return {src:image.src,alt:image.alt||'',caption:image.caption||'',...(image.kind===undefined?{}:{kind:image.kind})};
    });
    const anchors=section.sourceSections??(section.sourceSection===undefined?[]:[section.sourceSection]);
    if(!Array.isArray(anchors)||anchors.some(index=>!Number.isSafeInteger(index)||index<0)||new Set(anchors).size!==anchors.length||(section.sourceSection!==undefined&&(!Number.isSafeInteger(section.sourceSection)||!anchors.includes(section.sourceSection))))return fail();
    return {index:section.index,text:section.text,images,sourceSections:anchors,...(section.heading===undefined?{}:{heading:section.heading}),...(section.level===undefined?{}:{level:section.level}),...(section.page===undefined?{}:{page:section.page})};
  });
  if(new Set(sections.map(section=>section.index)).size!==sections.length)return fail();
  return {title:value.title,sourceKind:value.sourceKind,language:typeof value.language==='string'?text(value.language,16):'',complete:true,sections,generation:generation(value.generation),presentation:{rasterized:value.presentation?.rasterized===true,searchable:value.presentation?.searchable===true}};
}

async function selectedTab(message,page,sender){
  if(page==='focus.html')return sender.tab?.id===undefined?null:chrome.tabs.get(sender.tab.id).catch(()=>null);
  if(page!=='popup.html')return null;
  if(message.tabId!==undefined)return chrome.tabs.get(message.tabId).catch(()=>null);
  const tabs=await chrome.tabs.query({active:true,currentWindow:true});return tabs[0]||null;
}
async function targetContext(tab,status){
  const source=status?.sourceContext;
  if(!tab||tab.active!==true)return {type:'unsupported',supported:false,bound:false,ready:false,generation:null,code:'tab_changed'};
  if(focusUrl(tab.url)){
    let expected;try{const url=new URL(tab.url);expected=generation(url.hash.match(/^#doc=([a-f0-9-]{16,64})$/i)?.[1]);}catch{}
    const bound=!!expected&&!!source&&expected===source.generation,ready=bound&&status.ready===true;
    return {type:'focus',supported:true,bound,ready,generation:expected||null,code:!source||!expected?'document_unavailable':!bound?'document_changed':!ready?'document_unavailable':null};
  }
  try{
    const url=new URL(tab.url);
    if(['http:','https:','file:'].includes(url.protocol)&&!url.username&&!url.password&&typeof tab.title==='string'&&tab.title.length<=512&&tab.url.length<=8192){
      const verified=verifiedSources.get(tab.id);let matched=false;
      if(source?.sourceKey&&!invalidatedSources.has(tab.id)&&tab.status!=='loading'&&!(source.kind==='html'&&url.search)){
        const normalized=source.kind==='html'?url.origin+url.pathname:(url.hash='',url.href),bytes=new TextEncoder().encode(JSON.stringify([source.kind,normalized,tab.title])),digest=await crypto.subtle.digest('SHA-256',bytes);
        matched=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')===source.sourceKey;
        if(matched){const tabs=await chrome.tabs.query({});matched=tabs.filter(item=>item.url===tab.url&&item.title===tab.title).length===1;}
      }
      const bound=!!source&&(matched||verified?.url===tab.url&&verified.title===tab.title&&verified.generation===source.generation);
      return {type:'source',supported:true,bound,ready:bound&&status?.ready===true,generation:bound?source.generation:null,code:null};
    }
  }catch{}
  return {type:'unsupported',supported:false,bound:false,ready:false,generation:null,code:'unsupported'};
}
async function routedControl(message,page,sender){
  const command=message.command;
  const opening=command==='setOverlayVisible'&&message.value===true;
  if(!boundCommands.has(command))return {ok:true,status:cleanStatus(await readerAPI.control(command,message.value))};
  if(!['popup.html','focus.html'].includes(page))return {ok:true,status:cleanStatus(await readerAPI.control(command,message.value,message.sourceGeneration))};
  const tab=await selectedTab(message,page,sender),fresh=cleanStatus(await readerAPI.status()),target=await targetContext(tab,fresh);
  if(!target.supported)return errorFor(target.code);
  if(target.type==='focus'){
    if(command==='setOverlayVisible')return errorFor('invalid'); // Own focus surface visibility is local, never native detach.
    if(!target.bound||!target.ready)return errorFor(target.code);
    if(message.sourceGeneration!==undefined&&message.sourceGeneration!==target.generation)return errorFor('document_changed');
    return {ok:true,status:cleanStatus(await readerAPI.control(command,message.value,target.generation)),targetContext:target};
  }
  if(!target.bound&&!(['toggle','restart','openFocus'].includes(command)||command==='setOverlayVisible'&&message.value===true))return errorFor('document_changed');
  if(target.bound&&!opening&&message.sourceGeneration!==undefined&&message.sourceGeneration!==target.generation)return errorFor('document_changed');
  if(command==='setOverlayVisible'&&!opening&&target.bound)return {ok:true,status:cleanStatus(await readerAPI.control(command,message.value,target.generation)),targetContext:target};
  // A deliberate source action, never popup opening, prepares the exact active
  // original tab first. The backend reuses already-bound text without recapture.
  if(running.has(tab.id)||running.size>=8)return errorFor('busy');
  const token=crypto.randomUUID();running.set(tab.id,{token,kind:'show'});
  try{
    await readerAPI.show(tab,()=>{if(running.get(tab.id)?.token===token)void actionState(tab.id,'pending');});
    const current=await chrome.tabs.get(tab.id).catch(()=>null);
    if(!current||!current.active||current.url!==tab.url||current.title!==tab.title||running.get(tab.id)?.token!==token)throw new readerAPI.ReaderError('tab_changed');
    const ready=cleanStatus(await readerAPI.status());
    if(!ready.sourceContext||!ready.ready)throw new readerAPI.ReaderError('document_unavailable');
    if(!['toggle','restart','openFocus','setOverlayVisible'].includes(command)&&ready.sourceContext.generation!==target.generation)throw new readerAPI.ReaderError('document_changed');
    const unchanged=await chrome.tabs.get(tab.id).catch(()=>null);
    if(!unchanged||!unchanged.active||unchanged.url!==tab.url||unchanged.title!==tab.title||running.get(tab.id)?.token!==token)throw new readerAPI.ReaderError('tab_changed');
    if(verifiedSources.size>=128&&!verifiedSources.has(tab.id))verifiedSources.delete(verifiedSources.keys().next().value);
    invalidatedSources.delete(tab.id);
    verifiedSources.set(tab.id,{url:tab.url,title:tab.title,generation:ready.sourceContext.generation});
    // Native queued execution also checks this generation: a source change
    // after this status request cannot apply the command to another document.
    const result=await readerAPI.control(command,message.value,ready.sourceContext.generation);
    return {ok:true,status:cleanStatus(result),targetContext:await targetContext(current,cleanStatus(result))};
  }finally{if(running.get(tab.id)?.token===token)running.delete(tab.id);}
}

async function dispatch(message, page, sender) {
  await catalogReady;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return errorFor('invalid');
  if(message.type==='runtimeGet'&&exactKeys(message,['type']))return{ok:true,runtime:await getRuntimeState()};
  if(message.type==='runtimeSet'&&['popup.html','options.html'].includes(page)&&exactKeys(message,['type','mode'])){
    const runtime=await getRuntimeState();if(message.mode===runtime.mode)return{ok:true,runtime};
    if(!['native','browser'].includes(message.mode))return errorFor('invalid');
    if(message.mode==='native'&&(!runtime.canSelectNative||!runtime.nativePermissionGranted))return{ok:false,code:'native_permission_required'};
    const [active]=await chrome.tabs.query({active:true,currentWindow:true});
    if(runtime.nativeEnabled){
      const before=await status();if(!before.ok)return before;
      if(before.status.playback.playing||before.status.playback.paused||before.status.exportState.state==='running')return errorFor('busy');
      const ctx=await targetContext(active,before.status);
      if(ctx.bound&&ctx.type==='source'){
        const hidden=cleanStatus(await readerAPI.control('setOverlayVisible',false,ctx.generation));
        if(hidden.sourceContext?.generation!==ctx.generation||hidden.sourceContext.overlayVisible!==false)return errorFor('document_changed');
      }
    }
    if(active?.id!==undefined){
      let article;try{article=await chrome.tabs.sendMessage(active.id,{channel:'notable-public-player',action:'snapshot'});}catch{/* A tab without an article receiver has nothing to close. */}
      if(article?.ok){
        const state=article.snapshot?.state;
        if(!state||!generation(article.instanceId)||!generation(article.snapshot.generation))return errorFor('protocol');
        if(state.playing||state.paused||state.exportState?.state==='running')return errorFor('busy');
        let hidden;try{hidden=await chrome.tabs.sendMessage(active.id,{channel:'notable-public-player',action:'visible',value:false,instanceId:article.instanceId,generation:article.snapshot.generation});}catch{return errorFor('document_changed');}
        if(hidden?.ok!==true||hidden.instanceId!==article.instanceId||hidden.snapshot?.generation!==article.snapshot.generation||hidden.snapshot.visible!==false)return errorFor('document_changed');
      }else if(article?.code==='document_changed')return errorFor('document_changed');
      await chrome.storage.session.remove('notable.runtime.binding.'+active.id);
    }
    return setRuntimeMode(message.mode);
  }
  const runtime=await getRuntimeState();
  let nativeAllowed=runtime.nativeEnabled;
  if(!nativeAllowed&&runtime.nativePermissionGranted&&runtime.canSelectNative){const selected=await selectedTab(message,page,sender);const key='notable.runtime.binding.'+selected?.id,stored=(await chrome.storage.session.get(key))[key];nativeAllowed=page==='focus.html'||stored?.url===selected?.url&&stored?.mode==='native';}
  if(!nativeAllowed)return errorFor('unavailable');
  if(['premiumStatus','authorizeExport','premiumActivate'].includes(message.type)){
    if(message.type==='premiumStatus'&&exactKeys(message,['type']))return {ok:true,premium:cleanStatus(await readerAPI.status()).premium};
    if(message.type==='authorizeExport'&&exactKeys(message,['type'])){
      const result=await readerAPI.control('authorizeExport');
      return result.authorized===true?{ok:true,authorized:true,premium:cleanStatus(result).premium}:errorFor('premium_locked');
    }
    if(message.type==='premiumActivate'&&exactKeys(message,['type','code'])&&readerAPI.validControl('activatePremium',message.code))return {ok:true,premium:cleanStatus(await readerAPI.control('activatePremium',message.code)).premium};
    return errorFor('invalid');
  }
  if(['reader.html','tools/reader/reader.html'].includes(page))return errorFor('invalid');
  if(message.type==='document'&&page==='focus.html'&&exactKeys(message,['type','sessionId'],['refresh'])&&generation(message.sessionId)&&(message.refresh===undefined||typeof message.refresh==='boolean')){
    for(const [id,item]of documentTransfers)if(item.expires<Date.now())documentTransfers.delete(id);
    if(documentTransfers.size>=2)return errorFor('busy');
    if(documentRequest&&message.refresh===true)return errorFor('busy');
    if(!documentRequest)documentRequest=readerAPI.documentView(message.refresh===true).then(cleanDocument).finally(()=>{documentRequest=undefined;});
    const document=await documentRequest,transferId=crypto.randomUUID();
    if(documentTransfers.size>=2)return errorFor('busy');
    const encoded=JSON.stringify(document);
    documentTransfers.set(transferId,{encoded,sessionId:message.sessionId,ownerTabId:sender.tab?.id,expires:Date.now()+120000});
    setTimeout(()=>documentTransfers.delete(transferId),120000);
    return {ok:true,transferId,length:encoded.length,generation:document.generation};
  }
  if(message.type==='documentChunk'&&page==='focus.html'&&exactKeys(message,['type','transferId','sessionId','offset'])&&generation(message.transferId)&&generation(message.sessionId)&&Number.isSafeInteger(message.offset)&&message.offset>=0){
    const item=documentTransfers.get(message.transferId);
    if(!item||item.sessionId!==message.sessionId||item.ownerTabId!==sender.tab?.id)return errorFor('document_unavailable');
    if(item.expires<Date.now()||message.offset>=item.encoded.length){documentTransfers.delete(message.transferId);return errorFor('document_unavailable');}
    const chunk=item.encoded.slice(message.offset,message.offset+1024*1024),done=message.offset+chunk.length===item.encoded.length;
    if(done)documentTransfers.delete(message.transferId);
    return {ok:true,offset:message.offset,chunk,done};
  }
  if(message.type==='documentRelease'&&page==='focus.html'&&exactKeys(message,['type','transferId','sessionId'])&&generation(message.transferId)&&generation(message.sessionId)){
    if(documentTransfers.get(message.transferId)?.sessionId===message.sessionId&&documentTransfers.get(message.transferId)?.ownerTabId===sender.tab?.id)documentTransfers.delete(message.transferId);
    return {ok:true};
  }
  if (message.type === 'snapshot') {
    if(!exactKeys(message,['type'],['tabId'])||message.tabId!==undefined&&(!Number.isSafeInteger(message.tabId)||message.tabId<0))return errorFor('invalid');
    const tabId = page === 'popup.html' && Number.isInteger(message.tabId) ? message.tabId : null;
    const [connection, operation] = await Promise.all([status(), savedOperation(tabId)]);
    const selected=await selectedTab(message,page,sender);
    return {...connection, operation,...(['popup.html','focus.html'].includes(page)?{targetContext:await targetContext(selected,connection.status)}:{})};
  }
  if (['show', 'hide'].includes(message.type) && page === 'popup.html'&&exactKeys(message,['type','tabId'])) return tabAction(message.tabId, message.type);
  if (message.type === 'settings' && page !== 'help.html' && exactKeys(message,['type','values'],['tabId'])&&validSettings(message.values)) {
    return {ok: true, status: cleanStatus(await readerAPI.settings(message.values))};
  }
  if (message.type === 'control' && page !== 'help.html' && exactKeys(message,['type','command'],['value','tabId','sourceGeneration'])&&(message.tabId===undefined||Number.isSafeInteger(message.tabId)&&message.tabId>=0)&&(message.sourceGeneration===undefined||generation(message.sourceGeneration))&&readerAPI.validControl(message.command,message.value)) {
    if(message.command==='authorizeExport')return errorFor('invalid');
    return routedControl(message,page,sender);
  }
  return errorFor('invalid');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const page = sender.id === chrome.runtime.id && typeof sender.url === 'string'
    ? pages.get(sender.url.split(/[?#]/, 1)[0]) : undefined;
  // Chromium may expose the preceding fragment in sender.tab during a same-
  // document hash update. Match the trusted top-level resource, then validate
  // the live focus generation separately; never admit a web-page iframe.
  if (!page || sender.tab && (sender.frameId!==undefined&&sender.frameId!==0 || typeof sender.tab.url!=='string'||sender.tab.url.split(/[?#]/,1)[0]!==sender.url.split(/[?#]/,1)[0])) return false;
  dispatch(message, page, sender).then(sendResponse).catch(error => sendResponse(failure(error)));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.status !== 'loading' && typeof changes.url !== 'string') return;
  const wasRunning = running.delete(tabId);
  verifiedSources.delete(tabId);
  if(invalidatedSources.size>=256&&!invalidatedSources.has(tabId))invalidatedSources.delete(invalidatedSources.values().next().value);
  invalidatedSources.add(tabId);
  void chrome.storage.session.remove('notable.runtime.binding.'+tabId);
  operations.delete(tabId);
  if (wasRunning) {
    remember(tabId, {state: 'error', code: 'tab_changed', at: Date.now()});
    void actionState(tabId, 'error', 'tab_changed');
  } else {
    void chrome.action.setBadgeText({tabId, text: ''}).catch(() => {});
    void catalogReady.then(() => chrome.action.setTitle({tabId, title: `${product.name} · ${t('extPopupTitle')}`})).catch(() => {});
  }
});
chrome.tabs.onRemoved.addListener(tabId => {void chrome.storage.session.remove('notable.runtime.binding.'+tabId);running.delete(tabId); operations.delete(tabId);verifiedSources.delete(tabId);invalidatedSources.delete(tabId);});
