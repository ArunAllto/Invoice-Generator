/**
 * The print preferences every render path has to agree on.
 *
 * ## Why this exists
 *
 * `RenderOptions` has carried `dateStyle` since the renderer was written, and the Defaults screen has
 * been saving `document.dateStyle` since it was built — but nothing joined the two, so the setting
 * was inert and every document printed `dd MMM yyyy` whatever the owner picked. Page size would have
 * gone the same way: three separate callers build a `RenderInput` (the preview, the editor's export,
 * the list's export) and any one of them forgetting a field is a silently wrong document.
 *
 * So the options are loaded in one place and spread in. A new print preference is added here once,
 * and every path gets it.
 *
 * ## Why these are settings and not columns on the document
 *
 * §5.4 snapshots what a document *says* — the parties, the rates, the terms — because those are
 * facts about a transaction and must not change after it is issued. Paper size and date format are
 * not facts about the transaction; they are facts about the printer and the reader. Someone who
 * switches to Letter because they moved country wants their old invoices to reprint on Letter too,
 * not to keep a paper size that no longer fits their tray. No number on the document moves either
 * way, only how many pages it takes.
 */

import { Injectable, inject } from '@angular/core';

import { parsePageGeometry } from '../core/page-size';
import type { DateDisplayStyle } from '../core/dates';
import { MastersRepository, SETTINGS_KEYS } from '../data/repositories/masters.repository';
import type { RenderOptions } from './html';

/** The subset of `RenderOptions` that comes from settings rather than from the document. */
export type RenderPreferences = Pick<RenderOptions, 'page' | 'dateStyle'>;

const DATE_STYLES: readonly DateDisplayStyle[] = [
  'dd MMM yyyy',
  'd MMMM yyyy',
  'dd/MM/yyyy',
  'yyyy-MM-dd',
];

@Injectable({ providedIn: 'root' })
export class RenderSettingsService {
  private readonly masters = inject(MastersRepository);

  /**
   * Load the print preferences.
   *
   * Both fall back rather than throw. This is on the read path for every preview and export, and a
   * document that will not render because a settings row is malformed is far worse than one that
   * renders on A4 with the default date format.
   */
  async load(): Promise<RenderPreferences> {
    const [pageRaw, styleRaw] = await Promise.all([
      this.masters.getSetting(SETTINGS_KEYS.pageGeometry),
      this.masters.getSetting(SETTINGS_KEYS.dateStyle),
    ]);

    return {
      page: parsePageGeometry(pageRaw),
      dateStyle: this.readDateStyle(styleRaw),
    };
  }

  /** Validated against the list rather than cast: a hand-edited row must not reach the renderer. */
  private readDateStyle(raw: string | null): DateDisplayStyle {
    return DATE_STYLES.find((style) => style === raw) ?? 'dd MMM yyyy';
  }
}
