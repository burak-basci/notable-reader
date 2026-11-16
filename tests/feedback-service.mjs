// Feedback endpoint contract: mocked GitHub only, simulated clock, real loopback HTTP for the transport path.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer,createFeedbackService,RateStore,LIMITS,cleanMessage,issueFor,extensionIdFromKey,loadToken} from '../server/feedback-service.mjs';

const TOKEN = 'github_pat_TESTTOKEN0123456789abcdefghijklmnopqrstuvwxyz';
const realFetchCalls = []; globalThis.fetch = (...a) => { realFetchCalls.push(a); throw new Error('real network must not be used'); };
const results = []; const check = (name, fn) => Promise.resolve().then(fn).then(() => { results.push(name); console.log('ok  ' + name); }, e => { console.error('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; });

function rig({github = 'ok', origins = ['https://reader.benotable.de'], hops = 0, file = null} = {}) {
  let t = 1_800_000_000_000; const logs = []; const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({url, init});
    if (github === 'network') throw new Error('socket hang up with ' + init.headers.Authorization);
    if (github === 'fail') return new Response(JSON.stringify({message: 'Bad credentials ' + TOKEN}), {status: 401});
    return new Response(JSON.stringify({number: 100 + calls.length}), {status: 201});
  };
  const store = new RateStore({now: () => t, file});
  const service = createFeedbackService({token: TOKEN, fetchImpl, now: () => t, store, log: l => logs.push(l), allowedOrigins: origins, trustedProxyHops: hops});
  const send = (payload, {ip = '203.0.113.7', headers = {}, raw = null, method = 'POST', url = '/v1/feedback'} = {}) => service.handle(
    {method, url, headers: {'content-type': 'application/json', origin: 'https://reader.benotable.de', ...headers}, socket: {remoteAddress: ip}},
    raw ?? Buffer.from(JSON.stringify(payload)));
  return {send, calls, logs, advance: ms => { t += ms; }, store, service};
}
const ok = {message: 'Die Wortmarkierung hängt bei langen PDFs.', consent: true, version: '2.4.0'};
const all = r => JSON.stringify([r.body, r.headers]);

await check('a) ohne Haken (consent fehlt/false/String) wird abgelehnt, GitHub nicht aufgerufen', async () => {
  const r = rig();
  for (const consent of [undefined, false, 'true', 1, null]) {
    const res = await r.send({message: ok.message, consent});
    assert.equal(res.status, 400); assert.equal(res.body.code, 'consent_required');
  }
  assert.equal(r.calls.length, 0);
  assert.equal(r.store.hits.get(r.store.key('send', '203.0.113.7')), undefined, 'abgelehnte Anfragen verbrauchen kein Sendekontingent');
});

await check('Erfolg: genau ein Issue, nur Nachrichtentext + Version, keine weiteren Daten', async () => {
  const r = rig(); const res = await r.send(ok);
  assert.equal(res.status, 201); assert.equal(res.body.ok, true); assert.equal(r.calls.length, 1);
  const {url, init} = r.calls[0]; assert.equal(url, 'https://api.github.com/repos/burak-basci/notable-reader/issues');
  const sent = JSON.parse(init.body); assert.deepEqual(Object.keys(sent).sort(), ['body', 'title']);
  assert.match(sent.body, /Wortmarkierung hängt/); assert.match(sent.body, /Version 2\.4\.0/);
  assert.equal(init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(res.body.url, 'https://github.com/burak-basci/notable-reader/issues/101');
});

await check('b) vier Nachrichten in 10 Minuten: die vierte wird mit Wartezeit abgelehnt (429)', async () => {
  const r = rig(); const codes = [];
  for (let i = 0; i < 3; i++) { codes.push((await r.send(ok)).status); r.advance(60_000); }
  const fourth = await r.send(ok); codes.push(fourth.status);
  assert.deepEqual(codes, [201, 201, 201, 429]); assert.equal(r.calls.length, 3);
  assert.equal(fourth.body.code, 'rate_limited'); assert.equal(fourth.body.limit, 3); assert.equal(fourth.body.windowSeconds, 600);
  assert.equal(fourth.body.retryAfterSeconds, 600 - 180); assert.equal(fourth.headers['Retry-After'], '420');
  console.log('    Statuscodes', codes.join(','), '· Wartezeit', fourth.body.retryAfterSeconds, 's');
});

await check('c) nach 10 Minuten wieder erlaubt (rollendes Fenster, simulierte Zeit)', async () => {
  const r = rig(); for (let i = 0; i < 3; i++) await r.send(ok);   // alle zum Zeitpunkt t0
  r.advance(599_000); assert.equal((await r.send(ok)).status, 429);
  r.advance(1_000);   assert.equal((await r.send(ok)).status, 201);
  assert.equal((await r.send(ok)).status, 201); assert.equal((await r.send(ok)).status, 201);
  assert.equal((await r.send(ok)).status, 429, 'neues Fenster: wieder genau 3, dann gesperrt');
  assert.equal(r.calls.length, 6);
});

await check('Limit gilt je Client und nicht umgehbar durch Client-Änderungen (Header, Origin, Text, X-Forwarded-For ohne Proxy)', async () => {
  const r = rig();
  for (let i = 0; i < 3; i++) await r.send({...ok, message: 'Nachricht Nummer ' + i + ' ' + 'x'.repeat(i)});
  const tricks = [{headers: {'x-forwarded-for': '198.51.100.9'}}, {headers: {'user-agent': 'anders', 'x-real-ip': '198.51.100.10'}}, {headers: {'content-type': 'application/json; charset=utf-8'}}];
  for (const t of tricks) assert.equal((await r.send({...ok, message: 'Neuer Text ' + Math.random()}, t)).status, 429);
  assert.equal((await r.send(ok, {ip: '203.0.113.8'})).status, 201, 'anderer Client hat eigenes Kontingent');
  assert.equal((await r.send(ok, {ip: '::ffff:203.0.113.7'})).status, 429, 'IPv4-mapped IPv6 ist derselbe Client');
});

await check('Hinter eigenem Proxy zählt nur der vom Proxy angehängte X-Forwarded-For-Eintrag (nicht fälschbar)', async () => {
  const r = rig({hops: 1});
  for (let i = 0; i < 3; i++) await r.send(ok, {headers: {'x-forwarded-for': `1.2.3.${i}, 198.51.100.50`}});
  assert.equal((await r.send(ok, {headers: {'x-forwarded-for': '9.9.9.9, 198.51.100.50'}})).status, 429);
});

await check('Parallele Anfragen überschreiten das Limit nicht (Reservierung vor dem await)', async () => {
  const r = rig(); const res = await Promise.all(Array.from({length: 10}, () => r.send(ok)));
  assert.equal(res.filter(x => x.status === 201).length, 3); assert.equal(r.calls.length, 3);
});

await check('Globales Stundenlimit schützt das Repo gegen verteilten Missbrauch', async () => {
  const r = rig(); let created = 0, limited = 0;
  for (let i = 0; i < 60; i++) { const res = await r.send(ok, {ip: `198.51.100.${i}`}); res.status === 201 ? created++ : limited++; }
  assert.equal(created, LIMITS.globalCount); assert.equal(limited, 60 - LIMITS.globalCount);
});

await check('GitHub-Fehler verbrauchen kein Kontingent und geben nichts von GitHub weiter', async () => {
  for (const mode of ['fail', 'network']) {
    const r = rig({github: mode}); const res = await r.send(ok);
    assert.equal(res.status, 502); assert.equal(res.body.code, 'feedback_unavailable');
    assert.ok(!all(res).includes('Bad credentials') && !all(res).includes('hang up'));
    assert.equal((r.store.hits.get(r.store.key('send', '203.0.113.7')) || []).length, 0);
  }
});

await check('Validierung: Länge, Felder, Typen, Version, Größe, Content-Type, Origin, Methode', async () => {
  const r = rig(); const st = async (p, o) => (await r.send(p, o)).status;
  assert.equal(await st({...ok, message: 'abc'}), 400);
  assert.equal(await st({...ok, message: ' \n\t '}), 400);
  assert.equal(await st({...ok, message: 'x'.repeat(2001)}), 400);
  assert.equal(await st({...ok, message: 'ä'.repeat(2000)}), 201);
  assert.equal(await st({...ok, message: 12345}), 400);
  assert.equal(await st({...ok, url: 'https://x'}), 400, 'keine Zusatzfelder (URL/Titel/Dokumenttext)');
  assert.equal(await st({...ok, title: 't'}), 400);
  assert.equal(await st({...ok, version: '2.4'}), 400);
  assert.equal(await st({...ok, version: '<script>'}), 400);
  assert.equal(await st(null, {raw: Buffer.from('{kaputt')}), 400);
  assert.equal(await st(null, {raw: Buffer.from('[1,2]')}), 400);
  assert.equal(await st(null, {raw: Buffer.alloc(LIMITS.maxBodyBytes + 1, 97)}), 400 + 13, 'Body > 8 KiB -> 413');
  assert.equal(await st(ok, {headers: {'content-type': 'text/plain'}}), 415);
  assert.equal(await st(ok, {headers: {origin: 'https://evil.example'}}), 403);
  assert.equal(await st(ok, {method: 'GET'}), 405);
  assert.equal(await st(ok, {url: '/v1/other'}), 404);
  assert.equal((await r.send(null, {method: 'OPTIONS', raw: Buffer.alloc(0)})).status, 204);
});

await check('Eingabe wird entschärft: keine @-Erwähnungen, kein HTML, Steuerzeichen raus', async () => {
  const r = rig(); await r.send({...ok, message: 'Hallo @octocat <img src=x onerror=1> #12‮\u0007 ok\n# Überschrift'});
  const sent = JSON.parse(r.calls[0].init.body);
  assert.ok(!/@(?!​)/.test(sent.body) && !sent.body.includes('<img') && !/[\u0007‮]/.test(sent.body));
  assert.ok(!/#12/.test(sent.body) && sent.body.includes('\\# Überschrift'));
  assert.ok(!/@(?!​)/.test(sent.title));
  assert.equal(cleanMessage('a\r\nb'), 'a\nb');
  assert.ok(issueFor('x'.repeat(500), null).title.length < 90);
});

await check('d) Token taucht in keiner Antwort und keinem Log auf (Erfolg, Fehler, Netzfehler, Limit, Validierung)', async () => {
  const seen = []; const logsAll = [];
  for (const mode of ['ok', 'fail', 'network']) {
    const r = rig({github: mode});
    for (let i = 0; i < 5; i++) seen.push(all(await r.send(i === 4 ? {message: ok.message} : ok)));
    seen.push(all(await r.send(null, {raw: Buffer.from(TOKEN)})));
    seen.push(all(await r.send({...ok, message: TOKEN}))); // Nutzer tippt zufällig das Token: nur in dessen eigenem Issue-Text, nie in Logs/Antwort
    logsAll.push(...r.logs);
  }
  const noToken = rig({}); noToken.service; 
  const bad = createFeedbackService({token: '', allowedOrigins: ['https://reader.benotable.de'], log: l => logsAll.push(l), fetchImpl: () => { throw Error('nie'); }});
  const miss = await bad.handle({method: 'POST', url: '/v1/feedback', headers: {'content-type': 'application/json'}, socket: {remoteAddress: '1.1.1.1'}}, Buffer.from(JSON.stringify(ok)));
  assert.equal(miss.status, 503); seen.push(all(miss));
  const stateFile = path.join(os.tmpdir(), 'fb-state-' + process.pid + '.json');
  const p = rig({file: stateFile}); await p.send(ok); logsAll.push(fs.readFileSync(stateFile, 'utf8')); fs.rmSync(stateFile, {force: true});
  assert.equal(seen.filter(s => s.includes(TOKEN)).length, 0); assert.equal(logsAll.filter(s => s.includes(TOKEN)).length, 0);
  assert.ok(!logsAll.join('\n').includes(ok.message), 'Nachrichtentext steht nicht im Log');
  assert.ok(!logsAll.join('\n').includes('203.0.113.7'), 'keine Roh-IP im Log/State');
  console.log('    geprüft: ' + seen.length + ' Antworten, ' + logsAll.length + ' Log-/State-Einträge, Treffer 0');
});

await check('Token-Laden: Env oder Credential-Datei, ungültig/leer wird abgewiesen', async () => {
  assert.equal(loadToken({READER_FEEDBACK_GITHUB_TOKEN: ' ' + TOKEN + '\n'}), TOKEN);
  assert.equal(loadToken({}), ''); assert.equal(loadToken({READER_FEEDBACK_GITHUB_TOKEN: 'kurz'}), '');
  const f = path.join(os.tmpdir(), 'fb-token-' + process.pid); fs.writeFileSync(f, TOKEN + '\n', {mode: 0o600});
  assert.equal(loadToken({READER_FEEDBACK_GITHUB_TOKEN_FILE: f}), TOKEN); fs.rmSync(f);
});

await check('Persistenz: Neustart setzt das Limit nicht zurück; State enthält nur Hashes', async () => {
  const f = path.join(os.tmpdir(), 'fb-persist-' + process.pid + '.json');
  const a = rig({file: f}); for (let i = 0; i < 3; i++) await a.send(ok);
  const t = a.store.now; const store2 = new RateStore({file: f, now: t}); const calls = [];
  const s2 = createFeedbackService({token: TOKEN, store: store2, now: t, allowedOrigins: ['https://reader.benotable.de'], fetchImpl: async () => { calls.push(1); return new Response('{"number":1}', {status: 201}); }});
  const res = await s2.handle({method: 'POST', url: '/v1/feedback', headers: {'content-type': 'application/json'}, socket: {remoteAddress: '203.0.113.7'}}, Buffer.from(JSON.stringify(ok)));
  assert.equal(res.status, 429); assert.equal(calls.length, 0); fs.rmSync(f, {force: true});
});

await check('Echter HTTP-Pfad (Loopback): CORS-Preflight, 201, 429 mit Retry-After, Body-Limit ohne Absturz', async () => {
  const logs = []; let n = 0;
  const server = createServer({token: TOKEN, fetchImpl: async () => new Response(JSON.stringify({number: ++n}), {status: 201}), allowedOrigins: ['https://reader.benotable.de'], log: l => logs.push(l)});
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
  const call = (body, headers = {}, method = 'POST') => new Promise((resolve, reject) => { const q = http.request({port, host: '127.0.0.1', path: '/v1/feedback', method, headers: {'content-type': 'application/json', origin: 'https://reader.benotable.de', ...headers}}, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: d})); }); q.on('error', reject); q.end(body); });
  const pre = await call(null, {'access-control-request-method': 'POST'}, 'OPTIONS'); assert.equal(pre.status, 204); assert.equal(pre.headers['access-control-allow-origin'], 'https://reader.benotable.de');
  const codes = []; let last; for (let i = 0; i < 4; i++) { last = await call(JSON.stringify(ok)); codes.push(last.status); }
  assert.deepEqual(codes, [201, 201, 201, 429]); assert.ok(Number(last.headers['retry-after']) > 0); assert.ok(!last.body.includes(TOKEN));
  const big = await call(Buffer.alloc(200_000, 97).toString()); assert.ok([413, 429].includes(big.status));
  server.close(); assert.ok(!logs.join('').includes(TOKEN));
});

await check('e) GitHub wurde nie erreicht und keine echten Issues erzeugt (nur Mock, globalThis.fetch nie benutzt)', async () => {
  assert.equal(realFetchCalls.length, 0);
});

await check('Extension-ID aus Manifest-Schlüssel berechenbar (CORS-Whitelist)', async () => {
  const m = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.match(extensionIdFromKey(m.key), /^[a-p]{32}$/);
});

console.log(`\n${results.length} Prüfungen grün, ${process.exitCode ? 'mit FEHLERN' : 'keine Fehler'}`);
