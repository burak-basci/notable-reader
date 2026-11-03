/* Isolated error-path regression; fixture cache, no model download or synthesis. */
import assert from 'node:assert/strict';
import {LocalModels} from '../extension/neural-speech.js';
const originals={caches:globalThis.caches,location:globalThis.location,isSecureContext:globalThis.isSecureContext,fetch:globalThis.fetch};
let requests=0,checks=0;
try{
 globalThis.location={protocol:'chrome-extension:'};globalThis.isSecureContext=true;
 globalThis.fetch=async()=>{requests++;throw Error('Unexpected network request in isolated cache regression');};
 for(const name of ['QuotaExceededError','SecurityError']){
  let attempts=0;globalThis.caches={open:async()=>{attempts++;if(attempts===1)throw new DOMException('Lokaler Speicher vorübergehend nicht verfügbar.',name);return {match:async()=>new Response('public fixture, not a speech model')};}};
  const models=new LocalModels(),messages=[];models.addEventListener('status',event=>messages.push(event.detail));
  await assert.rejects(()=>models.install('piper'),error=>error.name===name);checks++;
  assert.equal(models.downloading,false,name+' must reset the in-progress flag');checks++;
  assert.equal(models.abort,null,name+' must release the abort controller');checks++;
  assert.ok(messages.some(message=>message.error&&message.message.includes('Speicher')),name+' must emit a visible error status');checks++;
  await models.install('piper');assert.equal(attempts,2,name+' must allow a second cache-open attempt');checks++;
  assert.ok(models.installed.has('piper'));assert.equal(models.downloading,false);checks+=2;
 }
 assert.equal(requests,0);checks++;
 console.log(JSON.stringify({passed:true,checks,errors:['QuotaExceededError','SecurityError'],networkRequests:requests,realInferenceTest:false}));
}finally{for(const [key,value]of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
