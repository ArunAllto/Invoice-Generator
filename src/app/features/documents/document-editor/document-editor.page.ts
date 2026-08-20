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
  ActionSheetController,
  AlertController,
  IonAccordion,
  IonAccordionGroup,
  IonBadge,
  IonBackButton,
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
  IonRadio,
  IonRadioGroup,
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
import {
  arrowDownOutline,
  arrowUpOutline,
  closeOutline,
  shareOutline,
  trashOutline,
} from 'ionicons/icons';

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
import {
  allowedTransitions,
  canHardDelete,
  deriveStatus,
  isEditable,
  statusLabel,
  transitionLabel,
} from '../../../core/status';
import type {
  DiscountMode,
  DocumentBlocks,
  DocumentStatus,
  Paise,
  PaymentMethod,
  TaxMode,
  TemplateId,
} from '../../../core/types';
import { todayIso } from '../../../core/dates';
import type {
  DocumentListItem,
  LineItem,
  Payment,
} from '../../../data/repositories/documents.repository';
import { DocumentsRepository } from '../../../data/repositories/documents.repository';
import {
  MastersRepository,
  SETTINGS_KEYS,
  type TaxPreset,
} from '../../../data/repositories/masters.repository';
import { IsoDatePipe } from '../../../shared/pipes/iso-date.pipe';
import { PaisePipe } from '../../../shared/pipes/paise.pipe';
import { StatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import { ToastService } from '../../../shared/ui/toast.service';
import { buildExportFilename } from '../../../export/filename';
import { ExportService } from '../../../export/export.service';
import { renderDocumentHtml } from '../../../render/html';
import { toRenderInput } from '../../../render/adapt';
import { buildDocumentUpiQr } from '../../../render/upi-qr';
import { RenderSettingsService } from '../../../render/render-settings.service';
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
    IonBackButton,
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
    IonRadio,
    IonRadioGroup,
    IonBadge,
    IonSpinner,
    PaisePipe,
    IsoDatePipe,
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
  private readonly renderSettings = inject(RenderSettingsService);
  private readonly exports = inject(ExportService);
  private readonly sheets = inject(ActionSheetController);
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

  /**
   * Status transitions the user may choose (§6.4).
   *
   * Built from `allowedTransitions` rather than spelled out here. The hand-written version this
   * replaced offered "Mark as sent" on a draft invoice and then nothing whatsoever once it was sent —
   * so an invoice could never be cancelled, though the domain has always permitted it, and an issued
   * receipt could not be cancelled either. Reading the transition table means the buttons cannot
   * disagree with what `setStatus` will actually accept.
   *
   * The *derived* status is the starting point, because that is the status the user is looking at: an
   * overdue invoice is stored as `sent`, and offering it "Mark as sent" would be nonsense.
   */
  readonly statusActions = computed<ReadonlyArray<{ label: string; status: DocumentStatus }>>(() => {
    const doc = this.document();
    const shown = this.derived()?.status;
    if (!doc || !shown) return [];
    return allowedTransitions(doc.type, shown).map((status) => ({
      label: transitionLabel(doc.type, status),
      status,
    }));
  });

  constructor() {
    addIcons({ closeOutline, arrowUpOutline, arrowDownOutline, shareOutline, trashOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.store.load(this.id());
    this.taxPresets.set(await this.masters.listTaxPresets());
    await this.refreshNumberPreview();
    await this.refreshPayments();
    await this.refreshRelated();
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
      this.toast.warning('Your catalogue is empty. Add items in Settings.');
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
              .then(() => this.toast.success('Catalogue price updated.'));
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
  // What appears on the document (§6.2, §10.1)
  // -------------------------------------------------------------------------

  /**
   * The togglable parts of the output, as data.
   *
   * Declared here rather than spelled out in the template so each one can carry the sentence that
   * explains what turning it off actually does. "Tax columns" is not self-explanatory, and a toggle
   * whose effect you have to discover by previewing is a toggle people leave alone.
   *
   * Only blocks the owner has a reason to change are listed. `clientBlock` is deliberately absent:
   * §7.4 already drops it when there is no client, and hiding a client who *is* on the document
   * would produce a bill addressed to nobody.
   */
  readonly blockOptions: ReadonlyArray<{
    key: keyof DocumentBlocks;
    label: string;
    hint: string;
  }> = [
    { key: 'descriptions', label: 'Item descriptions', hint: 'The second line under each item name.' },
    { key: 'unitColumn', label: 'Unit column', hint: 'Shows nos, kg, sqft beside the quantity.' },
    { key: 'hsnColumn', label: 'HSN / SAC column', hint: 'Required on a GST invoice above the turnover threshold.' },
    { key: 'taxColumns', label: 'Tax column', hint: 'The per-line tax rate. Turn off for a tax-inclusive quote.' },
    { key: 'taxSummary', label: 'Tax summary table', hint: 'Totals by rate at the foot, with the CGST/SGST split.' },
    { key: 'discountRow', label: 'Discount row', hint: 'Hidden automatically when there is no discount.' },
    { key: 'shippingRow', label: 'Delivery / shipping row', hint: 'Show even when the charge is zero.' },
    { key: 'roundOffRow', label: 'Round-off row', hint: 'Shows the paise added or dropped to reach a whole rupee.' },
    { key: 'amountInWords', label: 'Amount in words', hint: 'Rupees and paise spelled out under the total.' },
    { key: 'bankDetails', label: 'Bank details', hint: 'Only the fields filled in on your business profile are printed.' },
    { key: 'upiQr', label: 'UPI payment QR', hint: 'Needs a UPI ID on your business profile.' },
    { key: 'signature', label: 'Signature block', hint: 'The "Authorised Signatory" line at the foot.' },
    { key: 'terms', label: 'Terms & conditions', hint: 'The terms typed on this document.' },
    { key: 'notes', label: 'Notes', hint: 'The notes typed on this document.' },
    { key: 'footerLine', label: 'Footer line', hint: 'Your name, phone and email across the bottom of every page.' },
  ];

  /**
   * Whether a block would have any visible effect if switched on.
   *
   * A toggle that silently does nothing is worse than one that is absent, so the UPI QR says why it
   * cannot appear rather than pretending. Checked against the document's own snapshot, not the
   * current profile — the snapshot is what will be printed (§5.4).
   */
  blockUnavailableReason(key: keyof DocumentBlocks): string | null {
    const doc = this.document();
    if (!doc) return null;
    if (key === 'upiQr' && !doc.businessSnapshot.upiId) {
      return 'Add a UPI ID to your business profile first.';
    }
    if (key === 'bankDetails' && !doc.businessSnapshot.bankName && !doc.businessSnapshot.bankAccountNo) {
      return 'Add bank details to your business profile first.';
    }
    if ((key === 'taxColumns' || key === 'taxSummary') && doc.taxMode === 'none') {
      return 'This document has no tax on it.';
    }
    // The renderer only draws the HSN column when a line actually carries a code, so an empty
    // column is never printed. Without saying so, the toggle looks broken.
    if (key === 'hsnColumn' && !this.lines().some((line) => line.hsnSac.trim().length > 0)) {
      return 'No item has an HSN or SAC code yet.';
    }
    return null;
  }

  blockValue(key: keyof DocumentBlocks): boolean {
    return this.document()?.blocks[key] ?? false;
  }

  toggleBlock(key: keyof DocumentBlocks, enabled: boolean): void {
    const doc = this.document();
    if (!doc) return;
    this.store.setBlocks({ ...doc.blocks, [key]: enabled });
  }

  /**
   * Save this document's block choices as the default for new documents (§13).
   *
   * Offered because the owner's preference is a property of how they invoice, not of one invoice.
   * Setting it up once per document is the sort of friction that makes people stop using a toggle
   * at all.
   */
  async saveBlocksAsDefault(): Promise<void> {
    const doc = this.document();
    if (!doc) return;
    try {
      await this.masters.setSetting(SETTINGS_KEYS.defaultBlocks, JSON.stringify(doc.blocks));
      this.toast.success('New documents will start like this.');
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  // -------------------------------------------------------------------------
  // Client (§7.4)
  // -------------------------------------------------------------------------

  /**
   * Choose the client this document is addressed to.
   *
   * A radio alert rather than a search screen: this is a single-owner app whose client list is
   * dozens long, not thousands, and a full-screen picker would be three taps where one will do. If
   * the list ever outgrows that, this is the one place to replace.
   *
   * Archived clients are left out (§5.2) — they exist so old documents keep working, not so new
   * ones can be addressed to them.
   */
  async chooseClient(): Promise<void> {
    const doc = this.document();
    if (!doc) return;
    await this.store.flush();

    const clients = await this.masters.listClients();
    if (clients.length === 0) {
      this.toast.warning('No clients yet. Add one on the Clients tab.');
      return;
    }

    const alert = await this.alerts.create({
      header: 'Client',
      inputs: [
        // §7.4: no client is a real choice, not an absence of one — a walk-in sale prints no client
        // block at all, and the owner needs to be able to go back to that.
        {
          type: 'radio' as const,
          label: 'No client / walk-in',
          value: '',
          checked: doc.clientId === null,
        },
        ...clients.map((client) => ({
          type: 'radio' as const,
          label: client.company || client.name,
          value: client.id,
          checked: client.id === doc.clientId,
        })),
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Choose',
          handler: (clientId: string) => {
            void this.applyClient(doc.id, clientId === '' ? null : clientId);
          },
        },
      ],
    });
    await alert.present();
  }

  private async applyClient(documentId: string, clientId: string | null): Promise<void> {
    try {
      await this.repository.setClient(documentId, clientId);
      // Reload rather than patch: the snapshot is built in the repository, and copying it back by
      // hand here would be a second place for §5.4 to be got wrong.
      await this.store.reload(documentId);
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  // -------------------------------------------------------------------------
  // Payments (§6.5)
  // -------------------------------------------------------------------------

  /**
   * Payments recorded against this invoice.
   *
   * Kept as its own signal rather than read off the store, because recording a payment changes no
   * document field — `paid`, `partially_paid` and the balance are all derived from this table on
   * read (§6.4). The store has nothing to tell it that anything happened, so the list refreshes
   * itself and then asks the store to reload so the status chip catches up.
   */
  readonly paymentList = signal<Payment[]>([]);

  readonly paidTotal = computed<Paise>(() =>
    this.paymentList().reduce((sum, payment) => sum + payment.amount, 0),
  );

  readonly balanceDue = computed<Paise>(() =>
    Math.max(0, this.grandTotal() - this.paidTotal()),
  );

  /** Only invoices take payments. A quotation is not owed and a receipt *is* the acknowledgement. */
  readonly acceptsPayments = computed(() => this.document()?.type === 'invoice');

  private async refreshPayments(): Promise<void> {
    const doc = this.document();
    if (!doc || doc.type !== 'invoice') {
      this.paymentList.set([]);
      return;
    }
    this.paymentList.set(await this.repository.listPayments(doc.id));
  }

  /**
   * Record a payment.
   *
   * The amount defaults to the outstanding balance, which is what is being paid the overwhelming
   * majority of the time, and the field is still editable for a part payment. Entering it through
   * `parseCurrencyToPaise` rather than `Number()` keeps the one decimal parser of §16.5 in charge —
   * "1,250.50" and "1250.5" both have to mean the same thing here as everywhere else.
   */
  async recordPayment(): Promise<void> {
    const doc = this.document();
    if (!doc || doc.type !== 'invoice') return;
    await this.store.flush();

    const alert = await this.alerts.create({
      header: 'Record a payment',
      inputs: [
        {
          name: 'amount',
          type: 'text',
          value: formatPaise(this.balanceDue()),
          placeholder: 'Amount received',
          attributes: { inputmode: 'decimal' },
        },
        { name: 'paidOn', type: 'date', value: todayIso() },
        { name: 'reference', type: 'text', placeholder: 'Reference (UPI ref, cheque no.)' },
        { name: 'notes', type: 'text', placeholder: 'Note (optional)' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Next',
          handler: (values: {
            amount?: string;
            paidOn?: string;
            reference?: string;
            notes?: string;
          }) => {
            // How it was paid is asked separately, because Ionic hands a radio group's value to the
            // handler *instead of* the input map — mixing the two would mean scraping the amount back
            // out of the DOM.
            void this.askPaymentMethod(doc.id, values);
          },
        },
      ],
    });
    await alert.present();
  }

  /** Which of the six §6.5 methods the money arrived by. Defaulted to UPI, the common case. */
  private async askPaymentMethod(
    invoiceId: string,
    values: { amount?: string; paidOn?: string; reference?: string; notes?: string },
  ): Promise<void> {
    const alert = await this.alerts.create({
      header: 'How was it paid?',
      inputs: this.paymentMethods.map((method) => ({
        type: 'radio' as const,
        label: method.label,
        value: method.value,
        checked: method.value === 'upi',
      })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Record',
          handler: (method: PaymentMethod) => {
            void this.savePayment(invoiceId, { ...values, method: method ?? 'upi' });
          },
        },
      ],
    });
    await alert.present();
  }

  readonly paymentMethods: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
    { value: 'upi', label: 'UPI' },
    { value: 'cash', label: 'Cash' },
    { value: 'bank_transfer', label: 'Bank transfer' },
    { value: 'cheque', label: 'Cheque' },
    { value: 'card', label: 'Card' },
    { value: 'other', label: 'Other' },
  ];

  /** Human label for a stored method, so the list does not print `bank_transfer`. */
  methodLabel(method: PaymentMethod): string {
    return this.paymentMethods.find((m) => m.value === method)?.label ?? method;
  }

  private async savePayment(
    invoiceId: string,
    values: {
      amount?: string;
      paidOn?: string;
      reference?: string;
      notes?: string;
      method?: PaymentMethod;
    },
  ): Promise<void> {
    const amount = parseCurrencyToPaise(values.amount ?? '');
    if (amount === null || amount <= 0) {
      this.toast.warning('Enter an amount greater than zero.');
      return;
    }
    try {
      await this.repository.addPayment({
        invoiceId,
        amount,
        paidOn: values.paidOn ?? todayIso(),
        reference: (values.reference ?? '').trim(),
        notes: (values.notes ?? '').trim(),
        method: values.method ?? 'upi',
      });
      await this.afterPaymentChange(invoiceId);
      this.toast.success(`Recorded ${formatPaise(amount)}.`);
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  /** Remove a payment, after confirming — it changes what the invoice says is owed. */
  async removePayment(payment: Payment): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Delete this payment?',
      message: `${formatPaise(payment.amount)} received on ${payment.paidOn}. The invoice will show that much as outstanding again.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            void this.confirmRemovePayment(payment);
          },
        },
      ],
    });
    await alert.present();
  }

  private async confirmRemovePayment(payment: Payment): Promise<void> {
    try {
      await this.repository.deletePayment(payment.id);
      await this.afterPaymentChange(payment.invoiceId);
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  /**
   * Raise a receipt for a payment and open it.
   *
   * The receipt is a document of its own, so the owner lands in its editor where they can preview
   * and send it. A payment that already has one navigates to the existing receipt rather than
   * raising a second: two receipts for one payment is a bookkeeping problem, not a convenience.
   */
  async issueReceipt(payment: Payment): Promise<void> {
    try {
      const receipt = await this.repository.issueReceiptForPayment(payment.id);
      if (!receipt) {
        this.toast.error('That payment could not be turned into a receipt.');
        return;
      }
      await this.refreshPayments();
      await this.router.navigate(['/document', receipt.document.id]);
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  /** Reload the payment list and the document, so the derived status and chip follow. */
  private async afterPaymentChange(invoiceId: string): Promise<void> {
    await this.refreshPayments();
    await this.store.reload(invoiceId);
  }

  // -------------------------------------------------------------------------
  // Copying, converting and linking (§6.8)
  // -------------------------------------------------------------------------

  /** The invoice raised from this quotation, or the document this one came from. */
  readonly relatedDocument = signal<DocumentListItem | null>(null);

  readonly canConvert = computed(
    () => this.document()?.type === 'quotation' && this.relatedDocument() === null,
  );

  private async refreshRelated(): Promise<void> {
    const doc = this.document();
    if (!doc) {
      this.relatedDocument.set(null);
      return;
    }
    this.relatedDocument.set(
      doc.type === 'quotation'
        ? await this.repository.invoiceForQuotation(doc.id)
        : await this.repository.linkedDocument(doc.id),
    );
  }

  /**
   * Raise an invoice from this quotation.
   *
   * The quotation is left untouched — it is the record of what the client agreed to, and rewriting it
   * once the work is billed would destroy that. The two are joined instead, and this screen then
   * shows the link both ways.
   */
  async convertToInvoice(): Promise<void> {
    const doc = this.document();
    if (!doc) return;
    await this.store.flush();

    const alert = await this.alerts.create({
      header: 'Raise an invoice from this?',
      message:
        'A new invoice is created with the same items and rates. This quotation is left exactly as ' +
        'it is, and the two are linked.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Create invoice', handler: () => void this.applyConvert(doc.id) },
      ],
    });
    await alert.present();
  }

  private async applyConvert(id: string): Promise<void> {
    try {
      const invoice = await this.repository.convertQuotationToInvoice(id);
      this.toast.success('Invoice created from this quotation.');
      await this.router.navigate(['/document', invoice.document.id]);
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  /** Copy this document as a fresh draft — the repeat-job case. */
  async duplicateDocument(): Promise<void> {
    const doc = this.document();
    if (!doc) return;
    await this.store.flush();
    try {
      const copy = await this.repository.duplicate(doc.id);
      if (!copy) {
        this.toast.error('That document could not be copied.');
        return;
      }
      this.toast.success('Copied as a new draft.');
      await this.router.navigate(['/document', copy.document.id]);
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  openRelated(): void {
    const related = this.relatedDocument();
    if (related) void this.router.navigate(['/document', related.id]);
  }

  // -------------------------------------------------------------------------
  // This document's own look (§10.6)
  // -------------------------------------------------------------------------

  /**
   * Template and accent for *this* document, overriding the profile default.
   *
   * §10.6: switching template changes only the CSS, so no number moves — which is what makes it safe
   * to offer per document rather than only as a global default. A one-off job for a client with their
   * own colours does not need the whole app reconfigured.
   */
  readonly templateOptions: ReadonlyArray<{ value: TemplateId; label: string }> = [
    { value: 'classic', label: 'Classic' },
    { value: 'bold', label: 'Bold' },
    { value: 'compact', label: 'Compact' },
    { value: 'minimal', label: 'Minimal' },
  ];

  readonly accentSwatches: readonly string[] = [
    '#0F4C81',
    '#0F6F75',
    '#7A2F5F',
    '#1D6B3F',
    '#B3541E',
    '#25292F',
  ];

  onTemplate(templateId: TemplateId): void {
    this.store.patchDocument({ templateId });
  }

  onAccent(accentColor: string): void {
    this.store.patchDocument({ accentColor });
  }

  currentAccent(): string {
    return this.document()?.accentColor ?? '#0F4C81';
  }

  /** Currency the amounts are labelled with (§9.1). */
  readonly currencyOptions: readonly string[] = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

  onCurrency(currency: string): void {
    this.store.patchDocument({ currency });
  }

  // -------------------------------------------------------------------------
  // Getting it out, and getting rid of it (§10.2, §6.7)
  // -------------------------------------------------------------------------

  /**
   * Build the export payload for this document.
   *
   * Flushes first: exporting a document with an unsaved edit still in the debounce window would
   * hand out a file that does not match what the app shows, which is the worst possible way to
   * discover autosave latency.
   */
  private async buildExport(): Promise<{ html: string; baseName: string } | null> {
    const doc = this.document();
    if (!doc) return null;
    await this.store.flush();

    const loaded = await this.repository.get(doc.id);
    if (!loaded) return null;

    const calc = this.repository.calculate(loaded.document, loaded.lines);
    const input = toRenderInput(
      { document: loaded.document, lines: loaded.lines, calc, derived: loaded.derived },
      {
        ...(await this.renderSettings.load()),
        upiQrSvg: buildDocumentUpiQr({
          document: loaded.document,
          balance: loaded.derived.balance,
          grandTotal: calc.grandTotal,
        }),
      },
    );
    const filename = buildExportFilename({
      type: loaded.document.type,
      number: loaded.document.number,
      clientName: loaded.document.clientSnapshot?.company || loaded.document.clientSnapshot?.name || null,
      businessName: loaded.document.businessSnapshot.name,
      extension: 'html',
    });
    return {
      html: renderDocumentHtml(input),
      // The service adds the extension, so it is stripped here rather than duplicated.
      baseName: filename.replace(/\.html$/, ''),
    };
  }

  /**
   * The export sheet.
   *
   * Print is listed first because "Save as PDF" lives inside the platform print dialogue — it is
   * the route to a PDF, not an alternative to one, and calling it "Print" while hiding that would
   * send people looking for a PDF button that does not exist.
   */
  async openExport(): Promise<void> {
    const doc = this.document();
    if (!doc) return;

    const buttons: Array<{ text: string; role?: 'cancel' | 'destructive'; handler?: () => void }> = [
      { text: 'Print or save as PDF', handler: () => void this.exportPrint() },
      { text: 'Save as an HTML file', handler: () => void this.exportHtml() },
    ];
    if (this.exports.canShareFiles || this.exports.canShareText) {
      buttons.push({ text: 'Share…', handler: () => void this.exportShare() });
    }
    buttons.push({ text: 'Open the full preview', handler: () => void this.openPreview() });
    buttons.push({ text: 'Cancel', role: 'cancel' });

    const sheet = await this.sheets.create({
      header: doc.number.trim().length > 0 ? doc.number : 'Draft',
      subHeader: 'How would you like it?',
      buttons,
    });
    await sheet.present();
  }

  private async exportPrint(): Promise<void> {
    const payload = await this.buildExport();
    if (!payload) return;
    await this.exports.print(payload);
  }

  private async exportHtml(): Promise<void> {
    const payload = await this.buildExport();
    if (!payload) return;
    this.exports.saveHtml(payload);
  }

  private async exportShare(): Promise<void> {
    const payload = await this.buildExport();
    if (!payload) return;
    const doc = this.document();
    const label = doc?.number.trim().length ? `${this.typeTitle()} ${doc.number}` : this.typeTitle();
    await this.exports.share(payload, label);
  }

  /**
   * Delete this document.
   *
   * §6.4 forbids hard-deleting an issued receipt — it is evidence that money changed hands — so the
   * check is `canHardDelete`, and a receipt that cannot be deleted is offered cancellation instead.
   * The confirmation names what will go with it, because line items and payments cascade and the
   * owner cannot see that from here.
   */
  async deleteDocument(): Promise<void> {
    const doc = this.document();
    if (!doc) return;

    if (!canHardDelete(doc.type, doc.status)) {
      this.toast.warning('An issued receipt cannot be deleted. Cancel it instead.');
      return;
    }

    const extras: string[] = [];
    const lineCount = this.lines().length;
    const paymentCount = this.paymentList().length;
    if (lineCount > 0) extras.push(`${lineCount} line ${lineCount === 1 ? 'item' : 'items'}`);
    if (paymentCount > 0) extras.push(`${paymentCount} recorded ${paymentCount === 1 ? 'payment' : 'payments'}`);

    const alert = await this.alerts.create({
      header: `Delete ${doc.number.trim().length > 0 ? doc.number : 'this draft'}?`,
      message:
        extras.length > 0
          ? `${extras.join(' and ')} go with it. This cannot be undone.`
          : 'This cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            void this.confirmDelete(doc.id);
          },
        },
      ],
    });
    await alert.present();
  }

  private async confirmDelete(id: string): Promise<void> {
    try {
      // Reset before deleting, so the debounced autosave cannot resurrect the row it is holding.
      this.store.reset();
      await this.repository.delete(id);
      this.toast.success('Deleted.');
      await this.router.navigateByUrl('/tabs/documents');
    } catch (cause) {
      this.toast.error(cause);
    }
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
    this.toast.success(statusLabel(status));
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
      this.toast.warning('This number is already used by another document of this type.');
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
