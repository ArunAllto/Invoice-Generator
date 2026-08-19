/**
 * Database schema and the versioned migration runner — spec §5, §11 ("DB migrations:
 * versioned migration runner from day one, even for v1") and §16.4 ("every schema change
 * goes through the migration runner, never a hand-edit of the create statements").
 *
 * The rule this file exists to enforce: `MIGRATIONS` is append-only. To change the
 * schema you add an entry; you never edit an existing one, because a released build has
 * already run it on a real device holding the owner's only copy of their invoices.
 */

import type * as SQLite from 'expo-sqlite';

/** Bump by appending a migration. `user_version` in SQLite tracks where a device is. */
export const SCHEMA_VERSION = 2;

export interface Migration {
  version: number;
  name: string;
  /** Statements are run inside a single transaction by the runner. */
  up: string;
}

/**
 * Migration 1 — the schema of §5.
 *
 * Notes on deliberate choices:
 *  - Money columns are INTEGER, holding paise. There is not a REAL column anywhere in
 *    this file, and there must never be one.
 *  - `client_snapshot` / `business_snapshot` are NOT NULL because §5.4 marks them
 *    "Required": an issued document must never change because a client was later edited.
 *  - `line_items.document_id` is declared `ON DELETE CASCADE` and foreign keys are
 *    switched on by the runner, so deleting a document cannot leave orphan lines.
 */
