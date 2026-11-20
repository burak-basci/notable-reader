import {cleanSemanticRanges} from '../../playback/reading-rules.js';
import {installReaderScrollbars} from '../../scrollbars.mjs';
import {buildChunks} from '../../session/text-map.mjs';
/* beNotable! Reader · file view / Focus Reader (MIT). It supplies the TEXT (file import, PDF, figures, layout) and the export run; playback, pause, position, tempo, volume, voices, models,
   marks, follow, click-to-seek, keyboard and the bar are the ONE session every page runs (session/page-session.mjs). No second player here. */
import {PageSession} from '../../session/page-session.mjs';
import {applyDocumentColors} from '../../session/overlay-theme.mjs';
import {createAppearanceController} from '../../appearance.mjs';
import {FIELDS,EXPORT_KEYS,SESSION_PATCH_KEYS} from '../../config.mjs';
import {LocalModels} from './local-models.js';
import {MODELS,modelBytes} from '../../models/registry.js';
import {firstRunVoice} from '../../voice-picker.mjs';

import {documentHtml,documentPdf,renderDocumentFigure} from './document-export.mjs';
import {confirmFigures,lazyFigure,checkAbort} from './document-assets.mjs';
import {pdfGeometry,transformPdfPixels,pdfMarginLines,repeatedPdfMargins,boundedPdfViewport} from './pdf-appearance.mjs';
import {applyStaticText,localizeMessage} from './file-i18n.mjs';
import {errorKey} from '../../engine/error-keys.mjs';
import {createFormatting} from '../../formatting.mjs';

import {cleanText,documentChunks} from './document-chunks.mjs';
import {wordOffsets} from '../../playback/timeline.js';
import {atDocumentEnd} from '../../playback/resume-points.js';
import {ocrDocument,imageSource,chooseLanguage,languageByCode,documentKey,scanVerdict,visibleChars,clearLanguages,clearCache as clearOcrCache} from './ocr/ocr.mjs';
import {createOcrPanel} from './ocr/ocr-panel.mjs';
installReaderScrollbars(document,{ownPage:true});
const {chunksForLegacy,fingerprint,textFromPdfItems}=globalThis.NotableReaderCore,$=s=>document.querySelector(s),key='notable-reader-v2',isExtension=['chrome-extension:','moz-extension:'].includes(location.protocol);
let legacy={};try{legacy=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}legacy.positions=legacy.positions&&typeof legacy.positions==='object'&&!Array.isArray(legacy.positions)?legacy.positions:{};   // releases up to 2.4.0 kept their saved reading places here; they are carried over once, everything else is the session's
const appearance=createAppearanceController({document,kind:'html',contentRoot:$('#reading-text'),flow:true,inheritSelector:'.sentence'});
/* pdf.js holds the whole file in memory (plus a copy in its worker): larger files are refused before reading */
const MAX_PDF_BYTES=512*1024*1024;
const models=new LocalModels();   // the file tab's own engine: audiobook export and engine measurements only (playback = the session's pipeline in the engine host)
let sampleUntil=0;   // end of the window in which a refused sample start counts as "not started"
let session,settings,docChunks=[],currentFingerprint='',documentLanguage='',currentText='',spans=[],activeSpan=null,pdf=null,pdfPage=1,pdfRender=null,pdfPaintSerial=0,generation=0,loadingTask=null,passwordUpdate=null,importBusy=false,exportBusy=false,exportAbort=null,exporter=null,exportResult=null,exportUrl='',ocrController=null,ocrJob=null;
let documentFigures=[],documentWarnings=[],figureObserver=null,figureAbort=new AbortController(),figureNodes=[],previewOriginal=null,previewRegions=[],previewThemeSerial=0,lastDocAppearance='',lastPdfDpi=144,figureQueue=Promise.resolve();
void import('../../session/engagement.mjs').then(m=>m.clearLegacyProductData());
const instanceId=crypto.randomUUID();let documentGeneration=crypto.randomUUID(),closed=false,resultGeneration=null,resultKind=null;
const status=(text,error=false)=>{$('#status').removeAttribute('data-i18n');$('#status').textContent=loc(text);$('#status').classList.toggle('error',error);};
const docAppearance=()=>({...appearance.defaults,...settings?.appearance});
/* Night mode is a property of the WHOLE page (html/body, header, cards, dialog, footer, scrollbars, overscroll), not only of the text block: html[data-page-theme] switches the page tokens in reader.css to the player bar's palette.
   Mode off leaves the attribute away and the page follows the system as before; auto follows the system; dark/light are explicit. */
