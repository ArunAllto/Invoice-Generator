import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonAccordion,
  IonAccordionGroup,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { validateGstin } from '../../../core/gst';
import {
  EMPTY_BUSINESS,
  MastersRepository,
  type BusinessProfile,
} from '../../../data/repositories/masters.repository';
import { ToastService } from '../../../shared/ui/toast.service';

/**
 * Settings → Business profile (§7, §9.4).
 *
 * These details are copied onto each document as it is created (§5.4), so editing them here never
 * alters a document already issued — a point the screen states plainly, because the opposite would
 * be a reasonable thing to fear.
 *
 * Validation warns rather than blocks, matching §8.4's posture on numbers: a GSTIN that fails its
 * checksum is flagged and still saved. The owner knows their own registration better than a check
 * digit does, and refusing to save would strand them.
 */
@Component({
  selector: 'app-business-profile',
  standalone: true,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonContent,
    IonAccordionGroup,
    IonAccordion,
    IonItem,
    IonLabel,
    IonInput,
    IonNote,
    IonSpinner,
  ],
  templateUrl: './business-profile.page.html',
  styleUrl: './business-profile.page.scss',
})
export class BusinessProfilePage implements OnInit {
  private readonly masters = inject(MastersRepository);
  private readonly toast = inject(ToastService);

  readonly profile = signal<BusinessProfile>({ ...EMPTY_BUSINESS });
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly nameTouched = signal(false);

  readonly nameMissing = computed(() => this.profile().name.trim().length === 0);

  /** §9.4: the GSTIN is the master switch for every GST field in the app. */
  readonly gstinProblem = computed(() => {
    const gstin = this.profile().gstin;
    return gstin && gstin.trim().length > 0 ? validateGstin(gstin) : null;
  });

  readonly gstinWarning = computed(() => {
    const problem = this.gstinProblem();
    if (problem === 'format') return 'That is not 15 characters in the GSTIN pattern. You can still save it.';
    if (problem === 'checksum') return 'The check character does not match. You can still save it.';
    if (problem === 'unknown_state') return 'That state code is not one we recognise. You can still save it.';
    return null;
  });

  async ngOnInit(): Promise<void> {
    this.profile.set(await this.masters.getBusinessProfile());
    this.loading.set(false);
  }

  /** Patch one field. Kept generic so the template stays declarative. */
  patch<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]): void {
    this.profile.set({ ...this.profile(), [key]: value });
  }

  /** Text fields that store `null` rather than an empty string, so "unset" is unambiguous. */
  patchNullable(key: 'gstin' | 'pan' | 'bankName' | 'bankAccountName' | 'bankAccountNo' | 'bankIfsc' | 'upiId', value: string): void {
    const trimmed = value.trim();
    this.patch(key, trimmed.length > 0 ? trimmed : null);
  }

  /** Uppercased on entry: GSTIN, PAN and IFSC are all uppercase by definition. */
  patchUpper(key: 'gstin' | 'pan' | 'bankIfsc', value: string): void {
    this.patchNullable(key, value.toUpperCase());
  }

  async save(): Promise<void> {
    this.nameTouched.set(true);
    if (this.nameMissing()) {
      this.toast.warning('Your business needs a name.');
      return;
    }
    this.saving.set(true);
    try {
      await this.masters.saveBusinessProfile(this.profile());
      this.toast.success('Saved.');
    } catch (cause) {
      this.toast.error(cause);
    } finally {
      this.saving.set(false);
    }
  }
}
