/* Local install lifecycle: no counters, identifier or remote uninstall page. */
export async function registerUninstallPage(api) {try{await api.runtime.setUninstallURL('');return true;}catch{return false;}}
const installTypeOf=async api=>{try{return(await api.management.getSelf()).installType;}catch{return 'normal';}};
export async function handleInstalled(details,{api=globalThis.chrome,welcomeInDevelopment=true}={}){
 await registerUninstallPage(api);
 if(details?.reason!=='install')return 'none';
 if(!welcomeInDevelopment&&await installTypeOf(api)==='development')return 'development';
 try{await api.tabs.create({url:api.runtime.getURL('welcome.html'),active:true});return 'welcome';}catch{return 'none';}
}
