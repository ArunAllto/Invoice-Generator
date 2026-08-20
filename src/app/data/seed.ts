/**
 * First-run seed data — spec §5.9. Ported from the React Native tree.
 *
 * Seeding is guarded by a marker row rather than by `INSERT OR IGNORE` alone. Both are used: the
 * marker stops the seed re-running at all, and the ignores mean that even if it does run twice
 * nothing is duplicated. Without the marker, a preset the owner deliberately deleted would
 * quietly come back on the next launch.
 *
 * Takes the database as an argument rather than injecting it, which keeps this out of the
 * connection service's dependency cycle.
 */

import { Injectable } from '@angular/core';

import { nowIsoWithOffset } from '../core/dates';
import type { SqliteService } from './sqlite.service';

export const SEED_MARKER_KEY = 'seed.version';
export const SEED_VERSION = '1';

/** GST rate presets of §5.8. */
const TAX_PRESETS = [
  { id: 'tax-0', label: 'No tax (0%)', rateBp: 0, isDefault: 0 },
  { id: 'tax-5', label: '5% GST', rateBp: 500, isDefault: 0 },
  { id: 'tax-12', label: '12% GST', rateBp: 1200, isDefault: 0 },
  { id: 'tax-18', label: '18% GST', rateBp: 1800, isDefault: 1 },
  { id: 'tax-28', label: '28% GST', rateBp: 2800, isDefault: 0 },
] as const;

/**
 * One default numbering series per document type (§5.9).
 *
 * Prefixes follow the owner's existing house style and default to a financial-year token with an
 * April reset, which is what an Indian business's books expect.
 */
const SERIES = [
  { id: 'series-quotation', docType: 'quotation', label: 'Quotations', prefix: 'CP/Q/' },
  { id: 'series-invoice', docType: 'invoice', label: 'Invoices', prefix: 'CP/INV/' },
  { id: 'series-receipt', docType: 'receipt', label: 'Receipts', prefix: 'CP/RCP/' },
] as const;

/**
 * The seven clauses the owner already uses on quotations (§5.8).
 *
 * Deliberately plain rather than legalistic — it is what a small design studio actually sends a
 * client, and every word is editable in Settings → Terms.
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

const TERMS_BLOCKS = [
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
] as const;

/**
 * Starter catalogue of design services (§5.9).
 *
 * Rates are left at 0 for the owner to fill in. Inventing prices for someone else's business
 * would be worse than an obvious blank, and a ₹0 rate is called out in the picker.
 */
const CATALOGUE = [
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
] as const;

/** Extra fields worth having from the start (§7.5). */
const CUSTOM_FIELD_DEFS = [
  { id: 'cfd-po-number', label: 'PO Number', fieldType: 'text', appliesTo: 'document', position: 0 },
  { id: 'cfd-project-code', label: 'Project Code', fieldType: 'text', appliesTo: 'document', position: 1 },
] as const;

@Injectable({ providedIn: 'root' })
export class SeedService {
  /**
   * Insert the first-run data if it has not been inserted before.
   *
   * Everything happens in one transaction, so a kill mid-seed leaves a database that seeds
   * cleanly next launch rather than one holding half a catalogue.
   *
   * @returns whether anything was written.
   */
  async run(db: SqliteService): Promise<boolean> {
    const marker = await db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?;', [
      SEED_MARKER_KEY,
    ]);
    if (marker?.value === SEED_VERSION) return false;

    const now = nowIsoWithOffset();

    await db.transaction(async (run) => {
      // The single business profile row must exist before any screen reads it.
      await run('INSERT OR IGNORE INTO business_profile (id, created_at, updated_at) VALUES (1, ?, ?);', [
        now,
        now,
      ]);

      for (const preset of TAX_PRESETS) {
        await run('INSERT OR IGNORE INTO tax_presets (id, label, rate_bp, is_default) VALUES (?, ?, ?, ?);', [
          preset.id,
          preset.label,
          preset.rateBp,
          preset.isDefault,
        ]);
      }

      for (const series of SERIES) {
        await run(
          `INSERT OR IGNORE INTO numbering_series
             (id, doc_type, label, prefix, suffix, include_fy, fy_format, fy_separator,
              pad_width, next_seq, reset_rule, is_default)
           VALUES (?, ?, ?, ?, '', 1, '2026-27', '/', 3, 1, 'yearly_april', 1);`,
          [series.id, series.docType, series.label, series.prefix],
        );
      }

      for (const block of TERMS_BLOCKS) {
        await run(
          `INSERT OR IGNORE INTO terms_blocks (id, title, body, doc_type, is_default, position)
           VALUES (?, ?, ?, ?, ?, ?);`,
          [block.id, block.title, block.body, block.docType, block.isDefault, block.position],
        );
      }

      for (const item of CATALOGUE) {
        await run(
          `INSERT OR IGNORE INTO catalogue_items
             (id, name, description, default_rate, unit, hsn_sac, tax_rate_bp, category,
              is_favourite, times_used, archived, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?, 1800, ?, 0, 0, 0, ?, ?);`,
          [item.id, item.name, item.description, item.unit, item.hsnSac, item.category, now, now],
        );
      }

      for (const def of CUSTOM_FIELD_DEFS) {
        await run(
          `INSERT OR IGNORE INTO custom_field_defs
             (id, label, field_type, applies_to, show_on_document, position)
           VALUES (?, ?, ?, ?, 0, ?);`,
          [def.id, def.label, def.fieldType, def.appliesTo, def.position],
        );
      }

      await run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [
        SEED_MARKER_KEY,
        SEED_VERSION,
      ]);
    });

    return true;
  }
}
