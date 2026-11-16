"""Premium document exports. Local rendering, complete sources, atomic output."""
from __future__ import annotations
import base64,contextlib,html,math,os,shutil,subprocess,tempfile,threading,time
from pathlib import Path
from audiobook_export import premium_provider,premium_status,safe_filename
from reading_view import appearance_value,pdf_path,figure_regions,ViewError,ViewCancelled,check_cancel,PIXEL_LIMIT


def palette(appearance,system_dark=True):
 mode=appearance['mode'];dark=mode=='dark'or mode=='auto'and system_dark
 return ('dark'if dark else'light',*(appearance[key]for key in(('background','text','link')if dark else('lightBackground','lightText','lightLink'))))

def _color(value):return [int(value[index:index+2],16)/255 for index in(1,3,5)]

def transform_pixels(pixels,appearance,system_dark=True,*,figure=False,kind='image',source_background=None):
 import numpy as np
 if appearance['mode']=='off':return pixels.copy()
 x=pixels.astype(np.float32)/255
 if figure:
  mode=appearance['imageMode']
  if mode=='smart':
   white=float(np.mean(np.min(x,axis=2)>.85));chroma=float(np.mean(np.max(x,axis=2)-np.min(x,axis=2)))
   mode='invert'if palette(appearance,system_dark)[0]=='dark'and(kind=='diagram'and white>.4 or white>.6 and chroma<.12)else'preserve'
  if mode=='invert':x=1-x
  if mode=='dim':x*=.7
  x*=appearance['imageBrightness']/100
 else:
  _,background,text,_=palette(appearance,system_dark);bg=np.array(_color(background));fg=np.array(_color(text));luma=x@np.array([.2126,.7152,.0722],dtype=np.float32)
  source=float(np.mean(source_background))if source_background is not None else 1
  ink=np.clip((luma-source)/max(.05,1-source),0,1)if source<.4 else np.clip((source-luma)/max(.05,source),0,1)
  x=bg+(fg-bg)*ink[:,:,None]
  x=(x-.5)*(appearance['contrast']/100)+.5;x*=appearance['brightness']/100
  gray=(x@np.array([.2126,.7152,.0722]))[:,:,None];amount=appearance['grayscale']/100;x=x*(1-amount)+gray*amount
  sepia=x@np.array([[.393,.349,.272],[.769,.686,.534],[.189,.168,.131]]);amount=appearance['sepia']/100;x=x*(1-amount)+sepia*amount
 return np.clip(np.floor(x*255+.5),0,255).astype(np.uint8)

def toned_palette(appearance,system_dark=True):
 import numpy as np
 mode,bg,text,link=palette(appearance,system_dark)
 colors=np.array([_color(value)for value in(bg,text,link)],dtype=np.float64).reshape(1,3,3)
 if appearance['mode']!='off':
  colors=(colors-.5)*(appearance['contrast']/100)+.5;colors*=appearance['brightness']/100
  gray=(colors@np.array([.2126,.7152,.0722]))[:,:,None];amount=appearance['grayscale']/100;colors=colors*(1-amount)+gray*amount
  sepia=colors@np.array([[.393,.349,.272],[.769,.686,.534],[.189,.168,.131]]);amount=appearance['sepia']/100;colors=colors*(1-amount)+sepia*amount
 colors=np.clip(np.floor(colors*255+.5),0,255).astype(np.uint8)[0]
 return(mode,*('#'+''.join(f'{int(component):02x}'for component in color)for color in colors))

def styled_image(image,appearance,system_dark=True):
 import pymupdf,numpy as np
 if appearance['mode']=='off'or appearance['imageMode']=='preserve'and appearance['imageBrightness']==100:return image['src']
 raw=base64.b64decode(image['src'].split(',',1)[1],validate=True);pix=pymupdf.Pixmap(raw)
 if pix.colorspace.n!=3:pix=pymupdf.Pixmap(pymupdf.csRGB,pix)
 pixels=np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.height,pix.width,pix.n);rgb=pixels[:,:,:3]
 alpha=pixels[:,:,3:4].astype(np.float32)/255 if pix.alpha else None
 if alpha is not None:rgb=np.clip(np.floor(rgb/np.maximum(alpha,.00001)+.5),0,255).astype(np.uint8)
 result=transform_pixels(rgb,appearance,system_dark,figure=True,kind=image.get('kind','image'))
 if alpha is not None:result=np.concatenate([np.floor(result*alpha+.5).astype(np.uint8),pixels[:,:,3:4]],axis=2)
 output=pymupdf.Pixmap(pymupdf.csRGB,pix.width,pix.height,result.tobytes(),bool(pix.alpha))
 return 'data:image/png;base64,'+base64.b64encode(output.tobytes('png')).decode()