/* The reading column is painted by the appearance controller (palette of the 20 reading-look fields); the card around it takes exactly that color, so no lighter or darker frame shows around the text block. */
function syncReadingBackground(){const card=$('#reading-area'),text=$('#reading-text');if(!card||!text)return;const c=root=>getComputedStyle(root).backgroundColor,bg=document.documentElement.dataset.pageTheme?c(text):'';if(bg&&!/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(bg))card.style.setProperty('--reading-bg',bg);else card.style.removeProperty('--reading-bg');}
new MutationObserver(()=>syncReadingBackground()).observe($('#reading-text'),{attributes:true,attributeFilter:['style']});
const pageThemeQuery=matchMedia('(prefers-color-scheme:dark)');
/* the document's Night mode (appearance.mode) decides when it is set; otherwise the file view follows the color mode of the bar and the extension (playerTheme, round 4) */
function applyPageTheme(){const mode=settings?.appearance?.mode,root=document.documentElement,own=settings?.playerTheme;if(mode==='dark'||mode==='light'||mode==='auto')root.dataset.pageTheme=mode==='dark'||mode==='auto'&&pageThemeQuery.matches?'dark':'light';else if(own==='dark'||own==='light')root.dataset.pageTheme=own;else delete root.dataset.pageTheme;{const pt=root.dataset.pageTheme,own=settings?.playerTheme;applyDocumentColors(root,settings?.overlayTheme,pt?pt==='dark':own==='dark'||own!=='light'&&pageThemeQuery.matches);}syncReadingBackground();try{document.querySelector('meta[name=theme-color]')?.setAttribute('content',root.dataset.pageTheme==='dark'?'#171a18':'#256249');}catch{}}
const onSettings=()=>{applyPageTheme();const signature=JSON.stringify(settings.appearance);if(signature!==lastDocAppearance){lastDocAppearance=signature;const dpi=Number(settings.appearance?.pdfDpi)||144;if(dpi!==lastPdfDpi&&pdf&&!$('#pdf-preview').hidden&&$('#pdf-preview').open){lastPdfDpi=dpi;void renderPdfPage();}else{lastPdfDpi=dpi;void themePdfPreview();}refreshFigureAppearance();}};
function detectLanguage(text){
 // Bounded lexical hints, not universal language identification. Unicode words
 // keep accents (e.g. português “não”) and exclude matches inside other words.
 const lower=String(text||'').slice(0,12000).normalize('NFKC').toLowerCase(),lexicons={de:['und','der','die','das','nicht','ist','für','mit','ein','eine','dies','diese','dieser','dieses','den','dem','einen','einer','auch','zu','auf','von','im','ich','du','wir','sie','ohne','jetzt','aber','oder','als','noch','nur','kann'],en:['the','and','that','this','with','from','are','is','a','an','to','of','in','on','for','it','we','you','your','they','their','he','she','be','not','or','can','will','when','if','without','every','now'],fr:['les','des','une','dans','est','pour','avec','le','la','de','et','un','que','pas','ce','cette','sur','du','sans','il','elle','vous'],es:['los','las','una','para','con','del','por','el','y','es','un','que','sin','este','esta','se','al'],it:['della','sono','che','con','per','una','il','lo','la','di','e','è','un','non','questo','questa','senza','nel','te'],pt:['uma','para','com','não','dos','das','o','a','os','as','e','é','um','que','em','no','na','sem','este','esta','de']};
 if(/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(lower))return'ja';if(/\p{Script=Han}/u.test(lower))return'zh';if(/\p{Script=Arabic}/u.test(lower))return'ar';
 const tokens=lower.match(/\p{L}+(?:['’]\p{L}+)*/gu)||[],scores=Object.entries(lexicons).map(([lang,words])=>{const known=new Set(words);return[lang,tokens.reduce((sum,word)=>sum+Number(known.has(word)),0)];}).sort((a,b)=>b[1]-a[1]);
 return scores[0][1]>=2&&scores[0][1]>scores[1][1]?scores[0][0]:navigator.language.split('-')[0];
}
/* Sections = the SAME recognition as on every page (session/text-map.mjs buildChunks via document-chunks.mjs). The rendered nodes below are handed to the session as its text source;
   marks, follow and click-to-seek (session/reading-marks.mjs -> page-highlight / follow-zone) run on them exactly as on a page. Chunks keep absolute offsets (chapters, places, export). */
let docLayout=null,documentSemanticRanges=[],allRuns=[],docSource={blocks:[],textNodes:[],blockEls:[],title:'',language:'',fingerprint:''};
// The source identity travels with its import generation, including clean web views and history resumes.
const documentMetadata=new Map();let currentDocumentMetadata={kind:'file',url:'',fileName:'',mimeType:'text/plain'};
function setDocumentMetadata(gen,raw={}){let url='';try{const u=new URL(raw.sourceURL||raw.sourceUrl||raw.navigationURL||raw.url||'');if(['http:','https:'].includes(u.protocol)){u.username='';u.password='';url=u.href;}}catch{}const meta={kind:url?'web':'file',url,fileName:typeof raw.fileName==='string'?raw.fileName.slice(0,240):'',mimeType:typeof raw.mimeType==='string'?raw.mimeType.slice(0,120):'text/plain',...(raw.noHistory===true?{noHistory:true}:{})};documentMetadata.clear();documentMetadata.set(gen,meta);return meta;}
/* Segment the canonical text only at explicit semantic source boundaries. Each
   segment retains its original absolute base; filters never rewrite that text. */
function sourceLayout(text,ranges=[]) {
 const original=documentChunks(text);if(!ranges.length)return original;
 const kinds=new Set(['link','code','math','header','footer','caption','table','quote','footnote','citation']);
 const safe=ranges.filter(r=>r&&kinds.has(r.kind)&&Number.isSafeInteger(r.start)&&Number.isSafeInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=original.text.length),events=new Map();
 for(const r of safe)for(const [at,delta]of [[r.start,1],[r.end,-1]]){if(!events.has(at))events.set(at,[]);events.get(at).push([r.kind,delta]);}
 const points=[...new Set([...original.layout.spans.flat(),...events.keys()])].sort((a,b)=>a-b),active={},spans=[],blocks=[];let paragraph=0;
 for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];for(const [kind,delta]of events.get(a)||[])active[kind]=(active[kind]||0)+delta;while(paragraph<original.layout.spans.length&&original.layout.spans[paragraph][1]<=a)paragraph++;const span=original.layout.spans[paragraph];if(!span||a<span[0]||b>span[1]||!original.text.slice(a,b).trim())continue;spans.push([a,b]);blocks.push({text:original.text.slice(a,b).replace(/\n/g,' '),paragraph,...Object.fromEntries(Object.entries(active).filter(([,count])=>count>0).map(([kind])=>[kind,true]))});}
 const chunks=buildChunks(blocks).map(c=>({text:c.text,start:spans[c.block][0]+c.start,end:spans[c.block][0]+c.start+c.text.length,block:c.block,rel:c.start,words:c.words}));return {text:original.text,chunks,layout:{spans,blocks}};
}
function displayChunkAt(char){return docChunks.findIndex(c=>char>=c.start&&char<c.end);}
function spokenChunkForDisplay(index){const display=docChunks[index];return display?session.chunks.findIndex((c,i)=>{const at=session.charOfChunk(i);return at>=display.start&&at<display.end;}):-1;}
function buildSource(title,chapters){
 const {spans:bounds,blocks}=docLayout,textNodes=blocks.map(()=>[]);let b=0;
 for(const run of allRuns){while(b<bounds.length&&bounds[b][1]<=run.start)b++;if(b<bounds.length&&run.start>=bounds[b][0]&&run.end<=bounds[b][1])textNodes[b].push(run.node);}
 const first=new Map();docChunks.forEach((c,i)=>{if(!first.has(c.block))first.set(c.block,i);});
 const list=blocks.map((block,i)=>({...block,text:block.text,base:bounds[i][0],headings:[]}));
 for(const c of chapters){const k=docChunks.findIndex(chunk=>chunk.end>c.charStart);if(k<0)continue;const chunk=docChunks[k];list[chunk.block].headings.push({label:c.label,level:c.level,charStart:Math.max(c.charStart-bounds[chunk.block][0],chunk.rel)});}
 docSource={...currentDocumentMetadata,text:currentText,semanticRanges:documentSemanticRanges,blocks:list,textNodes,blockEls:blocks.map((_,i)=>spans[first.get(i)]||null),title,language:documentLanguage,fingerprint:currentFingerprint};
}
function onMark(sentence){const span=spans[displayChunkAt(session.charOfChunk(sentence))];if(!span)return;activeSpan&&activeSpan!==span&&activeSpan.removeAttribute('aria-current');activeSpan=span;span.setAttribute('aria-current','true');}
/* Absolute character of the reading place (the page gets it back when the Focus Reader closes). */
function placeChar(){return session.chunks.length?session.charOfPosition():null;}
let statusKey='';function statusLine(){if(!currentText||exportBusy||importBusy)return;const s=session,key=[s.state,s.position.chunk,s.chunks.length,s.lastError].join('|');if(key===statusKey)return;statusKey=key;
 if(s.lastError)status(/^[a-z_]+$/.test(s.lastError)?mt(s.lastError.startsWith('offline_')?s.lastError:'reader_error'):s.lastError,true);
 else if(s.chunks.length)status(mt('fileStatusLine',{state:mt(s.state==='playing'?'fileStateReading':s.state==='paused'?'fileStatePaused':s.state==='ended'?'fileStateEnded':'fileStateReady'),current:s.position.chunk+1,count:s.chunks.length}));}

















function clearFigures(){figureObserver?.disconnect();figureObserver=null;figureAbort.abort();figureAbort=new AbortController();for(const entry of figureNodes){entry.serial++;entry.controller?.abort();entry.image.removeAttribute('src');}figureNodes=[];documentFigures=[];}
function paintFigure(entry){
 const serial=++entry.serial,gen=generation,parent=figureAbort.signal;entry.controller?.abort();entry.controller=new AbortController();const controller=entry.controller,signal=controller.signal,cancel=()=>controller.abort(),current=()=>serial===entry.serial&&gen===generation&&!signal.aborted&&entry.visible;
 parent.addEventListener('abort',cancel,{once:true});const run=async()=>{if(!current()){parent.removeEventListener('abort',cancel);return;}try{
  const canvas=await renderDocumentFigure(entry.figure,docAppearance(),{signal});try{if(!current())return;entry.image.src=canvas.toDataURL('image/png');entry.node.dataset.ready='true';delete entry.node.dataset.failed;entry.node.setAttribute('data-caption',entry.figure.alt);
   const previousError=entry.errorStatus;delete entry.errorStatus;if(previousError&&$('#status')?.textContent===previousError){const remaining=figureNodes.find(item=>item.node.dataset.failed==='true'&&item.errorStatus);status(remaining?.errorStatus||(documentWarnings.length?documentWarnings.join(' '):mt('fileFiguresReady')),!!remaining);}
  }finally{canvas.width=canvas.height=0;}
 }catch(error){if(!current()||error?.name==='AbortError'||error?.name==='RenderingCancelledException')return;delete entry.node.dataset.ready;entry.node.dataset.failed='true';const detail=loc(error?.message)||mt('fileFigureUnknown');entry.node.setAttribute('data-caption',mt('fileFigureFailed',{detail}));entry.errorStatus=mt('fileFigureFailedStatus',{detail});status(entry.errorStatus,true);
 }finally{parent.removeEventListener('abort',cancel);}};figureQueue=figureQueue.catch(()=>{}).then(run);return figureQueue;
}

function refreshFigureAppearance(){for(const entry of figureNodes)if(entry.visible)void paintFigure(entry);}
function figureNode(figure){const node=document.createElement('span'),image=document.createElement('img');node.className='reader-figure';node.dataset.notableReaderUi='true';node.setAttribute('role','figure');node.setAttribute('aria-label',figure.alt);node.setAttribute('data-caption',figure.alt);image.alt=figure.alt;image.width=figure.width;image.height=figure.height;node.append(image);const entry={node,image,figure,visible:false,serial:0};figureNodes.push(entry);figureObserver.observe(node);return node;}


async function clearExportResult(){if(exportUrl){URL.revokeObjectURL(exportUrl);exportUrl='';}const previous=exportResult;exportResult=null;resultGeneration=null;resultKind=null;if(session)session.setJob(session.exportState.state==='complete'?{state:'idle'}:{...session.exportState,resultReady:false});$('#export-result').hidden=true;$('#download-audio').removeAttribute('href');await previous?.cleanup?.();}
function lock(value){exportBusy=value;document.body.dataset.exportBusy=String(value);for(const n of document.querySelectorAll('#file,#paste,#load-text,#header-open,#empty-open,#unload-idle,#clear-models,#clear-data,#clear-export-storage'))n.disabled=value;session?.setBusy(value);}
const UTF8_ENC=new TextEncoder();
function safeName(title,format){let base='';for(const ch of title.replace(/\.[a-z0-9]{1,8}$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim()){if(UTF8_ENC.encode(base+ch).length>120)break;base+=ch;}base=base.replace(/[. ]+$/,'')||'notable-reader';if(/^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i.test(base.split('.')[0].trim()))base='_'+base;return base+'.'+format;}
function showResult(result,note='',kind='audio'){exportResult=result;resultGeneration=documentGeneration;resultKind=kind;exportUrl=URL.createObjectURL(result.blob);$('#download-audio').href=exportUrl;$('#download-audio').download=result.filename;$('#export-filename').textContent=result.filename;$('#export-status').textContent=note||mt('fileResultReady');$('#export-result').hidden=false;status(mt('fileResultReadyStatus'));}
const mt=(key,vars={})=>{const all=session?.locales?.messages||{},table=all[settings?.uiLanguage]||all.en||{};return String(table[key]??all.en?.[key]??key).replace(/\{(\w+)\}/g,(_,name)=>vars[name]??'');};
/* coded errors (engine, download, export, import) are named in the UI language; others keep the message mapping */
// Coded errors read the shared table (engine/error-keys.mjs); a model download names its size where the text asks.
const errorText=error=>{const key=errorKey(error?.code),model=MODELS[error?.modelId];if(!key)return error?.message;
 // without a known model the size note "({mb} MB)" is left out instead of showing an empty number
 return model?mt(key,{mb:Math.round(modelBytes(model)/1e6)}):mt(key).replace(/\s*\(\s*(MB|Mo)\)/u,'');};
const loc=message=>localizeMessage(message,(key,vars)=>session?.locales?mt(key,vars):null),num=value=>formatting.number(value,settings);
const ocrPanel=createOcrPanel({root:$('#ocr-offer'),mt,uiLanguage:()=>settings?.uiLanguage,onStart:({kind,lang})=>void startOcr(kind,lang),onCancel:()=>ocrController?.abort()});
/* Local text recognition for scans and images (modules in ./ocr). Returns a Map page number -> {text, words, confidence}, or null (cancelled, failed, superseded: the offer is shown again for a retry). */
async function runOcr(source,{file,lang,pages=null,gen,kind}){
 if(gen!==generation)return null;
 const controller=new AbortController(),stale=()=>gen!==generation;ocrController=controller;ocrPanel.running();
 try{
  const key=await documentKey(new Uint8Array(await file.arrayBuffer()),lang),result=await ocrDocument(source,{lang,pages,cacheKey:key,signal:controller.signal,onProgress:event=>{if(stale())controller.abort();else ocrPanel.progress(event);}});
  if(stale())return null;
  const map=new Map(result.pages.map(page=>[page.n,page]));
  if(![...map.values()].some(page=>cleanText(page.text))){status(mt('ocrNoText'),true);ocrPanel.offer({kind,lang});return null;}
  return map;
 }catch(error){
  if(stale())return null;
  status(error?.name==='AbortError'?mt('ocrCancelled'):loc(errorText(error)||mt('ocrFailed')),error?.name!=='AbortError');ocrPanel.offer({kind,lang});return null;
 }finally{if(ocrController===controller)ocrController=null;}
}
async function startOcr(kind,lang){
 const job=ocrJob;if(!job||importBusy||exportBusy)return;const gen=++generation;importBusy=true;session.stop();
 try{await cancelPdf();if(gen!==generation)return;ocrJob=job;ocrPanel.running();if(kind==='image')await importImage(job.file,gen,lang);else await importPdf(new Uint8Array(await job.file.arrayBuffer()),job.title,gen,lang,job.file);}
 catch(error){if(gen===generation){status(loc(errorText(error)||mt('ocrFailed')),true);ocrPanel.offer({kind,lang});}}
 finally{if(gen===generation){importBusy=false;statusKey='';statusLine();}}
}
async function importImage(file,gen,ocrLang=null){
 if(!ocrLang){ocrJob={kind:'image',file,title:file.name};status(mt('ocrOfferStatusImage'));ocrPanel.offer({kind:'image',lang:chooseLanguage('',settings?.uiLanguage)});return;}
 let source;try{source=await imageSource(file);}catch{throw new Error('Die Texterkennung konnte das Bild nicht lesen.');}
 try{
  const map=await runOcr(source,{file,lang:ocrLang,gen,kind:'image'});if(!map||gen!==generation)return;
  ocrPanel.hide();await loadDocument(map.get(1).text,file.name,languageByCode(ocrLang)?.ui||'',gen,[],[],[mt('ocrWarning')]);
 }finally{source.destroy?.();}
}
/* request (round 3 download menu): {range, doc, startChunk} from the session; 'all' = the whole loaded text, otherwise the prepared slice (figures stay
   with the whole document) */
async function startExport(format,kind='audio',askedModel=false,request=null){
 if(exportBusy||importBusy||!currentText||!['mp3','wav','pdf','html'].includes(format))return;kind=['mp3','wav'].includes(format)?'audio':'document';let pendingSave=false;const partial=request&&request.range&&request.range!=='all'&&typeof request.doc?.text==='string'&&request.doc.text.trim()?request:null;const sourceGeneration=generation,text=currentText,title=$('#document-title').textContent,look=docAppearance(),abort=new AbortController();exportAbort=abort;const checkCurrent=()=>{if(abort.signal.aborted||sourceGeneration!==generation||currentText!==text)throw new DOMException('Abgebrochen','AbortError');};lock(true);session.setJob({state:'running',kind,phase:'preparing',percent:0,completedChunks:0,totalChunks:kind==='audio'?docChunks.length:1});
 try{
  // Cancellation and source identity are checked at every asynchronous boundary.
  checkCurrent();
  let modelId=null;if(kind==='audio'){
   await session.refreshInstalled();checkCurrent(); // installed models are read asynchronously at startup: a direct export (bar -> MP3) must not ask for a download that is already there
   const chosen=session.voiceMap.get(session.voiceId),lang=documentLanguage.toLowerCase().split('-')[0];modelId=chosen?.kind==='neural'&&session.installed.has(chosen.id)?chosen.id:Object.values(MODELS).find(m=>m.lang.toLowerCase().startsWith(lang)&&session.installed.has(m.id))?.id;
   if(!modelId){session.setJob({state:'idle'});lock(false);const wanted=firstRunVoice(Object.values(MODELS),lang)||MODELS.kokoro;if(!askedModel&&await session.needModel(wanted)){await session.applySettings({voice:{language:wanted.lang,id:wanted.voiceURI}});return startExport(format,kind,true,request);}return;}   // the same one-click consent as on every page (size in the question), then the export goes on
  }
  await session.pause();await clearExportResult();checkCurrent();
  // OPFS-backed results support actual browser downloads.
  checkCurrent();
  if(kind==='audio'){
   /* the export loads the voice in this tab: the engine host frees its copy first (not while a session uses it) */
   if(isExtension){await chrome.runtime.sendMessage({target:'host',t:'release'}).catch(()=>null);checkCurrent();}
   if(!exporter){const {ReaderAudiobookExport}=await import('../../export/reader-adapter.mjs');checkCurrent();exporter=new ReaderAudiobookExport({models});}
   const speechBlocks=[],from=partial?.range==='here'&&Number.isSafeInteger(partial.startChunk)?Math.max(0,partial.startChunk):0;for(const chunk of session.chunks.slice(from)){const paragraph=session.blocks[chunk.block]?.paragraph??chunk.block,last=speechBlocks.at(-1);if(last?.paragraph===paragraph)last.text+=' '+chunk.text;else speechBlocks.push({paragraph,text:chunk.text});}const speechText=partial?.range==='selection'?partial.doc.text:speechBlocks.map(block=>block.text).join('\n\n');
   const result=await exporter.exportBook({text:speechText,modelId,format,title,reading:settings.reading,normalize:settings.normalizeSpeech!==false,lang:session.lang,signal:exportAbort.signal,onProgress:info=>{session.setJob({state:'running',kind:'audio',...info});status(info.message||mt('fileExportComputing'));}});
   try{checkCurrent();}catch(error){await result.cleanup?.();throw error;}showResult(result,mt('fileExportFullText',{size:formatting.number(result.bytes/1e6,settings,{maximumFractionDigits:1})}));if(isExtension&&(result.historySaved||result.historyError)){const {libraryText}=await import('../../library/i18n.mjs');$('#export-status').textContent+=' '+libraryText(settings.uiLanguage,result.historySaved?'savedAudio':['library_audio_limit','library_quota'].includes(result.historyError)?'audioFull':'audioSaveFailed');}session.setJob({state:'complete',filename:result.filename,percent:100,resultReady:true});pendingSave=true;
  }else{
   let blob,note=mt('fileExportDocNote');const docText=partial?partial.doc.text:text,docFigures=partial?[]:documentFigures;if(format==='html')blob=await documentHtml(docText,title,look,{signal:exportAbort.signal,figures:docFigures,warnings:documentWarnings});else{const result=await documentPdf(docText,title,look,{signal:exportAbort.signal,figures:docFigures,warnings:documentWarnings,onProgress:info=>session.setJob({state:'running',kind:'document',...info})});blob=result.blob;note=mt('fileExportPdfNote',{pages:result.pages});}
   if(documentWarnings.length)note+=' '+documentWarnings.join(' ');checkCurrent();const result={blob,filename:safeName(title,format),bytes:blob.size,cleanup:async()=>{}};showResult(result,note,'document');session.setJob({state:'complete',filename:result.filename,percent:100,resultReady:true});pendingSave=true;
  }
 }catch(error){if(abort.signal.aborted||sourceGeneration!==generation||currentText!==text)error=new DOMException('Abgebrochen','AbortError');{const cancelled=error.name==='AbortError';status(cancelled?mt('fileExportCancelled'):errorText(error)||mt('fileExportFailed'),!cancelled);session.setJob({state:cancelled?'cancelled':'error',errorKey:cancelled?'':'export_failed'});}}
 finally{exportAbort=null;lock(false);if(pendingSave)saveResult();}   // saved once the tab is unlocked (downloadResult refuses while busy)
}
/* Keyboard actions of the file view (Alt+Shift): PDF page instead of paragraph while the PDF preview is open, and "open file". */
const pdfPreviewOpen=()=>!!pdf&&!$('#pdf-preview').hidden&&$('#pdf-preview').open;
const keyboardActions={previousBlock:()=>{if(!pdfPreviewOpen())return false;$('#pdf-previous').click();return true;},nextBlock:()=>{if(!pdfPreviewOpen())return false;$('#pdf-next').click();return true;},openFile:()=>{if(!exportBusy)$('#file').click();return true;}};
function applyKeyHints(){const keyboard=session?.surface?.keyboard;if(!keyboard)return;const mark=(selector,base,...ids)=>{const node=$(selector);if(!node)return;const hint=keyboard.hint(...ids),keys=keyboard.aria(...ids);node.title=base+hint;if(keys)node.setAttribute('aria-keyshortcuts',keys);else node.removeAttribute('aria-keyshortcuts');};for(const id of ['#header-open','#empty-open'])mark(id,mt('fileOpen'),'openFile');mark('#pdf-previous',$('#pdf-previous')?.getAttribute('aria-label')||'','previousBlock');mark('#pdf-next',$('#pdf-next')?.getAttribute('aria-label')||'','nextBlock');}
let fileLibrary=null;
let focusOrigin=false;   // opened by "focus" on a page tab: the same command is the way back (the worker closes this tab and activates the page tab)
async function toggleFocus(){
 if(isExtension&&focusOrigin&&document.body.hasAttribute('data-focus')){let reply=null;try{const at=placeChar();reply=await chrome.runtime.sendMessage({t:'closeFocus',...(at!==null?{charStart:at}:{})});}catch{}if(reply?.ok)return;focusOrigin=false;}   // origin unknown (worker restarted without memory): behave like a plain view switch
 document.body.toggleAttribute('data-focus');session.surface.refreshLayout();session.changed();
}
session=new PageSession({source:{collect:()=>docSource},mount:$('#player-mount'),ownPage:true,appearanceController:appearance,keyboardActions,onKeyboardChange:()=>applyKeyHints(),
 onVisibility:visible=>{$('#show-player').hidden=visible;},onUiLanguage:()=>onUiLanguage(),onMark,onChanged:()=>{sampleBlocked();statusLine();fileLibrary?.state(session.state);},onSettings,onJob:job=>sendJob(job,job.state!=='running'),
 handlers:{export:value=>startExport(typeof value==='string'?value:value?.format,'audio',false,typeof value==='object'?value:null),exportDocument:value=>startExport(typeof value==='string'?value:value?.format,'document',false,typeof value==='object'?value:null),cancelExport:()=>{exportAbort?.abort();exporter?.cancel();},downloadResult:()=>showResultHere(),openFocus:()=>toggleFocus()}});
await session.init();settings=session.settings;
/* temporary audiobook files of crashed or closed export runs stay in the origin's storage: remove those no tab holds */
setTimeout(()=>{void import('../../export/index.mjs').then(m=>m.clearAudiobookStorage()).catch(()=>{});},5000);

const formatting=createFormatting({formatLocales:session.locales.formatLocales});
function applyPageText(){document.documentElement.lang=settings.uiLanguage||'de';document.title=mt('fileTitle');applyStaticText(document,mt);ocrPanel.refresh();}
// one section reads "1 section", not "1 sections"
const docMeta=()=>mt(docChunks.length===1?'fileDocMetaOne':'fileDocMeta',{chars:num(currentText.length),
 sections:num(docChunks.length),lang:documentLanguage.toUpperCase()});
/* The sample from the popup plays once: the popup click is the request. A browser that refuses sound in a new tab
   leaves the normal Play state, never an error. */
function startSample(){sampleUntil=Date.now()+8000;void session.toggle();}
function sampleBlocked(){if(!sampleUntil||Date.now()>sampleUntil){sampleUntil=0;return;}
 if(session.state!=='error'||session.lastError!=='playback-failed')return;sampleUntil=0;session.stop();session.fail('');}
function onUiLanguage(){applyPageText();applyKeyHints();fileLibrary?.refresh();if(currentText){$('#document-meta').textContent=docMeta();spans.forEach((span,index)=>span.setAttribute('aria-label',mt('sectionRead',{n:index+1})));statusKey='';statusLine();}}
applyPageText();applyKeyHints();
settings.appearance={...appearance.defaults,...settings.appearance};applyPageTheme();
const SEGMENT_MIN_CHARS=120000,SEGMENT_CHARS=6000;
// Click-to-seek on the text is the shared one (reading-marks -> page-highlight). Only the keyboard (Enter/Space on a focused section) is handled here.
$('#reading-text').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target.classList?.contains('sentence')&&!exportBusy&&settings.clickSeek!==false){event.preventDefault();const index=spokenChunkForDisplay(Number(event.target.dataset.i));if(index>=0)void session.seekTo(index,0,false);}});
/* Where to start: the place saved for this text (the session's resume points), else a place of releases up to 2.4.0, else the Focus Reader's character handed over by the page. */
async function initialPosition(resumeCharStart){
 let start={chunk:0,word:0,restored:false};
 let saved=await session.resume.get(currentFingerprint).catch(()=>null);
 if(saved&&!Number.isSafeInteger(saved.char)&&atDocumentEnd(docChunks,saved))saved=null;       // read to the end last time: open at the beginning
 if(saved&&Number.isSafeInteger(saved.char))start={char:saved.char,restored:saved.char>0};else if(saved&&saved.chunk<docChunks.length)start={chunk:saved.chunk,word:saved.word,restored:saved.chunk>0||saved.word>0};
 else{const savedChar=legacy.positionChars?.[currentFingerprint],oldIndex=Number(legacy.positions[currentFingerprint])||0;
  if(Number.isSafeInteger(savedChar)){const i=docChunks.findIndex(c=>c.end>savedChar);if(i>=0)start={char:savedChar,restored:i>0};}
  else if(oldIndex>0&&resumeCharStart===null)resumeCharStart=chunksForLegacy(currentText).chunks[oldIndex]?.start??null;}
 if(Number.isSafeInteger(resumeCharStart)&&resumeCharStart>=0&&resumeCharStart<currentText.length){const i=docChunks.findIndex(c=>c.end>resumeCharStart);if(i>=0){const c=docChunks[i],rel=resumeCharStart-c.start,w=(wordOffsets(c.text,c.words)||[]).findIndex(o=>rel<o.end);start={char:resumeCharStart,restored:true};}}
 return start;
}
async function loadDocument(text,title,language='',expectedGeneration,chapters=[],figures=[],warnings=[],resumeCharStart=null,semanticRanges=[]){
 const sourceRanges=cleanSemanticRanges(semanticRanges,cleanText(text).length);
 const signal=figureAbort.signal,confirmed=await confirmFigures(figures,cleanText(text),{signal});if(expectedGeneration!==generation||signal.aborted)return;
 await clearExportResult();if(!Number.isSafeInteger(expectedGeneration)||expectedGeneration!==generation)return;documentGeneration=crypto.randomUUID();clearFigures();documentFigures=confirmed;documentWarnings=Array.isArray(warnings)?warnings.filter(w=>typeof w==='string').slice(0,8).map(w=>loc(w).slice(0,500)):[];let warningNode=$('#document-warnings');if(!warningNode){warningNode=document.createElement('p');warningNode.id='document-warnings';warningNode.className='reader-document-warning';warningNode.setAttribute('role','note');$('#document-meta').after(warningNode);}warningNode.textContent=documentWarnings.join(' ');warningNode.hidden=!documentWarnings.length;currentText=cleanText(text);statusKey='';documentLanguage=language||detectLanguage(currentText);currentFingerprint=fingerprint(currentText);currentDocumentMetadata=documentMetadata.get(expectedGeneration)||{kind:'file',url:'',fileName:'',mimeType:'text/plain'};documentSemanticRanges=sourceRanges;const result=sourceLayout(currentText,documentSemanticRanges);docChunks=result.chunks;docLayout=result.layout;session.stop();const chaptersOk=chapters.filter(c=>c&&typeof c.label==='string'&&Number.isSafeInteger(c.charStart)&&c.charStart>=0&&c.charStart<currentText.length);$('#document-title').removeAttribute('data-i18n');$('#document-title').textContent=title;$('#empty').hidden=!!currentText;const root=$('#reading-text');root.replaceChildren();spans=[];allRuns=[];activeSpan=null;let cursor=0;
 figureObserver=new IntersectionObserver(entries=>{for(const event of entries){const entry=figureNodes.find(e=>e.node===event.target);if(!entry)continue;entry.visible=event.isIntersecting;if(entry.visible)void paintFigure(entry);else{entry.serial++;entry.controller?.abort();entry.image.removeAttribute('src');delete entry.node.dataset.ready;}}},{rootMargin:'600px'});let nextFigure=0;
 const bounds=[...new Set((docLayout?.spans||[]).flat())].sort((x,y)=>x-y),nextBound=at=>{let lo=0,hi=bounds.length;while(lo<hi){const mid=(lo+hi)>>1;if(bounds[mid]>at)hi=mid;else lo=mid+1;}return lo<bounds.length?bounds[lo]:Infinity;};
 // Text is cut at the paragraph borders so that every text node belongs to exactly one block (the shared marks map block offsets onto these nodes).
 const piece=(parent,a,b,runs)=>{let at=a;while(at<b){const cut=Math.min(b,nextBound(at)),node=document.createTextNode(currentText.slice(at,cut));parent.append(node);runs?.push({node,start:at,end:cut});allRuns.push({node,start:at,end:cut});at=cut;}};
 const append=(parent,from,to,runs)=>{let position=from;while(nextFigure<documentFigures.length&&documentFigures[nextFigure].charStart<=to){const figure=documentFigures[nextFigure++],at=Math.max(position,figure.charStart);if(at>position)piece(parent,position,at,runs);parent.append(figureNode(figure));position=at;}if(position<to)piece(parent,position,to,runs);};
 // Long texts: block segments (cut right after a line break) let the browser skip style/layout/paint of everything off screen (content-visibility:auto).
 // Short texts keep the flat inline layout unchanged. One delegated listener serves all sections instead of two closures per section.
 const segmented=currentText.length>SEGMENT_MIN_CHARS,segments=[];let parent=root,segFrom=0;
 const closeSegment=to=>{if(parent===root)return;const lines=currentText.slice(segFrom,to).split('\n').length+Math.floor((to-segFrom)/110);parent.style.containIntrinsicBlockSize='auto '+lines+'lh';};
 const place=(from,to)=>{if(segmented&&from-segFrom>=SEGMENT_CHARS){const cut=currentText.indexOf('\n',from);if(cut>=0&&cut<to){append(parent,from,cut+1);closeSegment(cut+1);parent=document.createElement('div');parent.className='reader-seg';root.append(parent);segFrom=from=cut+1;}}append(parent,from,to);};
 if(segmented){parent=document.createElement('div');parent.className='reader-seg';root.append(parent);}
 docChunks.forEach((chunk,index)=>{place(cursor,chunk.start);const span=document.createElement('span');span.className='sentence';if(/^[^\p{L}\p{N}]*[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(chunk.text))span.dir='rtl';span.tabIndex=0;span.setAttribute('aria-label',mt('sectionRead',{n:index+1}));span.dataset.i=index;span.readerRuns=[];append(span,chunk.start,chunk.end,span.readerRuns);parent.append(span);spans.push(span);cursor=chunk.end;});place(cursor,currentText.length);closeSegment(currentText.length);buildSource(title,chaptersOk);const start=await initialPosition(resumeCharStart);if(expectedGeneration!==generation)return;await session.setDocument(start);start.chunk=session.position.chunk;start.word=session.position.word;if(!start.restored&&resumeCharStart===null){const restored=await session.restore();if(restored){start.chunk=restored.chunk;start.word=restored.word;start.restored=restored.chunk>0||restored.word>0;}}if(start.restored)session.markAt(start.chunk,start.word);$('#document-meta').removeAttribute('data-i18n');$('#document-meta').textContent=docMeta();appearance.refresh();session.surface.setVisibility(true);$('#show-player').hidden=true;session.setJob({state:'idle'});session.lastError='';session.changed();if(documentWarnings.length)status(documentWarnings.join(' '));if(!currentText)status(mt('noTextLayer'),true);else if(start.restored)status(mt('fileResumed',{current:start.chunk+1,count:docChunks.length}));if(new URL(location.href).searchParams.get('mode')==='audiobook')session.surface.openDownload();
}
async function themePdfPreview(){const serial=++previewThemeSerial,original=previewOriginal,gen=generation;if(!original||!session)return;try{const pixels=await transformPdfPixels(original,docAppearance(),previewRegions,{isCurrent:()=>serial===previewThemeSerial&&original===previewOriginal&&gen===generation});if(serial===previewThemeSerial&&original===previewOriginal&&gen===generation)$('#pdf-canvas').getContext('2d').putImageData(pixels,0,0);}catch(error){if(error.name!=='AbortError')status(mt('filePdfAdjustFailed'),true);}}
async function renderPdfPage(){if(!pdf)return;const sourcePdf=pdf;try{previewThemeSerial++;previewOriginal=null;previewRegions=[];pdfRender?.cancel();const serial=++pdfPaintSerial,gen=generation,thisPdf=pdf,pageNumber=pdfPage,page=await thisPdf.getPage(pageNumber);if(thisPdf!==pdf||gen!==generation||serial!==pdfPaintSerial)return;const viewport=boundedPdfViewport(page,{dpi:Number(settings.appearance?.pdfDpi)||144}),canvas=$('#pdf-canvas');canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));$('#pdf-page').textContent=mt('filePdfPageOf',{n:pageNumber,count:pdf.numPages});$('#pdf-previous').disabled=pageNumber<=1;$('#pdf-next').disabled=pageNumber>=pdf.numPages;const task=page.render({canvasContext:canvas.getContext('2d'),viewport});pdfRender=task;try{await task.promise;if(thisPdf!==pdf||gen!==generation||serial!==pdfPaintSerial)return;const operators=await page.getOperatorList();if(thisPdf!==pdf||gen!==generation||serial!==pdfPaintSerial)return;const lib=await import('./pdf-entry.mjs');previewRegions=pdfGeometry(operators,viewport,lib.OPS).regions;previewOriginal=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);await themePdfPreview();}catch(error){if(gen===generation&&serial===pdfPaintSerial&&error.name!=='RenderingCancelledException')status(mt('filePdfPreviewFailed'),true);}}catch(error){if(sourcePdf===pdf&&error.name!=='RenderingCancelledException')status(mt('filePdfPreviewFailed'),true);}}
async function importPdf(bytes,title,gen,ocrLang=null,file=null){
 const dispose=async doc=>{try{if(doc.loadingTask?.destroy)await doc.loadingTask.destroy();else await doc.destroy?.();}catch{}};
 const lib=await import('./pdf-entry.mjs');if(gen!==generation)return;
 lib.GlobalWorkerOptions.workerSrc=new URL('./pdf-worker-entry.mjs',import.meta.url).href;
 const task=lib.getDocument({data:bytes,isEvalSupported:false,cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/pdfjs/wasm/',import.meta.url).href});loadingTask=task;
 task.onPassword=(updatePassword,reason)=>{if(gen!==generation)return;passwordUpdate=updatePassword;$('#password-form').hidden=false;status(mt(reason===2?'filePdfWrongPassword':'filePdfNeedsPassword'));$('#pdf-password').focus();};
 const doc=await task.promise;if(gen!==generation){await dispose(doc);return;}
 const marginRecords=[],hasStoredPositions=Object.keys(legacy.positions).length>0;const charCounts=[];let textPages=0,legacyHash=2166136261,legacyLength=0,legacyHashHasPage=false;const hashLegacy=value=>{for(let i=0;i<value.length;i++){legacyHash^=value.charCodeAt(i);legacyHash=Math.imul(legacyHash,16777619);}legacyLength+=value.length;};for(let n=1;n<=doc.numPages;n++){if(gen!==generation){await dispose(doc);return;}status(mt('filePdfMargins',{n,count:doc.numPages}));const page=await doc.getPage(n),content=await page.getTextContent();if(gen!==generation){page.cleanup();await dispose(doc);return;}if(hasStoredPositions){const oldText=cleanText(textFromPdfItems(content.items));if(oldText){if(legacyHashHasPage)hashLegacy('\n\n');hashLegacy(oldText);legacyHashHasPage=true;}}marginRecords.push(pdfMarginLines(content.items,boundedPdfViewport(page,{dpi:72})));if(content.items.some(item=>typeof item.str==='string'&&item.str.trim()))textPages++;charCounts.push(visibleChars(content.items));page.cleanup();}
 let ocrPages=null;const verdict=scanVerdict(charCounts);
 if(verdict.scan){/* more than half of the pages carry (almost) no text: a scan. Offer local text recognition instead of an error. */
  if(!ocrLang){const language=chooseLanguage((await doc.getMetadata().catch(()=>null))?.info?.Language,settings?.uiLanguage);await dispose(doc);if(gen===generation){ocrJob={kind:'pdf',file,title};status(mt('ocrOfferStatus'));ocrPanel.offer({kind:'pdf',lang:language});}return;}
  ocrPages=await runOcr(doc,{file,lang:ocrLang,pages:verdict.sparsePages,gen,kind:'pdf'});if(!ocrPages){await dispose(doc);return;}
 }
 const hiddenMargins=repeatedPdfMargins(marginRecords,doc.numPages,textPages),legacyKey=hasStoredPositions?legacyLength+'-'+(legacyHash>>>0).toString(16):'',legacyPosition=legacy.positions[legacyKey],migrateLegacy=hasStoredPositions&&Object.hasOwn(legacy.positions,legacyKey)&&Number.isSafeInteger(legacyPosition)&&legacyPosition>=0,legacyChunkStarts=migrateLegacy?[]:null,retainedRanges=migrateLegacy?[]:null;let legacyPageOffset=0,legacyHasText=false;
 const pages=[],figures=[];let pageOffset=0,hasTextPage=false;for(let n=1;n<=doc.numPages;n++){
  if(gen!==generation){await dispose(doc);return;}status(mt('filePdfOpeningPage',{n,count:doc.numPages}));
  const page=await doc.getPage(n);if(gen!==generation){page.cleanup();await dispose(doc);return;}
  const content=await page.getTextContent();if(gen!==generation){page.cleanup();await dispose(doc);return;}
  const readingItems=content.items.filter((_,index)=>!hiddenMargins[n-1].has(index)),ocrPage=ocrPages?.get(n),pageText=ocrPage?ocrPage.text:textFromPdfItems(readingItems),normalized=cleanText(pageText),viewport=boundedPdfViewport(page,{dpi:72}),geometry=pdfGeometry(await page.getOperatorList(),viewport,lib.OPS);if(gen!==generation){page.cleanup();await dispose(doc);return;}
  const pageStart=pageOffset+(normalized&&hasTextPage?2:0),sourceRegions=geometry.regions,photos=sourceRegions.filter(r=>r.kind==='image'),meaningful=sourceRegions.some(r=>r.kind==='diagram');let sourceFigures=ocrPage?[]:geometry.fallback?[{bbox:[0,0,1,1],kind:'page'}]:photos;
  if(migrateLegacy){const legacyPage=cleanText(textFromPdfItems(content.items)),oldPageStart=legacyPageOffset+(legacyPage&&legacyHasText?2:0);for(const chunk of chunksForLegacy(legacyPage).chunks)legacyChunkStarts.push(oldPageStart+chunk.start);let oldCursor=0,newCursor=0;for(let index=0;index<content.items.length;index++){const value=cleanText(content.items[index].str);if(!value)continue;const oldAt=legacyPage.indexOf(value,oldCursor);if(oldAt<0)continue;oldCursor=oldAt+value.length;if(hiddenMargins[n-1].has(index))continue;const newAt=normalized.indexOf(value,newCursor);if(newAt<0)continue;newCursor=newAt+value.length;retainedRanges.push({oldStart:oldPageStart+oldAt,oldEnd:oldPageStart+oldAt+value.length,newStart:pageStart+newAt,newEnd:pageStart+newAt+value.length});}if(legacyPage){legacyPageOffset=oldPageStart+legacyPage.length;legacyHasText=true;}}

  let textCursor=0;const items=[];for(const item of readingItems){const value=cleanText(item.str);if(!value)continue;const at=normalized.indexOf(value,textCursor);if(at<0)continue;textCursor=at+value.length;const point=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);items.push({start:at,y:point[1]/viewport.height});}
  for(const region of sourceFigures){const after=items.find(item=>item.y>region.bbox[3]+.005),charStart=pageStart+(region.kind==='page'?normalized.length:after?.start??normalized.length),bbox=[...region.bbox],meta={charStart,kind:region.kind,alt:region.kind==='page'?mt('filePdfFigureComplex',{n}):mt('filePdfFigure',{n}),width:Math.max(1,Math.ceil((bbox[2]-bbox[0])*viewport.width)),height:Math.max(1,Math.ceil((bbox[3]-bbox[1])*viewport.height))};
   figures.push(lazyFigure(meta,async({signal}={})=>{checkAbort(signal);if(gen!==generation||pdf!==doc)throw new DOMException('Abgebrochen','AbortError');const sourcePage=await doc.getPage(n),view=boundedPdfViewport(sourcePage,{dpi:144}),source=document.createElement('canvas');source.width=Math.max(1,Math.ceil(view.width));source.height=Math.max(1,Math.ceil(view.height));const render=sourcePage.render({canvasContext:source.getContext('2d'),viewport:view}),cancel=()=>render.cancel();signal?.addEventListener('abort',cancel,{once:true});try{await render.promise;checkAbort(signal);if(gen!==generation||pdf!==doc)throw new DOMException('Abgebrochen','AbortError');const crop=document.createElement('canvas');try{const x=Math.floor(bbox[0]*source.width),y=Math.floor(bbox[1]*source.height);crop.width=Math.max(1,Math.ceil(bbox[2]*source.width)-x);crop.height=Math.max(1,Math.ceil(bbox[3]*source.height)-y);crop.getContext('2d').drawImage(source,x,y,crop.width,crop.height,0,0,crop.width,crop.height);return{src:crop.toDataURL('image/png'),regions:region.kind==='page'?sourceRegions:[]};}finally{crop.width=crop.height=0;}}finally{signal?.removeEventListener('abort',cancel);source.width=source.height=0;sourcePage.cleanup();}}));
  }
  pages.push(pageText);if(normalized){pageOffset=pageStart+normalized.length;hasTextPage=true;}page.cleanup();
 }
 if(gen!==generation){await dispose(doc);return;}
 $('#password-form').hidden=true;$('#pdf-password').value='';passwordUpdate=null;pdf=doc;pdfPage=1;
 const chapters=[];try{const outline=await doc.getOutline(),normalizedPages=pages.map(cleanText),starts=[];let offset=0,hasText=false;for(const page of normalizedPages){const start=offset+(page&&hasText?2:0);starts.push(start);if(page){offset=start+page.length;hasText=true;}}const visit=async(items,level)=>{for(const item of items||[]){if(gen!==generation)return;let destination=typeof item.dest==='string'?await doc.getDestination(item.dest):item.dest;if(Array.isArray(destination)){const ref=destination[0],pageIndex=Number.isInteger(ref)?ref:await doc.getPageIndex(ref);if(pageIndex>=0&&pageIndex<normalizedPages.length){const label=cleanText(item.title).slice(0,160),inside=normalizedPages[pageIndex].indexOf(label);if(label)chapters.push({label,level,charStart:starts[pageIndex]+Math.max(0,inside)});}}await visit(item.items,level+1);}};await visit(outline,1);}catch{}
 if(gen!==generation){if(pdf===doc)pdf=null;await dispose(doc);return;}
 let resumeCharStart=null;const migrationWarnings=[],finalText=cleanText(pages.join('\n\n')),newKey=fingerprint(finalText);if(migrateLegacy&&!Object.hasOwn(legacy.positions,newKey)&&legacyPosition<legacyChunkStarts.length){const original=legacyChunkStarts[legacyPosition],range=retainedRanges.find(item=>item.oldEnd>original)||retainedRanges.at(-1);if(range){resumeCharStart=range.newStart+Math.max(0,Math.min(range.newEnd-range.newStart-1,original-range.oldStart));const index=documentChunks(finalText).chunks.findIndex(chunk=>chunk.end>resumeCharStart);if(index>=0)void session.resume.save(newKey,{chunk:index,word:0},{force:true});else resumeCharStart=null;}}
 if(ocrPages)migrationWarnings.push(mt('ocrWarning'));
 await loadDocument(finalText,title,ocrPages?languageByCode(ocrLang)?.ui||'':'',gen,chapters,figures,migrationWarnings,resumeCharStart);if(ocrPages&&gen===generation)ocrPanel.hide();if(gen!==generation){if(pdf===doc)pdf=null;await dispose(doc);return;}
 $('#pdf-preview').hidden=false;if($('#pdf-preview').open)await renderPdfPage();
}
async function cancelPdf(){ocrController?.abort();ocrJob=null;ocrPanel.hide();pdfPaintSerial++;previewThemeSerial++;previewOriginal=null;previewRegions=[];clearFigures();passwordUpdate=null;$('#password-form').hidden=true;$('#pdf-password').value='';pdfRender?.cancel();if(loadingTask){try{await loadingTask.destroy();}catch{}}loadingTask=null;pdf=null;$('#pdf-preview').hidden=true;}
$('#password-form').addEventListener('submit',event=>{event.preventDefault();const password=$('#pdf-password').value;$('#pdf-password').value='';passwordUpdate?.(password);});
async function loadFile(file,{archive=false}={}){if(!file||exportBusy)return false;fileLibrary?.cancel();const gen=++generation;setDocumentMetadata(gen,{fileName:file.name,mimeType:file.type});importBusy=true;session.stop();await cancelPdf();if(gen!==generation)return;status(mt('fileOpening'));try{if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){if(file.size>MAX_PDF_BYTES)throw Object.assign(new Error('pdf-too-large'),{code:'pdf-too-large'});const bytes=await file.arrayBuffer();if(gen!==generation)return;await importPdf(new Uint8Array(bytes),file.name,gen,null,file);}else if(/^image\/(png|jpeg|webp)$/.test(file.type)||/\.(png|jpe?g|webp)$/i.test(file.name)){if(file.size>64*1024*1024)throw new Error('Diese Datei ist zu groß für den sicheren Archivimport (128 MB).');await importImage(file,gen);}else{const {importTextFile}=await import('./formats.js');if(gen!==generation)return;const imported=await importTextFile(file);if(gen===generation)await loadDocument(imported.text,imported.title||file.name,imported.language||'',gen,imported.chapters||[],imported.figures||[],imported.warnings||[],null,imported.semanticRanges||[]);}if(gen===generation&&isExtension&&archive){try{const {saveDocument}=await import('../../library/store.mjs');await saveDocument({blob:file,title:file.name,filename:file.name,origin:'import'});}catch{}}return gen===generation&&currentText.length>0;}catch(error){if(gen===generation)status(error.name==='PasswordException'?mt('filePdfValidPassword'):errorText(error)||mt('fileOpenFailed'),true);return false;}finally{if(gen===generation){importBusy=false;statusKey='';statusLine();}}}
$('#file').addEventListener('change',async event=>{const file=event.target.files?.[0];event.target.value='';await loadFile(file,{archive:true});});
/* A file dropped anywhere on the file view opens like "Open a file" (without this the browser leaves the page for the
   file). Only real file drags are taken; text drags keep their normal meaning. */
