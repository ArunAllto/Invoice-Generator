/**
 * Clients — list, search and the archived toggle (§4, §5.2).
 *
 * Archiving rather than deleting is the rule the repository enforces; this screen surfaces it so
 * an archived client is visibly still there rather than appearing to have vanished.
 */

import { Component, inject, signal, type OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
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
import { addOutline } from 'ionicons/icons';

import { MastersRepository, type Client } from '../../data/repositories/masters.repository';

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
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    IonToggle,
    IonSpinner,
  ],
  templateUrl: './client-list.page.html',
})
export class ClientListPage implements OnInit, ViewWillEnter {
  private readonly masters = inject(MastersRepository);
  private readonly router = inject(Router);

  readonly clients = signal<Client[]>([]);
  readonly loading = signal(true);
  readonly search = signal('');
  readonly includeArchived = signal(false);

  constructor() {
    addIcons({ addOutline });
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
}
