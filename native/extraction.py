"""Extract original prose from the visible Brave document, omitting running margins."""
import hashlib
from bisect import bisect_right
from difflib import SequenceMatcher
import json
import math
import os
from pathlib import Path
import re
import subprocess
import unicodedata
import citations
from urllib.parse import urlsplit, unquote, urldefrag
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent

def clean(text):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', text).replace('\u00ad', '')).strip()

def key(text):
    return re.sub(r'\d+', '#', clean(text))

def union_bbox(boxes):
    return [min(b[0] for b in boxes),min(b[1] for b in boxes),
            max(b[2] for b in boxes),max(b[3] for b in boxes)]

def line_words(line, page, index):
    """Normalize prose and retain the source glyph rectangle of every word.

    NFKC can expand one ligature into several characters. Each expanded character
    keeps its original glyph rectangle; combining sequences share their union.
    """
    chars=[c for span in line['spans'] for c in span['chars']]
    text=clean(''.join(c['c'] for c in chars))
    # Raised, smaller glyphs (footnote marks) are only flagged here; pdf_lines decides.
    raised=citations.raised_flags(chars,[span['size'] for span in line['spans'] for _ in span['chars']]) if all('origin' in c for c in chars) else [False]*len(chars)
    expanded=[];flags=[]
    for char,lifted in zip(chars,raised):
        for c in unicodedata.normalize('NFKC',char['c']).replace('\u00ad',''):
            if c.isspace():
                if expanded and expanded[-1][0]!=' ':expanded.append((' ',char['bbox']));flags.append(False)
            else:expanded.append((c,char['bbox']));flags.append(lifted)
    if expanded and expanded[-1][0]==' ':expanded.pop();flags.pop()
    normalized=''.join(c for c,_ in expanded)
    boxes=[b for _,b in expanded]
    if normalized!=text:
        # NFKC composition across glyph boundaries (e.g. e + combining accent).
        aligned=[None]*len(text);aligned_flags=[False]*len(text)
        for kind,a,b,c,d in SequenceMatcher(None,normalized,text,autojunk=False).get_opcodes():
            if kind=='equal':aligned[c:d]=boxes[a:b];aligned_flags[c:d]=flags[a:b]
            elif c<d:
                rectangle=union_bbox(boxes[a:b] or boxes[max(0,a-1):a+1])
                aligned[c:d]=[rectangle]*(d-c);aligned_flags[c:d]=[bool(flags[a:b]) and all(flags[a:b])]*(d-c)
        boxes=aligned;flags=aligned_flags
    words=[]
    for match in re.finditer(r'\S+',text):
        words.append({'text':match.group(),'start':match.start(),'end':match.end(),
                      'page':index+1,'bbox':union_bbox(boxes[match.start():match.end()]),
                      'pageWidth':page.rect.width,'pageHeight':page.rect.height})
        found=citations.raised_candidate(flags[match.start():match.end()])
        if found and found[1]<=2:words[-1]['_raised']=found[0]
    return text,words

_HYPHEN_SOFT=('-','‐','‑')
_HYPHEN_ENDERS=_HYPHEN_SOFT+('–','—')  # + en dash/em dash: always kept, see _hyphen_decision
_DICTIONARY=None

def _load_dictionary():
    """Load /usr/share/dict/cracklib-small once per process; stay empty if unreadable."""
    global _DICTIONARY
    if _DICTIONARY is None:
        _DICTIONARY=set()
        try:
            with open('/usr/share/dict/cracklib-small',encoding='utf-8',errors='ignore') as f:
                _DICTIONARY.update(line.strip().lower() for line in f if line.strip())
        except OSError:pass
    return _DICTIONARY

def _strip_outer_punct(token):
    return re.sub(r'^\W+|\W+$','',token)

def build_hyphen_corpus(pages):
    """Every token that is not the last word of its line, across the whole document.

    Evidence for how this particular document itself spells a compound (hyphenated
    or solid) elsewhere, away from any line-wrap ambiguity. Built once per document.
    """
    corpus=set()
    for lines in pages:
        for line in lines:
            for w in line['words']:
                # A token ending in a hyphen is the ambiguous wrapped case itself
                # and must never serve as evidence; every other token may.
                if w['text'][-1:] in _HYPHEN_ENDERS:continue
                t=_strip_outer_punct(w['text']).lower()
                if t:corpus.add(t)
    return corpus