def styled_page(page,appearance,system_dark=True):
 import pymupdf,numpy as np
 scale=appearance['pdfDpi']/72
 if math.ceil(page.rect.width*scale)*math.ceil(page.rect.height*scale)>PIXEL_LIMIT:raise ViewError('document_too_large')
 original=page.get_pixmap(matrix=pymupdf.Matrix(scale,scale),colorspace=pymupdf.csRGB,alpha=False)
 pixels=np.frombuffer(original.samples,dtype=np.uint8).reshape(original.height,original.width,3)
 corners=np.concatenate([pixels[:3,:3].reshape(-1,3),pixels[:3,-3:].reshape(-1,3),pixels[-3:,:3].reshape(-1,3),pixels[-3:,-3:].reshape(-1,3)])
 background=np.median(corners,axis=0)/255
 output=transform_pixels(pixels,appearance,system_dark,source_background=background)
 link_appearance={**appearance,'text':appearance['link'],'lightText':appearance['lightLink']}
 for link in page.get_links():
  rectangle=link.get('from')
  if rectangle is None:continue
  x0=max(0,math.floor(rectangle.x0*scale));y0=max(0,math.floor(rectangle.y0*scale));x1=min(original.width,math.ceil(rectangle.x1*scale));y1=min(original.height,math.ceil(rectangle.y1*scale))
  if x1>x0 and y1>y0:output[y0:y1,x0:x1]=transform_pixels(pixels[y0:y1,x0:x1],link_appearance,system_dark,source_background=background)
 for item in figure_regions(page):
  x0,y0,x1,y1=item['bbox'];x0=max(0,math.floor(x0*scale));y0=max(0,math.floor(y0*scale));x1=min(original.width,math.ceil(x1*scale));y1=min(original.height,math.ceil(y1*scale))
  if x1>x0 and y1>y0:output[y0:y1,x0:x1]=transform_pixels(pixels[y0:y1,x0:x1],appearance,system_dark,figure=True,kind=item['kind'])
 pix=pymupdf.Pixmap(pymupdf.csRGB,original.width,original.height,output.tobytes(),False)
 return pix.tobytes('png')

def flow_parts(document,appearance,system_dark=True,*,on_section=None):
 mode,bg,text,link=toned_palette(appearance,system_dark)
 families={'serif':'Georgia,serif','sans':'Arial,sans-serif','system':'system-ui,sans-serif','mono':'monospace'}
 # All source prose/attributes are escaped; no source HTML/CSS/script is reused.
 csp="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"
 yield '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+html.escape(csp,quote=True)+'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(str(document.get('title')or'Dokument'))+'</title><style>'
 yield f'''@page{{margin:18mm}}html{{background:{bg};color:{text};-webkit-print-color-adjust:exact;print-color-adjust:exact}}body{{font-family:{families[appearance['fontFamily']]};font-size:{appearance['fontSize']}px;line-height:{appearance['lineHeight']};max-width:{appearance['contentWidth']}px;margin:0 auto;padding:24px;overflow-wrap:anywhere}}a{{color:{link}}}img{{max-width:100%;height:auto;}}figure{{margin:1em 0;break-inside:avoid}}figcaption{{font-size:.85em}}h1,h2,h3,h4,h5,h6{{line-height:1.25;break-after:avoid}}.source-page{{font-size:.7em;opacity:.6;border-top:1px solid currentColor;margin-top:2em}}p{{white-space:pre-wrap}}</style></head><body>'''
 previous_page=None
 for index,section in enumerate(document['sections']):
  page=section.get('page')
  if not appearance['hidePageNumbers']and document.get('sourceKind')=='pdf'and type(page)is int and page>0 and page!=previous_page:
   yield f'<div class="source-page" aria-label="Source page">{page}</div>';previous_page=page
  value='';position=0
  from urllib.parse import urlsplit
  for item in section.get('links',[]):
   try:
    start,end,href=item['start'],item['end'],item['href'];parsed=urlsplit(href)
    if type(start)is not int or type(end)is not int or not position<=start<end<=len(section['text'])or parsed.scheme not in('http','https')or not parsed.netloc or parsed.username or parsed.password:continue
   except (KeyError,TypeError,ValueError):continue
   value+=html.escape(section['text'][position:start])+'<a href="'+html.escape(href,quote=True)+'">'+html.escape(section['text'][start:end])+'</a>';position=end
  value+=html.escape(section['text'][position:])
  if value:
   tag='h'+str(section.get('level',2))if section.get('heading')and type(section.get('level',2))is int and 1<=section.get('level',2)<=6 else'p'
   yield f'<{tag}>{value}</{tag}>'
  for image in section.get('images',[]):
   src=styled_image(image,appearance,system_dark)
   yield '<figure><img src="'+html.escape(src,quote=True)+'" alt="'+html.escape(str(image.get('alt','')),quote=True)+'">'
   if image.get('caption'):yield '<figcaption>'+html.escape(image['caption'])+'</figcaption>'
   yield '</figure>'
  if on_section:on_section(index+1)
 yield '</body></html>'


