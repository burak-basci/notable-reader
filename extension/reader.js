/* Notable Reader · Copyright (c) 2026 Burak Basci · MIT */
const {Reader, cleanText, fingerprint, textFromPdfItems} = globalThis.NotableReaderCore;
import {LocalModels,Speech,Utterance,MODELS,totalBytes} from './neural-speech.js';
const $ = selector => document.querySelector(selector);
const key = 'notable-reader-v2';
const defaults = {rate:1, volume:1, voice:'', language:'auto', online:false, follow:true, positions:{}};
let settings;
try { settings = {...defaults, ...JSON.parse(localStorage.getItem(key) || '{}')}; } catch { settings = {...defaults}; }
settings.positions = settings.positions && typeof settings.positions === 'object' && !Array.isArray(settings.positions) ? settings.positions : {};
settings.online = settings.online === true;
let voices = [], currentFingerprint = '', currentText = '', spans = [], activeSpan = null, documentLanguage = '', pdf = null, pdfPage = 1, pdfRender = null, generation = 0, loadingTask = null, passwordUpdate = null;
const models=new LocalModels(),speech=new Speech(models);
const status = (message, error = false) => { $('#status').textContent = message; $('#status').classList.toggle('error', error); };
function showMobileReadingArea(){
  if(!matchMedia('(max-width: 800px)').matches)return;
  requestAnimationFrame(()=>{const area=$('#reading-area');area.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});area.focus({preventScroll:true});});
}
function save() {
  // Retain only metadata for the most recently opened documents, never text.
  settings.positions = Object.fromEntries(Object.entries(settings.positions).slice(-100));
  try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Private mode or quota: reading still works. */ }
}
function detectLanguage(text) {
  const lower = ` ${text.toLowerCase().slice(0,12000)} `;
  const lexicons = {de:['und','der','die','das','nicht','ist','für','mit','ein','eine','ohne','liest'],en:['the','and','that','this','with','from','are','is'],fr:['les','des','une','dans','est','pour','avec','pas'],es:['los','las','una','para','con','del','por','que'],it:['della','sono','che','con','per','una','gli','non'],pt:['uma','para','com','não','dos','das','que','por'],nl:['het','een','van','voor','zijn','niet','met','dat']};
  const scores = Object.entries(lexicons).map(([lang, words]) => [lang, words.reduce((sum, word) => sum + (lower.match(new RegExp(`\\b${word}\\b`,'gu')) || []).length,0)]).sort((a,b)=>b[1]-a[1]);
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(lower)) return 'ja';
  if (/\p{Script=Hangul}/u.test(lower)) return 'ko';
  if (/\p{Script=Han}/u.test(lower)) return 'zh';
  if (/\p{Script=Arabic}/u.test(lower)) return 'ar';
  if (/\p{Script=Cyrillic}/u.test(lower)) return 'ru';
  return scores[0][1] >= 2 ? scores[0][0] : navigator.language.split('-')[0];
}
function availableVoices() { return voices.filter(voice => settings.online || voice.localService === true); }
function refreshVoices() {
  voices = speech.getVoices();
  const available = availableVoices(), languages = [...new Set(available.map(v=>v.lang).filter(Boolean))].sort();
  const languageSelect = $('#language'); languageSelect.replaceChildren(new Option('Automatisch', 'auto'));
  const displayNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['de'], {type:'language'}) : null;
  for (const lang of languages) { let name = lang; try { name = displayNames?.of(lang) || lang; } catch {} languageSelect.add(new Option(`${name} · ${lang}`, lang)); }
  if (![...languageSelect.options].some(option=>option.value === settings.language)) settings.language = 'auto';
  languageSelect.value = settings.language;
  const wanted = (settings.language === 'auto' ? documentLanguage || navigator.language : settings.language).toLowerCase();
  let matches = available.filter(v=>v.lang.toLowerCase() === wanted);
  if (!matches.length) matches = available.filter(v=>v.lang.split('-')[0].toLowerCase() === wanted.split('-')[0]);
  // Explicit language selection never falls through to a different language.
  if (!matches.length && settings.language === 'auto') matches = available;
  const select = $('#voice'); select.replaceChildren();
  if (!matches.length) select.add(new Option('Keine passende Stimme verfügbar', ''));
  for (const voice of matches) select.add(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · lokal' : ' · online'}`, voice.voiceURI));
  const chosen = matches.find(v=>v.voiceURI===settings.voice) || matches.find(v=>v.default) || matches[0] || null;
  if (chosen) select.value = chosen.voiceURI;
  reader.configure({voice:chosen});
  $('#voice-note').textContent = !available.length ? 'Keine Systemstimme gefunden. Lade unten eine kostenlose lokale KI-Stimme oder installiere eine Systemstimme. Online-Stimmen lassen sich bewusst einschalten.' : chosen?.voiceURI?.startsWith('notable:') ? 'Lokale neuronale Stimme: Text und erzeugtes Audio bleiben auf diesem Gerät.' : chosen?.localService ? `${available.length} Stimme${available.length===1?'':'n'} verfügbar. Gewählte Stimme wird vom Browser als lokal gemeldet.` : 'Online-Stimme: Der Browser oder Stimmenanbieter kann deinen Text verarbeiten. Für vertrauliche Inhalte eine lokale Stimme wählen.';
  if(!available.length)$('#local-models').open=true;
}
const reader = new Reader({
  speech,Utterance,
  onstate({state,index,count,error}) {
    $('#play').textContent = state === 'playing' ? 'Pause' : state === 'paused' ? 'Weiterlesen' : state === 'ended' ? 'Noch einmal' : 'Vorlesen';
    $('#play').setAttribute('aria-pressed', String(state === 'playing'));
    for (const selector of ['#play','#previous','#next','#stop']) $(selector).disabled = !count;
    $('#previous').disabled = !count || index === 0; $('#next').disabled = !count || index >= count - 1;
    $('#progress').style.width = `${count ? (state==='ended'?100:index/count*100) : 0}%`;
    if (error) status(error,true);
    else if (count) status(`${state==='playing'?'Wird vorgelesen':state==='paused'?'Pausiert':state==='ended'?'Fertig':'Bereit'} · Abschnitt ${index+1} von ${count}`);
  },
  onword({start,end,sentence}) {
    activeSpan?.classList.remove('active'); activeSpan?.removeAttribute('aria-current');
    activeSpan = spans[sentence]; activeSpan?.classList.add('active'); activeSpan?.setAttribute('aria-current','true');
    if (globalThis.CSS?.highlights && globalThis.Highlight && activeSpan?.firstChild) {
      const chunk = reader.chunks[sentence], range = new Range(), node=activeSpan.firstChild;
      try { range.setStart(node,Math.min(node.length,Math.max(0,start-chunk.start))); range.setEnd(node,Math.min(node.length,Math.max(0,end-chunk.start))); CSS.highlights.set('notable-word',new Highlight(range)); } catch {}
    }
    if (settings.follow && activeSpan && reader.state==='playing') {
      const rect=activeSpan.getBoundingClientRect();
      if (rect.top<100 || rect.bottom>innerHeight-80) activeSpan.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    }
  },
  onposition(index) { if (currentFingerprint) { settings.positions[currentFingerprint]=index; save(); } }
});
// Exposed for local QA and integrations without making text persistent.
globalThis.notableReader = reader;
globalThis.notableModels=models;globalThis.notableSpeech=speech;
function loadDocument(text, title, language = '') {
  currentText = cleanText(text); currentFingerprint = fingerprint(currentText); documentLanguage = language || detectLanguage(currentText);
  const position = Number(settings.positions[currentFingerprint]) || 0;
  reader.load(currentText,position); $('#document-title').textContent = title; $('#empty').hidden = !!currentText;
  const root=$('#reading-text'); root.replaceChildren(); spans=[];
  let cursor=0;
  reader.chunks.forEach((chunk,index)=>{
    root.append(document.createTextNode(reader.text.slice(cursor,chunk.start)));
    const span=document.createElement('span'); span.className='sentence'; span.tabIndex=0; span.setAttribute('role','button'); span.setAttribute('aria-label',`Ab Abschnitt ${index+1} lesen`); span.textContent=chunk.text;
    span.addEventListener('click',()=>reader.seek(index)); span.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();reader.seek(index);}});
    root.append(span); spans.push(span); cursor=chunk.end;
  });
  root.append(document.createTextNode(reader.text.slice(cursor)));
  $('#document-meta').textContent = `${reader.text.length.toLocaleString('de-DE')} Zeichen · ${reader.chunks.length.toLocaleString('de-DE')} Abschnitte · ${documentLanguage.toUpperCase()}`;
  refreshVoices();
  if(position>0 && reader.chunks.length) status(`Lesestelle wiederhergestellt · Abschnitt ${reader.index+1} von ${reader.chunks.length}.`);
  if(!currentText) status('Keine lesbare Textebene gefunden. Bei einem gescannten PDF zuerst eine OCR-Texterkennung durchführen.',true);
}
async function renderPdfPage() {
  if(!pdf)return;
  pdfRender?.cancel();
  const thisPdf=pdf, page=await thisPdf.getPage(pdfPage), viewport=page.getViewport({scale:1.5});
  if(thisPdf!==pdf)return;
  const canvas=$('#pdf-canvas');canvas.width=viewport.width;canvas.height=viewport.height;
  $('#pdf-page').textContent=`Seite ${pdfPage} von ${pdf.numPages}`;
  $('#pdf-previous').disabled=pdfPage<=1; $('#pdf-next').disabled=pdfPage>=pdf.numPages;
  pdfRender=page.render({canvasContext:canvas.getContext('2d'),viewport});
  try{await pdfRender.promise;}catch(error){if(error.name!=='RenderingCancelledException')status('Die PDF-Vorschau konnte nicht dargestellt werden.',true);}
}
async function importPdf(bytes,title,gen) {
  const lib = await import('./vendor/pdfjs/pdf.mjs');
  lib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
  if(gen!==generation)return;
  loadingTask = lib.getDocument({data:bytes,isEvalSupported:false,cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/pdfjs/wasm/',import.meta.url).href});
  loadingTask.onPassword=(updatePassword,reason)=>{passwordUpdate=updatePassword;$('#password-form').hidden=false;status(reason===2?'Das PDF-Passwort war falsch. Bitte erneut eingeben.':'Dieses PDF ist geschützt. Bitte das Passwort eingeben.');$('#pdf-password').focus();};
  const doc=await loadingTask.promise;
  if(gen!==generation){await doc.destroy();return;}
  const pages=[];
  for(let n=1;n<=doc.numPages;n++){
    if(gen!==generation){await doc.destroy();return;}
    status(`PDF wird lokal geöffnet · Seite ${n} von ${doc.numPages}`);
    const page=await doc.getPage(n), content=await page.getTextContent();
    pages.push(textFromPdfItems(content.items));page.cleanup();
  }
  $('#password-form').hidden=true;$('#pdf-password').value='';passwordUpdate=null;
  pdf=doc;pdfPage=1;
  loadDocument(pages.join('\n\n'),title);
  $('#pdf-preview').hidden=false;
  if($('#pdf-preview').open) await renderPdfPage();
}
$('#password-form').addEventListener('submit',event=>{event.preventDefault();const password=$('#pdf-password').value;$('#pdf-password').value='';if(passwordUpdate)passwordUpdate(password);});
async function cancelPdf(){passwordUpdate=null;$('#password-form').hidden=true;$('#pdf-password').value='';pdfRender?.cancel();if(loadingTask){try{await loadingTask.destroy();}catch{}}loadingTask=null;pdf=null;$('#pdf-preview').hidden=true;}
$('#file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  const gen=++generation;reader.stop();await cancelPdf();
  status('Datei wird lokal geöffnet …');
  try{
    if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf'))await importPdf(new Uint8Array(await file.arrayBuffer()),file.name,gen);
    else {const {importTextFile}=await import('./formats.js');const imported=await importTextFile(file);if(gen===generation)loadDocument(imported.text,imported.title||file.name,imported.language||'');}
  }catch(error){if(gen===generation)status(error.name==='PasswordException'?'Das PDF benötigt ein gültiges Passwort.':/\.(epub|docx?|html?|txt|md|markdown)$/i.test(file.name)?error.message:'Diese Datei konnte nicht geöffnet werden. Bitte eine unbeschädigte Datei in einem unterstützten Format wählen.',true);}
  event.target.value='';
  if(gen===generation)showMobileReadingArea();
});
$('#load-text').addEventListener('click',async()=>{++generation;await cancelPdf();loadDocument($('#paste').value,'Dein Text');$('#paste').value='';showMobileReadingArea();});
$('#choose-voice').addEventListener('click',event=>{event.preventDefault();const area=$('#voice-settings');area.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});area.focus({preventScroll:true});});
$('#play').addEventListener('click',()=>reader.toggle());
$('#stop').addEventListener('click',()=>{reader.stop();reader.seek(0);});
$('#previous').addEventListener('click',()=>reader.seek(reader.index-1));
$('#next').addEventListener('click',()=>reader.seek(reader.index+1));
$('#rate').value=settings.rate;$('#volume').value=settings.volume;$('#online').checked=settings.online;$('#follow').checked=settings.follow;
function applySliders(){settings.rate=Math.max(.8,Math.min(4,Number($('#rate').value)||1));settings.volume=Math.max(0,Math.min(1,Number($('#volume').value)));$('#rate-value').textContent=`${settings.rate.toLocaleString('de-DE',{minimumFractionDigits:2})}×`;$('#volume-value').textContent=`${Math.round(settings.volume*100)} %`;reader.configure({rate:settings.rate,volume:settings.volume});save();}
$('#rate').addEventListener('input',applySliders);$('#volume').addEventListener('input',applySliders);applySliders();
$('#language').addEventListener('change',()=>{settings.language=$('#language').value;settings.voice='';refreshVoices();save();});
$('#voice').addEventListener('change',()=>{settings.voice=$('#voice').value;reader.configure({voice:availableVoices().find(v=>v.voiceURI===settings.voice)||null});refreshVoices();save();});
$('#online').addEventListener('change',()=>{settings.online=$('#online').checked;settings.voice='';refreshVoices();save();});
$('#follow').addEventListener('change',()=>{settings.follow=$('#follow').checked;save();});
$('#clear-data').addEventListener('click',()=>{settings={...defaults,positions:{}};try{localStorage.removeItem(key);}catch{}currentFingerprint='';reader.stop();reader.configure({rate:1,volume:1});$('#rate').value=1;$('#volume').value=1;$('#rate-value').textContent='1,00×';$('#volume-value').textContent='100 %';$('#online').checked=false;$('#follow').checked=true;refreshVoices();$('#privacy-status').textContent='Einstellungen und gespeicherte Lesestellen wurden gelöscht.';});
$('#pdf-preview').addEventListener('toggle',()=>{if($('#pdf-preview').open)renderPdfPage();});
$('#pdf-previous').addEventListener('click',()=>{if(pdfPage>1){pdfPage--;renderPdfPage();}});$('#pdf-next').addEventListener('click',()=>{if(pdf&&pdfPage<pdf.numPages){pdfPage++;renderPdfPage();}});
speech.addEventListener('voiceschanged',refreshVoices);refreshVoices();models.restore().catch(()=>{});
models.addEventListener('status',event=>{$('#model-status').textContent=event.detail.message;$('#model-status').classList.toggle('error',event.detail.error);if(reader.state==='playing')status(event.detail.message,event.detail.error);});
for(const button of document.querySelectorAll('[data-model]')){
 const id=button.dataset.model,model=MODELS[id];button.textContent=`${model.name} laden · ${(totalBytes(model)/1e6).toLocaleString('de-DE',{maximumFractionDigits:1})} MB`;
 button.addEventListener('click',async()=>{for(const node of document.querySelectorAll('[data-model]'))node.disabled=true;$('#cancel-model').hidden=false;try{await models.install(id);settings.voice=model.voiceURI;settings.language=model.lang;refreshVoices();save();}catch{}finally{for(const node of document.querySelectorAll('[data-model]'))node.disabled=false;$('#cancel-model').hidden=true;}});
}
$('#cancel-model').addEventListener('click',()=>models.cancelDownload());
$('#clear-models').addEventListener('click',async()=>{reader.stop();await models.clear();settings.voice='';refreshVoices();save();});
if(location.protocol==='chrome-extension:'&&/^#incoming=[a-f0-9-]{36}$/.test(location.hash)){
 const id=location.hash.slice(10),key='notable-incoming-'+id;
 chrome.storage.session.get(key).then(async values=>{const document=values[key];await chrome.storage.session.remove(key);history.replaceState(null,'',location.pathname);if(document&&typeof document.text==='string'&&Date.now()-document.created<300000)loadDocument(document.text,document.title||'Artikel',document.language||'');else status('Der temporäre Artikel ist abgelaufen. Bitte die Seite erneut über die Erweiterung öffnen.',true);}).catch(()=>status('Der temporäre Artikel konnte nicht geöffnet werden.',true));
}
document.addEventListener('keydown',event=>{if(event.altKey&&event.code==='Space'){event.preventDefault();reader.toggle();}if(event.key==='Escape'&&reader.state==='playing')reader.pause();});
document.addEventListener('wheel',event=>{if(event.isTrusted&&reader.state==='playing'){settings.follow=false;$('#follow').checked=false;save();}},{passive:true});
window.addEventListener('pagehide',()=>reader.stop());
if(['https:','http:'].includes(location.protocol)&&isSecureContext&&'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
