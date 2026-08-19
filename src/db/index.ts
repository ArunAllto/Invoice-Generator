/**
 * Database connection lifecycle.
 *
 * One connection for the whole app, opened lazily and shared. `expo-sqlite`'s async API
 * serialises statements on a background thread, so a single connection is both correct
 * and the fastest option here — and it means the WAL mode and `foreign_keys` pragma set
 * during migration apply to every query the app makes, rather than to one connection out
 * of several.
 */

import * as SQLite from 'expo-sqlite';

import { migrate } from './schema';
import { seedDatabase } from './seed';

export const DATABASE_NAME = 'craftydocs.db';

let connection: SQLite.SQLiteDatabase | null = null;
let openPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export interface InitResult {
  schemaVersion: number;
  seeded: boolean;
}

let initResult: InitResult | null = null;

/**
 * Open, migrate and seed. Safe to call from several screens at once — the in-flight
 * promise is shared, so a race between the dashboard and the editor mounting cannot run
 * the migrations twice.
 */
export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (connection) return connection;
  if (openPromise) return openPromise;

  openPromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    const schemaVersion = await migrate(db);
    const seeded = await seedDatabase(db);
    connection = db;
    initResult = { schemaVersion, seeded };
    return db;
  })();

  try {
    return await openPromise;
  } catch (error) {
    // Let a later attempt retry rather than caching a rejected promise for ever.
    openPromise = null;
    throw error;
  }
}

export function getInitResult(): InitResult | null {
  return initResult;
}

/** The open connection, or `null` if `openDatabase` has not completed yet. */
export function getDatabaseIfOpen(): SQLite.SQLiteDatabase | null {
  return connection;
}

/**
 * Close and forget the connection.
 *
 * Needed by restore-from-backup, which replaces the file underneath us: continuing to
 * use a handle to a file that has been overwritten is how you get a corrupt database.
 */
export async function closeDatabase(): Promise<void> {
  const db = connection;
  connection = null;
  openPromise = null;
  initResult = null;
  if (db) await db.closeAsync();
}

/** Delete every row while keeping the schema. Used by restore before importing. */
export async function clearAllData(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    // Order matters even with CASCADE: children first keeps the intent obvious.
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
      await db.runAsync(`DELETE FROM ${table};`);
    }
    await db.runAsync('DELETE FROM business_profile WHERE id = 1;');
  });
}
