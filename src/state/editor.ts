/**
 * The active-document editor store — spec §3 (Zustand for the editor, SQLite as the source
 * of truth for anything persisted) and §6.2/§6.3.
 *
 * Three requirements shape the design:
 *
 *  - **Totals update within 100 ms of a keystroke** (§6.3). So every mutation recomputes
 *    the document synchronously through the pure `calc` module and stores the result in
 *    state. No await, no database round trip on the render path.
 *  - **Autosave debounced at 400 ms** (§6.3, §11). Writes are coalesced so holding a key
 *    does not produce a write per character.
 *  - **Autosave must survive the app being killed mid-edit** (§6.3). The debounce is
 *    therefore paired with `flush()`, called when the editor loses focus or the app goes to
 *    the background, so at most the last 400 ms of typing can ever be lost — and in
 *    practice nothing is, because backgrounding flushes first.
 */

import type * as SQLite from 'expo-sqlite';
import { create } from 'zustand';

import { calculateDocument, type CalcResult } from '../core/calc';
import { uuid } from '../core/ids';
import { amountInWords } from '../core/numberToWordsIndian';
import type { DocumentBlocks, Paise, PriceSource } from '../core/types';
import {
  emptyLineItem,
  getDocument,
  lineFromCatalogueItem,
  recordCatalogueUsage,
  saveDocument,
  type DocumentRecord,
  type FullDocument,
  type LineItem,
  type Payment,
} from '../db/documents';
import type { CatalogueItem } from '../db/masters';

/** §6.3 and §11 both name 400 ms. */
export const AUTOSAVE_DEBOUNCE_MS = 400;

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface EditorState {
  documentId: string | null;
  document: DocumentRecord | null;
  lines: LineItem[];
  payments: Payment[];
  calc: CalcResult | null;
  saveState: SaveState;
  saveError: string | null;
  /** Set when the app is loading a different document. */
  loading: boolean;

  load: (db: SQLite.SQLiteDatabase, id: string) => Promise<void>;
  /**
   * Re-read the document from the database, discarding the in-memory copy.
   *
   * `load` short-circuits when the same document is already open, which is what keeps
   * navigation cheap. Anything that changes a document *outside* the store — a status
   * transition, a manual number override, allocating a number on export — has to come
   * through here instead, or the screen would keep showing the stale copy.
   */
  reload: (db: SQLite.SQLiteDatabase, id: string) => Promise<void>;
  reset: () => void;

  patchDocument: (patch: Partial<DocumentRecord>) => void;
  setBlocks: (blocks: DocumentBlocks) => void;

  addCustomLine: (taxRateBp?: number) => void;
  addCatalogueLines: (items: readonly CatalogueItem[]) => void;
  patchLine: (lineId: string, patch: Partial<LineItem>) => void;
  removeLine: (lineId: string) => LineItem | null;
  restoreLine: (line: LineItem, position: number) => void;
  moveLine: (from: number, to: number) => void;

  /** Write now, cancelling any pending debounce. */
  flush: () => Promise<void>;
}

