import {createRuntimeTransport} from './runtime-router.mjs';
import {mountBoundPlayer,visibleBoundFocusSection,resolveBoundFocusView} from './player-adapter.mjs';
import {FilePlayerTransport,isOwnFileUrl} from './file-player-transport.mjs';
import {createFormatting} from './formatting.mjs';
import {appearanceDefaults,cleanAppearance} from './reader-api.js';
import {installSelects,syncSelects} from './selects.js';
import {product} from './product-config.js';
import {mountFeedback} from './feedback.mjs';
import {t, errorText, setUiLanguage, getUiLanguage, translateDOM, uiLanguages, formatLocales, catalogReady} from './i18n.js';

await catalogReady;
const formats=createFormatting({formatLocales});

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const page = document.body.dataset.page;
// Native toolbar popups need their intrinsic 572px size; a tab-hosted view may be narrower.
if(page==='popup' && chrome.extension?.getViews && !chrome.extension.getViews({type:'popup'}).includes(window))document.body.classList.add('tab-hosted-popup');
const version = chrome.runtime.getManifest().version;
let feedback = null, tabId = null, supported = page !== 'popup', connected = false, mutating = false;
let confirmed = null, operation = null, localError = null, snapshotError = null, refreshing = null;
let overlayPending=false,fileTransport=null,runtimeTransport=null,runtimeState=null;
let toastTimer, lastDiagnosis = '', settingsRevision = 0, operationRevision = 0, tabSubmitting = false;
const errorFor = code => ({code:code || 'invalid',message:errorText(code)});
let latestStatus = null, lastSnapshot = null, currentTabTitle = null, sharedPlayer=null, targetContext=null, localizedLanguage=null;
const regional=()=>formats.preferences(confirmed || latestStatus?.settings || latestStatus || {});
const formatNumber=(value,options={})=>formats.number(value,regional(),options);

async function message(value) {
  if(runtimeTransport){const expected=value.fileContext||(targetContext?.type==='file'?{instanceId:targetContext.instanceId,generation:targetContext.generation}:undefined);const result=value.type==='snapshot'?await runtimeTransport.snapshot():await runtimeTransport.send(value,expected);if(value.type==='control'&&value.command==='downloadResult'&&result.ok)window.close();return result;}
  try { return await chrome.runtime.sendMessage(value) || {ok: false, ...errorFor('closed')}; }
  catch { return {ok: false, ...errorFor('closed')}; }
}

function notify(text) {
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}

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
  applyAdvancedSettings(values);
  applyAppearance(values.appearance,force);
  if ($('#speed') && Number.isFinite(values.speed)) $('#speed').value = String(Math.round(values.speed * 100) / 100);
  if ($('#follow') && typeof values.follow === 'boolean') $('#follow').checked = values.follow;
  if ($('#clickseek') && typeof values.clickSeek === 'boolean') $('#clickseek').checked = values.clickSeek;
  if ($('#autoshow') && typeof values.autoShow === 'boolean') $('#autoshow').checked = values.autoShow;
}

function showError(value) {
  if(!$('#errorbox'))return;
  $('#errorbox').hidden = page==='popup' || !value;
  if (!value || page==='popup') return;
  // Render a fixed local message: no raw backend exceptions or page content.
  const error = errorFor(value.code);
  $('#error-title').textContent = value.code === 'unsupported' ? t('extUnsupportedTitle') : value.code === 'unavailable' ? t('extUnavailableTitle') : t('extErrorTitle');
  $('#error-message').textContent = error.message;
  $('#error-code').textContent = t('extErrorCode',{code:error.code});
}

