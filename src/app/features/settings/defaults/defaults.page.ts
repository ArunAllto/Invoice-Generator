import { Component, inject, signal, type OnInit } from '@angular/core';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonRadio,
  IonRadioGroup,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { addDaysIso, formatIsoDate, todayIso, type DateDisplayStyle } from '../../../core/dates';
import { MastersRepository, SETTINGS_KEYS } from '../../../data/repositories/masters.repository';
import { ToastService } from '../../../shared/ui/toast.service';

/** §7.3: what happens to the catalogue price when a line rate is edited. */
export type PriceMode = 'ask' | 'always' | 'never';

/** Which export the sheet lists first. */
export type ExportPreference = 'print' | 'html' | 'share';

interface DateStyleOption {
  value: DateDisplayStyle;
  label: string;
}

/**
 * Settings → Document defaults (§13).
 *
 * Three things that are properties of how the business works rather than of any one document: how
 * long a quotation stays open, how long an invoice has to be paid, and how dates read on paper.
 *
 * Each shows its effect worked out against today's date. "15 days" is abstract; "expires 04 Sep
 * 2026" is the thing the owner is actually deciding, and seeing it makes an off-by-one obvious
 * before it reaches a client.
 */
@Component({
  selector: 'app-defaults',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonInput,
    IonNote,
    IonRadioGroup,
    IonRadio,
    IonSpinner,
  ],
  templateUrl: './defaults.page.html',
  styleUrl: './defaults.page.scss',
})
export class DefaultsPage implements OnInit {
  private readonly masters = inject(MastersRepository);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  readonly saving = signal(false);

  readonly quotationValidityDays = signal(15);
  readonly invoiceDueDays = signal(15);
  readonly dateStyle = signal<DateDisplayStyle>('dd MMM yyyy');

  /** The four styles `core/dates.ts` supports, named by their pattern so nothing can drift. */
  readonly dateStyles: readonly DateStyleOption[] = [
    { value: 'dd MMM yyyy', label: 'Short month name' },
    { value: 'd MMMM yyyy', label: 'Full month name' },
    { value: 'dd/MM/yyyy', label: 'Day/month/year' },
    { value: 'yyyy-MM-dd', label: 'ISO, year first' },
  ];

  readonly today = todayIso();

  /**
   * §7.3's price mode — what happens when you edit a rate that came from the catalogue.
   *
   * The setting key existed from the start and nothing read it, so the behaviour was hard-wired to
   * "ask". Ask is still the default and still the safest, but it is the wrong default for someone
   * repricing constantly, and being prompted on every line edit is its own kind of friction.
   */
  readonly priceMode = signal<PriceMode>('ask');

  readonly priceModes: ReadonlyArray<{ value: PriceMode; label: string; hint: string }> = [
    { value: 'ask', label: 'Ask me', hint: 'Offer to update the saved price. Nothing changes unless you say so.' },
    { value: 'always', label: 'Always update', hint: 'Editing a rate reprices the catalogue item too.' },
    { value: 'never', label: 'Never update', hint: 'The catalogue price is fixed; edits apply to this document only.' },
  ];

  /**
   * Which export the sheet offers first.
   *
   * Another key that existed and was never read. Print is the default because it is the route to a
   * PDF, which is what most documents are sent as.
   */
  readonly exportFormat = signal<ExportPreference>('print');

  readonly exportFormats: ReadonlyArray<{ value: ExportPreference; label: string; hint: string }> = [
    { value: 'print', label: 'Print or save as PDF', hint: 'Opens the printer dialogue, where Save as PDF lives.' },
    { value: 'html', label: 'Save as an HTML file', hint: 'One self-contained file that opens in any browser.' },
    { value: 'share', label: 'Share', hint: 'Straight to the share sheet, where the platform has one.' },
  ];

  onPriceMode(value: PriceMode): void {
    this.priceMode.set(value);
  }

  onExportFormat(value: ExportPreference): void {
    this.exportFormat.set(value);
  }

  async ngOnInit(): Promise<void> {
    const [validity, due, style, price, exportFormat] = await Promise.all([
      this.masters.getSetting(SETTINGS_KEYS.quotationValidityDays),
      this.masters.getSetting(SETTINGS_KEYS.invoiceDueDays),
      this.masters.getSetting(SETTINGS_KEYS.dateStyle),
      this.masters.getSetting(SETTINGS_KEYS.priceMode),
      this.masters.getSetting(SETTINGS_KEYS.defaultExportFormat),
    ]);
    // Validated against the lists rather than cast, so a hand-edited row cannot reach the editor.
    if (this.priceModes.some((option) => option.value === price)) {
      this.priceMode.set(price as PriceMode);
    }
    if (this.exportFormats.some((option) => option.value === exportFormat)) {
      this.exportFormat.set(exportFormat as ExportPreference);
    }
    this.quotationValidityDays.set(this.readDays(validity, 15));
    this.invoiceDueDays.set(this.readDays(due, 15));
    // Validated against the list rather than cast: a stale or hand-edited settings row must not
    // put an unsupported pattern into the renderer.
    if (this.dateStyles.some((option) => option.value === style)) {
      this.dateStyle.set(style as DateDisplayStyle);
    }
    this.loading.set(false);
  }

  /**
   * Read a day count, falling back when there is nothing stored.
   *
   * The blank check is the whole point: `Number('')` and `Number(null)` are both `0`, which is
   * finite and non-negative, so a naive guard accepts an *absent* setting as a deliberate zero. On a
   * fresh install that made every quotation expire the day it was written and every invoice due
   * immediately.
   */
  private readDays(raw: string | null, fallback: number): number {
    if (raw === null || raw.trim().length === 0) return fallback;
    const parsed = Math.trunc(Number(raw));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  /** What today's document would say, using the same helpers the editor and renderer use. */
  quotationExample(): string {
    return formatIsoDate(addDaysIso(this.today, this.quotationValidityDays()), this.dateStyle());
  }

  invoiceExample(): string {
    return formatIsoDate(addDaysIso(this.today, this.invoiceDueDays()), this.dateStyle());
  }

  dateStyleExample(style: DateDisplayStyle): string {
    return formatIsoDate(this.today, style);
  }

  onValidity(value: string): void {
    this.quotationValidityDays.set(this.readDays(value, this.quotationValidityDays()));
  }

  onDue(value: string): void {
    this.invoiceDueDays.set(this.readDays(value, this.invoiceDueDays()));
  }

  onDateStyle(value: DateDisplayStyle): void {
    this.dateStyle.set(value);
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      await this.masters.setSetting(
        SETTINGS_KEYS.quotationValidityDays,
        String(this.quotationValidityDays()),
      );
      await this.masters.setSetting(SETTINGS_KEYS.invoiceDueDays, String(this.invoiceDueDays()));
      await this.masters.setSetting(SETTINGS_KEYS.dateStyle, this.dateStyle());
      await this.masters.setSetting(SETTINGS_KEYS.priceMode, this.priceMode());
      await this.masters.setSetting(SETTINGS_KEYS.defaultExportFormat, this.exportFormat());
      this.toast.success('Saved. New documents will use these.');
    } catch (cause) {
      this.toast.error(cause);
    } finally {
      this.saving.set(false);
    }
  }
}
