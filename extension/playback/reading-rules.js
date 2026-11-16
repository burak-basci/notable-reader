/* beNotable! Reader · bounded, local reading preferences and source-token mapping (MIT).
   A user replacement changes only synthesis input. Display words and their offsets remain untouched. */
import {prepareSpeech} from '../engine/speech-normalize.mjs';
export const SEMANTIC_RANGE_KINDS=Object.freeze(['code','math','link','header','footer','caption','table','quote','footnote','citation']);
export function validSemanticRanges(ranges,textLength) {
 return Number.isSafeInteger(textLength)&&textLength>=0&&Array.isArray(ranges)&&ranges.length<=65536&&ranges.every(r=>obj(r)&&Object.keys(r).length===3&&Object.keys(r).every(k=>['kind','start','end'].includes(k))&&SEMANTIC_RANGE_KINDS.includes(r.kind)&&Number.isSafeInteger(r.start)&&Number.isSafeInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=textLength);
}
export function cleanSemanticRanges(ranges,textLength) {
 if(ranges===undefined)return [];
 if(!validSemanticRanges(ranges,textLength))throw Object.assign(new Error('Invalid structured source ranges'),{code:'invalid_semantic_ranges'});
 return ranges.map(({kind,start,end})=>({kind,start,end})).sort((a,b)=>a.start-b.start||a.end-b.end||a.kind.localeCompare(b.kind));
}
export const READING_FILTER_KEYS = Object.freeze(['skipCode','skipMath','skipLinks','skipHeaders','skipFooters','skipCaptions','skipTables','skipQuotes','skipFootnotes','skipCitations']);
export const READING_BOOLEAN_KEYS = Object.freeze(['quickActions',...READING_FILTER_KEYS]);
export const READING_DEFAULTS = Object.freeze({dictionary: [], quickActions: false, skipCode: false, skipMath: false, skipLinks: false, skipHeaders: true, skipFooters: true, skipCaptions: false, skipTables: false, skipQuotes: false, skipFootnotes: false, skipCitations: true, commaPause: 0, sentencePause: 0, paragraphPause: 0});
/* The sleep timer was removed in 2.5.0. Settings saved or exported earlier may still carry sleepMinutes: accepted silently, never kept. */
const RETIRED_READING_KEYS = Object.freeze(['sleepMinutes']);
const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
export function regexProblem(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 128) return 'pattern';
  /* Deliberately small regex dialect: no groups, lookarounds, backreferences, braces or repeated wildcards.
     These exclusions avoid backtracking explosions on untrusted page text. Character classes and one bounded run are useful for reference marks. */
  if (/[(){}|]/u.test(pattern) || /\\[1-9kbB]/u.test(pattern) || /(?:\.\*|\.\+)/u.test(pattern) || (pattern.match(/(?<!\\)[*+?]/gu) || []).length > 1) return 'unsafe';
  try { const re = new RegExp(pattern, 'gu'); if (re.test('')) return 'empty'; } catch { return 'pattern'; }
  return null;
}
export function ruleProblem(rule) {
  if (!obj(rule) || Object.keys(rule).some(k => !['from','to','regex','caseSensitive'].includes(k))) return 'rule';
  if (typeof rule.from !== 'string' || !rule.from.trim() || rule.from.length > 128 || typeof rule.to !== 'string' || rule.to.length > 256 || /[\r\n\u0000]/u.test(rule.from + rule.to)) return 'text';
  if (rule.regex !== undefined && typeof rule.regex !== 'boolean' || rule.caseSensitive !== undefined && typeof rule.caseSensitive !== 'boolean') return 'type';
  return rule.regex ? regexProblem(rule.from) : null;
}
export function validReading(value) {
  return obj(value) && Object.keys(value).every(k => Object.hasOwn(READING_DEFAULTS,k) || RETIRED_READING_KEYS.includes(k)) &&
    READING_BOOLEAN_KEYS.every(k => value[k] === undefined || typeof value[k] === 'boolean') &&
    ['commaPause','sentencePause','paragraphPause'].every(k => value[k] === undefined || Number.isInteger(value[k]) && value[k] >= 0 && value[k] <= 3000 && value[k] % 50 === 0) &&
    (value.dictionary === undefined || Array.isArray(value.dictionary) && value.dictionary.length <= 64 && value.dictionary.every(r => !ruleProblem(r)));
}
export function cleanReading(value) {
  const out = {...READING_DEFAULTS, dictionary: []};
  if (!obj(value)) return out;
  for (const key of READING_BOOLEAN_KEYS) if (typeof value[key] === 'boolean') out[key] = value[key];
  for (const key of ['commaPause','sentencePause','paragraphPause']) if (Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 3000 && value[key] % 50 === 0) out[key] = value[key];
  if (Array.isArray(value.dictionary)) out.dictionary = value.dictionary.slice(0,64).filter(r => !ruleProblem(r)).map(r => ({from:r.from,to:r.to,regex:r.regex===true,caseSensitive:r.caseSensitive===true}));
  return out;
}
/* Only explicit source metadata can identify semantic file blocks. Plain text/PDF
   without that metadata is kept; words and source offsets are never guessed away. */