def _hyphen_decision(end_word,start_word,corpus,mid_sentence=False):
    """First matching rule wins. True: the line-end hyphen survives (fragments join
    without a space, hyphen kept, e.g. on-demand). False: the hyphen is dropped and
    the fragments merge into one word (e.g. transmitted)."""
    dash=end_word[-1]
    a_raw=_strip_outer_punct(end_word[:-1]);b_raw=_strip_outer_punct(start_word)
    a=a_raw.lower();b=b_raw.lower()
    if dash not in _HYPHEN_SOFT:return True  # en dash / em dash is never a soft line-break hyphen
    if len(a)<2 or len(b)<2:return True
    if a[-1:].isdigit() or b[:1].isdigit():return True
    if b_raw[:1].isupper():return True
    hyphenated,solid=f'{a}-{b}',f'{a}{b}'
    if hyphenated in corpus:return True
    if solid in corpus:return False
    # A capitalised first fragment that the document uses as a standalone word
    # is a name or acronym (Suricata-, AWS-), not a split syllable.
    if a_raw[:1].isupper() and (a in corpus or mid_sentence):return True
    dictionary=_load_dictionary()
    if dictionary:
        if solid in dictionary and not(a in dictionary and b in dictionary):return False
        if a in dictionary and b in dictionary:return True
    return False  # no evidence either way: merge (fallback)

def _page_median_gap(lines):
    gaps=sorted(b['y']-a['y'] for a,b in zip(lines,lines[1:]) if b['y']>a['y'])
    if not gaps:return None
    mid=len(gaps)//2
    return gaps[mid] if len(gaps)%2 else (gaps[mid-1]+gaps[mid])/2

def _merge_line_break(line,nxt,corpus):
    """Combine a hyphenated line end with the next line's first word into exactly
    one word spanning the break. The rest of both lines keeps its own words; only
    their offsets shift to match the new combined text."""
    end_word,start_word=line['words'][-1],nxt['words'][0]
    # A capitalised fragment inside a sentence is a name, not a split syllable.
    before=line['text'][:end_word['start']].rstrip()
    mid_sentence=bool(before) and before[-1] not in '.!?:;'
    keep=_hyphen_decision(end_word['text'],start_word['text'],corpus,mid_sentence)
    frag1,frag2=end_word['text'][:-1],start_word['text']
    merged_text=frag1+(end_word['text'][-1] if keep else '')+frag2
    prefix=line['text'][:end_word['start']]
    suffix=nxt['text'][start_word['end']:]
    merged_word={**end_word,'text':merged_text,'start':end_word['start'],
                 'end':end_word['start']+len(merged_text),
                 'parts':[[round(v,3) for v in end_word['bbox']],[round(v,3) for v in start_word['bbox']]]}
    if 'mute' in start_word:  # a mark glued to the second fragment
        merged_word=citations.set_mute({k:v for k,v in merged_word.items() if k not in ('mute','silent')},
            [[a+len(merged_text)-len(frag2),b+len(merged_text)-len(frag2)] for a,b in start_word['mute']])
    focuses=[w['focusBBox'] for w in (end_word,start_word) if 'focusBBox' in w]
    if focuses:merged_word['focusBBox']=union_bbox([end_word['bbox'],start_word['bbox']]+focuses)
    shift=len(prefix)+len(merged_text)-start_word['end']
    words=[*line['words'][:-1],merged_word,
           *({**w,'start':w['start']+shift,'end':w['end']+shift} for w in nxt['words'][1:])]
    return prefix+merged_text+suffix,words

