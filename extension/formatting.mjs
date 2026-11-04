// One factory for the extension and the serialized document controls. No imports,
// external state, timezone override, speech settings, or UI-language inference.
export function createFormatting({formatLocales=[],browserLanguages=globalThis.navigator?.languages,browserLanguage=globalThis.navigator?.language}={}) {
  const allowed=new Set(formatLocales),cycles=new Set(['auto','12h','24h']);
  const canonical=value=>{try{return typeof value==='string'?Intl.getCanonicalLocales(value)[0]:null;}catch{return null;}};
  const browserLocale=canonical(browserLanguages?.[0])||canonical(browserLanguage)||Intl.DateTimeFormat().resolvedOptions().locale;
  const preferences=value=>({formatLocale:allowed.has(value?.formatLocale)?value.formatLocale:'auto',timeFormat:cycles.has(value?.timeFormat)?value.timeFormat:'auto'});
  const locale=value=>{const selected=preferences(value).formatLocale;return selected==='auto'?browserLocale:selected;};
  const number=(value,prefs,options={})=>Number.isFinite(value)?new Intl.NumberFormat(locale(prefs),options).format(value):'—';
  const clock=(value,prefs)=>{const date=value instanceof Date?value:new Date(value);if(!Number.isFinite(date.getTime()))return '—';const cycle=preferences(prefs).timeFormat;return new Intl.DateTimeFormat(locale(prefs),{hour:'2-digit',minute:'2-digit',...(cycle==='12h'?{hourCycle:'h12'}:cycle==='24h'?{hourCycle:'h23'}:{})}).format(date);};
  const duration=(value,prefs)=>{if(!Number.isFinite(value)||value<0)return '—';const seconds=Math.floor(value),n=(v,digits=1)=>number(v,prefs,{useGrouping:false,minimumIntegerDigits:digits,maximumFractionDigits:0});return seconds>=3600?n(Math.floor(seconds/3600))+':'+n(Math.floor(seconds/60)%60,2)+':'+n(seconds%60,2):n(Math.floor(seconds/60))+':'+n(seconds%60,2);};
  const regions=(uiLanguage,automaticLabel)=>{let names;try{names=new Intl.DisplayNames([uiLanguage],{type:'language',languageDisplay:'standard'});}catch{}return [...allowed].map(code=>[code,code==='auto'?automaticLabel:(()=>{try{return names?.of(code)||code;}catch{return code;}})()]);};
  return {preferences,locale,number,clock,duration,regions,browserLocale};
}
