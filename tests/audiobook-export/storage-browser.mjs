import {fileURLToPath} from 'node:url';
/* Actual browser OPFS/IndexedDB/Web Locks tests with explicitly deterministic
 * PCM fixtures. This is storage/encoder evidence, never neural voice evidence. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.READER_PLAYWRIGHT_MODULE||'playwright-core');
const assets=fileURLToPath(new URL('../../extension/',import.meta.url)),reports=process.env.AUDIOBOOK_REPORT_DIR||fileURLToPath(new URL('../../qa/audiobook-export/',import.meta.url));
export async function storageBrowserChecks(){
 await fsp.mkdir(reports,{recursive:true});const server=http.createServer((request,response)=>{const url=new URL(request.url,'http://localhost');if(url.pathname==='/'){response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Export storage acceptance</title>');return;}const file=path.resolve(assets,url.pathname.slice(1));if(!file.startsWith(assets)||!fs.existsSync(file)){response.writeHead(404).end();return;}response.writeHead(200,{'Content-Type':'application/javascript'});fs.createReadStream(file).pipe(response);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let context;try{
  context=await chromium.launchPersistentContext(path.join(reports,'storage-profile'),{headless:true,args:['--mute-audio']});const page=context.pages()[0]||await context.newPage(),origin=`http://127.0.0.1:${server.address().port}`;await page.goto(origin);
  const idb=await page.evaluate(async()=>{
   const {AudiobookExport,clearAudiobookStorage}=await import('./audio-export.js');window.storageClear=clearAudiobookStorage;
   Object.defineProperty(navigator.storage,'getDirectory',{configurable:true,value:async()=>{throw new DOMException('Capability fixture','NotSupportedError');}});
   window.storageModels={installed:new Set(['kokoro']),async synthesize(){return{samples:Float32Array.from({length:2400},(_,i)=>Math.sin(i*.1)*.2),sampleRate:8000};}};
   window.storedResult=await new AudiobookExport({models:storageModels}).exportBook({text:'Complete deterministic storage fixture.',modelId:'kokoro',format:'wav'});
   const header=new DataView(await storedResult.blob.slice(0,44).arrayBuffer());return {kind:storedResult.storage,bytes:storedResult.bytes,blobBytes:storedResult.blob.size,mime:storedResult.blob.type,sampleRate:header.getUint32(24,true),dataBytes:header.getUint32(40,true)};
  });assert.equal(idb.kind,'indexeddb');assert.equal(idb.bytes,4844);assert.equal(idb.sampleRate,8000);assert.equal(idb.dataBytes,4800);assert.equal(idb.bytes,idb.blobBytes);assert.equal(idb.mime,'audio/wav');
  const other=await context.newPage();await other.goto(origin);const crossTab=await other.evaluate(async()=>{const {clearAudiobookStorage}=await import('./audio-export.js');return clearAudiobookStorage();});assert.ok(crossTab.skipped>=1,'another tab must not delete a ready file holding its export lease');
  await page.evaluate(()=>storedResult.cleanup());
  const orphan=await other.evaluate(async()=>{
   const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('notable-reader-audiobook-exports',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   await new Promise((resolve,reject)=>{const tx=db.transaction('parts','readwrite');tx.objectStore('parts').put(new Blob(['orphan']),['notable-audiobook-orphan-idb',0]);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
   return (await import('./audio-export.js')).clearAudiobookStorage();
  });assert.ok(orphan.removed>=1);
  const memory=await page.evaluate(async()=>{Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true});const {AudiobookExport}=await import('./audio-export.js');const result=await new AudiobookExport({models:storageModels}).exportBook({text:'Complete memory fallback.',modelId:'kokoro',format:'wav'});const value={kind:result.storage,bytes:result.bytes,blobBytes:result.blob.size};await result.cleanup();return value;});assert.equal(memory.kind,'memory');assert.equal(memory.bytes,memory.blobBytes);
  const result={passed:true,voiceEvidence:false,indexeddb:idb,crossTabLockProtection:crossTab,orphanCleanup:orphan,memory};await fsp.writeFile(path.join(reports,'storage-results.json'),JSON.stringify(result,null,2));console.log('EXPORT STORAGE CHECKS PASSED');return result;
 }finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await storageBrowserChecks();
