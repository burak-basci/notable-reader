/* beNotable! Reader · cross-origin isolation for the engine host only (own code, MIT).
   WASM threads need SharedArrayBuffer, and that needs a cross-origin isolated document. The manifest keys (cross_origin_embedder_policy / _opener_policy)
   isolate EVERY extension page (popup, settings, file view, side panel, welcome); 2.5 removed them after the engine host hung and Brave crashed (16./17.11.2026),
   and since then every voice worker had ONE thread (Kokoro FP32: real-time factor 1.43, English reading stopped every few seconds).
   This service worker instead serves the one document that runs the voices (session/host.html, the offscreen document) and the worker scripts with
   COOP same-origin + COEP require-corp: only the engine host is isolated and gets 4 threads per voice worker (measured 20.11.2026 in Chromium 156 on 16 cores:
   Kokoro FP32 1.43 -> 0.52, a pair of workers 0.77 -> 0.36; first sentence 4.2 s -> 2.1 s). Every other page and request is left alone (no respondWith).
   Worker scripts get the headers whoever starts them: a dedicated worker of an isolated document must answer with a compatible COEP, and the stricter policy
   inside a worker of a normal page changes nothing (the workers read the extension's own files and Hugging Face over CORS only).
   When the host is created while this worker can not answer (or in Firefox, which has no extension service worker), the host is simply not isolated and the
   engine runs with one thread as before: nothing breaks, it is only slower. */
const ISOLATED_DOCUMENTS = new Set(['/session/host.html']);
const HEADERS = [['Cross-Origin-Opener-Policy', 'same-origin'], ['Cross-Origin-Embedder-Policy', 'require-corp'], ['Cross-Origin-Resource-Policy', 'same-origin']];
/* Which requests are answered with the isolation headers: the engine host document (a navigation) and same-origin worker scripts. */
export function isolatesRequest(request, origin) {
  let url; try { url = new URL(request.url); } catch { return false; }
  if (url.origin !== origin) return false;
  if (request.mode === 'navigate') return ISOLATED_DOCUMENTS.has(url.pathname);
  return request.destination === 'worker';
}
export async function withIsolationHeaders(response) {
  if (!response || response.type === 'opaque' || response.type === 'opaqueredirect') return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of HEADERS) headers.set(name, value);
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}
/* Registers the fetch handler (must run during the first evaluation of the service worker). Returns false outside a service worker. */
export function installEngineIsolation(scope = globalThis) {
  if (typeof scope.ServiceWorkerGlobalScope !== 'function' || !(scope instanceof scope.ServiceWorkerGlobalScope)) return false;
  scope.addEventListener('fetch', event => {
    if (!isolatesRequest(event.request, scope.location.origin)) return;
    event.respondWith(fetch(event.request).then(withIsolationHeaders));
  });
  return true;
}