const fileDrag=event=>[...(event.dataTransfer?.types||[])].includes('Files');
addEventListener('dragover',event=>{if(!fileDrag(event))return;event.preventDefault();
 event.dataTransfer.dropEffect=exportBusy?'none':'copy';$('label.file')?.setAttribute('data-drag','');});
addEventListener('dragleave',event=>{if(!event.relatedTarget)$('label.file')?.removeAttribute('data-drag');});
addEventListener('drop',event=>{if(!fileDrag(event))return;event.preventDefault();const zone=$('label.file');
 zone?.removeAttribute('data-drag');zone?.removeAttribute('data-attention');const file=event.dataTransfer.files?.[0];
 if(file&&!exportBusy)void loadFile(file,{archive:true});});
$('#load-text').addEventListener('click',async()=>{if(exportBusy)return;fileLibrary?.cancel();const gen=++generation,text=$('#paste').value;importBusy=true;await cancelPdf();if(gen!==generation)return;await loadDocument(text,mt('fileUntitled'),'',gen);if(gen===generation){importBusy=false;statusKey='';statusLine();}});
for(const id of ['header-open','empty-open'])$('#'+id).addEventListener('click',()=>{if(!exportBusy)$('#file').click();});
$('#show-player').addEventListener('click',()=>{session.surface.setVisibility(true);$('#show-player').hidden=true;});
$('#header-converter').addEventListener('click',()=>{session.surface.setVisibility(true);if(!currentText){$('#paste').focus();status(mt('fileConverterFirst'));return;}session.surface.openDownload();});
$('#pdf-previous').addEventListener('click',()=>{if(pdfPage>1){pdfPage--;renderPdfPage();}});$('#pdf-next').addEventListener('click',()=>{if(pdf&&pdfPage<pdf.numPages){pdfPage++;renderPdfPage();}});$('#pdf-preview').addEventListener('toggle',()=>{if($('#pdf-preview').open)renderPdfPage();});
const idleUnload=enabled=>void chrome.runtime.sendMessage({target:'host',t:'idleUnload',enabled}).catch(()=>{});$('#unload-idle').checked=settings.unloadIdle===true;idleUnload(settings.unloadIdle===true);$('#unload-idle').addEventListener('change',()=>{idleUnload($('#unload-idle').checked);void session.applySettings({unloadIdle:$('#unload-idle').checked});});
$('#clear-models').addEventListener('click',async()=>{if(exportBusy)return;session.stop();await chrome.runtime.sendMessage({target:'host',t:'clear'}).catch(()=>{});await clearLanguages().catch(()=>{});await session.refreshVoices();});
$('#clear-data').addEventListener('click',async()=>{if(exportBusy)return;session.stop();localStorage.removeItem(key);legacy={positions:{}};await session.clearData();await clearOcrCache();settings=session.settings;settings.appearance={...appearance.defaults};currentFingerprint='';$('#unload-idle').checked=false;idleUnload(false);$('#privacy-status').textContent=mt('filePrivacyCleared');});
$('#clear-export-storage').addEventListener('click',async()=>{if(exportBusy)return;await clearExportResult();const {clearAudiobookStorage}=await import('../../export/index.mjs');const result=await clearAudiobookStorage();$('#privacy-status').textContent=result.message;});$('#clear-export').addEventListener('click',()=>{if(!exportBusy)clearExportResult();});