def join_lines(lines,corpus=None):
    """Join a page's lines into one text, merging real line-wrap hyphenation and
    marking paragraph/heading breaks with '\\n' so chunks_for can split on them."""
    if corpus is None:corpus=frozenset()
    median=_page_median_gap(lines)
    texts=[];seps=[];words=[];offset=0
    i=0;n=len(lines)
    while i<n:
        line=lines[i];last=line;consumed=1
        unit_text,unit_words=line['text'],line['words']
        if (line['words'] and len(line['words'][-1]['text'])>1
            and line['words'][-1]['text'][-1] in _HYPHEN_ENDERS and i+1<n):
            nxt=lines[i+1]
            if nxt['_block']==line['_block'] and nxt['y']>line['y'] and nxt['words']:
                unit_text,unit_words=_merge_line_break(line,nxt,corpus);last=nxt;consumed=2
        words.extend({**w,'start':w['start']+offset,'end':w['end']+offset} for w in unit_words)
        texts.append(unit_text)
        offset+=len(unit_text)+1
        i+=consumed
        if i<n:
            nxt_line=lines[i]
            gap=nxt_line['y']-last['y']
            newline=nxt_line['_block']!=last['_block'] or (median is not None and gap>1.6*median)
            seps.append('\n' if newline else ' ')
    out=[]
    for k,t in enumerate(texts):
        out.append(t)
        if k<len(seps):out.append(seps[k])
    return ''.join(out),words

def slice_words(words,start):
    """Offsets become relative to the selection, including a partial first word."""
    return [citations.shift_mute({**w,'text':w['text'][max(0,start-w['start']):],
             'start':max(0,w['start']-start),'end':w['end']-start},max(0,start-w['start']))
            for w in words if w['end']>start]

# Captions and references use the same identity, but a reference alone never
# invents an illustration: it must match a nearby, geometrically paired caption.
FIGURE_REFERENCE = re.compile(
    r'\b(?P<kind>figure|fig\.?|abbildung|table|tabelle)\s*'
    r'(?P<number>\d+(?:[.\-–]\d+)*[a-z]?|[IVXLCDM]+)(?=\s|[:.)–-]|$)', re.I)

def _figure_id(match):
    kind=match['kind'].lower()
    return ('table' if kind in ('table','tabelle') else 'figure',match['number'].lower())

def _overlap_x(a,b):
    return max(0,min(a[2],b[2])-max(a[0],b[0]))/max(1,min(a[2]-a[0],b[2]-b[0]))

def _inside(box,region):
    x=(box[0]+box[2])/2;y=(box[1]+box[3])/2
    return region[0]<=x<=region[2] and region[1]<=y<=region[3]

def _page_box(box,page):
    box=[max(0,box[0]),max(0,box[1]),min(page.rect.width,box[2]),min(page.rect.height,box[3])]
    return box if all(math.isfinite(x) for x in box) and box[2]>box[0] and box[3]>box[1] else None

def graphic_regions(page):
    """Find rendered raster regions and connected vector diagrams/table rules.

    Page backgrounds and isolated ornaments are not useful reading targets. Do
    not rasterize/OCR pages or extract image bytes just to compute their bounds.
    """
    width,height=page.rect.width,page.rect.height
    area=width*height
    def useful(box):
        w,h=box[2]-box[0],box[3]-box[1]
        return w>=28 and h>=20 and w*h>=max(600,area*.003) and w*h<area*.80
    regions=[]
    for image in page.get_image_info():
        box=_page_box(image['bbox'],page)
        if box and useful(box):regions.append(box)
    drawings=[]
    for drawing in page.get_drawings():
        rect=drawing['rect']
        # Keep zero-height/width rules for clustering into complete tables.
        if not all(math.isfinite(x) for x in rect):continue
        if rect.width*rect.height>=area*.80:continue
        if rect.width>=width*.7 and rect.height<3 and (rect.y1<height*.10 or rect.y0>height*.90):continue
        drawings.append(drawing)
    if drawings:
        for rect in page.cluster_drawings(drawings=drawings,x_tolerance=6,y_tolerance=6,final_filter=False):
            box=_page_box(rect,page)
            if not box or not useful(box):continue
            # A single shaded text box is not evidence of a vector diagram.
            members=[d for d in drawings if _inside(d['rect'],box)]
            if len(members)>1 or sum(len(d['items']) for d in members)>=3:regions.append(box)
    # Merge raster/vector overlays and adjoining pieces of the same diagram.
    # Separate stacked screenshots and separate columns retain their identities.
    merged=[]
    for box in regions:
        while True:
            found=None
            for i,other in enumerate(merged):
                dx=max(0,box[0]-other[2],other[0]-box[2])
                dy=max(0,box[1]-other[3],other[1]-box[3])
                combined=union_bbox([box,other])
                if dx<=6 and dy<=6 and useful(combined):found=i;break
            if found is None:break
            box=union_bbox([box,merged.pop(found)])
        merged.append(box)
    return merged

