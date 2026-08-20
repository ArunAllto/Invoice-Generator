/**
 * Home / Dashboard — spec §4.1.
 *
 * Three large primary buttons, the summary strip, the last five documents, and the
 * profile-completion banner.
 *
 * Creating a document goes straight to the editor with no intermediate form (§6.1), and takes no
 * number (§8.3), so an abandoned draft leaves no gap in the owner's numbering.
 */

import { Component, inject, signal, type OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  type ViewWillEnter,
} from '@ionic/angular';

import type { DocumentType } from '../../core/types';
import {
  DocumentsRepository,
  type DashboardSummary,
} from '../../data/repositories/documents.repository';
import { MastersRepository } from '../../data/repositories/masters.repository';
import { IsoDatePipe } from '../../shared/pipes/iso-date.pipe';
import { PaisePipe } from '../../shared/pipes/paise.pipe';
import { StatusChipComponent } from '../../shared/ui/status-chip/status-chip.component';

const TYPE_LABELS: Record<DocumentType, string> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  receipt: 'Receipt',
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonCard,
    IonCardContent,
    IonButton,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonText,
    IonSpinner,
    PaisePipe,
    IsoDatePipe,
    StatusChipComponent,
  ],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage implements OnInit, ViewWillEnter {
  private readonly documents = inject(DocumentsRepository);
  private readonly masters = inject(MastersRepository);
  private readonly router = inject(Router);

  readonly summary = signal<DashboardSummary | null>(null);
  readonly profileIncomplete = signal(false);
  readonly bannerDismissed = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly typeLabels = TYPE_LABELS;

  /**
   * Reload on every entry rather than once.
   *
   * Derived statuses depend on today's date and on the payments table (§6.4), so a dashboard
   * cached from yesterday would show an invoice as "sent" that is now overdue.
   */
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
    this.error.set(null);
    try {
      const [summary, profile] = await Promise.all([
        this.documents.dashboardSummary(),
        this.masters.getBusinessProfile(),
      ]);
      this.summary.set(summary);
      this.profileIncomplete.set(!this.masters.isBusinessProfileComplete(profile));
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async create(type: DocumentType): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const created = await this.documents.create({ type });
      await this.router.navigate(['/document', created.document.id]);
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : String(cause));
    } finally {
      this.busy.set(false);
    }
  }

  openDocument(id: string): void {
    void this.router.navigate(['/document', id]);
  }

  openProfile(): void {
    void this.router.navigate(['/settings/business']);
  }
}