const MIGRATION_1_INITIAL = `
CREATE TABLE IF NOT EXISTS business_profile (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  name               TEXT    NOT NULL DEFAULT '',
  tagline            TEXT    NOT NULL DEFAULT '',
  address_line1      TEXT    NOT NULL DEFAULT '',
  address_line2      TEXT    NOT NULL DEFAULT '',
  city               TEXT    NOT NULL DEFAULT '',
  state              TEXT    NOT NULL DEFAULT '',
  pincode            TEXT    NOT NULL DEFAULT '',
  phone              TEXT    NOT NULL DEFAULT '',
  email              TEXT    NOT NULL DEFAULT '',
  website            TEXT    NOT NULL DEFAULT '',
  gstin              TEXT,
  pan                TEXT,
  logo_uri           TEXT,
  signature_uri      TEXT,
  signature_label    TEXT    NOT NULL DEFAULT 'Authorised Signatory',
  bank_name          TEXT,
  bank_account_name  TEXT,
  bank_account_no    TEXT,
  bank_ifsc          TEXT,
  upi_id             TEXT,
  default_currency   TEXT    NOT NULL DEFAULT 'INR',
  default_template_id TEXT   NOT NULL DEFAULT 'classic',
  accent_color       TEXT    NOT NULL DEFAULT '#0F4C81',
  custom_fields      TEXT    NOT NULL DEFAULT '[]',
  created_at         TEXT    NOT NULL DEFAULT '',
  updated_at         TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS clients (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  company       TEXT NOT NULL DEFAULT '',
  address_line1 TEXT NOT NULL DEFAULT '',
  address_line2 TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT '',
  state         TEXT NOT NULL DEFAULT '',
  pincode       TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  gstin         TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  custom_fields TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  archived      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients (archived, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS catalogue_items (
  id           TEXT PRIMARY KEY NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  default_rate INTEGER NOT NULL DEFAULT 0,
  unit         TEXT NOT NULL DEFAULT 'nos',
  hsn_sac      TEXT,
  tax_rate_bp  INTEGER NOT NULL DEFAULT 0,
  category     TEXT NOT NULL DEFAULT '',
  is_favourite INTEGER NOT NULL DEFAULT 0,
  times_used   INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalogue_pick
  ON catalogue_items (archived, is_favourite DESC, times_used DESC, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS numbering_series (
  id         TEXT PRIMARY KEY NOT NULL,
  doc_type   TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  prefix     TEXT NOT NULL DEFAULT '',
  suffix     TEXT NOT NULL DEFAULT '',
  include_fy INTEGER NOT NULL DEFAULT 1,
  fy_format  TEXT NOT NULL DEFAULT '2026-27',
  fy_separator TEXT NOT NULL DEFAULT '/',
  pad_width  INTEGER NOT NULL DEFAULT 3,
  next_seq   INTEGER NOT NULL DEFAULT 1,
  reset_rule TEXT NOT NULL DEFAULT 'yearly_april',
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_series_type ON numbering_series (doc_type, is_default DESC);

CREATE TABLE IF NOT EXISTS documents (
  id                 TEXT PRIMARY KEY NOT NULL,
  type               TEXT NOT NULL,
  number             TEXT NOT NULL DEFAULT '',
  series_id          TEXT,
  seq                INTEGER,
  status             TEXT NOT NULL DEFAULT 'draft',
  client_id          TEXT,
  client_snapshot    TEXT NOT NULL DEFAULT '{}',
  business_snapshot  TEXT NOT NULL DEFAULT '{}',
  issue_date         TEXT NOT NULL,
  valid_until        TEXT,
  due_date           TEXT,
  currency           TEXT NOT NULL DEFAULT 'INR',
  discount_mode      TEXT NOT NULL DEFAULT 'none',
  discount_value     INTEGER NOT NULL DEFAULT 0,
  tax_mode           TEXT NOT NULL DEFAULT 'none',
  shipping_amount    INTEGER NOT NULL DEFAULT 0,
  round_off_enabled  INTEGER NOT NULL DEFAULT 0,
  round_off          INTEGER NOT NULL DEFAULT 0,
  subtotal           INTEGER NOT NULL DEFAULT 0,
  discount_total     INTEGER NOT NULL DEFAULT 0,
  tax_total          INTEGER NOT NULL DEFAULT 0,
  grand_total        INTEGER NOT NULL DEFAULT 0,
  amount_in_words    TEXT NOT NULL DEFAULT '',
  notes              TEXT NOT NULL DEFAULT '',
  terms              TEXT NOT NULL DEFAULT '',
  template_id        TEXT NOT NULL DEFAULT 'classic',
  accent_color       TEXT,
  blocks             TEXT NOT NULL DEFAULT '{}',
  linked_document_id TEXT,
  payment_method     TEXT,
  payment_reference  TEXT,
  payment_amount     INTEGER,
  custom_fields      TEXT NOT NULL DEFAULT '[]',
  number_warning     INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_list ON documents (type, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents (status);
CREATE INDEX IF NOT EXISTS idx_documents_client ON documents (client_id);
CREATE INDEX IF NOT EXISTS idx_documents_seq ON documents (series_id, seq);
CREATE INDEX IF NOT EXISTS idx_documents_number ON documents (type, number);

CREATE TABLE IF NOT EXISTS line_items (
  id                TEXT PRIMARY KEY NOT NULL,
  document_id       TEXT NOT NULL,
  position          INTEGER NOT NULL DEFAULT 0,
  catalogue_item_id TEXT,
  price_source      TEXT NOT NULL DEFAULT 'custom',
  name              TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  hsn_sac           TEXT NOT NULL DEFAULT '',
  qty_milli         INTEGER NOT NULL DEFAULT 1000,
  unit              TEXT NOT NULL DEFAULT 'nos',
  rate              INTEGER NOT NULL DEFAULT 0,
  tax_rate_bp       INTEGER NOT NULL DEFAULT 0,
  discount_bp       INTEGER NOT NULL DEFAULT 0,
  is_free           INTEGER NOT NULL DEFAULT 0,
  line_total        INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_line_items_doc ON line_items (document_id, position);

CREATE TABLE IF NOT EXISTS payments (
  id                  TEXT PRIMARY KEY NOT NULL,
  invoice_id          TEXT NOT NULL,
  amount              INTEGER NOT NULL DEFAULT 0,
  paid_on             TEXT NOT NULL,
  method              TEXT NOT NULL DEFAULT 'cash',
  reference           TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  receipt_document_id TEXT,
  created_at          TEXT NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES documents (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id, paid_on);

CREATE TABLE IF NOT EXISTS terms_blocks (
  id         TEXT PRIMARY KEY NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  doc_type   TEXT NOT NULL DEFAULT 'all',
  is_default INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tax_presets (
  id         TEXT PRIMARY KEY NOT NULL,
  label      TEXT NOT NULL,
  rate_bp    INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id               TEXT PRIMARY KEY NOT NULL,
  label            TEXT NOT NULL,
  field_type       TEXT NOT NULL DEFAULT 'text',
  applies_to       TEXT NOT NULL DEFAULT 'document',
  show_on_document INTEGER NOT NULL DEFAULT 1,
  position         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

/**
 * Migration 2 — `documents.flat_tax_rate_bp`.
 *
 * SPEC GAP: §9.2 defines a `flat` tax mode as "one Tax row at a single rate applied to
 * taxBase", but §5.4 provides no column to store that rate, so the mode was
 * unimplementable as specified. Added here rather than by editing migration 1, per
 * §16.4. Flagged in the phase report for the owner.
 */
const MIGRATION_2_FLAT_TAX = `
ALTER TABLE documents ADD COLUMN flat_tax_rate_bp INTEGER NOT NULL DEFAULT 0;
`;

/** Append-only. Never edit a released entry. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial_schema', up: MIGRATION_1_INITIAL },
  { version: 2, name: 'documents_flat_tax_rate', up: MIGRATION_2_FLAT_TAX },
];

/**
 * Bring a database up to `SCHEMA_VERSION`.
 *
 * Each migration runs in its own transaction and `user_version` is bumped inside it, so
 * an app killed mid-migration either has the whole step or none of it (§11 "app kill
 * must never corrupt a document"). Foreign keys are enabled per connection, before any
 * migration runs, so the CASCADE declarations actually take effect.
 */
export async function migrate(db: SQLite.SQLiteDatabase): Promise<number> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  // WAL keeps a reader (the export preview) from blocking the autosave writer.
  await db.execAsync('PRAGMA journal_mode = WAL;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const current = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.up);
      // PRAGMA does not accept a bound parameter, and `version` is a checked integer
      // from this file's own constant table, never user input.
      await db.execAsync(`PRAGMA user_version = ${Math.trunc(migration.version)};`);
    });
  }

  const after = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  return after?.user_version ?? 0;
}
