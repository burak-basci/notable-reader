import assert from 'node:assert/strict';
await import('../extension/core.js');
const {cleanText,chunksFor,Reader,fingerprint,textFromPdfItems}=globalThis.NotableReaderCore;
let checks=0;const check=(condition,message)=>{assert.ok(condition,message);checks++;};
for(const input of ['Ein deutscher Satz. Noch einer!\nEin Absatz?', '日本語の文章です。次の文章です！ مرحبا بالعالم.', 'Hello 👩🏽‍💻! '+ '語'.repeat(500), 'A'.repeat(800), 'Hello\u00ad world.\r\n Next.', '1.2.3 & <script>unsafe</script>', '', '\n \t']){
  const {text,chunks}=chunksFor(input);
  check(text===cleanText(input),'display and segmentation use same normalized text');
  let previous=0,joined='';
  for(const c of chunks){check(c.start>=previous,'offsets ordered');check(text.slice(c.start,c.end)===c.text,'offsets exact');check(c.text.length<=230,'bounded utterances');check(!/[\uD800-\uDBFF]$/.test(c.text),'no split surrogate');joined+=c.text;previous=c.end;}
  check(joined.replace(/\s/gu,'')===text.replace(/\s/gu,''),'all non-whitespace source characters preserved');
}
class Utterance{constructor(text){this.text=text;}}
const speech={queue:[],cancels:0,speak(u){this.queue.push(u);},cancel(){this.cancels++;}};
const states=[],positions=[],words=[];
const reader=new Reader({speech,Utterance,onstate:s=>states.push(s),onposition:i=>positions.push(i),onword:w=>words.push(w)});
reader.load('First sentence here. Second sentence there.');reader.configure({voice:{lang:'en-US',name:'test'},rate:3.25,volume:0});reader.play();
let first=speech.queue.at(-1);check(first.volume===0&&first.rate===3.25,'mute and speed passed to actual utterance');check(reader.state==='playing','playing state');
first.onboundary({charIndex:6,charLength:8});reader.pause();check(reader.state==='paused','pause state');reader.play();let resumed=speech.queue.at(-1);check(resumed.text==='sentence here.','resume from last reported word');
first.onend();check(reader.index===0,'cancelled generation cannot move position');resumed.onend();check(reader.index===1,'end advances to next chunk');
reader.seek(0);let seekUtterance=speech.queue.at(-1);check(seekUtterance.text==='First sentence here.','seek cancels and restarts desired chunk');
reader.configure({rate:4});check(speech.queue.at(-1).rate===4,'speed change applies during playback');
speech.queue.at(-1).onerror({error:'interrupted'});check(reader.state==='error','unexpected interruption is visible');
reader.stop();reader.configure({voice:null});reader.play();check(reader.state==='error'&&states.at(-1).error.includes('Stimme'),'missing voice visible');
reader.configure({voice:{lang:'en-US'}});reader.play();speech.queue.at(-1).onend();speech.queue.at(-1).onend();check(reader.state==='ended','final utterance ends');check(positions.at(-1)===0,'completion resets saved position');
check(fingerprint('one')===fingerprint('one')&&fingerprint('one')!==fingerprint('two'),'document key deterministic');
check(textFromPdfItems([{str:'First wrapped',transform:[12,0,0,12,20,700],height:12,hasEOL:true},{str:'line ends.',transform:[12,0,0,12,20,686],height:12,hasEOL:true},{str:'New paragraph.',transform:[12,0,0,12,20,650],height:12}])==='First wrapped line ends.\n\nNew paragraph.','PDF line wraps merge while paragraph gaps survive');
console.log(JSON.stringify({ok:true,checks}));
