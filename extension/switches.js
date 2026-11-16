// Real switches (button role=switch) that keep the checkbox contract used by the settings code: .checked, 'change', disabled.
export function upgradeSwitch(node){
  if(!node||node.__switch)return node;node.__switch=true;let on=node.getAttribute('aria-checked')==='true';
  Object.defineProperty(node,'checked',{configurable:true,get:()=>on,set:value=>{on=value===true;node.setAttribute('aria-checked',String(on));}});
  node.addEventListener('click',()=>{if(node.disabled)return;node.checked=!on;node.dispatchEvent(new Event('change',{bubbles:true}));});
  return node;
}
export function upgradeSwitches(root=document){for(const node of root.querySelectorAll('button[role=switch]'))upgradeSwitch(node);}
