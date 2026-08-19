/**
 * Repositories for the master-data tables: business profile, clients, catalogue,
 * numbering series, terms blocks, tax presets, custom field definitions, settings.
 *
 * Every function takes the database as its first argument rather than reaching for a
 * module-level singleton, so each is callable against a temporary database in a test.
 */

import type * as SQLite from 'expo-sqlite';

import { nowIsoWithOffset } from '../core/dates';
import { uuid } from '../core/ids';
import { allocateNextSeq, financialYearOf, type NumberingSeriesShape } from '../core/numbering';
import type {
  CustomFieldScope,
  CustomFieldType,
  CustomFieldValue,
  DocumentType,
  FyFormat,
  ResetRule,
  TemplateId,
} from '../core/types';
import {
  asCustomFieldScope,
  asCustomFieldType,
  asFyFormat,
  asResetRule,
  asTemplateId,
  fromBoolean,
  parseCustomFields,
  toBoolean,
  type BusinessProfileRow,
  type CatalogueItemRow,
  type ClientRow,
  type CustomFieldDefRow,
  type NumberingSeriesRow,
  type TaxPresetRow,
  type TermsBlockRow,
} from './rows';

// ---------------------------------------------------------------------------
// Business profile (single row, id = 1)
// ---------------------------------------------------------------------------

export interface BusinessProfile {
  name: string;
  tagline: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  website: string;
  gstin: string | null;
  pan: string | null;
  logoUri: string | null;
  signatureUri: string | null;
  signatureLabel: string;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  upiId: string | null;
  defaultCurrency: string;
  defaultTemplateId: TemplateId;
  accentColor: string;
  customFields: CustomFieldValue[];
}

function mapBusiness(row: BusinessProfileRow): BusinessProfile {
  return {
    name: row.name,
    tagline: row.tagline,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    phone: row.phone,
    email: row.email,
    website: row.website,
    gstin: row.gstin,
    pan: row.pan,
    logoUri: row.logo_uri,
    signatureUri: row.signature_uri,
    signatureLabel: row.signature_label,
    bankName: row.bank_name,
    bankAccountName: row.bank_account_name,
    bankAccountNo: row.bank_account_no,
    bankIfsc: row.bank_ifsc,
    upiId: row.upi_id,
    defaultCurrency: row.default_currency,
    defaultTemplateId: asTemplateId(row.default_template_id),
    accentColor: row.accent_color,
    customFields: parseCustomFields(row.custom_fields),
  };
}

export const EMPTY_BUSINESS: BusinessProfile = {
  name: '',
  tagline: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  pincode: '',
  phone: '',
  email: '',
  website: '',
  gstin: null,
  pan: null,
  logoUri: null,
  signatureUri: null,
  signatureLabel: 'Authorised Signatory',
  bankName: null,
  bankAccountName: null,
  bankAccountNo: null,
  bankIfsc: null,
  upiId: null,
  defaultCurrency: 'INR',
  defaultTemplateId: 'classic',
  accentColor: '#0F4C81',
  customFields: [],
};

export async function getBusinessProfile(db: SQLite.SQLiteDatabase): Promise<BusinessProfile> {
  const row = await db.getFirstAsync<BusinessProfileRow>(
    'SELECT * FROM business_profile WHERE id = 1;',
  );
  return row ? mapBusiness(row) : EMPTY_BUSINESS;
}

export async function saveBusinessProfile(
  db: SQLite.SQLiteDatabase,
  profile: BusinessProfile,
): Promise<void> {
  const now = nowIsoWithOffset();
  await db.runAsync(
    `INSERT INTO business_profile (
       id, name, tagline, address_line1, address_line2, city, state, pincode,
       phone, email, website, gstin, pan, logo_uri, signature_uri, signature_label,
       bank_name, bank_account_name, bank_account_no, bank_ifsc, upi_id,
       default_currency, default_template_id, accent_color, custom_fields, created_at, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, tagline = excluded.tagline,
       address_line1 = excluded.address_line1, address_line2 = excluded.address_line2,
       city = excluded.city, state = excluded.state, pincode = excluded.pincode,
       phone = excluded.phone, email = excluded.email, website = excluded.website,
       gstin = excluded.gstin, pan = excluded.pan,
       logo_uri = excluded.logo_uri, signature_uri = excluded.signature_uri,
       signature_label = excluded.signature_label,
       bank_name = excluded.bank_name, bank_account_name = excluded.bank_account_name,
       bank_account_no = excluded.bank_account_no, bank_ifsc = excluded.bank_ifsc,
       upi_id = excluded.upi_id, default_currency = excluded.default_currency,
       default_template_id = excluded.default_template_id, accent_color = excluded.accent_color,
       custom_fields = excluded.custom_fields, updated_at = excluded.updated_at;`,
    profile.name,
    profile.tagline,
    profile.addressLine1,
    profile.addressLine2,
    profile.city,
    profile.state,
    profile.pincode,
    profile.phone,
    profile.email,
    profile.website,
    profile.gstin,
    profile.pan,
    profile.logoUri,
    profile.signatureUri,
    profile.signatureLabel,
    profile.bankName,
    profile.bankAccountName,
    profile.bankAccountNo,
    profile.bankIfsc,
    profile.upiId,
    profile.defaultCurrency,
    profile.defaultTemplateId,
    profile.accentColor,
    JSON.stringify(profile.customFields),
    now,
    now,
  );
}

