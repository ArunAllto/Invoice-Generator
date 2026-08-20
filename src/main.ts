/**
 * Application entry point.
 *
 * Deliberately bare. When DOCX export is written it will need a `Buffer` polyfill installed here,
 * before anything can import `docx` — that library reaches for a global `Buffer` browsers do not
 * provide, and the failure is a `ReferenceError` from deep inside its packer, nowhere near the
 * cause. The polyfill and the `buffer` dependency were removed with `docx` itself rather than
 * left as dead weight; re-add all three together.
 */

import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  // Nothing has rendered at this point, so the console is the only channel available.
  console.error('CraftyDocs failed to start', error);
});
