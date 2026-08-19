/**
 * Executes the real schema and migrations against a real SQLite engine.
 *
 * `expo-sqlite` needs a device, so these tests drive Node's built-in `node:sqlite` instead.
 * The SQL under test is the *same string* the app ships — imported from `schema.ts`, not
 * copied — so a syntax error, a bad constraint, or a migration that cannot apply on top of
 * migration 1 fails here rather than on the owner's phone during Phase 0's "DB inspectable"
 * check.
 *
 * What this cannot cover: `expo-sqlite`'s async API surface and its transaction wrapper.
 * Those are exercised by the acceptance tests on a device (§14).
 */

import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS, SCHEMA_VERSION } from '../schema';

/** Apply every migration in order, the way the runner does. */
function migrated(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const migration of MIGRATIONS) {
    db.exec(migration.up);
    db.exec(`PRAGMA user_version = ${migration.version};`);
  }
  return db;
}

function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
    .all()
    .map((row) => String((row as { name: unknown }).name));
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table});`)
    .all()
    .map((row) => String((row as { name: unknown }).name));
}

describe('migrations', () => {
  it('are numbered from 1 with no gaps and no duplicates', () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions[0]).toBe(1);
    for (let i = 1; i < versions.length; i += 1) {
      expect(versions[i]).toBe((versions[i - 1] ?? 0) + 1);
    }
  });

  it('declare SCHEMA_VERSION as the highest migration', () => {
    expect(SCHEMA_VERSION).toBe(Math.max(...MIGRATIONS.map((migration) => migration.version)));
  });

  it('all apply cleanly, in order', () => {
    const db = migrated();
    const version = db.prepare('PRAGMA user_version;').get() as { user_version: number };
    expect(version.user_version).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('are idempotent enough to re-run migration 1 on an existing database', () => {
    // Every CREATE in migration 1 uses IF NOT EXISTS, so a partially-applied migration can
    // be replayed without error. Migration 2 is an ALTER and is deliberately not replayable —
    // the runner's version check is what prevents that.
    const db = migrated();
    expect(() => db.exec(MIGRATIONS[0]!.up)).not.toThrow();
    db.close();
  });

  it('create every table §5 specifies', () => {
    const db = migrated();
    expect(tableNames(db)).toEqual([
      'business_profile',
      'catalogue_items',
      'clients',
      'custom_field_defs',
      'documents',
      'line_items',
      'numbering_series',
      'payments',
      'settings',
      'tax_presets',
      'terms_blocks',
    ]);
    db.close();
  });
});

describe('schema shape (§5)', () => {
  it('gives documents every column the repository writes', () => {
    const db = migrated();
    const columns = columnNames(db, 'documents');
    for (const column of [
      'id',
      'type',
      'number',
      'series_id',
      'seq',
      'status',
      'client_id',
      'client_snapshot',
      'business_snapshot',
      'issue_date',
      'valid_until',
      'due_date',
      'currency',
      'discount_mode',
      'discount_value',
      'tax_mode',
      'flat_tax_rate_bp',
      'shipping_amount',
      'round_off_enabled',
      'round_off',
      'subtotal',
      'discount_total',
      'tax_total',
      'grand_total',
      'amount_in_words',
      'notes',
      'terms',
      'template_id',
      'accent_color',
      'blocks',
      'linked_document_id',
      'payment_method',
      'payment_reference',
      'payment_amount',
      'custom_fields',
      'number_warning',
      'created_at',
      'updated_at',
    ]) {
      expect(columns).toContain(column);
    }
    db.close();
  });

  it('adds flat_tax_rate_bp through migration 2, not migration 1', () => {
    // The spec gap noted in calc.ts: §9.2 needs a document-level rate that §5.4 omits.
    expect(MIGRATIONS[0]!.up).not.toContain('flat_tax_rate_bp');
    expect(MIGRATIONS[1]!.up).toContain('flat_tax_rate_bp');
    const db = migrated();
    expect(columnNames(db, 'documents')).toContain('flat_tax_rate_bp');
    db.close();
  });

  it('stores every money column as INTEGER — never REAL (§5)', () => {
    const db = migrated();
    const moneyColumns: Array<[string, string[]]> = [
      ['documents', ['discount_value', 'shipping_amount', 'round_off', 'subtotal', 'discount_total', 'tax_total', 'grand_total', 'payment_amount']],
      ['line_items', ['qty_milli', 'rate', 'tax_rate_bp', 'discount_bp', 'line_total']],
      ['payments', ['amount']],
      ['catalogue_items', ['default_rate', 'tax_rate_bp']],
      ['tax_presets', ['rate_bp']],
    ];

    for (const [table, columns] of moneyColumns) {
      const info = db.prepare(`PRAGMA table_info(${table});`).all() as Array<{ name: string; type: string }>;
      for (const column of columns) {
        const found = info.find((entry) => entry.name === column);
        expect(found).toBeDefined();
        expect(found?.type.toUpperCase()).toBe('INTEGER');
      }
    }

    // And no REAL column anywhere at all.
    for (const table of tableNames(db)) {
      const info = db.prepare(`PRAGMA table_info(${table});`).all() as Array<{ name: string; type: string }>;
      for (const column of info) {
        expect(column.type.toUpperCase()).not.toBe('REAL');
      }
    }
    db.close();
  });

  it('restricts business_profile to a single row', () => {
    const db = migrated();
    db.exec("INSERT INTO business_profile (id, name, created_at, updated_at) VALUES (1, 'A', '', '');");
    expect(() =>
      db.exec("INSERT INTO business_profile (id, name, created_at, updated_at) VALUES (2, 'B', '', '');"),
    ).toThrow();
    db.close();
  });
});

describe('referential integrity', () => {
  function seedDocument(db: DatabaseSync, id = 'doc-1'): void {
    db.exec(
      `INSERT INTO documents (id, type, issue_date, created_at, updated_at)
       VALUES ('${id}', 'invoice', '2026-08-18', '', '');`,
    );
  }

  it('cascades line items when a document is deleted (§5.5)', () => {
    const db = migrated();
    seedDocument(db);
    db.exec("INSERT INTO line_items (id, document_id, name) VALUES ('line-1', 'doc-1', 'Logo');");
    expect((db.prepare('SELECT COUNT(*) AS n FROM line_items;').get() as { n: number }).n).toBe(1);

    db.exec("DELETE FROM documents WHERE id = 'doc-1';");
    expect((db.prepare('SELECT COUNT(*) AS n FROM line_items;').get() as { n: number }).n).toBe(0);
    db.close();
  });

  it('cascades payments when an invoice is deleted (§5.6)', () => {
    const db = migrated();
    seedDocument(db);
    db.exec(
      "INSERT INTO payments (id, invoice_id, amount, paid_on, created_at) VALUES ('pay-1', 'doc-1', 500000, '2026-08-18', '');",
    );
    db.exec("DELETE FROM documents WHERE id = 'doc-1';");
    expect((db.prepare('SELECT COUNT(*) AS n FROM payments;').get() as { n: number }).n).toBe(0);
    db.close();
  });

  it('rejects a line item pointing at no document', () => {
    const db = migrated();
    expect(() =>
      db.exec("INSERT INTO line_items (id, document_id, name) VALUES ('line-x', 'missing', 'X');"),
    ).toThrow();
    db.close();
  });

  it('keeps a document when its client is deleted, nulling the link (§5.2)', () => {
    // Deleting a client must never take an issued invoice with it — the document holds its
    // own snapshot of the client, which is the whole point of §5.4.
    const db = migrated();
    db.exec(
      "INSERT INTO clients (id, name, created_at, updated_at) VALUES ('client-1', 'Acme', '', '');",
    );
    db.exec(
      `INSERT INTO documents (id, type, client_id, client_snapshot, issue_date, created_at, updated_at)
       VALUES ('doc-1', 'invoice', 'client-1', '{"name":"Acme"}', '2026-08-18', '', '');`,
    );
    db.exec("DELETE FROM clients WHERE id = 'client-1';");

    const row = db.prepare("SELECT client_id, client_snapshot FROM documents WHERE id = 'doc-1';").get() as {
      client_id: string | null;
      client_snapshot: string;
    };
    expect(row.client_id).toBeNull();
    expect(row.client_snapshot).toContain('Acme');
    db.close();
  });
});

describe('indexes', () => {
  it('indexes the columns the list and picker queries sort and filter on', () => {
    const db = migrated();
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%';")
      .all()
      .map((row) => String((row as { name: unknown }).name));

    for (const expected of [
      'idx_documents_list',
      'idx_documents_status',
      'idx_documents_client',
      'idx_documents_seq',
      'idx_documents_number',
      'idx_line_items_doc',
      'idx_payments_invoice',
      'idx_clients_name',
      'idx_catalogue_pick',
      'idx_series_type',
    ]) {
      expect(indexes).toContain(expected);
    }
    db.close();
  });

  it('uses an index rather than a scan for the documents list query', () => {
    const db = migrated();
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT * FROM documents WHERE type = 'invoice' ORDER BY issue_date DESC;`,
      )
      .all()
      .map((row) => String((row as { detail: unknown }).detail))
      .join(' ');
    expect(plan.toUpperCase()).toContain('USING INDEX');
    db.close();
  });
});

