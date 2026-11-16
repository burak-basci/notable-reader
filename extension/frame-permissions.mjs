/* Optional embedded-source access. Only a trusted click requests the displayed hosts. */
const TEXT={
 de:{title:'Zugriff auf eingebetteten Text nötig',allow:'Zugriff erlauben',continue:'Zugriff erlauben und fortfahren',info:'Der Text liegt in einer eingebetteten Website. Erlaube den Zugriff auf: ',metadata:'Damit der Reader das eingebettete Dokument gezielt findet, fragt der Browser nach einer zusätzlichen Berechtigung.',denied:'Ohne deine Freigabe bleibt der eingebettete Text geschützt.',changed:'Die Seite hat sich geändert. Starte die gewünschte Aktion auf der aktuellen Seite erneut.'},
 en:{title:'Access to embedded text is needed',allow:'Allow access',continue:'Allow access and continue',info:'The text is on an embedded website. Allow access to: ',metadata:'The browser will ask for an additional permission so the Reader can locate the embedded document.',denied:'Without your permission the embedded text remains protected.',changed:'The page has changed. Start the action again on the current page.'},
 fr:{title:'Accès au texte intégré nécessaire',allow:'Autoriser l’accès',continue:'Autoriser l’accès et continuer',info:'Le texte se trouve sur un site intégré. Autorisez l’accès à : ',metadata:'Le navigateur demandera une autorisation supplémentaire pour localiser le document intégré.',denied:'Sans votre autorisation, le texte intégré reste protégé.',changed:'La page a changé. Relancez l’action sur la page actuelle.'},
 es:{title:'Se necesita acceso al texto integrado',allow:'Permitir acceso',continue:'Permitir acceso y continuar',info:'El texto está en un sitio web integrado. Permite acceso a: ',metadata:'El navegador solicitará un permiso adicional para localizar el documento integrado.',denied:'Sin tu permiso, el texto integrado permanece protegido.',changed:'La página ha cambiado. Inicia de nuevo la acción en la página actual.'},
 it:{title:'È necessario l’accesso al testo incorporato',allow:'Consenti accesso',continue:'Consenti accesso e continua',info:'Il testo si trova su un sito incorporato. Consenti accesso a: ',metadata:'Il browser chiederà un’autorizzazione aggiuntiva per individuare il documento incorporato.',denied:'Senza il tuo consenso, il testo incorporato resta protetto.',changed:'La pagina è cambiata. Avvia di nuovo l’azione sulla pagina attuale.'},
 pt:{title:'É necessário acesso ao texto incorporado',allow:'Permitir acesso',continue:'Permitir acesso e continuar',info:'O texto está num site incorporado. Permite acesso a: ',metadata:'O navegador pedirá uma autorização adicional para localizar o documento incorporado.',denied:'Sem a tua autorização, o texto incorporado continua protegido.',changed:'A página mudou. Inicia novamente a ação na página atual.'}
};
function cleanAccess(value){
 if(!value||typeof value!=='object')return null;
 const origins=[...new Set((Array.isArray(value.origins)?value.origins:[]).filter(pattern=>{try{const u=new URL(pattern);return ['http:','https:'].includes(u.protocol)&&!u.hostname.includes('*')&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.pathname==='/*';}catch{return false;}}))].sort();
 return origins.length||value.needsNavigation===true?{origins,needsNavigation:value.needsNavigation===true}:null;
}
export function framePermissionUI({root,api,language,current,prepare,notify,hasPending=()=>false,busy=()=>false,onStale=()=>{}}){
 let access=null,revision=0,requesting=false,signature='';const labels=()=>TEXT[String(language()).split('-')[0]]||TEXT.en,button=root?.querySelector('button'),info=root?.querySelector('p'),doc=root?.ownerDocument;
 const title=doc?.createElement('h3');if(root){title.id=(root.id||'embedded-access')+'-title';root.prepend(title);root.setAttribute('role','region');root.setAttribute('aria-labelledby',title.id);button.type='button';}
 function paint(){if(!root)return;root.hidden=!access;title.textContent=labels().title;button.disabled=requesting||busy();button.textContent=hasPending()?labels().continue:labels().allow;info.textContent=access?(access.needsNavigation?labels().metadata:labels().info+access.origins.map(x=>new URL(x).host).join(', ')):'';}
 function reveal(){if(!root||!access)return;root.closest('.body')?.scrollTo({top:0,behavior:'instant'});root.scrollIntoView({block:'start',behavior:'instant'});button.focus({preventScroll:true});}
 function update(value,{show=false}={}){const next=cleanAccess(value),key=JSON.stringify(next);if(key!==signature){revision++;signature=key;}access=next;paint();if(show)reveal();}
 button?.addEventListener('click',()=>{
  if(!access||requesting||busy())return;const expected={...current()},version=revision,request={...(access.origins.length?{origins:[...access.origins]}:{}),...(access.needsNavigation?{permissions:['webNavigation']}:{})};requesting=true;paint();
  // The request must run directly inside this trusted click, before any await.
  let permission;try{permission=api.permissions.request(request);}catch{requesting=false;paint();notify(labels().denied);return;}
  void Promise.resolve(permission).then(async granted=>{
   if(!granted){notify(labels().denied);return;}
   const tab=await api.tabs.get(expected.tabId).catch(()=>null);
   if(version!==revision||!tab?.active||tab.url!==expected.url){onStale();notify(labels().changed);return;}
   if(!await api.permissions.contains(request)){notify(labels().denied);return;}
   await prepare(expected);
  }).catch(()=>notify(labels().denied)).finally(()=>{requesting=false;paint();if(access)reveal();});
 });return {update,reveal,hasAccess:()=>!!access};
}
