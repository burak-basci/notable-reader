"""Local, inert reading documents. Original source stays bound to speech."""
from __future__ import annotations
import base64,contextlib,hashlib,html,json,math,re,struct,subprocess,threading,time,uuid,unicodedata
from pathlib import Path
from urllib.parse import urlsplit,unquote,urldefrag

ROOT=Path(__file__).resolve().parent
CDP_ENDPOINT='http://127.0.0.1:9333/json/list'
TEXT_LIMIT=32*1024*1024
IMAGE_LIMIT=192*1024*1024
PIXEL_LIMIT=16_000_000
DEFAULT_APPEARANCE={'mode':'off','brightness':100,'contrast':100,'sepia':0,'grayscale':0,
 'background':'#181a1b','text':'#e8e6e3','link':'#8ab4f8','lightBackground':'#ffffff','lightText':'#202124','lightLink':'#0969da','imageMode':'preserve','imageBrightness':100,
 'fontFamily':'serif','fontSize':18,'lineHeight':1.7,'contentWidth':760,'focus':False,'hidePageNumbers':True,'pdfDpi':144}
ENUMS={'mode':('off','dark','light','auto'),'imageMode':('preserve','dim','invert','smart'),'fontFamily':('serif','sans','system','mono')}
RANGES={'brightness':(50,150),'contrast':(50,150),'sepia':(0,100),'grayscale':(0,100),'imageBrightness':(25,150),'fontSize':(12,32),'lineHeight':(1.2,2.4),'contentWidth':(480,1200)}
class ViewError(Exception):
 def __init__(self,key='document_prepare_failed'):self.key=key;super().__init__(key)
class ViewCancelled(Exception):pass

def appearance_value(values,current=None):
 if type(values)is not dict or not set(values)<=set(DEFAULT_APPEARANCE):raise ValueError('Ungültige Darstellung')
 result={**DEFAULT_APPEARANCE,**(current or {})}
 for key,value in values.items():
  if key in ENUMS:
   if type(value)is not str or value not in ENUMS[key]:raise ValueError('Ungültige Darstellung')
  elif key in RANGES:
   low,high=RANGES[key]
   if type(value)not in(int,float)or not math.isfinite(value)or not low<=value<=high:raise ValueError('Ungültige Darstellung')
  elif key in ('background','text','link','lightBackground','lightText','lightLink'):
   if type(value)is not str or not re.fullmatch(r'#[0-9a-fA-F]{6}',value):raise ValueError('Ungültige Farbe')
   value=value.lower()
  elif key=='pdfDpi':
   if type(value)is not int or value not in(96,144,192):raise ValueError('Ungültige PDF-Auflösung')
  elif type(value)is not bool:raise ValueError('Ungültige Darstellung')
  result[key]=value
 return result

def check_cancel(cancelled):
 if cancelled is not None and cancelled.is_set():raise ViewCancelled()

def validate_endpoint(endpoint):
 value=urlsplit(endpoint)
 if value.scheme!='http'or value.hostname!='127.0.0.1'or not value.port or value.username or value.password or value.path!='/json/list'or value.query or value.fragment:raise ValueError('Ungültiger lokaler Browserendpunkt')
 return endpoint

def pdf_path(document):
 context=document.get('context')or {};url=context.get('url','');parsed=urlsplit(url)
 if context.get('kind')!='pdf':raise ViewError('document_unavailable')
 if parsed.scheme=='file'and parsed.netloc in('','localhost'):path=Path(unquote(parsed.path))
 elif parsed.scheme in('http','https'):
  path=Path.home()/'.cache/brave-reader'/(hashlib.sha256(urldefrag(url)[0].encode()).hexdigest()+'.pdf')
 else:raise ViewError('document_unavailable')
 try:
  if not path.is_file():raise ViewError('document_unavailable')
  with path.open('rb')as source:
   if source.read(5)!=b'%PDF-':raise ViewError('document_unavailable')
 except OSError:raise ViewError('document_unavailable')from None
 return path

