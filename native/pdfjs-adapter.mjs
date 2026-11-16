// Self-contained: this function is serialized into the authorized reader tab.
// Source URLs and authentication never enter the adapter or its public identity.
export function createPdfJsAdapter(expectedUrl) {
  const publicUrl = value => {
    try { const u=new URL(value,location.href); return u.origin+u.pathname; } catch { return null; }
  };
  const identity=publicUrl(location.href);
  if(identity!==expectedUrl || !/^\/library\/\d+\/series\/\d+\/pdf\/\d+\/?$/.test(location.pathname)) return null;
  const host=document.querySelector('ngx-extended-pdf-viewer');
  const scroller=host?.querySelector('#viewerContainer');
  const pagesRoot=scroller?.querySelector('.pdfViewer');
  if(!host||!scroller||!pagesRoot||!pagesRoot.querySelector('.page[data-page-number]')) return null;
  const instanceKey=Symbol.for('brave-reader.pdfjs.host-instance');
  if(!host[instanceKey])Object.defineProperty(host,instanceKey,{value:crypto.randomUUID()});
  const rendererInstance=host[instanceKey];
  const pages=()=>[...pagesRoot.querySelectorAll('.page[data-page-number]')];
  const pageRect=index=>{
    const page=pagesRoot.querySelector(`.page[data-page-number="${index+1}"]`);
    if(!page)return {x:0,y:0,width:0,height:0};
    // PDF.js page elements include a decorative border. Text/canvas positions
    // refer to the inner PDF surface, including pages that are not rendered yet.
    const p=page.getBoundingClientRect(),s=scroller.getBoundingClientRect(),css=getComputedStyle(page);
    const left=parseFloat(css.borderLeftWidth)||0,right=parseFloat(css.borderRightWidth)||0;
    const top=parseFloat(css.borderTopWidth)||0,bottom=parseFloat(css.borderBottomWidth)||0;
    return {x:p.left+left-s.left,y:p.top+top-s.top,width:Math.max(0,p.width-left-right),height:Math.max(0,p.height-top-bottom)};
  };
  const viewport={
    get size(){return {width:scroller.clientWidth,height:scroller.clientHeight};},
    get position(){return {x:scroller.scrollLeft,y:scroller.scrollTop};},
    getZoom(){const n=parseFloat(getComputedStyle(pagesRoot).getPropertyValue('--scale-factor'));return Number.isFinite(n)&&n>0?n:1;},
    getMostVisiblePage(){
      let best=0,area=-1;
      for(const page of pages()){
        const i=Number(page.dataset.pageNumber)-1,r=pageRect(i);
        const a=Math.max(0,Math.min(r.x+r.width,scroller.clientWidth)-Math.max(r.x,0))*Math.max(0,Math.min(r.y+r.height,scroller.clientHeight)-Math.max(r.y,0));
        if(a>area){area=a;best=i;}
      }
      return best;
    },
    getPageScreenRect:pageRect,
    scrollTo({x,y}){scroller.scrollTo({left:x,top:y,behavior:'instant'});},
    scrollBy({x,y}){scroller.scrollBy({left:x,top:y,behavior:'instant'});},
    getClockwiseRotations(){
      const rotations=[pagesRoot,...pagesRoot.querySelectorAll('[data-main-rotation],[data-rotation]')].map(el=>Number(el.getAttribute('data-main-rotation')||el.getAttribute('data-rotation')||0));
      const angle=rotations.find(n=>Number.isFinite(n)&&((n%360)+360)%360!==0)||0;
      return ((angle%360)+360)%360/90;
    },
    twoUpViewEnabled(){return !!pagesRoot.querySelector('.spread')||pagesRoot.classList.contains('spreadOdd')||pagesRoot.classList.contains('spreadEven');},
  };
  return {originalUrl:identity,rendererInstance,viewport,
    get documentDimensions(){return {pageDimensions:Array.from({length:Math.max(...pages().map(p=>Number(p.dataset.pageNumber)))},()=>({}))};},
    // Deliberately leave the application's own root and layout intact. The
    // bridge owns/removes the one appended wrapper and its private shadow root.
    shadowRoot:{querySelector:selector=>selector==='#scroller'?scroller:null,append:node=>host.append(node)},
  };
}