function render() {
  if ($('#tab-title')) $('#tab-title').textContent=currentTabTitle || t('extNoTab');
  if ($('#tab-description')) $('#tab-description').textContent=t(currentTabTitle ? supported ? 'extTabDescription' : 'extTabUnsupported' : 'extOpenDocumentHint');
  renderConnection();
  renderPremium();
  void renderOverlayState();
  sharedPlayer?.update(latestStatus,{connected,errorCode:localError?.code || snapshotError?.code || (targetContext?.supported===false?'unsupported':null)});
  if(runtimeTransport?.kind==='article'&&sharedPlayer){const link=sharedPlayer.surface.shadow.querySelector('.premium-checkout');link.hidden=false;link.textContent=t('extBrowserReaderHandoff');link.href=chrome.runtime.getURL('reader.html');link.onclick=event=>{event.preventDefault();void sharedPlayer.command('openFocus');};}
  const appearanceFields=Array.isArray(latestStatus?.controls?.appearanceFields)?new Set(latestStatus.controls.appearanceFields):null;
  $$('[data-appearance],[data-appearance-reset]').forEach(node=>{node.disabled=!connected||mutating||!!(appearanceFields&&node.dataset.appearance&&!appearanceFields.has(node.dataset.appearance));});
  $('#open-focus')?.toggleAttribute('disabled',!connected||mutating||runtimeTransport?.kind==='browser-global');
  $('#toggle-theme')?.toggleAttribute('disabled',!connected||mutating);
  if($('#regional-preview')) $('#regional-preview').textContent=formats.clock(new Date(Date.now()),regional())+' · '+formatNumber(1234.5,{maximumFractionDigits:1});
  const pending = operation?.state === 'pending';
  const error = localError || (operation?.state === 'error' ? errorFor(operation.code) : null) || (page === 'popup' && !supported ? errorFor('unsupported') : null) || snapshotError;
  showError(error);
  $$('#speed, #follow, #clickseek, #autoshow, #ui-language, #format-locale, #time-format, #document-language, #voice, #volume, #muted, #player-theme, [data-control]').forEach(control => {control.disabled = !connected || mutating;});
  for(const node of $$('[data-control=resetBar]'))node.hidden=!!fileTransport;
  if($('#autoshow')){const browser=runtimeTransport&&runtimeTransport.kind!=='native';$('#autoshow').closest('label').hidden=!!browser;$('#autoshow').disabled=!!browser||!connected||mutating;}
  if($('#voice')&&!latestStatus?.catalog?.length){$('#voice').disabled=true;$('#document-language').disabled=true;}
  renderRuntime();
  syncSelects();centerIcons();
}

function diagnosis(snapshot) {
  const status = snapshot?.status;
  const yes = value => value ? t('extYes') : t('extNo');
  const text = [
    `${product.name} · ${t('extDiagnostics')}`,
    `${t('extDiagVersion')}: ${version}`,
    `${t('extDiagProtocol')}: ${status?.version || t('extUnknown')}`,
    `${t('extDiagReachable')}: ${yes(snapshot?.ok === true)}`,
    `${t('extDiagVoiceReady')}: ${status ? yes(status.engine.ready) : t('extUnknown')}`,
    `${t('extDiagVoice')}: ${status?.engine.voiceLabel || status?.engine.voice || t('extUnknown')} · ${status?.engine.activeLanguage || status?.engine.language || t('extUnknown')}`,
    `${t('extDiagAudio')}: ${status ? status.playback.playing ? status.playback.paused ? t('extAudioPaused') : t('extAudioPlaying') : t('extAudioStopped') : t('extUnknown')}`,
    ...(runtimeTransport?.kind!=='native'?['browserPlayer','localView']:['extensionApi', 'bridge', 'watcher']).map(name => `${name}: ${status ? yes(status.components[name]) : t('extUnknown')}`),
    `${t('extDiagOperation')}: ${operation?.code || t('extNone')}`,
    `${t('extDiagError')}: ${localError?.code || snapshotError?.code || (operation?.state === 'error' ? operation.code : t('extNone'))}`,
  ].join('\n');
  lastDiagnosis = text;
  stableText('#diagnostics',text);
}

