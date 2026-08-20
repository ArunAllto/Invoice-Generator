/**
 * Serve a built app the way a static host does, including from a sub-path.
 *
 * Exists to catch one class of bug that only appears once the app is not at the domain root: an
 * absolute asset path. GitHub Pages project sites serve from `/<repo>/`, and `ng serve` always
 * serves from `/`, so the dev server cannot reproduce it. jeep-sqlite's default `wasmPath` of
 * `/assets` was exactly this — fine locally, a blank screen once deployed.
 *
 * Also does the SPA fallback a static host needs: an unknown path with no file extension gets
 * `index.html`, so the client-side router can resolve it.
 *
 *   node scripts/serve-static.mjs [--root dist/subpath-test] [--prefix /craftydocs]
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
};

const ROOT = valueOf('--root', 'dist/subpath-test');
const PREFIX = valueOf('--prefix', '/craftydocs');
const PORT = Number(process.env['PORT'] ?? valueOf('--port', '4400'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // `normalize` plus the containment check below is what stops `..` escaping the served root.
  const requested = normalize(decodeURIComponent(url.pathname));
  const filePath = join(ROOT, requested);

  if (!filePath.startsWith(normalize(ROOT))) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
    return;
  }

  // SPA fallback: a path with no extension is a route, not a missing file.
  if (extname(requested) === '') {
    const shell = join(ROOT, PREFIX, 'index.html');
    if (existsSync(shell)) {
      res.writeHead(200, { 'Content-Type': TYPES['.html'] });
      createReadStream(shell).pipe(res);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found: ${requested}`);
}).listen(PORT, () => {
  console.log(`Serving ${ROOT} on http://localhost:${PORT}${PREFIX}/`);
});