def image_dimensions(data):
 # Inspect dimensions before allocating a decoder bitmap. SVG remains a safe
 # browser screenshot; only recognized raster containers reach MuPDF.
 try:
  if len(data)>32*1024*1024:raise ViewError('document_too_large')
  if data.startswith(b'\x89PNG\r\n\x1a\n')and len(data)>=24:width,height=struct.unpack('>II',data[16:24])
  elif data[:6]in(b'GIF87a',b'GIF89a')and len(data)>=10:width,height=struct.unpack('<HH',data[6:10])
  elif data.startswith(b'BM')and len(data)>=26:width,height=struct.unpack('<ii',data[18:26]);height=abs(height)
  elif data.startswith(b'RIFF')and data[8:12]==b'WEBP':
   kind=data[12:16]
   if kind==b'VP8X':width=1+int.from_bytes(data[24:27],'little');height=1+int.from_bytes(data[27:30],'little')
   elif kind==b'VP8L'and data[20]==0x2f:
    bits=int.from_bytes(data[21:25],'little');width=(bits&0x3fff)+1;height=((bits>>14)&0x3fff)+1
   elif kind==b'VP8 'and data[23:26]==b'\x9d\x01\x2a':width,height=(number&0x3fff for number in struct.unpack('<HH',data[26:30]))
   else:raise ValueError()
  elif data.startswith(b'\xff\xd8'):
   offset=2;width=height=0
   while offset<len(data):
    if data[offset]!=255:raise ValueError()
    while data[offset]==255:offset+=1
    marker=data[offset];offset+=1
    if marker in(0xd8,0xd9,0x01)or 0xd0<=marker<=0xd7:continue
    length=int.from_bytes(data[offset:offset+2],'big')
    if length<2 or offset+length>len(data):raise ValueError()
    if marker in(0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf):height,width=struct.unpack('>HH',data[offset+3:offset+7]);break
    offset+=length
  else:raise ValueError()
  if width<=0 or height<=0:raise ValueError()
  if width*height>PIXEL_LIMIT:raise ViewError('document_too_large')
  return width,height
 except ViewError:raise
 except Exception:raise ViewError('document_images_unavailable')from None

def image_uri(data):
 import pymupdf
 image_dimensions(data)
 try:
  pix=pymupdf.Pixmap(data)
  if pix.width*pix.height>PIXEL_LIMIT:raise ViewError('document_too_large')
  if pix.colorspace is None or pix.colorspace.n not in(1,3):pix=pymupdf.Pixmap(pymupdf.csRGB,pix)
  if max(pix.width,pix.height)>2048:
   factor=2048/max(pix.width,pix.height);pix=pymupdf.Pixmap(pix,max(1,round(pix.width*factor)),max(1,round(pix.height*factor)),None)
  return 'data:image/png;base64,'+base64.b64encode(pix.tobytes('png')).decode()
 except ViewError:raise
 except Exception:raise ViewError('document_images_unavailable')from None

def figure_regions(page):
 from extraction import graphic_regions
 regions=[{'bbox':box,'kind':'diagram'}for box in graphic_regions(page)]
 for image in page.get_image_info():
  box=list(image['bbox']);rect=page.rect
  box=[max(0,box[0]),max(0,box[1]),min(rect.width,box[2]),min(rect.height,box[3])]
  if box[2]-box[0]<12 or box[3]-box[1]<12:continue
  matching=next((item for item in regions if pymupdf_rect_intersects(item['bbox'],box)),None)
  if matching:matching['kind']='image'
  else:regions.append({'bbox':box,'kind':'image'})
 return sorted(regions,key=lambda item:(item['bbox'][1],item['bbox'][0]))

def pymupdf_rect_intersects(a,b):
 return min(a[2],b[2])>max(a[0],b[0])and min(a[3],b[3])>max(a[1],b[1])

