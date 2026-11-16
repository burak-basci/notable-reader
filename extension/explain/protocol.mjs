export const STYLES=Object.freeze(['circle','underline','marker']);
export function snapshotSource(source){
 if(!source||!['number','string'].includes(typeof source.epoch)||!Array.isArray(source.blocks))throw Error('Keine lesbare Quelle.');
 const seen=new Set();const blocks=source.blocks.map(b=>{if(!b||typeof b.id!=='string'||!b.id||seen.has(b.id)||typeof b.text!=='string')throw Error('Ungültige Quellblöcke.');seen.add(b.id);return Object.freeze({id:b.id,text:b.text});});
 if(!blocks.some(b=>b.text.trim()))throw Error('Keine lesbaren Textstellen.');return Object.freeze({epoch:source.epoch,blocks:Object.freeze(blocks)});
}
export function chunkSource(source,maxChars=1500){
 const out=[];for(const b of source.blocks){for(let start=0;start<b.text.length;){let end=Math.min(start+maxChars,b.text.length);if(end<b.text.length){const boundary=b.text.lastIndexOf(' ',end);if(boundary>start+maxChars/2)end=boundary;}out.push({blockId:b.id,text:b.text.slice(start,end),start});start=end;}}return out;
}
export function quoteCandidates(text){
 const matches=[...text.matchAll(/[^.!?\n]+[.!?]?/gu)].map(m=>({text:m[0].trim(),offset:m.index+m[0].indexOf(m[0].trim())})).filter(m=>m.text.length>=3);const parts=[];
 for(const m of matches){for(let i=0;i<m.text.length;i+=140){const quote=m.text.slice(i,i+140);if(quote.length>=3)parts.push({quote,offset:m.offset+i});}}
 return parts.length<=8?parts:Array.from({length:8},(_,i)=>parts[Math.round(i*(parts.length-1)/7)]);
}
export function parseAnswer(raw,chunk){
 let value;try{const start=raw.indexOf('{'),end=raw.lastIndexOf('}');value=JSON.parse(raw.slice(start,end+1));}catch{
  // Small models sometimes close JSON incorrectly. Accept only individually valid JSON values,
  // never repair arbitrary prose, evaluate code, or trust generated locations/selectors.
  const explanation=raw.match(/"explanation"\s*:\s*("(?:[^"\\]|\\.)*")/u);if(explanation){try{value={explanation:JSON.parse(explanation[1])};const mark=raw.match(/"mark"\s*:\s*(\d+)/u),style=raw.match(/"style"\s*:\s*"(circle|underline|marker)"/u);if(mark)value.mark=Number(mark[1]);if(style)value.style=style[1];}catch{}}
 }
 if(!value||typeof value.explanation!=='string'||!value.explanation.trim())throw Error('Das lokale Modell hat keine gültige Erklärung geliefert. Erneut versuchen.');
 const annotations=[];for(const q of Array.isArray(value.quotes)?value.quotes.slice(0,3):[]){if(!q||typeof q.quote!=='string'||q.quote.length<3||q.quote.length>300||!STYLES.includes(q.style)||!chunk.text.includes(q.quote))continue;annotations.push({blockId:chunk.blockId,quote:q.quote,style:q.style,offset:chunk.start+chunk.text.indexOf(q.quote)});}
 const candidate=chunk.candidates?.[value.mark];if(Number.isInteger(value.mark)&&candidate&&STYLES.includes(value.style)&&chunk.text.slice(candidate.offset,candidate.offset+candidate.quote.length)===candidate.quote)annotations.push({blockId:chunk.blockId,quote:candidate.quote,style:value.style,offset:chunk.start+candidate.offset});
 return {text:value.explanation.slice(0,6000),annotations};
}
