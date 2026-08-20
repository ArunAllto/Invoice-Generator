import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonInput,
  IonItem,
  IonList,
  IonNote,
  IonSpinner,
} from '@ionic/angular';

import { validateGstin } from '../../core/gst';
import {
  MastersRepository,
  SETTINGS_KEYS,
  type BusinessProfile,
} from '../../data/repositories/masters.repository';
import { ToastService } from '../../shared/ui/toast.service';

/**
 * First run (§14).
 *
 * ## Why this asks for so little
 *
 * Four fields, three of which are optional. Everything else the app can do — the catalogue, terms,
 * numbering, custom fields — has a working default and its own settings screen, so putting any of it
 * here would be asking someone to configure a tool they have not used yet. The only thing genuinely
 * blocking is the business name, because it is printed at the top of every document and there is no
 * sensible default for it.
 *
 * The GSTIN is here rather than left to Settings for one reason: it is the master switch of §9.4. If
 * it is missing, no GST field appears anywhere in the app, and someone who is registered would
 * otherwise build their first few invoices without tax and have to redo them. Asking once, up front,
 * is cheaper than that discovery.
 *
 * ## Why it can be skipped
 *
 * The dashboard already carries a "complete your profile" banner, so nothing is lost by skipping —
 * and a first-run wizard that cannot be dismissed is the fastest way to make someone abandon an app
 * they were only trying out. Skipping still marks onboarding done: the banner takes over from here,
 * and being asked the same questions on every launch would be worse than either.
 */
@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [IonContent, IonList, IonItem, IonInput, IonNote, IonButton, IonSpinner],
  templateUrl: './onboarding.page.html',
  styleUrl: './onboarding.page.scss',
})
export class OnboardingPage implements OnInit {
  private readonly masters = inject(MastersRepository);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly profile = signal<BusinessProfile | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly nameTouched = signal(false);

  readonly nameMissing = computed(() => (this.profile()?.name ?? '').trim().length === 0);

  readonly gstinWarning = computed(() => {
    const gstin = this.profile()?.gstin;
    if (!gstin || gstin.trim().length === 0) return null;
    switch (validateGstin(gstin)) {
      case 'format':
        return 'That is not 15 characters in the GSTIN pattern. You can still continue.';
      case 'checksum':
        return 'The check character does not match. You can still continue.';
      case 'unknown_state':
        return 'That state code is not one we recognise. You can still continue.';
      default:
        return null;
    }
  });

  async ngOnInit(): Promise<void> {
    this.profile.set(await this.masters.getBusinessProfile());
    this.loading.set(false);
  }

  patch<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]): void {
    const current = this.profile();
    if (!current) return;
    this.profile.set({ ...current, [key]: value });
  }

  patchGstin(value: string): void {
    const trimmed = value.trim().toUpperCase();
    this.patch('gstin', trimmed.length > 0 ? trimmed : null);
  }

  async finish(): Promise<void> {
    this.nameTouched.set(true);
    const profile = this.profile();
    if (!profile || this.nameMissing()) {
      this.toast.warning('Your business needs a name — it goes on every document.');
      return;
    }

    this.saving.set(true);
    try {
      await this.masters.saveBusinessProfile(profile);
      await this.markDone();
      this.saving.set(false);
      this.toast.success('All set.');
      await this.router.navigateByUrl('/tabs/home');
    } catch (cause) {
      this.saving.set(false);
      this.toast.error(cause);
    }
  }

  /** Skip without saving, but still record that the question was asked. */
  async skip(): Promise<void> {
    try {
      await this.markDone();
      await this.router.navigateByUrl('/tabs/home');
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  private async markDone(): Promise<void> {
    await this.masters.setSetting(SETTINGS_KEYS.onboardingComplete, 'yes');
  }
}
