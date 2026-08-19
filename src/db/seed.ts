/**
 * First-run seed data — spec §5.9.
 *
 * Seeding is idempotent: every insert is `INSERT OR IGNORE` against a fixed id, so a
 * second call cannot duplicate a series or resurrect a preset the owner deleted... with
 * one caveat worth stating plainly — a deleted row *will* come back if the seed runs
 * again, so the runner only seeds when the `settings` marker is absent.
 */

import type * as SQLite from 'expo-sqlite';

import { nowIsoWithOffset } from '../core/dates';

/** Marker key in `settings` recording that the seed has run. */
export const SEED_MARKER_KEY = 'seed.version';
export const SEED_VERSION = '1';

/** GST rate presets of §5.8. */
const TAX_PRESETS: ReadonlyArray<{ id: string; label: string; rateBp: number; isDefault: number }> = [
  { id: 'tax-0', label: 'No tax (0%)', rateBp: 0, isDefault: 0 },
  { id: 'tax-5', label: '5% GST', rateBp: 500, isDefault: 0 },
  { id: 'tax-12', label: '12% GST', rateBp: 1200, isDefault: 0 },
  { id: 'tax-18', label: '18% GST', rateBp: 1800, isDefault: 1 },
  { id: 'tax-28', label: '28% GST', rateBp: 2800, isDefault: 0 },
];

/**
 * One default numbering series per document type (§5.9).
 *
 * Prefixes follow the owner's existing house style, `CP/Q/`, `CP/INV/`, `CP/RCP/`, and
 * default to a financial-year token with an April reset, which is what an Indian
 * business's books expect.
 */
const SERIES: ReadonlyArray<{
  id: string;
  docType: string;
  label: string;
  prefix: string;
}> = [
  { id: 'series-quotation', docType: 'quotation', label: 'Quotations', prefix: 'CP/Q/' },
  { id: 'series-invoice', docType: 'invoice', label: 'Invoices', prefix: 'CP/INV/' },
  { id: 'series-receipt', docType: 'receipt', label: 'Receipts', prefix: 'CP/RCP/' },
];

/**
 * The seven clauses the owner already uses on quotations (§5.8).
 *
 * Wording is deliberately plain and non-legalistic — it is what a small design studio
 * actually sends a client, and the owner can edit any of it in Settings → Terms.
 */
const QUOTATION_TERMS = [
  '1. Payment: 50% advance to confirm the project, balance on delivery of final files.',
  '2. Timeline: Work begins on receipt of the advance and all required inputs. Quoted timelines exclude client review time.',
  '3. Revisions: Two rounds of revisions are included at each stage. Further revisions are chargeable.',
  '4. Client inputs: Text, images, logos and brand references are to be supplied by the client. Delays in inputs shift the delivery date accordingly.',
  '5. Ownership: Full ownership of the approved final design transfers to the client on receipt of complete payment.',
  '6. Portfolio: We reserve the right to display the completed work in our portfolio and on social media unless agreed otherwise in writing.',
  '7. Validity: This quotation is valid for 15 days from the date of issue. Prices may be revised thereafter.',
].join('\n');

const INVOICE_TERMS = [
  '1. Payment is due within the period stated on this invoice.',
  '2. Please quote the invoice number with your payment so it can be reconciled.',
  '3. Files and deliverables are released on receipt of full payment.',
].join('\n');

const TERMS_BLOCKS: ReadonlyArray<{
  id: string;
  title: string;
  body: string;
  docType: string;
  isDefault: number;
  position: number;
}> = [
  {
    id: 'terms-quotation-default',
    title: 'Standard quotation terms',
    body: QUOTATION_TERMS,
    docType: 'quotation',
    isDefault: 1,
    position: 0,
  },
  {
    id: 'terms-invoice-default',
    title: 'Standard invoice terms',
    body: INVOICE_TERMS,
    docType: 'invoice',
    isDefault: 1,
    position: 1,
  },
  {
    id: 'terms-thanks',
    title: 'Thank-you note',
    body: 'Thank you for your business. It is a pleasure working with you.',
    docType: 'all',
    isDefault: 0,
    position: 2,
  },
];

/**
 * Starter catalogue of design services (§5.9).
 *
 * Rates are deliberately left at 0 for the owner to fill in — inventing prices for
 * someone else's business would be worse than an obvious blank, and a ₹0 rate shows up
 * plainly in the editor.
 */
