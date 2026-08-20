/**
 * The four tabs of §4: Home, Documents, Clients, More.
 *
 * Labels are always visible. `ion-tab-button` inherits the 44dp minimum from global styles, and
 * nothing here fixes a height, so a larger system font grows the bar instead of clipping the
 * labels — which is the defect the React Native tree had to fix at 48dp.
 */

import { Component } from '@angular/core';
import {
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { documentTextOutline, ellipsisHorizontal, homeOutline, peopleOutline } from 'ionicons/icons';

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonRouterOutlet],
  template: `
    <ion-tabs>
      <ion-router-outlet />
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="home">
          <ion-icon name="home-outline" />
          <ion-label>Home</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="documents">
          <ion-icon name="document-text-outline" />
          <ion-label>Documents</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="clients">
          <ion-icon name="people-outline" />
          <ion-label>Clients</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="more">
          <ion-icon name="ellipsis-horizontal" />
          <ion-label>More</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
})
export class TabsPage {
  constructor() {
    addIcons({ homeOutline, documentTextOutline, peopleOutline, ellipsisHorizontal });
  }
}
