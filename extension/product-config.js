// Public product links. Opening any of them is always an explicit user action.
const CHROME_LISTING = 'https://chromewebstore.google.com/detail/hgkfghgifkifgmklfgglilnmjglojonm';
const WEBSITE = 'https://reader.benotable.de';
export const product = Object.freeze({
  name: 'beNotable! Reader',
  website: WEBSITE,
  support: 'https://buy.stripe.com/dRmfZi3Q17YI7Mm2blaVa04',
  supportTiers: Object.freeze({month: 'https://buy.stripe.com/fZufZi9al0wg6Ii7vFaVa01', year: 'https://buy.stripe.com/bJeeVe72d4MwfeO4jtaVa02', once: 'https://buy.stripe.com/bJe9AUdqB2EoaYyaHRaVa03'}),
  supportPortal: 'https://billing.stripe.com/p/login/cNi7sM72dbaU3w6eY7aVa00',
  feedbackMail: 'burakbascidev@gmail.com',
  // Store page per browser. Edge has no Edge Add-ons listing yet; it falls back to the website (see storeLink).
  listingUrl: Object.freeze({chrome: CHROME_LISTING, firefox: null}),
});
/* Browser family of the running extension: 'firefox', 'edge' or 'chrome' (every other Chromium browser).
   Edge reports the brand "Microsoft Edge" in navigator.userAgentData and "Edg/" in its user agent string. */
export function browserKey(api = globalThis.chrome, nav = globalThis.navigator) {
  if (String(api?.runtime?.getURL?.('') || '').startsWith('moz-extension:')) return 'firefox';
  const brands = Array.isArray(nav?.userAgentData?.brands) ? nav.userAgentData.brands : [];
  if (brands.some(entry => /microsoft edge/i.test(String(entry?.brand))) || /\bEdg\//.test(String(nav?.userAgent || ''))) return 'edge';
  return 'chrome';
}
/* HTTPS link of the given product entry for the running browser, or null. Without its own store listing,
   Edge is sent to the website instead of the Chrome Web Store. */
export function storeLink(kind, api = globalThis.chrome, nav = globalThis.navigator) {
  const browser = browserKey(api, nav);
  const value = product[kind]?.[browser];
  if (typeof value === 'string' && value.startsWith('https:')) return value;
  return browser === 'edge' && kind === 'listingUrl' ? WEBSITE : null;
}