class DocumentExportManager:
 def __init__(self,view_manager,output_dir=None,runtime=None,premium_provider=None,notify=None):
  self.view=view_manager;self.output_dir=Path(output_dir)if output_dir else Path.home()/'Downloads/NotableReader';self.runtime=Path(runtime)if runtime else None;self.provider=premium_provider;self.notify=notify or(lambda _state:None);self._lock=threading.RLock();self._cancelled=threading.Event();self._thread=None;self._process=None;self._committing=False;self._state={'kind':'document','state':'idle','percent':0,'completedChunks':0,'totalChunks':0,'filename':'','error':'','errorKey':''}
 def snapshot(self):
  with self._lock:return dict(self._state)
 def _publish(self,**values):
  with self._lock:self._state.update(values);state=dict(self._state)
  with contextlib.suppress(Exception):self.notify(state)
 def start(self,document,appearance,format='pdf',*,system_dark=True):
  if format not in('pdf','html')or not isinstance(document,dict)or not document.get('context'):return False
  try:appearance=appearance_value(appearance)
  except (ValueError,TypeError):return False
  with self._lock:
   if self._thread and self._thread.is_alive():return False
   self._cancelled=threading.Event();self._committing=False;self._state={'kind':'document','state':'running','percent':0,'completedChunks':0,'totalChunks':0,'filename':'','error':'','errorKey':''};self._thread=threading.Thread(target=self._run,args=(document,appearance,format,bool(system_dark)),name='reader-document-export',daemon=True);self._thread.start();return True
 def cancel(self):
  with self._lock:
   if self._state['state']!='running'or self._committing:return False
   self._cancelled.set();process=self._process
  if process:
   with contextlib.suppress(OSError):process.terminate()
  return True
 def wait(self,timeout=None):
  thread=self._thread
  if thread:thread.join(timeout)
  return self.snapshot()
 def close(self,timeout=3):self.cancel();self.wait(timeout)
 def _check(self):check_cancel(self._cancelled)
 def _progress(self,index,total):self._check();self._publish(completedChunks=index,totalChunks=total,percent=min(99,int(index/max(1,total)*100)))
 def _native_pdf(self,document,appearance,path,system_dark):
  import pymupdf
  source_path=pdf_path(document)
  with pymupdf.open(source_path)as source:
   total=len(source);searchable=False;self._progress(0,total)
   for index,page in enumerate(source):
    self._check();data=styled_page(page,appearance,system_dark);searchable=searchable or bool(page.get_text().strip())
    # Reopen after every incremental save: no whole-book pixel buffers retained.
    output=pymupdf.open(path)if index else pymupdf.open()
    try:
     output.insert_pdf(source,from_page=index,to_page=index,links=False,annots=False,widgets=False)
     output[-1].insert_image(output[-1].rect,stream=data)
     if index:output.saveIncr()
     else:output.save(path,deflate=True)
    finally:output.close()
    path.chmod(0o600)
    del data;self._progress(index+1,total)
  self._publish(rasterized=True,searchable=searchable)
 def _flow_html(self,document,appearance,path,system_dark):
  total=len(document['sections']);self._progress(0,total)
  with path.open('w',encoding='utf-8')as output:
   for part in flow_parts(document,appearance,system_dark,on_section=lambda index:self._progress(index,total)):
    self._check();output.write(part)
  self._progress(total,total)
 def _print_pdf(self,html_path,path,work):
  profile=work/'chromium';profile.mkdir(mode=0o700)
  rendered=work/'rendered.pdf'
  args=['chromium','--headless','--mute-audio','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--no-pdf-header-footer','--user-data-dir='+str(profile),'--print-to-pdf='+str(rendered),'--timeout=60000',html_path.as_uri()]
  process=subprocess.Popen(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  with self._lock:self._process=process
  deadline=time.monotonic()+90
  try:
   while process.poll()is None:
    self._check()
    if time.monotonic()>deadline:raise ViewError('document_export_failed')
    self._cancelled.wait(.05)
   if process.returncode:raise ViewError('document_export_failed')
   self._check()
   # Chromium creates its PDF afresh. Keep that file inside the private work
   # directory and stream into the already-0600 atomic destination.
   with rendered.open('rb')as source,path.open('wb')as destination:
    while True:
     self._check();block=source.read(256*1024)
     if not block:break
     destination.write(block)
  finally:
   if process.poll()is None:
    process.terminate()
    try:process.wait(1)
    except subprocess.TimeoutExpired:process.kill();process.wait()
   with self._lock:self._process=None
 def _run(self,document,appearance,format,system_dark):
  temporary=None
  try:
   try:
    provider=premium_provider(self.provider)
    if provider.require_export()is False or not premium_status(provider)['enabled']:raise PermissionError()
   except Exception:self._publish(state='locked',errorKey='premium_locked',error='Für Dokumentdownloads ist Premium erforderlich.');return
   self._check();self.output_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
   fd,name=tempfile.mkstemp(prefix='.notable-document-',suffix='.'+format,dir=self.output_dir);os.close(fd);temporary=Path(name);temporary.chmod(0o600)
   with tempfile.TemporaryDirectory(prefix='document-export-',dir=self.runtime)as folder:
    work=Path(folder);work.chmod(0o700)
    source_kind=(document.get('context')or{}).get('kind')
    if source_kind=='pdf'and not appearance['focus']and format=='pdf':
     rendered=work/'native.pdf';self._native_pdf(document,appearance,rendered,system_dark)
     with rendered.open('rb')as source,temporary.open('wb')as destination:
      while True:
       self._check();block=source.read(256*1024)
       if not block:break
       destination.write(block)
    else:
     content=self.view.build(document,self._cancelled,cleaned=True if source_kind=='pdf'else appearance['focus'])
     if format=='html':self._flow_html(content,appearance,temporary,system_dark)
     else:
      page=work/'content.html';self._flow_html(content,appearance,page,system_dark);page.chmod(0o600);self._print_pdf(page,temporary,work)
      import pymupdf
      with pymupdf.open(temporary)as result:
       if not len(result):raise ViewError('document_export_failed')
      self._publish(rasterized=False,searchable=True)
   self._check()
   if temporary.stat().st_size<20:raise ViewError('document_export_failed')
   with temporary.open('rb')as output:os.fsync(output.fileno())
   filename=safe_filename(document.get('title')or'Dokument',format)
   with self._lock:
    self._check();self._committing=True;os.replace(temporary,self.output_dir/filename);temporary=None;self._state.update(state='complete',percent=100,filename=filename,error='',errorKey='')
   self._publish()
  except ViewCancelled:self._publish(state='cancelled',error='',errorKey='')
  except Exception as error:
   if self._cancelled.is_set():self._publish(state='cancelled',error='',errorKey='')
   else:self._publish(state='error',errorKey=error.key if type(error)is ViewError else'document_export_failed',error='Das vollständige Dokument konnte nicht gespeichert werden.')
  finally:
   if temporary:
    with contextlib.suppress(OSError):temporary.unlink()


class ExportCoordinator:
 """Keep the established audio API, allow exactly one export kind at a time."""
 def __init__(self,audio,document):self.audio=audio;self.document=document;self._lock=threading.RLock();self._kind='audio'
 def snapshot(self):
  with self._lock:
   if self.audio.snapshot()['state']=='running':kind='audio'
   elif self.document.snapshot()['state']=='running':kind='document'
   else:kind=self._kind
   return {**(self.audio if kind=='audio'else self.document).snapshot(),'kind':kind}
 def start(self,document,voice,format='mp3'):
  with self._lock:
   if self.snapshot()['state']=='running':return False
   self._kind='audio';return self.audio.start(document,voice,format)
 def start_document(self,document,appearance,format='pdf',*,system_dark=True):
  with self._lock:
   if self.snapshot()['state']=='running':return False
   self._kind='document';return self.document.start(document,appearance,format,system_dark=system_dark)
 def cancel(self):
  with self._lock:return(self.audio if self._kind=='audio'else self.document).cancel()
 def wait(self,timeout=None):
  (self.audio if self._kind=='audio'else self.document).wait(timeout);return self.snapshot()
 def close(self,timeout=3):self.audio.close(timeout);self.document.close(timeout)