def add_figure_context(page,lines):
    """Attach optional, stable figure+caption bounds without changing prose.

    Only caption words, text inside a visual, and explicit nearby references to
    its caption receive context. Ordinary adjacent paragraphs keep word focus.
    Unlabelled or ambiguous diagrams are deliberately left to normal scrolling.
    """
    graphics=graphic_regions(page)
    if not graphics or not lines:return
    boxes=[union_bbox([w['bbox'] for w in line['words']]) for line in lines]
    captions={i:match for i,line in enumerate(lines)
              if (match:=FIGURE_REFERENCE.match(line['text']))}
    paired={}
    for graphic in graphics:
        choices=[]
        for i,match in captions.items():
            box=boxes[i]
            if _overlap_x(graphic,box)<.2:continue
            if box[1]>=graphic[3]-3:gap=box[1]-graphic[3];bias=0
            elif box[3]<=graphic[1]+3:gap=graphic[1]-box[3];bias=5
            else:continue
            if not -3<=gap<=44:continue
            # Intervening prose means this is a reference, not this caption.
            lo,hi=sorted((box[1] if bias==0 else box[3],graphic[3] if bias==0 else graphic[1]))
            if any(j!=i and lo+2<other[1] and other[3]<hi-2 and _overlap_x(other,graphic)>.2
                   for j,other in enumerate(boxes)):continue
            choices.append((max(0,gap)+bias,i))
        if choices:
            _,i=min(choices)
            paired.setdefault(i,[]).append(graphic)
    contexts=[]
    for caption,visuals in paired.items():
        graphic=union_bbox(visuals)
        members={caption}
        # A wrapped caption normally shares its PDF text block. Limit its span
        # and stop before another caption to avoid absorbing adjacent prose.
        last=caption
        for i in range(caption+1,min(len(lines),caption+4)):
            if i in captions or lines[i]['_block']!=lines[caption]['_block']:break
            if boxes[i][1]<boxes[last][3]-3 or boxes[i][1]-boxes[last][3]>6:break
            if _overlap_x(boxes[i],boxes[caption])<.3:break
            members.add(i);last=i
        for i,box in enumerate(boxes):
            if _inside(box,graphic):members.add(i)
        focus=union_bbox([graphic]+[boxes[i] for i in members])
        identity=_figure_id(captions[caption])
        # Nearby references can occur above or below the figure. Reuse one
        # region for the caption/reference words instead of moving per word.
        for i,line in enumerate(lines):
            if i in members:continue
            if not any(_figure_id(m)==identity for m in FIGURE_REFERENCE.finditer(line['text'])):continue
            box=boxes[i]
            gap=max(0,box[1]-focus[3],focus[1]-box[3])
            combined=union_bbox([focus,box])
            if gap<=90 and _overlap_x(box,graphic)>=.2 and combined[3]-combined[1]<=page.rect.height*.8:
                members.add(i);focus=combined
        focus=_page_box(focus,page)
        if focus:contexts.append((focus,members))
    # Text inside an uncaptioned diagram still benefits from complete geometry.
    for graphic in graphics:
        if any(_inside(graphic,union_bbox(visuals)) for visuals in paired.values()):continue
        members={i for i,box in enumerate(boxes) if _inside(box,graphic)}
        if members:
            focus=_page_box(union_bbox([graphic]+[boxes[i] for i in members]),page)
            if focus:contexts.append((focus,members))
    for focus,members in contexts:
        for i in members:
            for word in lines[i]['words']:
                box=word['bbox']
                if box[0]<0 or box[1]<0 or box[2]>page.rect.width or box[3]>page.rect.height:continue
                # A reference to multiple figures uses the smaller nearby one;
                # avoid merging the whole page into a single scroll target.
                old=word.get('focusBBox')
                if old is None or (focus[2]-focus[0])*(focus[3]-focus[1])<(old[2]-old[0])*(old[3]-old[1]):
                    word['focusBBox']=focus.copy()

