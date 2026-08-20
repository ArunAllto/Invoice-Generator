import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

/**
 * Shown for any route with no screen behind it.
 *
 * This replaced a `{ path: '**', redirectTo: 'tabs/home' }` wildcard, which silently bounced the
 * user to Home whenever they tapped something unbuilt. The effect was that half the settings rows
 * and the Preview button looked like dead buttons, with nothing in the console to explain it.
 * Naming the missing path turns an invisible bug into an obvious gap.
 */
@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton, IonContent],
  templateUrl: './not-found.page.html',
  styleUrl: './not-found.page.scss',
})
export class NotFoundPage {
  /** Captured at construction: by the time the view renders the router has already settled here. */
  readonly path = inject(Router).url;
}
