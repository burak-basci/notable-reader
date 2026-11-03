/* Notable Reader · Copyright (c) 2026 Burak Basci · MIT */
import {unzipSync,strFromU8} from './vendor/fflate.mjs';
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
 if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||entries!==view.getUint16(end+8,true)||entries===65535||entries>4096||offset+size>end)fail('Mehrteilige, ZIP64- oder übergroße Archive werden nicht geöffnet.');
 let cursor=offset,total=0;const names=new Set();
 for(let i=0;i<entries;i++){
  if(cursor+46>end||view.getUint32(cursor,true)!==0x02014b50)fail('Die Archivstruktur ist beschädigt.');
  const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),compressed=view.getUint32(cursor+20,true),original=view.getUint32(cursor+24,true),length=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),local=view.getUint32(cursor+42,true);
  if(cursor+46+length+extra+comment>offset+size)fail('Die Archivstruktur ist beschädigt.');
  const name=strFromU8(bytes.subarray(cursor+46,cursor+46+length));
  if(flags&1)fail('Verschlüsselte EPUB-/Office-Archive werden nicht unterstützt.');
  if(![0,8].includes(method)||original===0xffffffff||compressed===0xffffffff||local===0xffffffff)fail('Dieses Kompressionsformat wird nicht unterstützt.');
  if(name.includes('\\')||name.startsWith('/')||name.split('/').includes('..')||name.includes('\0')||names.has(name))fail('Das Archiv enthält unsichere oder doppelte Dateipfade.');
  if(original>MAX_ENTRY||(original>1024*1024&&original/Math.max(compressed,1)>1000))fail('Das Archiv wurde zum Schutz vor übermäßiger Entpackung abgewiesen.');
  total+=original;if(total>MAX_BYTES)fail('Der entpackte Inhalt überschreitet die sichere Grenze von 128 MB.');
  if(local+30>offset||view.getUint32(local,true)!==0x04034b50)fail('Das Archiv enthält einen ungültigen Dateieintrag.');
  const localName=view.getUint16(local+26,true),localExtra=view.getUint16(local+28,true),dataStart=local+30+localName+localExtra;
  if(dataStart+compressed>offset||view.getUint16(local+8,true)!==method||strFromU8(bytes.subarray(local+30,local+30+localName))!==name)fail('Die Dateiheader des Archivs stimmen nicht überein.');
  if(!(flags&8)&&(view.getUint32(local+18,true)!==compressed||view.getUint32(local+22,true)!==original))fail('Die Größenangaben des Archivs stimmen nicht überein.');
  names.add(name);cursor+=46+length+extra+comment;
 }
 if(cursor!==offset+size)fail('Die Archivgröße stimmt nicht mit dem Verzeichnis überein.');
 return {names,total};
}
function xml(text){const document=new DOMParser().parseFromString(text,'application/xml');if(document.querySelector('parsererror'))fail('Die Dokumentstruktur ist beschädigt.');return document;}
const all=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
function archiveFiles(bytes,filter){inspectZip(bytes);try{return unzipSync(bytes,{filter:file=>filter(file.name)});}catch{fail('Das Dokumentarchiv konnte nicht entpackt werden.');}}
export function htmlText(html){
 const template=document.createElement('template');template.innerHTML=html;
 template.content.querySelectorAll('script,style,noscript,iframe,object,embed,svg,math,canvas,audio,video,img,link,meta,form,nav,header,footer,aside,[hidden],[aria-hidden="true"]').forEach(node=>node.remove());
 template.content.querySelectorAll('br,p,div,section,article,h1,h2,h3,h4,h5,h6,li,tr,blockquote,pre').forEach(node=>{node.prepend(document.createTextNode('\n'));node.append(document.createTextNode('\n'));});
 return template.content.textContent.replace(/[\t ]+\n/g,'\n').replace(/\n[\t ]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
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
  chapterNames.push(name);
 }
 const files=archiveFiles(bytes,name=>chapterNames.includes(name));
 const chapters=chapterNames.map(name=>htmlText(strFromU8(files[name])));
 const text=chapters.filter(Boolean).join('\n\n');if(!text)fail('Das EPUB enthält keinen lesbaren Dokumenttext.');
 return {text,title:all(opf,'title')[0]?.textContent?.trim()||'',language:all(opf,'language')[0]?.textContent?.trim()||''};
}
export function docxText(bytes){
 const files=archiveFiles(bytes,name=>['word/document.xml','[Content_Types].xml'].includes(name));
 if(!files['word/document.xml']||!files['[Content_Types].xml'])fail('Dies ist keine unterstützte DOCX-Datei. Alte DOC-Dateien bitte zuerst als DOCX exportieren.');
 const doc=xml(strFromU8(files['word/document.xml'])),paragraphs=[];
 for(const paragraph of all(doc,'p')){
  const pieces=[];
  function visit(node){if(node.nodeType!==1)return;const name=node.localName;if(name==='t'){pieces.push(node.textContent);return;}if(name==='tab'){pieces.push('\t');return;}if(name==='br'||name==='cr'){pieces.push('\n');return;}if(['del','instrText','object','drawing','pict'].includes(name))return;for(const child of node.children)visit(child);}
  visit(paragraph);paragraphs.push(pieces.join(''));
 }
 const text=paragraphs.join('\n\n').trim();if(!text)fail('Die DOCX-Datei enthält keinen lesbaren Dokumenttext.');return {text,title:'',language:''};
}
export async function importTextFile(file){
 const extension=file.name.toLowerCase().split('.').pop();
 if(['epub','docx'].includes(extension)&&file.size>MAX_BYTES)fail('Diese Datei ist zu groß für den sicheren Archivimport (128 MB).');
 if(extension==='epub')return epubText(new Uint8Array(await file.arrayBuffer()));
 if(extension==='docx')return docxText(new Uint8Array(await file.arrayBuffer()));
 if(['html','htm'].includes(extension))return {text:htmlText(await file.text())};
 if(['txt','md','markdown'].includes(extension))return {text:await file.text()};
 if(extension==='doc')fail('Alte DOC-Dateien bitte in Word oder LibreOffice als DOCX exportieren.');
 fail('Bitte PDF, EPUB ohne DRM, DOCX, TXT, Markdown oder HTML wählen.');
}
