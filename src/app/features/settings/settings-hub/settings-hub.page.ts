/**
 * More / Settings hub — the entry point for the settings stack of §4.
 *
 * The rows are declared as data rather than markup so the grouping is obvious at a glance and a new
 * settings screen is one line.
 *
 * ## Why rows carry a `built` flag
 *
 * Rows for screens that do not exist yet are still listed, because the list doubles as the map of
 * what the app is meant to do. But they are marked, dimmed and inert. Previously they navigated to
 * a route with nothing behind it, the router's catch-all bounced back to Home, and the row read as a
 * broken button — the worst of the three options. Showing the row and admitting it is not ready is
 * honest; silently doing nothing is not.
 */

import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonBadge,
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
import { ToastService } from '../../../shared/ui/toast.service';

interface SettingsEntry {
  title: string;
  subtitle: string;
  route: string;
  /** False while the screen behind this route has not been written yet. */
  built: boolean;
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
    IonBadge,
    IonNote,
  ],
  templateUrl: './settings-hub.page.html',
  styleUrl: './settings-hub.page.scss',
})
export class SettingsHubPage {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
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
          built: true,
        },
        {
          title: 'Logo, signature & template',
          subtitle: 'Branding used on every document',
          route: '/settings/branding',
          built: true,
        },
        {
          title: 'Item catalogue',
          subtitle: 'Items and services with saved prices',
          route: '/settings/catalogue',
          built: true,
        },
      ],
    },
    {
      heading: 'Appearance',
      entries: [
        {
          title: 'Theme',
          subtitle: 'Light, dark, high contrast, or match your device',
          route: '/settings/appearance',
          built: true,
        },
      ],
    },
    {
      heading: 'Configuration',
      entries: [
        { title: 'Tax rates', subtitle: 'GST rate presets', route: '/settings/tax', built: true },
        {
          title: 'Document numbering',
          subtitle: 'Prefixes, financial year, next number',
          route: '/settings/numbering',
          built: true,
        },
        {
          title: 'Terms & conditions',
          subtitle: 'Saved terms blocks',
          route: '/settings/terms',
          built: true,
        },
        {
          title: 'Extra fields',
          subtitle: 'Your own additional fields',
          route: '/settings/custom-fields',
          built: true,
        },
        {
          title: 'Document defaults',
          subtitle: 'What appears on new documents',
          route: '/settings/defaults',
          built: true,
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
          built: true,
        },
        {
          title: 'About',
          subtitle: 'Version and privacy',
          route: '/settings/about',
          built: true,
        },
      ],
    },
  ];

  open(entry: SettingsEntry): void {
    if (!entry.built) {
      this.toast.show(`${entry.title} is not built yet.`, 1800);
      return;
    }
    void this.router.navigateByUrl(entry.route);
  }
}
