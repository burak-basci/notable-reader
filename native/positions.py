"""Private, geometry-only PDF/article bookmarks, keyed by a public URL hash."""
from __future__ import annotations
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import time
from urllib.parse import urlsplit, urlunsplit


def pdf_identity(context):
    if not isinstance(context,dict) or context.get('kind') not in ('pdf','html'):return None
    try:
        url=urlsplit(context['url'])
        if url.scheme not in ('file','http','https') or not url.path:return None
        # Neither authentication parameters nor page fragments define a book.
        public=urlunsplit((url.scheme.lower(),url.netloc.lower(),url.path,'',''))
        identity=public if context.get('kind')=='pdf' else 'html\0'+public
        return hashlib.sha256(identity.encode()).hexdigest()
    except (KeyError,TypeError,ValueError):return None


def geometry(word):
    if not isinstance(word,dict) or word.get('geometryValid') is False or type(word.get('page')) is not int or word['page']<1:return None
    try:
        bbox=word['bbox'];width=word['pageWidth'];height=word['pageHeight']
        if len(bbox)!=4 or any(type(v) not in (int,float) or not math.isfinite(v) for v in (*bbox,width,height)):return None
        if width<=0 or height<=0 or not (0<=bbox[0]<bbox[2]<=width+1 and 0<=bbox[1]<bbox[3]<=height+1):return None
        return {'page':word['page'],'bbox':list(bbox),'pageWidth':width,'pageHeight':height}
    except (KeyError,TypeError,ValueError):return None


class Positions:
    def __init__(self,path=None,interval=2.0):
        config=Path(os.environ.get('XDG_CONFIG_HOME') or Path.home()/'.config')
        self.path=Path(path) if path is not None else config/'brave-reader'/'positions.json'
        self.interval=interval;self.updated=0.;self.dirty=False;self.entries={}
        try:
            values=json.loads(self.path.read_text()).get('positions',{})
            for key,value in values.items():
                anchor=geometry(value)
                fingerprint=value.get('fingerprint')
                if (len(key)==64 and all(c in '0123456789abcdef' for c in key) and anchor
                    and isinstance(fingerprint,str) and len(fingerprint)==64):
                    self.entries[key]={**anchor,'fingerprint':fingerprint}
        except (OSError,ValueError,TypeError,AttributeError):pass

    def get(self,context,fingerprint,pages=None):
        value=self.entries.get(pdf_identity(context))
        if not value:return None
        if value['fingerprint']==fingerprint:return dict(value)
        # The document text changed (new fingerprint); only reuse the old
        # geometry if the same page still plausibly exists at the same size.
        if not isinstance(pages,dict):return None
        size=pages.get(value['page'])
        if not isinstance(size,(tuple,list)) or len(size)!=2:return None
        width,height=size
        try:
            if any(type(v) not in (int,float) or not math.isfinite(v) for v in (width,height)):return None
            if abs(width-value['pageWidth'])>1 or abs(height-value['pageHeight'])>1:return None
            x0,y0,x1,y1=value['bbox']
            if not (0<=x0<x1<=width+1 and 0<=y0<y1<=height+1):return None
        except (TypeError,ValueError):return None
        return {**value,'stale':True}

    def remember(self,context,word,fingerprint,flush=False):
        key=pdf_identity(context);anchor=geometry(word)
        if not key or not anchor or not isinstance(fingerprint,str) or len(fingerprint)!=64:return
        self.entries[key]={**anchor,'fingerprint':fingerprint};self.dirty=True
        if flush or time.monotonic()-self.updated>=self.interval:self.flush()

    def flush(self):
        if not self.dirty:return
        self.path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        if self.path.parent.is_symlink():raise OSError('Unsicheres Positionsverzeichnis')
        self.path.parent.chmod(0o700)
        temporary=None
        try:
            with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',prefix='.positions-',dir=self.path.parent,delete=False) as output:
                temporary=Path(output.name);temporary.chmod(0o600)
                json.dump({'version':1,'positions':self.entries},output,allow_nan=False)
                output.write('\n');output.flush();os.fsync(output.fileno())
            os.replace(temporary,self.path);self.dirty=False;self.updated=time.monotonic()
        finally:
            if temporary is not None:temporary.unlink(missing_ok=True)
