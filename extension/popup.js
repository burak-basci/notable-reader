import {mountSupportAmount} from './support-amount.mjs';
import {mountReadHome} from './read-home.mjs';
import {installReaderScrollbars} from './scrollbars.mjs';
import {framePermissionUI} from './frame-permissions.mjs';
import {renderSupport as renderSupportTiers} from './pricing.mjs';
import {mountPopupLibrary} from './popup-library.mjs';
import {savedFromStart} from './library/saved.mjs';
import {mountPopupSettings} from './popup-settings.mjs';
import {FilePlayerTransport,isOwnFileUrl} from './file-player-transport.mjs';
import {createFormatting} from './formatting.mjs';
import {appearanceDefaults,cleanAppearance} from './engine-api.js';
import {installSelects,syncSelects} from './selects.js';
import {product,browserKey} from './product-config.js';
import {upgradeSwitches} from './switches.js';
import {applyDocumentColors as paintDocumentColors} from './session/overlay-theme.mjs';
import {engineLines} from './session/diagnose-engine.mjs';
import {TIERS as EXPLAIN_TIERS,manifest as explainManifest} from './explain/model-store.mjs';
import {AI_LANGUAGES} from './explain/tutor-plan.mjs';
import {t, errorText, setUiLanguage, getUiLanguage, translateDOM, uiLanguages, formatLocales, catalogReady} from './i18n.js';
import {MODELS,modelBytes} from './models/registry.js';
import {defaultCombo,formatCombo} from './platform/keycombo.mjs';

await catalogReady;
installReaderScrollbars(document);
const api=globalThis.chrome?.runtime?.id?globalThis.chrome:globalThis.browser;
const formats=createFormatting({formatLocales});

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const page = document.body.dataset.page;
upgradeSwitches();
// Native toolbar popups need their intrinsic 572px size; a tab-hosted view may be narrower.
if(page==='popup' && chrome.extension?.getViews && !chrome.extension.getViews({type:'popup'}).includes(window))document.body.classList.add('tab-hosted-popup');
/* Zoomed native popup: Chrome caps it at 800x600 device px, so 572x580 CSS px are cut off from about 140 % zoom.
   Pin the settled viewport in px (popup.css explains why vw/vh cannot be used there);
   tiny transient sizes are ignored. */
function fitZoomedPopup(){
 const body=document.body;if(page!=='popup'||body.classList.contains('tab-hosted-popup'))return;
 const w=innerWidth,h=innerHeight,narrow=w>=200&&w<572,short=h>=150&&h<580;
 if(!narrow&&!short&&!body.classList.contains('popup-reflow'))return;
 body.classList.add('popup-reflow');
 body.style.setProperty('--popup-w',(narrow?w:572)+'px');body.style.setProperty('--popup-h',(short?h:580)+'px');
}
requestAnimationFrame(()=>requestAnimationFrame(fitZoomedPopup));addEventListener('resize',fitZoomedPopup);
const version = chrome.runtime.getManifest().version;
const settingsHint=/mac|iphone|ipad/i.test(navigator.userAgentData?.platform||navigator.platform||'')?'⌥⇧E':'Alt+Shift+E';
let popupLibrary=null,popupLibraryMount=null,popupSettings=null,popupSettingsMount=null;
let tabId = null, supported = page !== 'popup', connected = false, mutating = false;
let confirmed = null, operation = null, localError = null, snapshotError = null, refreshing = null;
let fileTransport=null,frameAccess=null,frameAccessRevision=0,pendingFrameAction=null,readHome=null,supportAmount=null;
// The tab's title is shown only while it is being read (Read tab main action); a selection is probed as a yes/no only.
let currentTabTitle='',selectionAvailable=false,selectionProbe=null;
let toastTimer, lastDiagnosis = '', settingsRevision = 0, operationRevision = 0, tabSubmitting = false;
// pageKind: why this tab cannot be read ('page' = try normally). lastAction: what "Try again" repeats.
let pageKind = 'page', lastAction = null, explainBytes = 0;
// A start on this address found no readable text: the Read tab shows the empty-page card from then on (no dead buttons).
let noTextUrl = null;
const noTextHere = () => !!noTextUrl && noTextUrl === currentTabUrl;
// Size of the local explanation model, from the same manifest its downloader verifies against.
/* The explanation card names the download of the model the guided explanation offers first: the 'better' tier where its pinned manifest
   runs in this browser (a WebGPU model needs navigator.gpu), else 'small' (explain/tutor.mjs: better || small). Read from the manifests of
   explain/model-store.mjs, never a fixed size, so a model change carries its size along. */
(async()=>{for(const tier of ['better','small']){if(!EXPLAIN_TIERS[tier]?.manifest)continue;try{const m=await explainManifest(tier);if(m.device==='webgpu'&&!globalThis.navigator?.gpu)continue;explainBytes=(m.files||[]).reduce((sum,file)=>sum+(Number(file.bytes)||0),0);renderEntry();return;}catch{}}})();
const errorFor = code => ({code:code || 'invalid',message:errorText(code)});
let latestStatus = null, lastSnapshot = null, currentTabUrl=null,  targetContext=null, localizedLanguage=null;
const regional=()=>formats.preferences(confirmed || latestStatus?.settings || latestStatus || {});
const formatNumber=(value,options={})=>formats.number(value,regional(),options);