def pdf_lines(doc):
    pages=[]
    margins={}
    for index,page in enumerate(doc):
        lines=[]
        for block_index,block in enumerate(page.get_text('rawdict', sort=True)['blocks']):
            for line in block.get('lines', []):
                text,words=line_words(line,page,index)
                if not text: continue
                x,y,x2,y2=line['bbox']
                record={'text':text,'x':x,'y':y,'y2':y2,'height':page.rect.height,'page':index+1,'words':words,'_block':block_index,
                          'size':citations.body_size(line)}
                lines.append(record)
                if y2<page.rect.height*.12 or y>page.rect.height*.88:
                    margins.setdefault(key(text),set()).add(index)
        pages.append(lines)
    repeated={t for t,indices in margins.items() if len(indices)>=max(3,math.ceil(len(doc)*.25))}
    result=[]
    for lines in pages:
        # A page number and its companion running title share a baseline.
        number_bands=[(l['y']-3,l['y2']+3) for l in lines
                      if (l['y']>l['height']*.88 or l['y2']<l['height']*.08)
                      and re.fullmatch(r'(?:Page\s+)?(?:\d+|[ivxlcdm]+)(?:\s*(?:of|/)\s*\d+)?',l['text'],re.I)]
        kept=[]
        for l in lines:
            in_margin=l['y2']<l['height']*.12 or l['y']>l['height']*.88
            if in_margin and (key(l['text']) in repeated or any(lo<=l['y']<=hi for lo,hi in number_bands)):
                continue
            kept.append(l)
        result.append(citations.resolve_raised(kept))
    for index,lines in enumerate(result):add_figure_context(doc[index],lines)
    return result

CITATION_REFERENCE=re.compile(
    r'\[\s*\d+(?:\s*[-‐‑‒–—]\s*\d+)?'
    r'(?:\s*[,;]\s*\d+(?:\s*[-‐‑‒–—]\s*\d+)?)*\s*\]')

def strip_citations(text):
    """Remove numeric bracket citations ([16], [126, 127], [20-22, 24-26], [8; 9])
    from the text that gets spoken/chunked. Brackets with letters ([2022 Edition],
    [see 4], [a]) are left untouched. Never fuses two non-space characters together
    (pre[1]fix -> 'pre fix', not 'prefix')."""
    out=[];cursor=0
    for m in CITATION_REFERENCE.finditer(text):
        start,end=m.start(),m.end()
        before=text[start-1] if start>0 else ''
        after=text[end] if end<len(text) else ''
        if before.isspace():  # any whitespace, not just ' ' -- join_lines can place '\n' here too
            prior=text[start-2] if start>=2 else ''
            if prior and not prior.isspace() and after and not after.isspace():
                out.append(text[cursor:start])  # keep the one existing separator
            else:
                out.append(text[cursor:start-1])  # safe to also swallow the redundant one
        else:
            out.append(text[cursor:start])
            if before and not before.isspace() and after and not after.isspace():
                out.append(' ')  # glued on both sides: split instead of fusing
        cursor=end
    out.append(text[cursor:])
    return ''.join(out)

