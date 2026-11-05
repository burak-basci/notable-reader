// Browser engine adapter. The renderer is the exact shared Paper/Green factory.
import {mountPlayerSurface} from './player-surface.mjs';
import {createFormatting} from './formatting.mjs';
import {createAppearanceController} from './appearance.mjs';
import {MODELS} from './neural-models.js';
import * as premium from './premium-browser.mjs';
import {ASSET_LIMITS,checkAbort,documentFlow,materializeFigure,decodeRaster,smartInvert,figureFilter,validateFigures} from './document-assets.mjs';
import {transformPdfPixels} from './pdf-appearance.mjs';
const extension=location.protocol==='chrome-extension:';
const hash=value=>{let h=2166136261;for(const c of value){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return(h>>>0).toString(16);};
const language=value=>String(value||'').toLowerCase().replace('_','-');
export class BrowserPlayer extends EventTarget{
 constructor(options){super();Object.assign(this,options);}
 static async create(options){const locales=await fetch(new URL('./ui-locales.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('Sprachkatalog nicht verfügbar');return r.json();});
  // Construct only after locale readiness, without a second UI implementation.
  const self=new BrowserPlayer(options);self.locales=locales;self.version=0;self.job={state:'idle'};self.busy=false;self.lastError='';self.voiceMap=new Map();self.premium={enabled:false,status:'free'};
  self.appearance=createAppearanceController({document,kind:'html',contentRoot:options.content||document.querySelector('#reading-text'),flow:true});
  self.surface=mountPlayerSurface({mount:options.mount||document.querySelector('#player-mount'),variant:'overlay',locales,formattingFactory:createFormatting,appearanceController:self.appearance,exportPolicy:extension?'licensed':'free',onCommand:(command,value)=>void self.command(command,value),onClose:()=>self.setVisible(false),onLocalChange:(field,value)=>{if(field==='barPosition'){self.settings.bar=value;self.save();}},onSelection:()=>false});
  self.surface.shadow.querySelector('.auto-show-row').hidden=true;self.timer=setInterval(()=>{if(self.reader.state==='playing')self.update();},200);self.refreshVoices();if(extension)self.refreshPremium();self.update();return self;
 }
 async refreshPremium(){try{this.premium=await premium.getStatus();}catch{this.premium={enabled:false,status:'unavailable'};}this.update();return this.premium;}
 refreshVoices(){this.voiceMap.clear();const groups=new Map(),system=this.speech.getVoices().filter(v=>!v.voiceURI?.startsWith('notable:')&&(this.settings.online||v.localService===true));
  const add=(code,id,label,note,voice)=>{code=language(code);if(!/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/.test(code))return;let group=groups.get(code);if(!group){group={code,label:code,default:id,voices:[]};groups.set(code,group);}group.voices.push({id,label,note});this.voiceMap.set(id,voice);};
  for(const v of system)add(v.lang,'system:'+hash(v.voiceURI+'|'+v.lang+'|'+v.name),v.name,v.localService?'Lokal auf dem Gerät':'Online · ausdrückliche Freigabe',v);
  for(const model of Object.values(MODELS))add(model.lang,model.voiceURI,model.name,this.models.installed.has(model.id)?'Lokale KI-Stimme':'Einmaliger Modelldownload nach Bestätigung',model);
  this.catalog=[...groups.values()];const entries=[...this.voiceMap],automatic=this.settings.language==='auto',wanted=language(automatic?this.getLanguage():this.settings.language),base=wanted.split('-')[0],matching=entries.filter(([,v])=>language(v.lang).split('-')[0]===base),ready=matching.filter(([,v])=>!v.kind||this.models.installed.has(v.id)),regional=ready.find(([,v])=>language(v.lang)===wanted);
  let selected=entries.find(([id,v])=>id===this.settings.voice||v.voiceURI===this.settings.voice);
  // Auto selections follow a replacement document; explicit voice/language
  // choices remain stable. Prefer an available exact region over a sibling.
  if(selected&&automatic&&(language(selected[1].lang).split('-')[0]!==base||regional&&language(selected[1].lang)!==wanted||selected[1].kind&&!this.models.installed.has(selected[1].id)&&ready.length>0))selected=null;
  if(!selected)selected=regional||ready[0]||matching.find(([,v])=>language(v.lang)===wanted)||matching[0]||entries.find(([,v])=>!v.kind)||entries[0];
  if(selected){this.voiceId=selected[0];this.settings.voice=selected[0];this.reader.configure({voice:selected[1],rate:this.settings.rate,volume:this.settings.muted?0:this.settings.volume});}this.update();
 }
 metrics(){const r=this.reader,chunk=r.chunks[r.index],audio=this.speech.audio;let fraction=chunk?Math.max(0,Math.min(1,(r.offset||0)/Math.max(1,chunk.text.length))):0;if(audio&&Number.isFinite(audio.duration)&&audio.duration>0)fraction=Math.max(0,Math.min(1,audio.currentTime/audio.duration));const char=chunk?chunk.start+fraction*chunk.text.length:0,total=r.text.length/14/Math.max(.8,r.rate),progress=r.state==='ended'?1:r.text.length?char/r.text.length:0;return{elapsedSeconds:total*progress,remainingSeconds:total*(1-progress),totalSeconds:total,progressFraction:progress,remainingEstimated:true};}
 captureOffset(){const audio=this.speech.audio,chunk=this.reader.chunks[this.reader.index];if(audio&&chunk&&audio.duration>0){let n=Math.floor(chunk.text.length*audio.currentTime/audio.duration);while(n>0&&!/\s/.test(chunk.text[n-1]))n--;this.reader.offset=n;}}
 snapshot(){const r=this.reader,v=this.voiceMap.get(this.voiceId),code=language(v?.lang||this.getLanguage()),state=r.state,count=r.chunks.length;
  // Only actual control state crosses the own-view facade. Never expose billing capabilities.
  const {enabled,status,tier,priceLabel}=this.premium||{},prefs=Object.fromEntries(['formatLocale','timeFormat','follow','clickSeek','bar'].filter(k=>k in this.settings).map(k=>[k,this.settings[k]]));
  return {type:'state',...prefs,uiLanguage:this.settings.uiLanguage||'de',playerTheme:this.settings.playerTheme||'system',speed:r.rate,volumeMax:100,volume:Math.round(this.settings.volume*100),muted:this.settings.muted===true,language:this.settings.language||'auto',activeLanguage:code,detectedLanguage:language(this.getLanguage()),voice:this.voiceId,voiceLabel:v?.name||'',catalog:this.catalog||[],preferenceVersion:this.version,playing:state==='playing',paused:state==='paused',sectionCount:count,sectionIndex:r.index,chapters:this.chapters||[],chapterIndex:(this.chapters||[]).reduce((selected,c,index)=>c.charStart<=(r.chunks[r.index]?.start||0)+(r.offset||0)?index:selected,-1),...this.metrics(),premium:{enabled:enabled===true,status,tier,priceLabel,...(extension?{checkoutUrl:'https://reader-premium.benotable.de/account'}:{})},exportState:{...this.job,resultReady:this.job.resultReady===true},exportFormats:['mp3','wav','pdf','html'],controls:{canToggle:!!count&&!this.busy,appearanceFields:Object.keys(this.appearance.defaults).filter(key=>!['focus','hidePageNumbers'].includes(key))},statusKey:this.lastError?'reader_error':state==='playing'?'playing':state==='paused'?'paused':state==='ended'?'completed':'ready',statusKind:this.lastError?'error':'info',status:this.lastError||undefined,appearance:{...this.settings.appearance}};
 }
 update(){if(!this.surface)return;this.surface.update(this.snapshot());
  for(const node of this.surface.shadow.querySelectorAll('.voice-btn,.speed-trigger,.follow,.settings-panel input,.settings-panel .reader-select-trigger'))node.disabled=this.busy;const cancel=this.surface.shadow.querySelector('.export-cancel');cancel.disabled=['saving','done'].includes(this.job.phase);
 }
 setVisible(visible){if(!visible){this.captureOffset();this.reader.pause();}this.surface.setVisibility(visible);this.onVisibility?.(visible);}
 message(text,error=false){this.lastError=error?text:'';this.onMessage(text,error);this.update();}
 setBusy(value){this.busy=value;this.update();}
 setJob(value){const fresh=value.state==='idle'||value.state==='running'&&this.job.state!=='running';this.job=fresh?{phase:value.state==='running'?'preparing':'',...value}:{...this.job,...value};this.update();}
 async requireExport(){if(extension)return premium.requireExport();return{allowed:true,mode:'website'};}
 async authorize(){try{return await this.requireExport();}catch(error){await this.refreshPremium();this.dispatchEvent(new CustomEvent('premium-needed',{detail:{code:error.code||'premium_locked',status:this.premium}}));throw error;}}
 async command(command,value){if(this.busy&&!['cancelExport','stop'].includes(command))return;if(command==='cancelExport'){this.onCancel();return;}
  const r=this.reader,s=this.settings;
  if(command==='downloadResult')return this.onDownloadResult?.();
  if(command==='export'||command==='exportDocument'){this.lastError='';return this.onExport(value,command==='export'?'audio':'document');}
  if(command==='toggle'){if(r.state==='playing'){this.captureOffset();r.pause();}else{const voice=this.voiceMap.get(this.voiceId);if(voice?.kind&&!this.models.installed.has(voice.id)){this.onNeedModel(voice.id,{play:true});return;}r.toggle();}this.update();return;}
  if(command==='stop'){r.stop();this.update();return;}
  if(command==='restart'){let index=0;const nodes=[...document.querySelectorAll('#reading-text .sentence')];const visible=nodes.findIndex(n=>{const b=n.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight-180;});if(visible>=0)index=visible;r.pause();r.seek(index);await this.command('toggle');return;}
  if(['previousSection','nextSection','seekSection','seekChapter','seekProgress'].includes(command)){const index=command==='previousSection'?r.index-1:command==='nextSection'?r.index+1:command==='seekProgress'?Math.floor(Math.max(0,Math.min(1,value))*Math.max(0,r.chunks.length-1)):command==='seekChapter'?this.chapters?.[value]?.sectionIndex:value;const chapter=command==='seekChapter'?this.chapters?.[value]:null;r.seek(index,chapter?Math.max(0,chapter.charStart-(r.chunks[index]?.start||0)):0);this.update();return;}
  if(command==='openFocus'){this.onFocus();this.surface.refreshLayout();return;}
  if(command==='toggleTheme'){const mode=s.appearance?.mode||'off',dark=mode==='dark'||mode==='auto'&&matchMedia('(prefers-color-scheme:dark)').matches;s.appearance={...this.appearance.defaults,...s.appearance,mode:dark?'light':'dark'};}
  else if(command==='appearance')s.appearance={...this.appearance.defaults,...s.appearance,...value};
  else if(command==='speed'){this.captureOffset();s.rate=value;r.configure({rate:value});}
  else if(command==='volume'){this.captureOffset();s.volume=Math.max(0,Math.min(1,value/100));if(value>0)s.muted=false;r.configure({volume:s.muted?0:s.volume});}
  else if(command==='mute'){this.captureOffset();s.muted=value;r.configure({volume:value?0:s.volume});}
  else if(command==='voice'){s.voice=value.id;this.voiceId=value.id;s.language=value.language;this.captureOffset();const voice=this.voiceMap.get(value.id),resume=r.state==='playing';if(voice?.kind&&!this.models.installed.has(voice.id)){r.pause();r.configure({voice});this.onNeedModel(voice.id,{play:resume});}else r.configure({voice:voice||null});}
  else if(command==='language'){s.language=value;s.voice='';this.refreshVoices();}
  else if(command==='follow')s.follow=value;
  else if(command==='clickseek')s.clickSeek=value;
  else if(['uiLanguage','formatLocale','timeFormat','playerTheme','autoShow'].includes(command))s[command]=value;
  else return;
  this.version++;this.save();this.update();
 }
 destroy(){clearInterval(this.timer);this.surface.destroy();this.appearance.destroy();}
}
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function documentStyle(appearance){const node=document.createElement('div');node.style.cssText='position:fixed;left:-20000px;top:0;background:#ffffff;color:#202124;';node.textContent='Local rendering style';document.body.append(node);const controller=createAppearanceController({document,kind:'html',contentRoot:node,flow:true});try{controller.update(appearance);const css=getComputedStyle(node);return{background:css.backgroundColor,text:css.color,fontFamily:css.fontFamily,fontSize:parseFloat(css.fontSize)||18,lineHeight:parseFloat(css.lineHeight)||30.6};}finally{controller.destroy();node.remove();}}
// Each asset is decoded only while drawing; page-backed figures stay lazy.
export async function renderDocumentFigure(input,appearance,{signal}={}){
 const figure=await materializeFigure(input,{signal}),bitmap=await decodeRaster(figure.src,{signal}),canvas=document.createElement('canvas');
 try{canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();checkAbort(signal);
  if(figure.kind==='page'){const pixels=await transformPdfPixels(ctx.getImageData(0,0,canvas.width,canvas.height),appearance,figure.regions,{signal});ctx.putImageData(pixels,0,0);}
  else{const smart=appearance.imageMode==='smart'&&smartInvert(ctx.getImageData(0,0,canvas.width,canvas.height).data,figure.kind),filter=figureFilter(appearance,smart);if(filter!=='none'){ctx.clearRect(0,0,canvas.width,canvas.height);const decoded=await decodeRaster(figure.src,{signal});try{ctx.filter=filter;ctx.drawImage(decoded,0,0);ctx.filter='none';}finally{decoded.close();}}}
  checkAbort(signal);return canvas;
 }catch(error){bitmap.close();canvas.width=canvas.height=0;throw error;}
}
export async function documentHtml(text,title,appearance,{signal,figures=[],warnings=[]}={}){
 checkAbort(signal);const p=documentStyle(appearance),parts=['<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><title>'+escapeHtml(title)+'</title><style>body{margin:36px auto;padding:0 24px;max-width:'+Number(appearance.contentWidth||760)+'px;background:'+p.background+';color:'+p.text+';font:'+Number(appearance.fontSize||18)+'px/'+Number(appearance.lineHeight||1.7)+' '+p.fontFamily+'}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext}h1{font-size:1.4em}figure{margin:1em 0}img{display:block;max-width:100%;height:auto}figcaption{font:12px/1.5 system-ui,sans-serif}</style><main><h1>'+escapeHtml(title)+'</h1>'+(warnings.length?'<aside role=note>'+escapeHtml(warnings.join(' '))+'</aside>':'')];let imageBytes=0;
 for(const entry of documentFlow(text,figures)){checkAbort(signal);if(entry.type==='text'){parts.push('<pre>');for(let start=0;start<entry.text.length;){let end=Math.min(start+65536,entry.text.length);if(end<entry.text.length&&/[\uD800-\uDBFF]/.test(entry.text[end-1]))end--;parts.push(escapeHtml(entry.text.slice(start,end)));start=end;await new Promise(r=>setTimeout(r,0));checkAbort(signal);}parts.push('</pre>');}else{const canvas=await renderDocumentFigure(entry.figure,appearance,{signal});try{const html='<figure><img alt="'+escapeHtml(entry.figure.alt)+'" src="'+canvas.toDataURL('image/png')+'"><figcaption>'+escapeHtml(entry.figure.alt)+'</figcaption></figure>';imageBytes+=html.length;if(imageBytes>192*1024*1024)throw Error('Die eingebetteten HTML-Abbildungen überschreiten 192 MB.');parts.push(html);}finally{canvas.width=canvas.height=0;}}await new Promise(r=>setTimeout(r,0));}
 checkAbort(signal);parts.push('</main></html>');return new Blob(parts,{type:'text/html;charset=utf-8'});
}
// One bounded raster page at a time; browser canvas shapes complete Unicode.
// All output is withheld until the final xref and cancellation check succeed.
export async function documentPdf(text,title,appearance,{signal,onProgress=()=>{},figures=[],warnings=[]}={}){
 checkAbort(signal);validateFigures(figures,text);
 const width=595,height=842,margin=40,scale=({96:96/72,144:2,192:192/72})[appearance.pdfDpi]||2,canvas=document.createElement('canvas');canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);const ctx=canvas.getContext('2d');ctx.scale(scale,scale);const p=documentStyle(appearance),size=p.fontSize,line=p.lineHeight,encoder=new TextEncoder(),parts=[],offsets=[0];let offset=0,pages=0,y=margin,ink=false,wrapped=0;
 const add=value=>{const bytes=typeof value==='string'?encoder.encode(value):value;if(offset+bytes.length>256*1024*1024)throw Error('Die lokale PDF-Datei überschreitet 256 MB. Bitte HTML wählen.');parts.push(bytes);offset+=bytes.length;};
 const object=(id,data)=>{offsets[id]=offset;add(id+' 0 obj\n');add(data);add('\nendobj\n');};
 const clear=()=>{ctx.filter='none';ctx.fillStyle=p.background;ctx.fillRect(0,0,width,height);ctx.fillStyle=p.text;ctx.font=size+'px '+p.fontFamily;ctx.textBaseline='top';y=margin;ink=false;};
 const finish=async()=>{checkAbort(signal);if(++pages>2000)throw Error('Dieses Dokument überschreitet die lokale PDF-Seitengrenze. Bitte HTML wählen.');const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PDF-Seite konnte nicht gerastert werden.')),'image/jpeg',.92));checkAbort(signal);const image=new Uint8Array(await blob.arrayBuffer());checkAbort(signal);const id=3+(pages-1)*3,stream='q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ';object(id,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 '+(id+2)+' 0 R >> >> /Contents '+(id+1)+' 0 R >>');object(id+1,'<< /Length '+encoder.encode(stream).length+' >>\nstream\n'+stream+'\nendstream');offsets[id+2]=offset;add((id+2)+' 0 obj\n<< /Type /XObject /Subtype /Image /Width '+canvas.width+' /Height '+canvas.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+image.length+' >>\nstream\n');add(image);add('\nendstream\nendobj\n');onProgress({percent:Math.min(99,pages),completedChunks:pages,totalChunks:0});await new Promise(r=>setTimeout(r,0));checkAbort(signal);clear();};
 const drawLine=async(value,rtl=false)=>{if(y+line>height-margin&&ink)await finish();ctx.direction=rtl?'rtl':'ltr';ctx.textAlign=rtl?'right':'left';ctx.fillText(value,rtl?width-margin:margin,y);y+=line;ink=true;};
 const wrapText=async value=>{for(const paragraph of value.split('\n')){const first=paragraph.match(/\p{L}/u)?.[0]||'',rtl=/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(first);let current='';for(const word of paragraph.match(/\S+\s*|\s+/gu)||[]){if(current&&(word.length>2048||ctx.measureText(current+word).width>width-2*margin)){await drawLine(current.trimEnd(),rtl);current='';}for(const char of word){if(++wrapped%512===0){await new Promise(r=>setTimeout(r,0));checkAbort(signal);}if(current&&(current.length>=4096||ctx.measureText(current+char).width>width-2*margin)){await drawLine(current,rtl);current='';}current+=char;}}await drawLine(current,rtl);}};
 try{add('%PDF-1.4\n%NotableReader\n');clear();await wrapText(title+'\n'+(warnings.length?warnings.join('\n')+'\n':''));for(const entry of documentFlow(text,figures)){checkAbort(signal);if(entry.type==='text'){await wrapText(entry.text);continue;}const image=await renderDocumentFigure(entry.figure,appearance,{signal});try{const factor=Math.min((width-2*margin)/image.width,(height-2*margin-line)/image.height,1),iw=image.width*factor,ih=image.height*factor;if(y+ih+line>height-margin&&ink)await finish();ctx.drawImage(image,margin,y,iw,ih);y+=ih+8;ink=true;if(entry.figure.alt)await wrapText(entry.figure.alt);}finally{image.width=image.height=0;}}if(ink||!pages)await finish();checkAbort(signal);object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,'<< /Type /Pages /Count '+pages+' /Kids ['+Array.from({length:pages},(_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>');const xref=offset;add('xref\n0 '+offsets.length+'\n0000000000 65535 f \n');for(let i=1;i<offsets.length;i++)add(String(offsets[i]).padStart(10,'0')+' 00000 n \n');add('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');onProgress({percent:100,completedChunks:pages,totalChunks:pages});checkAbort(signal);return{blob:new Blob(parts,{type:'application/pdf'}),pages};}finally{canvas.width=canvas.height=0;}
}
