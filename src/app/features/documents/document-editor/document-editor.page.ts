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
import {
  allowedTransitions,
  deriveStatus,
  isEditable,
  statusLabel,
  transitionLabel,
} from '../../../core/status';
import type { DiscountMode, DocumentStatus, Paise, TaxMode } from '../../../core/types';
import { todayIso } from '../../../core/dates';
import type { LineItem, Payment } from '../../../data/repositories/documents.repository';
import { DocumentsRepository } from '../../../data/repositories/documents.repository';
import { MastersRepository, type TaxPreset } from '../../../data/repositories/masters.repository';
import { IsoDatePipe } from '../../../shared/pipes/iso-date.pipe';
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
    addIcons({ closeOutline, arrowUpOutline, arrowDownOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.store.load(this.id());
    this.taxPresets.set(await this.masters.listTaxPresets());
    await this.refreshNumberPreview();
    await this.refreshPayments();
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
      this.toast.show('No clients yet. Add one on the Clients tab.');
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
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Record',
          handler: (values: { amount?: string; paidOn?: string; reference?: string }) => {
            void this.savePayment(doc.id, values);
          },
        },
      ],
    });
    await alert.present();
  }

  private async savePayment(
    invoiceId: string,
    values: { amount?: string; paidOn?: string; reference?: string },
  ): Promise<void> {
    const amount = parseCurrencyToPaise(values.amount ?? '');
    if (amount === null || amount <= 0) {
      this.toast.show('Enter an amount greater than zero.');
      return;
    }
    try {
      await this.repository.addPayment({
        invoiceId,
        amount,
        paidOn: values.paidOn ?? todayIso(),
        reference: (values.reference ?? '').trim(),
      });
      await this.afterPaymentChange(invoiceId);
      this.toast.show(`Recorded ${formatPaise(amount)}.`);
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
        this.toast.show('That payment could not be turned into a receipt.');
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