// Live sliders: send while dragging (throttled, last value guaranteed), never overwritten by stale snapshots,
// never disabled while saving. A choice stays authoritative until a snapshot carries the same value or a newer preferenceVersion.
const SLIDER_THROTTLE_MS=80,SLIDER_EXPIRE_MS=5000;
const sliderSpecs={
  followPosition:{id:'#follow-position',out:'#follow-position-value',fmt:v=>v+' %',payload:v=>({followPosition:v}),ok:'extFollowSaved'},
  followMargin:{id:'#follow-margin',out:'#follow-margin-value',fmt:v=>v+' %',payload:v=>({followMargin:v}),ok:'extFollowSaved'},
  volume:{id:'#volume',out:'#volume-value',fmt:v=>formatNumber(v)+' %',payload:v=>({volume:v,...(v>0?{muted:false}:{})}),ok:'extVolumeSaved'},
};
const sliderState=Object.fromEntries(Object.keys(sliderSpecs).map(key=>[key,{dragging:false,choice:null,timer:0,lastSent:-Infinity,inflight:false,dirty:false,inputAt:0}]));
const statusVersion=()=>Number(latestStatus?.preferenceVersion??latestStatus?.settings?.preferenceVersion)||0;
function sliderBusy(key){const st=sliderState[key];return st.inflight||!!st.timer||st.dirty;}
function sliderHeld(key){const st=sliderState[key],el=$(sliderSpecs[key].id);return st.dragging||!!st.choice||!!el&&document.activeElement===el&&Date.now()-st.inputAt<1500;}
function settleSlider(key,value){
  // Settled only by a snapshot (never by our own save reply): same value, or reported at/after the version our save produced.
  const st=sliderState[key];if(!st.choice||sliderBusy(key))return;
  const ch=st.choice;
  if(value===ch.value||ch.ack!==undefined&&statusVersion()>=ch.ack||Date.now()-ch.at>SLIDER_EXPIRE_MS)st.choice=null;
}
function showSlider(key,value){
  const spec=sliderSpecs[key],el=$(spec.id);if(!el||!Number.isFinite(value))return;
  settleSlider(key,value);
  if(sliderHeld(key))return;
  el.value=String(value);const out=$(spec.out);if(out)out.textContent=spec.fmt(Number(el.value));
}
async function flushSlider(key){
  const st=sliderState[key],spec=sliderSpecs[key];
  clearTimeout(st.timer);st.timer=0;
  if(st.inflight||!st.dirty||!st.choice)return;
  st.inflight=true;st.dirty=false;st.lastSent=performance.now();
  const sent=st.choice.value;st.choice.ack=undefined;st.choice.at=Date.now();
  if($('#save-status'))$('#save-status').textContent=t('extSaving');
  const result=await message({type:'settings',values:spec.payload(sent)});
  st.inflight=false;
  if(!result.ok){
    st.choice=null;st.dirty=false;localError=errorFor(result.code);
    applySettings(confirmed,true);if($('#save-status'))$('#save-status').textContent=t('extNotSaved');render();return;
  }
  latestStatus=result.status||latestStatus;
  if(st.dirty){scheduleSlider(key);return;}
  if(st.choice){st.choice.at=Date.now();st.choice.ack=statusVersion();}
  if($('#save-status'))$('#save-status').textContent=t(spec.ok);
  const values=result.status?.settings;if(values)confirmed={...confirmed,...values,...formats.preferences(values)};
}
function scheduleSlider(key,now=false){
  const st=sliderState[key],wait=now?0:Math.max(0,SLIDER_THROTTLE_MS-(performance.now()-st.lastSent));
  if(st.timer&&!now)return;clearTimeout(st.timer);
  if(wait===0){st.timer=0;void flushSlider(key);}else st.timer=setTimeout(()=>{st.timer=0;void flushSlider(key);},wait);
}
function bindSlider(key){
  const spec=sliderSpecs[key],el=$(spec.id);if(!el)return;const st=sliderState[key];
  const release=()=>{st.dragging=false;if(st.dirty)scheduleSlider(key,true);};
  el.addEventListener('pointerdown',()=>{st.dragging=true;});
  window.addEventListener('pointerup',()=>{if(st.dragging)release();});
  window.addEventListener('pointercancel',()=>{if(st.dragging)release();});
  el.addEventListener('input',()=>{
    const value=Number(el.value);st.inputAt=Date.now();
    const out=$(spec.out);if(out)out.textContent=spec.fmt(value);
    st.choice={value,at:Date.now()};st.dirty=true;scheduleSlider(key);
  });
  // change fires on release/keyboard commit: make sure the final value is sent now.
  el.addEventListener('change',()=>{st.dragging=false;const value=Number(el.value);if(!st.choice||st.choice.value!==value){st.choice={value,at:Date.now()};st.dirty=true;}if(st.dirty)scheduleSlider(key,true);});
}

async function message(value) {
  if(Number.isInteger(tabId)&&['snapshot','control','settings'].includes(value.type)&&value.tabId===undefined)value={...value,tabId};
  if(fileTransport&&!(value.type==='control'&&['readPage','readSelection','selectArea','captureArea','saveForLater','openSettings','openDownload','pickNextChapter'].includes(value.command))){const expected=value.fileContext||(targetContext?.type==='file'?{instanceId:targetContext.instanceId,generation:targetContext.generation}:undefined);const result=await fileTransport.send(value,expected);if(value.type==='control'&&value.command==='downloadResult'&&result.ok)window.close();return result;}
  try { return await chrome.runtime.sendMessage(value) || {ok: false, ...errorFor('closed')}; }
  catch { return {ok: false, ...errorFor('closed')}; }
}

/* Short confirmation at the bottom; with undo it stays a little longer and offers "Undo" (library removals). */
let toastUndo=null;
function notify(text,{undo=null}={}) {
  clearTimeout(toastTimer);
  const toast=$('#toast'),label=$('#toast-text')||toast,button=$('#toast-undo');
  label.textContent = text;toastUndo=undo;
  if(button)button.hidden=!undo;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true;toastUndo=null; }, undo?8000:4000);
}
$('#toast-undo')?.addEventListener('click',async()=>{const undo=toastUndo;toastUndo=null;$('#toast').hidden=true;clearTimeout(toastTimer);if(undo){await undo();notify(t('popupUndone'));}});

function publicLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

async function openPage(name) {
  await chrome.tabs.create({url: chrome.runtime.getURL(name)});
}

function applySettings(values,force=false) {
  if (!values || mutating) return;
  confirmed = {...values,...formats.preferences(values)};
  setUiLanguage(values.uiLanguage);
  localize();
  applyDocumentColors();
  applyAdvancedSettings(values);
  applyAppearance(values.appearance,force);
  if ($('#speed') && Number.isFinite(values.speed)) $('#speed').value = String(Math.round(values.speed * 100) / 100);
  showSlider('followPosition',values.followPosition);
  if($('#follow-mode')&&['paragraph','section','line'].includes(values.followMode))$('#follow-mode').value=values.followMode;
  showSlider('followMargin',values.followMargin);
  if ($('#follow') && typeof values.follow === 'boolean') $('#follow').checked = values.follow;
  if ($('#clickseek') && typeof values.clickSeek === 'boolean') $('#clickseek').checked = values.clickSeek;
  if ($('#autoshow') && typeof values.autoShow === 'boolean') $('#autoshow').checked = values.autoShow;$('#autoshow')?.setAttribute('aria-checked',String($('#autoshow').checked));
}

function showError(value) {
  if(!$('#errorbox'))return;
  if($('#errorbox').hidden !== !value)$('#errorbox').hidden = !value;
  if (!value) return;
  // Render a fixed local message: no raw backend exceptions or page content.
  // Writes only on change: the box is role=alert and the status poll renders every 1.5 s.
  const error = errorFor(value.code);
  stableText('#error-title', value.code === 'embedded_permission_required' ? t('extEmbeddedPermissionTitle') : value.code === 'unsupported' ? t('extUnsupportedTitle') : value.code === 'unavailable' ? t('extUnavailableTitle') : t('extErrorTitle'));
  stableText('#error-message', error.message);
  stableText('#error-code', t('extErrorCode',{code:error.code}));
}

