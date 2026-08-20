import { Component, inject } from '@angular/core';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { SqliteService } from '../../../data/sqlite.service';

/**
 * About (§13.5).
 *
 * Deliberately plain, and deliberately includes the database schema version: when something looks
 * wrong the first useful question is which migration the local database is on, and asking the owner
 * to read a number off a screen beats asking them to attach a debugger.
 */
@Component({
  selector: 'app-about',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
  ],
  templateUrl: './about.page.html',
  styleUrl: './about.page.scss',
})
export class AboutPage {
  readonly status = inject(SqliteService).status;

  readonly appName = 'CraftyDocs';
  readonly version = '1.0.0';
  readonly business = 'The Crafty Pixels, Kangarapady, Ernakulam';
}
