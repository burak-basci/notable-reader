import assert from 'node:assert/strict';
import {LocalModels} from '../../extension/neural-speech.js';
const originals={caches:globalThis.caches,Worker:globalThis.Worker};
let release,opened,workers=0;const reached=new Promise(resolve=>opened=resolve),gate=new Promise(resolve=>release=resolve);
const cache={match:async url=>({json:async()=>({}),arrayBuffer:async()=>new ArrayBuffer(4)})};
let hold=true,holdSpeech=false,waiting;
globalThis.caches={open:async()=>{if(hold){opened();await gate;hold=false;}return cache;},delete:async()=>true};
class FakeWorker extends EventTarget{
 constructor(){super();workers++;this.closed=false;}
 terminate(){this.closed=true;}
 postMessage(message){if(holdSpeech&&message.action==='synthesize'){waiting();return;}queueMicrotask(()=>{if(!this.closed)this.dispatchEvent(new MessageEvent('message',{data:{id:message.id,ok:true,samples:new Float32Array(800),sampleRate:8000,sampleCount:800,duration:.1,peak:.2}}));});}
}
globalThis.Worker=FakeWorker;
try{
 const models=new LocalModels();models.installed.add('piper');
 const work=models.synthesize('piper','A synthetic cancellation fixture.',1).then(()=>({succeeded:true}),error=>({error}));
 await reached;await models.clear();release();const result=await work;
 assert.ok(result.error,'clearing models must invalidate pending initialization instead of synthesizing stale audio');
 assert.equal(workers,0,'stale initializer must not create a worker after clear');
 assert.equal(typeof models.cancelSynthesis,'function');models.installed.add('piper');
 const audio=await models.synthesize('piper','Retry fixture.',1);assert.equal(audio.sampleCount,800);
 holdSpeech=true;const started=new Promise(resolve=>waiting=resolve),inflight=models.synthesize('piper','In-flight cancellation fixture.',1).then(()=>({success:true}),error=>({error}));await started;const worker=models.worker;models.cancelSynthesis();const cancelled=await inflight;assert.ok(cancelled.error);assert.ok(worker.closed);assert.equal(models.requests.size,0);assert.equal(models.worker,null);
 holdSpeech=false;const retried=await models.synthesize('piper','Retry after active cancellation.',1);assert.equal(retried.sampleCount,800);models.cancelSynthesis();
 console.log('MODEL CANCELLATION PASSED');
}finally{globalThis.caches=originals.caches;globalThis.Worker=originals.Worker;}