// Support copy lives in ui-locales.json; the cards and the own-amount form render from the same catalog.
function renderSupport(){if(!$('#support-tiers'))return;if(!supportAmount)supportAmount=mountSupportAmount($('#support-custom-host'),{base:product.support,language:getUiLanguage,t:(key,vars)=>t(key,vars)});supportAmount?.refresh();const lang=getUiLanguage();const cards=$('#support-tiers');if(cards&&cards.dataset.language!==lang){renderSupportTiers(cards,{t,lang,urls:product.supportTiers});cards.dataset.language=lang;}const manage=$('#support-manage');if(manage){const url=publicLink(product.supportPortal);manage.hidden=!url;if(url)manage.href=url;manage.textContent=t('supportManage');}}
function render() {
  renderConnection();
  renderSupport();
  renderEntry();
  $$('[data-appearance],[data-appearance-reset]').forEach(node=>{node.disabled=!connected||mutating;});
  $('#toggle-theme')?.toggleAttribute('disabled',!connected||mutating);
  const pending = operation?.state === 'pending';
  const passiveError=!supported?null:snapshotError;
  const error = localError || (operation?.state === 'error' ? errorFor(operation.code) : null) || passiveError;
  renderUnavailable();
  showError(error?.code==='embedded_permission_required'&&frameUI.hasAccess()||error?.code==='pdf_viewer'?null:error);
  syncReadBlocked();
  $$('#speed, #follow, #follow-mode, #clickseek, #autoshow, #ui-language, #document-language, #voice, #muted, #player-theme, [data-control]').forEach(control => {control.disabled = !connected || mutating;});
  for(const key of Object.keys(sliderSpecs)){const el=$(sliderSpecs[key].id);if(el)el.disabled=!connected&&!sliderState[key].dragging;}
  for(const node of $$('[data-control=resetBar]'))node.hidden=!!fileTransport;
  if($('#autoshow')){$('#autoshow').closest('label').hidden=!!fileTransport;$('#autoshow').disabled=!!fileTransport||!connected||mutating;}
  syncSelects();centerIcons();
}

/* While an error or a frame permission request is shown, the last reading position steps aside (popup.css), so the
   Read tab never ends in a cut-off card. */
function syncReadBlocked(){const shown=id=>{const node=$(id);return !!node&&!node.hidden;};document.body.classList.toggle('read-blocked',shown('#errorbox')||shown('#frame-access'));}

/* Voice engine numbers for the diagnosis (GPU/CPU, workers, real-time factor, phases), answered by the engine host. */
let engineReport = null;
async function hostCall(message, ms = 2500) {
  try { return await Promise.race([chrome.runtime.sendMessage({target: 'host', ...message}), new Promise(resolve => setTimeout(() => resolve(null), ms))]); } catch { return null; }
}
async function loadEngineReport() {
  const answer = await hostCall({t: 'diagnose'});
  if (answer?.ok) { engineReport = {...answer, bench: engineReport?.bench}; if (lastSnapshot) diagnosis(lastSnapshot); }
}
function diagnosis(snapshot) {
  const status = snapshot?.status;
  const yes = value => value ? t('extYes') : t('extNo');
  const text = [
    `${product.name} · ${t('extDiagnostics')}`,
    `${t('extDiagVersion')}: ${version}`,
    `${t('extDiagVoiceReady')}: ${status ? yes(status.engine.ready) : t('extUnknown')}`,
    `${t('extDiagVoice')}: ${[status?.engine.voiceLabel || status?.engine.voice, status?.engine.activeLanguage || status?.engine.language].filter(Boolean).join(' · ') || t('extUnknown')}`,
    `${t('extDiagAudio')}: ${status ? status.playback.playing ? status.playback.paused ? t('extAudioPaused') : t('extAudioPlaying') : t('extAudioStopped') : t('extUnknown')}`,
    `${t('extDiagOperation')}: ${operation?.code || t('extNone')}`,
    `${t('extDiagError')}: ${localError?.code || snapshotError?.code || (operation?.state === 'error' ? operation.code : t('extNone'))}`,
    ...engineLines(engineReport, t('extDiagEngine')),
  ].join('\n');
  lastDiagnosis = text;
  stableText('#diagnostics',text);
}

async function refresh() {
  if (refreshing) return refreshing;
  const revision = settingsRevision, requestOperationRevision = operationRevision;
  refreshing = (async () => {
    // The popup shows no voice list: polls leave the voice catalog (hundreds of entries) in the page.
    const result = await message({type: 'snapshot', catalog: false, ...(Number.isInteger(tabId) ? {tabId} : {})});
    connected = result.ok === true;
    latestStatus = result.ok ? result.status : null;
    if(result.targetContext){targetContext=result.targetContext;supported=targetContext.supported===true&&(!!fileTransport||pageKind==='page')&&!noTextHere();}
    lastSnapshot = result;
    snapshotError = result.ok ? result.status?.lastError ? errorFor(result.status.lastError.code) : null : errorFor(result.code);
    if (!tabSubmitting && requestOperationRevision === operationRevision && Object.hasOwn(result, 'operation')) operation = result.operation;

    if (result.ok) {
      if (revision === settingsRevision) applySettings(result.status.settings);
      if ($('#save-status') && !mutating) $('#save-status').textContent = t('extSettingsLoaded');
    } else if ($('#save-status') && !mutating) $('#save-status').textContent = t('extSettingsUnavailable');
    render();
    diagnosis(result);
  })().finally(() => {refreshing = null;});
  return refreshing;
}

async function mutate(value, success) {
  if (mutating) return false;
  mutating = true;
  settingsRevision++;
  localError = null;
  if ($('#save-status') && value.type==='settings') $('#save-status').textContent = t('extSaving');
  render();
  const result = await message(value);
  mutating = false;
  settingsRevision++;
  if(result.frameAccess!==undefined){frameAccess=result.frameAccess;frameAccessRevision++;}else if(result.ok&&value.type==='control'){frameAccess=null;frameAccessRevision++;}
  if (result.ok) {
    latestStatus = result.status || latestStatus;
    applySettings(result.status?.settings);
    if ($('#save-status') && success) $('#save-status').textContent = t(success);
    if(success)notify(t(success));
  } else {
    localError = {...errorFor(result.code), ...(typeof result.url === 'string' ? {url: result.url} : {})};
    if (!(value.type === 'control' && lastAction?.command === value.command)) lastAction = {value, success};
    applySettings(confirmed,true);
    if ($('#save-status')) $('#save-status').textContent = t('extNotSaved');
  }
  render();
  return result.ok === true;
}


/* Popup texts of the reading entry (shared catalog). */
const ENTRY_KEYS={webOnly:'popupWebOnly',permissionDenied:'popupChapterPermission',saved:'popupSavedToList',unsupported:'popupUnsupported',
 ready:'popupReady',playingDocument:'popupPlayingDocument',selectionHint:'popupReadSelectionHint'};
