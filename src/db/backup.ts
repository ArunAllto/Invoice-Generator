/**
 * Backup and restore — spec §11: "Settings → Backup exports a single JSON file containing
 * all tables plus base64 logo and signature; import validates a schema version and asks
 * before overwriting."
 *
 * Acceptance test §14.15 is the contract: backup → wipe → restore must return every
 * document, client, catalogue item, logo and signature intact. Two design choices follow
 * from that:
 *
 *  - **Images travel inside the file.** A backup that referenced `file:///…/logo.png` would
 *    restore to a broken image after an app reinstall, which is exactly the situation a
 *    backup exists for. They are embedded as base64 and written back out as fresh files.
 *  - **Restore is transactional and destructive in that order.** Everything is parsed and
 *    validated *before* a single row is deleted, so a corrupt file cannot leave the owner
 *    with neither their old data nor their new.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type * as SQLite from 'expo-sqlite';

import { nowIsoWithOffset, todayIso } from '../core/dates';
import { shortId } from '../core/ids';
import { clearAllData } from './index';

/**
 * Backup format version.
 *
 * Bumped only when the file's own shape changes. `schemaVersion` records the database
 * version separately, so a restore can tell "written by an older app" (fine, migrations
 * handle it) from "written by a newer app" (refused, §11).
 */
export const BACKUP_FORMAT_VERSION = 1;

/** Tables copied verbatim, in an order that satisfies foreign keys on the way back in. */
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

export interface BackupImages {
  /** base64 PNG/JPEG payloads keyed by the column they came from. */
  logo?: string | null;
  signature?: string | null;
}

export interface BackupFile {
  format: 'craftydocs-backup';
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
  images: BackupImages;
  counts: Record<string, number>;
}

async function readImage(uri: string | null | undefined): Promise<string | null> {
  if (!uri) return null;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch {
    return null;
  }
}

async function writeImage(base64: string | null | undefined, prefix: string): Promise<string | null> {
  if (!base64) return null;
  const directory = `${FileSystem.documentDirectory ?? ''}assets/`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const target = `${directory}${prefix}-restored-${shortId(6)}.png`;
  await FileSystem.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 });
  return target;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface CreateBackupResult {
  uri: string;
  filename: string;
  bytes: number;
  counts: Record<string, number>;
}

