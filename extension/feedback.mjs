// "Message to the developer": creates ONE public GitHub issue through the feedback endpoint.
// Sends only the typed text, the explicit consent flag and the app version. No URL, title or document text.
const ENDPOINT = 'https://reader-premium.benotable.de/v1/feedback';
export const FEEDBACK_LIMITS = Object.freeze({maxChars: 2000, minChars: 5, count: 3, windowMs: 10 * 60 * 1000});
const STORE = 'notable.reader.feedback.v1';
const TEXT = {
  de: {h: 'Nachricht an den Entwickler', intro: 'Schreib mir direkt, was dir auffällt oder fehlt.', label: 'Deine Nachricht', ph: 'Bitte keine persönlichen Daten, Passwörter oder Dokumentinhalte eintragen.',
    consent: 'Ich verstehe: Diese Nachricht wird öffentlich als GitHub-Issue im Repo burak-basci/notable-reader erstellt und ist dort einsehbar.', send: 'Senden', sending: 'Wird gesendet …',
    meta: 'Höchstens 3 Nachrichten alle 10 Minuten. Übermittelt werden nur dein Text und die App-Version.', left: n => `Noch ${n} von 3 Nachrichten in diesem Zeitraum.`, wait: s => `Limit erreicht. Bitte in ${dur('de', s)} erneut versuchen.`,
    count: (n, m) => `${n} / ${m} Zeichen`, short: 'Bitte mindestens 5 Zeichen schreiben.', ok: 'Danke, die Nachricht wurde gesendet:', open: 'Issue ansehen', consentNeeded: 'Bitte bestätige zuerst das Häkchen.',
    unavailable: 'Senden ist gerade nicht möglich. Bitte später erneut versuchen.', invalid: 'Die Nachricht wurde nicht akzeptiert. Bitte Text prüfen.', big: 'Die Nachricht ist zu lang.', min: 'Minute', mins: 'Minuten', sec: 'Sekunden'},
  en: {h: 'Message to the developer', intro: 'Tell me directly what you notice or miss.', label: 'Your message', ph: 'Please do not include personal data, passwords or document content.',
    consent: 'I understand: this message will be created publicly as a GitHub issue in the repo burak-basci/notable-reader and can be read there.', send: 'Send', sending: 'Sending …',
    meta: 'At most 3 messages every 10 minutes. Only your text and the app version are sent.', left: n => `${n} of 3 messages left in this period.`, wait: s => `Limit reached. Please try again in ${dur('en', s)}.`,
    count: (n, m) => `${n} / ${m} characters`, short: 'Please write at least 5 characters.', ok: 'Thanks, your message was sent:', open: 'View issue', consentNeeded: 'Please tick the checkbox first.',
    unavailable: 'Sending is not possible right now. Please try again later.', invalid: 'The message was not accepted. Please check the text.', big: 'The message is too long.', min: 'minute', mins: 'minutes', sec: 'seconds'},
  fr: {h: 'Message au développeur', intro: 'Dis-moi directement ce que tu remarques ou ce qui manque.', label: 'Ton message', ph: 'N’indique ni données personnelles, ni mots de passe, ni contenu de document.',
    consent: 'Je comprends : ce message sera créé publiquement comme ticket GitHub dans le dépôt burak-basci/notable-reader et y sera visible.', send: 'Envoyer', sending: 'Envoi …',
    meta: 'Au plus 3 messages toutes les 10 minutes. Seuls ton texte et la version de l’app sont envoyés.', left: n => `Encore ${n} message(s) sur 3 sur cette période.`, wait: s => `Limite atteinte. Réessaie dans ${dur('fr', s)}.`,
    count: (n, m) => `${n} / ${m} caractères`, short: 'Écris au moins 5 caractères.', ok: 'Merci, le message a été envoyé :', open: 'Voir le ticket', consentNeeded: 'Coche d’abord la case.',
    unavailable: 'L’envoi est impossible pour le moment. Réessaie plus tard.', invalid: 'Le message n’a pas été accepté. Vérifie le texte.', big: 'Le message est trop long.', min: 'minute', mins: 'minutes', sec: 'secondes'},
  es: {h: 'Mensaje al desarrollador', intro: 'Dime directamente qué notas o qué falta.', label: 'Tu mensaje', ph: 'No incluyas datos personales, contraseñas ni contenido de documentos.',
    consent: 'Entiendo: este mensaje se creará públicamente como incidencia de GitHub en el repositorio burak-basci/notable-reader y se podrá leer allí.', send: 'Enviar', sending: 'Enviando …',
    meta: 'Como máximo 3 mensajes cada 10 minutos. Solo se envían tu texto y la versión de la app.', left: n => `Quedan ${n} de 3 mensajes en este periodo.`, wait: s => `Límite alcanzado. Inténtalo de nuevo en ${dur('es', s)}.`,
    count: (n, m) => `${n} / ${m} caracteres`, short: 'Escribe al menos 5 caracteres.', ok: 'Gracias, el mensaje se envió:', open: 'Ver incidencia', consentNeeded: 'Marca primero la casilla.',
    unavailable: 'Ahora no se puede enviar. Inténtalo más tarde.', invalid: 'No se aceptó el mensaje. Revisa el texto.', big: 'El mensaje es demasiado largo.', min: 'minuto', mins: 'minutos', sec: 'segundos'},
  it: {h: 'Messaggio allo sviluppatore', intro: 'Scrivimi direttamente cosa noti o cosa manca.', label: 'Il tuo messaggio', ph: 'Non inserire dati personali, password o contenuti di documenti.',
    consent: 'Capisco: questo messaggio verrà creato pubblicamente come issue GitHub nel repository burak-basci/notable-reader e sarà visibile lì.', send: 'Invia', sending: 'Invio …',
    meta: 'Al massimo 3 messaggi ogni 10 minuti. Vengono inviati solo il testo e la versione dell’app.', left: n => `Ancora ${n} messaggi su 3 in questo periodo.`, wait: s => `Limite raggiunto. Riprova tra ${dur('it', s)}.`,
    count: (n, m) => `${n} / ${m} caratteri`, short: 'Scrivi almeno 5 caratteri.', ok: 'Grazie, il messaggio è stato inviato:', open: 'Vedi issue', consentNeeded: 'Spunta prima la casella.',
    unavailable: 'Invio al momento non possibile. Riprova più tardi.', invalid: 'Messaggio non accettato. Controlla il testo.', big: 'Il messaggio è troppo lungo.', min: 'minuto', mins: 'minuti', sec: 'secondi'},
  pt: {h: 'Mensagem ao desenvolvedor', intro: 'Diz-me diretamente o que notas ou o que falta.', label: 'A tua mensagem', ph: 'Não incluas dados pessoais, palavras-passe nem conteúdo de documentos.',
    consent: 'Compreendo: esta mensagem será criada publicamente como issue do GitHub no repositório burak-basci/notable-reader e poderá ser lida lá.', send: 'Enviar', sending: 'A enviar …',
    meta: 'No máximo 3 mensagens a cada 10 minutos. Só são enviados o teu texto e a versão da app.', left: n => `Restam ${n} de 3 mensagens neste período.`, wait: s => `Limite atingido. Tenta novamente dentro de ${dur('pt', s)}.`,
    count: (n, m) => `${n} / ${m} caracteres`, short: 'Escreve pelo menos 5 caracteres.', ok: 'Obrigado, a mensagem foi enviada:', open: 'Ver issue', consentNeeded: 'Marca primeiro a caixa.',
    unavailable: 'De momento não é possível enviar. Tenta mais tarde.', invalid: 'A mensagem não foi aceite. Verifica o texto.', big: 'A mensagem é demasiado longa.', min: 'minuto', mins: 'minutos', sec: 'segundos'},
};
function dur(lang, seconds) {
  const s = Math.max(1, Math.ceil(seconds)), m = Math.floor(s / 60), r = s % 60, x = TEXT[lang] || TEXT.en;
  return m >= 1 ? `${m} ${m === 1 ? x.min : x.mins}${r ? ` ${r} ${x.sec}` : ''}` : `${s} ${x.sec}`;
}
const pick = lang => TEXT[String(lang || '').slice(0, 2).toLowerCase()] || TEXT.en;

