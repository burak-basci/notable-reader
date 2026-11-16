/* beNotable! Reader engine · word timings · own code MIT (port of the companion's timing.py, same method).
 * Times are seconds on the media clock of the returned PCM, independent of playback rate.
 *  - Kokoro: the model's own `duration` output (frames per input token) is mapped to source words. No guessing from letter count.
 *  - Piper/Kitten (no duration output): phoneme-weighted shares of the measured speech, silent gaps pinned to punctuation. An estimate, labelled as such. */

/* Global minimum-edit alignment of the per-word source phonemes (`source`, with owner word per char) onto the phonemes the
 * sentence really used (`target`). Whitespace substitution costs more so word boundaries stay anchors. Returns owner per target char (null = none). */
export function alignOwners(source,sourceOwners,target){
 const s=Array.from(source),t=Array.from(target);
 if(s.length===t.length&&s.every((c,i)=>c===t[i]))return sourceOwners.slice(0,t.length);
 const width=t.length+1,trace=new Uint8Array((s.length+1)*width);
 let previous=new Int32Array(width);for(let j=0;j<width;j++){previous[j]=j;if(j)trace[j]=2;}
 for(let i=1;i<=s.length;i++){
  const row=new Int32Array(width),base=i*width,left=s[i-1];row[0]=i;trace[base]=1;
  for(let j=1;j<width;j++){
   const right=t[j-1],sub=left===right?0:((left===' ')!==(right===' ')?3:1);
   const a=previous[j-1]+sub,b=previous[j]+1,c=row[j-1]+1;
   let direction=0,best=a;if(b<best){best=b;direction=1;}if(c<best){best=c;direction=2;}
   row[j]=best;trace[base+j]=direction;
  }
  previous=row;
 }
 const owners=new Array(t.length).fill(null);let i=s.length,j=t.length;
 while(i||j){
  const direction=trace[i*width+j];
  if(direction===0){owners[j-1]=sourceOwners[i-1]??null;i--;j--;}
  else if(direction===1)i--;
  else{
   if(t[j-1]!==' '){/* an inserted phoneme belongs to the current word; at a separator, to the word before it */
    let at=Math.min(i,sourceOwners.length-1);if(at>=0&&sourceOwners[at]==null)at--;
    if(at>=0)owners[j-1]=sourceOwners[at]??null;
   }
   j--;
  }
 }
 return owners;
}

/* Builds the source phoneme string from one phoneme string per word: words joined by a space, owner = word index.
 * `normalize` must apply the same filter the sentence got (vocabulary, replacements). */
export function sourcePhonemes(wordPhonemes,normalize=value=>value){
 const chars=[],owners=[];
 wordPhonemes.forEach((raw,index)=>{
  if(index){chars.push(' ');owners.push(null);}
  for(const char of normalize(raw).split(/\s+/).filter(Boolean).join(' ')){chars.push(char);owners.push(index);}
 });
 return {source:chars.join(''),owners};
}

/* Kokoro: `duration` = frames per input token (pad tokens included), `tokenOwners` = word index per token (null for pad/space),
 * same length as `duration`. Frame length is derived from the real audio (samples / frames) so it can never drift from the audio;
 * the Kokoro vocoder hop gives exactly 600 samples per frame at 24 kHz, which the tests assert.
 * Unpronounced words get a zero-length span at the previous boundary. */
export function kokoroWordTimings(durationTensor,tokenOwners,samples,sampleRate,wordCount){
 const frames=Array.from(durationTensor,Number),total=frames.reduce((a,b)=>a+b,0),seconds=samples/sampleRate;
 if(frames.length!==tokenOwners.length)throw new Error('Wortzeiten: Dauer- und Tokenliste passen nicht zusammen.');
 const count=wordCount??(tokenOwners.reduce((m,o)=>o==null?m:Math.max(m,o),-1)+1),perFrame=total>0?seconds/total:0;
 const first=new Array(count).fill(null),last=new Array(count).fill(null);
 let at=0;
 frames.forEach((length,index)=>{
  const owner=tokenOwners[index],start=at*perFrame;at+=length;
  if(owner==null||owner>=count)return;
  if(first[owner]===null)first[owner]=start;
  last[owner]=at*perFrame;
 });
 const out=[];let previousEnd=0;
 for(let word=0;word<count;word++){
  const start=first[word]===null?previousEnd:Math.max(previousEnd,Math.min(seconds,first[word]));
  const end=first[word]===null?start:Math.max(start,Math.min(seconds,last[word]));
  out.push({start,end});previousEnd=end;
 }
 return out;
}

