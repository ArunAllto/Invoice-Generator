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
  AlertController,
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
import { MastersRepository, SETTINGS_KEYS } from '../../data/repositories/masters.repository';
import { nowIsoWithOffset } from '../../core/dates';
import { ToastService } from '../../shared/ui/toast.service';
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
  private readonly alerts = inject(AlertController);
  private readonly toast = inject(ToastService);
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

  // -------------------------------------------------------------------------
  // Clearing the Recent list (§4.1)
  // -------------------------------------------------------------------------

  /**
   * Hide everything currently in Recent.
   *
   * Recent is derived from the documents themselves, so this cannot delete anything — it records
   * "cleared at this moment" and the list then shows only what was touched afterwards. That makes
   * it reversible, and it means the outstanding totals above are untouched: hiding a row from a
   * list must never change what a client owes.
   *
   * The confirmation says so explicitly, because "Clear" next to a list of invoices is exactly the
   * kind of button people are right to be wary of.
   */
  async clearRecent(): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Clear the Recent list?',
      message:
        'This only hides them here. No document is deleted, nothing changes on the Documents tab, ' +
        'and the amounts above stay the same.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Clear', handler: () => void this.applyClearRecent() },
      ],
    });
    await alert.present();
  }

  private async applyClearRecent(): Promise<void> {
    try {
      await this.masters.setSetting(SETTINGS_KEYS.recentClearedAt, nowIsoWithOffset());
      await this.reload();
      this.toast.success('Recent cleared. Nothing was deleted.');
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  /** Drop the marker, so everything shows again. */
  async restoreRecent(): Promise<void> {
    try {
      // Blank rather than a deleted row: every reader treats an empty setting as absent, which is
      // one fewer state than "missing vs empty vs set".
      await this.masters.setSetting(SETTINGS_KEYS.recentClearedAt, '');
      await this.reload();
      this.toast.info('Showing everything again.');
    } catch (cause) {
      this.toast.error(cause);
    }
  }
}