def region_png(page,box,dpi=144):
 import pymupdf
 scale=min(dpi/72,2048/max(1,box[2]-box[0],box[3]-box[1]))
 return page.get_pixmap(matrix=pymupdf.Matrix(scale,scale),clip=pymupdf.Rect(box),alpha=False).tobytes('png')

def pdf_metadata(document,pages,cancelled=None,*,dpi=144,rasters=False):
 import pymupdf,numpy as np
 figures=[];metadata=[];images=[];links=[]
 with pymupdf.open(pdf_path(document))as source:
  for number in dict.fromkeys(pages):
   check_cancel(cancelled)
   if type(number)is not int or not 1<=number<=len(source):continue
   page=source[number-1];size={'page':number,'pageWidth':page.rect.width,'pageHeight':page.rect.height}
   figures.extend({**size,**item}for item in figure_regions(page))
   links.extend({**size,'bbox':list(link['from'])}for link in page.get_links()if link.get('from')and not link['from'].is_empty)
   small=page.get_pixmap(matrix=pymupdf.Matrix(.1,.1),colorspace=pymupdf.csRGB,alpha=False);pixels=np.frombuffer(small.samples,dtype=np.uint8).reshape(small.height,small.width,3)
   corners=np.concatenate([pixels[:3,:3].reshape(-1,3),pixels[:3,-3:].reshape(-1,3),pixels[-3:,:3].reshape(-1,3),pixels[-3:,-3:].reshape(-1,3)])
   color=np.median(corners,axis=0).astype(int);metadata.append({**size,'background':'#'+''.join(f'{component:02x}'for component in color)})
   if rasters and len(images)<2:
    page_budget=max(1,PIXEL_LIMIT//max(1,min(2,len(pages))));actual=min(max(72,float(dpi)),384,72*math.sqrt(page_budget/max(1,page.rect.width*page.rect.height)))
    for attempt in range(8):
     check_cancel(cancelled);pix=page.get_pixmap(matrix=pymupdf.Matrix(actual/72,actual/72),colorspace=pymupdf.csRGB,alpha=False);data=pix.tobytes('png')
     pixels=pix.width*pix.height
     if pixels<=page_budget and len(data)<=12*1024*1024:break
     actual*=math.sqrt(page_budget/pixels)*.995 if pixels>page_budget else .75
    else:raise ViewError('document_too_large')
    images.append({**size,'pixelWidth':pix.width,'pixelHeight':pix.height,'dpi':round(actual,3),'src':'data:image/png;base64,'+base64.b64encode(data).decode()})
 return {'appearanceFigures':figures,'appearancePages':metadata,'appearanceRasters':images,'appearanceLinks':links}

def _validate_document(document):
 if type(document)is not dict or type(document.get('sections'))is not list:raise ViewError()
 text_size=0;image_size=0
 for index,section in enumerate(document['sections']):
  if type(section)is not dict or type(section.get('text'))is not str:raise ViewError()
  section['index']=index;text_size+=len(section['text'].encode('utf-8'))
  if type(section.get('images'))is not list:section['images']=[]
  for image in section['images']:
   src=image.get('src')if isinstance(image,dict)else None
   if not isinstance(src,str)or not re.fullmatch(r'data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}',src):raise ViewError('document_images_unavailable')
   try:image_dimensions(base64.b64decode(src.split(',',1)[1],validate=True))
   except ViewError:raise
   except Exception:raise ViewError('document_images_unavailable')from None
   image_size+=len(src)
  if text_size>TEXT_LIMIT or image_size>IMAGE_LIMIT:raise ViewError('document_too_large')
 document['complete']=True
 return document

def _normal_text(text):return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',text).replace('\u00ad','')).strip()

def assign_sources(payload,source):
 chunks=source.get('navigationChunks')or[];groups={};word_pages={}
 for index,chunk in enumerate(chunks):
  text=_normal_text(chunk.get('text',''));groups.setdefault(chunk.get('page'),[]).append((index,text))
  for word in chunk.get('words',[]):
   box=word.get('bbox')
   if isinstance(box,(list,tuple))and len(box)==4 and word.get('geometryValid')is not False:word_pages.setdefault(word.get('page'),[]).append((index,(box[0]+box[2])/2,(box[1]+box[3])/2))
 global_group=[(index,_normal_text(chunk.get('text','')))for index,chunk in enumerate(chunks)]
 cursors={}
 for section in payload['sections']:
  section['sourceSections']=[];box=section.pop('_bbox',None);source_page=section.pop('_sourceBlock',None)
  if not section.get('text'):continue
  if payload['sourceKind']=='pdf'and box:
   found=sorted({index for index,x,y in word_pages.get(section.get('page'),[])if box[0]-1<=x<=box[2]+1 and box[1]-1<=y<=box[3]+1})
  else:
   key=source_page+1 if source_page is not None else None;entries=groups.get(key,[])if key is not None else global_group
   corpus=' '.join(text for _,text in entries);needle=_normal_text(section['text']);at=corpus.find(needle,cursors.get(key,0));found=[]
   if at>=0:
    end=at+len(needle);position=0
    for index,text in entries:
     if position<end and position+len(text)>at:found.append(index)
     position+=len(text)+1
    cursors[key]=end
  section['sourceSections']=found
  if found:section['sourceSection']=found[0]
 return payload

def pdf_document(document,cancelled=None):
 import pymupdf
 from extraction import pdf_lines,join_lines,build_hyphen_corpus
 sections=[];scanned=0;text_bytes=image_bytes=0
 with pymupdf.open(pdf_path(document))as source:
  class CheckedPages:
   def __len__(self):return len(source)
   def __iter__(self):
    for page in source:check_cancel(cancelled);yield page
   def __getitem__(self,index):check_cancel(cancelled);return source[index]
  lines_by_page=pdf_lines(CheckedPages())
  # Running-margin detection normalizes digits. Distinct, large chapter titles
  # must not disappear merely because "Chapter1/2/3" shares that normalized key.
  from extraction import line_words
  raw_pages=[];text_pages={}
  for index,page in enumerate(source):
   check_cancel(cancelled);raw=[]
   for block_index,block in enumerate(page.get_text('rawdict',sort=True)['blocks']):
    for line in block.get('lines',[]):
     text,words=line_words(line,page,index)
     if not text:continue
     x,y,x2,y2=line['bbox'];size=max((span.get('size',0)for span in line.get('spans',[])),default=0)
     raw.append({'text':text,'words':words,'x':x,'y':y,'y2':y2,'height':page.rect.height,'page':index+1,'_block':block_index,'size':size})
     text_pages.setdefault(text,set()).add(index)
   raw_pages.append(raw)
  for index,lines in enumerate(lines_by_page):
   sizes=sorted(line.get('size',0)for line in lines if line.get('size',0)>0);body=sizes[len(sizes)//2]if sizes else 11
   known={(line['text'],round(line['y'],2))for line in lines}
   for line in raw_pages[index]:
    if ((line['text'],round(line['y'],2))not in known and line['size']>=body*1.35 and line['height']*.055<=line['y']<=line['height']*.3 and len(text_pages[line['text']])==1 and re.search(r'[^\W\d_]',line['text'],re.UNICODE)):
     lines.append(line)
   lines.sort(key=lambda line:(line['y'],line['x']))
  corpus=build_hyphen_corpus(lines_by_page)
  for number,page in enumerate(source,1):
   check_cancel(cancelled);lines=lines_by_page[number-1];regions=figure_regions(page);items=[]
   # Text inside diagrams is already present in the faithful diagram crop.
   def inside(line,box):
    x=(line['x']+line['x2'])/2;y=(line['y']+line['y2'])/2
    return box[0]<=x<=box[2]and box[1]<=y<=box[3]
   # pdf_lines uses x but does not expose x2; derive exact right edge from words.
   for line in lines:line['x2']=max((word['bbox'][2]for word in line.get('words',[])),default=line['x'])
   groups=[]
   for line in lines:
    if any(inside(line,item['bbox'])for item in regions):continue
    if groups and groups[-1][-1].get('_block')==line.get('_block'):groups[-1].append(line)
    else:groups.append([line])
   for group in groups:
    text,_=join_lines(group,corpus)
    if text:
     section={'text':text,'images':[],'page':number,'_bbox':[min(line['x']for line in group),min(line['y']for line in group),max(line['x2']for line in group),max(line['y2']for line in group)]}
     sizes=sorted(line.get('size',0)for line in lines if line.get('size',0)>0);body=sizes[len(sizes)//2]if sizes else 11
     if max((line.get('size',0)for line in group),default=0)>=body*1.35:section['heading']=text
     items.append((group[0]['y'],group[0]['x'],section))
   for item in regions:
    check_cancel(cancelled);data=region_png(page,item['bbox']);image={'src':image_uri(data),'alt':'','caption':'','kind':item['kind']}
    items.append((item['bbox'][1],item['bbox'][0],{'text':'','images':[image],'page':number}))
   if not items:
    # A scan remains an original page image, never invented OCR prose.
    scanned+=1;items.append((0,0,{'text':'','images':[{'src':image_uri(region_png(page,list(page.rect))),'alt':'','caption':''}],'page':number}))
   for item in sorted(items,key=lambda item:(item[0],item[1])):
    section=item[2];text_bytes+=len(section['text'].encode());image_bytes+=sum(len(image['src'])for image in section['images'])
    if text_bytes>TEXT_LIMIT or image_bytes>IMAGE_LIMIT:raise ViewError('document_too_large')
    sections.append(section)
 return assign_sources(_validate_document({'title':str(document.get('title')or'Dokument')[:300],'language':document.get('langHint')or'auto','sourceKind':'pdf','sections':sections,'pageCount':len(lines_by_page),'presentation':{'rasterized':False,'searchable':bool(any(section['text']for section in sections)),'scannedPages':scanned}}),document)

class ReadingViewManager:
 def __init__(self,runtime=None,*,endpoint=CDP_ENDPOINT,notify=None):
  self.runtime=Path(runtime)if runtime else None;self.endpoint=validate_endpoint(endpoint);self.notify=notify or(lambda _state:None);self._lock=threading.RLock();self._slot=threading.Lock();self._cancel=threading.Event();self._key=None;self._source=None;self._payload=None;self._thread=None;self._pending=None;self._closed=False;self._metadata={};self._state={'state':'idle','generation':uuid.uuid4().hex,'errorKey':'','sectionCount':0,'imageCount':0}
 def state(self):
  with self._lock:return dict(self._state)
 @staticmethod
 def source_key(document):return(document.get('fingerprint'),json.dumps(document.get('context'),sort_keys=True))if isinstance(document,dict)else None
 def bind(self,document):
  key=self.source_key(document)
  with self._lock:
   if self._closed or key==self._key:return
   self._cancel.set();self._cancel=threading.Event();self._key=key;self._source=document;self._payload=None;self._pending=None;self._metadata.clear();self._state={'state':'idle','generation':uuid.uuid4().hex,'errorKey':'','sectionCount':0,'imageCount':0}
 def build(self,document,cancelled=None,*,cleaned=True):
  while not self._slot.acquire(timeout=.05):check_cancel(cancelled)
  try:
   check_cancel(cancelled)
   with self._lock:
    if cleaned and self.source_key(document)==self._key and self._payload:return self._payload
   context=document.get('context')or{}
   if context.get('kind')=='pdf':return pdf_document(document,cancelled)
   if context.get('kind')=='html':return html_document(document,self.endpoint,cancelled,cleaned)
   raise ViewError('document_unavailable')
  finally:self._slot.release()
 def _prepare(self):
  while True:
   with self._lock:
    if self._closed or not self._pending:self._thread=None;return
    source,cancelled,generation=self._pending;self._pending=None
   try:payload=self.build(source,cancelled);payload={**payload,'generation':generation};error=''
   except ViewCancelled:continue
   except ViewError as exc:payload=None;error=exc.key
   except Exception:payload=None;error='document_prepare_failed'
   with self._lock:
    if cancelled.is_set()or generation!=self._state['generation']:continue
    self._payload=payload;self._state.update(state='ready'if payload else'error',errorKey=error,sectionCount=len(payload['sections'])if payload else 0,imageCount=sum(len(section['images'])for section in payload['sections'])if payload else 0)
   self.notify(self.state())
 def response(self,*,refresh=False):
  with self._lock:
   if self._closed:return 503,{'ok':False,'version':1,'code':'unavailable','errorKey':'document_unavailable'}
   if refresh and self._source:
    self._cancel.set();self._cancel=threading.Event();self._payload=None;self._pending=None;self._metadata.clear();self._state={'state':'idle','generation':uuid.uuid4().hex,'errorKey':'','sectionCount':0,'imageCount':0}
   if self._state['state']=='ready':return 200,{'ok':True,'version':1,'code':'document','document':self._payload}
   if self._state['state']=='error':return 503,{'ok':False,'version':1,'code':'unavailable','errorKey':self._state['errorKey'],'generation':self._state['generation']}
   if not self._source:return 503,{'ok':False,'version':1,'code':'unavailable','errorKey':'document_unavailable','generation':self._state['generation']}
   if self._state['state']=='idle':
    self._state['state']='loading';self._pending=(self._source,self._cancel,self._state['generation'])
    if self._thread is None:
     self._thread=threading.Thread(target=self._prepare,name='reader-focus-document',daemon=True);self._thread.start()
   return 202,{'ok':False,'version':1,'code':'pending','generation':self._state['generation']}
 def pdf_metadata(self,document,pages,*,dpi=144,rasters=False):
  key=(self.source_key(document),tuple(pages),dpi,bool(rasters));cached=self._metadata.get(key)
  if cached is not None:return cached
  result=pdf_metadata(document,pages,dpi=dpi,rasters=rasters)
  with self._lock:
   self._metadata[key]=result
   def raster_bytes(value):return sum(len(image['src'])for image in value.get('appearanceRasters',[]))
   while len(self._metadata)>4 or sum(raster_bytes(value)for value in self._metadata.values())>64*1024*1024:self._metadata.pop(next(iter(self._metadata)))
  return result
 def close(self):
  with self._lock:self._closed=True;self._pending=None;self._cancel.set();self._source=None;self._payload=None;self._metadata.clear();thread=self._thread
  if thread:thread.join(3)

_HTML_CAPTURE=r'''
import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
const input=JSON.parse(readFileSync(0,'utf8')),{collectHtmlBlocks}=await import(pathToFileURL(input.module));
let ws,seq=0;const pending=new Map();
try{
 const targets=await(await fetch(input.endpoint,{signal:AbortSignal.timeout(4000)})).json();
 const id=input.context.frameTargetId||input.context.targetId,target=targets.find(item=>item.id===id);
 if(!target?.webSocketDebuggerUrl)throw {key:'document_changed'};
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject({key:'document_prepare_failed'}),5000);ws.onopen=()=>{clearTimeout(timer);resolve();};ws.onerror=()=>{clearTimeout(timer);reject({key:'document_prepare_failed'});};});
 ws.onmessage=event=>{let message;try{message=JSON.parse(event.data);}catch{return;}const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject({key:'document_images_unavailable'}):entry.resolve(message.result);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const identifier=++seq,timer=setTimeout(()=>{pending.delete(identifier);reject({key:'document_prepare_failed'});},10000);pending.set(identifier,{resolve,reject,timer});ws.send(JSON.stringify({id:identifier,method,params}));});
 const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw {key:result.exceptionDetails.exception?.description?.includes('image unavailable')?'document_images_unavailable':'document_changed'};return result.result.value;};
 const captured=await evaluate(`((context,cleaned)=>{
  const expected=context.frameUrl||context.url;if(location.origin+location.pathname!==expected||(context.documentGeneration!=null&&performance.timeOrigin!==context.documentGeneration))throw Error('changed');
  const text=e=>(e.innerText||e.textContent||'').replace(/\\s+/gu,' ').trim(),excluded='script,style,noscript,template,[hidden],[aria-hidden=true],button,input,select,textarea,[id^=brave-reader]';
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return !e.closest(excluded)&&r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';};
  let root,nodes,sourceTexts,sourceOrders;
  if(cleaned){const c=(${collectHtmlBlocks.toString()})();root=c.root;nodes=c.nodes;}
  else root=document.body;
  const positions=new Map(),all=document.createTreeWalker(root,NodeFilter.SHOW_ALL);let item,position=0;while(item=all.nextNode())positions.set(item,position++);
  if(!cleaned){nodes=[];sourceTexts=[];sourceOrders=[];let lastOwner=null;const walker=document.createTreeWalker(root,NodeFilter.SHOW_ALL);let node;while(node=walker.nextNode()){if(node.nodeType===Node.ELEMENT_NODE&&['IMG','svg','CANVAS'].includes(node.nodeName)){lastOwner=null;continue;}if(node.nodeType!==Node.TEXT_NODE)continue;const element=node.parentElement;if(!element||!visible(element)||!node.textContent.trim())continue;const owner=element.closest('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,figcaption,dt,dd,td,th,header,footer,nav,aside,div,section,body');if(owner===lastOwner)sourceTexts[sourceTexts.length-1]+=node.textContent;else{nodes.push(owner);sourceTexts.push(node.textContent);sourceOrders.push(positions.get(node));lastOwner=owner;}}}
  const sections=nodes.map((e,index)=>{const r=e.getBoundingClientRect(),value=sourceTexts?sourceTexts[index].replace(/\\s+/gu,' ').trim():text(e),links=[];let cursor=0;for(const anchor of e.querySelectorAll('a[href]')){const label=text(anchor),start=value.indexOf(label,cursor);let url;try{url=new URL(anchor.href);}catch{continue;}if(start<0||!label||!['http:','https:'].includes(url.protocol)||url.username||url.password)continue;links.push({start,end:start+label.length,href:url.href});cursor=start+label.length;}return {text:value,links,order:sourceOrders?sourceOrders[index]:positions.get(e)??-1,_sourceBlock:cleaned?index:null,top:r.top+scrollY,left:r.left+scrollX,bottom:r.bottom+scrollY,tag:e.tagName,images:[],...(/^H[1-6]$/.test(e.tagName)?{heading:value,level:Number(e.tagName[1])}:{})};}).filter(section=>section.text);
  const sourceText=sections.map(section=>section.text).join(' ');const images=[];
  for(const element of root.querySelectorAll('img,svg,canvas')){
   if(!visible(element)||element.closest('header,footer,nav,aside,[role=navigation]')&&cleaned||element.parentElement.closest('svg'))continue;
   const r=element.getBoundingClientRect();if(r.width<12||r.height<12)continue;
   if(element.tagName==='IMG'&&(!element.complete||element.naturalWidth<1))throw Error('image unavailable');
   const figure=element.closest('figure');images.push({url:element.tagName==='IMG'?element.currentSrc||element.src:'',tag:element.tagName,alt:element.getAttribute('alt')||'',caption:figure?.querySelector('figcaption')?text(figure.querySelector('figcaption')):'',order:positions.get(element),clip:{x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:Math.min(1,2048/Math.max(r.width,r.height))}});
  }
  return {title:document.title,url:location.origin+location.pathname,generation:performance.timeOrigin,language:document.documentElement.lang||'auto',sections,images,sourceText};
 })(${JSON.stringify(input.context)},${JSON.stringify(input.cleaned)})`);
 if(Buffer.byteLength(captured.sourceText,'utf8')>input.textLimit)throw {key:'document_too_large'};
 const {frameTree}=await call('Page.getFrameTree');const frameId=frameTree.frame.id;
 let bytes=0;
 for(const image of captured.images){
  let data=null;
  if(image.url){
   if(/^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,/i.test(image.url))data=image.url.split(',')[1];
   else try{const resource=await call('Page.getResourceContent',{frameId,url:image.url});if(resource.base64Encoded)data=resource.content;}catch{}
  }
  if(!data){const screenshot=await call('Page.captureScreenshot',{format:'png',clip:image.clip,captureBeyondViewport:true,fromSurface:true});data=screenshot.data;}
  if(typeof data!=='string'||data.length>32*1024*1024)throw {key:'document_images_unavailable'};
  bytes+=data.length;if(bytes>input.imageLimit)throw {key:'document_too_large'};
  const section={text:'',order:image.order,top:image.clip.y,left:image.clip.x,images:[{bytes:data,alt:image.alt,caption:image.caption,kind:image.tag.toLowerCase()==='svg'?'diagram':'image'}]};
  captured.sections.push(section);
 }
 captured.sections=captured.sections.filter(section=>section.tag!=='FIGCAPTION'||!captured.images.some(image=>image.caption===section.text));
 captured.sections.sort((a,b)=>a.order-b.order);
 const identity=await evaluate('({url:location.origin+location.pathname,generation:performance.timeOrigin})');
 if(identity.url!==captured.url||identity.generation!==captured.generation)throw {key:'document_changed'};
 console.log(JSON.stringify({title:captured.title,language:captured.language,sourceKind:'html',sections:captured.sections,_sourceText:captured.sourceText,complete:true,presentation:{rasterized:false,searchable:true}}));
}catch(error){console.log(JSON.stringify({errorKey:['document_changed','document_too_large','document_images_unavailable'].includes(error.key)?error.key:'document_prepare_failed'}));process.exitCode=1;}finally{for(const entry of pending.values())clearTimeout(entry.timer);ws?.close();}
'''

def html_document(document,endpoint=CDP_ENDPOINT,cancelled=None,cleaned=True):
 input_data={'context':document.get('context')or{},'endpoint':validate_endpoint(endpoint),'module':str(ROOT/'html-content.mjs'),'cleaned':bool(cleaned),'imageLimit':IMAGE_LIMIT,'textLimit':TEXT_LIMIT}
 payload=json.dumps(input_data).encode();process=subprocess.Popen(['node','--input-type=module','-e',_HTML_CAPTURE],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL);deadline=time.monotonic()+120
 try:
  first=True
  while True:
   check_cancel(cancelled)
   if time.monotonic()>deadline:raise ViewError('document_prepare_failed')
   try:
    output,_=process.communicate(input=payload if first else None,timeout=.1);break
   except subprocess.TimeoutExpired:first=False
  if len(output)>2*TEXT_LIMIT+IMAGE_LIMIT+8*1024*1024:raise ViewError('document_too_large')
  result=json.loads(output)
  if process.returncode or result.get('errorKey'):raise ViewError(result.get('errorKey','document_prepare_failed'))
  source_text=result.pop('_sourceText','')
  if cleaned and document.get('navigationChunks')and _normal_text(source_text)!=_normal_text(' '.join(chunk.get('text','')for chunk in document['navigationChunks'])):raise ViewError('document_changed')
  for section in result['sections']:
   section.pop('order',None)
   section.pop('top',None);section.pop('bottom',None);section.pop('left',None);section.pop('tag',None)
   for image in section.get('images',[]):image['src']=image_uri(base64.b64decode(image.pop('bytes'),validate=True))
  return assign_sources(_validate_document(result),document)
 finally:
  if process.poll()is None:
   process.terminate()
   try:process.wait(1)
   except subprocess.TimeoutExpired:process.kill();process.wait()