/**
 * Module-level save plumbing.
 *
 * Kept outside the store because a timer and a database handle are not state anyone
 * renders, and putting them in the store would make every debounce tick a re-render.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let database: SQLite.SQLiteDatabase | null = null;
let savingPromise: Promise<void> | null = null;

function computeCalc(document: DocumentRecord, lines: readonly LineItem[]): CalcResult {
  return calculateDocument({
    lines: lines.map((line) => ({
      qtyMilli: line.qtyMilli,
      rate: line.rate,
      taxRateBp: line.taxRateBp,
      discountBp: line.discountBp,
      isFree: line.isFree,
      hsnSac: line.hsnSac,
    })),
    discountMode: document.discountMode,
    discountValue: document.discountValue,
    taxMode: document.taxMode,
    flatTaxRateBp: document.flatTaxRateBp,
    shippingAmount: document.shippingAmount,
    roundOffEnabled: document.roundOffEnabled,
  });
}

export const useEditorStore = create<EditorState>((set, get) => {
  /** Recompute totals and mark dirty, then schedule a debounced write. */
  function commit(next: { document: DocumentRecord; lines: LineItem[] }): void {
    const calc = computeCalc(next.document, next.lines);
    const document: DocumentRecord = {
      ...next.document,
      subtotal: calc.subtotal,
      discountTotal: calc.discountTotal,
      taxTotal: calc.taxTotal,
      grandTotal: calc.grandTotal,
      roundOff: calc.roundOff,
      amountInWords: amountInWords(calc.grandTotal),
    };
    const lines = next.lines.map((line, index) => ({
      ...line,
      position: index,
      lineTotal: calc.lines[index]?.lineTotal ?? 0,
    }));

    set({ document, lines, calc, saveState: 'dirty', saveError: null });
    schedule();
  }

  function schedule(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persist();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function persist(): Promise<void> {
    const { document, lines } = get();
    if (!database || !document) return;

    // Serialise writes: a flush arriving while a save is in flight must queue behind it
    // rather than interleave two transactions on the same document.
    if (savingPromise) {
      await savingPromise;
    }

    set({ saveState: 'saving' });
    const work = (async () => {
      try {
        const saved = await saveDocument(database as SQLite.SQLiteDatabase, { document, lines });
        // Only adopt the result if the user has not edited again in the meantime, and only
        // if the same document is still open.
        const current = get();
        if (current.documentId === saved.document.id && current.saveState === 'saving') {
          set({ document: saved.document, lines: saved.lines, saveState: 'saved' });
        }
      } catch (cause) {
        set({
          saveState: 'error',
          saveError: cause instanceof Error ? cause.message : String(cause),
        });
      }
    })();

    savingPromise = work;
    try {
      await work;
    } finally {
      if (savingPromise === work) savingPromise = null;
    }
  }

  return {
    documentId: null,
    document: null,
    lines: [],
    payments: [],
    calc: null,
    saveState: 'idle',
    saveError: null,
    loading: false,

    async load(db, id) {
      database = db;

      // Never abandon unsaved edits to a different document when switching.
      const previous = get();
      if (previous.documentId && previous.documentId !== id && previous.saveState === 'dirty') {
        await get().flush();
      }

      if (previous.documentId === id && previous.document) return;

      set({ loading: true });
      const loaded: FullDocument | null = await getDocument(db, id);
      if (!loaded) {
        set({ loading: false, documentId: null, document: null, lines: [], calc: null });
        return;
      }
      set({
        documentId: id,
        document: loaded.document,
        lines: loaded.lines,
        payments: loaded.payments,
        calc: computeCalc(loaded.document, loaded.lines),
        saveState: 'idle',
        saveError: null,
        loading: false,
      });
    },

    async reload(db, id) {
      set({ documentId: null });
      await get().load(db, id);
    },

    reset() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      set({
        documentId: null,
        document: null,
        lines: [],
        payments: [],
        calc: null,
        saveState: 'idle',
        saveError: null,
        loading: false,
      });
    },

    patchDocument(patch) {
      const { document, lines } = get();
      if (!document) return;
      commit({ document: { ...document, ...patch }, lines });
    },

    setBlocks(blocks) {
      const { document, lines } = get();
      if (!document) return;
      commit({ document: { ...document, blocks }, lines });
    },

    addCustomLine(taxRateBp) {
      const { document, lines } = get();
      if (!document) return;
      // Inherit the rate from the last line so a document of same-rate items needs no
      // repeated fiddling with the tax field.
      const inherited = taxRateBp ?? lines[lines.length - 1]?.taxRateBp ?? 0;
      const line = emptyLineItem(document.id, lines.length, inherited);
      commit({ document, lines: [...lines, line] });
    },

    addCatalogueLines(items) {
      const { document, lines } = get();
      if (!document || items.length === 0) return;
      const added = items.map((item, offset) =>
        lineFromCatalogueItem(document.id, lines.length + offset, item),
      );
      commit({ document, lines: [...lines, ...added] });

      // §5.3: bump the usage counter that drives the picker's secondary sort. Fire and
      // forget — a failed counter update must not interrupt editing.
      if (database) void recordCatalogueUsage(database, added);
    },

    patchLine(lineId, patch) {
      const { document, lines } = get();
      if (!document) return;

      const next = lines.map((line) => {
        if (line.id !== lineId) return line;
        const updated = { ...line, ...patch };

        // §7.3: editing the rate on an `auto` line flips it to `custom` and earns the
        // "edited" badge. Only the rate does this — changing the quantity is not a price
        // override, and neither is a per-line discount.
        const rateChanged = patch.rate !== undefined && patch.rate !== line.rate;
        if (rateChanged && line.priceSource === 'auto') {
          updated.priceSource = 'custom' satisfies PriceSource;
        }
        return updated;
      });

      commit({ document, lines: next });
    },

    removeLine(lineId) {
      const { document, lines } = get();
      if (!document) return null;
      const removed = lines.find((line) => line.id === lineId) ?? null;
      commit({ document, lines: lines.filter((line) => line.id !== lineId) });
      return removed;
    },

    restoreLine(line, position) {
      const { document, lines } = get();
      if (!document) return;
      const next = [...lines];
      next.splice(Math.max(0, Math.min(position, next.length)), 0, line);
      commit({ document, lines: next });
    },

    moveLine(from, to) {
      const { document, lines } = get();
      if (!document) return;
      if (from === to || from < 0 || from >= lines.length) return;
      const next = [...lines];
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
      commit({ document, lines: next });
    },

    async flush() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const { saveState } = get();
      if (saveState === 'dirty' || saveState === 'saving' || saveState === 'error') {
        await persist();
      } else if (savingPromise) {
        await savingPromise;
      }
    },
  };
});

/**
 * A fresh line id, for callers that build a line outside the store.
 *
 * Re-exported here so screens do not import from `core/ids` directly and accidentally use
 * it for something that should have a database-generated id.
 */
export function newLineId(): string {
  return uuid();
}

/** The running grand total for the sticky footer (§6.2). */
export function selectGrandTotal(state: EditorState): Paise {
  return state.calc?.grandTotal ?? 0;
}

export function selectIsEmpty(state: EditorState): boolean {
  return state.lines.length === 0;
}
