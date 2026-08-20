/**
 * Application routes.
 *
 * Every feature is lazily loaded, so the initial bundle is the tab shell plus the dashboard. The
 * tab shell owns the four destinations of §4; anything reached *from* a tab presents full-screen as
 * a sibling route, with no tab bar underneath.
 *
 * ## No wildcard redirect
 *
 * The catch-all renders a "not built yet" screen instead of redirecting to Home. The redirect
 * version made every unbuilt route look like a dead button: tapping a settings row bounced you back
 * to the dashboard with nothing logged, which is indistinguishable from a broken click handler.
 * Only add a route here once there is a screen behind it.
 */

import type { Routes } from '@angular/router';

import { onboardingGuard } from './features/onboarding/onboarding.guard';

export const routes: Routes = [
  /** First run (§14). Not guarded — this is where the guard sends people. */
  {
    path: 'onboarding',
    loadComponent: () =>
      import('./features/onboarding/onboarding.page').then((m) => m.OnboardingPage),
  },

  {
    path: 'tabs',
    // Guards the shell, not each tab, so a deep link to a document is not intercepted.
    canActivate: [onboardingGuard],
    loadComponent: () => import('./tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      {
        path: 'home',
        loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'documents',
        loadComponent: () =>
          import('./features/documents/document-list/document-list.page').then((m) => m.DocumentListPage),
      },
      {
        path: 'clients',
        loadComponent: () =>
          import('./features/clients/client-list/client-list.page').then((m) => m.ClientListPage),
      },
      {
        path: 'more',
        loadComponent: () =>
          import('./features/settings/settings-hub/settings-hub.page').then((m) => m.SettingsHubPage),
      },
      { path: '', redirectTo: 'home', pathMatch: 'full' },
    ],
  },

  /**
   * Read-only render of the document, and where the print dialogue is reached from.
   *
   * Declared *before* `document/:id`. Angular does backtrack when a prefix match leaves segments
   * unconsumed, but relying on that to route a two-segment path around a one-segment pattern is a
   * subtlety nobody should have to reconstruct; ordering the more specific route first says it
   * plainly.
   */
  {
    path: 'document/:id/preview',
    loadComponent: () =>
      import('./features/documents/document-preview/document-preview.page').then(
        (m) => m.DocumentPreviewPage,
      ),
  },

  /**
   * The document editor. `:id` is bound straight to the component's `id` input by
   * `withComponentInputBinding`.
   */
  {
    path: 'document/:id',
    loadComponent: () =>
      import('./features/documents/document-editor/document-editor.page').then((m) => m.DocumentEditorPage),
  },

  /** Client add and edit. `new` creates; any other value is an id to load. */
  {
    path: 'client/:id',
    loadComponent: () =>
      import('./features/clients/client-editor/client-editor.page').then((m) => m.ClientEditorPage),
  },

  /** The settings stack. One line per screen; all lazily loaded. */
  {
    path: 'settings/business',
    loadComponent: () =>
      import('./features/settings/business-profile/business-profile.page').then((m) => m.BusinessProfilePage),
  },
  {
    path: 'settings/branding',
    loadComponent: () => import('./features/settings/branding/branding.page').then((m) => m.BrandingPage),
  },
  {
    path: 'settings/catalogue',
    loadComponent: () => import('./features/settings/catalogue/catalogue.page').then((m) => m.CataloguePage),
  },
  {
    path: 'settings/appearance',
    loadComponent: () => import('./features/settings/appearance/appearance.page').then((m) => m.AppearancePage),
  },
  {
    path: 'settings/tax',
    loadComponent: () => import('./features/settings/tax-rates/tax-rates.page').then((m) => m.TaxRatesPage),
  },
  {
    path: 'settings/numbering',
    loadComponent: () => import('./features/settings/numbering/numbering.page').then((m) => m.NumberingPage),
  },
  {
    path: 'settings/terms',
    loadComponent: () => import('./features/settings/terms/terms.page').then((m) => m.TermsPage),
  },
  {
    path: 'settings/custom-fields',
    loadComponent: () =>
      import('./features/settings/custom-fields/custom-fields.page').then((m) => m.CustomFieldsPage),
  },
  {
    path: 'settings/defaults',
    loadComponent: () => import('./features/settings/defaults/defaults.page').then((m) => m.DefaultsPage),
  },
  {
    path: 'settings/backup',
    loadComponent: () => import('./features/settings/backup/backup.page').then((m) => m.BackupPage),
  },
  {
    path: 'settings/about',
    loadComponent: () => import('./features/settings/about/about.page').then((m) => m.AboutPage),
  },

  { path: '', redirectTo: 'tabs/home', pathMatch: 'full' },

  // Anything else: say so, rather than pretending the tap did nothing.
  {
    path: '**',
    loadComponent: () => import('./features/settings/not-found/not-found.page').then((m) => m.NotFoundPage),
  },
];
