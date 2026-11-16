// All Reader functions are free. Voluntary support never changes capabilities.
export const FREE_CAPABILITIES=Object.freeze({audioExport:true,documentExport:true});
// The three previously displayed contributions, now solely voluntary support.
export const SUPPORT_TIERS=Object.freeze({month:2.99,year:29.99,once:69});
export const SUPPORT_CURRENCY='EUR';
function supportUrl(value){
 try{const url=new URL(value);return url.protocol==='https:'&&['buy.stripe.com','checkout.stripe.com'].includes(url.hostname)&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&url.pathname.length>1?url.href:null;}catch{return null;}
}
/* Three voluntary support cards of equal weight (no featured plan, no badges, no crossed-out prices): name, price,
   one true sentence on what the money helps with, the terms, and a link that opens the payment provider.
   Links are supplied by the product adapter; no account, checkout API, storage or feature mutation belongs here.
   A missing/unverified destination stays disabled. */
export function renderSupport(root,{t,lang='de',urls={}}={}){
 if(!root)return;
 const doc=root.ownerDocument,el=(tag,cls,text)=>{const node=doc.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const money=value=>new Intl.NumberFormat(lang,{style:'currency',currency:SUPPORT_CURRENCY,minimumFractionDigits:Number.isInteger(value)?0:2,maximumFractionDigits:2}).format(value);
 const plan=(kind,name,unit,line,terms)=>{
  const tile=el('div','offer-plan');tile.dataset.plan=kind;
  tile.append(el('span','offer-plan-name',name));
  const price=el('strong','offer-price',money(SUPPORT_TIERS[kind]));price.append(el('span','offer-unit',' '+unit));tile.append(price);
  tile.append(el('p','offer-line',line),el('p','offer-terms',terms));
  const link=el('a','offer-cta',t('popupSupportCta')),url=supportUrl(urls[kind]);link.setAttribute('aria-label',t('supportChoose',{plan:name}));
  if(url){link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';}
  else{link.setAttribute('role','link');link.setAttribute('aria-disabled','true');link.tabIndex=-1;link.title=t('supportUnavailable');}
  tile.append(link);return tile;
 };
 const plans=el('div','offer-plans');plans.append(
  plan('month',t('supportPlanMonth'),t('supportPerMonth'),t('popupSupportMonthLine'),t('popupSupportMonthTerms')),
  plan('year',t('supportPlanYear'),t('supportPerYear'),t('popupSupportYearLine'),t('popupSupportYearTerms')),
  plan('once',t('supportPlanOnce'),t('supportOnce'),t('popupSupportOnceLine'),t('popupSupportOnceTerms')));
 root.classList.add('offer-card');root.dataset.support='voluntary';root.replaceChildren(plans);
}