/* --- engines without duration output --- */
const PAUSE_PUNCT=/[,;:.!?…–—)\]»”]$/,STRONG_PUNCT=/[.!?…]$/,HOP=0.01;
export function phonemeWeight(phonemes){
 let weight=0;for(const char of phonemes){if(`ˈˌ ,.;:!?…-'"()`.includes(char))continue;weight+=char==='ː'||char==='ˑ'?0.55:('̯̩̪̃ʰʲ'.includes(char)?0.35:1);}
 return Math.max(weight,0.8);
}
/* Silent runs inside the speech region: ({pauses:[[a,b]], speech:[start,end]}) in seconds. */
export function detectPauses(pcm,rate,minimum=0.2){
 const hop=Math.max(1,Math.floor(rate*HOP)),count=Math.floor(pcm.length/hop),all=[0,pcm.length/rate];
 if(!count)return {pauses:[],speech:all};
 const rms=new Float64Array(count);
 for(let f=0;f<count;f++){let sum=0;for(let k=f*hop,end=k+hop;k<end;k++)sum+=pcm[k]*pcm[k];rms[f]=Math.sqrt(sum/hop);}
 const sorted=Float64Array.from(rms).sort(),level=sorted[Math.min(count-1,Math.floor(0.95*(count-1)+0.5))];
 if(!(level>0))return {pauses:[],speech:all};
 const quiet=index=>rms[index]<level*0.06;
 let first=-1,end=-1;for(let f=0;f<count;f++)if(!quiet(f)){if(first<0)first=f;end=f+1;}
 if(first<0)return {pauses:[],speech:all};
 const pauses=[];let run=-1;
 for(let f=first;f<end;f++){
  if(quiet(f)){if(run<0)run=f;}
  else if(run>=0){if((f-run)*HOP>=minimum)pauses.push([run*HOP,f*HOP]);run=-1;}
 }
 return {pauses,speech:[first*HOP,end*HOP]};
}
/* Which pause belongs to which punctuation boundary: ONE monotone assignment for the whole section (dynamic programming), not pause by pause.
 * Speech with spelled letters and file names ("main Punkt T F") has short inner pauses and runs at an uneven pace; the greedy nearest-boundary match used to
 * hang such an inner pause on the next sentence end, which pulled every word before it ahead of the audio by up to 3 s (measured with Whisper word times).
 * Cost of a match = squared distance between the pause and the boundary's predicted time in units of a tolerance (a sentence end is expected to have a pause);
 * an unmatched strong boundary costs 0.7, a weak one 0.35, an unmatched pause nothing. Returns Map(boundary word index -> [start,end] of its pause). */
