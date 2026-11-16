/* beNotable! Reader engine · device capabilities · own code MIT.
 * Pure local probes, nothing is sent anywhere. Every field is a plain fact the engine uses to choose threads and backend. */
export const MAX_THREADS=4;
/* Threads need SharedArrayBuffer, which needs cross-origin isolation (Chrome: manifest keys; Firefox extension pages: not isolated). */
/* One worker with every core up to MAX_THREADS (measured 15.11.2026, Piper Thorsten high on four cores: 2 threads RTF 0.62, 3: 0.47, 4: 0.38 = as fast as two
   workers with 2 threads each (0.37 together), with half the memory and a first sentence twice as fast). The old rule (half the cores) left half of a
   4-core laptop idle and made 1.5x impossible there. Background work hands the CPU back between sentences while the user interacts. */
export function threadCount({isolated,cores}={}){
 if(!isolated)return 1;
 return Math.max(1,Math.min(MAX_THREADS,Math.floor(cores||1)));
}
async function webgpuAdapter(scope){
 /* A fallback adapter is the CPU (SwiftShader: 1 GB buffer limit, no f16, unusably slow for these models): it counts as no WebGPU. Measured: `--enable-unsafe-webgpu` alone yields exactly this adapter. */
 try{if(!scope.navigator?.gpu?.requestAdapter)return false;const adapter=await scope.navigator.gpu.requestAdapter();if(!adapter)return false;return adapter.info?.isFallbackAdapter!==true&&adapter.isFallbackAdapter!==true;}catch{return false;}
}
/* The WebGPU runtime of the experimental stage is the JSPI build: it needs WebAssembly JSPI (Chrome 137+; Firefox has none yet). */
const jspiSupported=scope=>typeof scope.WebAssembly?.Suspending==='function'&&typeof scope.WebAssembly?.promising==='function';
async function simdSupported(){
 try{/* smallest module using a v128 instruction */
  return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));
 }catch{return false;}
}
async function opfsAvailable(scope){
 try{return typeof scope.navigator?.storage?.getDirectory==='function';}catch{return false;}
}
/* @returns {Promise<{threads:boolean,webgpu:boolean,simd:boolean,opfs:boolean,cores:number,memoryGB:number|undefined,numThreads:number}>}
 * `threads` is true only when a shared WASM memory can really be created, not merely when the API name exists. */
export async function capabilities(scope=globalThis){
 let threads=false;
 try{threads=scope.crossOriginIsolated===true&&typeof scope.SharedArrayBuffer==='function'&&new WebAssembly.Memory({initial:1,maximum:1,shared:true}).buffer instanceof scope.SharedArrayBuffer;}catch{threads=false;}
 const cores=scope.navigator?.hardwareConcurrency||1;
 const [webgpu,simd,opfs]=await Promise.all([webgpuAdapter(scope),simdSupported(),opfsAvailable(scope)]);
 return {threads,webgpu,jspi:jspiSupported(scope),simd,opfs,cores,memoryGB:scope.navigator?.deviceMemory,numThreads:threadCount({isolated:threads,cores})};
}
