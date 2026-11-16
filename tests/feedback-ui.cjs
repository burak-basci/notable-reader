/* Feedback form in the real MV3 popup, options page and web reader (headless Chromium, fresh profile, mocked GitHub; no network). */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{chromium}=require(process.env.READER_PLAYWRIGHT_MODULE||'playwright-core');
const extension=path.resolve(__dirname,'../extension'),out=process.env.FEEDBACK_UI_OUT||path.resolve(__dirname,'../qa/feedback-ui');fs.mkdirSync(out,{recursive:true});
const TOKEN='github_pat_UITESTTOKEN0123456789abcdefghijklmnopqrstuvwxyz';
(async()=>{
 const {createFeedbackService,RateStore}=await import('../server/feedback-service.mjs');
 let serverNow=1_800_000_000_000;const githubCalls=[],posted=[];
 const store=new RateStore({now:()=>serverNow});
 const service=createFeedbackService({token:TOKEN,store,now:()=>serverNow,allowedOrigins:[],fetchImpl:async(url,init)=>{githubCalls.push({url,body:JSON.parse(init.body)});return new Response(JSON.stringify({number:githubCalls.length}),{status:201});}});
 const web=http.createServer((q,r)=>{const f=path.join(extension,decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/,'/reader.html'));fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':f.endsWith('.json')?'application/json':'text/javascript'});r.end(d);});});
 await new Promise(r=>web.listen(0,'127.0.0.1',r));const webUrl='http://127.0.0.1:'+web.address().port+'/';
 const profile=fs.mkdtempSync(path.join(process.env.FEEDBACK_UI_PROFILES||out,'profile-'));
 const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.READER_QA_CHROME||'/usr/bin/chromium',viewport:{width:572,height:700},args:['--mute-audio',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const errors=[];let blocked=0;
 await context.route('**/*',async route=>{const url=route.request().url();
  if(url==='https://reader-premium.benotable.de/v1/feedback'){const req=route.request();posted.push(JSON.parse(req.postData()||'null'));const res=await service.handle({method:req.method(),url:'/v1/feedback',headers:{'content-type':req.headers()['content-type']},socket:{remoteAddress:'198.51.100.20'}},Buffer.from(req.postData()||''));return route.fulfill({status:res.status,headers:{'content-type':'application/json'},body:JSON.stringify(res.body)});}
  if(/^https?:\/\/(?!127\.0\.0\.1)/.test(url)){blocked++;return route.fulfill({status:403,contentType:'application/json',body:'{"ok":false,"code":"premium_locked"}'});}
  return route.continue();});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).hostname;
 const text='Die Wortmarkierung hängt bei langen PDFs.';
 async function exercise(page,label,{shot}={}){
  await page.clock.install({time:new Date(serverNow)});
  const area=page.locator('#feedback-text'),box=page.locator('#feedback-consent'),send=page.locator('#feedback-send'),status=page.locator('#feedback-status');
  await area.evaluate(n=>n.scrollIntoView({block:'center'}));
  assert.equal(await area.getAttribute('maxlength'),'2000');assert.equal(await send.isDisabled(),true,label+': leer = deaktiviert');
  await area.fill(text);assert.equal(await send.isDisabled(),true,label+': Text ohne Häkchen = deaktiviert (a)');
  assert.match(await page.locator('.feedback-consent').innerText(),/öffentlich als GitHub-Issue im Repo burak-basci\/notable-reader/);
  await box.check();assert.equal(await send.isDisabled(),false,label+': mit Häkchen aktiv');
  await box.uncheck();assert.equal(await send.isDisabled(),true);await box.check();
  if(shot)await page.screenshot({path:path.join(out,shot)});
  for(let i=1;i<=3;i++){await send.click();await status.locator('a').waitFor();assert.match(await status.innerText(),/Danke/);assert.equal(await area.inputValue(),'',label+': Feld nach Senden leer');
   if(i<3){await area.fill(text+' '+i);await box.check();serverNow+=60_000;await page.clock.fastForward(60_000);}}
  await area.fill(text+' vier');await box.check();
  assert.equal(await send.isDisabled(),true,label+': vierte Nachricht im Fenster: Senden deaktiviert (b)');assert.match(await page.locator('#feedback-quota').innerText(),/Limit erreicht.*in \d+ Minuten/);
  const wait=await page.locator('#feedback-quota').innerText();
  serverNow+=600_000-120_000;await page.clock.runFor(600_000-120_000+1000);
  assert.equal(await send.isDisabled(),false,label+': nach 10 Minuten (simulierte Zeit) wieder erlaubt (c)');
  await send.click();await page.waitForFunction(()=>/Danke/.test(document.querySelector('#feedback-status').textContent));
  return wait;}
 const results={};
 for(const [label,url,shot] of [['popup',`chrome-extension://${id}/popup.html`,'popup-support.png'],['options',`chrome-extension://${id}/options.html`,'options.png'],['web',webUrl,'web.png']]){
  const page=await context.newPage();page.on('pageerror',e=>errors.push(label+': '+e.message));
  if(label==='web')await page.addInitScript(()=>{try{localStorage.setItem('notable-reader-v2',JSON.stringify({uiLanguage:'en'}));}catch{}});
  await page.goto(url);
  if(label==='popup'){await page.locator('#tab-support').click();}
  if(label==='web'){await page.locator('#feedback-text').waitFor();assert.equal(await page.locator('#feedback-send').innerText(),'Send','Webapp folgt der Oberflächensprache (en)');await page.locator('#feedback-text').evaluate(n=>n.scrollIntoView({block:'center'}));await page.screenshot({path:path.join(out,'web-en.png')});await page.close();continue;}
  results[label]=await exercise(page,label,{shot});await page.close();
  await store.sweep();for(const k of [...store.hits.keys()])store.hits.delete(k);store.global.length=0;
 }
 // Payload = Nachrichtentext + consent + Version, nichts sonst
 assert.ok(posted.length>=8);for(const p of posted)assert.deepEqual(Object.keys(p).sort(),['consent','message','version']),assert.equal(p.consent,true),assert.equal(p.version,JSON.parse(fs.readFileSync(extension+'/manifest.json')).version);
 for(const c of githubCalls)assert.ok(!/https?:|chrome-extension/.test(c.body.body.replace(/github\.com/g,'')));
 assert.deepEqual(errors,[]);
 console.log('PASS popup/options/web; Posts',posted.length,'GitHub-Mock-Aufrufe',githubCalls.length,'externe Netzanfragen blockiert',blocked,'(alle gemockt)');
 console.log(JSON.stringify(results));
 await context.close();web.close();fs.rmSync(profile,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exit(1);});
