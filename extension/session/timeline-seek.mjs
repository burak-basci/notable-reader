/* One text-length axis for the slider, relative navigation and progress. Source offsets stay unchanged;
   a committed position resolves to a real word and playback uses that word's measured media timing. */
import {wordOffsets, wordAtChar} from '../playback/timeline.js';
export function createTimelineMap(chunks) {
  const prefix=[], offsets=[];let total=0;
  for(const chunk of chunks){prefix.push(total);total+=chunk.text.length+1;}
  const offsetsFor=index=>offsets[index]??(offsets[index]=wordOffsets(chunks[index]?.text||'',chunks[index]?.words||[]));
  const atChar=value=>{
    if(!chunks.length)return null;
    const bounded=Math.max(0,Math.min(total-1,Number.isFinite(value)?value:0)),rounded=Math.round(bounded);
    const char=Math.abs(bounded-rounded)<=Number.EPSILON*Math.max(1,total)*4?rounded:bounded;
    let lo=0,hi=chunks.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(prefix[mid]<=char)lo=mid;else hi=mid-1;}
    return {chunk:lo,word:wordAtChar(offsetsFor(lo),char-prefix[lo])??0};
  };
  const charAt=({chunk,word})=>(prefix[chunk]||0)+(offsetsFor(chunk)?.[word]?.start||0);
  return {prefix,total,offsetsFor,atChar,charAt,atFraction:value=>atChar(Math.max(0,Math.min(1,value))*total),fraction:position=>total?charAt(position)/total:0};
}
