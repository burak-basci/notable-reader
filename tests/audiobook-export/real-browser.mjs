import {fileURLToPath} from 'node:url';
/* Actual public Kokoro FP32 ONNX inference + local MP3/WAV file export.
 * One isolated muted Chromium; public-domain complete book, never private data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {MODELS} from '../../extension/neural-models.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.READER_PLAYWRIGHT_MODULE||'playwright-core');
const project=path.resolve(fileURLToPath(new URL('../../',import.meta.url))),assets=path.join(project,'extension'),modelsRoot=process.env.READER_MODEL_FIXTURES||path.join(os.homedir(),'.cache/notable-reader-models'),reports=process.env.AUDIOBOOK_REPORT_DIR||path.join(project,'qa/audiobook-export');
const fixture=process.env.AUDIOBOOK_BOOK_PATH||fileURLToPath(new URL('./fixtures/peter-rabbit-complete-story.txt',import.meta.url));
const modelFiles={'model':'kokoro-fp32.onnx','style':'af_bella.bin','tokenizer':'kokoro-tokenizer.json'};
function decoder(file,expectedDuration){
 const probe=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_name,sample_rate,channels:format=duration,size','-of','json',file],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);const info=JSON.parse(probe.stdout);
 // Streaming decoder writes a raw temporary file instead of holding a book's
 // decoded PCM in RAM. Peak/rms are accumulated from bounded 64 KiB blocks.
 const raw=file+'.decoded.f32',decoded=spawnSync('ffmpeg',['-v','error','-y','-i',file,'-f','f32le','-ac','1',raw],{encoding:'utf8'});assert.equal(decoded.status,0,decoded.stderr);
 const descriptor=fs.openSync(raw,'r'),buffer=Buffer.alloc(65536);let samples=0,peak=0,power=0,read;try{while((read=fs.readSync(descriptor,buffer,0,buffer.length,null))){for(let i=0;i+4<=read;i+=4){const value=buffer.readFloatLE(i);assert.ok(Number.isFinite(value));peak=Math.max(peak,Math.abs(value));power+=value*value;samples++;}}}finally{fs.closeSync(descriptor);fs.unlinkSync(raw);}
 const rate=Number(info.streams[0].sample_rate),duration=samples/rate;assert.ok(peak>.005&&Math.sqrt(power/samples)>.001);assert.ok(Math.abs(duration-expectedDuration)<.3,JSON.stringify({duration,expectedDuration}));return {codec:info.streams[0].codec_name,sampleRate:rate,channels:info.streams[0].channels,decodedSamples:samples,decodedDuration:duration,peak,rms:Math.sqrt(power/samples),bytes:fs.statSync(file).size};
}
export async function realBrowserChecks(){
 await fsp.mkdir(reports,{recursive:true});const text=await fsp.readFile(fixture,'utf8'),bookSha256=crypto.createHash('sha256').update(text).digest('hex');
 assert.equal(crypto.createHash('sha256').update(text.replace(/\n$/u,'')).digest('hex'),'8df3162445d4d58b6edbf740f20d028ef9c69a5fd39288ca99dd43156dffca40','the default gate uses the complete, provenance-checked 950-word narrative, never an excerpt');
 for(const file of MODELS.kokoro.files){const bytes=await fsp.readFile(path.join(modelsRoot,modelFiles[file.role]));assert.equal(bytes.length,file.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);}
 const server=http.createServer((request,response)=>{const url=new URL(request.url,'http://localhost');if(url.pathname==='/'){response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><html lang="en"><title>Isolated audiobook acceptance</title><body>Local export acceptance</body></html>');return;}let file;if(url.pathname.startsWith('/test-models/')){const name=url.pathname.split('/').at(-1);if(!Object.values(modelFiles).includes(name)){response.writeHead(404).end();return;}file=path.join(modelsRoot,name);}else file=path.resolve(assets,url.pathname.slice(1));if(!file.startsWith(assets+path.sep)&&!file.startsWith(modelsRoot+path.sep)){response.writeHead(403).end();return;}if(!fs.existsSync(file)){response.writeHead(404).end();return;}const type=file.endsWith('.js')||file.endsWith('.mjs')?'application/javascript':file.endsWith('.json')?'application/json':file.endsWith('.wasm')?'application/wasm':'application/octet-stream';response.writeHead(200,{'Content-Type':type,'Content-Length':fs.statSync(file).size});fs.createReadStream(file).pipe(response);});
 await new Promise(resolve=>server.listen(Number(process.env.AUDIOBOOK_TEST_PORT||47839),'127.0.0.1',resolve));let browser;const requests=[],errors=[];try{
  browser=await chromium.launchPersistentContext(path.join(reports,'browser-profile'),{headless:true,args:['--mute-audio'],acceptDownloads:true});const context=browser,page=context.pages()[0]||await context.newPage();
  page.on('request',request=>requests.push({url:request.url(),method:request.method()}));page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.text().startsWith('EXPORT_PROGRESS '))console.log(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async()=>{
   const {LocalModels,MODELS}=await import('./neural-speech.js'),{AudiobookExport,audiobookChunks,clearAudiobookStorage}=await import('./audio-export.js');
   const {MODEL_CACHE}=await import('./neural-models.js'),cache=await caches.open(MODEL_CACHE),names={model:'kokoro-fp32.onnx',style:'af_bella.bin',tokenizer:'kokoro-tokenizer.json'};
   for(const file of MODELS.kokoro.files){const response=await fetch('/test-models/'+names[file.role]);if(!response.ok)throw Error('Missing hash-checked local model');await cache.put(file.url,response);}
   window.exportModels=new LocalModels();await exportModels.restore();window.exporter=new AudiobookExport({models:exportModels});window.audiobookChunks=audiobookChunks;window.clearAudiobookStorage=clearAudiobookStorage;
  });
  const results=[];
  for(const fixture of [{name:'real-local-sample',format:'wav',text:'This is a local audiobook export test. The last sentence is included.'},{name:'peter-rabbit-complete',format:'mp3',text}]){
   console.log('START_REAL_EXPORT '+fixture.name);
   const result=await page.evaluate(async fixture=>{
    const coverage=[...audiobookChunks(fixture.text)],status=[];let previous=-1;
    window.exportResult=await exporter.exportBook({text:fixture.text,modelId:'kokoro',format:fixture.format,title:fixture.name,onProgress:value=>{status.push({phase:value.phase,completedChunks:value.completedChunks,totalChunks:value.totalChunks,percent:value.percent});if(value.completedChunks!==previous){previous=value.completedChunks;console.log('EXPORT_PROGRESS '+JSON.stringify({fixture:fixture.name,chunks:previous,total:value.totalChunks,percent:value.percent}));}}});
    const {blob,cleanup,...details}=exportResult;return {...details,blobBytes:blob.size,expectedChunks:coverage.length,firstOffset:coverage[0].start,finalOffset:coverage.at(-1).end,lastPhase:status.at(-1),partialDone:status.slice(0,-1).some(value=>value.phase==='done')};
   },fixture);
   assert.equal(result.completedChunks,result.expectedChunks);assert.equal(result.totalChunks,result.expectedChunks);assert.equal(result.totalCharacters,fixture.text.length);assert.ok(!result.partialDone&&result.lastPhase.phase==='done');assert.equal(result.bytes,result.blobBytes);assert.equal(result.sampleRate,24000);assert.ok(['opfs','indexeddb'].includes(result.storage));
   const downloaded=page.waitForEvent('download');await page.evaluate(()=>{const a=document.createElement('a');a.href=URL.createObjectURL(exportResult.blob);a.download=exportResult.filename;document.body.append(a);a.click();window.exportDownloadUrl=a.href;a.remove();});const download=await downloaded,file=path.join(reports,fixture.name+'.'+fixture.format);await download.saveAs(file);
   const decoded=decoder(file,result.duration);assert.equal(decoded.codec,fixture.format==='mp3'?'mp3':'pcm_s16le');assert.equal(decoded.channels,1);results.push({fixture:fixture.name,realONNX:true,...result,decoded});
   // A ready file holds its lease; cleanup must not delete it. An orphan from a
   // crashed tab has no lock and can safely be removed through the same API.
   const storageCheck=await page.evaluate(async()=>{const before=await clearAudiobookStorage();URL.revokeObjectURL(exportDownloadUrl);await exportResult.cleanup();const directory=await navigator.storage.getDirectory(),name='notable-audiobook-orphan-acceptance',handle=await directory.getFileHandle(name,{create:true}),writer=await handle.createWritable();await writer.write('orphan acceptance');await writer.close();const cleared=await clearAudiobookStorage();return {before,cleared};});
   assert.ok(storageCheck.before.skipped>=1,'active ready audio must be protected by its Web Lock');assert.ok(storageCheck.cleared.removed>=1,'orphan audio must be removable');results.at(-1).storageCleanup=storageCheck;
   await fsp.writeFile(path.join(reports,'real-results.json'),JSON.stringify({passed:results.length===2,completeBook:results.length===2,bookSha256,bookWords:text.trim().split(/\s+/u).length,bookCharacters:text.length,results,requests,errors},null,2));
   console.log('REAL_EXPORT_DECODED '+JSON.stringify({fixture:fixture.name,chunks:result.totalChunks,duration:result.duration,bytes:result.bytes,peak:decoded.peak}));
  }
  await page.evaluate(()=>exportModels.cancelSynthesis());assert.deepEqual(errors,[]);assert.ok(requests.every(request=>request.method==='GET'&&new URL(request.url).origin===`http://127.0.0.1:${server.address().port}`));return results;
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await realBrowserChecks();
