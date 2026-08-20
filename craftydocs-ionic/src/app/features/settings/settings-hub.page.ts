/**
 * More / Settings hub — the entry point for the settings stack of §4.
 *
 * The rows are declared as data rather than markup so the grouping is obvious at a glance and a
 * new settings screen is one line. Routes are typed as string paths; Angular's router does not
 * offer expo-router's compile-time route checking, so `settings.routes.ts` is the single place
 * these paths are declared.
 */

import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
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

import { SqliteService } from '../../data/sqlite.service';

interface SettingsEntry {
  title: string;
  subtitle: string;
  route: string;
}

interface SettingsGroup {
  heading: string;
  entries: SettingsEntry[];
}

@Component({
  selector: 'app-settings-hub',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
  ],
  templateUrl: './settings-hub.page.html',
})
export class SettingsHubPage {
  private readonly router = inject(Router);
  private readonly db = inject(SqliteService);

  readonly status = this.db.status;

  readonly groups: readonly SettingsGroup[] = [
    {
      heading: 'Your documents',
      entries: [
        {
          title: 'Business profile',
          subtitle: 'Name, address, GSTIN, bank details',
          route: '/settings/business',
        },
        {
          title: 'Logo, signature & template',
          subtitle: 'Branding used on every document',
          route: '/settings/branding',
        },
        {
          title: 'Item catalogue',
          subtitle: 'Items and services with saved prices',
          route: '/settings/catalogue',
        },
      ],
    },
    {
      heading: 'Configuration',
      entries: [
        { title: 'Tax rates', subtitle: 'GST rate presets', route: '/settings/tax' },
        {
          title: 'Document numbering',
          subtitle: 'Prefixes, financial year, next number',
          route: '/settings/numbering',
        },
        {
          title: 'Terms & conditions',
          subtitle: 'Saved terms blocks',
          route: '/settings/terms',
        },
        {
          title: 'Extra fields',
          subtitle: 'Your own additional fields',
          route: '/settings/custom-fields',
        },
        {
          title: 'Document defaults',
          subtitle: 'What appears on new documents',
          route: '/settings/defaults',
        },
      ],
    },
    {
      heading: 'Data',
      entries: [
        {
          title: 'Backup & restore',
          subtitle: 'Export or restore everything as one file',
          route: '/settings/backup',
        },
        { title: 'About', subtitle: 'Version and privacy', route: '/settings/about' },
      ],
    },
  ];

  open(route: string): void {
    void this.router.navigateByUrl(route);
  }
}
