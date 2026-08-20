/**
 * All Documents — spec §6.6.
 *
 * Type and status filter chips, search across number / client / item names, and sort by date or
 * amount.
 *
 * Status filtering is applied to the *derived* status by the repository, not to the stored column
 * — `overdue`, `paid` and `partially_paid` are computed from the payments table and the clock
 * (§6.4), so filtering on what is stored would hide exactly the invoices the owner is hunting
 * for.
 */

import { Component, inject, signal, type OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  ActionSheetController,
  AlertController,
  IonBadge,
  IonButtons,
  IonChip,
  IonIcon,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonList,
  IonNote,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
  type ViewWillEnter,
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import { shareOutline, trashOutline } from 'ionicons/icons';

import { canHardDelete } from '../../../core/status';
import type { DocumentStatus, DocumentType } from '../../../core/types';
import {
  DocumentsRepository,
  type DocumentListItem,
} from '../../../data/repositories/documents.repository';
import { ExportService } from '../../../export/export.service';
import { buildExportFilename } from '../../../export/filename';
import { toRenderInput } from '../../../render/adapt';
import { buildDocumentUpiQr } from '../../../render/upi-qr';
import { renderDocumentHtml } from '../../../render/html';
import { ToastService } from '../../../shared/ui/toast.service';
import { IsoDatePipe } from '../../../shared/pipes/iso-date.pipe';
import { PaisePipe } from '../../../shared/pipes/paise.pipe';
import { StatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';

type TypeFilter = 'all' | DocumentType;
type StatusFilter = 'all' | DocumentStatus;

const TYPE_LABELS: Record<DocumentType, string> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  receipt: 'Receipt',
};

@Component({
  selector: 'app-document-list',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonContent,
    IonSearchbar,
    IonSegment,
    IonSegmentButton,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonChip,
    IonBadge,
    IonIcon,
    IonItemSliding,
    IonItemOptions,
    IonItemOption,
    IonSpinner,
    PaisePipe,
    IsoDatePipe,
    StatusChipComponent,
  ],
  templateUrl: './document-list.page.html',
  styleUrl: './document-list.page.scss',
})
export class DocumentListPage implements OnInit, ViewWillEnter {
  private readonly documents = inject(DocumentsRepository);
  private readonly router = inject(Router);
  private readonly exports = inject(ExportService);
  private readonly sheets = inject(ActionSheetController);
  private readonly alerts = inject(AlertController);
  private readonly toast = inject(ToastService);

  readonly items = signal<DocumentListItem[]>([]);
  readonly loading = signal(true);
  readonly typeFilter = signal<TypeFilter>('all');
  readonly statusFilter = signal<StatusFilter>('all');
  readonly search = signal('');
  readonly sortBy = signal<'date' | 'amount'>('date');

  readonly typeLabels = TYPE_LABELS;