async function refresh() {
  if (refreshing) return refreshing;
  const revision = settingsRevision, requestOperationRevision = operationRevision;
  refreshing = (async () => {
    const result = await message({type: 'snapshot', ...(Number.isInteger(tabId) ? {tabId} : {})});
    connected = result.ok === true;
    latestStatus = result.ok ? result.status : null;
    if(result.targetContext){targetContext=result.targetContext;supported=targetContext.supported===true;}if(runtimeTransport?.kind!=='native'&&result.ok&&page==='popup')currentTabTitle=result.title||currentTabTitle||t('extFiles');
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
  if (mutating) return;
  mutating = true;
  settingsRevision++;
  localError = null;
  if ($('#save-status') && value.type==='settings') $('#save-status').textContent = t('extSaving');
  render();
  const result = await message(value);
  mutating = false;
  settingsRevision++;
  if (result.ok) {
    latestStatus = result.status || latestStatus;
    applySettings(result.status?.settings);
    if ($('#save-status') && success) $('#save-status').textContent = t(success);
    if(success)notify(t(success));
  } else {
    localError = errorFor(result.code);
    applySettings(confirmed,true);
    if ($('#save-status')) $('#save-status').textContent = t('extNotSaved');
  }
  render();
  await refresh();
}

$$('[data-product]').forEach(node => {node.textContent = product.name;});
localize();
$('#version').textContent = `v${version}`;
const website = publicLink(product.website);
if (website) {
  $('#website-link').disabled = false;
  $('#website-link').textContent = t('extWebsite');
  $('#website-link').addEventListener('click', () => chrome.tabs.create({url: website}));
}
const support = publicLink(product.support) || 'https://buy.stripe.com/cNi7sM72dbaU3w6eY7aVa00';
for (const link of $$('[data-donation-link]')) {link.href=support;link.hidden=false;}
if ($('#support-link') && support) {
  $('#support-link').href = support;
  $('#support-link').hidden = false;
  $('#support-unavailable')?.setAttribute('hidden','');
}
$$('[data-help]').forEach(button => button.addEventListener('click', () => openPage('help.html')));
$('#open-options')?.addEventListener('click', () => fileTransport?$('#tab-settings')?.click():chrome.runtime.openOptionsPage());
$('#speed')?.replaceChildren(...[document.createElement('option'), ...Array.from({length:65}, (_, i) => {
  const option = document.createElement('option'), value = Math.round((.8 + i * .05) * 100) / 100;
  option.value = String(value); option.textContent = formatNumber(value,{maximumFractionDigits:2}) + '×'; return option;
})]);
if ($('#speed')) {
  const placeholder = $('#speed').options[0];
  placeholder.value = ''; placeholder.textContent = t('extLoading'); placeholder.disabled = true; placeholder.selected = true;
  $('#speed').addEventListener('change', () => mutate({type:'settings', values:{speed:Number($('#speed').value)}}, 'extSpeedSaved'));
}
$('#follow')?.addEventListener('change', () => mutate({type:'settings', values:{follow:$('#follow').checked}}, 'extFollowSaved'));
$('#autoshow')?.addEventListener('change', () => mutate({type:'settings', values:{autoShow:$('#autoshow').checked}}, 'extAutoShowSaved'));
$('#clickseek')?.addEventListener('change', () => mutate({type:'settings', values:{clickSeek:$('#clickseek').checked}}, 'extClickSeekSaved'));
$$('[data-control]').forEach(button=>button.addEventListener('click',()=>page==='popup'?sharedPlayer?.command(button.dataset.control):mutate({type:'control',command:button.dataset.control},'extBarReset')));
for (const selector of ['#refresh', '#retry']) $(selector)?.addEventListener('click', async () => {
  localError = null;
  await refresh();
  if (connected) notify(t('extConnectionConfirmed'));
});
$$('[data-tab]').forEach(button => button.addEventListener('click', () => {
  $$('[data-tab]').forEach(tab => {const selected = tab === button; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;});
  $$('[role=tabpanel]').forEach(panel => {panel.hidden = panel.id !== button.getAttribute('aria-controls');});
  centerIcons();
}));
$('.tabs')?.addEventListener('keydown', event => {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  const tabs = $$('[data-tab]'), index = tabs.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].click(); tabs[next].focus();
});
$('#copy-diagnostics')?.addEventListener('click', async () => {
  await refresh();
  try { await navigator.clipboard.writeText(lastDiagnosis); notify(t('extDiagnosisCopied')); }
  catch {
    $('#manual-copy').value = lastDiagnosis; $('#manual-copy').hidden = false; $('#manual-copy').style.height=$('#manual-copy').scrollHeight+'px'; $('#manual-copy').focus(); $('#manual-copy').select();
    notify(t('extDiagnosisManual'));
  }
});


function centerIcons(){for(const svg of $$('svg:not(.icon-defs)')){if(svg.dataset.centered)continue;try{svg.setAttribute('viewBox','0 0 24 24');svg.querySelectorAll('use').forEach(node=>{node.setAttribute('width','24');node.setAttribute('height','24');});const b=svg.getBBox();if(!b.width&&!b.height)continue;const dx=12-b.x-b.width/2,dy=12-b.y-b.height/2;if(Math.abs(dx)>.01||Math.abs(dy)>.01){const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.setAttribute('transform',`translate(${dx} ${dy})`);group.append(...svg.childNodes);svg.append(group);}svg.dataset.centered='true';}catch{}}}

function localize() {
  if(localizedLanguage!==getUiLanguage()){localizedLanguage=getUiLanguage();translateDOM();const mount=$('#feedback-mount');if(mount){feedback?.destroy();feedback=mountFeedback(mount,{lang:localizedLanguage,version,endpoint:product.feedback});}}
  document.title = `${product.name} · ${t(page === 'options' ? 'extOptionsTitle' : page === 'help' ? 'extHelpTitle' : 'extPopupTitle')}`;
  if ($('#website-link') && !$('#website-link').disabled) $('#website-link').textContent = t('extWebsite');
  if ($('#speed')) for (const option of $('#speed').options) option.textContent = option.value ? formatNumber(Number(option.value),{maximumFractionDigits:2})+'×' : t('extLoading');
  if (lastSnapshot) diagnosis(lastSnapshot);
  const browser=runtimeTransport?.kind&&runtimeTransport.kind!=='native';
  if(page==='help'){if($('#native-help'))$('#native-help').hidden=!!browser;if($('#browser-help'))$('#browser-help').hidden=!browser;for(const key of ['extHelpIntro','extHelpContents','extHelpLocal']){const node=document.querySelector('[data-i18n='+key+']');if(node)stableText('[data-i18n='+key+']',t(key+(browser?'Browser':'')));}if(browser)stableText('[data-i18n=extHelpPremium]',t('extPremiumCompact'));}
}
function applyAppearance(value,force=false){
 const appearance=cleanAppearance(value);
 document.documentElement.dataset.readerTheme=['dark','light'].includes(confirmed?.playerTheme)?confirmed.playerTheme:'';
 $('#toggle-theme')?.setAttribute('aria-pressed',String(appearance.mode==='dark'||appearance.mode==='auto'&&matchMedia('(prefers-color-scheme:dark)').matches));
 for(const node of $$('[data-appearance]')){
  const field=node.dataset.appearance,current=appearance[field];
  if(node.type==='checkbox')node.checked=current;
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
  const preferences=formats.preferences(values);chooseOptions($('#format-locale'),formats.regions(getUiLanguage(),t('formatAutomatic')),preferences.formatLocale);chooseOptions($('#time-format'),[['auto',t('formatAutomatic')],['12h',t('time12h')],['24h',t('time24h')]],preferences.timeFormat);
  const catalog = latestStatus?.catalog || [];
  chooseOptions($('#document-language'),[['auto',t('extAutoLanguage')],...catalog.map(item=>[item.code,item.label])],values.language);
  const active=values.language === 'auto' ? latestStatus?.engine.activeLanguage : values.language;
  const entry=catalog.find(item=>item.code===active) || catalog.find(item=>item.voices.some(voice=>voice.id===latestStatus?.engine.voice));
  chooseOptions($('#voice'),(entry?.voices || []).map(voice=>[voice.id,voice.label]),values.voices?.[entry?.code] || latestStatus?.engine.voice);
  if ($('#volume')) {$('#volume').max=String(latestStatus?.engine?.volumeMax===100?100:150);$('#volume').value=String(values.volume);}
  if ($('#volume-value')) $('#volume-value').textContent=`${formatNumber(values.volume)} %`;
  if ($('#muted')) $('#muted').checked=values.muted === true;
  if ($('#voice-label')) $('#voice-label').textContent=latestStatus?.engine.voiceLabel || latestStatus?.engine.voice || t('extUnknown');
}
function renderConnection() {
  $('#connection').dataset.state = connected ? latestStatus?.engine.ready ? 'ready' : 'loading' : 'error';
  if(runtimeTransport?.kind&&runtimeTransport.kind!=='native'){stableText('#connection-label',connected?t(runtimeTransport.kind==='file'?'extFilePlayerConnected':'extRuntimeBrowser'):errorText(snapshotError?.code||'document_unavailable'));return;}
  $('#connection-label').textContent = connected ? latestStatus?.engine.ready ? t('extConnectionReady',{voice:latestStatus.engine.voiceLabel || latestStatus.engine.voice || t('extUnknown')}) : t('extConnectionPreparing') : t('extConnectionFailed');
}
function stableText(selector,value){const node=$(selector);if(node&&node.textContent!==value)node.textContent=value;}
function renderPremium() {
  if (!$('#premium-state')) return;
  const premium = connected ? latestStatus?.premium : null;
  const active = premium?.enabled === true;
  stableText('#premium-state',t(active ? premium.tier === 'owner' ? 'extPremiumOwner' : premium.tier === 'lifetime' ? 'extPremiumLifetime' : 'extPremiumActive' : premium?.status === 'free' ? 'extPremiumInactive' : 'extPremiumUnavailable'));
  stableText('#premium-price',t(premium?.priceLabel?'extPremiumPrice':'extPremiumPriceUnavailable'));
  $('#premium-price').hidden=false;
  const account=publicLink(product.account);const accountLink=$('#premium-account');if(accountLink){accountLink.hidden=!account;if(account)accountLink.href=account;}
  const portal=$('#premium-portal');if(portal){portal.hidden=!premium?.portalUrl;if(premium?.portalUrl)portal.href=premium.portalUrl;else portal.removeAttribute('href');}
  const activation=latestStatus?.premiumActivation;
  $('#activate-premium').disabled=!connected || mutating || activation?.state==='running';
  $('#activation-code').disabled=!connected || mutating || activation?.state==='running';
  stableText('#activation-state',activation?.state==='running' ? t('extPremiumActivating') : activation?.state==='complete' && active ? t('extPremiumActivated') : activation?.state==='error' ? errorText(activation.errorKey || 'activation_failed') : localError?.code==='activation_failed'?errorText('activation_failed'):'');

}
$('#player-theme')?.addEventListener('change',()=>mutate({type:'settings',values:{playerTheme:$('#player-theme').value}},'extSettingsLoaded'));
$('#ui-language')?.addEventListener('change',()=>mutate({type:'settings',values:{uiLanguage:$('#ui-language').value}},'extUiLanguageSaved'));
$('#format-locale')?.addEventListener('change',()=>mutate({type:'settings',values:{formatLocale:$('#format-locale').value}},'regionalSaved'));
$('#time-format')?.addEventListener('change',()=>mutate({type:'settings',values:{timeFormat:$('#time-format').value}},'regionalSaved'));
$('#document-language')?.addEventListener('change',()=>mutate({type:'settings',values:{language:$('#document-language').value}},'extLanguageSaved'));
$('#voice')?.addEventListener('change',()=>{const language=$('#document-language')?.value||'auto';void mutate({type:'settings',values:{language:language==='auto'?latestStatus?.engine?.activeLanguage:language,voice:$('#voice').value}},'extVoiceSaved');});
$('#volume')?.addEventListener('input',()=>{$('#volume-value').textContent=formatNumber(Number($('#volume').value))+' %';});
$('#volume')?.addEventListener('change',()=>mutate({type:'settings',values:{volume:Number($('#volume').value),...(Number($('#volume').value)>0?{muted:false}:{})}},'extVolumeSaved'));
$('#muted')?.addEventListener('change',()=>mutate({type:'settings',values:{muted:$('#muted').checked}},'extVolumeSaved'));
$('#premium-activation')?.addEventListener('submit',event=>{
  event.preventDefault();
  const input=$('#activation-code'), code=input.value.trim();input.value='';
  if(!/^[A-Za-z0-9._-]{8,1800}$/.test(code)){localError=errorFor('activation_failed');render();return;}
  void mutate({type:'control',command:'activatePremium',value:code},'extPremiumActivationSent');
});
$('#open-focus')?.addEventListener('click',()=>runtimeTransport?.kind==='native'?openPage('focus.html'):mutate({type:'control',command:'openFocus'},null));
$('#toggle-theme')?.addEventListener('click',()=>mutate({type:'control',command:'toggleTheme'},null));
$$('[data-appearance]').forEach(node=>{
 node.addEventListener('input',()=>{const output=node.closest('label')?.querySelector('output');if(output)output.textContent=formatNumber(Number(node.value),{maximumFractionDigits:1});});
 node.addEventListener('change',()=>{const value=node.type==='checkbox'?node.checked:['range','number'].includes(node.type)||node.dataset.appearance==='pdfDpi'?Number(node.value):node.value;void mutate({type:'settings',values:{appearance:{[node.dataset.appearance]:value}}},'extSettingsLoaded');});
});
$$('[data-appearance-reset]').forEach(node=>node.addEventListener('click',()=>mutate({type:'settings',values:{appearance:{...appearanceDefaults}}},'extSettingsLoaded')));


async function initialize() {
  if (page === 'popup') {
    try {
      const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
      tabId = Number.isInteger(tab?.id) ? tab.id : null;
      const url = new URL(tab?.url);
      supported = isOwnFileUrl(tab?.url) || (url.protocol==='chrome-extension:'&&url.hostname===chrome.runtime.id&&url.pathname==='/focus.html') || ['http:', 'https:', 'file:'].includes(url.protocol) && !url.username && !url.password && typeof tab?.title === 'string';
      currentTabTitle = tab?.title || t('extCurrentTab');
      $('#tab-description').textContent = supported ? t('extTabDescription') : t('extTabUnsupported');
    } catch {
      supported = false;
      $('#tab-title').textContent = t('extNoTab');
      $('#tab-description').textContent = t('extOpenDocumentHint');
    }
  }
  runtimeTransport=await createRuntimeTransport(page==='popup'?tabId:null);fileTransport=runtimeTransport.kind==='file'?runtimeTransport:null;
  await refreshRuntime();
  render();
  await refresh();
  const poll = setInterval(() => {if (!document.hidden && !mutating) void refresh();}, 1500);
  window.addEventListener('pagehide', () => {clearInterval(poll);runtimeTransport?.dispose?.();sharedPlayer?.destroy();}, {once:true});
}
let overlaySerial=0;
async function focusSurface(){if(targetContext?.type!=='focus'||!targetContext.bound)return null;return resolveBoundFocusView({tabId,sourceGeneration:targetContext.generation});}
async function overlayVisible(){
 if(targetContext?.type==='file'){const value=await fileTransport.snapshot();return value.ok?value.fileSnapshot.visible:null;}
 if(targetContext?.type==='focus'){const view=await focusSurface();const value=view?.notableFocusSurface?.getState();return value?.generation===targetContext.generation?value.visible:null;}
 return targetContext?.type==='source'&&targetContext.bound&&typeof latestStatus?.sourceContext?.overlayVisible==='boolean'?latestStatus.sourceContext.overlayVisible:null;
}
async function renderOverlayState(){
 const button=$('#overlay-toggle');if(!button)return;const serial=++overlaySerial,visible=await overlayVisible();if(serial!==overlaySerial)return;
 button.disabled=overlayPending||!connected||targetContext?.supported!==true||(['focus','file'].includes(targetContext?.type)&&!targetContext.bound);
 const pending=overlayPending||targetContext?.type==='source'&&latestStatus?.sourceContext?.overlayPending===true;button.disabled||=pending;
 button.setAttribute('aria-pressed',visible===null?'mixed':String(visible));button.dataset.state=pending?'pending':visible===true?'on':visible===false?'off':'unknown';
 stableText('#overlay-state',t(pending?'extOverlayPending':visible===true?'extOverlayOn':visible===false?'extOverlayOff':targetContext?.supported?'extOpenReader':'extOverlayUnavailable'));
}
$('#overlay-toggle')?.addEventListener('click',async()=>{
 if(overlayPending)return;overlayPending=true;void renderOverlayState();
 try{
  // A popup can outlive navigation/another in-flight poll. Resolve the current
  // document before choosing close versus open, not from cached visibility.
  if(refreshing)await refreshing;await refresh();
  const context=targetContext,visible=await overlayVisible(),desired=visible!==true;
  if(context?.type==='focus'){
   if(!desired){const stopped=await sharedPlayer.command('stop');if(!stopped?.ok)throw Error('document_changed');}
   const view=await resolveBoundFocusView({tabId,sourceGeneration:context.generation});const ok=view?.notableFocusSurface?.setVisible(desired,context.generation);if(ok!==desired)throw Error('document_changed');
  }else await sharedPlayer.command('setOverlayVisible',desired);
 }catch{localError=errorFor('document_changed');}finally{overlayPending=false;await refresh();void renderOverlayState();}
});
if(page==='popup')sharedPlayer=await mountBoundPlayer({mount:$('#popup-player'),variant:'popup',view:'source',settingsMode:'inline',settingsScope:'document',getVisibleSourceSection:visibleBoundFocusSection,transport:message,getContext:()=>({tabId,targetContext,sourceGeneration:targetContext?.type==='focus'?targetContext.generation:null}),onClose:()=>window.close(),onOpenFocus:()=>window.close(),onStatus:value=>{latestStatus=value;connected=true;localError=null;applySettings(value.settings);render();void refresh();},onFailure:code=>{localError=errorFor(code);render();}});
installSelects();
void initialize();

// Optional document tools: keep the existing companion controls and design.
document.querySelectorAll('[data-reader-tool]').forEach(button=>button.addEventListener('click',()=>{
 const suffix=button.dataset.readerTool==='audiobook'?'?mode=audiobook':'';
 chrome.tabs.create({url:chrome.runtime.getURL('reader.html')+suffix});
}));
// Explicit link from the focus download menu opens the real support section.
if(page==='options'&&location.hash==='#support'){
 const section=document.querySelector('.options-support');if(section){section.scrollIntoView({block:'start'});section.querySelector('summary')?.focus();}
}

async function refreshRuntime(){try{const result=await chrome.runtime.sendMessage({type:'runtimeGet'});if(result?.ok)runtimeState=result.runtime;}catch{}renderRuntime();}
function renderRuntime(){const node=$('#runtime-mode');if(!node)return;const wanted=runtimeState?.mode||confirmed?.runtimeMode;if(wanted&&document.activeElement!==node)node.value=wanted;node.disabled=mutating;syncSelects();}
$('#runtime-mode')?.addEventListener('change',async event=>{
 if(mutating)return;const mode=event.target.value;mutating=true;settingsRevision++;render();event.target.disabled=true;
 try{
  if(mode==='native'&&runtimeState?.nativePermissionGranted!==true){const granted=await chrome.permissions.request({origins:['http://127.0.0.1/*']});if(!granted){stableText('#runtime-status',t('extRuntimePermissionDenied'));return;}}
  const result=await chrome.runtime.sendMessage({type:'runtimeSet',mode});if(!result?.ok)throw Object.assign(Error('runtime'),{code:result?.code||'unavailable'});runtimeState=result.runtime;
  if(refreshing)await refreshing;runtimeTransport?.dispose?.();runtimeTransport=await createRuntimeTransport(page==='popup'?tabId:null);fileTransport=runtimeTransport.kind==='file'?runtimeTransport:null;targetContext=null;latestStatus=null;confirmed=null;localError=null;snapshotError=null;mutating=false;settingsRevision++;await refresh();
  stableText('#runtime-status',t('extRuntimeSaved'));
 }catch(error){stableText('#runtime-status',errorText(error.code||'unavailable'));}finally{mutating=false;await refreshRuntime();event.target.disabled=false;render();}
});
