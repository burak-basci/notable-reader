"""Chapter anchors from genuine PDF outlines / captured HTML heading metadata.

Public records contain bounded titles and section numbers only. Private char
anchors retain exact original word offsets, including two targets in one chunk.
"""
from __future__ import annotations
import math
import re
import unicodedata


def label(value):
    if not isinstance(value,str): return ''
    return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',value).replace('\x00','')).strip()[:160]


def _words(chunks,indexes):
    return [(index,word)for index in indexes for word in chunks[index].get('words',[])
            if isinstance(word,dict)and type(word.get('start'))is int]


def _coordinate(point,name):
    try:
        value=getattr(point,name)if hasattr(point,name)else point[0 if name=='x'else 1]
        return float(value)if type(value)in(int,float)and math.isfinite(value)else None
    except (TypeError,IndexError,KeyError):return None


def pdf_chapters(document,chunks):
    chapters=[];anchors=[]
    try:toc=document.get_toc(simple=False)
    except Exception:return chapters,anchors
    pages={}
    for index,chunk in enumerate(chunks):
        if type(chunk.get('page'))is int:pages.setdefault(chunk['page'],[]).append(index)
    for row in toc:
        if not isinstance(row,(tuple,list))or len(row)<3:continue
        level,title,page=row[:3];title=label(title)
        if type(level)is not int or level<1 or not title or type(page)is not int or page<1:continue
        dest=row[3]if len(row)>3 and isinstance(row[3],dict)else {}
        if dest.get('kind',1)not in(1,4):continue  # no external/launch/URI pseudochapters
        target_page=next((candidate for candidate in sorted(pages)if candidate>=page),None)
        if target_page is None:continue  # no readable source at/after this outline target
        indexes=pages[target_page];words=_words(chunks,indexes)
        point=dest.get('to');x,y=_coordinate(point,'x'),_coordinate(point,'y')
        def distance(item):
            index,word=item;box=word.get('bbox')
            if target_page==page and y is not None and isinstance(box,(tuple,list))and len(box)==4:
                try:return(abs((box[1]+box[3])/2-y),abs(box[0]-(x or 0)),index,word['start'])
                except (TypeError,ValueError):pass
            return(0,0,index,word['start'])
        matches=[]
        for index in indexes:
            for found in re.finditer(re.escape(title),chunks[index].get('text',''),re.I):
                word=next((word for candidate,word in words if candidate==index and word.get('end',word['start'])>found.start()),None)
                if word:matches.append((index,word))
        chosen=min(matches or words,key=distance)if matches or words else (indexes[0],{'start':0})
        section,word=chosen
        chapters.append({'label':title,'sectionIndex':section,'level':level,'page':target_page})
        anchors.append({'sectionIndex':section,'charStart':word['start']})
    return chapters,anchors


def _normal(value):
    return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',value).replace('\u00ad','')).strip()


def _prefix_offset(raw,utf16):
    if type(utf16)is not int or utf16<0:return 0
    # JavaScript ranges count UTF-16 units; Python/NFKC word offsets do not.
    prefix=raw.encode('utf-16-le',errors='surrogatepass')[:utf16*2].decode('utf-16-le',errors='ignore')
    return len(_normal(prefix))


def html_chapters(blocks,chunks):
    chapters=[];anchors=[]
    by_page={}
    for index,chunk in enumerate(chunks):by_page.setdefault(chunk.get('page'),[]).append(index)
    for page,block in enumerate(blocks,1):
        indexes=by_page.get(page,[])
        if not indexes:continue
        headings=block.get('headings')
        if not isinstance(headings,list):
            headings=[{'label':block.get('text'),'level':block['headingLevel'],'charStart':0}]if type(block.get('headingLevel'))is int else []
        raw=str(block.get('text',''));text=_normal(raw);mapped=[];cursor=0
        for index,word in _words(chunks,indexes):
            at=text.find(str(word.get('text','')),cursor)
            if at<0:continue
            mapped.append((at,index,word['start']));cursor=at+len(word.get('text',''))
        for heading in headings:
            if not isinstance(heading,dict):continue
            title=label(heading.get('label'));level=heading.get('level')
            if not title or type(level)is not int or not 1<=level<=6:continue
            offset=_prefix_offset(raw,heading.get('charStart',0))
            chosen=next((entry for entry in mapped if entry[0]>=offset),mapped[-1]if mapped else (0,indexes[0],0))
            _,section,start=chosen
            chapters.append({'label':title,'sectionIndex':section,'level':level,'page':page})
            anchors.append({'sectionIndex':section,'charStart':start})
    return chapters,anchors


def document_chapters(document):
    """Validate the full inventory, never truncate the number of entries."""
    chunks=document.get('navigationChunks',[]);raw=document.get('chapters',[]);positions=document.get('_chapterAnchors',[])
    chapters=[];anchors=[]
    if not isinstance(raw,list):return chapters,anchors
    for number,item in enumerate(raw):
        if not isinstance(item,dict):continue
        text=label(item.get('label'));index=item.get('sectionIndex');level=item.get('level')
        if not text or type(index)is not int or not 0<=index<len(chunks)or type(level)is not int or level<1:continue
        result={'label':text,'sectionIndex':index,'level':level}
        if type(item.get('page'))is int and item['page']>0:result['page']=item['page']
        anchor=positions[number]if isinstance(positions,list)and number<len(positions)and isinstance(positions[number],dict)else {}
        start=anchor.get('charStart',0)
        if type(start)is not int or start<0 or start>=max(1,len(chunks[index].get('text',''))):start=0
        words=chunks[index].get('words',[])
        if start and not any(word.get('start')==start for word in words):start=0
        chapters.append(result);anchors.append((index,start))
    return chapters,anchors
