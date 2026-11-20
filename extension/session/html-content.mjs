import {detectTextLanguage} from '../explain/tutor-plan.mjs';
// The same DOM selector is used by capture and the inline controls, so word
// offsets and rectangles always refer to identical source blocks.
export function collectHtmlBlocks({metadataOnly=false,cites=false,reading={}}={}) {
  // Traverse the rendered open-shadow/slot tree. Source nodes and block geometry stay native.
  const parents=new WeakMap(),order=new WeakMap(),elements=[];let sequence=0;
  const children=node=>node.nodeType===1&&node.localName==='slot'?(node.assignedNodes({flatten:true}).length?node.assignedNodes({flatten:true}):[...node.childNodes]):[...(node.shadowRoot||node).childNodes];
  // Elements are pushed in tree order, so the descendants of an element form one contiguous run of `elements`.
  // A query then scans only that run instead of every element of the page for every block.
  const runs=new WeakMap();let revisited=false;
  const index=(node,parent)=>{
    if(parent)parents.set(node,parent);if(order.has(node))revisited=true;order.set(node,sequence++);
    const at=elements.length;if(node.nodeType===1)elements.push(node);
    for(const child of children(node))index(child,node.nodeType===9?null:node);
    if(node.nodeType===1)runs.set(node,[at+1,elements.length]);
  };index(document,null);
  const parent=node=>node?(parents.get(node)||node.parentElement||node.getRootNode?.().host||null):null;
  const closest=(node,selector)=>{for(let e=node?.nodeType===1?node:parent(node);e;e=parent(e))if(e.matches?.(selector))return e;return null;};
  const contains=(root,node)=>{for(let e=node;e;e=parent(e))if(e===root)return true;return false;};
  const query=(root,selector)=>{
    const run=!revisited&&runs.get(root);   // a node reached twice (nested slots) breaks the run property: full scan
    if(!run)return elements.filter(e=>e!==root&&contains(root,e)&&e.matches(selector));
    const out=[];for(let i=run[0];i<run[1];i++)if(elements[i].matches(selector))out.push(elements[i]);return out;
  };
  const roots=elements.filter(e=>e.matches('main,[role="main"],article'));
  // Explicit semantic regions only; no text-pattern deletion. Keep the function
  // self-contained because capture/frame discovery serializes this same source.
  const semantic={header:'header,[role="banner"]',footer:'footer,[role="contentinfo"]',caption:'figcaption,caption,[role="caption"]',table:'table,[role="table"]',quote:'blockquote,q',footnote:'[role~="doc-footnote"],[role~="doc-endnote"],[role~="doc-footnotes"],[role~="doc-endnotes"],.footnotes,.endnotes'};
  const excluded=[reading.skipCode?'pre':'',reading.skipMath?'math,.katex,.MathJax,[role="math"]':'',reading.skipLinks?'a[href]':'',reading.skipHeaders!==false?semantic.header:'',reading.skipFooters!==false?semantic.footer:'',reading.skipCaptions?semantic.caption:'',reading.skipTables?semantic.table:'',reading.skipQuotes?semantic.quote:'',reading.skipFootnotes?semantic.footnote:'','nav,aside,[role="navigation"],[role="menu"],[role="menubar"],[aria-hidden="true"],[hidden],[inert],dialog,video,audio,[class~="mediaplayer"],[class~="player"],[class~="ardplayer"],.video-js,.jwplayer,.plyr,button,[role="button"],input,select,textarea,form,[role="textbox"],[contenteditable]:not([contenteditable="false"]),script,style,noscript,template,svg,canvas,annotation,annotation-xml,.mw-editsection,.mw-redirectedfrom,#contentSub,#contentSub2,#siteSub,.hatnote,.shortdescription,.navbox,.vertical-navbox,.ambox,.infobox,.magnify,.mw-jump-link,[data-notable-reader-ui],[data-notable-reader-surface],[data-notable-appearance],[data-notable-quick-actions],[data-reader-explain-panel],#brave-reader-inline,#brave-reader-inline-html'].filter(Boolean).join(',');
  const visibility=new WeakMap();
  // Geometry is not text eligibility: content-visibility:auto can skip layout
  // for loaded offscreen turns. Never force layout or alter the page's styles.
  const visible=e=>{
    if(!e)return false;
    if(visibility.has(e))return visibility.get(e);
    let value=!e.matches(excluded);
    if(value){
      const s=getComputedStyle(e);
      // opacity 0 alone is how scroll-reveal scripts park text until it is scrolled to; it stays readable.
      // Only an invisible element that also ignores the pointer (closed menus, tooltips) counts as hidden.
      const transparent=s.opacity==='0'&&s.pointerEvents==='none';
      // Screen-reader-only text (the "visually-hidden" / "sr-only" pattern: absolutely positioned, clipped to 1px) is a label for assistive
      // technology ("Player: video", "opens in a new window"), not page text a listener sees: reading it aloud starts an article with noise.
      // Decided from the computed style only (no layout), so content-visibility:auto text stays eligible.
      const srOnly=(s.position==='absolute'||s.position==='fixed')&&(/^rect\(\s*(0|1)px[ ,]+(0|1)px[ ,]+(0|1)px[ ,]+(0|1)px\s*\)$/.test(s.clip)||/^inset\((50|100)%\)$/.test(s.clipPath)||s.width==='1px'&&s.height==='1px'&&s.overflow==='hidden');
      value=s.display!=='none'&&s.visibility!=='hidden'&&s.visibility!=='collapse'&&!transparent
        &&s.contentVisibility!=='hidden'&&!srOnly
        // A floated table is a side box (Wikipedia infobox "Basisdaten", fact boxes): reading it first ("Logo. Map. Basic data. State: ...") buries
        // the article start. Tables in the text flow (data tables) stay; "skip tables" in the reading rules still removes those too.
        &&!(e.tagName==='TABLE'&&(s.float==='left'||s.float==='right'));
      if(value&&parent(e))value=visible(parent(e));
      const folded=closest(parent(e),'details:not([open])');
      if(value&&folded&&!folded.querySelector(':scope > summary')?.contains(e))value=false;
    }
    visibility.set(e,value);return value;
  };
  const sourceNodes=new WeakMap();
  const textNodesFor=e=>{
    if(sourceNodes.has(e))return sourceNodes.get(e);
    const nodes=[];const walk=node=>{if(node.nodeType===Node.TEXT_NODE){if(visible(parent(node)))nodes.push(node);return;}for(const child of children(node))walk(child);};walk(e);
    sourceNodes.set(e,nodes);return nodes;
  };
  // Background discovery reads lengths only; it never turns page prose into
  // strings. A short loaded answer is as eligible as a long article.
  if(metadataOnly){
    const scopes=roots.filter(visible);if(!scopes.length&&document.body)scopes.push(document.body);
    const chars=Math.max(0,...scopes.map(root=>textNodesFor(root).reduce((n,node)=>n+(/\S/u.test(node.data)?node.length:0),0)));return {ready:chars>0,chars};
  }
  const texts=new WeakMap();
  const blockTags=new Set(['ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','CAPTION','DD','DIV','DL','DT','FIGCAPTION','FIGURE','H1','H2','H3','H4','H5','H6','LEGEND','LI','MAIN','OL','P','PRE','SECTION','SUMMARY','TABLE','TD','TH','TR','UL']);
  const mathTokens=new Set(['mi','mo','mn','mtext','ms']);
  /* Siblings that touch in the DOM and are separated only by layout read as one word: "Woodlandand" (BBC byline: <span>Dan Woodland</span><span>and</span>, the gap is a
     4px margin) or flex/grid items such as <span>…</span><span>…</span>. A box that is not inline (flex/grid item, table cell...) or an inline element with a real side margin
     (>= 2px) is a word boundary on that side. Whitespace only: no non-space character moves, so word offsets are unchanged. Not for floats / out-of-flow boxes (a drop cap
     "T" + "he text" stays one word) and not inside formulas. */
  const BOX=/^(?:block|flex|grid|list-item|table|table-row|table-cell|table-caption|flow-root)$/;
  const gapsOf=el=>{
    if(blockTags.has(el.tagName)||el.localName==='math'||el.closest?.('math,.katex,.MathJax'))return null;
    const s=getComputedStyle(el);
    if(s.float!=='none'||!(s.position==='static'||s.position==='relative'||s.position==='sticky'))return null;
    if(BOX.test(s.display))return {before:true,after:true};
    if(s.display!=='inline'||el.localName!=='span'&&el.localName!=='time')return null;   // only generic wrappers: <code>x</code>, <a>, <em> keep punctuation attached
    const before=parseFloat(s.marginLeft)>=2,after=parseFloat(s.marginRight)>=2;
    return before||after?{before,after}:null;
  };
  const text=e=>{
    if(texts.has(e))return texts.get(e);
    const parts=[];
    /* Code (pre): line ends survive as NL so a code block can be kept whole and cut at line ends; everywhere else whitespace collapses as before.
       NL stands for whitespace only (the range mapper counts non-space characters), so offsets of words are unchanged. */
    const NL='\uE000',NP='\uE001';      // NP: a blank line inside one text node of code (kept as a paragraph break so the chunker can cut at a new function/block)
    const visit=(node,code)=>{
      if(node.nodeType===Node.TEXT_NODE){if(visible(parent(node)))parts.push(code?node.data.replace(/(?:\r\n?|\n)(?:[ \t]*(?:\r\n?|\n))+/gu,NP).replace(/\r\n?|\n/gu,NL):node.data);return;}
      if(node.nodeType!==Node.ELEMENT_NODE||!visible(node))return;
      const inCode=code||node.tagName==='PRE';
      const gaps=inCode?null:gapsOf(node),boundary=node.tagName==='BR'||blockTags.has(node.tagName),mark=inCode&&node.tagName!=='PRE'?NL:' ';
      if(gaps?.before)parts.push(' ');
      // Formula tokens (MathML mi/mo/mn...) are separate words ("x = y 2", not "x=y2"); whitespace only, so no non-space character moves.
      if(mathTokens.has(node.localName)&&node.closest('math'))parts.push(' ');
      if(boundary)parts.push(inCode&&node.tagName==='PRE'?' ':mark);
      for(const child of children(node))visit(child,inCode);
      if(boundary||gaps?.after)parts.push(mark);
    };
    visit(e,!!closest(parent(e),'pre'));const value=parts.join('').replace(/\s+/gu,' ').replace(/ ?[\uE000\uE001](?: ?[\uE000\uE001])* ?/gu,run=>run.includes(NP)?'\n\n':'\n').trim();texts.set(e,value);return value;
  };
  // Prefer the enclosing document scope over a single chat turn. No viewport
  // or minimum word threshold may shrink an already loaded conversation.
  const ranked=roots.filter(visible).map(root=>({root,size:text(root).length})).filter(item=>item.size>0);
  ranked.sort((a,b)=>b.size-a.size||(contains(a.root,b.root)?-1:contains(b.root,a.root)?1:0));
  let root=ranked[0]?.root||document.body||document.documentElement;
  /* ONE article inside the chosen main that carries a real share of its text is the text itself (GitHub: the README inside the repository page with
     its file list and sidebar; MDN, news: the article inside main). Several articles (chat turns, feeds) keep the enclosing scope. */
  if(ranked[0]&&ranked[0].root.tagName!=='ARTICLE'){
    const inner=ranked.filter(item=>item.root!==ranked[0].root&&item.root.tagName==='ARTICLE'&&contains(ranked[0].root,item.root));
    const outer=inner.filter(item=>!inner.some(other=>other!==item&&contains(other.root,item.root)));
    if(outer.length===1&&outer[0].size>=200&&outer[0].size>=ranked[0].size*.25)root=outer[0].root;
  }
  if(!root)return {root:null,nodes:[],textNodes:[],blocks:[]};
  // Include explicitly enabled outer headers/footers alongside the selected article.
  const extras=elements.filter(e=>(reading.skipHeaders===false&&e.matches(semantic.header)||reading.skipFooters===false&&e.matches(semantic.footer))&&visible(e)&&!contains(root,e));
  const scopes=[root,...extras.filter(e=>!extras.some(other=>other!==e&&contains(other,e)))];
  const within=node=>scopes.some(scope=>contains(scope,node));
  const blockSelector='header,footer,h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,figcaption,caption,legend,address,dt,dd,summary,td,th,div,section,article,main,[role="main"],body';
  const candidates=new Set();
  for(const scope of scopes)for(const node of textNodesFor(scope)){
    if(!/\S/u.test(node.data))continue;
    let block=closest(parent(node),blockSelector)||scope;
    const pre=closest(parent(node),'pre');if(pre&&contains(scope,pre))block=pre;          // line wrappers (div/span per code line) inside a pre belong to the one code block
    // Stray inline text (e.g. an "Edit this page" link) directly under the root must not make the
    // root a candidate: a candidate wrapper owns all descendants and collapses the page into one block.
    if(block===scope&&parent(node)!==scope){let own=parent(node);while(parent(own)&&parent(own)!==scope)own=parent(own);block=own;}
    candidates.add(contains(scope,block)?block:scope);
  }
  // A wrapper with its own text owns its descendants too. This preserves mixed
  // markup without duplicating parent/child text or dropping short paragraphs.
  const nodes=[...candidates].filter(e=>{
    for(let up=parent(e);up&&within(up);up=parent(up))if(candidates.has(up))return false;
    return !!text(e);
  }).sort((a,b)=>(order.get(a)||0)-(order.get(b)||0));
  const textNodes=nodes.map(textNodesFor);
  // Citation / footnote marks (A1, [12], sup.reference, doc-noteref, back arrows) stay in
  // the text and in the word offsets; only their [start,end) ranges in text(e) are
  // reported, so the speech layer can skip them without moving a single word.
  // Must stay self-contained: this function is serialised into the page.
  const citeRanges=!cites||reading.skipCitations===false?()=>[]:(()=>{
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
      try{return a.getRootNode()?.getElementById?.(decodeURIComponent(h.slice(1)))||document.getElementById(decodeURIComponent(h.slice(1)));}catch{return null;}
    };
    let hasNotes=null;
    const notesOnPage=()=>hasNotes??=!!document.querySelector(NOTES);
    const explicit=(el,t)=>/(?:^|\s)doc-(?:noteref|biblioref)(?:\s|$)/u.test(el.getAttribute('role')||'')||/(?:^|\s)noteref(?:\s|$)/u.test(el.getAttribute('epub:type')||'')||el.hasAttribute('data-cites')||/(?:^|\s)(?:citation-reference|citation-ref|noteref|biblioref)(?:\s|$)/u.test(el.getAttribute('class')||'');
    const linkIsCite=(a,t)=>{
      if(closest(a,'code,pre,math,.katex,.MathJax,var,sub'))return false;
      if(explicit(a,t)&&t.length<=160)return true;
      if(BACK.test(t))return strong(a)||!!a.closest('li,[role~="doc-endnote"],[role~="doc-footnote"]')&&!!target(a);
      if(t.length>16||!/\S/.test(t))return false;
      const par=a.parentElement;
      // Sphinx / Read the Docs give EVERY link the class "reference" (reference internal / external): there it only marks a citation when the
      // text looks like one ([1], 12, a); otherwise "the for statement" lost its keyword (python.org docs read "the -statement").
      const onlyReference=[...a.classList].filter(c=>CLASS.test(c.toLowerCase())).every(c=>c.toLowerCase()==='reference');
      if(strong(a)&&!(onlyReference&&!MARK.test(t))||par&&/^(?:SUP|SPAN)$/.test(par.tagName)&&strong(par))return true;
      if(!MARK.test(t))return false;
      const href=a.getAttribute('href')||'';if(/^#(?:cite[_-](?:note|ref)|fn(?:ref)?|footnote|endnote|bib|ref)[-_:.]?\d/iu.test(href)&&MARK.test(t))return true;const to=target(a);if(!to)return false;
      if(a.parentElement?.tagName==='SUP'&&/^(?:fn|fnref|cite|ref|note|footnote|bib|endnote|source|q-)[-_]/i.test(to.id))return true;
      if(to.closest(NOTES))return true;
      if(/^(?:fn|fnref|cite|ref|note|footnote|bib|endnote|source|q-)/i.test(to.id))return true;
      const label=norm(to.textContent);return label.startsWith(t.replace(/^[\[(]|[\])]$/g,''))&&label.length>t.length;
    };
    const supIsCite=(sup,t)=>strong(sup)&&t.length<=160; // A bare exponent is not a reference.

    return (node,value)=>{
      const found=[];
      for(const el of [node,...query(node,'a,sup,span,[role~="doc-noteref"],[role~="doc-biblioref"],[data-cites],[data-footnote-ref],[data-footnote-backref],cite,i,b,em,strong')]){
        if(found.some(f=>f.contains(el)))continue;
        const t=norm(el.innerText||el.textContent);if(!t||t.length>160||closest(el,'code,pre,math,.katex,.MathJax,var,sub'))continue;
        const tag=el.tagName;let hit=false;
        if(tag==='A')hit=linkIsCite(el,t);
        else if(tag==='SUP')hit=!!el.querySelector('a')?[...el.querySelectorAll('a')].some(a=>linkIsCite(a,norm(a.innerText||a.textContent))):supIsCite(el,t,node);
        else if(explicit(el,t))hit=true;
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
      // The block text and its nodes do not change per mark: map them once, not once per found element.
      const positions=[];if(found.length)for(let i=0;i<value.length;i++)if(/\S/u.test(value[i]))positions.push(i);
      const counts=found.length?textNodesFor(node).map(part=>[part,part.data.replace(/\s/gu,'').length]):[];
      for(const el of found.sort((a,b)=>(order.get(a)||0)-(order.get(b)||0))){
        let ordinal=0,at=-1,last=-1;
        for(const [part,count] of counts){
          if(count&&contains(el,part)){if(at<0)at=positions[ordinal];last=positions[ordinal+count-1]+1;}ordinal+=count;
        }
        if(at<0||last<=at)continue;
        const t=value.slice(at,last);
        let end=at+t.length,begin=at;
        const open=value[begin-1],close=value[end];
        if((open==='['&&close===']')||(open==='('&&close===')')){begin--;end++;}
        out.push([begin,end]);cursor=end;
      }
      return out;
    };
  })();
  const blocks=nodes.map(e=>{const r=e.getBoundingClientRect(),value=text(e),block={text:value,top:r.top,bottom:r.bottom,width:r.width,height:r.height};if(closest(e,'pre'))block.code=true;for(const [flag,selector]of Object.entries(semantic))if(closest(e,selector))block[flag]=true;if(cites){const marks=citeRanges(e,value);if(marks.length)block.cites=marks;const positions=[];for(let i=0;i<value.length;i++)if(/\S/u.test(value[i]))positions.push(i);let ordinal=0;const protect=[];for(const node of textNodesFor(e)){const count=node.data.replace(/\s/gu,'').length;if(count&&closest(parent(node),'code,pre,math,.katex,.MathJax,var,sub'))protect.push([positions[ordinal],positions[ordinal+count-1]+1]);ordinal+=count;}if(protect.length)block.citationProtected=protect;}return block;});
  // Metadata never changes the selected blocks: geometry/bookmarks retain their
  // original indices even on div-only pages with headings outside those blocks.
  for(const heading of [...new Set(scopes.flatMap(scope=>query(scope,'h1,h2,h3,h4,h5,h6')))]){
    if(!visible(heading))continue;
    const title=text(heading);if(!title)continue;
    let index=nodes.findIndex(node=>node===heading||contains(node,heading)),charStart=0;
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
    (blocks[index].headings??=[]).push({label:title,level,charStart});
    if(nodes[index]===heading)blocks[index].headingLevel=level;
  }
  return {root,nodes,textNodes,blocks};
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
// The text itself decides when it clearly is one of the six interface languages and the
// attribute says otherwise (a Claude artifact declares lang="en" around German text).
export function documentLanguage(collected) {
  const declared=declaredLanguage(collected),found=detectTextLanguage((collected?.nodes||[]).slice(0,400).map(node=>node.textContent||'').join(' \n'));
  const declaredBase=declared.slice(0,2).toLowerCase();
  if(found&&(!declared||declaredBase!==found&&TEXT_LANGUAGES.has(declaredBase)))return found;
  return declared;
}
const TEXT_LANGUAGES=new Set(['de','en','fr','es','it','pt']);
function declaredLanguage(collected) {
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
