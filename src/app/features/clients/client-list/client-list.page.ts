/**
 * Clients — list, search and the archived toggle (§4, §5.2).
 *
 * Archiving rather than deleting is the rule the repository enforces; this screen surfaces it so
 * an archived client is visibly still there rather than appearing to have vanished.
 */

import { Component, inject, signal, type OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  AlertController,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonList,
  IonNote,
  IonSearchbar,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
  type ViewWillEnter,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, trashOutline } from 'ionicons/icons';

import { MastersRepository, type Client } from '../../../data/repositories/masters.repository';
import { ToastService } from '../../../shared/ui/toast.service';

@Component({
  selector: 'app-client-list',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonSearchbar,
    IonItemSliding,
    IonItemOptions,
    IonItemOption,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    IonToggle,
    IonSpinner,
  ],
  templateUrl: './client-list.page.html',
  styleUrl: './client-list.page.scss',
})
export class ClientListPage implements OnInit, ViewWillEnter {
  private readonly masters = inject(MastersRepository);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertController);
  private readonly toast = inject(ToastService);

  readonly clients = signal<Client[]>([]);
  readonly loading = signal(true);
  readonly search = signal('');
  readonly includeArchived = signal(false);

  constructor() {
    addIcons({ addOutline, trashOutline });
  }

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
      this.clients.set(
        await this.masters.listClients({
          search: this.search(),
          includeArchived: this.includeArchived(),
        }),
      );
    } finally {
      this.loading.set(false);
    }
  }

  async onSearch(value: string | null | undefined): Promise<void> {
    this.search.set(value ?? '');
    await this.reload();
  }

  async onArchivedToggle(value: boolean): Promise<void> {
    this.includeArchived.set(value);
    await this.reload();
  }

  /** Second line of the row: whatever identifying detail exists, in a stable order. */
  subtitle(client: Client): string {
    return [client.company ? client.name : '', client.city, client.phone]
      .filter((part) => part.length > 0)
      .join(' · ');
  }

  open(id: string): void {
    void this.router.navigate(['/client', id]);
  }

  add(): void {
    void this.router.navigate(['/client', 'new']);
  }

  /**
   * Remove a client, or archive them if a document already uses them.
   *
   * §5.2: the repository decides which, because only it knows whether anything references them, so
   * the confirmation explains the rule rather than promising an outcome it cannot know yet.
   */
  async removeClient(client: Client): Promise<void> {
    const alert = await this.alerts.create({
      header: `Remove ${client.company || client.name}?`,
      message:
        'If any document uses them they are archived instead — hidden from the pickers, with those ' +
        'documents left exactly as they are.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => {
            void this.confirmRemove(client);
          },
        },
      ],
    });
    await alert.present();
  }

  private async confirmRemove(client: Client): Promise<void> {
    try {
      const outcome = await this.masters.deleteOrArchiveClient(client.id);
      await this.reload();
      this.toast.success(
        outcome === 'archived' ? 'Archived — their documents are untouched.' : 'Removed.',
      );
    } catch (cause) {
      this.toast.error(cause);
    }
  }
}