describe('numbering series storage (§8)', () => {
  it('holds the fy_separator field the number format needs', () => {
    // The spec-addition flagged in numbering.ts: §8.1's format and its own example only
    // reconcile if the financial-year token carries a separator.
    const db = migrated();
    expect(columnNames(db, 'numbering_series')).toContain('fy_separator');
    db.close();
  });

  it('allows a null seq so drafts can hold no number (§8.3)', () => {
    const db = migrated();
    db.exec(
      `INSERT INTO documents (id, type, issue_date, seq, created_at, updated_at)
       VALUES ('draft-1', 'quotation', '2026-08-18', NULL, '', '');`,
    );
    const row = db.prepare("SELECT seq, number FROM documents WHERE id = 'draft-1';").get() as {
      seq: number | null;
      number: string;
    };
    expect(row.seq).toBeNull();
    expect(row.number).toBe('');
    db.close();
  });

  it('lets MAX(seq) ignore drafts, which is what keeps numbering gap-free (§14.8)', () => {
    const db = migrated();
    // Twelve abandoned drafts, then one real document.
    for (let i = 0; i < 12; i += 1) {
      db.exec(
        `INSERT INTO documents (id, type, series_id, seq, issue_date, created_at, updated_at)
         VALUES ('draft-${i}', 'quotation', 'series-quotation', NULL, '2026-08-18', '', '');`,
      );
    }
    const max = db
      .prepare("SELECT MAX(seq) AS value FROM documents WHERE series_id = 'series-quotation' AND seq IS NOT NULL;")
      .get() as { value: number | null };
    expect(max.value).toBeNull(); // so the allocator hands out 1

    db.exec("DELETE FROM documents WHERE seq IS NULL;");
    db.exec(
      `INSERT INTO documents (id, type, series_id, seq, number, issue_date, created_at, updated_at)
       VALUES ('real-1', 'quotation', 'series-quotation', 1, 'CP/Q/2026-27/001', '2026-08-18', '', '');`,
    );
    const after = db
      .prepare("SELECT number FROM documents WHERE series_id = 'series-quotation';")
      .all()
      .map((row) => String((row as { number: unknown }).number));
    expect(after).toEqual(['CP/Q/2026-27/001']);
    db.close();
  });
});
