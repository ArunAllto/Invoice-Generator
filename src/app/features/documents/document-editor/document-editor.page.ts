/**
 * The document editor — spec §6.2, the most important screen in the app.
 *
 * Collapsible sections, everything editable inline, autosaving to SQLite with a 400 ms debounce
 * (handled by the store), and a sticky footer carrying the live grand total.
 *
 * The pricing behaviour of §7.3 lives here: adding from the catalogue pre-fills a line and marks
 * it `auto`; editing that line's rate flips it to `custom`, shows an "edited" badge, and offers a
 * one-tap write-back to the catalogue which never happens on its own.
 */

import { Component, computed, inject, input, signal, type OnDestroy, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AlertController,
  IonAccordion,
  IonAccordionGroup,
  IonBadge,
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToggle,
  IonToolbar,
  type ViewWillLeave,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { arrowDownOutline, arrowUpOutline, closeOutline } from 'ionicons/icons';

import { isGstEnabled } from '../../../core/gst';
import {
  formatBasisPoints,
  formatMilli,
  formatPaise,
  parseCurrencyToPaise,
  parsePercentToBasisPoints,
  parseQuantityToMilli,
} from '../../../core/money';
import { isDuplicateNumber, previewNextNumber } from '../../../core/numbering';
import { deriveStatus, isEditable, statusLabel } from '../../../core/status';
import type { DiscountMode, DocumentStatus, TaxMode } from '../../../core/types';
import { todayIso } from '../../../core/dates';
import type { LineItem } from '../../../data/repositories/documents.repository';
import { DocumentsRepository } from '../../../data/repositories/documents.repository';
import { MastersRepository, type TaxPreset } from '../../../data/repositories/masters.repository';
import { PaisePipe } from '../../../shared/pipes/paise.pipe';
import { StatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { ToastService } from '../../../shared/ui/toast.service';
import { DocumentEditorStore } from '../document-editor.store';

@Component({
  selector: 'app-document-editor',
  standalone: true,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonFooter,
    IonAccordionGroup,
    IonAccordion,
    IonList,
    IonItem,
    IonLabel,
    IonInput,
    IonTextarea,
    IonSelect,
    IonSelectOption,
    IonToggle,
    IonCheckbox,
    IonNote,
    IonBadge,
    IonSpinner,
    PaisePipe,
    StatusChipComponent,
  ],
  templateUrl: './document-editor.page.html',
  styleUrl: './document-editor.page.scss',
})
export class DocumentEditorPage implements OnInit, OnDestroy, ViewWillLeave {
  private readonly store = inject(DocumentEditorStore);
  private readonly repository = inject(DocumentsRepository);
  private readonly masters = inject(MastersRepository);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly alerts = inject(AlertController);

  /**
   * The route's `:id`, delivered by `withComponentInputBinding`.
   *
   * Must be a signal *input* — a plain `signal()` is not an input, so the router never writes to
   * it and the editor silently loads the empty string and reports "could not be opened".
   */
  readonly id = input.required<string>();

  readonly document = this.store.document;
  readonly lines = this.store.lines;
  readonly payments = this.store.payments;
  readonly calc = this.store.calc;
  readonly saveState = this.store.saveState;
  readonly saveError = this.store.saveError;
  readonly loading = this.store.loading;
  readonly grandTotal = this.store.grandTotal;

  readonly taxPresets = signal<TaxPreset[]>([]);
  readonly numberPreview = signal<string | null>(null);

  /** §9.4: with no business GSTIN, every GST control disappears. */
  readonly gstEnabled = computed(() => isGstEnabled(this.document()?.businessSnapshot.gstin));

  /** §6.4: a receipt is frozen once issued; anything cancelled is frozen too. */
  readonly editable = computed(() => {
    const doc = this.document();
    return doc ? isEditable(doc.type, doc.status) : false;
  });

  readonly derived = computed(() => {
    const doc = this.document();
    if (!doc) return null;
    return deriveStatus({
      type: doc.type,
      storedStatus: doc.status,
      today: todayIso(),
      validUntil: doc.validUntil,
      dueDate: doc.dueDate,
      grandTotal: doc.grandTotal,
      payments: this.payments().map((payment) => payment.amount),
    });
  });

  readonly typeTitle = computed(() => {
    const type = this.document()?.type;
    if (type === 'quotation') return 'Quotation';
    if (type === 'invoice') return 'Invoice';
    if (type === 'receipt') return 'Receipt';
    // Do not guess a type before the document has loaded — labelling a quotation "Receipt" for a
    // moment is worse than showing nothing.
    return 'Document';
  });

  /** Status transitions the user may choose (§6.4). */
  readonly statusActions = computed<ReadonlyArray<{ label: string; status: DocumentStatus }>>(() => {
    const doc = this.document();
    const shown = this.derived()?.status;
    if (!doc) return [];
    if (doc.type === 'quotation') {
      if (doc.status === 'draft') return [{ label: 'Mark as sent', status: 'sent' }];
      if (shown === 'sent' || shown === 'expired') {
        return [
          { label: 'Mark as accepted', status: 'accepted' },
          { label: 'Mark as rejected', status: 'rejected' },
        ];
      }
      return [];
    }
    if (doc.type === 'invoice') {
      return doc.status === 'draft' ? [{ label: 'Mark as sent', status: 'sent' }] : [];
    }
    return doc.status === 'draft' ? [{ label: 'Issue receipt', status: 'issued' }] : [];
  });

  constructor() {
    addIcons({ closeOutline, arrowUpOutline, arrowDownOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.store.load(this.id());
    this.taxPresets.set(await this.masters.listTaxPresets());
    await this.refreshNumberPreview();
  }

  /** §6.3: flush on leaving, so the draft is intact even if the app is killed straight after. */
  async ionViewWillLeave(): Promise<void> {
    await this.store.flush();
  }

  async ngOnDestroy(): Promise<void> {
    await this.store.flush();
  }

  /** The "next: …" hint shown while a document still has no number (§8.3). */
  private async refreshNumberPreview(): Promise<void> {
    const doc = this.document();
    if (!doc || doc.number) {
      this.numberPreview.set(null);
      return;
    }
    const series = doc.seriesId
      ? await this.masters.getSeries(doc.seriesId)
      : await this.masters.getDefaultSeries(doc.type);
    if (!series) {
      this.numberPreview.set(null);
      return;
    }
    const facts = await this.repository.allocationFacts(series, doc.issueDate);
    this.numberPreview.set(previewNextNumber(series, facts, doc.issueDate));
  }

  // -------------------------------------------------------------------------
  // Header fields
  // -------------------------------------------------------------------------

  onIssueDate(value: string): void {
    this.store.patchDocument({ issueDate: value });
    void this.refreshNumberPreview();
  }

  onValidUntil(value: string): void {
    this.store.patchDocument({ validUntil: value || null });
  }

  onDueDate(value: string): void {
    this.store.patchDocument({ dueDate: value || null });
  }

  onNotes(value: string): void {
    this.store.patchDocument({ notes: value });
  }

  onTerms(value: string): void {
    this.store.patchDocument({ terms: value });
  }

  // -------------------------------------------------------------------------
  // Line items (§7.3)
  // -------------------------------------------------------------------------

  addCustomLine(): void {
    this.store.addCustomLine();
  }

  async addFromCatalogue(): Promise<void> {
    const items = await this.masters.listCatalogueItems();
    if (items.length === 0) {
      this.toast.show('Your catalogue is empty. Add items in Settings.');
      return;
    }

    const alert = await this.alerts.create({
      header: 'Add from catalogue',
      // Favourites first, then most-used, then alphabetical — the repository's ordering (§7.3).
      inputs: items.map((item) => ({
        type: 'checkbox' as const,
        label: item.defaultRate === 0 ? `${item.name} — no rate set` : `${item.name} — ₹${formatPaise(item.defaultRate)}`,
        value: item.id,
      })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Add',
          handler: (selectedIds: string[]) => {
            const chosen = items.filter((item) => selectedIds.includes(item.id));
            if (chosen.length > 0) this.store.addCatalogueLines(chosen);
          },
        },
      ],
    });
    await alert.present();
  }

  lineName(line: LineItem, value: string): void {
    this.store.patchLine(line.id, { name: value });
  }

  lineDescription(line: LineItem, value: string): void {
    this.store.patchLine(line.id, { description: value });
  }

  lineHsn(line: LineItem, value: string): void {
    this.store.patchLine(line.id, { hsnSac: value });
  }

  lineUnit(line: LineItem, value: string): void {
    this.store.patchLine(line.id, { unit: value });
  }

  /**
   * Quantity is parsed on blur, not per keystroke.
   *
   * §6.3 wants "1.5" and "1,500" both accepted, which is only possible if the field can hold a
   * partially typed value. Reformatting on every keystroke would fight the user, turning "1." into
   * "1" mid-typing.
   */
  lineQty(line: LineItem, value: string): void {
    const parsed = parseQuantityToMilli(value);
    if (parsed === null || parsed < 0) return;
    this.store.patchLine(line.id, { qtyMilli: parsed });
  }

  /** Editing the rate is what flips an `auto` line to `custom` and offers the write-back (§7.3). */
  async lineRate(line: LineItem, value: string): Promise<void> {
    const parsed = parseCurrencyToPaise(value);
    if (parsed === null || parsed === line.rate) return;

    const wasAuto = line.priceSource === 'auto' && line.catalogueItemId !== null;
    this.store.patchLine(line.id, { rate: parsed });

    if (wasAuto && line.catalogueItemId) {
      await this.offerCatalogueWriteBack(line.catalogueItemId, parsed);
    }
  }

  /**
   * §7.3's explicit write-back prompt.
   *
   * Never silent: the catalogue price only changes if the owner says so here.
   */
  private async offerCatalogueWriteBack(catalogueItemId: string, rate: number): Promise<void> {
    const alert = await this.alerts.create({
      header: `Update catalogue price to ₹${formatPaise(rate)}?`,
      message: 'This changes the saved price for future documents. Existing documents are untouched.',
      buttons: [
        { text: 'Keep catalogue price', role: 'cancel' },
        {
          text: 'Update',
          handler: () => {
            void this.masters
              .updateCatalogueRate(catalogueItemId, rate)
              .then(() => this.toast.show('Catalogue price updated.'));
          },
        },
      ],
    });
    await alert.present();
  }

  lineDiscount(line: LineItem, value: string): void {
    this.store.patchLine(line.id, { discountBp: parsePercentToBasisPoints(value) ?? 0 });
  }

  lineTax(line: LineItem, rateBp: number): void {
    this.store.patchLine(line.id, { taxRateBp: rateBp });
  }

  /** §7.3: complimentary lines are a first-class feature, not a zero-rupee hack. */
  lineFree(line: LineItem, isFree: boolean): void {
    this.store.patchLine(line.id, { isFree });
  }

  async removeLine(line: LineItem): Promise<void> {
    const removed = this.store.removeLine(line.id);
    if (!removed) return;
    this.toast.withAction('Line removed.', 'Undo', () =>
      this.store.restoreLine(removed.line, removed.position),
    );
  }

  moveLine(index: number, delta: number): void {
    this.store.moveLine(index, index + delta);
  }

  /** Per-line computed figures, for the tax note under each row. */
  lineCalc(index: number) {
    return this.calc()?.lines[index] ?? null;
  }

  // -------------------------------------------------------------------------
  // Charges
  // -------------------------------------------------------------------------

  onDiscountMode(mode: DiscountMode): void {
    this.store.patchDocument({ discountMode: mode, discountValue: 0 });
  }

  onDiscountValue(value: string): void {
    const doc = this.document();
    if (!doc) return;
    const parsed =
      doc.discountMode === 'percent' ? parsePercentToBasisPoints(value) : parseCurrencyToPaise(value);
    this.store.patchDocument({ discountValue: parsed ?? 0 });
  }

  onShipping(value: string): void {
    this.store.patchDocument({ shippingAmount: parseCurrencyToPaise(value) ?? 0 });
  }

  onTaxMode(mode: TaxMode): void {
    this.store.patchDocument({ taxMode: mode });
  }

  onFlatRate(value: string): void {
    this.store.patchDocument({ flatTaxRateBp: parsePercentToBasisPoints(value) ?? 0 });
  }

  onRoundOff(enabled: boolean): void {
    this.store.patchDocument({ roundOffEnabled: enabled });
  }

  // -------------------------------------------------------------------------
  // Status and navigation
  // -------------------------------------------------------------------------

  /**
   * Apply a status change.
   *
   * Leaving `draft` is one of the two moments a number is allocated (§8.3), and the store is
   * reloaded afterwards so the freshly allocated number cannot be overwritten by a later autosave.
   */
  async setStatus(status: DocumentStatus): Promise<void> {
    const doc = this.document();
    if (!doc) return;
    await this.store.flush();
    if (status !== 'draft') await this.repository.ensureNumber(doc.id);
    await this.repository.setStatus(doc.id, status);
    await this.store.reload(doc.id);
    await this.refreshNumberPreview();
    this.toast.show(statusLabel(status));
  }

  /** §8.4: the user may type any number; a duplicate is warned about, never blocked. */
  async editNumber(): Promise<void> {
    const doc = this.document();
    if (!doc) return;

    const alert = await this.alerts.create({
      header: 'Set number manually',
      inputs: [{ name: 'number', type: 'text', value: doc.number, placeholder: this.numberPreview() ?? '' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (data: { number?: string }) => {
            void this.applyManualNumber(doc.id, doc.type, (data.number ?? '').trim());
          },
        },
      ],
    });
    await alert.present();
  }

  private async applyManualNumber(
    id: string,
    type: 'quotation' | 'invoice' | 'receipt',
    numberText: string,
  ): Promise<void> {
    const used = await this.repository.usedNumbers(type, id);
    const duplicate = isDuplicateNumber(numberText, used);
    await this.repository.setNumberManually(id, numberText, duplicate);
    await this.store.reload(id);
    if (duplicate) {
      this.toast.show('This number is already used by another document of this type.');
    }
  }

  async openPreview(): Promise<void> {
    const doc = this.document();
    if (!doc) return;
    await this.store.flush();
    await this.router.navigate(['/document', doc.id, 'preview']);
  }

  // Formatting helpers for the template, so it never formats a number itself.
  readonly formatPaise = formatPaise;
  readonly formatMilli = formatMilli;
  readonly formatBasisPoints = formatBasisPoints;
}
