import { provideZonelessChangeDetection, type ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';

import { routes } from './app.routes';

/**
 * Application providers.
 *
 * `mode: 'md'` pins Material styling on every platform. The app is Android-only (§12), and
 * letting Ionic pick per-platform would mean the layout the owner reviews is not necessarily
 * the layout their client sees.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideIonicAngular({ mode: 'md' }),
    provideRouter(routes, withComponentInputBinding()),
  ],
};
