import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';

import { SqliteService } from './data/sqlite.service';
import { ThemeService } from './shared/theme/theme.service';

/**
 * Root shell.
 *
 * `IonApp` provides the platform chrome and `ion-router-outlet` renders whichever route is active.
 * Beyond that it does exactly two things at startup.
 *
 * ## Opening the database
 *
 * Started here, and deliberately *not* awaited. Every repository opens the connection lazily on its
 * first query, which works but leaves any screen that reads the database only to *report* on it —
 * About, and the version line on the settings hub — saying "not open yet" when reached by deep link,
 * because such a screen never issues a query. Kicking the open off once, at the root, means the
 * connection is warm by the time the first screen wants it and the status signal is honest
 * everywhere. Not awaited, because a WASM SQLite open costs a few hundred milliseconds and holding
 * the first paint for it would trade a real delay for a cosmetic one.
 *
 * ## Applying the theme
 *
 * `ThemeService` writes `data-theme` in its own constructor, so injecting it here is what applies the
 * saved choice. Without this the app would render in the device theme until the user happened to
 * open the Appearance screen.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly db = inject(SqliteService);

  constructor() {
    inject(ThemeService);
    void this.db.open().catch((error: unknown) => {
      // Not recoverable from here, and the screens that need the database report their own
      // failures. Logging keeps the original cause visible rather than swallowed.
      console.error('CraftyDocs could not open its database', error);
    });
  }
}
