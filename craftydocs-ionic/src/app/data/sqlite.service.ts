/**
 * The single SQLite connection, and the migration runner that brings it up to date.
 *
 * Replaces `expo-sqlite` with `@capacitor-community/sqlite`. The two differ in one way that
 * matters to the rest of the app: on the web the Capacitor plugin needs `jeep-sqlite`, a custom
 * element backed by IndexedDB, initialised before any query — and it will not persist unless
 * `saveToStore` is called after writes. Both details are handled here so no repository has to
 * know which platform it is on.
 *
 * Everything above this file talks in terms of `query` / `run` / `transaction`, which is why the
 * repositories port between the Expo and Ionic trees almost unchanged.
 */

import { Injectable, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';

import { MIGRATIONS, SCHEMA_VERSION } from './schema';
import { SeedService } from './seed';
import { prepareWebSqlite } from './web-sqlite-setup';

export const DATABASE_NAME = 'craftydocs';

export interface DatabaseStatus {
  ready: boolean;
  schemaVersion: number;
  seeded: boolean;
  error: string | null;
}

@Injectable({ providedIn: 'root' })
export class SqliteService {
  private readonly seedService = inject(SeedService);

  private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
  private connection: SQLiteDBConnection | null = null;

  /**
   * Shared across callers so a race between two screens mounting cannot run the migrations
   * twice.
   */
  private opening: Promise<SQLiteDBConnection> | null = null;

  readonly status = signal<DatabaseStatus>({
    ready: false,
    schemaVersion: 0,
    seeded: false,
    error: null,
  });

  /** Open, migrate and seed. Safe to call from anywhere, any number of times. */
  async open(): Promise<SQLiteDBConnection> {
    if (this.connection) return this.connection;
    if (this.opening) return this.opening;

    this.opening = (async () => {
      try {
        if (Capacitor.getPlatform() === 'web') {
          // The jeep-sqlite element must exist and be ready before initWebStore is called;
          // otherwise that call never settles. See web-sqlite-setup.ts.
          await prepareWebSqlite();
          await this.sqlite.initWebStore();
        }

        const connection = await this.sqlite.createConnection(
          DATABASE_NAME,
          false,
          'no-encryption',
          SCHEMA_VERSION,
          false,
        );
        await connection.open();

        await connection.execute('PRAGMA foreign_keys = ON;');
        const schemaVersion = await this.migrate(connection);

        this.connection = connection;
        const seeded = await this.seedService.run(this);

        this.status.set({ ready: true, schemaVersion, seeded, error: null });
        return connection;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        this.status.set({ ready: false, schemaVersion: 0, seeded: false, error: message });
        this.opening = null;
        throw cause;
      }
    })();

    return this.opening;
  }

  /**
   * Apply any migration newer than the stored `user_version`.
   *
   * Each migration and its version bump go in one transaction, so a process killed mid-migration
   * either has the whole step or none of it (§11: "app kill must never corrupt a document").
   */
  private async migrate(connection: SQLiteDBConnection): Promise<number> {
    const current = await this.readUserVersion(connection);

    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      await connection.beginTransaction();
      try {
        await connection.execute(migration.up);
        // PRAGMA takes no bound parameters; the value is a checked integer from our own table.
        await connection.execute(`PRAGMA user_version = ${Math.trunc(migration.version)};`);
        await connection.commitTransaction();
      } catch (cause) {
        await connection.rollbackTransaction();
        throw new Error(
          `Migration ${migration.version} (${migration.name}) failed: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }
    }

    return this.readUserVersion(connection);
  }

  private async readUserVersion(connection: SQLiteDBConnection): Promise<number> {
    const result = await connection.query('PRAGMA user_version;');
    const row = result.values?.[0] as Record<string, unknown> | undefined;
    const value = row ? Object.values(row)[0] : 0;
    return typeof value === 'number' ? value : Number(value ?? 0);
  }

  /** Read rows. Returns an empty array rather than undefined, so callers need no guard. */
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const connection = await this.open();
    const result = await connection.query(sql, params as never[]);
    return (result.values ?? []) as T[];
  }

  /** Read a single row, or null. */
  async first<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  /**
   * Execute a write.
   *
   * On the web the IndexedDB-backed store only persists when explicitly saved, so every write
   * flushes. Skipping that is the classic jeep-sqlite bug: everything works until the page is
   * reloaded and the data is gone.
   */
  async run(sql: string, params: unknown[] = []): Promise<void> {
    const connection = await this.open();
    await connection.run(sql, params as never[], false);
    await this.persist();
  }

  /**
   * Run several statements as one unit.
   *
   * The callback receives a `run` that does *not* flush to the web store — flushing once at the
   * end of the transaction is both correct and much faster than per-statement.
   */
  async transaction(work: (run: (sql: string, params?: unknown[]) => Promise<void>) => Promise<void>): Promise<void> {
    const connection = await this.open();
    await connection.beginTransaction();
    try {
      await work(async (sql, params = []) => {
        await connection.run(sql, params as never[], false);
      });
      await connection.commitTransaction();
      await this.persist();
    } catch (cause) {
      await connection.rollbackTransaction();
      throw cause;
    }
  }

  /** Flush the web store. A no-op on Android, where writes hit the file directly. */
  private async persist(): Promise<void> {
    if (Capacitor.getPlatform() !== 'web') return;
    await this.sqlite.saveToStore(DATABASE_NAME);
  }

  /**
   * Close and forget the connection.
   *
   * Needed by restore-from-backup, which replaces the contents underneath us.
   */
  async close(): Promise<void> {
    if (!this.connection) return;
    await this.sqlite.closeConnection(DATABASE_NAME, false);
    this.connection = null;
    this.opening = null;
    this.status.set({ ready: false, schemaVersion: 0, seeded: false, error: null });
  }

  /** Delete every row while keeping the schema. Used by restore before importing. */
  async clearAllData(): Promise<void> {
    await this.transaction(async (run) => {
      // Children first: explicit about intent even though the cascades would cope.
      for (const table of [
        'line_items',
        'payments',
        'documents',
        'clients',
        'catalogue_items',
        'terms_blocks',
        'tax_presets',
        'custom_field_defs',
        'numbering_series',
        'settings',
      ]) {
        await run(`DELETE FROM ${table};`);
      }
      await run('DELETE FROM business_profile WHERE id = 1;');
    });
  }
}