def chunks_for(text,page,words=None):
    # Sentence boundaries preserve wording; hard splits only for very long sentences.
    # The spoken/cut text has citations removed; word lookup below still walks the
    # untouched source text, so a removed token simply gets no mapping.
    spoken=strip_citations(text)
    if words is not None:words=citations.mark_words(text,words)
    sentences=re.split(r'(?<=[.!?])\s+(?=[A-Z0-9•])|\n+',spoken)
    pending=''
    out=[]
    for sentence in sentences:
        sentence=sentence.strip(' •')
        if not sentence: continue
        pieces=[]
        while len(sentence)>500:
            cut=sentence.rfind(' ',0,500)
            if cut<1:cut=500
            pieces.append(sentence[:cut]);sentence=sentence[cut:].lstrip()
        pieces.append(sentence)
        for piece in pieces:
            if pending and len(pending)+1+len(piece)>500:
                out.append({'text':pending,'page':page});pending=''
            pending=(pending+' '+piece).strip()
    if pending:out.append({'text':pending,'page':page})
    if words is not None:
        # Chunking removes bullet markers and joins sentence boundaries. Locate
        # each retained token in order, keeping exact chunk-relative offsets.
        starts=[w['start'] for w in words]
        cursor=0
        for chunk in out:
            mapped=[]
            for token in re.finditer(r'\S+',chunk['text']):
                pos=text.find(token.group(),cursor)
                if pos<0:raise ValueError('Wortposition im PDF konnte nicht zugeordnet werden.')
                end=pos+len(token.group())
                wi=max(0,bisect_right(starts,pos)-1)
                source=[]
                while wi<len(words) and words[wi]['start']<end:
                    if words[wi]['end']>pos:source.append(words[wi])
                    wi+=1
                if not source:raise ValueError('PDF-Wort hat keine Position.')
                mapped_word={**{k:v for k,v in source[0].items() if k not in ('mute','silent')},
                             'text':token.group(),'start':token.start(),
                             'end':token.end(),'bbox':union_bbox([w['bbox'] for w in source])}
                muted=[[max(a,pos)-pos,min(b,end)-pos] for w in source for a,b in citations.word_intervals(w) if a<end and b>pos]
                if muted:mapped_word=citations.set_mute(mapped_word,muted)
                focuses=[w['focusBBox'] for w in source if 'focusBBox' in w]
                if focuses:mapped_word['focusBBox']=union_bbox([mapped_word['bbox']]+focuses)
                mapped.append(mapped_word)
                cursor=end
            chunk['words']=mapped
        out=citations.merge_mark_only(out)
    return out

def document_path(url):
    parsed=urlsplit(url)
    if parsed.scheme=='file':return Path(unquote(parsed.path))
    if parsed.scheme not in ('http','https'):raise ValueError('Dieser Dokumenttyp wird noch nicht unterstützt.')
    cache=Path.home()/'.cache/brave-reader'
    cache.mkdir(parents=True,exist_ok=True,mode=0o700)
    path=cache/(hashlib.sha256(urldefrag(url)[0].encode()).hexdigest()+'.pdf')
    if not path.exists():
        req=Request(urldefrag(url)[0],headers={'User-Agent':'Brave local document reader'})
        with urlopen(req,timeout=30) as response:
            data=response.read(100*1024*1024+1)
        if len(data)>100*1024*1024:raise ValueError('PDF ist größer als 100 MB.')
        if not data.startswith(b'%PDF'):raise ValueError('PDF nicht öffentlich abrufbar. Bitte lokal speichern und öffnen.')
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as f:f.write(data)
    return path

def pdf_document_path(state):
    """Accept a privately cached viewer PDF, never an arbitrary supplied path."""
    if not state.get('pdfPath'):return document_path(state['url'])
    supplied=state['pdfPath']
    if not isinstance(supplied,str):raise ValueError('Ungültiger privater PDF-Cachepfad.')
    cache=(Path.home()/'.cache/brave-reader').resolve()
    try:
        path=Path(supplied).expanduser().resolve(strict=True)
        if path.parent!=cache or not re.fullmatch(r'[0-9a-f]{64}\.pdf',path.name) or not path.is_file():
            raise ValueError('Ungültiger privater PDF-Cachepfad.')
        if path.stat().st_size>100*1024*1024:raise ValueError('PDF ist größer als 100 MB.')
        with path.open('rb') as source:
            if source.read(5)!=b'%PDF-':raise ValueError('Im privaten PDF-Cache liegt keine gültige PDF.')
    except (OSError,RuntimeError) as exc:
        raise ValueError('Die private PDF-Datei ist nicht verfügbar.') from exc
    return path