export function matchPauses(boundaries,pauses,cumulative,words,speechStart,span){
 const rows=boundaries.length,cols=pauses.length,anchors=new Map();
 if(!rows||!cols)return anchors;
 /* Compared in SPEECH time (all pauses taken out): an inner pause is no speech, so it must not push the predicted position of the boundaries behind it. */
 const paused=pauses.reduce((sum,[a,b])=>sum+b-a,0),talk=Math.max(span-paused,1e-6),before=[];
 let gone=0;for(const [a,b] of pauses){before.push(a-speechStart-gone);gone+=b-a;}
 const predicted=boundaries.map(i=>cumulative[i]*talk),tolerance=Math.max(0.5,0.12*talk),skip=boundaries.map(i=>STRONG_PUNCT.test(words[i])?0.7:0.35);
 const cost=(i,j)=>{
  const [start,end]=pauses[j],distance=Math.abs(before[j]-predicted[i])/tolerance;
  if(distance>1)return Infinity;
  return distance*distance*(STRONG_PUNCT.test(words[boundaries[i]])&&end-start>0.3?0.6:1);
 };
 const table=Array.from({length:rows+1},()=>new Float64Array(cols+1)),step=Array.from({length:rows+1},()=>new Uint8Array(cols+1));
 for(let i=1;i<=rows;i++){table[i][0]=table[i-1][0]+skip[i-1];step[i][0]=1;}
 for(let i=1;i<=rows;i++)for(let j=1;j<=cols;j++){
  let best=table[i-1][j]+skip[i-1],choice=1;                       // boundary i-1 has no pause
  if(table[i][j-1]<best){best=table[i][j-1];choice=2;}              // pause j-1 is an inner pause
  const match=cost(i-1,j-1);if(match<Infinity&&table[i-1][j-1]+match<best){best=table[i-1][j-1]+match;choice=3;}
  table[i][j]=best;step[i][j]=choice;
 }
 for(let i=rows,j=cols;i>0&&j>=0;){
  const choice=j===0?1:step[i][j];
  if(choice===3){anchors.set(boundaries[i-1],pauses[j-1]);i--;j--;}else if(choice===1)i--;else j--;
 }
 return anchors;
}
/* words: string[]; phonemes: per word either a phoneme count (number) or the phoneme string; opts.pcm (+sampleRate) pins pauses.
 * Always returns one {start,end} per word, monotone, inside [0,durationSec]. */
export function estimateWordTimings(words,phonemes,durationSec,{pcm,sampleRate}={}){
 if(words.length!==phonemes.length)throw new Error('Wortzahl und Phonemzahl passen nicht zusammen.');
 if(!words.length)return [];
 const weights=phonemes.map(p=>typeof p==='number'?Math.max(p,0.8):phonemeWeight(String(p)));
 const {pauses,speech}=pcm&&sampleRate?detectPauses(pcm,sampleRate):{pauses:[],speech:[0,durationSec]};
 const [speechStart,speechEnd]=speech,total=weights.reduce((a,b)=>a+b,0)||1;
 let running=0;const cumulative=weights.map(w=>(running+=w)/total);
 const boundaries=[];words.slice(0,-1).forEach((word,i)=>{if(PAUSE_PUNCT.test(word))boundaries.push(i);});
 const span=Math.max(speechEnd-speechStart,1e-6),anchors=matchPauses(boundaries,pauses,cumulative,words,speechStart,span);
 const result=[];let cursorWord=0,cursorTime=speechStart;
 for(const stop of [...[...anchors.keys()].sort((a,b)=>a-b),words.length-1]){
  const anchored=anchors.get(stop),stretchEnd=anchored?anchored[0]:speechEnd,nextTime=anchored?anchored[1]:speechEnd;
  let groupWeight=0;for(let i=cursorWord;i<=stop;i++)groupWeight+=weights[i];groupWeight||=1;
  const length=Math.max(stretchEnd-cursorTime,0);let t=cursorTime;
  for(let i=cursorWord;i<=stop;i++){const share=weights[i]/groupWeight*length;result.push([t,t+share]);t+=share;}
  cursorWord=stop+1;cursorTime=nextTime;
 }
 let floor=0;
 return result.map(([a,b])=>{const start=Math.min(Math.max(a,floor),durationSec),end=Math.min(Math.max(b,start),durationSec);floor=end;return {start,end};});
}
/* Shifts timings after leading audio was cut (seconds) and clamps to the new length. */
export function shiftTimings(timings,cutSec,durationSec){
 return timings.map(({start,end})=>({start:Math.min(durationSec,Math.max(0,start-cutSec)),end:Math.min(durationSec,Math.max(0,end-cutSec))}));
}
