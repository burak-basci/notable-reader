// The same DOM selector is used by capture and the inline controls, so word
// offsets and rectangles always refer to identical source blocks.
export function collectHtmlBlocks({metadataOnly=false,cites=false}={}) {
  const roots=[...document.querySelectorAll('main,[role="main"],article')];
  const excluded='header,footer,nav,aside,[role="navigation"],[aria-hidden="true"],[hidden],dialog,button,[role="button"],input,select,textarea';
  const visible=e=>{
    if(e.closest(excluded))return false;
    const r=e.getBoundingClientRect(),s=getComputedStyle(e);
    return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';
  };
  // Background readiness is a structural heuristic using node lengths only.
  // Exact word ranking stays in explicit capture; no text or selection is
  // read into strings or returned by background discovery.
  if(metadataOnly){
    if(!document.body)return {ready:false};
    const length=e=>{let total=0;const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode;if(!n.parentElement.closest(excluded)&&visible(n.parentElement))total+=n.length;}return total;};
    const usable=e=>{if(!visible(e))return false;const count=length(e);if(!count)return false;const links=[...e.querySelectorAll('a')].reduce((n,a)=>n+length(a),0);return links/count<.7;};
    const scopes=roots.filter(visible);if(!scopes.length)scopes.push(document.body);
    const ready=scopes.some(root=>[...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,figcaption,dt,dd,summary')].some(e=>usable(e)&&!e.parentElement.closest('p,li,pre,blockquote'))||[...root.querySelectorAll('div,section,span')].some(e=>usable(e)&&length(e)>=30&&!e.querySelector('p,li,pre,blockquote,figcaption,dt,dd,summary')));
    return {ready};
  }
  const text=e=>(e.innerText||e.textContent||'').replace(/\s+/gu,' ').trim();
  const words=s=>(s.match(/\S+/gu)||[]).length;
  const selector='h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,figcaption,dt,dd,summary';
  const semanticBlocks=root=>[...root.querySelectorAll(selector)]
    .filter(e=>visible(e)&&!e.parentElement.closest('p,li,pre,blockquote'));
  const semanticWords=root=>semanticBlocks(root).reduce((n,e)=>n+words(text(e)),0);
  const ranked=roots.filter(visible).map(root=>({root,semantic:semanticWords(root),text:words(text(root))}));
  const bestSemantic=ranked.filter(item=>item.semantic>=25).sort((a,b)=>b.semantic-a.semantic)[0];
  const root=bestSemantic?.root||
    ranked.sort((a,b)=>b.text-a.text)[0]?.root||document.body;
  const base=semanticBlocks(root);
  let nodes=base;
  if(base.reduce((n,e)=>n+words(text(e)),0)<25){
    const candidates=[...root.querySelectorAll('div,section')].filter(e=>visible(e)&&words(text(e))>=6&&!e.querySelector('p,li,pre,blockquote,figcaption,dt,dd,summary'));
    const fallback=candidates.filter(e=>![...e.querySelectorAll('div,section')].some(child=>
      visible(child)&&words(text(child))>=6&&!child.querySelector('p,li,pre,blockquote,figcaption,dt,dd,summary')));
    if(fallback.length)nodes=fallback;
    else if(!nodes.length)nodes=[...root.querySelectorAll('span')].filter(e=>visible(e)&&words(text(e))>=8&&!e.querySelector('span'));
  }
  nodes=nodes.filter(e=>{
    const value=text(e),count=words(value),links=[...e.querySelectorAll('a')].reduce((n,a)=>n+words(text(a)),0);
    return count>0&&links/count<.7;
  });
  // Citation / footnote marks (A1, [12], sup.reference, doc-noteref, back arrows) stay in
  // the text and in the word offsets; only their [start,end) ranges in text(e) are
  // reported, so the speech layer can skip them without moving a single word.
  // Must stay self-contained: this function is serialised into the page.
  const citeRanges=!cites?()=>[]:(()=>{
    const MARK=/^(?:[\[(]\s*)?(?:[A-Za-z]{1,2}\d{1,4}[a-z]?|\d{1,4}[a-z]?|[a-z]|[*†‡§¶‖#]{1,3})(?:\s*[-‐‑‒–—,;]\s*(?:[A-Za-z]{1,2}\d{1,4}[a-z]?|\d{1,4}[a-z]?))*(?:\s*[\])])?$/u;
    const BACK=/^[\s^↩↵↑⤴⏎︎️]+\d{0,3}$/u;
    const CLASS=/^(?:ref|refs|fnref|noteref|note-ref|footnote-ref|footnote-backref|data-footnote-backref|cite-ref|citeref|cite_ref|reference|mw-cite-backlink|biblioref|backref|backlink|footnote-link|cite|citation)$|footnote|noteref|backref|cite[-_]ref/;
    const NOTES='[role~="doc-endnotes"],[role~="doc-footnotes"],[role~="doc-bibliography"],[role~="doc-endnote"],[role~="doc-footnote"],.footnotes,.references,.reflist,.endnotes,.sources,.bibliography,[id*="footnote" i],[id*="endnote" i],[id*="references" i],[id*="quellen" i],[id*="sources" i],[id*="bibliograph" i],[id*="anmerkung" i]';
    const norm=t=>(t||'').replace(/\s+/gu,' ').trim();
    const strong=el=>{
      if((el.getAttribute('role')||'').split(/\s+/).some(r=>/^doc-(noteref|biblioref|backlink)$/.test(r)))return true;
      if(el.hasAttribute('data-footnote-ref')||el.hasAttribute('data-footnote-backref'))return true;
      return [...el.classList].some(c=>CLASS.test(c.toLowerCase()));
    };
    const target=a=>{
      const h=a.getAttribute('href')||'';if(h.length<2||h[0]!=='#')return null;
      try{return document.getElementById(decodeURIComponent(h.slice(1)));}catch{return null;}
    };
    let hasNotes=null;
    const notesOnPage=()=>hasNotes??=!!document.querySelector(NOTES);
    const linkIsCite=(a,t)=>{
      if(BACK.test(t))return strong(a)||!!a.closest('li,[role~="doc-endnote"],[role~="doc-footnote"]')&&!!target(a);
      if(t.length>16||!/\S/.test(t))return false;
      const par=a.parentElement;
      if(strong(a)||par&&/^(?:SUP|SPAN)$/.test(par.tagName)&&strong(par))return true;
      if(!MARK.test(t))return false;
      const to=target(a);if(!to)return false;
      if(a.parentElement?.tagName==='SUP')return true;
      if(to.closest(NOTES))return true;
      if(/^(?:fn|fnref|cite|ref|note|footnote|bib|endnote|source|q-)/i.test(to.id))return true;
      const label=norm(to.textContent);return label.startsWith(t.replace(/^[\[(]|[\])]$/g,''))&&label.length>t.length;
    };
    const supIsCite=(sup,t,node)=>{
      if(strong(sup))return t.length<=16;
      if(!/^(?:\d{1,3}|[*†‡§¶‖#]{1,3})$/.test(t)||!notesOnPage())return false;
      if(sup.closest('math,.katex,.MathJax,var,svg,sub'))return false;
      const before=document.createRange();before.setStart(node,0);before.setEndBefore(sup);
      const prior=before.toString().replace(/\s+$/,'');
      if(/[.,;:!?)\]"”’»]$/.test(prior))return true;
      const word=(prior.match(/[\p{L}]+$/u)||[''])[0];
      return word.length>=3&&!/^(?:min|mol|bar|sec|rad|ppm|dpi|psi|kwh|mwh)$/i.test(word);
    };
    return (node,value)=>{
      const found=[];
      for(const el of node.querySelectorAll('a,sup,span,[data-footnote-ref],[data-footnote-backref],cite,i,b,em,strong')){
        if(found.some(f=>f.contains(el)))continue;
        const t=norm(el.innerText||el.textContent);if(!t||t.length>24)continue;
        const tag=el.tagName;let hit=false;
        if(tag==='A')hit=linkIsCite(el,t);
        else if(tag==='SUP')hit=!!el.querySelector('a')?[...el.querySelectorAll('a')].some(a=>linkIsCite(a,norm(a.innerText||a.textContent))):supIsCite(el,t,node);
        else if(strong(el)&&!el.querySelector('a:not([href^="#"])'))hit=MARK.test(t)||BACK.test(t)||t.length<=24&&[...el.classList].some(c=>/^(?:ref|cite-ref|citeref)$/i.test(c));
        if(hit)found.push(el);
      }
      // A leading "A1 " / "1 " label of a list item that citation links point to.
      const lead=node.firstElementChild;
      if(lead&&node.id&&!found.includes(lead)&&!found.some(f=>f.contains(lead))){
        const t=norm(lead.innerText||lead.textContent);
        if(MARK.test(t)&&t.length<=8&&node.id.toLowerCase().includes(t.toLowerCase().replace(/^[\[(]|[\])]$/g,'')))found.push(lead);
      }
      const out=[];let cursor=0;
      for(const el of found.sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1)){
        const t=norm(el.innerText||el.textContent);
        const r=document.createRange();r.setStart(node,0);r.setEndBefore(el);
        const guess=r.toString().replace(/\s+/gu,' ').replace(/^\s+/,'').length;
        let at=value.startsWith(t,guess)&&guess>=cursor?guess:-1;
        if(at<0){ // innerText and Range text may drift (hidden nodes, br): nearest verified match
          for(let d=1;d<=240&&at<0;d++){
            for(const c of [guess-d,guess+d])if(c>=cursor&&c>=0&&value.startsWith(t,c)){at=c;break;}
          }
        }
        if(at<0)continue;
        let end=at+t.length,begin=at;
        const open=value[begin-1],close=value[end];
        if((open==='['&&close===']')||(open==='('&&close===')')){begin--;end++;}
        out.push([begin,end]);cursor=end;
      }
      return out;
    };
  })();
  const blocks=nodes.map(e=>{const r=e.getBoundingClientRect(),value=text(e),block={text:value,top:r.top,bottom:r.bottom,width:r.width,height:r.height};if(cites){const marks=citeRanges(e,value);if(marks.length)block.cites=marks;}return block;});
  // Metadata never changes the selected blocks: geometry/bookmarks retain their
  // original indices even on div-only pages with headings outside those blocks.
  for(const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6')){
    if(!visible(heading))continue;
    const title=text(heading);if(!title)continue;
    let index=nodes.findIndex(node=>node===heading||node.contains(heading)),charStart=0;
    if(index>=0&&nodes[index]!==heading){
      const range=document.createRange();range.setStart(nodes[index],0);range.setEndBefore(heading);
      const guess=range.toString().replace(/\s+/gu,' ').replace(/^\s+/,'').length;
      const source=blocks[index].text;let nearest=-1,distance=Infinity;
      for(let at=source.indexOf(title);at>=0;at=source.indexOf(title,at+1))if(Math.abs(at-guess)<distance){nearest=at;distance=Math.abs(at-guess);}
      if(nearest<0)continue;charStart=nearest;
    }else if(index<0){
      index=nodes.findIndex(node=>Boolean(heading.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING));
      if(index<0)continue;
    }
    const level=Number(heading.tagName[1]);
    (blocks[index].headings??=[]).push({label:Array.from(title).slice(0,160).join(''),level,charStart});
    if(nodes[index]===heading)blocks[index].headingLevel=level;
  }
  return {root,nodes,blocks};
}

// claude.ai renders artifacts inside one cross-origin sandbox iframe; the visible
// article text lives only there. Returns that frame target (exactly one) or null.
export function artifactFrame(page,targets) {
  try {
    const u=new URL(page.url);
    if(u.protocol!=='https:'||u.hostname!=='claude.ai'||!/^\/(code\/)?artifact\//.test(u.pathname))return null;
  } catch {return null;}
  const frames=targets.filter(t=>t.type==='iframe'&&t.parentId===page.id&&t.webSocketDebuggerUrl&&(()=>{try{const f=new URL(t.url);return f.protocol==='https:'&&f.hostname.endsWith('.claudeusercontent.com');}catch{return false;}})());
  return frames.length===1?frames[0]:null;
}

// Language hint of what is actually read: the lang attribute that covers most of the
// selected blocks (an embedded foreign-language article wins over the page's own lang),
// else the document's.  Only a short code such as "de-DE" is returned, never text.
export function documentLanguage(collected) {
  const tally=new Map();
  for(const node of collected?.nodes||[]){
    const lang=String(node.closest?.('[lang]')?.getAttribute('lang')||'').trim();
    if(lang)tally.set(lang,(tally.get(lang)||0)+(node.textContent||'').length);
  }
  const best=[...tally.entries()].sort((a,b)=>b[1]-a[1])[0];
  const value=best?.[0]||document.documentElement.lang||'';
  const code=String(value).trim().slice(0,35);
  return /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{1,8})*$/.test(code)?code:'';
}