/** §4.1: the dashboard shows a completion banner until the essentials are filled in. */
export function isBusinessProfileComplete(profile: BusinessProfile): boolean {
  return profile.name.trim().length > 0 && (profile.phone.trim().length > 0 || profile.email.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export interface Client {
  id: string;
  name: string;
  company: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  gstin: string | null;
  notes: string;
  customFields: CustomFieldValue[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    phone: row.phone,
    email: row.email,
    gstin: row.gstin,
    notes: row.notes,
    customFields: parseCustomFields(row.custom_fields),
    archived: toBoolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function emptyClient(): Client {
  const now = nowIsoWithOffset();
  return {
    id: uuid(),
    name: '',
    company: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    pincode: '',
    phone: '',
    email: '',
    gstin: null,
    notes: '',
    customFields: [],
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listClients(
  db: SQLite.SQLiteDatabase,
  options: { includeArchived?: boolean; search?: string } = {},
): Promise<Client[]> {
  const { includeArchived = false, search = '' } = options;
  const term = search.trim();

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (!includeArchived) where.push('archived = 0');
  if (term.length > 0) {
    where.push('(name LIKE ? COLLATE NOCASE OR company LIKE ? COLLATE NOCASE OR phone LIKE ?)');
    const like = `%${term}%`;
    params.push(like, like, like);
  }

  const rows = await db.getAllAsync<ClientRow>(
    `SELECT * FROM clients
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY name COLLATE NOCASE;`,
    ...params,
  );
  return rows.map(mapClient);
}

export async function getClient(db: SQLite.SQLiteDatabase, id: string): Promise<Client | null> {
  const row = await db.getFirstAsync<ClientRow>('SELECT * FROM clients WHERE id = ?;', id);
  return row ? mapClient(row) : null;
}

export async function saveClient(db: SQLite.SQLiteDatabase, client: Client): Promise<void> {
  const now = nowIsoWithOffset();
  await db.runAsync(
    `INSERT INTO clients (
       id, name, company, address_line1, address_line2, city, state, pincode,
       phone, email, gstin, notes, custom_fields, created_at, updated_at, archived
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, company = excluded.company,
       address_line1 = excluded.address_line1, address_line2 = excluded.address_line2,
       city = excluded.city, state = excluded.state, pincode = excluded.pincode,
       phone = excluded.phone, email = excluded.email, gstin = excluded.gstin,
       notes = excluded.notes, custom_fields = excluded.custom_fields,
       archived = excluded.archived, updated_at = excluded.updated_at;`,
    client.id,
    client.name,
    client.company,
    client.addressLine1,
    client.addressLine2,
    client.city,
    client.state,
    client.pincode,
    client.phone,
    client.email,
    client.gstin,
    client.notes,
    JSON.stringify(client.customFields),
    client.createdAt || now,
    now,
    fromBoolean(client.archived),
  );
}

/**
 * Archive rather than delete when the client is referenced.
 *
 * §5.2: "archived clients hide from pickers but keep old documents intact". Hard-deleting
 * a client who appears on an issued invoice would break the chain the owner may need for
 * a GST query, so it is only permitted when nothing references them.
 */
export async function deleteOrArchiveClient(
  db: SQLite.SQLiteDatabase,
  id: string,
): Promise<'deleted' | 'archived'> {
  const usage = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM documents WHERE client_id = ?;',
    id,
  );
  if ((usage?.count ?? 0) > 0) {
    await db.runAsync('UPDATE clients SET archived = 1, updated_at = ? WHERE id = ?;', nowIsoWithOffset(), id);
    return 'archived';
  }
  await db.runAsync('DELETE FROM clients WHERE id = ?;', id);
  return 'deleted';
}

export async function setClientArchived(
  db: SQLite.SQLiteDatabase,
  id: string,
  archived: boolean,
): Promise<void> {
  await db.runAsync(
    'UPDATE clients SET archived = ?, updated_at = ? WHERE id = ?;',
    fromBoolean(archived),
    nowIsoWithOffset(),
    id,
  );
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export interface CatalogueItem {
  id: string;
  name: string;
  description: string;
  defaultRate: number;
  unit: string;
  hsnSac: string | null;
  taxRateBp: number;
  category: string;
  isFavourite: boolean;
  timesUsed: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapCatalogueItem(row: CatalogueItemRow): CatalogueItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    defaultRate: row.default_rate,
    unit: row.unit,
    hsnSac: row.hsn_sac,
    taxRateBp: row.tax_rate_bp,
    category: row.category,
    isFavourite: toBoolean(row.is_favourite),
    timesUsed: row.times_used,
    archived: toBoolean(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function emptyCatalogueItem(): CatalogueItem {
  const now = nowIsoWithOffset();
  return {
    id: uuid(),
    name: '',
    description: '',
    defaultRate: 0,
    unit: 'nos',
    hsnSac: null,
    taxRateBp: 1800,
    category: '',
    isFavourite: false,
    timesUsed: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The catalogue picker's ordering, straight from §7.3: favourites first, then most-used,
 * then alphabetical. Grouping by category happens in the UI from this order.
 */
export async function listCatalogueItems(
  db: SQLite.SQLiteDatabase,
  options: { includeArchived?: boolean; search?: string } = {},
): Promise<CatalogueItem[]> {
  const { includeArchived = false, search = '' } = options;
  const term = search.trim();

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (!includeArchived) where.push('archived = 0');
  if (term.length > 0) {
    where.push(
      '(name LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE OR category LIKE ? COLLATE NOCASE)',
    );
    const like = `%${term}%`;
    params.push(like, like, like);
  }

  const rows = await db.getAllAsync<CatalogueItemRow>(
    `SELECT * FROM catalogue_items
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY is_favourite DESC, times_used DESC, name COLLATE NOCASE;`,
    ...params,
  );
  return rows.map(mapCatalogueItem);
}

export async function getCatalogueItem(
  db: SQLite.SQLiteDatabase,
  id: string,
): Promise<CatalogueItem | null> {
  const row = await db.getFirstAsync<CatalogueItemRow>(
    'SELECT * FROM catalogue_items WHERE id = ?;',
    id,
  );
  return row ? mapCatalogueItem(row) : null;
}

export async function saveCatalogueItem(
  db: SQLite.SQLiteDatabase,
  item: CatalogueItem,
): Promise<void> {
  const now = nowIsoWithOffset();
  await db.runAsync(
    `INSERT INTO catalogue_items (
       id, name, description, default_rate, unit, hsn_sac, tax_rate_bp, category,
       is_favourite, times_used, archived, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, description = excluded.description,
       default_rate = excluded.default_rate, unit = excluded.unit,
       hsn_sac = excluded.hsn_sac, tax_rate_bp = excluded.tax_rate_bp,
       category = excluded.category, is_favourite = excluded.is_favourite,
       archived = excluded.archived, updated_at = excluded.updated_at;`,
    item.id,
    item.name,
    item.description,
    item.defaultRate,
    item.unit,
    item.hsnSac,
    item.taxRateBp,
    item.category,
    fromBoolean(item.isFavourite),
    item.timesUsed,
    fromBoolean(item.archived),
    item.createdAt || now,
    now,
  );
}

/** §5.3: `times_used` is a usage counter driving the picker's secondary sort. */
export async function incrementCatalogueUsage(
  db: SQLite.SQLiteDatabase,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  await db.runAsync(
    `UPDATE catalogue_items SET times_used = times_used + 1 WHERE id IN (${placeholders});`,
    ...ids,
  );
}

/**
 * §7.3's explicit write-back: "Update catalogue price to ₹X?".
 *
 * Separate from `saveCatalogueItem` so it is impossible to trigger accidentally — the
 * spec is emphatic that editing a line's rate must never silently change the catalogue.
 */
export async function updateCatalogueRate(
  db: SQLite.SQLiteDatabase,
  id: string,
  rate: number,
): Promise<void> {
  await db.runAsync(
    'UPDATE catalogue_items SET default_rate = ?, updated_at = ? WHERE id = ?;',
    rate,
    nowIsoWithOffset(),
    id,
  );
}

export async function deleteOrArchiveCatalogueItem(
  db: SQLite.SQLiteDatabase,
  id: string,
): Promise<'deleted' | 'archived'> {
  const usage = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM line_items WHERE catalogue_item_id = ?;',
    id,
  );
  if ((usage?.count ?? 0) > 0) {
    await db.runAsync(
      'UPDATE catalogue_items SET archived = 1, updated_at = ? WHERE id = ?;',
      nowIsoWithOffset(),
      id,
    );
    return 'archived';
  }
  await db.runAsync('DELETE FROM catalogue_items WHERE id = ?;', id);
  return 'deleted';
}

export async function toggleCatalogueFavourite(
  db: SQLite.SQLiteDatabase,
  id: string,
): Promise<void> {
  await db.runAsync(
    'UPDATE catalogue_items SET is_favourite = 1 - is_favourite, updated_at = ? WHERE id = ?;',
    nowIsoWithOffset(),
    id,
  );
}

// ---------------------------------------------------------------------------
// Numbering series
// ---------------------------------------------------------------------------

export interface NumberingSeries extends NumberingSeriesShape {
  id: string;
  docType: DocumentType;
  label: string;
  nextSeq: number;
  resetRule: ResetRule;
  isDefault: boolean;
}

function mapSeries(row: NumberingSeriesRow): NumberingSeries {
  return {
    id: row.id,
    docType: row.doc_type as DocumentType,
    label: row.label,
    prefix: row.prefix,
    suffix: row.suffix,
    includeFy: toBoolean(row.include_fy),
    fyFormat: asFyFormat(row.fy_format) as FyFormat,
    fySeparator: row.fy_separator,
    padWidth: row.pad_width,
    nextSeq: row.next_seq,
    resetRule: asResetRule(row.reset_rule),
    isDefault: toBoolean(row.is_default),
  };
}

export async function listSeries(
  db: SQLite.SQLiteDatabase,
  docType?: DocumentType,
): Promise<NumberingSeries[]> {
  const rows = docType
    ? await db.getAllAsync<NumberingSeriesRow>(
        'SELECT * FROM numbering_series WHERE doc_type = ? ORDER BY is_default DESC, label;',
        docType,
      )
    : await db.getAllAsync<NumberingSeriesRow>(
        'SELECT * FROM numbering_series ORDER BY doc_type, is_default DESC, label;',
      );
  return rows.map(mapSeries);
}

export async function getDefaultSeries(
  db: SQLite.SQLiteDatabase,
  docType: DocumentType,
): Promise<NumberingSeries | null> {
  const row = await db.getFirstAsync<NumberingSeriesRow>(
    'SELECT * FROM numbering_series WHERE doc_type = ? ORDER BY is_default DESC, rowid LIMIT 1;',
    docType,
  );
  return row ? mapSeries(row) : null;
}

export async function getSeries(
  db: SQLite.SQLiteDatabase,
  id: string,
): Promise<NumberingSeries | null> {
  const row = await db.getFirstAsync<NumberingSeriesRow>(
    'SELECT * FROM numbering_series WHERE id = ?;',
    id,
  );
  return row ? mapSeries(row) : null;
}

export async function saveSeries(db: SQLite.SQLiteDatabase, series: NumberingSeries): Promise<void> {
  await db.withTransactionAsync(async () => {
    if (series.isDefault) {
      // Exactly one default per type.
      await db.runAsync(
        'UPDATE numbering_series SET is_default = 0 WHERE doc_type = ? AND id != ?;',
        series.docType,
        series.id,
      );
    }
    await db.runAsync(
      `INSERT INTO numbering_series (
         id, doc_type, label, prefix, suffix, include_fy, fy_format, fy_separator,
         pad_width, next_seq, reset_rule, is_default
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         doc_type = excluded.doc_type, label = excluded.label, prefix = excluded.prefix,
         suffix = excluded.suffix, include_fy = excluded.include_fy,
         fy_format = excluded.fy_format, fy_separator = excluded.fy_separator,
         pad_width = excluded.pad_width, next_seq = excluded.next_seq,
         reset_rule = excluded.reset_rule, is_default = excluded.is_default;`,
      series.id,
      series.docType,
      series.label,
      series.prefix,
      series.suffix,
      fromBoolean(series.includeFy),
      series.fyFormat,
      series.fySeparator,
      series.padWidth,
      series.nextSeq,
      series.resetRule,
      fromBoolean(series.isDefault),
    );
  });
}

/**
 * The facts `allocateNextSeq` needs, read from the documents actually numbered.
 *
 * Only rows with a non-null `seq` count, which is what makes §8.3 work: drafts hold no
 * number, so abandoned ones leave no gap behind.
 */
export async function readAllocationFacts(
  db: SQLite.SQLiteDatabase,
  series: NumberingSeries,
  issueDate: string,
): Promise<{ maxSeqOverall: number | null; maxSeqInFy: number | null; nextSeq: number; resetRule: ResetRule }> {
  const fy = financialYearOf(issueDate);
  const fyStart = `${fy.startYear}-04-01`;
  const fyEnd = `${fy.endYear}-03-31`;

  const overall = await db.getFirstAsync<{ value: number | null }>(
    'SELECT MAX(seq) AS value FROM documents WHERE series_id = ? AND seq IS NOT NULL;',
    series.id,
  );
  const inFy = await db.getFirstAsync<{ value: number | null }>(
    `SELECT MAX(seq) AS value FROM documents
      WHERE series_id = ? AND seq IS NOT NULL
        AND substr(issue_date, 1, 10) >= ? AND substr(issue_date, 1, 10) <= ?;`,
    series.id,
    fyStart,
    fyEnd,
  );

  return {
    maxSeqOverall: overall?.value ?? null,
    maxSeqInFy: inFy?.value ?? null,
    nextSeq: series.nextSeq,
    resetRule: series.resetRule,
  };
}

/** Convenience wrapper used by the preview label in §8.3. */
export async function peekNextSeq(
  db: SQLite.SQLiteDatabase,
  series: NumberingSeries,
  issueDate: string,
): Promise<number> {
  return allocateNextSeq(await readAllocationFacts(db, series, issueDate));
}

// ---------------------------------------------------------------------------
// Terms blocks
// ---------------------------------------------------------------------------

export interface TermsBlock {
  id: string;
  title: string;
  body: string;
  docType: DocumentType | 'all';
  isDefault: boolean;
  position: number;
}

function mapTerms(row: TermsBlockRow): TermsBlock {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    docType: (['quotation', 'invoice', 'receipt', 'all'] as const).includes(
      row.doc_type as DocumentType | 'all',
    )
      ? (row.doc_type as DocumentType | 'all')
      : 'all',
    isDefault: toBoolean(row.is_default),
    position: row.position,
  };
}

export async function listTermsBlocks(
  db: SQLite.SQLiteDatabase,
  docType?: DocumentType,
): Promise<TermsBlock[]> {
  const rows = docType
    ? await db.getAllAsync<TermsBlockRow>(
        `SELECT * FROM terms_blocks WHERE doc_type = ? OR doc_type = 'all'
         ORDER BY is_default DESC, position, title;`,
        docType,
      )
    : await db.getAllAsync<TermsBlockRow>(
        'SELECT * FROM terms_blocks ORDER BY doc_type, position, title;',
      );
  return rows.map(mapTerms);
}

export async function getDefaultTerms(
  db: SQLite.SQLiteDatabase,
  docType: DocumentType,
): Promise<string> {
  const row = await db.getFirstAsync<TermsBlockRow>(
    `SELECT * FROM terms_blocks
      WHERE is_default = 1 AND (doc_type = ? OR doc_type = 'all')
      ORDER BY CASE doc_type WHEN 'all' THEN 1 ELSE 0 END, position LIMIT 1;`,
    docType,
  );
  return row?.body ?? '';
}

export async function saveTermsBlock(db: SQLite.SQLiteDatabase, block: TermsBlock): Promise<void> {
  await db.withTransactionAsync(async () => {
    if (block.isDefault) {
      await db.runAsync(
        'UPDATE terms_blocks SET is_default = 0 WHERE doc_type = ? AND id != ?;',
        block.docType,
        block.id,
      );
    }
    await db.runAsync(
      `INSERT INTO terms_blocks (id, title, body, doc_type, is_default, position)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, body = excluded.body, doc_type = excluded.doc_type,
         is_default = excluded.is_default, position = excluded.position;`,
      block.id,
      block.title,
      block.body,
      block.docType,
      fromBoolean(block.isDefault),
      block.position,
    );
  });
}

export async function deleteTermsBlock(db: SQLite.SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM terms_blocks WHERE id = ?;', id);
}

// ---------------------------------------------------------------------------
// Tax presets
// ---------------------------------------------------------------------------

export interface TaxPreset {
  id: string;
  label: string;
  rateBp: number;
  isDefault: boolean;
}

export async function listTaxPresets(db: SQLite.SQLiteDatabase): Promise<TaxPreset[]> {
  const rows = await db.getAllAsync<TaxPresetRow>('SELECT * FROM tax_presets ORDER BY rate_bp;');
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    rateBp: row.rate_bp,
    isDefault: toBoolean(row.is_default),
  }));
}

export async function saveTaxPreset(db: SQLite.SQLiteDatabase, preset: TaxPreset): Promise<void> {
  await db.withTransactionAsync(async () => {
    if (preset.isDefault) {
      await db.runAsync('UPDATE tax_presets SET is_default = 0 WHERE id != ?;', preset.id);
    }
    await db.runAsync(
      `INSERT INTO tax_presets (id, label, rate_bp, is_default) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label, rate_bp = excluded.rate_bp, is_default = excluded.is_default;`,
      preset.id,
      preset.label,
      preset.rateBp,
      fromBoolean(preset.isDefault),
    );
  });
}

export async function deleteTaxPreset(db: SQLite.SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM tax_presets WHERE id = ?;', id);
}

export async function getDefaultTaxRateBp(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<TaxPresetRow>(
    'SELECT * FROM tax_presets WHERE is_default = 1 LIMIT 1;',
  );
  return row?.rate_bp ?? 0;
}

// ---------------------------------------------------------------------------
// Custom field definitions (§7.5)
// ---------------------------------------------------------------------------

export interface CustomFieldDef {
  id: string;
  label: string;
  fieldType: CustomFieldType;
  appliesTo: CustomFieldScope;
  showOnDocument: boolean;
  position: number;
}

export async function listCustomFieldDefs(
  db: SQLite.SQLiteDatabase,
  appliesTo?: CustomFieldScope,
): Promise<CustomFieldDef[]> {
  const rows = appliesTo
    ? await db.getAllAsync<CustomFieldDefRow>(
        'SELECT * FROM custom_field_defs WHERE applies_to = ? ORDER BY position, label;',
        appliesTo,
      )
    : await db.getAllAsync<CustomFieldDefRow>(
        'SELECT * FROM custom_field_defs ORDER BY applies_to, position, label;',
      );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    fieldType: asCustomFieldType(row.field_type),
    appliesTo: asCustomFieldScope(row.applies_to),
    showOnDocument: toBoolean(row.show_on_document),
    position: row.position,
  }));
}

export async function saveCustomFieldDef(
  db: SQLite.SQLiteDatabase,
  def: CustomFieldDef,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO custom_field_defs (id, label, field_type, applies_to, show_on_document, position)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label, field_type = excluded.field_type,
       applies_to = excluded.applies_to, show_on_document = excluded.show_on_document,
       position = excluded.position;`,
    def.id,
    def.label,
    def.fieldType,
    def.appliesTo,
    fromBoolean(def.showOnDocument),
    def.position,
  );
}

export async function deleteCustomFieldDef(db: SQLite.SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM custom_field_defs WHERE id = ?;', id);
}

// ---------------------------------------------------------------------------
// Settings key/value
// ---------------------------------------------------------------------------

export async function getSetting(db: SQLite.SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?;',
    key,
  );
  return row?.value ?? null;
}

export async function setSetting(
  db: SQLite.SQLiteDatabase,
  key: string,
  value: string,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;',
    key,
    value,
  );
}

export async function getAllSettings(
  db: SQLite.SQLiteDatabase,
): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings;');
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

/** Well-known settings keys, so they are not scattered as string literals. */
export const SETTINGS_KEYS = {
  defaultExportFormat: 'export.defaultFormat',
  lastTemplate: 'export.lastTemplate',
  priceMode: 'editor.priceMode',
  theme: 'app.theme',
  onboardingComplete: 'app.onboardingComplete',
  defaultBlocks: 'document.defaultBlocks',
  quotationValidityDays: 'document.quotationValidityDays',
  invoiceDueDays: 'document.invoiceDueDays',
  dateStyle: 'document.dateStyle',
} as const;