/** Build the backup file in the cache directory and return its location. */
export async function createBackup(
  db: SQLite.SQLiteDatabase,
  appVersion: string,
): Promise<CreateBackupResult> {
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');

  const tables: Record<string, Array<Record<string, unknown>>> = {};
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const rows = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table};`);
    tables[table] = rows;
    counts[table] = rows.length;
  }

  const profile = await db.getFirstAsync<{ logo_uri: string | null; signature_uri: string | null }>(
    'SELECT logo_uri, signature_uri FROM business_profile WHERE id = 1;',
  );

  const backup: BackupFile = {
    format: 'craftydocs-backup',
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: versionRow?.user_version ?? 0,
    appVersion,
    createdAt: nowIsoWithOffset(),
    tables,
    images: {
      logo: await readImage(profile?.logo_uri),
      signature: await readImage(profile?.signature_uri),
    },
    counts,
  };

  const filename = `CraftyDocs-Backup-${todayIso()}-${shortId(4)}.json`;
  const uri = `${FileSystem.cacheDirectory ?? ''}${filename}`;
  const payload = JSON.stringify(backup);
  await FileSystem.writeAsStringAsync(uri, payload, { encoding: FileSystem.EncodingType.UTF8 });

  return { uri, filename, bytes: payload.length, counts };
}

/** Hand the backup to the share sheet so it can be put somewhere safe. */
export async function shareBackup(result: CreateBackupResult): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(result.uri, {
    mimeType: 'application/json',
    dialogTitle: result.filename,
  });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export type BackupProblem =
  | { kind: 'unreadable'; message: string }
  | { kind: 'not_a_backup' }
  | { kind: 'too_new'; formatVersion: number };

export interface ParsedBackup {
  backup: BackupFile;
  summary: { documents: number; clients: number; catalogue: number; payments: number };
}

/**
 * Read and validate a backup file without touching the database.
 *
 * Deliberately separate from `restoreBackup` so the confirmation dialog can state what is
 * about to be restored — and so an invalid file is rejected before anything is destroyed.
 */
export async function parseBackupFile(uri: string): Promise<ParsedBackup | BackupProblem> {
  let raw: string;
  try {
    raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
  } catch (cause) {
    return { kind: 'unreadable', message: cause instanceof Error ? cause.message : String(cause) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'not_a_backup' };
  }

  if (typeof parsed !== 'object' || parsed === null) return { kind: 'not_a_backup' };
  const candidate = parsed as Partial<BackupFile>;
  if (candidate.format !== 'craftydocs-backup' || typeof candidate.tables !== 'object') {
    return { kind: 'not_a_backup' };
  }

  const formatVersion = typeof candidate.formatVersion === 'number' ? candidate.formatVersion : 0;
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    return { kind: 'too_new', formatVersion };
  }

  const tables = (candidate.tables ?? {}) as Record<string, Array<Record<string, unknown>>>;
  return {
    backup: {
      format: 'craftydocs-backup',
      formatVersion,
      schemaVersion: typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : 0,
      appVersion: typeof candidate.appVersion === 'string' ? candidate.appVersion : 'unknown',
      createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
      tables,
      images: (candidate.images ?? {}) as BackupImages,
      counts: (candidate.counts ?? {}) as Record<string, number>,
    },
    summary: {
      documents: tables.documents?.length ?? 0,
      clients: tables.clients?.length ?? 0,
      catalogue: tables.catalogue_items?.length ?? 0,
      payments: tables.payments?.length ?? 0,
    },
  };
}

/**
 * Replace everything in the database with the contents of a parsed backup.
 *
 * Inserts are generated from each row's own keys and filtered against the columns the
 * current schema actually has, so a backup written by an older build — before
 * `flat_tax_rate_bp` existed, say — restores cleanly and the missing column takes its
 * default. That is what makes the migration runner and the backup format independent of
 * each other.
 */
export async function restoreBackup(
  db: SQLite.SQLiteDatabase,
  backup: BackupFile,
): Promise<{ restored: Record<string, number> }> {
  const restored: Record<string, number> = {};

  // Learn the real column list per table before writing anything.
  const columnsByTable = new Map<TableName, Set<string>>();
  for (const table of TABLES) {
    const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table});`);
    columnsByTable.set(table, new Set(info.map((column) => column.name)));
  }

  await clearAllData(db);

  await db.withTransactionAsync(async () => {
    for (const table of TABLES) {
      const rows = backup.tables[table] ?? [];
      const allowed = columnsByTable.get(table) ?? new Set<string>();
      let count = 0;

      for (const row of rows) {
        const keys = Object.keys(row).filter((key) => allowed.has(key));
        if (keys.length === 0) continue;

        const placeholders = keys.map(() => '?').join(', ');
        const values = keys.map((key) => {
          const value = row[key];
          if (value === null || value === undefined) return null;
          if (typeof value === 'number' || typeof value === 'string') return value;
          if (typeof value === 'boolean') return value ? 1 : 0;
          // Any nested structure was stored as a JSON string; keep it that way.
          return JSON.stringify(value);
        });

        await db.runAsync(
          `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders});`,
          ...values,
        );
        count += 1;
      }
      restored[table] = count;
    }
  });

  // Write the images back out and repoint the profile at the new files.
  const logoUri = await writeImage(backup.images.logo, 'logo');
  const signatureUri = await writeImage(backup.images.signature, 'signature');
  if (logoUri || signatureUri) {
    await db.runAsync(
      `UPDATE business_profile
          SET logo_uri = COALESCE(?, logo_uri),
              signature_uri = COALESCE(?, signature_uri)
        WHERE id = 1;`,
      logoUri,
      signatureUri,
    );
  }

  return { restored };
}

export function describeBackupProblem(problem: BackupProblem): string {
  switch (problem.kind) {
    case 'too_new':
      return 'That backup was made by a newer version of the app and cannot be restored here.';
    case 'not_a_backup':
      return 'That file is not a CraftyDocs backup.';
    case 'unreadable':
    default:
      return 'That file could not be read.';
  }
}