const frameUI=framePermissionUI({root:$('#frame-access'),api,language:getUiLanguage,current:()=>({tabId,url:currentTabUrl}),hasPending:()=>!!pendingFrameAction,busy:()=>mutating,notify,onStale:()=>{pendingFrameAction=null;frameAccess=null;frameAccessRevision++;localError=errorFor('tab_changed');render();},prepare:async expected=>{
 const intent=pendingFrameAction;pendingFrameAction=null;
 if(intent&&intent.tabId===expected.tabId&&intent.url===expected.url){await runEntry(intent.command);return;}
 const ok=await mutate({type:'control',command:'prepare',tabId:expected.tabId,sourceURL:expected.url},null);await refresh();
 if(!ok&&localError?.code==='embedded_permission_required')frameUI.reveal();
}});
const entryText=key=>t(ENTRY_KEYS[key]||key);
/* What the main Read action does right now: open the bar on this page (paused, owner request round 3: opening never starts the sound),
   start reading in the bar that is already open ('ready'), or pause/resume the session that reads it. */
function heroState(){
 const playback=latestStatus?.playback,bound=targetContext?.bound===true&&!fileTransport;
 if(!bound||!playback)return 'idle';
 if(playback.loading&&!playback.playing)return 'loading';
 if(playback.playing)return playback.paused?'paused':'playing';
 return latestStatus?.sourceContext?.overlayVisible===true?'ready':'idle';
}
const clock=seconds=>{const s=Math.max(0,Math.round(Number(seconds)||0)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=String(s%60).padStart(2,'0');return h?h+':'+String(m).padStart(2,'0')+':'+r:m+':'+r;};
const HERO_GLYPH={idle:'<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',ready:'<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',paused:'<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
 playing:'<path d="M8 5v14M16 5v14" stroke-width="4"/>',loading:'<path d="M12 4.5a7.5 7.5 0 1 0 7.5 7.5" stroke-width="2.6" stroke-linecap="round"/>'};
function renderHero(){
 const hero=$('#entry-read');if(!hero)return;
 const state=heroState(),active=state!=='idle'&&state!=='ready';
 if(hero.dataset.heroState!==state){hero.dataset.heroState=state;hero.querySelector('.read-play svg').innerHTML=HERO_GLYPH[state];}
 const label=t(state==='playing'?'popupPause':state==='paused'?'popupContinue':state==='loading'?'popupPreparing':state==='ready'?'popupStartReading':'popupReadPage');
 stableText('#read-hero-label',label);if(!active){const key=state==='ready'?'popupStartReadingHint':'popupReadPageHint';$('#read-hero-hint').dataset.i18n=key;stableText('#read-hero-hint',t(key));}
 $('#read-hero-hint').hidden=active;$('#read-hero-now').hidden=!active;
 if(active){
  const title=currentTabTitle||t('popupThisPage');stableText('#read-hero-title',title);
  const fraction=Number.isFinite(latestStatus?.progressFraction)?latestStatus.progressFraction:null;
  $('#read-hero-bar').style.width=fraction===null?'0':(Math.round(fraction*1000)/10)+'%';
  const elapsed=latestStatus?.elapsedSeconds,remaining=latestStatus?.remainingSeconds;
  stableText('#read-hero-time',Number.isFinite(elapsed)&&Number.isFinite(remaining)?t('elapsed')+' '+clock(elapsed)+' · '+t('remaining')+' '+clock(remaining):fraction!==null?new Intl.NumberFormat(getUiLanguage(),{style:'percent',maximumFractionDigits:0}).format(fraction):'');
  hero.setAttribute('aria-label',label+': '+title);
 } else hero.removeAttribute('aria-label');
 const stop=$('#entry-stop');if(stop)stop.hidden=!active;
}
/* Is text selected in the page? Only a yes/no comes back (no text), through the access the toolbar click granted. */
async function probeSelection(){
 if(page!=='popup'||!Number.isInteger(tabId)||fileTransport||pageKind!=='page'||!supported||!chrome.scripting?.executeScript){selectionAvailable=false;return;}
 if(selectionProbe)return selectionProbe;
 const func=()=>{const s=globalThis.getSelection();return !!s&&!s.isCollapsed&&String(s).trim().length>0;};
 selectionProbe=(async()=>{
  let found=false;
  try{found=(await chrome.scripting.executeScript({target:{tabId,allFrames:true},func})).some(row=>row?.result===true);}
  catch{try{found=(await chrome.scripting.executeScript({target:{tabId},func}))[0]?.result===true;}catch{found=false;}}
  if(found!==selectionAvailable){selectionAvailable=found;renderEntry();}
 })().finally(()=>{selectionProbe=null;});
 return selectionProbe;
}
function renderEntry(){
 if(typeof ENTRY_KEYS==='undefined')return;
 frameUI.update(frameAccess);
 if(!readHome)readHome=mountReadHome($('#panel-read'),{t,language:getUiLanguage,skipUrl:()=>heroState()!=='idle'?currentTabUrl:null,onResume:async id=>{await openPage('tools/reader/reader.html#history='+id);window.close();},onLibrary:async name=>{selectPopupTab('library');const lib=await ensurePopupLibrary();lib.selectTab?.(name);}});
 if(!document.body.dataset.popupTab||document.body.dataset.popupTab==='read')void readHome?.refresh();
 const file=!!fileTransport||targetContext?.type==='file';
 for(const node of $$('[data-entry]')){const webOnly=file&&['selectArea','captureArea','pickNextChapter','explainPage','readSelection'].includes(node.dataset.entry);node.disabled=!supported||mutating||webOnly;if(webOnly)node.title=entryText('webOnly');else node.removeAttribute('title');}
 const selection=$('#entry-selection');if(selection){selection.hidden=!selectionAvailable||file;selection.title=entryText('selectionHint');}
 // Web-only page tools are not offered as dead cards in the file view's Read tab (Extras lists them as unavailable).
 const explain=$('#entry-explain');if(explain)explain.hidden=file;
 // Download opens the bar's menu in the document: offered on a page, and in the file view once a document is loaded.
 const download=$('#entry-download');if(download){download.hidden=file&&!downloadInDocument();download.disabled=!supported||mutating;}
 // The side-action hints are clamped to two lines; their full text stays available as the tooltip.
 for(const node of $$('.read-actions .read-action')){const hint=node.querySelector('small')?.textContent.trim();if(hint&&!node.title)node.title=node.querySelector('strong').textContent.trim()+': '+hint;}
 // The local explanation names its one-time model download before the click, but only where it explains with AI
 // (explain/tutor-plan.mjs AI_LANGUAGES): in other interface languages it starts the key-sentence tour without download.
 if(!AI_LANGUAGES.includes(String(getUiLanguage()||'').slice(0,2))&&$('#explain-hint'))stableText('#explain-hint',t('extExplainKeyPassages'));
 else if(explainBytes&&$('#explain-hint')){
  const size=new Intl.NumberFormat(getUiLanguage(),{style:'unit',unit:'megabyte',maximumFractionDigits:0})
   .format(Math.round(explainBytes/1e6));
  stableText('#explain-hint',t('extExplainSize',{size}));
 }
 renderHero();
 popupLibrary?.availability?.();
}
async function runEntry(command){
 if(mutating)return false;
 pendingFrameAction=null;lastAction={command};
 if(command==='pickNextChapter'){try{const u=new URL(currentTabUrl);if(!['http:','https:'].includes(u.protocol)||!await chrome.permissions.request({origins:[u.origin+'/*']})){notify(entryText('permissionDenied'));return false;}}catch{notify(entryText('permissionDenied'));return false;}}
 const expected={tabId,url:currentTabUrl},fromLibrary=document.body.dataset.popupTab==='library';
 const ok=await mutate({type:'control',command,...(Number.isInteger(tabId)?{tabId}:{})},null);
 if(!ok&&localError?.code==='embedded_permission_required'&&frameAccess){pendingFrameAction={...expected,command};selectPopupTab('read');frameUI.update(frameAccess,{show:true});syncReadBlocked();return false;}
 // No readable text on this page: the Read tab's empty-page card says so and offers the sample and "Open file" instead of
 // buttons that would fail again (Read, Download, Summarize hide with it).
 if(!ok&&localError?.code==='no_readable_text'&&!fileTransport&&currentTabUrl===expected.url){noTextUrl=currentTabUrl;supported=false;localError=null;selectPopupTab('read');render();return false;}
 // The library tab hides the shared error card: its own actions report failures in the toast.
 if(!ok&&fromLibrary&&localError){notify(errorText(localError.code));localError=null;render();return false;}
 if(ok&&command==='saveForLater')notify(entryText('saved'));
 else if(ok&&command==='addBookmark'){notify(t('popupBookmarkSaved'));void readHome?.refresh(true);}
 else if(ok&&['explainPage','readPage','readSelection','selectArea','captureArea','openSettings','openDownload','pickNextChapter'].includes(command))window.close();
 return ok;
}
/* "Save this page" (Saved list): at the spot being read when reading has started on this page (a bound session with a
   position past the start: stored as a bookmark), otherwise from the start (stored as a listening-list item). Saving a
   page that is already saved from its start again is skipped. */
async function savePage(){
 if(hasReadingSpot())return runEntry('addBookmark');
 if(await savedFromStart(currentTabUrl).catch(()=>false)){notify(t('popupLibAlreadySaved'));return false;}
 return runEntry('saveForLater');
}
function hasReadingSpot(){
 if(!supported||fileTransport||pageKind!=='page'||targetContext?.bound!==true)return false;
 return !['idle','ready'].includes(heroState())||Number(latestStatus?.progressFraction)>0||Number(latestStatus?.elapsedSeconds)>0;   // an open bar that has not read yet holds no reading spot
}
/* Download: ONE menu for both popup entries (Read tile "Download" and Extras "Create audiobook"): the reading bar's own
   download menu (session/download-menu.mjs), opened in the document by the openDownload workflow. Only the document's
   session holds what that menu offers (whole text / from here / selection, the voice, the running job, the finished file,
   which is saved by itself), so the short-lived popup asks for it and closes instead of keeping a second menu. Without a
   readable document (browser pages, a page found empty, an empty file view) the file view opens, whose bar carries the
   same menu once a file or text is loaded. */
function downloadInDocument(){return supported&&(fileTransport||targetContext?.type==='file'?targetContext?.ready===true:pageKind==='page'&&!noTextHere());}
async function openDownloadMenu(){
 if(mutating)return false;
 if(!downloadInDocument()){await openPage('tools/reader/reader.html');window.close();return true;}
 return runEntry('openDownload');
}
async function togglePlayback(){await mutate({type:'control',command:'toggle'},null);await refresh();}
$$('[data-entry]').forEach(button=>button.addEventListener('click',()=>{if(button.id==='entry-read'&&heroState()!=='idle'){void togglePlayback();return;}void runEntry(button.dataset.entry);}));
$('#entry-download')?.addEventListener('click',()=>void openDownloadMenu());
$('#entry-sidebar')?.addEventListener('click',async()=>{
 try{
  if(api.sidebarAction?.open){await api.sidebarAction.open();window.close();}
  else if(await chrome.permissions.request({permissions:['sidePanel']})&&chrome.sidePanel?.open){await chrome.sidePanel.open({...(Number.isInteger(tabId)?{tabId}:{windowId:(await chrome.windows.getCurrent()).id})});window.close();}
  else {await openPage('sidebar.html'+(Number.isInteger(tabId)?'?tabId='+tabId:''));window.close();}
 }catch{await openPage('sidebar.html'+(Number.isInteger(tabId)?'?tabId='+tabId:''));window.close();}
});

$$('[data-product]').forEach(node => {node.textContent = product.name;});
localize();
$('#version').textContent = `v${version}`;
const website = publicLink(product.website);
if (website) {
  $('#website-link').disabled = false;
  $('#website-link').textContent = t('extWebsite');
  $('#website-link').addEventListener('click', () => chrome.tabs.create({url: website}));
}
const support = publicLink(product.support);
for (const link of $$('[data-donation-link]')) {link.hidden=!support;if(support&&!link.hasAttribute('data-custom-amount'))link.href=support;}
if ($('#support-link') && support && !$('#support-link').hasAttribute('data-custom-amount')) {
  $('#support-link').href = support;
  $('#support-link').hidden = false;
  $('#support-unavailable')?.setAttribute('hidden','');
}
$$('[data-help]').forEach(button => button.addEventListener('click', () => openPage('help.html')));
$('#open-welcome')?.addEventListener('click', () => { void openPage('welcome.html'); });
// Open the shared settings controls directly in the popup tab.
async function openDocumentSettings(){selectPopupTab('settings');}
$('#open-settings')?.addEventListener('click',openDocumentSettings);
$('#open-support')?.addEventListener('click',()=>selectPopupTab('support'));
window.addEventListener('keydown',event=>{if(event.altKey&&event.shiftKey&&!event.ctrlKey&&!event.metaKey&&event.code==='KeyE'){event.preventDefault();void openDocumentSettings();}},true);
$('#speed')?.replaceChildren(...[document.createElement('option'), ...Array.from({length:65}, (_, i) => {
  const option = document.createElement('option'), value = Math.round((.8 + i * .05) * 100) / 100;
  option.value = String(value); option.textContent = formatNumber(value,{maximumFractionDigits:2}) + '×'; return option;
})]);
if ($('#speed')) {
  const placeholder = $('#speed').options[0];
  placeholder.value = ''; placeholder.textContent = t('extLoading'); placeholder.disabled = true; placeholder.selected = true;
  $('#speed').addEventListener('change', () => mutate({type:'settings', values:{speed:Number($('#speed').value)}}, 'extSpeedSaved'));
}
for(const key of Object.keys(sliderSpecs))bindSlider(key);
$('#follow-mode')?.addEventListener('change',()=>mutate({type:'settings',values:{followMode:$('#follow-mode').value}},'extFollowSaved'));
$('#follow')?.addEventListener('change', () => mutate({type:'settings', values:{follow:$('#follow').checked}}, 'extFollowSaved'));
$('#autoshow')?.addEventListener('change', () => $('#autoshow').setAttribute('aria-checked',String($('#autoshow').checked)));
$('#autoshow')?.addEventListener('change', () => mutate({type:'settings', values:{autoShow:$('#autoshow').checked}}, 'extAutoShowSaved'));
$('#clickseek')?.addEventListener('change', () => mutate({type:'settings', values:{clickSeek:$('#clickseek').checked}}, 'extClickSeekSaved'));
$$('[data-control]').forEach(button=>button.addEventListener('click',()=>mutate({type:'control',command:button.dataset.control},null)));
$('#refresh')?.addEventListener('click', async () => {
  localError = null;
  await Promise.all([refresh(), loadEngineReport()]);
  if (connected) notify(t('extConnectionConfirmed'));
});
// "Try again" repeats what failed; without a remembered action it can only re-check the status.
$('#retry')?.addEventListener('click', async () => {
  const action = lastAction;
  localError = null;
  if (action?.command) { await runEntry(action.command); return; }
  if (action?.value) { await mutate(action.value, action.success); return; }
  await refresh();
  if (connected) notify(t('extConnectionConfirmed'));
});
async function ensurePopupLibrary(){
 if(!popupLibraryMount)popupLibraryMount=mountPopupLibrary($('#popup-library-host'),{t,language:getUiLanguage,notify,
  canAct:()=>supported&&!fileTransport&&pageKind==='page',onAction:command=>command==='savePage'?savePage():runEntry(command),
  onOpen:async name=>{await openPage(name);window.close();}}).then(value=>popupLibrary=value);
 await popupLibraryMount;await popupLibrary.refresh();return popupLibrary;
}
async function ensurePopupSettings(){
 if(!popupSettingsMount)popupSettingsMount=mountPopupSettings($('#popup-settings-host'),{getTabId:()=>tabId,onSaved:values=>{applySettings(values,true);popupLibrary?.setLanguage(values.uiLanguage||getUiLanguage());},onError:error=>{localError=errorFor((typeof error==='string'?error:error?.code)||'save_failed');render();}}).then(value=>{
  popupSettings=value;const root=value?.shadow||$('#popup-settings-host').shadowRoot;
  return value;});
 await popupSettingsMount;await popupSettings.refresh();return popupSettings;
}
function selectPopupTab(name){
 document.body.dataset.popupTab=name;
 const button=$$('[data-tab]').find(tab=>tab.dataset.tab===name);if(!button)return;
 $$('[data-tab]').forEach(tab=>{const selected=tab===button;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
 $$('.body>[role=tabpanel]').forEach(panel=>{panel.hidden=panel.id!==button.getAttribute('aria-controls');});
 // The header's settings and support buttons show which of their tabs is open.
 for(const [id,tab] of [['#open-settings','settings'],['#open-support','support']]){const node=$(id);if(node)node.toggleAttribute('data-active',name===tab);}
 if(name!=='library')popupLibrary?.stopAudio?.();
 if(name==='library')void ensurePopupLibrary().catch(()=>notify(entryText('unsupported')));
 if(name==='settings')void ensurePopupSettings().catch(error=>{localError=errorFor((typeof error==='string'?error:error?.code)||'save_failed');render();});
 window.dispatchEvent(new CustomEvent('notable-popup-tab',{detail:{name}}));centerIcons();
}
window.selectPopupTab=selectPopupTab;
$$('[data-tab]').forEach(button=>button.addEventListener('click',()=>selectPopupTab(button.dataset.tab)));
$('.tabs')?.addEventListener('keydown', event => {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  const tabs = $$('[data-tab]'), index = tabs.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].click(); tabs[next].focus();
});
$('#copy-diagnostics')?.addEventListener('click', async () => {
  await Promise.all([refresh(), loadEngineReport()]);
  try { await navigator.clipboard.writeText(lastDiagnosis); notify(t('extDiagnosisCopied')); }
  catch {
    $('#manual-copy').value = lastDiagnosis; $('#manual-copy').hidden = false; $('#manual-copy').style.height=$('#manual-copy').scrollHeight+'px'; $('#manual-copy').focus(); $('#manual-copy').select();
    notify(t('extDiagnosisManual'));
  }
});


function centerIcons(){for(const svg of $$('svg:not(.icon-defs)')){if(svg.dataset.centered)continue;try{svg.setAttribute('viewBox','0 0 24 24');svg.querySelectorAll('use').forEach(node=>{node.setAttribute('width','24');node.setAttribute('height','24');});const b=svg.getBBox();if(!b.width&&!b.height)continue;const dx=12-b.x-b.width/2,dy=12-b.y-b.height/2;if(Math.abs(dx)>.01||Math.abs(dy)>.01){const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.setAttribute('transform',`translate(${dx} ${dy})`);group.append(...svg.childNodes);svg.append(group);}svg.dataset.centered='true';}catch{}}}

/* Help page: the browser-wide commands with the keys the person really has, the bar's modifier and voice sizes
   from the model catalog (same first-voice rule as the welcome page). */
const HELP_COMMANDS=[['_execute_action','extWelcomeKeyOpen'],['toggle-play','kbPlayPause'],
 ['previous-section','kbPreviousSection'],['next-section','kbNextSection']];
const ARROW_CODES={Left:'ArrowLeft',Right:'ArrowRight',Up:'ArrowUp',Down:'ArrowDown'};
const keyText=shortcut=>formatCombo(shortcut.replace(/ Arrow$/,'').split('+')
 .map(part=>ARROW_CODES[part]||(/^[A-Z]$/.test(part)?'Key'+part:part)).join('+'))||shortcut;
const firstVoice=language=>Object.values(MODELS)
 .find(m=>!m.experimental&&m.tier==='best'&&m.languages?.includes(language));
async function renderHelp(){
 if(page!=='help'||!$('#help-key-list'))return;
 let commands=[];try{commands=await chrome.commands?.getAll?.()||[];}catch{}
 $('#help-key-list').replaceChildren(...HELP_COMMANDS.flatMap(([name,label])=>{
  const shortcut=commands.find(item=>item.name===name)?.shortcut||'';
  const term=document.createElement('dt'),key=document.createElement('kbd'),text=document.createElement('dd');
  key.textContent=shortcut?keyText(shortcut):t('extWelcomeKeyUnset');term.append(key);text.textContent=t(label);
  return [term,text];
 }));
 const mod=formatCombo(defaultCombo('KeyK')).replace(/\+?K$/,'');
 $('#help-keys-bar').textContent=t('extHelpKeysBar',{mod,settings:t('settings'),keyboard:t('kbSettingsTitle')});
 const language=getUiLanguage(),names=new Intl.DisplayNames([language],{type:'language'}),
  mb=new Intl.NumberFormat(language,{style:'unit',unit:'megabyte',maximumFractionDigits:0});
 const sizes=(['de','en'].includes(language)?['en','de']:[language,'en']).map(code=>[code,firstVoice(code)])
  .filter(([,m])=>m).map(([code,m])=>names.of(code)+' '+mb.format(Math.round(modelBytes(m)/1e6))).join(', ');
 $('#help-voices-text').textContent=t('extHelpVoices',{sizes});
}
$('#open-options')?.addEventListener('click',()=>void openPage('popup.html#tab=settings'));
function localize() {
  if(localizedLanguage!==getUiLanguage()){localizedLanguage=getUiLanguage();translateDOM();renderSupport();popupLibrary?.setLanguage(localizedLanguage);void renderHelp();}
  document.title = `${product.name} · ${t(page === 'help' ? 'extHelpTitle' : 'extPopupTitle')}`;
  if ($('#website-link') && !$('#website-link').disabled) $('#website-link').textContent = t('extWebsite');
  if(page==='popup'&&$('#open-settings')){const label=t('extOpenSettings');$('#open-settings').title=label+' ('+settingsHint+')';$('#open-settings').setAttribute('aria-label',label);$('#open-settings').setAttribute('aria-keyshortcuts','Alt+Shift+E');}
  if ($('#speed')) for (const option of $('#speed').options) option.textContent = option.value ? formatNumber(Number(option.value),{maximumFractionDigits:2})+'×' : t('extLoading');
  if (lastSnapshot) diagnosis(lastSnapshot);
  renderEntry();
}
/* The overlay colours also colour this page itself (popup / options page, their dropdown menus): popup.css reads the same variables the surface uses, the helper in overlay-theme.mjs maps them. */
function applyDocumentColors(theme){
 const mode=confirmed?.playerTheme;
 paintDocumentColors(document.documentElement,theme||confirmed?.overlayTheme,mode==='dark'||mode!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches);
}
matchMedia('(prefers-color-scheme:dark)').addEventListener?.('change',()=>applyDocumentColors());
function applyAppearance(value,force=false){
 const appearance=cleanAppearance(value);
 document.documentElement.dataset.readerTheme=['dark','light'].includes(confirmed?.playerTheme)?confirmed.playerTheme:'';
 const themeToggle=$('#toggle-theme');if(themeToggle){const dark=appearance.mode==='dark'||appearance.mode==='auto'&&matchMedia('(prefers-color-scheme:dark)').matches,label=t(dark?'disablePageAppearance':'enableDarkAppearance');themeToggle.dataset.state=appearance.mode;themeToggle.setAttribute('aria-pressed',String(dark));themeToggle.title=label;themeToggle.setAttribute('aria-label',label);themeToggle.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24">'+(dark?'<path d="M20 14a8 8 0 0 1-10-10 9 9 0 1 0 10 10zM14 14l2 2 4-4"/>':'<path d="M20 14a8 8 0 0 1-10-10 9 9 0 1 0 10 10z"/>')+'</svg>';}
 for(const node of $$('[data-appearance]')){
  const field=node.dataset.appearance,current=appearance[field];
  if(node.getAttribute('role')==='switch')node.checked=current;
  else if(force||document.activeElement!==node||mutating)node.value=String(current);
  const output=node.closest('label')?.querySelector('output');
  if(output)output.textContent=formatNumber(Number(node.value),{maximumFractionDigits:1});
 }
}
function chooseOptions(select, entries, selected) {
  if (!select) return;
  const signature = JSON.stringify(entries);
  if (select.dataset.entries !== signature) {
    select.replaceChildren(...entries.map(([value,label]) => {const item=document.createElement('option');item.value=value;item.textContent=label;return item;}));
    select.dataset.entries=signature;
  }
  select.value=selected;
}
function applyAdvancedSettings(values) {
  chooseOptions($('#player-theme'),[['system',t('playerThemeSystem')],['light',t('appearanceLight')],['dark',t('appearanceDark')]],values.playerTheme||'system');
  chooseOptions($('#ui-language'),uiLanguages.map(item=>[item.code,item.label]),values.uiLanguage);
  const catalog = latestStatus?.catalog || [];
  chooseOptions($('#document-language'),[['auto',t('extAutoLanguage')],...catalog.map(item=>[item.code,item.label])],values.language);
  const active=values.language === 'auto' ? latestStatus?.engine.activeLanguage : values.language;
  const entry=catalog.find(item=>item.code===active) || catalog.find(item=>item.voices.some(voice=>voice.id===latestStatus?.engine.voice));
  chooseOptions($('#voice'),(entry?.voices || []).map(voice=>[voice.id,voice.label]),values.voices?.[entry?.code] || latestStatus?.engine.voice);
  showSlider('volume',values.volume);
  if ($('#muted')) $('#muted').checked=values.muted === true;
  if ($('#voice-label')) $('#voice-label').textContent=latestStatus?.engine.voiceLabel || latestStatus?.engine.voice || t('extUnknown');
}
function renderConnection() {
  if(fileTransport)$('#connection').dataset.state = connected ? latestStatus?.engine.ready ? 'ready' : 'loading' : 'error';
  if(fileTransport){stableText('#connection-label',connected?t('extFilePlayerConnected'):errorText(snapshotError?.code||'document_unavailable'));return;}
  stableText('#connection-label', !supported ? entryText('unsupported') : entryText(latestStatus?.playback?.playing&&targetContext?.bound===true ? 'playingDocument' : 'ready'));
  $('#connection').dataset.state=supported?'ready':'error';
  // The Read card explains an unreadable tab; a second grey status line would only repeat it.
  const hide=page==='popup'&&!supported;if($('#connection').hidden!==hide)$('#connection').hidden=hide;
}
function stableText(selector,value){const node=$(selector);if(node&&node.textContent!==value)node.textContent=value;}
/* Why a tab cannot be read. Store pages and browser-internal schemes are closed to every extension;
   own pages and new tabs simply have nothing to read; file:// depends on the per-extension switch. */
const browserName=()=>(navigator.userAgentData?.brands||[]).map(item=>item.brand).join(' ')+(navigator.brave?' Brave':'');
const storeHost=url=>browserKey(api)==='firefox'?url.hostname==='addons.mozilla.org'
 :url.hostname==='chromewebstore.google.com'||url.hostname==='chrome.google.com'&&url.pathname.startsWith('/webstore')
 ||/Edge/.test(browserName())&&url.hostname==='microsoftedge.microsoft.com';
async function pageKindOf(tab){
 let url;try{url=new URL(tab?.url);}catch{return 'empty';}
 if(['http:','https:'].includes(url.protocol))return storeHost(url)?'protected':'page';
 if(url.protocol==='file:'){
  try{return await api.extension?.isAllowedFileSchemeAccess?.()===false?'local-file':'page';}catch{return 'page';}
 }
 const nothing=url.href.startsWith(api.runtime.getURL(''))||url.href==='about:blank'||/^about:(newtab|home)$/.test(url.href)
  ||/^[a-z]+:\/\/(newtab|new-tab-page)\b/.test(url.href);
 return nothing?'empty':'protected';
}
function fileAccessText(){
 if(browserKey(api)==='firefox')return t('extFileAccessFirefox');
 const name=browserName(),scheme=/Edge/.test(name)?'edge':/Brave/.test(name)?'brave':/Opera/.test(name)?'opera':'chrome';
 const key=scheme==='chrome'&&/Google Chrome/.test(name)?'extFileAccessChrome':'extFileAccessBrowser';
 return t(key,{path:scheme+'://extensions'});
}
// A failed read in the browser's own PDF viewer comes back as pdf_viewer; the card offers the file view instead.
function pdfProblem(){
 const hit=[localError,operation?.state==='error'?operation:null,snapshotError].find(item=>item?.code==='pdf_viewer');
 return hit?{url:hit.url||currentTabUrl}:null;
}
function renderUnavailable(){
 const card=$('#read-unavailable');if(!card)return;
 const kind=pdfProblem()?'pdf':!supported&&page==='popup'&&!fileTransport?pageKind==='page'?'empty':pageKind:'';
 if(card.hidden!==!kind)card.hidden=!kind;
 const panel=$('#panel-read');if(panel.dataset.readState!==(kind||'page'))panel.dataset.readState=kind||'page';
 if(!kind)return;
 const text=kind==='pdf'?errorText('pdf_viewer'):kind==='local-file'?fileAccessText():t('extEmptyPage');
 stableText('#read-unavailable-text',text);
 const reason=$('#read-unavailable-reason');reason.hidden=kind!=='protected';
 if(kind==='protected')stableText('#read-unavailable-reason',t('extProtectedPage'));
 $('#play-sample').hidden=kind==='pdf'||kind==='local-file';
 $('#open-in-file-view').hidden=kind!=='pdf';
}
/* The sample uses the same one-time hand-off as "open in reader": the file view reads and deletes this entry. */
$('#play-sample')?.addEventListener('click',async()=>{
 const id=crypto.randomUUID(),sample={text:t('extSampleText'),title:t('extSampleTitle'),language:getUiLanguage(),
  chapters:[],created:Date.now(),sample:true,autoplay:true};
 try{await api.storage.session.set({['notable-incoming-'+id]:sample});}
 catch{notify(errorText('save_failed'));return;}
 await openPage('tools/reader/reader.html#incoming='+id);window.close();
});
$('#open-in-file-view')?.addEventListener('click',async()=>{
 const url=pdfProblem()?.url,source=typeof url==='string'&&/^https?:/i.test(url)?url:'';
 // the tab id lets the file view read this PDF inside its tab while the popup click's access lasts (activeTab)
 await openPage('tools/reader/reader.html'+(source?'#pdf='+encodeURIComponent(source)+(Number.isInteger(tabId)?'&tab='+tabId:''):''));
 window.close();
});
$('#player-theme')?.addEventListener('change',()=>mutate({type:'settings',values:{playerTheme:$('#player-theme').value}},'extSettingsLoaded'));
$('#ui-language')?.addEventListener('change',()=>mutate({type:'settings',values:{uiLanguage:$('#ui-language').value}},'extUiLanguageSaved'));
$('#document-language')?.addEventListener('change',()=>mutate({type:'settings',values:{language:$('#document-language').value}},'extLanguageSaved'));
$('#voice')?.addEventListener('change',()=>mutate({type:'settings',values:{voice:$('#voice').value}},'extVoiceSaved'));
$('#muted')?.addEventListener('change',()=>mutate({type:'settings',values:{muted:$('#muted').checked}},'extVolumeSaved'));
$('#toggle-theme')?.addEventListener('click',()=>mutate({type:'control',command:'toggleTheme'},null));
$$('[data-appearance]').forEach(node=>{
 node.addEventListener('input',()=>{const output=node.closest('label')?.querySelector('output');if(output)output.textContent=formatNumber(Number(node.value),{maximumFractionDigits:1});});
 node.addEventListener('change',()=>{const value=node.getAttribute('role')==='switch'?node.checked:['range','number'].includes(node.type)||node.dataset.appearance==='pdfDpi'?Number(node.value):node.value;void mutate({type:'settings',values:{appearance:{[node.dataset.appearance]:value}}},'extSettingsLoaded');});
});
$$('[data-appearance-reset]').forEach(node=>node.addEventListener('click',()=>mutate({type:'settings',values:{appearance:{...appearanceDefaults}}},'extSettingsLoaded')));


async function initialize() {
  if (page === 'popup') {
    try {
      const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
      tabId = Number.isInteger(tab?.id) ? tab.id : null;
      const url = new URL(tab?.url);if(isOwnFileUrl(tab?.url))fileTransport=new FilePlayerTransport(tabId);
      supported = !!fileTransport || ['http:', 'https:', 'file:'].includes(url.protocol) && !url.username && !url.password && typeof tab?.title === 'string';
      currentTabUrl=tab?.url||null;currentTabTitle=typeof tab?.title==='string'?tab.title.trim():'';
      if(!fileTransport){pageKind=await pageKindOf(tab);if(pageKind!=='page')supported=false;}
    } catch {
      supported = false;pageKind='empty';
    }
  }
  document.body.classList.toggle('file-transport',!!fileTransport);
  render();
  await refresh();
  void probeSelection();
  if(supported&&!fileTransport){const revision=frameAccessRevision;void message({type:'frameAccess',...(Number.isInteger(tabId)?{tabId}:{})}).then(r=>{if(revision===frameAccessRevision&&r.ok&&r.frameAccess){frameAccess=r.frameAccess;render();}});}
  const requested=new URLSearchParams(location.hash.slice(1)).get('tab');if(['read','extras','library','settings','support'].includes(requested))selectPopupTab(requested);
  void loadEngineReport();
  let pollTicks = 0;
  const poll = setInterval(() => {if (!document.hidden && !mutating) { void refresh(); if (++pollTicks % 4 === 0) {void loadEngineReport();void probeSelection();} }}, 1500);
  window.addEventListener('pagehide', () => clearInterval(poll), {once:true});
}
installSelects();
void initialize();

// Optional document tools: keep the existing companion controls and design.
document.querySelectorAll('[data-reader-tool]').forEach(button=>button.addEventListener('click',async()=>{
 /* "Create audiobook": the same download menu as the Read tile (openDownloadMenu); a failed start reports there and never opens a second view */
 if(button.dataset.readerTool==='audiobook'){void openDownloadMenu();return;}
 chrome.tabs.create({url:chrome.runtime.getURL('tools/reader/reader.html')});
}));
