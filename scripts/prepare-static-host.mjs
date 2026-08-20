/**
 * Post-build fixups for hosting the app as static files.
 *
 * Two things a plain static host needs that `ng build` does not produce:
 *
 * 1. **`404.html`** — a copy of `index.html`. Every route past the root (`/settings/page-size`,
 *    `/document/:id`) is client-side only, so a static host asked for that path finds no file and
 *    returns its 404 page. Serving `index.html` *as* the 404 hands the URL to Angular's router,
 *    which then resolves it correctly. Without this, deep links and a browser refresh both break —
 *    and refresh is exactly what someone does when testing.
 *
 * 2. **`.nojekyll`** — GitHub Pages runs Jekyll by default, which silently drops files and folders
 *    beginning with an underscore. Angular does not emit any today, but a build tool that starts to
 *    would fail in a way nearly impossible to diagnose from a blank page.
 *
 * Run after `ng build`. Safe to run twice.
 */

import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist/craftydocs-ionic/browser';

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`No build found at ${DIST}. Run "npm run build" first.`);
  process.exit(1);
}

copyFileSync(join(DIST, 'index.html'), join(DIST, '404.html'));
writeFileSync(join(DIST, '.nojekyll'), '');

// The WASM module is loaded at runtime by sql.js; a missing copy is a blank screen with one
// console error, so it is worth failing the build here instead.
const assets = existsSync(join(DIST, 'assets')) ? readdirSync(join(DIST, 'assets')) : [];
if (!assets.includes('sql-wasm.wasm')) {
  console.error('assets/sql-wasm.wasm is missing — the database cannot open without it.');
  process.exit(1);
}

console.log('Static host prepared: 404.html, .nojekyll, sql-wasm.wasm present.');
