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

/**
 * The tab shell of §4. Each tab's content is a lazily loaded child route.
 */
@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonRouterOutlet],
  templateUrl: './tabs.page.html',
  styleUrl: './tabs.page.scss',
})
export class TabsPage {
  constructor() {
    // Registering only the icons actually used keeps them out of the initial bundle.
    addIcons({ homeOutline, documentTextOutline, peopleOutline, ellipsisHorizontal });
  }
}