  readonly statusOptions: ReadonlyArray<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Sent' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'partially_paid', label: 'Part paid' },
    { value: 'paid', label: 'Paid' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'expired', label: 'Expired' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  /**
   * First load. Angular's own hook is the reliable one — Ionic's `ionViewWillEnter` does not
   * fire for the initially-activated tab route, which left this page on a spinner for ever.
   */
  constructor() {
    addIcons({ shareOutline, trashOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  /**
   * Re-entry. Derived statuses depend on today's date and the payments table (§6.4), so a list
   * cached from an earlier visit can be wrong by the time the user comes back.
   */
  async ionViewWillEnter(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const type = this.typeFilter();
      const status = this.statusFilter();
      this.items.set(
        await this.documents.list({
          types: type === 'all' ? undefined : [type],
          statuses: status === 'all' ? undefined : [status],
          search: this.search(),
          sortBy: this.sortBy(),
          sortDirection: 'desc',
        }),
      );
    } finally {
      this.loading.set(false);
    }
  }

  async onTypeChange(value: string | undefined): Promise<void> {
    this.typeFilter.set((value ?? 'all') as TypeFilter);
    await this.reload();
  }

  async onStatusChange(value: StatusFilter): Promise<void> {
    this.statusFilter.set(value);
    await this.reload();
  }

  async onSearch(value: string | null | undefined): Promise<void> {
    this.search.set(value ?? '');
    await this.reload();
  }

  async toggleSort(): Promise<void> {
    this.sortBy.set(this.sortBy() === 'date' ? 'amount' : 'date');
    await this.reload();
  }

  open(id: string): void {
    void this.router.navigate(['/document', id]);
  }

  // -------------------------------------------------------------------------
  // Row actions (§6.7, §10.2)
  // -------------------------------------------------------------------------

  /**
   * Export straight from the list.
   *
   * Reached by swiping the row, so the common case — open, check, send — is untouched, but a
   * document the owner already knows is right can be sent without opening it at all.
   */
  async exportItem(item: DocumentListItem): Promise<void> {
    const payload = await this.buildExport(item.id);
    if (!payload) return;

    const buttons: Array<{ text: string; role?: 'cancel' | 'destructive'; handler?: () => void }> = [
      { text: 'Print or save as PDF', handler: () => void this.exports.print(payload) },
      { text: 'Save as an HTML file', handler: () => this.exports.saveHtml(payload) },
    ];
    if (this.exports.canShareFiles || this.exports.canShareText) {
      buttons.push({
        text: 'Share…',
        handler: () => void this.exports.share(payload, item.number || 'Document'),
      });
    }
    buttons.push({ text: 'Cancel', role: 'cancel' });

    const sheet = await this.sheets.create({
      header: item.number || '(draft)',
      buttons,
    });
    await sheet.present();
  }

  private async buildExport(id: string): Promise<{ html: string; baseName: string } | null> {
    const loaded = await this.documents.get(id);
    if (!loaded) {
      this.toast.error('That document could not be loaded.');
      return null;
    }
    const calc = this.documents.calculate(loaded.document, loaded.lines);
    const html = renderDocumentHtml(
      toRenderInput(
        { document: loaded.document, lines: loaded.lines, calc, derived: loaded.derived },
        {
          upiQrSvg: buildDocumentUpiQr({
            document: loaded.document,
            balance: loaded.derived.balance,
            grandTotal: calc.grandTotal,
          }),
        },
      ),
    );
    const filename = buildExportFilename({
      type: loaded.document.type,
      number: loaded.document.number,
      clientName:
        loaded.document.clientSnapshot?.company || loaded.document.clientSnapshot?.name || null,
      businessName: loaded.document.businessSnapshot.name,
      extension: 'html',
    });
    return { html, baseName: filename.replace(/\.html$/, '') };
  }

  /**
   * Delete a document from the list.
   *
   * §6.4 forbids hard-deleting an issued receipt, so that case is refused with the alternative
   * rather than a bare "no". The confirmation names the line items and payments that cascade,
   * because the row does not show them.
   */
  async deleteItem(item: DocumentListItem): Promise<void> {
    if (!canHardDelete(item.type, item.status)) {
      this.toast.warning('An issued receipt cannot be deleted. Open it and cancel it instead.');
      return;
    }

    const alert = await this.alerts.create({
      header: `Delete ${item.number || 'this draft'}?`,
      message:
        item.type === 'invoice' && item.balance > 0
          ? 'Its line items and any recorded payments go with it. This cannot be undone.'
          : 'Its line items go with it. This cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            void this.confirmDelete(item);
          },
        },
      ],
    });
    await alert.present();
  }

  private async confirmDelete(item: DocumentListItem): Promise<void> {
    try {
      await this.documents.delete(item.id);
      await this.reload();
      this.toast.success(`${item.number || 'Draft'} deleted.`);
    } catch (cause) {
      this.toast.error(cause);
    }
  }
}
