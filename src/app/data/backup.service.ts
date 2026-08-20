/**
 * Whole-database backup and restore (§13).
 *
 * ## Why a JSON dump and not the .db file
 *
 * Copying `craftydocs.db` out would be simpler, but it is not portable: the browser build keeps its
 * database inside IndexedDB via sql.js, and the Android build keeps a real file. A backup taken on
 * one would not restore on the other, and the owner has no way to know which they are holding. A
 * JSON dump is the same on both, is inspectable in a text editor if anything ever goes wrong, and
 * survives a schema change because it is restored column by column rather than byte for byte.
 *
 * ## Why the schema version is in the file
 *
 * Migrations are append-only (§16.4), so a backup from an older schema can be restored into a newer
 * app — the missing columns take their defaults. The reverse cannot work: a backup written by a
 * newer app may contain columns this build has never heard of. The version lets restore refuse that
 * case with an explanation instead of silently dropping data.
 */

import { inject, Injectable } from '@angular/core';

import { nowIsoWithOffset } from '../core/dates';
import { SCHEMA_VERSION } from './schema';
import { SqliteService } from './sqlite.service';

/**
 * Tables in dependency order: parents before children.
 *
 * Restore inserts in this order and clears in reverse, so a foreign key never points at a row that
 * is not there yet. `business_profile` is a single fixed row rather than a list.
 */
const TABLES = [
  'business_profile',
  'clients',
  'catalogue_items',
  'numbering_series',
  'terms_blocks',
  'tax_presets',
  'custom_field_defs',
  'settings',
  'documents',
  'line_items',
  'payments',
] as const;

type TableName = (typeof TABLES)[number];

export interface BackupFile {
  /** Identifies the file as ours before anything is trusted. */
  format: 'craftydocs.backup';
  formatVersion: 1;
  schemaVersion: number;
  createdAt: string;
  appVersion: string;
  tables: Partial<Record<TableName, Array<Record<string, unknown>>>>;
}

export interface RestoreSummary {
  rowsByTable: Record<string, number>;
  totalRows: number;
}

@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly db = inject(SqliteService);

  /** Read every table into a plain object. */
  async createBackup(appVersion = '1.0.0'): Promise<BackupFile> {
    const tables: BackupFile['tables'] = {};
    for (const table of TABLES) {
      tables[table] = await this.db.query<Record<string, unknown>>(`SELECT * FROM ${table};`);
    }
    return {
      format: 'craftydocs.backup',
      formatVersion: 1,
      schemaVersion: SCHEMA_VERSION,
      createdAt: nowIsoWithOffset(),
      appVersion,
      tables,
    };
  }

  /** A stable filename: sortable, and obvious what it is a year later. */
  backupFilename(now = nowIsoWithOffset()): string {
    const stamp = now.slice(0, 19).replace(/[:T]/g, '-');
    return `craftydocs-backup-${stamp}.json`;
  }

  /**
   * Validate a parsed file without touching the database.
   *
   * Separate from `restore` so the UI can describe what is about to happen — how many documents,
   * how many clients — *before* the owner agrees to wipe what they have. Restore is the one
   * destructive operation in the app; it should not be the first place a bad file is discovered.
   */
  inspect(parsed: unknown): { file: BackupFile; counts: Record<string, number> } {
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('That file is not a CraftyDocs backup.');
    }
    const candidate = parsed as Partial<BackupFile>;
    if (candidate.format !== 'craftydocs.backup') {
      throw new Error('That file is not a CraftyDocs backup.');
    }
    if (candidate.formatVersion !== 1) {
      throw new Error(`This build understands backup format 1, and that file is format ${String(candidate.formatVersion)}.`);
    }
    if (typeof candidate.schemaVersion !== 'number') {
      throw new Error('That backup does not say which schema it came from, so it cannot be trusted.');
    }
    if (candidate.schemaVersion > SCHEMA_VERSION) {
      throw new Error(
        `That backup came from a newer version of the app (database v${candidate.schemaVersion}, this build is v${SCHEMA_VERSION}). Update the app first — restoring it here would drop whatever is new.`,
      );
    }
    if (typeof candidate.tables !== 'object' || candidate.tables === null) {
      throw new Error('That backup has no data in it.');
    }

    const counts: Record<string, number> = {};
    for (const table of TABLES) {
      const rows = candidate.tables[table];
      if (rows !== undefined && !Array.isArray(rows)) {
        throw new Error(`The ${table} section of that backup is malformed.`);
      }
      counts[table] = rows?.length ?? 0;
    }
    return { file: candidate as BackupFile, counts };
  }

  /**
   * Replace everything with the contents of a backup.
   *
   * The whole restore runs in one transaction, so a file that turns out to be broken half way
   * through leaves the existing data untouched rather than merging two databases into something
   * that is neither.
   *
   * Columns are taken from each row's own keys and filtered against the live table, so a backup
   * from an older schema restores cleanly (new columns take their defaults) and an unexpected key
   * cannot inject itself into the statement.
   */
  async restore(file: BackupFile): Promise<RestoreSummary> {
    const columnsByTable = new Map<TableName, Set<string>>();
    for (const table of TABLES) {
      columnsByTable.set(table, await this.columnsOf(table));
    }

    const rowsByTable: Record<string, number> = {};
    let totalRows = 0;

    await this.db.transaction(async (run) => {
      // Children first, so nothing is deleted out from under a foreign key.
      for (const table of [...TABLES].reverse()) {
        await run(`DELETE FROM ${table};`);
      }

      for (const table of TABLES) {
        const rows = file.tables[table] ?? [];
        const known = columnsByTable.get(table) ?? new Set<string>();
        let written = 0;

        for (const row of rows) {
          const columns = Object.keys(row).filter((column) => known.has(column));
          if (columns.length === 0) continue;
          const placeholders = columns.map(() => '?').join(', ');
          await run(
            `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders});`,
            columns.map((column) => this.toSqlValue(row[column])),
          );
          written++;
        }
        rowsByTable[table] = written;
        totalRows += written;
      }
    });

    return { rowsByTable, totalRows };
  }

  /** The columns this build actually has, straight from SQLite. */
  private async columnsOf(table: TableName): Promise<Set<string>> {
    const rows = await this.db.query<{ name: string }>(`PRAGMA table_info(${table});`);
    return new Set(rows.map((row) => row.name));
  }

  /**
   * Coerce a JSON value to something SQLite will accept.
   *
   * JSON has no integer/boolean distinction that matches SQLite's, and a nested object would arrive
   * as `[object Object]` if passed straight through — the JSON columns (`blocks`, `custom_fields`,
   * the snapshots) are stored as text, so they are re-serialised rather than stringified by accident.
   */
  private toSqlValue(value: unknown): string | number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' || typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return JSON.stringify(value);
  }
}