// Local view of the quota (display only). The server enforces the limit; its 429 answer wins.
function readStamps(storage, now) {
  try { const v = JSON.parse(storage?.getItem(STORE) || '[]'); return (Array.isArray(v) ? v : []).filter(n => Number.isFinite(n) && n > now - FEEDBACK_LIMITS.windowMs && n <= now); } catch { return []; }
}
function writeStamps(storage, list) { try { storage?.setItem(STORE, JSON.stringify(list.slice(-FEEDBACK_LIMITS.count))); } catch { /* storage may be blocked */ } }
export function localQuota(stamps, now) {
  const left = Math.max(0, FEEDBACK_LIMITS.count - stamps.length);
  return {left, waitSeconds: left ? 0 : Math.ceil((stamps[0] + FEEDBACK_LIMITS.windowMs - now) / 1000)};
}
export function feedbackPayload(message, consent, version) {
  const payload = {message: String(message), consent: consent === true};
  if (typeof version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version)) payload.version = version;
  return payload;
}

export function mountFeedback(root, {lang = 'de', version = '', endpoint = ENDPOINT, fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now(), storage = (() => { try { return globalThis.localStorage; } catch { return null; } })(), idPrefix = 'feedback'} = {}) {
  const doc = root.ownerDocument, x = pick(lang), el = (tag, props = {}, ...kids) => { const n = doc.createElement(tag); Object.assign(n, props); n.append(...kids); return n; };
  const id = name => `${idPrefix}-${name}`;
  const text = el('textarea', {id: id('text'), maxLength: FEEDBACK_LIMITS.maxChars, rows: 4, placeholder: x.ph, autocomplete: 'off'}); text.spellcheck = true; text.setAttribute('aria-describedby', id('count'));
  const count = el('span', {id: id('count')}), check = el('input', {id: id('consent'), type: 'checkbox'}), send = el('button', {type: 'submit', id: id('send'), textContent: x.send, disabled: true});
  const status = el('p', {id: id('status'), className: 'feedback-status', role: 'status'}); status.setAttribute('aria-live', 'polite');
  const quota = el('p', {className: 'feedback-meta', id: id('quota')});
  const form = el('form', {noValidate: true}, el('label', {htmlFor: id('text'), textContent: x.label}), text,
    el('div', {className: 'feedback-row'}, count),
    el('label', {className: 'feedback-consent', htmlFor: id('consent')}, check, el('span', {textContent: x.consent})),
    el('div', {className: 'feedback-row'}, send, quota), status);
  const card = el('section', {className: 'feedback-card'}, el('h3', {textContent: x.h, id: id('heading')}), el('p', {className: 'feedback-intro', textContent: x.intro}), el('p', {className: 'feedback-meta', textContent: x.meta}), form);
  card.setAttribute('aria-labelledby', id('heading')); root.replaceChildren(card);
  let busy = false, timer = null, blockedUntil = 0;
  const say = (message, kind = '') => { status.textContent = message; status.dataset.kind = kind; };
  function refresh() {
    const t = now(), q = localQuota(readStamps(storage, t), t), serverWait = Math.max(0, Math.ceil((blockedUntil - t) / 1000)), wait = Math.max(q.waitSeconds, serverWait);
    const chars = [...text.value].length; count.textContent = x.count(chars, FEEDBACK_LIMITS.maxChars);
    quota.textContent = wait ? x.wait(wait) : x.left(q.left);
    send.disabled = busy || !check.checked || wait > 0 || chars < FEEDBACK_LIMITS.minChars;
    clearTimeout(timer); if (wait) timer = setTimeout(refresh, Math.min(wait, 15) * 1000);
  }
  for (const n of [text, check]) n.addEventListener('input', refresh), n.addEventListener('change', refresh);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    if (!check.checked) return say(x.consentNeeded, 'error');
    if ([...text.value].length < FEEDBACK_LIMITS.minChars) return say(x.short, 'error');
    busy = true; send.textContent = x.sending; say(''); refresh();
    try {
      const response = await fetchImpl(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', body: JSON.stringify(feedbackPayload(text.value, check.checked, version)), signal: AbortSignal.timeout(12000)});
      let data = null; try { data = await response.json(); } catch { /* non-JSON error page */ }
      if (response.status === 201 && data?.ok) {
        const t = now(); writeStamps(storage, [...readStamps(storage, t), t]); text.value = ''; check.checked = false;
        const link = typeof data.url === 'string' && /^https:\/\/github\.com\/burak-basci\/notable-reader\/issues(\/\d+)?$/.test(data.url) ? el('a', {href: data.url, target: '_blank', rel: 'noopener noreferrer', textContent: x.open}) : null;
        status.textContent = x.ok + ' '; status.dataset.kind = 'ok'; if (link) status.append(link);
      } else if (response.status === 429) {
        blockedUntil = now() + Math.max(1, Number(data?.retryAfterSeconds) || 60) * 1000; say(x.wait(Math.max(1, Number(data?.retryAfterSeconds) || 60)), 'error');
      } else if (response.status === 413 || data?.code === 'message_too_long') say(x.big, 'error');
      else if (response.status === 400) say(data?.code === 'consent_required' ? x.consentNeeded : x.invalid, 'error');
      else say(x.unavailable, 'error');
    } catch { say(x.unavailable, 'error'); }
    busy = false; send.textContent = x.send; refresh();
  });
  refresh();
  return {destroy() { clearTimeout(timer); root.replaceChildren(); }, refresh, elements: {text, check, send, status, form}};
}
