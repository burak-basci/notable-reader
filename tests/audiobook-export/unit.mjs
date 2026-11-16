import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {AudiobookExport,audiobookChunks,audiobookFilename} from '../../extension/audio-export.js';

const reports=process.env.AUDIOBOOK_REPORT_DIR||fileURLToPath(new URL('../../qa/audiobook-export/',import.meta.url));
await fs.mkdir(reports,{recursive:true});
export async function fileSink(name){
 const target=path.join(reports,name),handle=await fs.open(target,'w');let position=0,closed=false,aborted=false,maxWrite=0;
 return {target,get aborted(){return aborted;},get maxWrite(){return maxWrite;},
  async write(value){if(value?.type==='write'){position=value.position;value=value.data;}maxWrite=Math.max(maxWrite,value.byteLength);const {bytesWritten}=await handle.write(value,0,value.byteLength,position);assert.equal(bytesWritten,value.byteLength);position+=bytesWritten;},
  async seek(value){position=value;},async close(){if(!closed){closed=true;await handle.close();}},async abort(){aborted=true;if(!closed){closed=true;await handle.close();}await fs.rm(target,{force:true});}};
}
function engine(sampleCount=8000){return {installed:new Set(['kokoro']),calls:0,active:0,maxActive:0,cancelled:0,textHash:crypto.createHash('sha256'),async synthesize(id,text,rate){assert.equal(id,'kokoro');assert.equal(rate,1);this.calls++;this.active++;this.maxActive=Math.max(this.maxActive,this.active);this.textHash.update(text.replace(/\s/gu,''));const samples=Float32Array.from({length:sampleCount},(_,i)=>Math.sin(i*.1)*.2);await Promise.resolve();this.active--;return {samples,sampleRate:8000};},cancelSynthesis(){this.cancelled++;}};}
export async function unitChecks(){
 const results=[];
 const unicode='  Heading\n\nThe first sentence. '+('A fairly long but entirely synthetic sentence with Unicode 😀 words. '.repeat(90))+' FINAL SENTENCE.\n  ';
 const chunks=[...audiobookChunks(unicode)];assert.equal(chunks.map(x=>x.text).join('').replace(/\s/gu,''),unicode.replace(/\s/gu,''));assert.ok(chunks.every(x=>x.text.length<=230&&unicode.slice(x.start,x.end)===x.text&&!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(x.text)));assert.ok(chunks.at(-1).text.endsWith('FINAL SENTENCE.'));assert.equal(audiobookFilename('../bad/name.wav','mp3'),'badname.mp3');
 results.push({check:'complete-unicode-chunk-coverage',characters:unicode.length,chunks:chunks.length});
 for(const format of ['mp3','wav']){
  const models=engine(),sink=await fileSink('deterministic-short.'+format),events=[];
  const output=await new AudiobookExport({models}).exportBook({text:unicode,modelId:'kokoro',format,title:'Deterministic fixture',sink,onProgress:value=>events.push(value)});
  assert.equal(output.completedChunks,chunks.length);assert.equal(output.samples,chunks.length*8000);assert.equal(output.bytes,(await fs.stat(sink.target)).size);assert.equal(output.blob,null);assert.equal(output.storage,'file');assert.ok(sink.maxWrite<=256*1024);assert.equal(events.at(-1).percent,100);assert.ok(events.slice(0,-1).every(x=>x.percent<100));
  if(format==='wav'){const buffer=await fs.readFile(sink.target);assert.equal(buffer.toString('ascii',0,4),'RIFF');assert.equal(buffer.readUInt32LE(40),output.samples*2);assert.equal(buffer.readUInt32LE(24),8000);assert.equal(buffer.byteLength,44+output.samples*2);}
  results.push({check:'deterministic-'+format+'-complete-file',bytes:output.bytes,samples:output.samples,chunks:output.totalChunks,maxWrite:sink.maxWrite});
 }
 // 100,000 words; PCM is deliberately deterministic, NOT a real voice proof.
 const novel=Array.from({length:20000},(_,i)=>`Section${i} has five synthetic words. `).join(''),models=engine(240),sink=await fileSink('deterministic-novel.wav');
 const expected=[...audiobookChunks(novel)].length,coverage=crypto.createHash('sha256').update(novel.replace(/\s/gu,'')).digest('hex'),heapBefore=process.memoryUsage().heapUsed;
 const output=await new AudiobookExport({models}).exportBook({text:novel,modelId:'kokoro',format:'wav',sink});
 assert.equal(models.calls,expected);assert.equal(models.maxActive,1);assert.equal(models.textHash.digest('hex'),coverage);assert.equal(output.samples,expected*240);assert.equal((await fs.stat(sink.target)).size,44+expected*480);assert.ok(sink.maxWrite<=256*1024);
 results.push({check:'deterministic-novel-all-chunks-streamed',words:novel.trim().split(/\s+/u).length,characters:novel.length,chunks:expected,samples:output.samples,bytes:output.bytes,maxConcurrentSynthesis:models.maxActive,maxWrite:sink.maxWrite,heapGrowth:process.memoryUsage().heapUsed-heapBefore,voiceEvidence:false});
 const cancelled=engine(),cancelSink=await fileSink('cancelled-must-not-exist.wav'),controller=new AbortController(),exporter=new AudiobookExport({models:cancelled});
 await assert.rejects(exporter.exportBook({text:unicode,modelId:'kokoro',format:'wav',sink:cancelSink,signal:controller.signal,onProgress:info=>{if(info.completedChunks===1)controller.abort();}}),error=>error.name==='AbortError');
 assert.ok(cancelSink.aborted);assert.equal(exporter.running,false);assert.ok(cancelled.cancelled>0);assert.equal(cancelled.calls,1);await assert.rejects(fs.stat(cancelSink.target));results.push({check:'abort-removes-unfinished-file-and-releases-engine'});
 const failing=engine();failing.synthesize=async()=>{throw Error('intentional local synthesis failure');};const failureSink=await fileSink('failed-must-not-exist.mp3');await assert.rejects(new AudiobookExport({models:failing}).exportBook({text:unicode,modelId:'kokoro',sink:failureSink}),/intentional/);assert.ok(failureSink.aborted);await assert.rejects(fs.stat(failureSink.target));results.push({check:'synthesis-error-is-not-empty-success'});
 const missing=engine();missing.installed.clear();const rejectedSink=await fileSink('unconsented-must-not-exist.mp3');await assert.rejects(new AudiobookExport({models:missing}).exportBook({text:'A complete short fixture.',modelId:'kokoro',sink:rejectedSink}),/ausdrücklich/);assert.equal(missing.calls,0);assert.ok(rejectedSink.aborted);results.push({check:'explicit-local-model-required-no-system-capture'});
 const memory=await new AudiobookExport({models:engine(800)}).exportBook({text:'Small memory fallback.',modelId:'kokoro',format:'wav'});assert.equal(memory.storage,'memory');assert.equal(memory.blob.size,memory.bytes);await memory.cleanup();results.push({check:'small-memory-fallback'});
 const commitController=new AbortController(),commitSink=await fileSink('atomic-commit.wav'),nativeClose=commitSink.close;commitSink.close=async()=>{commitController.abort();await nativeClose();};
 const committed=await new AudiobookExport({models:engine(800)}).exportBook({text:'Complete atomic commit fixture.',modelId:'kokoro',format:'wav',sink:commitSink,signal:commitController.signal});assert.equal(committed.completedChunks,committed.totalChunks);assert.equal(commitSink.aborted,false);assert.equal((await fs.stat(commitSink.target)).size,committed.bytes);results.push({check:'abort-during-atomic-close-is-complete-success-not-false-no-file'});
 const quotaSink=await fileSink('quota-must-not-exist.wav');quotaSink.write=async()=>{throw new DOMException('Quota fixture','QuotaExceededError');};await assert.rejects(new AudiobookExport({models:engine(800)}).exportBook({text:'Quota handling fixture.',modelId:'kokoro',format:'wav',sink:quotaSink}),/Speicher ist voll/);assert.ok(quotaSink.aborted);await assert.rejects(fs.stat(quotaSink.target));results.push({check:'quota-error-rolls-back-with-actionable-message'});
 for(const bad of [0,NaN]){const invalid=engine();invalid.synthesize=async()=>({samples:new Float32Array(800).fill(bad),sampleRate:8000});await assert.rejects(new AudiobookExport({models:invalid}).exportBook({text:'Meaningful speech fixture.',modelId:'kokoro',format:'wav'}),/Audiodaten/);}results.push({check:'silent-or-nonfinite-pcm-is-not-reported-as-audiobook'});
 await assert.rejects(new AudiobookExport({models:engine(8000)}).exportBook({text:novel.repeat(2),modelId:'kokoro',format:'wav'}),/32 MiB/);results.push({check:'memory-only-browser-limit-is-visible-never-truncates'});
 await fs.writeFile(path.join(reports,'unit-results.json'),JSON.stringify({passed:true,results},null,2));console.log('EXPORT UNIT CHECKS PASSED');return results;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await unitChecks();
