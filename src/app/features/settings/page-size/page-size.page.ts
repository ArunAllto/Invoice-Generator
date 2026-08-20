import { Component, computed, inject, signal, type OnInit } from '@angular/core';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
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

import {
  contentHeightMm,
  contentWidthMm,
  describePage,
  normalise,
  parsePageGeometry,
  resolvePageGeometry,
  serialisePageGeometry,
  PAGE_SIZE_LABELS,
} from '../../../core/page-size';
import { PAGE_LIMITS, PAGE_PRESETS, type PageGeometry, type PageSizeId } from '../../../core/types';
import { MastersRepository, SETTINGS_KEYS } from '../../../data/repositories/masters.repository';
import { ToastService } from '../../../shared/ui/toast.service';

interface SizeOption {
  value: PageSizeId;
  label: string;
  hint: string;
}

/**
 * Settings → Document size (§10.1).
 *
 * ## Why this is a setting and not a per-document field
 *
 * §5.4 snapshots what a document *says*, because those are facts about a transaction that must not
 * change after it is issued. Paper size is not one of those: it is a fact about the printer and the
 * reader. Someone who switches to Letter wants their old invoices to reprint on Letter too, not to
 * keep a size that no longer fits their tray. No amount on the document changes either way — only
 * how many pages it takes, which the screen says plainly so nobody has to wonder.
 *
 * ## Why the margins are separate from the size
 *
 * Wanting A4 with narrow margins is a question about margins, not about paper. Folding the two
 * together would push that person into "Custom" and make them retype 210 × 297 to get a change they
 * did not ask about.
 */
@Component({
  selector: 'app-page-size',
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
    IonInput,
    IonNote,
    IonRadioGroup,
    IonRadio,
    IonSpinner,
  ],
  templateUrl: './page-size.page.html',
  styleUrl: './page-size.page.scss',
})
export class PageSizePage implements OnInit {
  private readonly masters = inject(MastersRepository);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  readonly saving = signal(false);

  /** The working copy, unnormalised, so a half-typed number is not clamped mid-keystroke. */
  readonly draft = signal<PageGeometry>({ ...PAGE_PRESETS.a4 });

  readonly limits = PAGE_LIMITS;

  readonly sizes: readonly SizeOption[] = [
    { value: 'a4', label: PAGE_SIZE_LABELS.a4, hint: 'The default across India.' },
    { value: 'letter', label: PAGE_SIZE_LABELS.letter, hint: 'North American standard.' },
    { value: 'legal', label: PAGE_SIZE_LABELS.legal, hint: 'Taller than Letter — more rows per page.' },
    { value: 'a5', label: PAGE_SIZE_LABELS.a5, hint: 'Half of A4. Good for short receipts.' },
    { value: 'custom', label: PAGE_SIZE_LABELS.custom, hint: 'Your own width and height, in millimetres.' },
  ];

  /** What will actually be stored — the draft after clamping. */
  readonly resolved = computed(() => resolvePageGeometry(this.draft()));

  readonly summary = computed(() => describePage(this.resolved()));

  readonly contentSize = computed(() => {
    const page = this.resolved();
    return `${contentWidthMm(page)} × ${contentHeightMm(page)} mm of usable space`;
  });

  /**
   * Whether clamping changed what was typed.
   *
   * Shown rather than silently corrected: a field that quietly rewrites your number leaves you
   * unsure whether it took the value at all.
   */
  readonly wasClamped = computed(() => {
    const draft = this.draft();
    if (draft.sizeId !== 'custom') {
      const resolved = this.resolved();
      return draft.marginXMm !== resolved.marginXMm || draft.marginYMm !== resolved.marginYMm;
    }
    const clamped = normalise(draft);
    return (
      Math.abs(clamped.widthMm - draft.widthMm) > 0.05 ||
      Math.abs(clamped.heightMm - draft.heightMm) > 0.05 ||
      Math.abs(clamped.marginXMm - draft.marginXMm) > 0.05 ||
      Math.abs(clamped.marginYMm - draft.marginYMm) > 0.05
    );
  });

  readonly isCustom = computed(() => this.draft().sizeId === 'custom');

  async ngOnInit(): Promise<void> {
    const stored = await this.masters.getSetting(SETTINGS_KEYS.pageGeometry);
    this.draft.set(parsePageGeometry(stored));
    this.loading.set(false);
  }

  /**
   * Switch preset.
   *
   * Choosing a named size takes that size's own margins rather than keeping the current ones: A5's
   * 12mm sides exist because 20mm on a 148mm sheet leaves the items table too narrow, and silently
   * carrying 20mm across would reintroduce exactly that problem.
   */
  onSize(value: PageSizeId): void {
    if (value === 'custom') {
      const current = this.resolved();
      this.draft.set({ ...current, sizeId: 'custom' });
      return;
    }
    this.draft.set({ ...PAGE_PRESETS[value] });
  }

  patchNumber(key: 'widthMm' | 'heightMm' | 'marginXMm' | 'marginYMm', raw: string): void {
    const parsed = Number(raw);
    // A blank or half-typed field keeps the previous value rather than collapsing to zero — the
    // same trap as `Number('')` being 0, which already caused a due-date bug on the Defaults screen.
    if (raw.trim().length === 0 || Number.isNaN(parsed)) return;
    this.draft.set({ ...this.draft(), [key]: parsed });
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      const geometry = this.resolved();
      await this.masters.setSetting(SETTINGS_KEYS.pageGeometry, serialisePageGeometry(geometry));
      this.draft.set(geometry);
      this.saving.set(false);
      this.toast.success('Saved. Previews and exports use this from now on.');
    } catch (cause) {
      this.saving.set(false);
      this.toast.error(cause);
    }
  }

  async resetToA4(): Promise<void> {
    this.draft.set({ ...PAGE_PRESETS.a4 });
    await this.save();
  }
}