/* Unmarked numeric references need prose context. Explicit DOM references are
   handled separately; bare numbers, equations, arrays and author/year prose are
   never inferred from their numeric shape alone. Positions stay in source text. */
export function citationTextRanges(text,{protectedRanges=[]}={}) {
 if(typeof text!=='string')return [];
 const out=[];
 for(const match of text.matchAll(/\[(?:[1-9]\d{0,3})(?:\s*[-–—]\s*[1-9]\d{0,3})?\]/gu)){
  const start=match.index,end=start+match[0].length;
  if(/^\[(?:1[5-9]|20|21)\d{2}\]$/u.test(match[0]))continue;
  if(protectedRanges.some(([a,b])=>a<end&&b>start))continue;
  const lineStart=Math.max(text.lastIndexOf('\n',start-1),text.lastIndexOf('\r',start-1))+1,before=text.slice(lineStart,start),after=text.slice(end),words=before.match(/[\p{L}]+/gu)||[];
  if(/\b(?:value is|value equals|number is|wert ist|valeur est|valor es)\s*$/iu.test(before))continue;
  if(words.length<3||/[=<>+*/{}]|(?:\b(?:array|index|indices|items|matrix|vector|list|range|ranges|interval|equation|rang|bereich)\b)/iu.test(before.slice(-70)))continue;
  const punct=/[.!?;:”»’]\s*$/u.test(before),spaced=/\s$/u.test(before)&&/^[.,;:!?)](?:\s|$)/u.test(after),chain=out.at(-1)?.[1]===start;
  if(punct||spaced||chain)out.push([start,end]);
 }
 return out;
}
export function readingBlockSkipped(block,reading) {
  const r=cleanReading(reading);
  return [['skipCode','code'],['skipMath','math'],['skipLinks','link'],['skipHeaders','header'],['skipFooters','footer'],['skipCaptions','caption'],['skipTables','table'],['skipQuotes','quote'],['skipFootnotes','footnote'],['skipCitations','citation']].some(([key,flag])=>r[key]&&block?.[flag]===true);
}
// Structural filters are applied while collecting/chunking, before synthesis.
export function readingChanged(value) { const r=cleanReading(value); return r.dictionary.length > 0 || r.skipLinks || r.commaPause > 0 || r.sentencePause > 0 || r.paragraphPause > 0; }
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/* Match complete source tokens/phrases only; replacements never rewrite a substring inside another word.
   The first rule matching a source range wins. A literal replacement is literal text (no $1 interpolation). */