if(isExtension){$('#access-note').dataset.i18n='fileAccessExt';$('#footer-access').dataset.i18n='fileFooterExt';applyPageText();}

/* "Open in file view" from the popup on a PDF in the browser's own viewer (#pdf=<address>&tab=<id>). The popup click
   gave access to exactly that tab (activeTab), so the bytes are read inside the tab (same origin, its cookies) and
   handed over in slices: no new permission, no wider connect-src. Without that access a clear hint marks the drop
   area instead. */
const PDF_SLICE=4*1024*1024,PDF_LIMIT=512*1024*1024;
async function pdfFromTab(url,tabId){
 const gen=++generation,token=crypto.randomUUID(),target={tabId,frameIds:[0]};
 const run=async(func,args)=>(await chrome.scripting.executeScript({target,world:'ISOLATED',func,args}))?.[0]?.result;
 try{
  const tab=await chrome.tabs.get(tabId);if(tab?.url!==url)throw Error('tab_changed');
  const size=await run(async(token,limit)=>{const response=await fetch(location.href,{credentials:'include'});
   if(!response.ok)return -1;const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length>limit||String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')return -1;
   globalThis.__notablePdfHandoff={token,bytes};return bytes.length;},[token,PDF_LIMIT]);
  if(!(size>0))throw Error('no_pdf');
  const bytes=new Uint8Array(size);
  for(let start=0;start<size;start+=PDF_SLICE){
   if(gen!==generation)return;
   const part=await run((token,start,end)=>{const own=globalThis.__notablePdfHandoff;if(own?.token!==token)return null;
    let text='';const slice=own.bytes.subarray(start,end);
    for(let i=0;i<slice.length;i+=32768)text+=String.fromCharCode(...slice.subarray(i,i+32768));return btoa(text);},
   [token,start,Math.min(size,start+PDF_SLICE)]);
   if(typeof part!=='string')throw Error('tab_changed');
   const raw=atob(part);for(let i=0;i<raw.length;i++)bytes[start+i]=raw.charCodeAt(i);
  }
  const name=decodeURIComponent(new URL(url).pathname.split('/').pop()||'')||'document.pdf';
  if(gen===generation)await loadFile(new File([bytes],/\.pdf$/i.test(name)?name:name+'.pdf',{type:'application/pdf'}));
 }catch{if(gen===generation){status(mt('filePdfHandoff'),true);$('label.file')?.setAttribute('data-attention','');}}
 finally{void run(token=>{if(globalThis.__notablePdfHandoff?.token===token)delete globalThis.__notablePdfHandoff;},[token])
  .catch(()=>{});}
}
if(isExtension&&/^#pdf=/.test(location.hash)){const params=new URLSearchParams(location.hash.slice(1)),url=params.get('pdf')||'',
 tabId=Number(params.get('tab'));history.replaceState(null,'',location.pathname+location.search);
 if(/^https?:\/\//i.test(url)&&Number.isSafeInteger(tabId)&&tabId>=0)void pdfFromTab(url,tabId);
 else{status(mt('filePdfHandoff'),true);$('label.file')?.setAttribute('data-attention','');}}
if(isExtension&&/^#incoming=[a-f0-9-]{36}$/.test(location.hash)){const incomingGen=++generation,incoming='notable-incoming-'+location.hash.slice(10);chrome.storage.session.get(incoming).then(async values=>{const doc=values[incoming];await chrome.storage.session.remove(incoming);if(incomingGen!==generation)return;history.replaceState(null,'',location.pathname+location.search);if(doc&&typeof doc.text==='string'&&Date.now()-doc.created<300000){setDocumentMetadata(incomingGen,{url:doc.sourceURL||doc.sourceUrl||doc.url||'',fileName:doc.fileName||'',mimeType:doc.mimeType||'text/html',noHistory:doc.sample===true});if(Number.isSafeInteger(doc.originTab)&&typeof doc.exportToken==='string')exportOrigin={tab:doc.originTab,token:doc.exportToken};if(doc.appearance!==undefined){if(invalidValue('appearance',doc.appearance))throw Error('incoming_appearance_invalid');settings.appearance={...appearance.defaults,...doc.appearance};appearance.update(settings.appearance);void session.applySettings({appearance:settings.appearance});}await loadDocument(doc.text,doc.title||'Artikel',doc.language||'',incomingGen,doc.chapters||[],doc.figures||[],doc.warnings||[],doc.focus===true&&Number.isSafeInteger(doc.resumeChar)&&doc.resumeChar>0?doc.resumeChar:null,doc.semanticRanges||[]);if(incomingGen===generation&&doc.focus===true){focusOrigin=doc.focusOrigin===true;document.body.setAttribute('data-focus','');session.surface.refreshLayout();session.changed();}if(incomingGen===generation&&['mp3','wav','pdf','html'].includes(doc.autoExport))void startExport(doc.autoExport);
 if(incomingGen===generation&&doc.sample===true&&doc.autoplay===true)startSample();}else status(mt('fileTemporaryExpired'),true);}).catch(()=>{if(incomingGen===generation)status(mt('fileTemporaryFailed'),true);});}