def pdf_language_hint(doc):
    """The PDF's own language declaration (/Lang in the catalog, else XMP dc:language), or None."""
    try:
        kind, value = doc.xref_get_key(doc.pdf_catalog(), 'Lang')
        match = re.match(r'^\(?([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)\)?$', (value or '').strip()) if kind in ('string', 'name') else None
        if match:
            return match.group(1)
        xml = doc.get_xml_metadata() or ''
        match = re.search(r'<dc:language>.*?<rdf:li[^>]*>\s*([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)\s*</rdf:li>', xml, re.S)
        return match.group(1) if match else None
    except Exception:
        return None

def extract_pdf(state):
    import pymupdf
    with pymupdf.open(pdf_document_path(state)) as doc:
        pages=pdf_lines(doc)
        corpus=build_hyphen_corpus(pages)
        visible=sorted(state['visible'],key=lambda x:x['index'])
        if not visible:raise ValueError('PDF-Leseposition nicht erkennbar.')
        selection=clean(state.get('selection',''))
        start_page=None
        first_text=None
        first_words=None
        if selection:
            # Search nearby pages first, so repeated words choose the visible occurrence.
            nearby=[v['index'] for v in visible]
            nearby+=sorted(set(range(max(0,state['page']-1),min(len(doc),state['page']+3)))-set(nearby))
            for index in nearby:
                text,words=join_lines(pages[index],corpus)
                pos=text.find(selection)
                if pos>=0:
                    start_page=index;first_text=text[pos:];first_words=slice_words(words,pos);break
            if start_page is None:
                raise ValueError('Markierung nicht eindeutig im Text gefunden. Bitte ein Wort in einer Textzeile markieren.')
        else:
            for v in visible:
                index=v['index']
                threshold=max(0,-v['top']/v['height'])*doc[index].rect.height
                lines=[l for l in pages[index] if l['y2']>=threshold+1]
                if lines:
                    start_page=index;first_text,first_words=join_lines(lines,corpus);break
        if start_page is None:raise ValueError('Hier wurde kein lesbarer Text gefunden. Scans benötigen Texterkennung.')
        chunks=[]
        navigation_chunks=[]
        for index in range(len(doc)):
            text,words=join_lines(pages[index],corpus)
            page_chunks=chunks_for(text,index+1,words)
            navigation_chunks.extend(page_chunks)
            # Share complete-page chunks rather than retaining duplicate word
            # dictionaries. Only the truncated starting page needs a separate
            # text/offset mapping for the current selection or visible line.
            if index>start_page or (index==start_page and text==first_text):
                chunks.extend(page_chunks)
            elif index==start_page:
                chunks.extend(chunks_for(first_text,index+1,first_words))
        from chapters import pdf_chapters
        chapters,anchors=pdf_chapters(doc,navigation_chunks)
        return {'chapters':chapters,'_chapterAnchors':anchors,'title':state['title'],'chunks':chunks,'navigationChunks':navigation_chunks,
                'context':state.get('context'),'langHint':pdf_language_hint(doc),
                'startDescription':('Ab markiertem Text' if selection else 'Ab erster sichtbarer Textzeile')+f' · PDF-Seite {start_page+1}'}

def html_mark_ranges(raw,text,cites):
    """Citation ranges of one HTML block in the coordinates of its cleaned text.

    ``cites`` come from the DOM (capture.mjs, relative to the raw innerText);
    Unicode-superscript footnote digits are found in the raw text before NFKC
    turns them into ordinary digits.  A range that no longer matches is dropped.
    """
    if not isinstance(raw,str):return []
    def place(i):return len(unicodedata.normalize('NFKC',raw[:i]).replace('\u00ad',''))
    out=[]
    for pair in [*(cites if isinstance(cites,list) else []),*citations.superscript_runs(raw)]:
        if not (isinstance(pair,list) and len(pair)==2 and all(type(v) is int for v in pair) and 0<=pair[0]<pair[1]<=len(raw)):continue
        a,b=place(pair[0]),place(pair[1])
        if a<b<=len(text) and text[a:b]==unicodedata.normalize('NFKC',raw[pair[0]:pair[1]]).replace('\u00ad',''):out.append([a,b])
    return out

