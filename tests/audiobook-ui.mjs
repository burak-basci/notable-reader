/* Genuine document UI -> local Piper inference -> MP3/WAV -> decoded file.
 * Cached, SHA-checked public weights avoid repeated external model downloads.
 * No speech, export, worker, encoding or file-download mocks are used. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {MODELS} from '../extension/neural-models.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.READER_PLAYWRIGHT_MODULE||'playwright-core');
const project=path.resolve(new URL('../',import.meta.url).pathname),root=process.env.READER_UI_EXPORT_ROOT||path.join(project,'releases/webapp');
const out=process.env.READER_UI_EXPORT_OUTPUT||path.join(project,'qa/audiobook-ui');
const modelRoot=process.env.READER_MODEL_FIXTURES||path.join(os.homedir(),'.cache/notable-reader-models');
const files={model:'thorsten-high.onnx',config:'thorsten-high.onnx.json'};
const fixtures=path.join(project,'tests/fixtures'),book=process.env.READER_UI_BOOK_EPUB,story=process.env.READER_UI_BOOK_TEXT;
const version=JSON.parse(fs.readFileSync(path.join(project,'extension/manifest.json'),'utf8')).version,cacheName='notable-reader-'+version;
fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'isolated-profile-'));
for(const file of MODELS.piper.files){const b=fs.readFileSync(path.join(modelRoot,files[file.role]));assert.equal(b.length,file.bytes);assert.equal(crypto.createHash('sha256').update(b).digest('hex'),file.sha256);}
const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/test-shell'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><html lang="de"><title>Isolated export acceptance</title></html>');return;}
 let file;if(u.pathname.startsWith('/test-models/')){const name=u.pathname.split('/').at(-1);if(!Object.values(files).includes(name)){res.writeHead(404).end();return;}file=path.join(modelRoot,name);}
 else file=path.resolve(root,u.pathname.slice(1)||'index.html');
 if(!file.startsWith(root+path.sep)&&!file.startsWith(modelRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':fs.statSync(file).size});fs.createReadStream(file).pipe(res);
});
const results=[],requests=[],errors=[];
await new Promise(resolve=>server.listen(47841,'127.0.0.1',resolve));let context;
try{
 context=await chromium.launchPersistentContext(profile,{headless:true,args:['--mute-audio'],acceptDownloads:true,viewport:{width:1440,height:1000}});
 // Exercise the real OPFS + download fallback, rather than a headless OS dialog.
 await context.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
 const page=context.pages()[0]||await context.newPage(),base='http://127.0.0.1:47841';
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
 await page.goto(base+'/test-shell');
 await page.evaluate(async()=>{
  const {MODELS,MODEL_CACHE}=await import('./neural-models.js'),cache=await caches.open(MODEL_CACHE),names={model:'thorsten-high.onnx',config:'thorsten-high.onnx.json'};
  for(const file of MODELS.piper.files)await cache.put(file.url,await fetch('/test-models/'+names[file.role]));
  const old=await caches.open('notable-reader-2.1.0');await old.put('/old-shell-sentinel',new Response('obsolete'));
 });
 await page.goto(base+'/?mode=audiobook');await page.waitForFunction(()=>window.notableReader&&notableModels.installed.has('piper'));
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>navigator.serviceWorker.controller);
 const upgrade=await page.evaluate(async cacheName=>({keys:await caches.keys(),assets:await (await caches.open(cacheName)).keys().then(a=>a.map(r=>new URL(r.url).pathname))}),cacheName);
 assert(!upgrade.keys.includes('notable-reader-2.1.0'));assert(upgrade.keys.includes('notable-reader-neural-models-v1'));assert(upgrade.assets.includes('/audio-export.js')&&upgrade.assets.includes('/vendor/export/lamejs.js'));assert(!upgrade.assets.some(p=>p.includes('corresponding-source')));
 results.push({check:'actual-service-worker-upgrade-retains-models-and-offline-encoder',...upgrade});
 if(book&&story){
  await page.locator('#file').setInputFiles(book);await page.waitForFunction(()=>notableReader.text.includes('THE END'));
  const expected=fs.readFileSync(story,'utf8'),norm=t=>(t.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).join('');
  // Gutenberg TXT has Cottontail where its EPUB has Cotton-tail. Compare
  // all letters/numbers in sequence, ignoring only punctuation and whitespace.
  const imported=await page.evaluate(()=>notableReader.text);assert(norm(imported).includes(norm(expected)),'the complete original narrative must appear contiguously in EPUB order');
  results.push({check:'complete-public-domain-epub-import',expectedWords:expected.trim().split(/\s+/u).length,expectedSha256:crypto.createHash('sha256').update(expected).digest('hex'),importedCharacters:imported.length});
 }
 // Cache the actual runtime through the same maintained installation path.
 await page.evaluate(()=>notableModels.install('piper'));
 await page.locator('#file').setInputFiles(path.join(fixtures,'public-reading-test.epub'));await page.waitForFunction(()=>notableReader.text.includes('Chapter One'));
 const full=await page.evaluate(()=>({text:notableReader.text,characters:notableReader.text.length,index:notableReader.index}));assert(full.text.indexOf('Chapter Two')<full.text.indexOf('Chapter One'));
 await page.locator('#rate').fill('3');await page.locator('#volume').fill('0.2');
 await page.evaluate(()=>{notableReader.seek(notableReader.chunks.length-1);window.qaRealAudio=[];notableModels.addEventListener('audio',e=>qaRealAudio.push(e.detail));});
 // After loading the app, model and engine, actual inference and downloads work
 // with all network transport offline, including a fresh reload.
 await page.reload();await page.waitForFunction(()=>notableReader&&notableModels.installed.has('piper'));await context.setOffline(true);
 await page.locator('#file').setInputFiles(path.join(fixtures,'public-reading-test.epub'));await page.waitForFunction(()=>notableReader.text.includes('Chapter One'));
 await page.evaluate(()=>{notableReader.seek(notableReader.chunks.length-1);window.qaRealAudio=[];notableModels.addEventListener('audio',e=>qaRealAudio.push(e.detail));});
 await page.locator('#export-model').selectOption('piper');
 for(const format of ['mp3','wav']){
  await page.locator('#export-format').selectOption(format);await page.locator('#start-export').click();
  await page.waitForFunction(()=>document.body.dataset.exportBusy==='true');assert(await page.locator('#file').isDisabled());assert(await page.locator('#play').isDisabled());
  await page.waitForFunction(()=>document.body.dataset.exportBusy==='false',null,{timeout:240000});
  assert(!await page.locator('#export-result').isHidden(),await page.locator('#export-status').innerText());assert((await page.locator('#export-status').innerText()).includes('vollständiges'));
  const pending=page.waitForEvent('download');await page.locator('#download-audio').click();const download=await pending,file=path.join(out,'real-ui-complete-epub.'+format);await download.saveAs(file);
  const probe=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_name,sample_rate,channels:format=duration','-of','json',file],{encoding:'utf8'});assert.equal(probe.status,0);const info=JSON.parse(probe.stdout);assert.equal(info.streams[0].codec_name,format==='mp3'?'mp3':'pcm_s16le');assert.equal(info.streams[0].channels,1);
  const decoded=spawnSync('ffmpeg',['-v','error','-i',file,'-f','f32le','-ac','1','-'],{maxBuffer:16*1024*1024});assert.equal(decoded.status,0);let peak=0;for(let i=0;i<decoded.stdout.length;i+=4)peak=Math.max(peak,Math.abs(decoded.stdout.readFloatLE(i)));assert(peak>.005);
  const state=await page.evaluate(()=>({text:notableReader.text,rate:notableReader.rate,volume:notableReader.volume,audio:qaRealAudio}));assert.equal(state.text,full.text);assert.equal(state.rate,3);assert.equal(state.volume,.2);assert(state.audio.length>0&&state.audio.every(a=>a.peak>0));
  results.push({check:'actual-ui-whole-epub-offline-export',format,characters:full.characters,fromSavedFinalPosition:true,bytes:fs.statSync(file).size,duration:Number(info.format.duration),codec:info.streams[0].codec_name,peak,realModel:'piper',audioEvents:state.audio.length});
  console.log('PASS actual-ui-whole-epub-offline-export '+format);
  await page.locator('#clear-export').click();assert(await page.locator('#export-result').isHidden());await page.evaluate(()=>{qaRealAudio=[];});
 }
 await page.locator('#start-export').click();await page.waitForFunction(()=>document.body.dataset.exportBusy==='true');await page.locator('#cancel-export').click();await page.waitForFunction(()=>document.body.dataset.exportBusy==='false');assert(await page.locator('#export-result').isHidden());assert((await page.locator('#export-status').innerText()).includes('abgebrochen'));assert(!await page.locator('#file').isDisabled());results.push({check:'real-model-export-cancel-rolls-back-ui-and-file'});
 assert(requests.every(r=>r.method==='GET'&&new URL(r.url).origin===base));assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,'actual-ui-offline-export.png'),fullPage:true});
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),results,requests,errors},null,2));console.log('AUDIOBOOK UI INTEGRATION PASSED');
}finally{await context?.close();fs.rmSync(profile,{recursive:true,force:true});await new Promise(resolve=>server.close(resolve));}
