import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonRadio,
  IonRadioGroup,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import type { TemplateId } from '../../../core/types';
import { MastersRepository, type BusinessProfile } from '../../../data/repositories/masters.repository';
import { ToastService } from '../../../shared/ui/toast.service';

/** The largest a stored image may be, before base64. */
const MAX_IMAGE_BYTES = 512 * 1024;

interface TemplateOption {
  value: TemplateId;
  label: string;
  description: string;
}

/**
 * Settings → Logo, signature & template (§7.1, §7.2, §10.1).
 *
 * ## Why a file input rather than the camera
 *
 * §7.1 asks for a logo and a signature. `@capacitor/camera` would give a nicer capture flow, but a
 * plain `<input type="file" accept="image/*">` reaches the gallery *and* the camera on Android
 * through the WebView's own picker, needs no extra permission in the manifest, and works in the
 * browser during development. One code path, no native dependency.
 *
 * ## Why data URIs
 *
 * §10.1 requires the exported document to be self-contained: a file that renders identically on a
 * machine that has never seen this app. A path to a file on the phone would not survive being
 * emailed. So the image is stored base64 in the snapshot, which is also why there is a size cap —
 * base64 costs a third on top, and every document carries its own copy (§5.4).
 */
@Component({
  selector: 'app-branding',
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
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonRadioGroup,
    IonRadio,
    IonSpinner,
  ],
  templateUrl: './branding.page.html',
  styleUrl: './branding.page.scss',
})
export class BrandingPage implements OnInit {
  private readonly masters = inject(MastersRepository);
  private readonly alerts = inject(AlertController);
  private readonly toast = inject(ToastService);

  readonly profile = signal<BusinessProfile | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly template = signal<TemplateId>('classic');

  readonly logoUri = computed(() => this.profile()?.logoUri ?? null);
  readonly signatureUri = computed(() => this.profile()?.signatureUri ?? null);

  /**
   * The four templates `render/html.ts` implements, described by what they do to the page.
   *
   * §10.6: switching template changes only the CSS — no number on the document moves — which is
   * why these can be described purely in terms of appearance.
   */
  readonly templates: readonly TemplateOption[] = [
    {
      value: 'classic',
      label: 'Classic',
      description: 'Navy rule above the title, shaded table header, boxed totals. The house style.',
    },
    {
      value: 'bold',
      label: 'Bold',
      description: 'Letterhead and table header filled in your accent colour, white text, banded rows.',
    },
    {
      value: 'compact',
      label: 'Compact',
      description: 'Tighter rows and smaller descriptions — fits more items before a second page.',
    },
    {
      value: 'minimal',
      label: 'Minimal',
      description: 'Hairline rules, no shading, black on white. Cheapest to print.',
    },
  ];

  async ngOnInit(): Promise<void> {
    this.profile.set(await this.masters.getBusinessProfile());
    // The profile already owns `defaultTemplateId`; a settings key alongside it would be a second
    // place for the same fact to live, and the two would eventually disagree.
    this.template.set(this.profile()?.defaultTemplateId ?? 'classic');
    this.loading.set(false);
  }

  /**
   * Read a chosen file into a data URI.
   *
   * Rejects anything that is not an image, and anything over the cap. Both are refused with a
   * sentence saying why rather than silently doing nothing, because a photo straight off a modern
   * phone camera will routinely be several megabytes and the owner has no way to guess the limit.
   */
  async onFile(kind: 'logo' | 'signature', event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear the input either way, so choosing the same file twice still fires a change event.
    input.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.toast.warning('Choose an image file.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.toast.warning(
        `That image is ${Math.round(file.size / 1024)} KB. Keep it under ${MAX_IMAGE_BYTES / 1024} KB — every document carries its own copy.`,
      );
      return;
    }

    try {
      const dataUri = await this.readAsDataUri(file);
      await this.persist(kind, dataUri);
      this.toast.success(kind === 'logo' ? 'Logo updated.' : 'Signature updated.');
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  private readAsDataUri(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('That file could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  async removeImage(kind: 'logo' | 'signature'): Promise<void> {
    const alert = await this.alerts.create({
      header: kind === 'logo' ? 'Remove the logo?' : 'Remove the signature?',
      // §5.4 again: the snapshot means old documents are unaffected, which is worth saying because
      // the opposite would be a reasonable thing to fear.
      message: 'Documents already issued keep the copy they were created with.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => {
            void this.persist(kind, null);
          },
        },
      ],
    });
    await alert.present();
  }

  private async persist(kind: 'logo' | 'signature', dataUri: string | null): Promise<void> {
    const current = this.profile();
    if (!current) return;
    this.saving.set(true);
    try {
      const next: BusinessProfile =
        kind === 'logo' ? { ...current, logoUri: dataUri } : { ...current, signatureUri: dataUri };
      await this.masters.saveBusinessProfile(next);
      this.profile.set(next);
    } catch (cause) {
      this.toast.error(cause);
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * The accent colour copied onto every new document.
   *
   * It was seeded and used — the Bold template is built entirely around it — with no way to change
   * it, so Bold was permanently navy. Offered as a fixed set rather than a colour wheel because
   * these are picked to stay legible with white text on them, which an arbitrary hex is not.
   */
  readonly accents: readonly string[] = [
    '#0F4C81',
    '#0F6F75',
    '#7A2F5F',
    '#1D6B3F',
    '#B3541E',
    '#25292F',
  ];

  currentAccent(): string {
    return this.profile()?.accentColor ?? '#0F4C81';
  }

  async onAccent(accentColor: string): Promise<void> {
    const current = this.profile();
    if (!current) return;
    try {
      const next: BusinessProfile = { ...current, accentColor };
      await this.masters.saveBusinessProfile(next);
      this.profile.set(next);
      this.toast.success('New documents will use this colour.');
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  async onTemplate(value: TemplateId): Promise<void> {
    const current = this.profile();
    if (!current) return;
    this.template.set(value);
    try {
      const next: BusinessProfile = { ...current, defaultTemplateId: value };
      await this.masters.saveBusinessProfile(next);
      this.profile.set(next);
      this.toast.success('New documents will use this template.');
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  /** Rough stored size, so the owner can see what they are carrying on every document. */
  sizeLabel(dataUri: string | null): string {
    if (!dataUri) return '';
    const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
    return `${Math.max(1, Math.round((base64.length * 3) / 4 / 1024))} KB`;
  }
}