def extract_html(state):
    blocks=state['blocks']
    selection=clean(state.get('selection',''))
    selection_ends=[m.end() for m in re.finditer(r'\S+',selection)]
    start=None;first=None;selection_matched=False
    for i,b in enumerate(blocks):
        text=clean(b['text'])
        if selection:
            pos=text.find(selection)
            if pos<0:
                # A browser selection may cross paragraph boundaries. Anchor
                # to its longest prefix that exists in this block, then read
                # the rest of that block and continue in document order.
                for end in reversed(selection_ends):
                    pos=text.find(selection[:end])
                    if pos>=0:break
            if pos<0:continue
            selection_matched=True
            start=i;first=text[pos:];break
        elif b['bottom']>1:
            start=i;first=text;break
    if start is None:raise ValueError('Kein lesbarer Text an dieser Stelle gefunden.')
    chunks=[];navigation_chunks=[]
    for i,b in enumerate(blocks):
        text=clean(b['text'])
        matches=list(re.finditer(r'\S+',text))
        boxes=b.get('wordBoxes',[]);box_cursor=0
        words=[]
        for j,m in enumerate(matches):
            box=None
            for k in range(box_cursor,min(len(boxes),box_cursor+8)):
                candidate=boxes[k]
                if isinstance(candidate,dict) and candidate.get('text')==m.group():
                    box=candidate.get('bbox');box_cursor=k+1;break
            valid=(isinstance(box,list) and len(box)==4 and
                   all(type(v) in (int,float) and math.isfinite(v) for v in box) and
                   box[0]<box[2] and box[1]<box[3] and box[0]>=-1 and box[1]>=-1 and
                   box[2]<=b.get('width',0)+1 and box[3]<=b.get('height',0)+1)
            if valid:
                bbox=[max(0,box[0]),max(0,box[1]),min(b['width'],box[2]),min(b['height'],box[3])]
            else:
                # Keep audio offsets complete when a site renders a token across
                # unusual inline nodes. The sentinel is excluded from geometry UI.
                bbox=[0,0,min(.1,b.get('width',1)),min(.1,b.get('height',1))]
            words.append({'text':m.group(),'start':m.start(),'end':m.end(),'page':i+1,
                'bbox':bbox,'pageWidth':max(1,b.get('width',1)),'pageHeight':max(1,b.get('height',1)),
                'geometryValid':bool(valid)})
        words=citations.mute_words(words,html_mark_ranges(b['text'],text,b.get('cites')))
        page_chunks=chunks_for(text,i+1,words)
        navigation_chunks.extend(page_chunks)
        if i<start:continue
        if i==start and first!=text:
            # Selection starts inside this block. Keep source geometry but
            # shift offsets to the selected suffix for accurate word focus.
            offset=text.find(first)
            selected_words=slice_words(words,offset) if offset>=0 else words
            chunks.extend(chunks_for(first,i+1,selected_words))
        else:chunks.extend(page_chunks)
    if not chunks:raise ValueError('An dieser Stelle ist kein vorlesbarer Text mehr vorhanden.')
    lang=state.get('lang')
    from chapters import html_chapters
    chapters,anchors=html_chapters(blocks,navigation_chunks)
    return {'chapters':chapters,'_chapterAnchors':anchors,'title':state['title'],'chunks':chunks,'navigationChunks':navigation_chunks,'context':state.get('context'),
            'langHint':lang if isinstance(lang,str) and len(lang)<=35 else None,
            'startDescription':'Ab markierter Textstelle' if selection_matched else 'Ab sichtbarem Absatz'}

def capture_and_extract(*, visible=False):
    p=subprocess.run(['node',str(ROOT/'capture.mjs')],capture_output=True,text=True,timeout=90)
    if p.returncode:raise ValueError(p.stderr.strip() or 'Brave konnte nicht erreicht werden.')
    state=json.loads(p.stdout)
    if visible:state['selection']=''
    result=extract_pdf(state) if state['kind']=='pdf' else extract_html(state)
    if not result['chunks']:raise ValueError('An dieser Stelle ist kein Text mehr vorhanden.')
    return result

if __name__=='__main__':
    r=capture_and_extract()
    print(json.dumps({'title':r['title'],'startDescription':r['startDescription'],'chunks':len(r['chunks']),'first':r['chunks'][0]},ensure_ascii=False))