const appearanceMedia=matchMedia('(prefers-color-scheme:dark)'),systemAppearanceChanged=()=>{applyPageTheme();if(settings.appearance?.mode==='auto'){void themePdfPreview();refreshFigureAppearance();}};appearanceMedia.addEventListener('change',systemAppearanceChanged);
/* Sidebar export (the bar's download menu): this tab runs the job, the page that asked mirrors its state and can cancel or fetch the file. Only that tab, only with the token minted for this export. */
let exportOrigin=null,lastJobSent=0;
const sendJob=(job,force)=>{if(!exportOrigin||!isExtension)return;const now=Date.now();if(!force&&job.state==='running'&&now-lastJobSent<250)return;lastJobSent=now;const out={state:job.state,kind:job.kind==='document'?'document':'audio',percent:Number(job.percent)||0,completedChunks:Number(job.completedChunks)||0,totalChunks:Number(job.totalChunks)||0,filename:String(job.filename||'').split(/[\\/]/).at(-1),resultReady:job.state==='complete'&&job.resultReady===true&&!!exportResult,errorKey:job.errorKey||''};try{Promise.resolve(chrome.tabs.sendMessage(exportOrigin.tab,{target:'session',t:'exportJob',token:exportOrigin.token,job:out})).catch(()=>{});}catch{}};

