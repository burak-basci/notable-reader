// Browser-side entitlement boundary. No document text/audio enters this module.
const BASE='https://reader-premium.benotable.de';
const PRIVATE_ID='bbobdmpbadoijfffgfeefcenegbbjddd',PUBLIC_ID='hgkfghgifkifgmklfgglilnmjglojonm';
const PUBLIC_SPKI='MCowBQYDK2VwAyEAphZ3UFw0hRWx515Ri0plO8q2PTFraTz3ocHMPGeISB0=';
const DONATION='https://buy.stripe.com/cNi7sM72dbaU3w6eY7aVa00';
const STORE='notable.reader.premium.v1';
let refreshTask;
export class PremiumError extends Error{constructor(code='premium_locked'){super(code);this.name='PremiumError';this.code=code;}}
function environment(){
 const protocol=globalThis.location?.protocol,id=globalThis.chrome?.runtime?.id;
 if(protocol==='https:'||protocol==='http:')return'website';
 if(protocol==='chrome-extension:'&&location.hostname===id&&[PRIVATE_ID,PUBLIC_ID].includes(id))return id===PRIVATE_ID?'private':'public';
 throw new PremiumError('premium_unavailable');
}
async function locked(task){return globalThis.navigator?.locks? navigator.locks.request(STORE,task):task();}
async function readRaw(){
 try{
  if(globalThis.chrome?.storage?.local){const result=await chrome.storage.local.get(STORE);return result[STORE]||{};}
  const raw=localStorage.getItem(STORE);return raw&&raw.length<=16384?JSON.parse(raw):{};
 }catch{throw new PremiumError('premium_unavailable');}
}
async function writeRaw(value){
 try{if(globalThis.chrome?.storage?.local)await chrome.storage.local.set({[STORE]:value});else localStorage.setItem(STORE,JSON.stringify(value));}
 catch{throw new PremiumError('premium_unavailable');}
}
async function state(){return locked(async()=>{
 let raw=await readRaw();if(!raw||typeof raw!=='object'||Array.isArray(raw))raw={};
 if(typeof raw.device!=='string'||!/^[a-f0-9]{32}$/.test(raw.device)){
  const device=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');raw={device};await writeRaw(raw);
 }
 return{device:raw.device,lease:typeof raw.lease==='string'&&raw.lease.length<=1800?raw.lease:null,nextCheck:Number.isFinite(raw.nextCheck)?raw.nextCheck:0};
});}
function decode(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))throw new PremiumError();
 try{return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));}catch{throw new PremiumError();}
}
export async function verifyLease(token,device,{allowExpired=false}={}){
 try{
  if(typeof token!=='string'||token.length>1800||typeof device!=='string'||!/^[a-f0-9]{32}$/.test(device))throw Error();
  const parts=token.split('.');if(parts.length!==3||parts[0]!=='nrp1')throw Error();
  const payload=decode(parts[1]),signature=decode(parts[2]),claims=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));
  if(signature.length!==64||!claims||claims.aud!=='notable-reader-premium'||claims.kind!=='lease'||claims.device!==device||claims.status!=='active'||!['subscription','lifetime','owner'].includes(claims.tier)||typeof claims.license!=='string'||!/^[a-f0-9]{32}$/.test(claims.license))throw Error();
  const now=Date.now()/1000;
  if(!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||claims.iat>now+120||claims.exp<=claims.iat||claims.exp>claims.iat+90000||!allowExpired&&claims.exp<=now)throw Error();
  const key=await crypto.subtle.importKey('spki',Uint8Array.from(atob(PUBLIC_SPKI),c=>c.charCodeAt(0)),{name:'Ed25519'},false,['verify']);
  if(!await crypto.subtle.verify({name:'Ed25519'},key,signature,payload))throw Error();
  return claims;
 }catch{throw new PremiumError();}
}
async function post(path,value){
 let response;
 try{response=await fetch(BASE+path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',redirect:'error',body:JSON.stringify(value),signal:AbortSignal.timeout(7000)});}catch{throw new PremiumError('premium_unavailable');}
 if([400,401,403,404,409].includes(response.status))throw new PremiumError('premium_locked');
 if(!response.ok)throw new PremiumError('premium_unavailable');
 try{
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>32768){await reader.cancel();throw Error();}chunks.push(next.value);}
  const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}const result=JSON.parse(new TextDecoder().decode(raw));
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error();return result;
 }catch{throw new PremiumError('premium_unavailable');}
}
async function native(message){
 let timer;try{return await Promise.race([chrome.runtime.sendMessage(message),new Promise(resolve=>timer=setTimeout(()=>resolve(null),23000))]);}catch{return null;}finally{clearTimeout(timer);}
}
function nativeStatus(value){
 const p=value?.premium,tier=p?.tier;
 if(!value?.ok||!p)return null;
 const enabled=p.enabled===true&&p.status==='active'&&['subscription','lifetime','owner'].includes(tier);
 const safe=entry=>{try{const u=new URL(entry);return u.origin===BASE&&!u.username&&!u.password?u.href:null;}catch{return null;}};
 return{mode:'native',enabled,status:enabled?'active':p.status==='free'?'free':'unavailable',tier:enabled?tier:null,priceLabel:'2,99 € / Monat',checkoutUrl:safe(p.checkoutUrl),lifetimeUrl:safe(p.lifetimeUrl),portalUrl:enabled&&tier==='subscription'?safe(p.portalUrl):null,accountUrl:BASE+'/account',donationUrl:DONATION};
}
function browserStatus(value,claims){
 const query='?device='+encodeURIComponent(value.device),enabled=!!claims;
 return{mode:'browser',enabled,status:enabled?'active':'free',tier:claims?.tier||null,priceLabel:'2,99 € / Monat',expires:claims?.exp||null,checkoutUrl:BASE+'/checkout'+query,lifetimeUrl:BASE+'/support'+query,portalUrl:claims?.tier==='subscription'?BASE+'/manage#'+new URLSearchParams({device:value.device,lease:value.lease}):null,accountUrl:BASE+'/account',donationUrl:DONATION};
}
async function commit(previous,lease,nextCheck){return locked(async()=>{
 const current=await readRaw();if(current?.device===previous.device&&current.lease===previous.lease){const updated={device:current.device,nextCheck};if(lease)updated.lease=lease;await writeRaw(updated);}
});}
async function renew(previous){
 if(!previous.lease)return;
 await verifyLease(previous.lease,previous.device,{allowExpired:true});
 try{
  const result=await post('/api/renew',{device:previous.device,lease:previous.lease});await verifyLease(result.lease,previous.device);await commit(previous,result.lease,Date.now()+300000);
 }catch(error){if(error.code==='premium_locked')await commit(previous,null,Date.now()+300000);else throw error;}
}
function refresh(value){if(!refreshTask)refreshTask=renew(value).finally(()=>{refreshTask=undefined;});return refreshTask;}
async function browserEntitlement({boundary=false}={}){
 let value=await state(),claims=null;
 if(value.lease){try{claims=await verifyLease(value.lease,value.device);}catch{}}
 if(value.lease&&(!claims||boundary&&value.nextCheck<=Date.now())){
  try{await refresh(value);}catch{}
  value=await state();try{claims=await verifyLease(value.lease,value.device);}catch{claims=null;}
 }else if(claims&&value.nextCheck<=Date.now())void refresh(value).catch(()=>{});
 return browserStatus(value,claims);
}
export async function getStatus(){
 const mode=environment();
 if(mode==='website')return{mode:'website',enabled:true,status:'free',tier:null,accountUrl:BASE+'/account',donationUrl:DONATION,checkoutUrl:null,lifetimeUrl:null,portalUrl:null};
 const local=mode==='private'?nativeStatus(await native({type:'premiumStatus'})):null;
 if(local?.enabled)return local;
 const browser=await browserEntitlement();return browser.enabled?browser:local||browser;
}
export async function requireExport(){
 const mode=environment();if(mode==='website')return{allowed:true,mode:'website'};
 if(mode==='private'){
  const authorized=await native({type:'authorizeExport'});
  if(authorized?.ok===true&&authorized.authorized===true)return{allowed:true,mode:'native'};
 }
 const verified=await browserEntitlement({boundary:true});if(!verified.enabled)throw new PremiumError();return{allowed:true,mode:'browser',tier:verified.tier};
}
export async function activate(code){
 const mode=environment();if(mode==='website')throw new PremiumError('activation_failed');
 if(typeof code!=='string'||!/^[A-Za-z0-9._-]{8,1800}$/.test(code.trim()))throw new PremiumError('activation_failed');
 code=code.trim();
 if(mode==='private'){
  const result=await native({type:'premiumActivate',code});
  if(result?.ok){const status=nativeStatus(result);if(status?.enabled)return status;throw new PremiumError('activation_failed');}
  if(result&&['activation_failed','premium_locked'].includes(result.code))throw new PremiumError('activation_failed');
 }
 const before=await state(),result=await post('/api/activate',{device:before.device,code});await verifyLease(result.lease,before.device);
 await locked(async()=>{const current=await readRaw();if(current?.device!==before.device)throw new PremiumError('activation_failed');await writeRaw({device:before.device,lease:result.lease,nextCheck:Date.now()+300000});});
 return getStatus();
}
export async function urls(status){const current=status||await getStatus();return Object.fromEntries(['accountUrl','checkoutUrl','lifetimeUrl','portalUrl','donationUrl'].map(key=>[key,current[key]||null]));}
