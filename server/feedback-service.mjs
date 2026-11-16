// Notable Reader feedback endpoint: POST /v1/feedback creates one public GitHub issue.
// Zero dependencies. The GitHub token only ever lives in this process (env or credential file).
import http from 'node:http';
import fs from 'node:fs';
import {createHmac,randomBytes,createHash} from 'node:crypto';

export const LIMITS = Object.freeze({
  maxChars: 2000, minChars: 5, maxBodyBytes: 8192,
  perClientCount: 3, windowMs: 10 * 60 * 1000,          // 3 messages per rolling 10 minutes per client
  globalCount: 40, globalWindowMs: 60 * 60 * 1000,       // repo protection against distributed abuse
  floodCount: 30, floodWindowMs: 10 * 60 * 1000,         // all requests (even invalid) per client
  githubTimeoutMs: 8000,
});
const REPO = 'burak-basci/notable-reader';
const KEYS = new Set(['message', 'consent', 'version']);
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const reply = (status, body, headers = {}) => ({status, body, headers});
const fail = (status, code, extra = {}, headers = {}) => reply(status, {ok: false, code, ...extra}, headers);

// Extension id derived from the manifest key (same value Chromium/Brave computes).
export function extensionIdFromKey(base64Key) {
  const hex = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

// Sliding-window store keyed by an HMAC of the client (never the raw address); optional atomic persistence.
export class RateStore {
  constructor({file = null, now = Date.now} = {}) {
    this.file = file; this.now = now; this.salt = randomBytes(16).toString('hex'); this.hits = new Map(); this.global = [];
    if (file) try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof saved.salt === 'string' && /^[a-f0-9]{32}$/.test(saved.salt)) this.salt = saved.salt;
      for (const [key, list] of Object.entries(saved.hits || {})) if (/^[a-f0-9]{64}$/.test(key) && Array.isArray(list)) this.hits.set(key, list.filter(Number.isFinite));
      this.global = (saved.global || []).filter(Number.isFinite);
    } catch { /* first start or unreadable state: start empty */ }
  }
  key(scope, client) { return createHmac('sha256', this.salt).update(scope + '\0' + client).digest('hex'); }
  prune(list, windowMs) { const edge = this.now() - windowMs; while (list.length && list[0] <= edge) list.shift(); return list; }
  // Returns {ok:true, release()} after reserving a slot, or {ok:false, retryAfterMs}.
  take(scope, client, count, windowMs) {
    const key = this.key(scope, client), list = this.prune(this.hits.get(key) || [], windowMs);
    if (list.length >= count) return {ok: false, retryAfterMs: Math.max(1000, list[0] + windowMs - this.now())};
    const stamp = this.now(); list.push(stamp); this.hits.set(key, list); this.save();
    return {ok: true, release: () => { const i = list.indexOf(stamp); if (i >= 0) list.splice(i, 1); this.save(); }};
  }
  takeGlobal(count, windowMs) {
    const list = this.prune(this.global, windowMs);
    if (list.length >= count) return {ok: false, retryAfterMs: Math.max(1000, list[0] + windowMs - this.now())};
    const stamp = this.now(); list.push(stamp); this.save();
    return {ok: true, release: () => { const i = list.indexOf(stamp); if (i >= 0) list.splice(i, 1); this.save(); }};
  }
  sweep() { for (const [key, list] of this.hits) if (!this.prune(list, LIMITS.windowMs * 2).length) this.hits.delete(key); }
  save() {
    if (!this.file) return;
    try {
      this.sweep(); const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({salt: this.salt, hits: Object.fromEntries(this.hits), global: this.global}), {mode: 0o600});
      fs.renameSync(tmp, this.file);
    } catch { /* state persistence is best effort; the in-memory limit stays authoritative */ }
  }
}

// Keep user text readable but harmless: no @mention notifications, no raw HTML, no cross-reference noise.
export function cleanMessage(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '').trim();
  return text;
}
export function neutralize(text) {
  return text.replace(/@/g, '@​').replace(/</g, '&lt;').replace(/#(?=\d)/g, '#​').replace(/^(\s*)([#>`|-])/gm, '$1\\$2');
}
export function issueFor(message, version) {
  const first = message.split('\n')[0].replace(/\s+/g, ' ').slice(0, 60);
  const title = 'App-Nachricht: ' + neutralize(first).replace(/^\\/, '');
  const body = neutralize(message) + '\n\n---\n_Gesendet über das Nachrichtenformular der App' + (version ? ' (Version ' + version + ')' : '') + '. Keine weiteren Daten wurden übermittelt._';
  return {title, body};
}

export function loadToken(env = process.env) {
  let token = env.READER_FEEDBACK_GITHUB_TOKEN || '';
  if (!token && env.READER_FEEDBACK_GITHUB_TOKEN_FILE) { try { token = fs.readFileSync(env.READER_FEEDBACK_GITHUB_TOKEN_FILE, 'utf8'); } catch { token = ''; } }
  token = token.trim();
  return /^[A-Za-z0-9_\-]{20,255}$/.test(token) ? token : '';
}

export function clientKey(req, hops = 0) {
  let ip = req.socket?.remoteAddress || 'unknown';
  if (hops > 0) {
    const parts = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= hops) ip = parts[parts.length - hops];   // the entry our own proxy appended
  }
  ip = ip.replace(/^::ffff:/, '');
  if (ip.includes(':')) ip = ip.split(':').slice(0, 4).join(':');   // IPv6: bucket by /64
  return ip;
}

