/* Voluntary support only. No SDK, provider request, storage, or payment is made here.
 * Stripe's public prefilled_amount parameter is in the price currency's cents:
 * https://docs.stripe.com/payment-links/customize#customize-checkout-with-url-parameters */
/* Stripe checkout locales the support link passes on; labels come from the shared catalog (t). */
const LOCALES=new Set(['de','en','fr','es','it','pt']);
export function supportAmountCents(value){
 const text=String(value??'').trim();if(!/^\d{1,5}(?:[.,]\d{1,2})?$/u.test(text))return null;
 const [whole,fraction='']=text.replace(',','.').split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return Number.isSafeInteger(cents)&&cents>=50&&cents<=1000000?cents:null;
}
export function supportAmountUrl(base,cents,locale='en'){
 try{const url=new URL(base);if(url.protocol!=='https:'||url.hostname!=='buy.stripe.com'||url.username||url.password||url.port||url.search||url.hash||!/^\/[A-Za-z0-9]+$/u.test(url.pathname)||!Number.isSafeInteger(cents)||cents<50||cents>1000000)return null;url.searchParams.set('prefilled_amount',String(cents));url.searchParams.set('locale',LOCALES.has(locale)?locale:'en');return url.href;}catch{return null;}
}
export function mountSupportAmount(host,{base,language=()=> 'en',t=key=>key}={}){
 if(!host)return null;const doc=host.ownerDocument,el=tag=>doc.createElement(tag),form=el('form'),heading=el('h4'),label=el('label'),labelText=el('span'),field=el('span'),input=el('input'),currency=el('span'),link=doc.getElementById('support-link')||el('a'),hint=el('p'),error=el('p');
 form.className='support-custom';form.noValidate=true;heading.id='support-custom-heading';form.setAttribute('aria-labelledby',heading.id);input.id='support-amount';input.type='text';input.inputMode='decimal';input.autocomplete='off';input.maxLength=9;input.value='5';input.setAttribute('aria-describedby','support-amount-hint support-amount-error');currency.textContent='EUR';currency.setAttribute('aria-hidden','true');field.className='support-amount-field';field.append(input,currency);label.htmlFor=input.id;label.append(labelText,field);link.id='support-link';link.dataset.customAmount='';link.removeAttribute('data-free');link.className='donation-cta';link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';hint.id='support-amount-hint';hint.className='copy';error.id='support-amount-error';error.className='support-amount-error';error.setAttribute('role','alert');error.hidden=true;form.append(heading,label,link,hint,error);host.append(form);
 let touched=false;const locale=()=>String(language()).split('-')[0];
 function sync(){const cents=supportAmountCents(input.value),url=cents===null?null:supportAmountUrl(base,cents,locale());heading.textContent=t('popupSupportOwnTitle');labelText.textContent=t('popupSupportOwnAmount');link.textContent=t('popupSupportCta');link.setAttribute('aria-label',t('popupSupportOwnAction'));hint.textContent=t('popupSupportOwnHint');error.textContent=t('popupSupportOwnInvalid');error.hidden=!touched||url!==null;input.setAttribute('aria-invalid',String(touched&&!url));if(url){link.href=url;link.removeAttribute('aria-disabled');}else{link.removeAttribute('href');link.setAttribute('aria-disabled','true');}}
 function validate(event){sync();if(!link.hasAttribute('href')){event.preventDefault();touched=true;sync();input.focus();return false;}return true;}
 input.addEventListener('input',()=>{touched=true;sync();});input.addEventListener('blur',()=>{touched=true;sync();});link.addEventListener('click',validate);form.addEventListener('submit',event=>{event.preventDefault();if(validate(event))link.click();});sync();return{refresh:sync};
}
