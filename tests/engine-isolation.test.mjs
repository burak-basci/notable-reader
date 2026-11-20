// node tests/engine-isolation.test.mjs : only the engine host navigation and worker scripts of the own origin get the isolation headers
import assert from 'node:assert/strict';
import {isolatesRequest, withIsolationHeaders} from '../extension/platform/engine-isolation.mjs';
const O = 'https://ext.test';   // Node gives chrome-extension:// URLs the origin 'null'; Chrome gives them their own origin
const req = (url, mode = 'no-cors', destination = '') => ({url, mode, destination});
assert.equal(isolatesRequest(req(O + '/session/host.html', 'navigate', 'document'), O), true, 'engine host document');
assert.equal(isolatesRequest(req(O + '/session/host.html?x=1', 'navigate', 'document'), O), true, 'query string');
assert.equal(isolatesRequest(req(O + '/popup.html', 'navigate', 'document'), O), false, 'popup stays');
assert.equal(isolatesRequest(req(O + '/tools/reader/reader.html', 'navigate', 'document'), O), false, 'file view stays');
assert.equal(isolatesRequest(req(O + '/sidebar.html', 'navigate', 'document'), O), false, 'side panel stays');
assert.equal(isolatesRequest(req(O + '/engine/worker/tts-worker.js', 'same-origin', 'worker'), O), true, 'voice worker');
assert.equal(isolatesRequest(req(O + '/tools/reader/vendor/neural/ort/ort-wasm-simd-threaded.mjs', 'same-origin', 'worker'), O), true, 'pthread worker');
assert.equal(isolatesRequest(req(O + '/engine/tts-engine.js', 'cors', 'script'), O), false, 'module script');
assert.equal(isolatesRequest(req('https://huggingface.co/x', 'cors', ''), O), false, 'model download');
assert.equal(isolatesRequest(req('https://other.test/session/host.html', 'navigate', 'document'), O), false, 'other extension');
assert.equal(isolatesRequest(req('not a url'), O), false, 'bad url');
const r = await withIsolationHeaders(new Response('x', {status: 200, headers: {'content-type': 'text/html'}}));
assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
assert.equal(r.headers.get('cross-origin-embedder-policy'), 'require-corp');
assert.equal(r.headers.get('content-type'), 'text/html');
assert.equal(await r.text(), 'x');
console.log('engine-isolation: 15 PASS');
