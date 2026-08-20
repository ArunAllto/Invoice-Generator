import { Component, inject, signal, type OnInit } from '@angular/core';
import {
  AlertController,
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';

import { formatBasisPoints, parsePercentToBasisPoints } from '../../../core/money';
import { MastersRepository, type TaxPreset } from '../../../data/repositories/masters.repository';
import { ToastService } from '../../../shared/ui/toast.service';

/**
 * Settings → Tax rates (§9.2).
 *
 * These are the rates offered as chips on a line item. India's GST slabs are the seeded set, but the
 * list is editable because a business may only ever use two of them, and scrolling past three
 * irrelevant rates on every line is the kind of friction that adds up.
 *
 * Rates are stored as basis points, so 18% is 1800 and there is no floating-point rate anywhere.
 * Entry goes through `parsePercentToBasisPoints` so "18", "18%" and "18.5" all behave.
 */
@Component({
  selector: 'app-tax-rates',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonBadge,
    IonNote,
    IonSpinner,
  ],
  templateUrl: './tax-rates.page.html',
  styleUrl: './tax-rates.page.scss',
})
export class TaxRatesPage implements OnInit {
  private readonly masters = inject(MastersRepository);
  private readonly alerts = inject(AlertController);
  private readonly toast = inject(ToastService);

  readonly presets = signal<TaxPreset[]>([]);
  readonly loading = signal(true);

  constructor() {
    addIcons({ addOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      this.presets.set(await this.masters.listTaxPresets());
    } finally {
      this.loading.set(false);
    }
  }

  rateLabel(preset: TaxPreset): string {
    return preset.rateBp === 0 ? '0% — exempt or nil-rated' : `${formatBasisPoints(preset.rateBp)}%`;
  }

  async add(): Promise<void> {
    await this.edit(
      { id: crypto.randomUUID(), label: '', rateBp: 0, isDefault: false },
      'New tax rate',
    );
  }

  async edit(preset: TaxPreset, header = 'Edit tax rate'): Promise<void> {
    const alert = await this.alerts.create({
      header,
      inputs: [
        { name: 'label', type: 'text', value: preset.label, placeholder: 'Label, e.g. GST 18%' },
        {
          name: 'rate',
          type: 'text',
          value: formatBasisPoints(preset.rateBp),
          placeholder: 'Rate %',
          attributes: { inputmode: 'decimal' },
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (values: Record<string, string>) => {
            void this.save(preset, values);
          },
        },
      ],
    });
    await alert.present();
  }

  private async save(preset: TaxPreset, values: Record<string, string>): Promise<void> {
    const rateBp = parsePercentToBasisPoints(values['rate'] ?? '');
    if (rateBp === null) {
      this.toast.show('That rate could not be read as a percentage.');
      return;
    }
    // A label is optional: the rate itself is a perfectly good name for a rate, and demanding
    // "GST 18%" for a row that says 18% is busywork.
    const label = (values['label'] ?? '').trim() || `${formatBasisPoints(rateBp)}%`;
    try {
      await this.masters.saveTaxPreset({ ...preset, label, rateBp });
      await this.reload();
      this.toast.show('Saved.');
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  async remove(preset: TaxPreset): Promise<void> {
    const alert = await this.alerts.create({
      header: `Remove ${preset.label}?`,
      // Deleting a preset is safe in a way deleting a client is not: the rate is copied onto each
      // line when it is chosen, so nothing already written changes.
      message: 'Documents already using this rate keep it — the rate is copied onto each line.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => {
            void this.confirmRemove(preset.id);
          },
        },
      ],
    });
    await alert.present();
  }

  private async confirmRemove(id: string): Promise<void> {
    try {
      await this.masters.deleteTaxPreset(id);
      await this.reload();
    } catch (cause) {
      this.toast.error(cause);
    }
  }
}