export function prepareReadingSpeech(chunk, lang, {reading, normalize = true} = {}) {
  const source = (chunk.words?.length ? chunk.words : chunk.text.match(/\S+/gu) || []).map(w => typeof w === 'string' ? w : w.text), r = cleanReading(reading);
  const offsets=[]; let cursor=0; for(const word of source) {const start=chunk.text.indexOf(word,cursor); if(start<0) return null; offsets.push({start,end:start+word.length});cursor=start+word.length;}
  const normal = normalize ? prepareSpeech({text:chunk.text,words:source},lang).words || source : source;
  const occupied=new Set(), matches=new Map();
  if(r.skipLinks)source.forEach((word,i)=>{if(/^https?:\/\/\S+/iu.test(word)){occupied.add(i);matches.set(i,{last:i,text:''});}});
  for(const rule of r.dictionary) {
    const re=new RegExp(rule.regex ? rule.from : esc(rule.from),'gu'+(rule.caseSensitive?'':'i'));
    for(const match of chunk.text.matchAll(re)) {
      if(!match[0]) continue;
      const start=match.index,end=start+match[0].length,a=offsets.findIndex(o=>o.start<=start&&o.end>start),b=offsets.findIndex(o=>o.start<end&&o.end>=end);
      if(a<0||b<a||Array.from({length:b-a+1},(_,k)=>a+k).some(i=>occupied.has(i))) continue;
      const prefix=chunk.text.slice(offsets[a].start,start),suffix=chunk.text.slice(end,offsets[b].end);
      if(/[\p{L}\p{N}]/u.test(prefix+suffix))continue;
      for(let i=a;i<=b;i++)occupied.add(i); matches.set(a,{last:b,text:rule.to?prefix+rule.to+suffix:''});
    }
  }
  const words=[], groups=[];
  for(let i=0;i<source.length;i++) {
    const match=matches.get(i); if(occupied.has(i)&&!match)continue;
    const last=match?.last??i, text=(match?match.text:normal[i]).trim();
    if(text) {words.push(text);groups.push({first:i,last});} i=last;
  }
  let at=0;const ranges=words.map((word,i)=>{const start=at;at+=word.length+1;return {start,end:at-1,...groups[i]};});
  return {text:words.join(' '),words,groups,ranges,source,reading:r};
}
export function pauseAfter(word, reading, paragraphEnd = false) {
  const r=cleanReading(reading); return (/[,;:]["'”’)\]»›]*$/u.test(word)?r.commaPause:/[.!?…]["'”’)\]»›]*$/u.test(word)?r.sentencePause:0)+(paragraphEnd?r.paragraphPause:0);
}
/* Returned timings index SOURCE words, including skipped words at zero duration. A phrase replacement shares its duration among the source words. */
export function mapReadingTimings(timings, prepared) {
  if(!timings) return null;
  const result=prepared.source.map(()=>({start:0,end:0}));let end=0;
  prepared.groups.forEach((group,index)=>{const t=timings[index]||{start:end,end};const span=Math.max(0,t.end-t.start),n=group.last-group.first+1;for(let i=group.first;i<=group.last;i++)result[i]={start:t.start+span*(i-group.first)/n,end:t.start+span*(i-group.first+1)/n};end=t.end;});
  let next=end;for(let i=result.length-1;i>=0;i--) {if(!prepared.groups.some(g=>i>=g.first&&i<=g.last))result[i]={start:next,end:next};else next=result[i].start;}
  return result;
}
/* Insert EXTRA silence at real word boundaries. This keeps pitch/rate controls independent and shifts the highlight timeline by exactly the added PCM. */
export function addReadingPauses(result, prepared, {paragraphEnd=false} = {}) {
  const timings=mapReadingTimings(result.wordTimings,prepared);
  if(!timings || !result.sampleRate) return {...result,wordTimings:timings};
  const inserts=[];prepared.groups.forEach((g,i)=>{const last=g.last,ms=pauseAfter(prepared.source[last],prepared.reading,paragraphEnd&&last===prepared.source.length-1);if(ms>0) inserts.push({at:Math.min(result.pcm.length,Math.max(0,Math.round((result.wordTimings[i]?.end||0)*result.sampleRate))),samples:Math.round(ms*result.sampleRate/1000),word:last});});
  if(!inserts.length)return {...result,wordTimings:timings};
  inserts.sort((a,b)=>a.at-b.at); const total=inserts.reduce((s,i)=>s+i.samples,0),pcm=new Float32Array(result.pcm.length+total);let from=0,to=0;
  for(const ins of inserts) {pcm.set(result.pcm.subarray(from,ins.at),to);to+=ins.at-from+ins.samples;from=ins.at;}pcm.set(result.pcm.subarray(from),to);
  const shifted=timings.map((t,i)=>{const shift=inserts.filter(ins=>ins.word<i).reduce((s,ins)=>s+ins.samples/result.sampleRate,0);return {start:t.start+shift,end:t.end+shift};});
  return {...result,pcm,durationSec:pcm.length/result.sampleRate,wordTimings:shifted};
}

/* Untimed engines cannot identify a comma in an already-produced waveform. Ask them for bounded phrases instead,
   then place silence BETWEEN those complete waveforms. Timed and untimed engines share this path and never invent word boundaries. */
export async function synthesizeReading(prepared, synthesize, {paragraphEnd=false,stream=false,headWords=15,grow=0}={}) {
  if(!prepared?.words.length)return {pcm:new Float32Array(1),sampleRate:24000,durationSec:1/24000,wordTimings:prepared?.source.map(()=>({start:0,end:0}))||[],timingKind:'model',fromWord:prepared?.fromWord||0};
  const parts=[];let from=0;
  for(let i=0;i<prepared.words.length;i++) {
    const group=prepared.groups[i],last=i===prepared.words.length-1;
    const pauseMs=pauseAfter(prepared.source[group.last],prepared.reading,paragraphEnd&&last);
    const head=stream&&parts.length===0&&i+1>=Math.max(1,headWords);
    if(pauseMs>0||last||head){parts.push({words:prepared.words.slice(from,i+1),pauseMs,lastGroup:i});from=i+1;}
  }
  let sampleRate=0;
  const run=async part=>{
    const result=await synthesize({text:part.words.join(' '),words:part.words});
    if(!(result.pcm instanceof Float32Array)||!Number.isFinite(result.sampleRate)||result.sampleRate<=0)throw new Error('reading-synthesis-shape');
    sampleRate||=result.sampleRate;if(result.sampleRate!==sampleRate)throw new Error('reading-sample-rate');
    return {result,part};
  };
  const combine=(outputs,partial=false)=>{
    let frames=0,allTimed=true;const pieces=[],times=[];
    for(const {result,part}of outputs){
      if(result.wordTimings?.length===part.words.length){const shift=frames/sampleRate;times.push(...result.wordTimings.map(t=>({start:t.start+shift,end:t.end+shift})));}else allTimed=false;
      pieces.push(result.pcm);frames+=result.pcm.length;
      const gap=Math.round(part.pauseMs*sampleRate/1000);if(gap){pieces.push(new Float32Array(gap));frames+=gap;}
    }
    const pcm=new Float32Array(frames);let at=0;for(const piece of pieces){pcm.set(piece,at);at+=piece.length;}
    const first=outputs[0].result,lastGroup=outputs.at(-1).part.lastGroup,scope=partial?{...prepared,groups:prepared.groups.slice(0,lastGroup+1),source:prepared.source.slice(0,prepared.groups[lastGroup].last+1)}:prepared;
    return {...first,pcm,sampleRate,durationSec:frames/sampleRate,wordTimings:allTimed?mapReadingTimings(times,scope):null,timingKind:allTimed?(first.timingKind||'model'):'none',fromWord:prepared.fromWord||0,partial};
  };
  const first=await run(parts[0]);
  if(stream&&parts.length>1&&grow>=1){
    /* Progressive, as in the engine: the phrases after the head come in pieces growing by `grow` (word count), each piece resolves the `tail` of the one
       before with its own PCM and the SOURCE word timings of everything so far; `readingDone` settles with the last piece (the worker stays reserved). */
    const head=combine([first],true),rest=parts.slice(1),pieces=[];let size=Math.max(1,first.part.words.length),at=0;
    while(at<rest.length){size=Math.ceil(size*grow);let n=0,end=at;while(end<rest.length&&(end===at||n<size)){n+=rest[end].words.length;end++;}pieces.push(rest.slice(at,end));at=end;}
    const outputs=[first];let sent=head.pcm.length,finish;const readingDone=new Promise(resolve=>{finish=resolve;});
    const piece=k=>{const p=(async()=>{for(const part of pieces[k])outputs.push(await run(part));const last=k===pieces.length-1,full=combine(outputs,!last),out={...full,pcm:full.pcm.subarray(sent),durationSec:(full.pcm.length-sent)/sampleRate};sent=full.pcm.length;if(!last){out.partial=true;out.tail=piece(k+1);}else finish();return out;})();p.catch(()=>finish());return p;};
    return {...head,tail:piece(0),readingTail:true,readingDone};
  }
  if(stream&&parts.length>1){
    const head=combine([first],true);
    /* Same head/tail protocol as TtsEngine: the tail carries only its PCM, but complete SOURCE word timings in section time. */
    const tail=(async()=>{const rest=[];for(const part of parts.slice(1))rest.push(await run(part));const full=combine([first,...rest]);return {...full,pcm:full.pcm.subarray(head.pcm.length),durationSec:(full.pcm.length-head.pcm.length)/sampleRate};})();tail.catch(()=>{});
    return {...head,tail,readingTail:true};
  }
  const rest=[];for(const part of parts.slice(1))rest.push(await run(part));return combine([first,...rest]);
}
