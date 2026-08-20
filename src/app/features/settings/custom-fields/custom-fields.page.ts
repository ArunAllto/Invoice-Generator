import { Component, inject, signal, type OnInit } from '@angular/core';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';

import { uuid } from '../../../core/ids';
import type { CustomFieldScope, CustomFieldType } from '../../../core/types';
import { MastersRepository, type CustomFieldDef } from '../../../data/repositories/masters.repository';
import { ToastService } from '../../../shared/ui/toast.service';

const SCOPES: ReadonlyArray<{ value: CustomFieldScope; label: string; hint: string }> = [
  { value: 'document', label: 'On documents', hint: 'A field you fill in per quotation or invoice, e.g. "PO number".' },
  { value: 'client', label: 'On clients', hint: 'Something you record about a client, e.g. "Account manager".' },
  { value: 'business', label: 'On your business', hint: 'Printed in your own header block, e.g. "MSME registration".' },
];

const TYPES: ReadonlyArray<{ value: CustomFieldType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
];

/**
 * Settings → Extra fields (§7.7).
 *
 * Every business has one thing the standard form does not cover — a PO number, a work-order
 * reference, a vehicle number. Rather than guess at those, the app lets the owner declare them.
 *
 * A field can be recorded without being printed. That distinction matters: an internal note and a
 * line the client must see are different things, and conflating them either leaks private data onto
 * a document or forces the owner to keep it somewhere else entirely.
 */
@Component({
  selector: 'app-custom-fields',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonToggle,
    IonSpinner,
  ],
  templateUrl: './custom-fields.page.html',
  styleUrl: './custom-fields.page.scss',
})
export class CustomFieldsPage implements OnInit {
  private readonly masters = inject(MastersRepository);
  private readonly alerts = inject(AlertController);
  private readonly toast = inject(ToastService);

  readonly defs = signal<CustomFieldDef[]>([]);
  readonly loading = signal(true);
  readonly scopes = SCOPES;
  readonly types = TYPES;

  constructor() {
    addIcons({ addOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      this.defs.set(await this.masters.listCustomFieldDefs());
    } finally {
      this.loading.set(false);
    }
  }

  forScope(scope: CustomFieldScope): CustomFieldDef[] {
    return this.defs().filter((def) => def.appliesTo === scope);
  }

  typeLabel(def: CustomFieldDef): string {
    return TYPES.find((t) => t.value === def.fieldType)?.label ?? def.fieldType;
  }

  /**
   * Add a field.
   *
   * Only the name is asked for. An alert that mixes text and radio inputs hands its handler the
   * selected radio value *instead of* the input map, so the name would have to be scraped back out
   * of the DOM — fragile, and wrong the moment Ionic changes its markup. The type defaults to text,
   * which is what most fields are, and "Type" on the row changes it in one tap.
   */
  async add(scope: CustomFieldScope): Promise<void> {
    const alert = await this.alerts.create({
      header: 'New field',
      inputs: [{ name: 'label', type: 'text', placeholder: 'Field name, e.g. PO number' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Add',
          handler: (values: Record<string, string>) => {
            const label = (values['label'] ?? '').trim();
            void this.save(
              {
                id: uuid(),
                label,
                fieldType: 'text',
                appliesTo: scope,
                // A client field is internal by default; a document or business field exists to be
                // printed. Either way the row's toggle overrides it.
                showOnDocument: scope !== 'client',
                position: this.forScope(scope).length,
              },
              label,
            );
          },
        },
      ],
    });
    await alert.present();
  }

  async changeType(def: CustomFieldDef): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Field type',
      inputs: TYPES.map((type) => ({
        type: 'radio' as const,
        label: type.label,
        value: type.value,
        checked: def.fieldType === type.value,
      })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Choose',
          handler: (fieldType: CustomFieldType) => {
            void this.save({ ...def, fieldType }, def.label);
          },
        },
      ],
    });
    await alert.present();
  }

  async rename(def: CustomFieldDef): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Rename field',
      inputs: [{ name: 'label', type: 'text', value: def.label }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (values: Record<string, string>) => {
            void this.save({ ...def, label: (values['label'] ?? '').trim() }, (values['label'] ?? '').trim());
          },
        },
      ],
    });
    await alert.present();
  }

  private async save(def: CustomFieldDef, label: string): Promise<void> {
    if (label.length === 0) {
      this.toast.warning('A field needs a name.');
      return;
    }
    try {
      await this.masters.saveCustomFieldDef(def);
      await this.reload();
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  async toggleShown(def: CustomFieldDef, showOnDocument: boolean): Promise<void> {
    try {
      await this.masters.saveCustomFieldDef({ ...def, showOnDocument });
      await this.reload();
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  async remove(def: CustomFieldDef): Promise<void> {
    const alert = await this.alerts.create({
      header: `Remove ${def.label}?`,
      // The values are stored on each record as a label/value pair, so removing the definition
      // stops it being offered without erasing what was already entered.
      message: 'Values already entered on existing records stay with those records.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => {
            void this.confirmRemove(def.id);
          },
        },
      ],
    });
    await alert.present();
  }

  private async confirmRemove(id: string): Promise<void> {
    try {
      await this.masters.deleteCustomFieldDef(id);
      await this.reload();
    } catch (cause) {
      this.toast.error(cause);
    }
  }
}
