/**
 * Application entry point.
 *
 * The `buffer` polyfill comes first, before anything can import `docx`. It is the same trap the
 * React Native tree documented: `docx` reaches for a global `Buffer` that browsers do not
 * provide, and without this the failure is a `ReferenceError` from deep inside the packer,
 * nowhere near the actual cause.
 */

import { Buffer } from 'buffer';

const globalScope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (typeof globalScope.Buffer === 'undefined') {
  globalScope.Buffer = Buffer;
}

import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  // Nothing has rendered at this point, so the console is the only channel available.
  console.error('CraftyDocs failed to start', error);
});