const CATALOGUE: ReadonlyArray<{
  id: string;
  name: string;
  description: string;
  unit: string;
  hsnSac: string;
  category: string;
}> = [
  {
    id: 'cat-logo-design',
    name: 'Logo Design',
    description:
      'Custom logo design with initial concepts, refinement of the chosen direction, and final files in vector and raster formats.',
    unit: 'nos',
    hsnSac: '998391',
    category: 'Brand Identity',
  },
  {
    id: 'cat-social-poster',
    name: 'Social Media Poster',
    description: 'Single social media creative, sized for the required platform.',
    unit: 'nos',
    hsnSac: '998391',
    category: 'Social Media',
  },
  {
    id: 'cat-brand-guideline',
    name: 'Brand Guideline Sheet',
    description:
      'Brand usage sheet covering logo variants, clear space, colour values and typography.',
    unit: 'nos',
    hsnSac: '998391',
    category: 'Brand Identity',
  },
  {
    id: 'cat-business-card',
    name: 'Business Card Design',
    description: 'Double-sided business card design with print-ready files.',
    unit: 'nos',
    hsnSac: '998391',
    category: 'Print',
  },
  {
    id: 'cat-flyer',
    name: 'Flyer Design',
    description: 'Single-page flyer design, print-ready.',
    unit: 'nos',
    hsnSac: '998391',
    category: 'Print',
  },
  {
    id: 'cat-banner',
    name: 'Banner Design',
    description: 'Banner or hoarding design at the supplied dimensions.',
    unit: 'sq.ft',
    hsnSac: '998391',
    category: 'Print',
  },
];

/** Custom field definitions worth having from the start (§7.5). */
const CUSTOM_FIELD_DEFS: ReadonlyArray<{
  id: string;
  label: string;
  fieldType: string;
  appliesTo: string;
  position: number;
}> = [
  { id: 'cfd-po-number', label: 'PO Number', fieldType: 'text', appliesTo: 'document', position: 0 },
  { id: 'cfd-project-code', label: 'Project Code', fieldType: 'text', appliesTo: 'document', position: 1 },
];

/** Has the seed already run on this database? */
export async function isSeeded(db: SQLite.SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?;',
    SEED_MARKER_KEY,
  );
  return row?.value === SEED_VERSION;
}

/**
 * Insert the first-run data. Safe to call on every launch; does nothing once seeded.
 *
 * Everything happens in one transaction, so a kill mid-seed leaves a database that will
 * simply seed cleanly next launch rather than one holding half a catalogue.
 */
export async function seedDatabase(db: SQLite.SQLiteDatabase): Promise<boolean> {
  if (await isSeeded(db)) return false;

  const now = nowIsoWithOffset();

  await db.withTransactionAsync(async () => {
    // The single business profile row must exist before any screen reads it.
    await db.runAsync(
      `INSERT OR IGNORE INTO business_profile (id, created_at, updated_at) VALUES (1, ?, ?);`,
      now,
      now,
    );

    for (const preset of TAX_PRESETS) {
      await db.runAsync(
        `INSERT OR IGNORE INTO tax_presets (id, label, rate_bp, is_default) VALUES (?, ?, ?, ?);`,
        preset.id,
        preset.label,
        preset.rateBp,
        preset.isDefault,
      );
    }

    for (const series of SERIES) {
      await db.runAsync(
        `INSERT OR IGNORE INTO numbering_series
           (id, doc_type, label, prefix, suffix, include_fy, fy_format, fy_separator,
            pad_width, next_seq, reset_rule, is_default)
         VALUES (?, ?, ?, ?, '', 1, '2026-27', '/', 3, 1, 'yearly_april', 1);`,
        series.id,
        series.docType,
        series.label,
        series.prefix,
      );
    }

    for (const block of TERMS_BLOCKS) {
      await db.runAsync(
        `INSERT OR IGNORE INTO terms_blocks (id, title, body, doc_type, is_default, position)
         VALUES (?, ?, ?, ?, ?, ?);`,
        block.id,
        block.title,
        block.body,
        block.docType,
        block.isDefault,
        block.position,
      );
    }

    for (const item of CATALOGUE) {
      await db.runAsync(
        `INSERT OR IGNORE INTO catalogue_items
           (id, name, description, default_rate, unit, hsn_sac, tax_rate_bp, category,
            is_favourite, times_used, archived, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, 1800, ?, 0, 0, 0, ?, ?);`,
        item.id,
        item.name,
        item.description,
        item.unit,
        item.hsnSac,
        item.category,
        now,
        now,
      );
    }

    for (const def of CUSTOM_FIELD_DEFS) {
      await db.runAsync(
        `INSERT OR IGNORE INTO custom_field_defs
           (id, label, field_type, applies_to, show_on_document, position)
         VALUES (?, ?, ?, ?, 0, ?);`,
        def.id,
        def.label,
        def.fieldType,
        def.appliesTo,
        def.position,
      );
    }

    await db.runAsync(
      `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);`,
      SEED_MARKER_KEY,
      SEED_VERSION,
    );
  });

  return true;
}
