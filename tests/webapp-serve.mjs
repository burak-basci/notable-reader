#!/usr/bin/env node
/* Tiny static server for the built web app (127.0.0.1 only). Used by tests/webapp-browser.mjs; also runnable by hand:
   node tests/webapp-serve.mjs <dir> [--port 8099] [--isolation require-corp|credentialless|none] [--base /app/]  */
import {createServer} from 'node:http';
import {createReadStream, statSync} from 'node:fs';
import {extname, join, normalize, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf'};

export function startServer(dir, {port = 0, isolation = 'require-corp', base = '/'} = {}) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(base)) { res.writeHead(404).end('not found'); return; }
    let path = normalize(decodeURIComponent(url.pathname.slice(base.length)));
    if (path.startsWith('..')) { res.writeHead(403).end(); return; }
    let file = join(root, path);
    try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); } catch { res.writeHead(404).end('not found'); return; }
    if (!(file + sep).startsWith(root + sep) && file !== root) { res.writeHead(403).end(); return; }
    let size; try { size = statSync(file).size; } catch { res.writeHead(404).end('not found'); return; }
    const headers = {'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': size};
    if (isolation !== 'none') { headers['Cross-Origin-Opener-Policy'] = 'same-origin'; headers['Cross-Origin-Embedder-Policy'] = isolation; headers['Cross-Origin-Resource-Policy'] = 'same-origin'; }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok({server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}${base}`})));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), opt = n => { const i = a.indexOf(n); return i < 0 ? undefined : a[i + 1]; };
  const {url} = await startServer(a[0], {port: Number(opt('--port') || 0), isolation: opt('--isolation') || 'require-corp', base: opt('--base') || '/app/'});
  console.log('serving ' + url);
}
