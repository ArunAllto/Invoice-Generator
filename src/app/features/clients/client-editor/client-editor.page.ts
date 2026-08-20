import { Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonList,
  IonNote,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular';

import { validateGstin } from '../../../core/gst';
import { MastersRepository, type Client } from '../../../data/repositories/masters.repository';
import { ToastService } from '../../../shared/ui/toast.service';

/**
 * Client add / edit (§5.2).
 *
 * One screen serves both: the route param is either the literal `new` or an existing id. That keeps
 * the add and edit flows from drifting apart, which matters because the fields carry rules — the
 * state field feeds the CGST/SGST-versus-IGST decision of §9.4 — and two copies of a form is two
 * places for a rule to be forgotten.
 *
 * Deleting is delegated to the repository, which archives instead of deleting when documents
 * reference the client. The confirmation text therefore cannot promise either outcome up front, so
 * it explains the rule rather than the result.
 */
@Component({
  selector: 'app-client-editor',
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
    IonItem,
    IonInput,
    IonTextarea,
    IonToggle,
    IonNote,
    IonSpinner,
  ],
  templateUrl: './client-editor.page.html',
  styleUrl: './client-editor.page.scss',
})
export class ClientEditorPage implements OnInit {
  private readonly masters = inject(MastersRepository);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly alerts = inject(AlertController);

  /** Bound by `withComponentInputBinding`. The literal `new` means create. */
  readonly id = input.required<string>();

  readonly client = signal<Client | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly isNew = signal(true);
  readonly nameTouched = signal(false);

  readonly title = computed(() => (this.isNew() ? 'New client' : 'Edit client'));

  /** A client needs at least one of person or company: the document has to be addressed to someone. */
  readonly identityMissing = computed(() => {
    const client = this.client();
    if (!client) return true;
    return client.name.trim().length === 0 && client.company.trim().length === 0;
  });

  readonly gstinWarning = computed(() => {
    const gstin = this.client()?.gstin;
    if (!gstin || gstin.trim().length === 0) return null;
    switch (validateGstin(gstin)) {
      case 'format':
        return 'That is not 15 characters in the GSTIN pattern. You can still save it.';
      case 'checksum':
        return 'The check character does not match. You can still save it.';
      case 'unknown_state':
        return 'That state code is not one we recognise. You can still save it.';
      default:
        return null;
    }
  });

  async ngOnInit(): Promise<void> {
    const id = this.id();
    if (id === 'new') {
      this.client.set(this.masters.emptyClient());
      this.isNew.set(true);
    } else {
      const existing = await this.masters.getClient(id);
      if (existing) {
        this.client.set(existing);
        this.isNew.set(false);
      } else {
        // A stale id is not worth a dialog: fall back to a blank client so the screen still works,
        // and say what happened.
        this.client.set(this.masters.emptyClient());
        this.isNew.set(true);
        this.toast.show('That client no longer exists. Starting a new one.');
      }
    }
    this.loading.set(false);
  }

  patch<K extends keyof Client>(key: K, value: Client[K]): void {
    const current = this.client();
    if (!current) return;
    this.client.set({ ...current, [key]: value });
  }

  /** GSTIN stores null when blank, so "not registered" is distinct from "not typed yet". */
  patchGstin(value: string): void {
    const trimmed = value.trim().toUpperCase();
    this.patch('gstin', trimmed.length > 0 ? trimmed : null);
  }

  async save(): Promise<void> {
    this.nameTouched.set(true);
    const client = this.client();
    if (!client || this.identityMissing()) {
      this.toast.show('Give the client a name or a company.');
      return;
    }
    this.saving.set(true);
    try {
      await this.masters.saveClient(client);
      // Cleared before navigating, not in a `finally` after it. An Ionic page transition waits on
      // its own animation, and animations are driven by `requestAnimationFrame`, which the browser
      // pauses while the app is not visible — so a `finally` placed after the navigation never runs
      // if the owner backgrounds the app at the moment they hit Save, and the button stays disabled
      // for good. The write has already committed by this line, so nothing is lost by saying so now.
      this.saving.set(false);
      this.toast.show('Saved.');
      await this.router.navigateByUrl('/tabs/clients');
    } catch (cause) {
      this.saving.set(false);
      this.toast.error(cause);
    }
  }

  async remove(): Promise<void> {
    const client = this.client();
    if (!client || this.isNew()) return;

    const alert = await this.alerts.create({
      header: 'Remove this client?',
      message:
        'If any document uses them they are archived instead, which hides them from the pickers ' +
        'but leaves those documents untouched.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => {
            void this.confirmRemove(client.id);
          },
        },
      ],
    });
    await alert.present();
  }

  private async confirmRemove(id: string): Promise<void> {
    try {
      const outcome = await this.masters.deleteOrArchiveClient(id);
      this.toast.show(
        outcome === 'archived' ? 'Archived — their documents are untouched.' : 'Removed.',
      );
      await this.router.navigateByUrl('/tabs/clients');
    } catch (cause) {
      this.toast.error(cause);
    }
  }
}