export function createFeedbackService({token, fetchImpl = globalThis.fetch, now = Date.now, store = new RateStore({now}), log = () => {}, allowedOrigins = [], trustedProxyHops = 0, repo = REPO, apiBase = 'https://api.github.com'} = {}) {
  const origins = new Set(allowedOrigins);
  const logEvent = (event, fields = {}) => { try { log(JSON.stringify({event, ...fields})); } catch { /* logging must never break a request */ } };
  const corsHeaders = origin => origin && origins.has(origin) ? {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin'} : {Vary: 'Origin'};

  async function handle(req, rawBody) {
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return fail(403, 'origin_forbidden', {}, {Vary: 'Origin'});
    const cors = corsHeaders(origin);
    const done = r => ({...r, headers: {...cors, 'Cache-Control': 'no-store', ...r.headers}});
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/v1/feedback') return done(fail(404, 'not_found'));
    if (req.method === 'OPTIONS') return done(reply(204, null));
    if (req.method !== 'POST') return done(fail(405, 'method_not_allowed', {}, {Allow: 'POST, OPTIONS'}));
    const client = clientKey(req, trustedProxyHops);

    const flood = store.take('flood', client, LIMITS.floodCount, LIMITS.floodWindowMs);
    if (!flood.ok) return done(rateLimited(flood.retryAfterMs));

    if (!/^application\/json(\s*;|$)/i.test(String(req.headers['content-type'] || ''))) return done(fail(415, 'unsupported_media_type'));
    if (rawBody === null || rawBody.length > LIMITS.maxBodyBytes) return done(fail(413, 'body_too_large'));
    let data;
    try { data = JSON.parse(rawBody.toString('utf8')); } catch { return done(fail(400, 'invalid_json')); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !KEYS.has(k))) return done(fail(400, 'invalid_fields'));
    if (data.consent !== true) return done(fail(400, 'consent_required'));
    const message = cleanMessage(data.message);
    if (message === null) return done(fail(400, 'invalid_message'));
    const chars = [...message].length;
    if (chars < LIMITS.minChars) return done(fail(400, 'message_too_short'));
    if (chars > LIMITS.maxChars) return done(fail(400, 'message_too_long', {maxChars: LIMITS.maxChars}));
    if (data.version !== undefined && (typeof data.version !== 'string' || !VERSION.test(data.version))) return done(fail(400, 'invalid_version'));
    if (!token) { logEvent('unavailable', {reason: 'no_token'}); return done(fail(503, 'feedback_unavailable')); }

    // Reserve the slots synchronously, before any await, so parallel requests cannot exceed the limit.
    const mine = store.take('send', client, LIMITS.perClientCount, LIMITS.windowMs);
    if (!mine.ok) { logEvent('rate_limited', {scope: 'client'}); return done(rateLimited(mine.retryAfterMs)); }
    const all = store.takeGlobal(LIMITS.globalCount, LIMITS.globalWindowMs);
    if (!all.ok) { mine.release(); logEvent('rate_limited', {scope: 'global'}); return done(rateLimited(all.retryAfterMs)); }

    const {title, body} = issueFor(message, data.version);
    let response;
    try {
      response = await fetchImpl(`${apiBase}/repos/${repo}/issues`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(LIMITS.githubTimeoutMs),
        headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'notable-reader-feedback'},
        body: JSON.stringify({title, body}),
      });
    } catch { mine.release(); all.release(); logEvent('github_error', {kind: 'network'}); return done(fail(502, 'feedback_unavailable')); }
    if (!response.ok) { mine.release(); all.release(); logEvent('github_error', {status: response.status}); return done(fail(502, 'feedback_unavailable')); }
    let issue = null; try { issue = await response.json(); } catch { /* created, but unreadable answer */ }
    const number = Number.isInteger(issue?.number) ? issue.number : null;
    logEvent('issue_created', {number});
    return done(reply(201, {ok: true, issue: number, url: number ? `https://github.com/${repo}/issues/${number}` : `https://github.com/${repo}/issues`}));
  }
  function rateLimited(ms) { const s = Math.ceil(ms / 1000); return fail(429, 'rate_limited', {retryAfterSeconds: s, limit: LIMITS.perClientCount, windowSeconds: LIMITS.windowMs / 1000}, {'Retry-After': String(s)}); }
  return {handle, store};
}

export function createServer(options) {
  const service = createFeedbackService(options);
  return http.createServer((req, res) => {
    const chunks = []; let size = 0, over = false;
    req.on('data', chunk => { size += chunk.length; if (size > LIMITS.maxBodyBytes) { over = true; chunks.length = 0; } else if (!over) chunks.push(chunk); });
    req.on('error', () => res.destroy());
    req.on('end', async () => {
      let result;
      try { result = await service.handle(req, over ? null : Buffer.concat(chunks)); } catch { result = fail(500, 'internal_error'); }
      const payload = result.body === null ? '' : JSON.stringify(result.body);
      res.writeHead(result.status, {'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...result.headers});
      res.end(payload);
    });
  });
}

// Entry point: node server/feedback-service.mjs  (nothing starts on import)
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const token = loadToken();
  if (!token) { console.error('feedback: READER_FEEDBACK_GITHUB_TOKEN(_FILE) fehlt oder ist ungültig; Start abgebrochen.'); process.exit(78); }
  const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const origins = ['https://reader.benotable.de', 'chrome-extension://' + extensionIdFromKey(manifest.key), ...String(process.env.READER_FEEDBACK_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)];
  const store = new RateStore({file: process.env.READER_FEEDBACK_STATE || null});
  const server = createServer({token, store, allowedOrigins: origins, trustedProxyHops: Number(process.env.READER_FEEDBACK_PROXY_HOPS || 0), log: line => console.log(line)});
  server.listen(Number(process.env.READER_FEEDBACK_PORT || 43190), process.env.READER_FEEDBACK_HOST || '127.0.0.1');
}
