/* PDF.js page pixels and real operator geometry; no PDF DOM or remote renderer. */
import {checkAbort,effectiveDark,smartInvert,ASSET_LIMITS} from './document-assets.mjs';
const clamp=(n,lo=0,hi=255)=>Math.max(lo,Math.min(hi,n));
const rgb=s=>/^#[\da-f]{6}$/i.test(s||'')?[1,3,5].map(i=>parseInt(s.slice(i,i+2),16)/255):null;
export const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
export function boundedPdfViewport(page,{dpi=144}={}){const base=page.getViewport({scale:1}),w=base.width,h=base.height;if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)throw Error('Die PDF-Seitengröße ist ungültig.');const scale=Math.min(dpi/72,8191/w,8191/h,Math.sqrt(15990000)/Math.sqrt(w)/Math.sqrt(h));if(!Number.isFinite(scale)||scale<=0)throw Error('Die PDF-Seite kann nicht sicher gerastert werden.');const viewport=page.getViewport({scale});if(!Number.isFinite(viewport.width)||!Number.isFinite(viewport.height)||viewport.width<=0||viewport.height<=0||Math.ceil(viewport.width)>8192||Math.ceil(viewport.height)>8192||Math.ceil(viewport.width)*Math.ceil(viewport.height)>16000000)throw Error('Die PDF-Vorschau überschreitet die sichere Rastergrenze.');return viewport;}
const clean=value=>String(value||'').replace(/\s+/gu,' ').trim();
// Conservative running furniture: geometry first, repetition second. Unique
// headings and every number in the body remain ordinary readable text.
export function pdfMarginLines(items,viewport){const lines=[];for(let index=0;index<items.length;index++){const item=items[index],text=clean(item.str);if(!text||!item.transform)continue;const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]),edge=y<viewport.height*.07?'top':y>viewport.height*.93?'bottom':null;if(!edge)continue;const height=Math.abs(item.height||item.transform[3]||10),line=lines.find(l=>l.edge===edge&&Math.abs(l.y-y)<=Math.max(2,Math.min(height,l.height)*.4));if(line){line.parts.push({text,index,x});line.height=Math.max(line.height,height);}else lines.push({edge,y,height,parts:[{text,index,x}]});}return lines.map(line=>({...line,parts:line.parts.sort((a,b)=>a.x-b.x),text:clean(line.parts.sort((a,b)=>a.x-b.x).map(p=>p.text).join(' '))}));}
export function repeatedPdfMargins(pageLines,totalPages,textPages){const occurrences=new Map(),key=(line,page)=>{let label=line.text;const numbered=label.match(/^(?:Page|Seite)\s+(\d+)\s+(?:of|von|\/)\s*(\d+)$/i);if(numbered&&Number(numbered[1])===page&&Number(numbered[2])===totalPages)label='#page-of-total#';else if(line.edge==='bottom'&&/^\d+$/.test(label)&&Number(label)===page)label='#page-number#';return line.edge+'|'+label;};for(let p=0;p<pageLines.length;p++)for(const line of pageLines[p]){const id=key(line,p+1);if(!occurrences.has(id))occurrences.set(id,new Set());occurrences.get(id).add(p);}const repeated=new Set([...occurrences].filter(([,pages])=>pages.size>=3&&pages.size>=Math.max(1,textPages)*.6).map(([id])=>id));return pageLines.map((lines,p)=>new Set(lines.filter(line=>repeated.has(key(line,p+1))).flatMap(line=>line.parts.map(part=>part.index))));}
function bounds(m,box,w,h){const points=[[box[0],box[1]],[box[2],box[1]],[box[0],box[3]],[box[2],box[3]]].map(([x,y])=>point(m,x,y)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return[clamp(Math.min(...xs),0,w),clamp(Math.min(...ys),0,h),clamp(Math.max(...xs),0,w),clamp(Math.max(...ys),0,h)];}
// OPS and argument signatures are those of our bundled PDF.js CanvasGraphics.
// Complex groups/masks/clipping get an honest page fallback, never guessed crops.
export function pdfGeometry(operatorList,viewport,OPS){
 let matrix=[1,0,0,1,0,0],stack=[],fallback=false,clipped=false;const regions=[],vectors=[],w=viewport.width,h=viewport.height;
 const push=()=>{stack.push({matrix:[...matrix],clipped});if(stack.length>128)throw Error('Die PDF-Grafikstruktur ist zu tief.');},pop=()=>{const state=stack.pop();matrix=state?.matrix||[1,0,0,1,0,0];clipped=state?.clipped||false;};
 const add=(box,kind,transform=matrix)=>{if(!box||box.length!==4||![...box,...transform].every(Number.isFinite)){fallback=true;return;}const b=bounds(multiply(viewport.transform,transform),box,w,h);if(b[2]<=b[0]||b[3]<=b[1])return;if(kind==='diagram'&&(b[2]-b[0])*(b[3]-b[1])>w*h*.9)return;(kind==='diagram'?vectors:regions).push({bbox:b.map((n,i)=>n/(i%2?h:w)),kind});};
 if(operatorList.fnArray.length>2000000)throw Error('Diese PDF-Seite enthält zu viele Zeichenoperationen.');
 for(let n=0;n<operatorList.fnArray.length;n++){const op=operatorList.fnArray[n],a=operatorList.argsArray[n]||[];
  if(op===OPS.save){push();}
  else if(op===OPS.restore){pop();}
  else if(op===OPS.transform){if(a.length!==6||!a.every(Number.isFinite)){fallback=true;continue;}matrix=multiply(matrix,a);}
  else if(op===OPS.paintFormXObjectBegin){push();if(a[0]){if(a[0].length!==6||!a[0].every(Number.isFinite))throw Error('Ungültige PDF-Grafiktransformation.');matrix=multiply(matrix,a[0]);}if(a[1])clipped=true;}
  else if(op===OPS.paintFormXObjectEnd){pop();}
  else if(op===OPS.paintImageXObject||op===OPS.paintInlineImageXObject){if(clipped||Math.abs(matrix[0]*matrix[1])+Math.abs(matrix[2]*matrix[3])>1e-6)fallback=true;add([0,0,1,1],'image');}
  else if(op===OPS.paintImageXObjectRepeat){if(clipped||Math.abs(matrix[0]*matrix[1])+Math.abs(matrix[2]*matrix[3])>1e-6)fallback=true;const positions=a[3];if(!positions||positions.length>4096){fallback=true;continue;}for(let i=0;i<positions.length;i+=2)add([0,0,1,1],'image',multiply(matrix,[a[1],0,0,a[2],positions[i],positions[i+1]]));}
  else if(op===OPS.constructPath){if(a[2]&&a[0]!==OPS.endPath)add(a[2],'diagram');else if(a[0]!==OPS.endPath)fallback=true;}
  else if(op===OPS.clip||op===OPS.eoClip)clipped=true;
  else if([OPS.paintInlineImageXObjectGroup,OPS.paintImageMaskXObject,OPS.paintImageMaskXObjectGroup,OPS.paintImageMaskXObjectRepeat,OPS.beginGroup,OPS.shadingFill,OPS.rawFillPath].includes(op))fallback=true;
  if(regions.length+vectors.length>4096)throw Error('Diese PDF-Seite enthält zu viele Abbildungsbereiche.');
 }
 // Vector paths are real ink bounds, but not reliably semantic figures. Keep
 // the exact page when any vector exists, with image policy over its ink bounds.
 const diagrams=vectors.filter(r=>(r.bbox[2]-r.bbox[0])*w>24&&(r.bbox[3]-r.bbox[1])*h>24);if(diagrams.length)fallback=true;
 return{regions:[...diagrams,...regions],fallback};
}
export function validRegions(value){if(!Array.isArray(value)||value.length>4096)throw Error('Ungültige PDF-Abbildungsbereiche.');return value.map(r=>{if(!['image','diagram'].includes(r?.kind)||!Array.isArray(r.bbox)||r.bbox.length!==4||!r.bbox.every(n=>Number.isFinite(n)&&n>=0&&n<=1)||r.bbox[2]<=r.bbox[0]||r.bbox[3]<=r.bbox[1])throw Error('Ungültiger PDF-Abbildungsbereich.');return{kind:r.kind,bbox:[...r.bbox]};});}
export async function transformPdfPixels(original,appearance,regions=[],{signal,isCurrent=()=>true}={}){
 checkAbort(signal);const w=original.width,h=original.height;if(w*h>ASSET_LIMITS.pixels)throw Error('Die PDF-Vorschau überschreitet 16 Megapixel.');const a=appearance||{},source=original.data,output=new Uint8ClampedArray(source),active=a.mode&&a.mode!=='off';if(!active)return new ImageData(output,w,h);
 const dark=effectiveDark(a),bg=rgb(dark?a.background:a.lightBackground)||rgb(dark?'#181c1b':'#ffffff'),fg=rgb(dark?a.text:a.lightText)||rgb(dark?'#e8eee8':'#202124'),mask=new Uint8Array(w*h);
 for(const region of validRegions(regions)){const [x0,y0,x1,y1]=region.bbox.map((v,i)=>i%2?clamp(Math.round(v*h),0,h):clamp(Math.round(v*w),0,w));let invert=a.imageMode==='invert';if(a.imageMode==='smart'&&dark){const sample=[];for(let y=y0;y<y1;y+=Math.max(1,Math.floor((y1-y0)/128)))for(let x=x0;x<x1;x+=Math.max(1,Math.floor((x1-x0)/128))){const i=(y*w+x)*4;sample.push(source[i],source[i+1],source[i+2],source[i+3]);}invert=smartInvert(sample,region.kind);}const code=invert?3:a.imageMode==='dim'?2:1;for(let y=y0;y<y1;y++)mask.fill(code,y*w+x0,y*w+x1);}
 const corners=[0,w-1,(h-1)*w,w*h-1].map(n=>(source[n*4]+source[n*4+1]+source[n*4+2])/765).sort((x,y)=>x-y),paper=(corners[1]+corners[2])/2,contrast=(a.contrast||100)/100,brightness=(a.brightness||100)/100,gray=(a.grayscale||0)/100,sepia=(a.sepia||0)/100,amount=(a.imageBrightness||100)/100;
 for(let start=0;start<w*h;start+=131072){checkAbort(signal);if(!isCurrent())throw new DOMException('Abgebrochen','AbortError');for(let n=start;n<Math.min(w*h,start+131072);n++){const i=n*4;let r=source[i]/255,g=source[i+1]/255,b=source[i+2]/255;if(mask[n]){if(mask[n]===3){r=1-r;g=1-g;b=1-b;}const factor=amount*(mask[n]===2?.7:1);r*=factor;g*=factor;b*=factor;}else{const l=r*.2126+g*.7152+b*.0722,ink=clamp(paper<.4?(l-paper)/Math.max(.05,1-paper):(paper-l)/Math.max(.05,paper),0,1);r=((bg[0]+(fg[0]-bg[0])*ink-.5)*contrast+.5)*brightness;g=((bg[1]+(fg[1]-bg[1])*ink-.5)*contrast+.5)*brightness;b=((bg[2]+(fg[2]-bg[2])*ink-.5)*contrast+.5)*brightness;const luma=r*.2126+g*.7152+b*.0722;r=r*(1-gray)+luma*gray;g=g*(1-gray)+luma*gray;b=b*(1-gray)+luma*gray;const sr=.393*r+.769*g+.189*b,sg=.349*r+.686*g+.168*b,sb=.272*r+.534*g+.131*b;r=r*(1-sepia)+sr*sepia;g=g*(1-sepia)+sg*sepia;b=b*(1-sepia)+sb*sepia;}output[i]=clamp(Math.round(r*255));output[i+1]=clamp(Math.round(g*255));output[i+2]=clamp(Math.round(b*255));}
  await new Promise(r=>setTimeout(r,0));
 }checkAbort(signal);if(!isCurrent())throw new DOMException('Abgebrochen','AbortError');return new ImageData(output,w,h);
}
