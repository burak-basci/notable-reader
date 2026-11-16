/* beNotable! Reader · Teilen/Empfehlen (own code, MIT). Pure functions, no state, no network, no identifier: they only BUILD the addresses a person's own click opens.
   - mailto: no recipient, subject and body percent-encoded (RFC 6068: line breaks as CRLF = %0D%0A), the whole address stays below MAILTO_MAX characters (long addresses are cut by some mail programs).
   - WhatsApp: https://wa.me/?text=<message> (opens web, desktop or app; the person chooses the chat there).
   - plain: the message as text for the clipboard (fallback when a mail program ignores the body).
   Nothing here is sent or opened; popup.js attaches the results to links and buttons that act only on a click. */
export const MAILTO_MAX = 1800;
const crlf = text => String(text).replace(/\r\n|\r|\n/g, '\r\n');
export function mailtoUrl(subject, body) {
  const make = text => 'mailto:?subject=' + encodeURIComponent(String(subject)) + '&body=' + encodeURIComponent(crlf(text));
  let url = make(body);
  /* far too long (not the case for the shipped texts): keep the last paragraph, which carries the link */
  if (url.length > MAILTO_MAX) url = make(String(body).split(/\n\s*\n/).at(-1));
  return url;
}
export const whatsappUrl = message => 'https://wa.me/?text=' + encodeURIComponent(String(message).replace(/\r\n|\r/g, '\n'));
/* t(key, vars) is the page's catalog lookup; link is the store page (or website) of THIS browser. */
export function shareTargets(t, link) {
  const subject = t('extShareSubject'), body = t('extShareBody', {link});
  return {subject, body, link, mailto: mailtoUrl(subject, body), whatsapp: whatsappUrl(body), plain: body};
}
