import { Component, inject, signal, type OnInit } from '@angular/core';
import {
  AlertController,
  IonBackButton,
  IonBadge,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { todayIso } from '../../../core/dates';
import { financialYearOf, formatFyToken, renderDocumentNumber } from '../../../core/numbering';
import type { DocumentType } from '../../../core/types';
import { MastersRepository, type NumberingSeries } from '../../../data/repositories/masters.repository';
import { ToastService } from '../../../shared/ui/toast.service';

const TYPE_LABELS: Readonly<Record<DocumentType, string>> = {
  quotation: 'Quotations',
  invoice: 'Invoices',
  receipt: 'Receipts',
};

/**
 * Settings → Document numbering (§8).
 *
 * The screen a business owner is most likely to be nervous about, so it shows the *result* rather
 * than only the parts: each series renders a live example of the next number using the real
 * `renderDocumentNumber`, and editing the prefix updates it. Getting numbering wrong is the kind of
 * mistake that surfaces months later during a GST return.
 *
 * `nextSeq` is editable because a business migrating from a paper book needs to start at 143, not 1.
 * §8.4's posture applies: it warns rather than blocks, since only the owner knows their own history.
 */
@Component({
  selector: 'app-numbering',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonBadge,
    IonNote,
    IonSpinner,
  ],
  templateUrl: './numbering.page.html',
  styleUrl: './numbering.page.scss',
})
export class NumberingPage implements OnInit {
  private readonly masters = inject(MastersRepository);
  private readonly alerts = inject(AlertController);
  private readonly toast = inject(ToastService);

  readonly series = signal<NumberingSeries[]>([]);
  readonly loading = signal(true);

  readonly typeLabels = TYPE_LABELS;
  readonly types: readonly DocumentType[] = ['quotation', 'invoice', 'receipt'];

  /**
   * The current financial year, as text.
   *
   * `financialYearOf` returns a `{ startYear, endYear, key }` object; rendering that straight into
   * the template printed "[object Object]". `formatFyToken` is the same function the document
   * numbers use, so the year shown here is the year that will appear in them.
   */
  readonly financialYear = formatFyToken(financialYearOf(todayIso()), '2026-27');

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      this.series.set(await this.masters.listSeries());
    } finally {
      this.loading.set(false);
    }
  }

  forType(type: DocumentType): NumberingSeries[] {
    return this.series().filter((s) => s.docType === type);
  }

  /**
   * The number the next document of this series will actually get.
   *
   * Rendered with the same function the repository uses, so what this screen promises and what the
   * document receives cannot disagree.
   */
  preview(series: NumberingSeries): string {
    return renderDocumentNumber(series, series.nextSeq, todayIso());
  }

  resetLabel(series: NumberingSeries): string {
    switch (series.resetRule) {
      case 'yearly_april':
        // April, because the Indian financial year starts on 1 April (§8.2).
        return 'Restarts at 1 each financial year, on 1 April';
      case 'never':
        return 'Counts up for ever';
      default:
        return series.resetRule;
    }
  }

  async edit(series: NumberingSeries): Promise<void> {
    const alert = await this.alerts.create({
      header: series.label,
      message: `Next number will be ${this.preview(series)}`,
      inputs: [
        { name: 'prefix', type: 'text', value: series.prefix, placeholder: 'Prefix, e.g. CP/INV/' },
        { name: 'suffix', type: 'text', value: series.suffix, placeholder: 'Suffix (optional)' },
        {
          name: 'nextSeq',
          type: 'number',
          value: String(series.nextSeq),
          placeholder: 'Next number',
          attributes: { inputmode: 'numeric', min: 1 },
        },
        {
          name: 'padWidth',
          type: 'number',
          value: String(series.padWidth),
          placeholder: 'Digits, e.g. 3 for 001',
          attributes: { inputmode: 'numeric', min: 1, max: 8 },
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (values: Record<string, string>) => {
            void this.save(series, values);
          },
        },
      ],
    });
    await alert.present();
  }

  private async save(series: NumberingSeries, values: Record<string, string>): Promise<void> {
    const nextSeq = Math.trunc(Number(values['nextSeq'] ?? series.nextSeq));
    const padWidth = Math.trunc(Number(values['padWidth'] ?? series.padWidth));

    if (!Number.isFinite(nextSeq) || nextSeq < 1) {
      this.toast.warning('The next number has to be 1 or more.');
      return;
    }
    if (!Number.isFinite(padWidth) || padWidth < 1 || padWidth > 8) {
      this.toast.warning('Use between 1 and 8 digits.');
      return;
    }

    // §8.4: warn, do not block. Moving the counter backwards is legitimate when correcting a
    // mistake, and it is the owner's book to keep.
    if (nextSeq < series.nextSeq) {
      this.toast.warning(`Counter moved back to ${nextSeq}. Watch for duplicate numbers.`);
    }

    try {
      await this.masters.saveSeries({
        ...series,
        prefix: values['prefix'] ?? series.prefix,
        suffix: values['suffix'] ?? series.suffix,
        nextSeq,
        padWidth,
      });
      await this.reload();
    } catch (cause) {
      this.toast.error(cause);
    }
  }
}
