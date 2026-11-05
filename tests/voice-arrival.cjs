const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../extension/browser-player.mjs'),'utf8');const start=source.indexOf(' refreshVoices(){'),end=source.indexOf('\n metrics(){',start);assert(start>=0&&end>start);
const models={de:{id:'piper',kind:'piper',lang:'de',voiceURI:'notable:piper',name:'Local DE'},en:{id:'kokoro',kind:'kokoro',lang:'en',voiceURI:'notable:kokoro',name:'Local EN'}};
const ctx={MODELS:models,language:v=>String(v||'').toLowerCase(),hash:v=>v};vm.createContext(ctx);const refresh=vm.runInContext('({'+source.slice(start,end)+'}).refreshVoices',ctx);let voices=[],configured;
const target={voiceMap:new Map(),settings:{language:'auto',voice:'',rate:1,volume:1},speech:{getVoices:()=>voices},models:{installed:new Set()},getLanguage:()=> 'en',reader:{configure:v=>configured=v},update(){}};
refresh.call(target);assert.equal(configured.voice.id,'kokoro','Fresh empty browser selects matching optional EN model');
voices=[{lang:'en-US',voiceURI:'local-en',name:'Installed English',localService:true}];refresh.call(target);
const result={firstModelMatchedLanguage:true,lateSystemVoiceSelected:configured.voice.voiceURI==='local-en',selected:configured.voice.voiceURI};
if(process.env.READER_QA_OUTPUT){fs.mkdirSync(process.env.READER_QA_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.READER_QA_OUTPUT,'results.json'),JSON.stringify(result,null,2));}console.log(JSON.stringify(result));
{assert(result.lateSystemVoiceSelected,'Auto follows late available system voice without requiring a model download');target.settings.language='en';target.settings.voice='notable:kokoro';refresh.call(target);assert.equal(configured.voice.id,'kokoro','Explicit manual local model choice remains');console.log('VOICE ARRIVAL AND MANUAL CHOICE VERIFIED');}
