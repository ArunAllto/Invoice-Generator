/**
 * The active-document editor store — spec §6.2 and §6.3.
 *
 * Replaces the Zustand store from the React Native tree with Angular signals. The requirements it
 * exists to satisfy are unchanged:
 *
 *  - **Totals update within 100 ms of a keystroke** (§6.3). Every mutation recomputes synchronously
 *    through the pure `calculateDocument`, so no await and no database round trip sits on the
 *    render path.
 *  - **Autosave debounced at 400 ms** (§6.3, §11), so holding a key does not produce a write per
 *    character.
 *  - **Autosave survives the app being killed mid-edit** (§6.3). The debounce is paired with
 *    `flush()`, called when the editor is left or the app is backgrounded, so at most the last
 *    400 ms of typing can be lost — and in practice nothing is, because leaving flushes first.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import type { CalcResult } from '../../core/calc';
import { amountInWords } from '../../core/number-to-words-indian';
import type { DocumentBlocks, Paise, PriceSource } from '../../core/types';
import {
  DocumentsRepository,
  type DocumentRecord,
  type LineItem,
  type Payment,
} from '../../data/repositories/documents.repository';
import { MastersRepository, type CatalogueItem } from '../../data/repositories/masters.repository';
import { uuid } from '../../core/ids';

/** §6.3 and §11 both name 400 ms. */
export const AUTOSAVE_DEBOUNCE_MS = 400;

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

@Injectable({ providedIn: 'root' })
export class DocumentEditorStore {
  private readonly repository = inject(DocumentsRepository);
  private readonly masters = inject(MastersRepository);

  readonly documentId = signal<string | null>(null);
  readonly document = signal<DocumentRecord | null>(null);
  readonly lines = signal<LineItem[]>([]);
  readonly payments = signal<Payment[]>([]);
  readonly calc = signal<CalcResult | null>(null);
  readonly saveState = signal<SaveState>('idle');
  readonly saveError = signal<string | null>(null);
  readonly loading = signal(false);

  readonly grandTotal = computed<Paise>(() => this.calc()?.grandTotal ?? 0);
  readonly isEmpty = computed(() => this.lines().length === 0);

