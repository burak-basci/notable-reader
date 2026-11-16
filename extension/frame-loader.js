/* A replacement frame must never inherit a delayed capture's pending load. */
// Not awaited by the injection: session start can take seconds, readiness is polled through status.
void (async()=>{
 const pending=globalThis.__notablePendingFrameLoad;delete globalThis.__notablePendingFrameLoad;
 if(!pending||pending.token!==globalThis.__notableDocumentToken)return;
 const api=globalThis.chrome?.runtime?.id?chrome:browser,module=await import(api.runtime.getURL('session/page-session.mjs'));
 if(pending.token!==globalThis.__notableDocumentToken)return;
 await module.start({hidden:pending.hidden});
})().catch(error=>console.warn('beNotable! Reader: session start failed',error?.message));
