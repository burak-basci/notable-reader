// Generated ui-locales.json is copied byte-for-byte from ../ui-locales.json.
let catalog;
export let uiLanguages = [], formatLocales = [];
let language = 'de';
export const catalogReady = fetch(new URL('./ui-locales.json', import.meta.url)).then(response => {
  if (!response.ok) throw new Error('Locale catalog unavailable');
  return response.json();
}).then(value => {
  catalog = value; uiLanguages = catalog.languages; formatLocales = catalog.formatLocales;
  language = uiLanguages.some(item => item.code === navigator.language?.split('-')[0]) ? navigator.language.split('-')[0] : 'de';
});
export const getUiLanguage = () => language;
export function setUiLanguage(value) {
  if (uiLanguages.some(item => item.code === value)) language = value;
  return language;
}
export function t(key, params = {}, selected = language) {
  const text = catalog?.messages[selected]?.[key] ?? catalog?.messages.de[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}
export function errorText(code) {
  const key = 'extError' + String(code === 'premium_locked' ? 'premium_required' : code).split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  return catalog?.messages[language]?.[key] ? t(key) : t('extErrorTitle');
}
export function translateDOM(root = document) {
  root.documentElement.lang = language;
  root.querySelectorAll('[data-i18n]').forEach(node => {node.textContent = t(node.dataset.i18n);});
  for (const [attribute, data] of [['aria-label','i18nAria'], ['title','i18nTitle'], ['placeholder','i18nPlaceholder']]) {
    root.querySelectorAll(`[data-${data.replace(/[A-Z]/g, ch => '-'+ch.toLowerCase())}]`).forEach(node => node.setAttribute(attribute,t(node.dataset[data])));
  }
}