  /**
   * Debounce timer and in-flight write.
   *
   * Plain fields rather than signals: nothing renders them, and making the debounce tick a signal
   * would re-render the editor on every keystroke for no reason.
   */
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private savingPromise: Promise<void> | null = null;

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  async load(id: string): Promise<void> {
    // Never abandon unsaved edits to a different document when switching.
    if (this.documentId() && this.documentId() !== id && this.saveState() === 'dirty') {
      await this.flush();
    }
    if (this.documentId() === id && this.document()) return;

    this.loading.set(true);
    try {
      const loaded = await this.repository.get(id);
      if (!loaded) {
        this.reset();
        return;
      }
      this.documentId.set(id);
      this.document.set(loaded.document);
      this.lines.set(loaded.lines);
      this.payments.set(loaded.payments);
      this.calc.set(this.repository.calculate(loaded.document, loaded.lines));
      this.saveState.set('idle');
      this.saveError.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Re-read from the database, discarding the in-memory copy.
   *
   * `load` short-circuits when the same document is already open. Anything that changes a document
   * *outside* this store — a status transition, allocating a number on export — must come through
   * here, or the next autosave would write the stale copy back over it. That was a real bug in the
   * React Native tree: exporting allocated a number, then an edit wrote the blank one back.
   */
  async reload(id: string): Promise<void> {
    this.documentId.set(null);
    await this.load(id);
  }

  reset(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.documentId.set(null);
    this.document.set(null);
    this.lines.set([]);
    this.payments.set([]);
    this.calc.set(null);
    this.saveState.set('idle');
    this.saveError.set(null);
    this.loading.set(false);
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  patchDocument(patch: Partial<DocumentRecord>): void {
    const current = this.document();
    if (!current) return;
    this.commit({ ...current, ...patch }, this.lines());
  }

  setBlocks(blocks: DocumentBlocks): void {
    this.patchDocument({ blocks });
  }

  addCustomLine(taxRateBp?: number): void {
    const document = this.document();
    if (!document) return;
    const lines = this.lines();
    // Inherit the tax rate from the previous line, so a document of same-rate items needs no
    // repeated fiddling with the tax field.
    const inherited = taxRateBp ?? lines[lines.length - 1]?.taxRateBp ?? 0;
    this.commit(document, [...lines, emptyLine(document.id, lines.length, inherited)]);
  }

  addCatalogueLines(items: readonly CatalogueItem[]): void {
    const document = this.document();
    if (!document || items.length === 0) return;
    const lines = this.lines();
    const added = items.map((item, offset) => lineFromCatalogue(document.id, lines.length + offset, item));
    this.commit(document, [...lines, ...added]);

    // §5.3: bump the usage counter driving the picker's secondary sort. Fire and forget — a failed
    // counter update must never interrupt editing.
    void this.masters.incrementCatalogueUsage(added.map((line) => line.catalogueItemId ?? '').filter(Boolean));
  }

  patchLine(lineId: string, patch: Partial<LineItem>): void {
    const document = this.document();
    if (!document) return;

    const next = this.lines().map((line) => {
      if (line.id !== lineId) return line;
      const updated = { ...line, ...patch };

      // §7.3: editing the *rate* on an `auto` line flips it to `custom` and earns the "edited"
      // badge. Only the rate does this — changing the quantity is not a price override, and
      // neither is a per-line discount.
      const rateChanged = patch.rate !== undefined && patch.rate !== line.rate;
      if (rateChanged && line.priceSource === 'auto') {
        updated.priceSource = 'custom' satisfies PriceSource;
      }
      return updated;
    });

    this.commit(document, next);
  }

  removeLine(lineId: string): { line: LineItem; position: number } | null {
    const document = this.document();
    if (!document) return null;
    const lines = this.lines();
    const position = lines.findIndex((line) => line.id === lineId);
    if (position < 0) return null;
    const removed = lines[position];
    this.commit(
      document,
      lines.filter((line) => line.id !== lineId),
    );
    return removed ? { line: removed, position } : null;
  }

  restoreLine(line: LineItem, position: number): void {
    const document = this.document();
    if (!document) return;
    const next = [...this.lines()];
    next.splice(Math.max(0, Math.min(position, next.length)), 0, line);
    this.commit(document, next);
  }

  moveLine(from: number, to: number): void {
    const document = this.document();
    if (!document) return;
    const lines = this.lines();
    if (from === to || from < 0 || from >= lines.length) return;
    const next = [...lines];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
    this.commit(document, next);
  }

  // -------------------------------------------------------------------------
  // Recompute + save
  // -------------------------------------------------------------------------

  /** Recompute totals synchronously, mark dirty, and schedule the debounced write. */
  private commit(document: DocumentRecord, lines: readonly LineItem[]): void {
    const calc = this.repository.calculate(document, lines);

    this.document.set({
      ...document,
      subtotal: calc.subtotal,
      discountTotal: calc.discountTotal,
      taxTotal: calc.taxTotal,
      grandTotal: calc.grandTotal,
      roundOff: calc.roundOff,
      amountInWords: amountInWords(calc.grandTotal),
    });
    this.lines.set(
      lines.map((line, index) => ({
        ...line,
        position: index,
        lineTotal: calc.lines[index]?.lineTotal ?? 0,
      })),
    );
    this.calc.set(calc);
    this.saveState.set('dirty');
    this.saveError.set(null);

    this.schedule();
  }

  private schedule(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private async persist(): Promise<void> {
    const document = this.document();
    if (!document) return;

    // Serialise writes: a flush arriving mid-save must queue behind it rather than interleave two
    // transactions on the same document.
    if (this.savingPromise) await this.savingPromise;

    this.saveState.set('saving');
    const work = (async () => {
      try {
        const saved = await this.repository.save({ document: this.document() ?? document, lines: this.lines() });
        // Only adopt the result if the user has not edited again meanwhile, and the same document
        // is still open.
        if (this.documentId() === saved.document.id && this.saveState() === 'saving') {
          this.document.set(saved.document);
          this.lines.set(saved.lines);
          this.saveState.set('saved');
        }
      } catch (cause) {
        this.saveState.set('error');
        this.saveError.set(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    this.savingPromise = work;
    try {
      await work;
    } finally {
      if (this.savingPromise === work) this.savingPromise = null;
    }
  }

  /** Write now, cancelling any pending debounce. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const state = this.saveState();
    if (state === 'dirty' || state === 'saving' || state === 'error') {
      await this.persist();
    } else if (this.savingPromise) {
      await this.savingPromise;
    }
  }
}

function emptyLine(documentId: string, position: number, taxRateBp: number): LineItem {
  return {
    id: uuid(),
    documentId,
    position,
    catalogueItemId: null,
    priceSource: 'custom',
    name: '',
    description: '',
    hsnSac: '',
    qtyMilli: 1000,
    unit: 'nos',
    rate: 0,
    taxRateBp,
    discountBp: 0,
    isFree: false,
    lineTotal: 0,
  };
}

/** Build a line from a catalogue item: everything pre-filled, `price_source = 'auto'` (§7.3). */
function lineFromCatalogue(documentId: string, position: number, item: CatalogueItem): LineItem {
  return {
    id: uuid(),
    documentId,
    position,
    catalogueItemId: item.id,
    priceSource: 'auto',
    name: item.name,
    description: item.description,
    hsnSac: item.hsnSac ?? '',
    qtyMilli: 1000,
    unit: item.unit,
    rate: item.defaultRate,
    taxRateBp: item.taxRateBp,
    discountBp: 0,
    isFree: false,
    lineTotal: item.defaultRate,
  };
}
