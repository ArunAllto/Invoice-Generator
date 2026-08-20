/**
 * Send a first-run user to onboarding, once.
 *
 * Guards the tab shell rather than each tab, so a deep link straight to a document still works —
 * someone opening a shared link should land on the document, not be made to fill in a form first.
 *
 * ## Why the flag is in SQLite and not localStorage
 *
 * The theme lives in `localStorage` because it has to be applied before the first paint. This is the
 * opposite case: it must survive a browser storage clear no more and no less than the data it
 * describes. Keeping it beside the business profile means a restored backup restores this too — so a
 * new phone with a restored backup does not re-run onboarding for a business already set up, which
 * is exactly the confusion the flag exists to prevent.
 */

import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

import { MastersRepository, SETTINGS_KEYS } from '../../data/repositories/masters.repository';

export const onboardingGuard: CanActivateFn = async () => {
  const masters = inject(MastersRepository);
  const router = inject(Router);

  try {
    const done = await masters.getSetting(SETTINGS_KEYS.onboardingComplete);
    if (done && done.trim().length > 0) return true;

    // A profile that already has a name means this database has been used, whatever the flag says —
    // a backup restored from a build that predates onboarding would otherwise be sent through it.
    const profile = await masters.getBusinessProfile();
    if (profile.name.trim().length > 0) {
      await masters.setSetting(SETTINGS_KEYS.onboardingComplete, 'yes');
      return true;
    }

    return router.parseUrl('/onboarding');
  } catch {
    // A database that will not open is not a reason to trap someone on a form they cannot submit.
    // The screens behind this guard report their own failures.
    return true;
  }
};