if(isExtension)chrome.runtime.onMessage.addListener((m,sender,respond)=>{if(m?.t!=='exportCommand'||!exportOrigin||sender.id!==chrome.runtime.id||sender.tab?.id!==exportOrigin.tab||m.token!==exportOrigin.token)return false;if(m.command==='cancel'){session.command('cancelExport');respond({ok:true});}else if(m.command==='download'){respond({ok:showResultHere()});}else respond({ok:false});return false;});
window.addEventListener('pagehide',()=>{sendJob({state:'idle'},true);appearanceMedia.removeEventListener('change',systemAppearanceChanged);closed=true;clearFigures();previewThemeSerial++;previewOriginal=null;session.stop();exportAbort?.abort();exporter?.cancel();clearExportResult();session.destroy();});document.addEventListener('keydown',event=>{if(exportBusy)return;if(event.altKey&&event.code==='Space'){event.preventDefault();session.command('toggle');}if(event.key==='Escape'&&session.state==='playing')void session.pause();});
// No document bytes, Blob URLs or bearer capabilities are exposed to the own-popup consumer.
/* Round 3: the file is saved as soon as the export the user asked for is done (before, it waited for a second "download the ready file" click
   in a menu, so nothing seemed to arrive). "Show file" afterwards brings this tab with its result card and save link to the front, no second copy. */
