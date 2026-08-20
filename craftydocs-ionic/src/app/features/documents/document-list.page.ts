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
  IonBadge,
  IonButtons,
  IonChip,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
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

import type { DocumentStatus, DocumentType } from '../../core/types';
import {
  DocumentsRepository,
  type DocumentListItem,
} from '../../data/repositories/documents.repository';
import { IsoDatePipe, PaisePipe } from '../../shared/pipes/format.pipes';
import { StatusChipComponent } from '../../shared/ui/status-chip.component';

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
    IonSpinner,
    PaisePipe,
    IsoDatePipe,
    StatusChipComponent,
  ],
  templateUrl: './document-list.page.html',
})
export class DocumentListPage implements OnInit, ViewWillEnter {
  private readonly documents = inject(DocumentsRepository);
  private readonly router = inject(Router);

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
}
