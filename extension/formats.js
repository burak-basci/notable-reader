/* Notable Reader · Copyright (c) 2026 Burak Basci · MIT */
import {Inflate,strFromU8} from './vendor/fflate.mjs';
import {normalizeAnchored,dataRaster,rasterInfo,bytesData,ASSET_LIMITS} from './document-assets.mjs';
const MAX_BYTES=128*1024*1024, MAX_ENTRY=32*1024*1024;
const fail=message=>{throw new Error(message);};
// Inspect the central directory before allocating inflated buffers. ZIP64,
// encrypted ZIPs, traversal names, absurd ratios and inconsistent headers fail
// closed; none of these formats needs executing code or opening remote links.
export function inspectZip(bytes){
 if(bytes.byteLength>MAX_BYTES)fail('Diese Datei ist zu groß für den sicheren Archivimport (128 MB).');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let n=bytes.length-22;n>=Math.max(0,bytes.length-65557);n--)if(view.getUint32(n,true)===0x06054b50&&n+22+view.getUint16(n+20,true)===bytes.length){end=n;break;}
 if(end<0)fail('Das Archiv ist beschädigt oder verwendet ein nicht unterstütztes ZIP-Format.');
 const entries=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
 if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||entries!==view.getUint16(end+8,true)||entries===65535||entries>4096||offset+size!==end||(end>=20&&view.getUint32(end-20,true)===0x07064b50))fail('Mehrteilige, ZIP64- oder übergroße Archive werden nicht geöffnet.');
 let cursor=offset,total=0;const names=new Set(),records=new Map();
 for(let i=0;i<entries;i++){
  if(cursor+46>end||view.getUint32(cursor,true)!==0x02014b50)fail('Die Archivstruktur ist beschädigt.');
  const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),compressed=view.getUint32(cursor+20,true),original=view.getUint32(cursor+24,true),length=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),local=view.getUint32(cursor+42,true);
  if(cursor+46+length+extra+comment>offset+size)fail('Die Archivstruktur ist beschädigt.');
  const name=strFromU8(bytes.subarray(cursor+46,cursor+46+length),!(flags&2048));
  if(flags&1)fail('Verschlüsselte EPUB-/Office-Archive werden nicht unterstützt.');
  if(method===0&&compressed!==original)fail('Die Größenangaben des Archivs stimmen nicht überein.');
  if(![0,8].includes(method)||original===0xffffffff||compressed===0xffffffff||local===0xffffffff)fail('Dieses Kompressionsformat wird nicht unterstützt.');
  if(name.includes('\\')||name.startsWith('/')||name.split('/').includes('..')||name.includes('\0')||names.has(name))fail('Das Archiv enthält unsichere oder doppelte Dateipfade.');
  if(original>MAX_ENTRY||(original>1024*1024&&original/Math.max(compressed,1)>1000))fail('Das Archiv wurde zum Schutz vor übermäßiger Entpackung abgewiesen.');
  total+=original;if(total>MAX_BYTES)fail('Der entpackte Inhalt überschreitet die sichere Grenze von 128 MB.');
  if(local+30>offset||view.getUint32(local,true)!==0x04034b50)fail('Das Archiv enthält einen ungültigen Dateieintrag.');
  const localName=view.getUint16(local+26,true),localExtra=view.getUint16(local+28,true),dataStart=local+30+localName+localExtra;
  if(dataStart+compressed>offset||view.getUint16(local+8,true)!==method||view.getUint16(local+6,true)!==flags||strFromU8(bytes.subarray(local+30,local+30+localName),!(flags&2048))!==name)fail('Die Dateiheader des Archivs stimmen nicht überein.');
  if(!(flags&8)&&(view.getUint32(local+18,true)!==compressed||view.getUint32(local+22,true)!==original))fail('Die Größenangaben des Archivs stimmen nicht überein.');
  names.add(name);records.set(name,{compressed,original,method,dataStart,crc:view.getUint32(cursor+16,true)});cursor+=46+length+extra+comment;
 }
 if(cursor!==offset+size)fail('Die Archivgröße stimmt nicht mit dem Verzeichnis überein.');
 return {names,total,records,end};
}
function xml(text){const document=new DOMParser().parseFromString(text,'application/xml');if(document.querySelector('parsererror'))fail('Die Dokumentstruktur ist beschädigt.');return document;}
const all=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=data=>{let c=0xffffffff;for(const value of data)c=crcTable[(c^value)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
export function archiveFiles(bytes,filter){const checked=inspectZip(bytes),files=Object.create(null);try{for(const [name,record]of checked.records){if(!filter(name))continue;const {compressed,original,method,dataStart}=record;let data;if(method===0)data=bytes.slice(dataStart,dataStart+compressed);else{data=new Uint8Array(original);let written=0;const inflater=new Inflate((chunk)=>{if(written+chunk.length>original)fail('Der entpackte Inhalt überschreitet die geprüfte Archivgröße.');data.set(chunk,written);written+=chunk.length;});for(let n=0;n<compressed;n+=1024)inflater.push(bytes.subarray(dataStart+n,dataStart+Math.min(compressed,n+1024)),n+1024>=compressed);if(!compressed)inflater.push(new Uint8Array(),true);if(written!==original)fail('Die entpackte Dateigröße stimmt nicht überein.');}if(data.length!==original||crc32(data)!==record.crc)fail('Die Prüfsumme oder Dateigröße im Archiv stimmt nicht überein.');files[name]=data;}return files;}catch{fail('Das Dokumentarchiv konnte nicht sicher und vollständig entpackt werden.');}}

// Chapter offsets refer to normalized visible text, never to archive byte offsets.
const normalizeChapterText=value=>String(value||'').replace(/\r\n?/g,'\n').replace(/\u00ad/g,'').replace(/[\t \u00a0]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
function headingChapters(html,text){const template=document.createElement('template');template.innerHTML=html;template.content.querySelectorAll('script,style,nav,header,footer,aside,[hidden],[aria-hidden=true]').forEach(n=>n.remove());let cursor=0;return[...template.content.querySelectorAll('h1,h2,h3,h4,h5,h6')].flatMap(node=>{const label=normalizeChapterText(node.textContent);if(!label)return[];const charStart=text.indexOf(label,cursor);if(charStart<0)return[];cursor=charStart+label.length;return[{label:label.slice(0,160),level:Number(node.localName.slice(1)),charStart}];});}
// Never attach source nodes. A template is inert, and only our own text/raster
// records leave it. In particular CSS URLs, SVG, srcset and handlers never do.
export function htmlDocument(html,resolveImage,budget={count:0,bytes:0,pixels:0}){
 if(typeof html!=='string'||html.length>ASSET_LIMITS.text)fail('Der HTML-Text überschreitet die sichere Grenze von 128 MB.');
 const template=document.createElement('template');template.innerHTML=html;
 template.content.querySelectorAll('script,style,noscript,iframe,object,embed,svg,math,canvas,audio,video,link,meta,form,nav,header,footer,aside,[hidden],[aria-hidden="true"]').forEach(node=>node.remove());
 template.content.querySelectorAll('br,p,div,section,article,h1,h2,h3,h4,h5,h6,li,tr,blockquote,pre').forEach(node=>{node.prepend(document.createTextNode('\n'));node.append(document.createTextNode('\n'));});
 const chunks=[],anchors=[];let length=0,unavailable=0;
 const walk=node=>{if(node.nodeType===3){chunks.push(node.data);length+=node.data.length;return;}if(node.nodeType===1&&node.localName==='img'){const src=node.getAttribute('src')||'';let raster=src.startsWith('data:')?dataRaster(src):resolveImage?.(src);if(raster){budget.count++;budget.bytes+=raster.bytes.length;budget.pixels+=raster.width*raster.height;if(budget.count>ASSET_LIMITS.count||budget.bytes>ASSET_LIMITS.bytes||budget.pixels>ASSET_LIMITS.totalPixels)fail('Die Abbildungen überschreiten die sichere Gesamtgrenze (512 Bilder / 64 MB / 100 Megapixel).');anchors.push({charStart:length,src:bytesData(raster.bytes,raster.type),alt:node.getAttribute('alt')||'Abbildung'});if(anchors.length>ASSET_LIMITS.count)fail('Das Dokument enthält zu viele Abbildungen.');}else unavailable++;return;}for(const child of node.childNodes)walk(child);};walk(template.content);
 const raw=chunks.join(''),anchored=normalizeAnchored(raw,anchors),text=raw.replace(/[\t ]+\n/g,'\n').replace(/\n[\t ]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();return{text,figures:anchored.figures,warnings:unavailable?[unavailable+' externe oder nicht unterstützte Abbildungen wurden nicht geladen.']:[]};
}
export function htmlText(html){return htmlDocument(html).text;}

function resolveArchivePath(base,href){
 let value;try{value=decodeURIComponent(href.split('#')[0]);}catch{fail('Das EPUB enthält einen ungültigen Dateipfad.');}
 if(/^[a-z][a-z0-9+.-]*:/i.test(value)||value.startsWith('/')||value.includes('\\'))fail('Externe EPUB-Kapitel werden nicht geladen.');
 const parts=base.split('/');parts.pop();
 for(const part of value.split('/')){if(part==='..'){if(!parts.length)fail('Das EPUB verweist außerhalb des Buchs.');parts.pop();}else if(part&&part!=='.')parts.push(part);}
 return parts.join('/');
}
export function epubText(bytes){
 const {names}=inspectZip(bytes);
 const metadata=archiveFiles(bytes,name=>['META-INF/container.xml','META-INF/encryption.xml'].includes(name));
 if(names.has('META-INF/rights.xml'))fail('Dieses EPUB ist geschützt. Bitte eine DRM-freie Ausgabe verwenden.');
 if(metadata['META-INF/encryption.xml']){
  const encrypted=xml(strFromU8(metadata['META-INF/encryption.xml']));
  for(const method of all(encrypted,'EncryptionMethod'))if(!['http://www.idpf.org/2008/embedding','http://ns.adobe.com/pdf/enc#RC'].includes(method.getAttribute('Algorithm')))fail('Dieses EPUB enthält verschlüsselte Inhalte. Bitte eine DRM-freie Ausgabe verwenden.');
 }
 if(!metadata['META-INF/container.xml'])fail('Die EPUB-Buchstruktur fehlt.');
 const container=xml(strFromU8(metadata['META-INF/container.xml'])),opfName=all(container,'rootfile')[0]?.getAttribute('full-path');
 if(!opfName||!names.has(opfName))fail('Das EPUB-Inhaltsverzeichnis fehlt.');
 const packageFiles=archiveFiles(bytes,name=>name===opfName);
 const opf=xml(strFromU8(packageFiles[opfName])),manifest=new Map(all(opf,'item').map(item=>[item.getAttribute('id'),item]));
 const chapterNames=[];
 for(const ref of all(opf,'itemref')){
  if(ref.getAttribute('linear')==='no')continue;
  const item=manifest.get(ref.getAttribute('idref'));if(!item)fail('Ein EPUB-Kapitel fehlt im Inhaltsverzeichnis.');
  const type=item.getAttribute('media-type');if(!['application/xhtml+xml','text/html'].includes(type))continue;
  const name=resolveArchivePath(opfName,item.getAttribute('href')||'');if(!names.has(name))fail('Eine EPUB-Kapiteldatei fehlt.');
  chapterNames.push(name);if(chapterNames.length>4096)fail('Das EPUB enthält zu viele Kapitelverweise.');
 }
 const imageNames=new Set();for(const item of manifest.values())if(['image/png','image/jpeg','image/webp'].includes(item.getAttribute('media-type'))){const name=resolveArchivePath(opfName,item.getAttribute('href')||'');if(names.has(name))imageNames.add(name);}
 const files=archiveFiles(bytes,name=>chapterNames.includes(name)||imageNames.has(name));
 let chapterBytes=0;for(const name of chapterNames){chapterBytes+=files[name].length;if(chapterBytes>MAX_BYTES)fail('Die EPUB-Kapitel überschreiten die sichere Textgrenze von 128 MB.');}
 const budget={count:0,bytes:0,pixels:0};
 const documents=chapterNames.map(name=>htmlDocument(strFromU8(files[name]),src=>{let target;try{target=resolveArchivePath(name,src);}catch{return null;}if(!imageNames.has(target)||!files[target])return null;const data=files[target],info=rasterInfo(data);return{bytes:data,...info};},budget));
 const chapters=documents.map(doc=>doc.text);
 const text=chapters.filter(Boolean).join('\n\n'),normalizedBook=normalizeChapterText(text);if(!text)fail('Das EPUB enthält keinen lesbaren Dokumenttext.');
 const figures=[],warnings=documents.flatMap(doc=>doc.warnings);let figureCursor=0;for(let n=0;n<chapters.length;n++){const content=normalizeChapterText(chapters[n]),start=content?normalizedBook.indexOf(content,figureCursor):figureCursor;for(const figure of documents[n].figures)figures.push({...figure,charStart:Math.min(normalizedBook.length,Math.max(0,start)+figure.charStart)});if(content)figureCursor=start+content.length;}
 const navigation=[];let cursor=0;for(let n=0;n<chapters.length;n++){const content=normalizeChapterText(chapters[n]);if(!content)continue;const start=normalizedBook.indexOf(content,cursor);if(start<0)continue;const headings=headingChapters(strFromU8(files[chapterNames[n]]),content);if(headings.length)for(const heading of headings)navigation.push({...heading,charStart:start+heading.charStart});else navigation.push({label:chapterNames[n].split('/').at(-1).replace(/\.[^.]+$/,''),level:1,charStart:start});cursor=start+content.length;}return {text,title:all(opf,'title')[0]?.textContent?.trim()||'',language:all(opf,'language')[0]?.textContent?.trim()||'',chapters:navigation,figures,warnings};
}
export function docxText(bytes){
 const files=archiveFiles(bytes,name=>['word/document.xml','[Content_Types].xml'].includes(name));
 if(!files['word/document.xml']||!files['[Content_Types].xml'])fail('Dies ist keine unterstützte DOCX-Datei. Alte DOC-Dateien bitte zuerst als DOCX exportieren.');
 const doc=xml(strFromU8(files['word/document.xml'])),paragraphs=[],headings=[];
 for(const paragraph of all(doc,'p')){
  const pieces=[];
  function visit(node){if(node.nodeType!==1)return;const name=node.localName;if(name==='t'){pieces.push(node.textContent);return;}if(name==='tab'){pieces.push('\t');return;}if(name==='br'||name==='cr'){pieces.push('\n');return;}if(['del','instrText','object','drawing','pict'].includes(name))return;for(const child of node.children)visit(child);}
  visit(paragraph);const value=pieces.join(''),style=all(paragraph,'pStyle')[0]?.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','val')||all(paragraph,'pStyle')[0]?.getAttribute('w:val')||'',level=style.match(/^(?:Heading|Überschrift)\s*([1-6])$/i)?.[1];if(level&&value.trim())headings.push({label:normalizeChapterText(value).slice(0,160),level:Number(level),paragraph:paragraphs.length});paragraphs.push(value);
 }
 const text=paragraphs.join('\n\n').trim();if(!text)fail('Die DOCX-Datei enthält keinen lesbaren Dokumenttext.');const normalized=normalizeChapterText(text),chapters=[];let cursor=0;for(const heading of headings){const charStart=normalized.indexOf(heading.label,cursor);if(charStart>=0){chapters.push({label:heading.label,level:heading.level,charStart});cursor=charStart+heading.label.length;}}return {text,title:'',language:'',chapters};
}
export async function importTextFile(file){
 const extension=file.name.toLowerCase().split('.').pop();
 if(['epub','docx'].includes(extension)&&file.size>MAX_BYTES)fail('Diese Datei ist zu groß für den sicheren Archivimport (128 MB).');
 if(extension==='epub')return epubText(new Uint8Array(await file.arrayBuffer()));
 if(extension==='docx')return docxText(new Uint8Array(await file.arrayBuffer()));
 if(['html','htm'].includes(extension)){if(file.size>ASSET_LIMITS.text)fail('Der HTML-Text überschreitet die sichere Grenze von 128 MB.');const html=await file.text(),result=htmlDocument(html);return {...result,chapters:headingChapters(html,normalizeChapterText(result.text))};}
 if(['txt','md','markdown'].includes(extension)){const text=await file.text(),normalized=normalizeChapterText(text),chapters=[];if(extension!=='txt')for(const match of normalized.matchAll(/^(#{1,6})[ \t]+(.+)$/gmu))chapters.push({label:match[2].trim().slice(0,160),level:match[1].length,charStart:match.index});return {text,chapters};}
 if(extension==='doc')fail('Alte DOC-Dateien bitte in Word oder LibreOffice als DOCX exportieren.');
 fail('Bitte PDF, EPUB ohne DRM, DOCX, TXT, Markdown oder HTML wählen.');
}