let savedResult=null;
function saveResult(){if(!exportResult)return false;if(savedResult===exportResult)return true;const done=downloadResult();if(done)savedResult=exportResult;return done;}
function showResultHere(){if(!exportResult||resultGeneration!==documentGeneration)return false;if(savedResult!==exportResult&&!saveResult())return false;$('#export-result').hidden=false;$('#export-result').scrollIntoView({block:'nearest'});$('#download-audio').focus({preventScroll:true});if(isExtension)void chrome.tabs.getCurrent().then(tab=>tab&&chrome.tabs.update(tab.id,{active:true})).catch(()=>{});return true;}
function downloadResult(){if(closed||importBusy||exportBusy||!exportResult||resultGeneration!==documentGeneration||!exportUrl)return false;const link=$('#download-audio');if(link.getAttribute('href')!==exportUrl||link.download!==exportResult.filename)return false;link.click();return true;}
// The visible anchor and bridge both enter this same download path. A canceled or
// stale generation never enters the archive, repeated download clicks deduplicate.
const archivedResults=new WeakSet();
$('#download-audio').addEventListener('click',()=>{if(!isExtension||closed||importBusy||exportBusy||!exportResult||resultGeneration!==documentGeneration||!exportUrl||resultKind!=='document'||archivedResults.has(exportResult))return;const result=exportResult,source={...currentDocumentMetadata,title:$('#document-title').textContent,text:currentText,language:documentLanguage,semanticRanges:structuredClone(documentSemanticRanges)};archivedResults.add(result);void import('../../library/store.mjs').then(async({saveDocument})=>{await saveDocument({blob:result.blob,title:source.title,filename:result.filename,origin:'export',source});if(result===exportResult){const {libraryText}=await import('../../library/i18n.mjs');$('#export-status').textContent+=' '+libraryText(settings.uiLanguage,'documentSaved');}}).catch(async()=>{archivedResults.delete(result);if(result===exportResult){const {libraryText}=await import('../../library/i18n.mjs');$('#export-status').textContent+=' '+libraryText(settings.uiLanguage,'documentsFull');}});});
const snapshot=()=>{const state=structuredClone(session.snapshot());state.config=structuredClone(Object.fromEntries(EXPORT_KEYS.filter(k=>session.settings[k]!==undefined).map(k=>[k,session.settings[k]])));const ready=!closed&&!importBusy&&currentText.length>0,resultReady=!closed&&!importBusy&&!!exportResult&&resultGeneration===documentGeneration;if(!ready)state.controls.canToggle=false;state.exportState.resultReady=resultReady;return{generation:documentGeneration,ready,title:$('#document-title').textContent,visible:!closed&&session.surface.getActualVisible(),state,resultReady,filename:resultReady?exportResult.filename:null,kind:resultReady?resultKind:null};};
const globalCommands=new Set(['speed','volume','mute','voice','downloadVoice','removeVoice','cancelDownload','language','follow','clickseek','uiLanguage','formatLocale','timeFormat','playerTheme','appearance','toggleTheme','config']);
const documentCommands=new Set(['addBookmark','explainPage','toggle','restart','previousSection','nextSection','previousBlock','nextBlock','previousChapter','nextChapter','seekRelative','seekSection','seekChapter','seekProgress','openFocus','export','exportDocument','downloadResult']);
const commands=new Set([...globalCommands,...documentCommands,'stop','cancelExport']);
function invalidValue(command,value){const finite=(min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
 if(['mute','follow','clickseek'].includes(command))return typeof value!=='boolean';
 if(command==='speed')return!finite(.5,4);if(command==='volume')return!finite(0,150)||value%5!==0;if(command==='seekProgress')return!finite(0,1);if(command==='seekRelative')return!finite(-600,600);
 if(['seekSection','seekChapter'].includes(command))return!Number.isInteger(value)||value<0||value>=(command==='seekSection'?session.chunks.length:session.chapters.length);
 if(command==='addBookmark')return value!==undefined&&(typeof value!=='string'||value.length>120);
 if(command==='export')return!['mp3','wav'].includes(value);if(command==='exportDocument')return!['pdf','html'].includes(value);
 if(command==='uiLanguage')return!session.locales.languages.some(item=>(typeof item==='string'?item:item.code)===value);
 if(command==='formatLocale')return!session.locales.formatLocales.includes(value);
 if(command==='timeFormat')return!['auto','12h','24h'].includes(value);if(command==='playerTheme')return!['system','light','dark'].includes(value);
 if(command==='voice')return!value||typeof value!=='object'||!session.catalog.some(group=>group.code===value.language&&group.voices.some(voice=>voice.id===value.id));
 if(command==='downloadVoice')return typeof value!=='string'||!session.catalog.some(group=>group.voices.some(voice=>voice.id===value&&voice.installed===false));
 if(command==='cancelDownload')return typeof value!=='string'||!session.catalog.some(group=>group.voices.some(voice=>voice.id===value&&voice.installed===false));
 if(command==='removeVoice')return typeof value!=='string'||!session.catalog.some(group=>group.voices.some(voice=>voice.id===value&&voice.installed===true));
 if(command==='config'){const keys=SESSION_PATCH_KEYS;if(!value||typeof value!=='object'||Array.isArray(value)||!Object.keys(value).length)return true;return Object.entries(value).some(([k,v])=>!keys.includes(k)||!FIELDS[k].check(v,{uiLanguages:session.locales.languages.map(i=>typeof i==='string'?i:i.code),formatLocales:session.locales.formatLocales}));}
 if(command==='language')return value!=='auto'&&!session.catalog.some(group=>group.code===value);
 if(command==='appearance'){const defs=appearance.defaults;if(!value||typeof value!=='object'||Array.isArray(value)||!Object.keys(value).length)return true;const ranges={brightness:[50,150],contrast:[50,150],sepia:[0,100],grayscale:[0,100],imageBrightness:[25,150],fontSize:[12,32],lineHeight:[1.2,2.4],contentWidth:[480,1200]};for(const[k,v]of Object.entries(value)){if(!Object.hasOwn(defs,k))return true;if(k in ranges){if(typeof v!=='number'||!Number.isFinite(v)||v<ranges[k][0]||v>ranges[k][1])return true;}else if(/^(background|text|link|lightBackground|lightText|lightLink)$/.test(k)){if(!/^#[a-f0-9]{6}$/i.test(v))return true;}else if(k==='mode'){if(!['off','dark','light','auto'].includes(v))return true;}else if(k==='imageMode'){if(!['preserve','dim','invert','smart'].includes(v))return true;}else if(k==='fontFamily'){if(!['system','sans','serif','mono'].includes(v))return true;}else if(k==='pdfDpi'){if(![96,144,192].includes(v))return true;}else if(typeof defs[k]!==typeof v)return true;}return false;}
 return false;
}
const guard=expected=>closed?'closed':expected!==documentGeneration?'stale_generation':importBusy?'import_busy':null;
const reply=(ok,code,extra={})=>({ok,...(code?{code}:{}),...extra,snapshot:snapshot()});
const bridge=Object.freeze({version:1,instanceId,getSnapshot:snapshot,
 async execute(command,value,expected){let code=guard(expected);if(code)return reply(false,code);if(!commands.has(command))return reply(false,'invalid_command');if(invalidValue(command,value))return reply(false,'invalid_value');if(documentCommands.has(command)&&!currentText)return reply(false,'unavailable');if(exportBusy&&!['cancelExport','stop'].includes(command))return reply(false,'import_busy');if(command==='downloadResult'){const ok=downloadResult();return reply(ok,ok?null:'unavailable');}
  if(command==='export'||command==='exportDocument'){void session.command(command,value).catch(()=>{});return reply(true,null,{pending:true});}
  await session.command(command,value);code=guard(expected);return reply(!code,code);
 },
 async activate(code,expected){return reply(false,guard(expected)||'activation_unavailable');},
 async setVisible(visible,expected){const error=guard(expected);if(error)return reply(false,error);if(typeof visible!=='boolean')return reply(false,'invalid_value');session.setVisible(visible);return reply(true);}
});
globalThis.notableSession=session;globalThis.notableModels=models;globalThis.notableFileApp={session,loadFile,loadDocument:async(text,title,language='',metadata={})=>{if(closed||exportBusy)return;const gen=++generation;setDocumentMetadata(gen,metadata);importBusy=true;session.stop();try{await cancelPdf();return await loadDocument(text,title,language,gen,[],[],[],null,metadata.semanticRanges||[]);}finally{if(gen===generation){importBusy=false;statusKey='';statusLine();}}},loadImage:async(file)=>{if(closed||exportBusy)return;const gen=++generation;setDocumentMetadata(gen,{fileName:file.name,mimeType:file.type});importBusy=true;session.stop();try{await cancelPdf();if(gen===generation)return await importImage(file,gen);}finally{if(gen===generation){importBusy=false;statusKey='';statusLine();}}},startExport,clearExportResult,get busy(){return exportBusy;},get result(){return exportResult;},get settings(){return settings;}};Object.defineProperty(globalThis.notableFileApp,'bridge',{value:bridge,writable:false,configurable:false,enumerable:true});
if(isExtension){const {installFileLibrary}=await import('../../library/file-bridge.mjs');fileLibrary=await installFileLibrary({app:globalThis.notableFileApp,getText:()=>currentText,getTitle:()=>$('#document-title').textContent,onStatus:status});globalThis.notableFileApp.library=fileLibrary;await fileLibrary.loadIncoming();}
if(['https:','http:'].includes(location.protocol)&&isSecureContext&&'serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
