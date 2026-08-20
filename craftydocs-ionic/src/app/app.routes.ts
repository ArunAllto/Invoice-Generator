/**
 * Application routes.
 *
 * Every feature is lazily loaded, so the initial bundle is the tab shell plus the dashboard.
 * The tab shell owns the four destinations of §4; everything reached *from* a tab (the editor,
 * settings pages, entity editors) is a sibling route so it can present full-screen without the
 * tab bar underneath.
 */

import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'tabs',
    loadComponent: () => import('./tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      {
        path: 'home',
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'documents',
        loadComponent: () =>
          import('./features/documents/document-list/document-list.page').then((m) => m.DocumentListPage),
      },
      {
        path: 'clients',
        loadComponent: () => import('./features/clients/client-list/client-list.page').then((m) => m.ClientListPage),
      },
      {
        path: 'more',
        loadComponent: () => import('./features/settings/settings-hub/settings-hub.page').then((m) => m.SettingsHubPage),
      },
      { path: '', redirectTo: 'home', pathMatch: 'full' },
    ],
  },
  /**
   * The editor sits outside the tab shell so it presents full-screen, with no tab bar underneath.
   * `:id` is bound straight to the component's `id` input by `withComponentInputBinding`.
   */
  {
    path: 'document/:id',
    loadComponent: () =>
      import('./features/documents/document-editor/document-editor.page').then((m) => m.DocumentEditorPage),
  },
  { path: '', redirectTo: 'tabs/home', pathMatch: 'full' },
  { path: '**', redirectTo: 'tabs/home' },
];
