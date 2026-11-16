/* beNotable! Reader · system speech with source-mapped pronunciation and extra phrase pauses (MIT). */
import {Pipeline} from './pipeline.js';
import {clampRate, clampVolume, wordOffsets, cleanFx, pitchFactor} from './timeline.js';
import {cleanReading, prepareReadingSpeech, pauseAfter} from './reading-rules.js';
export class SpeechPipeline extends Pipeline {
  constructor({speech=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance,autoAdvance=true,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
    super(); Object.assign(this,{speech,Utterance,autoAdvance,setTimer,clearTimer});
    this.chunks=[];this.offsets=[];this.voice=null;this.lang='de';this.rate=1;this.volume=1;this.fx=cleanFx();this.reading=cleanReading();this.gapTimer=null;this.afterGap=null;this.chunk=0;this.base=0;this.token=0;this.stateName='idle';this.current=null;this.segment=0;this.segments=[];
  }
  get state(){return this.stateName;}
  setState(state,code){if(this.stateName===state&&!code)return;this.stateName=state;this.emit('state',{state,...(code?{code}:{})});}
  async load({chunks,lang='de',voice,startChunk=0,normalize=true,reading}) {this.stop();this.chunks=chunks;this.lang=lang;this.voice=voice;this.normalize=normalize!==false;this.reading=cleanReading(reading);this.chunk=Math.max(0,Math.min(startChunk,chunks.length-1));this.offsets=chunks.map(c=>wordOffsets(c.text,c.words||[]));this.emit('timings',{chunk:-1,kind:'none',words:[]});}
  pickVoice(){const list=this.speech?.getVoices?.()||[];return list.find(v=>v.voiceURI===this.voice?.id)||list.find(v=>v.lang?.toLowerCase().startsWith((this.voice?.lang||this.lang).slice(0,2).toLowerCase()))||null;}
  async play({chunk=this.chunk,wordIndex,rate,volume}={}) {
    if(!this.chunks.length)return;if(!this.speech||!this.Utterance)return this.setState('error','no-speech');
    /* A play already restarts speech; assign rate without setRate's running-utterance restart. */
    if(rate!==undefined)this.rate=clampRate(rate);if(volume!==undefined)this.setVolume(volume);
    this.chunk=Math.max(0,Math.min(chunk,this.chunks.length-1));this.clearGap();this.token++;this.speech.cancel();this.advanceOnResume=false;
    const source=this.chunks[this.chunk],prepared=prepareReadingSpeech(source,this.lang,{reading:this.reading,normalize:this.normalize});
    this.segments=[];this.segment=0;const first=Number.isInteger(wordIndex)&&wordIndex>0?wordIndex:0;this.base=this.offsets[this.chunk]?.[first]?.start||0;
    let text='',ranges=[];
    const flush=pauseMs=>{if(text){this.segments.push({text,ranges,pauseMs});text='';ranges=[];}};
    for(let i=0;i<(prepared?.words.length||0);i++) {const group=prepared.groups[i];if(group.last<first)continue;const word=prepared.words[i],start=text.length;text+=word+' ';ranges.push({start,end:text.length-1,first:Math.max(first,group.first),last:group.last});const ms=pauseAfter(prepared.source[group.last],this.reading,source.paragraphEnd===true&&group.last===prepared.source.length-1);if(ms)flush(ms);}
    flush(0);
    if(!this.segments.length){this.setState('playing');const token=this.token;queueMicrotask(()=>{if(token===this.token)this.finished();});return;}
    this.speakSegment();
  }
  /* Compatibility entry for callers that explicitly provide one utterance. */
  speak(text){this.segments=[{text,ranges:[],pauseMs:0}];this.segment=0;this.speakSegment();}
  speakSegment(){
    const part=this.segments[this.segment];if(!part)return this.finished();
    const token=++this.token,utterance=this.current=new this.Utterance(part.text.trimEnd()),voice=this.pickVoice();
    if(voice){utterance.voice=voice;utterance.lang=voice.lang;}else utterance.lang=this.voice?.lang||this.lang;
    utterance.rate=this.rate;utterance.volume=Math.min(1,this.volume);utterance.pitch=Math.min(2,Math.max(.5,pitchFactor(this.fx.pitch)));
    utterance.onstart=()=>{if(token===this.token){this.setState('playing');this.mark(this.wordFor(0));}};
    utterance.onboundary=e=>{if(token===this.token&&(e.name===undefined||e.name==='word'))this.mark(this.wordFor(e.charIndex));};
    utterance.onend=()=>{if(token!==this.token)return;const next=()=>{if(++this.segment<this.segments.length)this.speakSegment();else this.finished();};this.waitThen(next,part.pauseMs);};
    utterance.onerror=e=>{if(token!==this.token||['interrupted','canceled'].includes(e.error))return;this.setState('error',e.error||'speech-failed');};this.speech.speak(utterance);
  }
  mark(word){this.lastWord=word;this.emit('word',{chunk:this.chunk,word});}
  wordFor(charIndex){const ranges=this.segments[this.segment]?.ranges||[];if(!ranges.length)return this.lastWord??0;const pos=charIndex||0;let found=ranges[0];for(const range of ranges){if(range.start>pos)break;found=range;}const fraction=Math.min(.999,Math.max(0,(pos-found.start)/Math.max(1,found.end-found.start)));return found.first+Math.floor(fraction*(found.last-found.first+1));}
  waitThen(fn,ms){if(ms>0){this.afterGap=fn;this.gapTimer=this.setTimer(()=>{this.gapTimer=null;const run=this.afterGap;this.afterGap=null;if(this.stateName==='playing')run?.();else this.afterGap=run;},ms);}else if(this.stateName==='paused')this.afterGap=fn;else fn();}
  finished(){this.emit('chunkend',{chunk:this.chunk});if(!this.autoAdvance)return;if(this.stateName==='paused'){this.advanceOnResume=true;return;}if(this.chunk+1>=this.chunks.length){this.setState('ended');return;}const next=()=>this.play({chunk:this.chunk+1});this.waitThen(next,this.fx.gapMs);}
  clearGap(){if(this.gapTimer!==null)this.clearTimer(this.gapTimer);this.gapTimer=null;this.afterGap=null;}
  pause(){if(this.stateName!=='playing')return;if(this.gapTimer!==null){this.clearTimer(this.gapTimer);this.gapTimer=null;}else this.speech.pause();this.setState('paused');}
  async resume(){if(this.stateName==='paused'){this.setState('playing');if(this.afterGap){const run=this.afterGap;this.afterGap=null;run();}else if(this.advanceOnResume){this.advanceOnResume=false;return this.chunk+1>=this.chunks.length?this.setState('ended'):this.play({chunk:this.chunk+1});}else this.speech.resume();}else if(this.stateName==='ended')return this.play({chunk:0});}
  stop(){this.token++;this.clearGap();this.advanceOnResume=false;this.speech?.cancel();this.setState('idle');}
  async seek(chunk,wordIndex){return this.play({chunk,wordIndex});}
  setRate(value){const next=clampRate(value),changed=next!==this.rate;this.rate=next;if(changed&&this.stateName==='playing'&&this.current)this.play({chunk:this.chunk,wordIndex:this.lastWord??undefined});}
  setVolume(value){this.volume=clampVolume(value);}
  setFx(value){const before=this.fx;this.fx=cleanFx({...this.fx,...value});if(before.pitch!==this.fx.pitch&&this.stateName==='playing'&&this.current&&this.gapTimer===null)this.play({chunk:this.chunk,wordIndex:this.lastWord??undefined});}
  async setVoice(voice){this.voice=voice;if(this.stateName==='playing')return this.play({chunk:this.chunk,wordIndex:this.lastWord??undefined});}
  dispose(){this.stop();}
}
export const createSpeechPipeline=options=>new SpeechPipeline(options);
