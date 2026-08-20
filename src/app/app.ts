import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';

/**
 * Root shell.
 *
 * Holds no state and no logic: `IonApp` provides the platform chrome, and `ion-router-outlet`
 * renders whichever route is active.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [IonApp, IonRouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
