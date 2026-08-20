import { Component, inject, signal, type OnInit } from '@angular/core';
import {
  AlertController,
  IonBackButton,
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
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';

import { uuid } from '../../../core/ids';
import type { DocumentType } from '../../../core/types';
import { MastersRepository, type TermsBlock } from '../../../data/repositories/masters.repository';
import { ToastService } from '../../../shared/ui/toast.service';

const SCOPE_LABELS: Readonly<Record<TermsBlock['docType'], string>> = {
  all: 'All documents',
  quotation: 'Quotations',
  invoice: 'Invoices',
  receipt: 'Receipts',
};

/**
 * Settings → Terms & conditions (§7.5).
 *
 * Saved blocks of terms, one of which can be the default per document type. The default is copied
 * onto each new document, and editing it here does not reach back into documents already written —
 * the same rule as every other master (§5.4), and the one that makes it safe to tidy up your terms
 * without rewriting history.
 */
@Component({
  selector: 'app-terms',
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
    IonItem,
    IonLabel,
    IonBadge,
    IonNote,
    IonSpinner,
  ],
  templateUrl: './terms.page.html',
  styleUrl: './terms.page.scss',
})
export class TermsPage implements OnInit {
  private readonly masters = inject(MastersRepository);
  private readonly alerts = inject(AlertController);
  private readonly toast = inject(ToastService);

  readonly blocks = signal<TermsBlock[]>([]);
  readonly loading = signal(true);
  readonly scopeLabels = SCOPE_LABELS;

  constructor() {
    addIcons({ addOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      this.blocks.set(await this.masters.listTermsBlocks());
    } finally {
      this.loading.set(false);
    }
  }

  /** First line, for the list row — the body can be a dozen numbered clauses. */
  summary(block: TermsBlock): string {
    const firstLine = block.body.split('\n').find((line) => line.trim().length > 0) ?? '';
    return firstLine.length > 70 ? `${firstLine.slice(0, 70)}…` : firstLine;
  }

  async add(): Promise<void> {
    await this.edit(
      {
        id: uuid(),
        title: '',
        body: '',
        docType: 'all',
        isDefault: false,
        position: this.blocks().length,
      },
      'New terms block',
    );
  }

  async edit(block: TermsBlock, header = 'Edit terms'): Promise<void> {
    const alert = await this.alerts.create({
      header,
      inputs: [
        { name: 'title', type: 'text', value: block.title, placeholder: 'Title, e.g. Standard invoice terms' },
        {
          name: 'body',
          type: 'textarea',
          value: block.body,
          placeholder: 'One clause per line',
          attributes: { rows: 8 },
        },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (values: Record<string, string>) => {
            void this.save(block, values);
          },
        },
      ],
    });
    await alert.present();
  }

  private async save(block: TermsBlock, values: Record<string, string>): Promise<void> {
    const title = (values['title'] ?? '').trim();
    const body = (values['body'] ?? '').trim();
    if (body.length === 0) {
      this.toast.warning('Empty terms would print an empty heading. Add some text.');
      return;
    }
    try {
      await this.masters.saveTermsBlock({
        ...block,
        title: title.length > 0 ? title : 'Terms',
        body,
      });
      await this.reload();
      this.toast.success('Saved.');
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  /**
   * Choose which document types this block covers, and whether it is their default.
   *
   * Separate from editing the text, because the two are different decisions: the wording changes
   * often, the scope almost never.
   */
  async changeScope(block: TermsBlock): Promise<void> {
    const scopes: Array<TermsBlock['docType']> = ['all', 'quotation', 'invoice', 'receipt'];
    const alert = await this.alerts.create({
      header: 'Applies to',
      inputs: scopes.map((scope) => ({
        type: 'radio' as const,
        label: SCOPE_LABELS[scope],
        value: scope,
        checked: block.docType === scope,
      })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Choose',
          handler: (docType: TermsBlock['docType']) => {
            void this.applyScope(block, docType);
          },
        },
      ],
    });
    await alert.present();
  }

  private async applyScope(block: TermsBlock, docType: TermsBlock['docType']): Promise<void> {
    try {
      await this.masters.saveTermsBlock({ ...block, docType });
      await this.reload();
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  /** Make this the block copied onto new documents of its type. */
  async makeDefault(block: TermsBlock): Promise<void> {
    try {
      await this.masters.saveTermsBlock({ ...block, isDefault: true });
      await this.reload();
      this.toast.success('New documents will start with these terms.');
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  async remove(block: TermsBlock): Promise<void> {
    const alert = await this.alerts.create({
      header: `Remove ${block.title}?`,
      message: 'Documents already carrying these terms keep them — the text is copied onto each one.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => {
            void this.confirmRemove(block.id);
          },
        },
      ],
    });
    await alert.present();
  }

  private async confirmRemove(id: string): Promise<void> {
    try {
      await this.masters.deleteTermsBlock(id);
      await this.reload();
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  /** Kept so the template can name a type without importing the union. */
  readonly docTypes: readonly DocumentType[] = ['quotation', 'invoice', 'receipt'];
}
