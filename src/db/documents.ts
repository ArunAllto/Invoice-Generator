/**
 * The documents repository — creation, persistence, numbering, conversions, payments.
 *
 * Two rules shape everything here:
 *
 *  1. **Totals are computed once and stored** (§5.4). Every save runs the document
 *     through `calculateDocument` and writes `subtotal`, `discount_total`, `tax_total`,
 *     `grand_total`, `round_off` and `amount_in_words` to the row. An already-issued
 *     document therefore keeps its numbers for ever, even if the calculation code
 *     changes — which is the point.
 *
 *  2. **Snapshots are taken at creation** (§5.4). The client and business details are
 *     copied into the document as JSON. Editing a client next month must not silently
 *     rewrite an invoice sent last month.
 */

import type * as SQLite from 'expo-sqlite';

import { calculateDocument, type CalcLineInput } from '../core/calc';
import { isoDateOnly, nowIsoWithOffset, todayIso } from '../core/dates';
import { enforceGstGate, inferTaxMode } from '../core/gst';
import { uuid } from '../core/ids';
import { amountInWords } from '../core/numberToWordsIndian';
import { allocateNextSeq, renderDocumentNumber } from '../core/numbering';
import { deriveStatus, type DerivedStatus } from '../core/status';
import {
  DEFAULT_BLOCKS,
  type CustomFieldValue,
  type DiscountMode,
  type DocumentBlocks,
  type DocumentStatus,
  type DocumentType,
  type Paise,
  type PaymentMethod,
  type PriceSource,
  type TaxMode,
  type TemplateId,
} from '../core/types';
import {
  getBusinessProfile,
  getClient,
  getDefaultSeries,
  getDefaultTerms,
  getSeries,
  getSetting,
  incrementCatalogueUsage,
  readAllocationFacts,
  SETTINGS_KEYS,
  type BusinessProfile,
  type Client,
} from './masters';
import {
  asDiscountMode,
  asDocumentStatus,
  asDocumentType,
  asPaymentMethod,
  asPriceSource,
  asTaxMode,
  asTemplateId,
  fromBoolean,
  parseBlocks,
  parseCustomFields,
  parseJson,
  toBoolean,
  type DocumentRow,
  type LineItemRow,
  type PaymentRow,
} from './rows';

// ---------------------------------------------------------------------------
// App-level shapes
// ---------------------------------------------------------------------------

export interface LineItem {
  id: string;
  documentId: string;
  position: number;
  catalogueItemId: string | null;
  priceSource: PriceSource;
  name: string;
  description: string;
  hsnSac: string;
  qtyMilli: number;
  unit: string;
  rate: Paise;
  taxRateBp: number;
  discountBp: number;
  isFree: boolean;
  lineTotal: Paise;
}

/** A frozen copy of the parties, stored on the document (§5.4). */
export interface PartySnapshot {
  name: string;
  company?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  website?: string;
  gstin?: string | null;
  pan?: string | null;
  tagline?: string;
  logoUri?: string | null;
  signatureUri?: string | null;
  signatureLabel?: string;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNo?: string | null;
  bankIfsc?: string | null;
  upiId?: string | null;
  customFields?: CustomFieldValue[];
}

export interface DocumentRecord {
  id: string;
  type: DocumentType;
  number: string;
  seriesId: string | null;
  seq: number | null;
  status: DocumentStatus;
  clientId: string | null;
  clientSnapshot: PartySnapshot | null;
  businessSnapshot: PartySnapshot;
  issueDate: string;
  validUntil: string | null;
  dueDate: string | null;
  currency: string;
  discountMode: DiscountMode;
  discountValue: number;
  taxMode: TaxMode;
  flatTaxRateBp: number;
  shippingAmount: Paise;
  roundOffEnabled: boolean;
  roundOff: Paise;
  subtotal: Paise;
  discountTotal: Paise;
  taxTotal: Paise;
  grandTotal: Paise;
  amountInWords: string;
  notes: string;
  terms: string;
  templateId: TemplateId;
  accentColor: string | null;
  blocks: DocumentBlocks;
  linkedDocumentId: string | null;
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;
  paymentAmount: Paise | null;
  customFields: CustomFieldValue[];
  numberWarning: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: Paise;
  paidOn: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
  receiptDocumentId: string | null;
  createdAt: string;
}

/** A document with everything needed to render or edit it. */
export interface FullDocument {
  document: DocumentRecord;
  lines: LineItem[];
  payments: Payment[];
  derived: DerivedStatus;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapDocument(row: DocumentRow): DocumentRecord {
  const clientSnapshot = parseJson<PartySnapshot | null>(row.client_snapshot, null);
  return {
    id: row.id,
    type: asDocumentType(row.type),
    number: row.number,
    seriesId: row.series_id,
    seq: row.seq,
    status: asDocumentStatus(row.status),
    clientId: row.client_id,
    clientSnapshot: clientSnapshot && clientSnapshot.name !== undefined ? clientSnapshot : null,
    businessSnapshot: parseJson<PartySnapshot>(row.business_snapshot, { name: '' }),
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    dueDate: row.due_date,
    currency: row.currency,
    discountMode: asDiscountMode(row.discount_mode),
    discountValue: row.discount_value,
    taxMode: asTaxMode(row.tax_mode),
    flatTaxRateBp: row.flat_tax_rate_bp ?? 0,
    shippingAmount: row.shipping_amount,
    roundOffEnabled: toBoolean(row.round_off_enabled),
    roundOff: row.round_off,
    subtotal: row.subtotal,
    discountTotal: row.discount_total,
    taxTotal: row.tax_total,
    grandTotal: row.grand_total,
    amountInWords: row.amount_in_words,
    notes: row.notes,
    terms: row.terms,
    templateId: asTemplateId(row.template_id),
    accentColor: row.accent_color,
    blocks: parseBlocks(row.blocks),
    linkedDocumentId: row.linked_document_id,
    paymentMethod: row.payment_method ? asPaymentMethod(row.payment_method) : null,
    paymentReference: row.payment_reference,
    paymentAmount: row.payment_amount,
    customFields: parseCustomFields(row.custom_fields),
    numberWarning: toBoolean(row.number_warning),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLineItem(row: LineItemRow): LineItem {
  return {
    id: row.id,
    documentId: row.document_id,
    position: row.position,
    catalogueItemId: row.catalogue_item_id,
    priceSource: asPriceSource(row.price_source),
    name: row.name,
    description: row.description,
    hsnSac: row.hsn_sac,
    qtyMilli: row.qty_milli,
    unit: row.unit,
    rate: row.rate,
    taxRateBp: row.tax_rate_bp,
    discountBp: row.discount_bp,
    isFree: toBoolean(row.is_free),
    lineTotal: row.line_total,
  };
}

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    amount: row.amount,
    paidOn: row.paid_on,
    method: asPaymentMethod(row.method),
    reference: row.reference,
    notes: row.notes,
    receiptDocumentId: row.receipt_document_id,
    createdAt: row.created_at,
  };
}

export function businessToSnapshot(profile: BusinessProfile): PartySnapshot {
  return {
    name: profile.name,
    tagline: profile.tagline,
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2,
    city: profile.city,
    state: profile.state,
    pincode: profile.pincode,
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    gstin: profile.gstin,
    pan: profile.pan,
    logoUri: profile.logoUri,
    signatureUri: profile.signatureUri,
    signatureLabel: profile.signatureLabel,
    bankName: profile.bankName,
    bankAccountName: profile.bankAccountName,
    bankAccountNo: profile.bankAccountNo,
    bankIfsc: profile.bankIfsc,
    upiId: profile.upiId,
    customFields: profile.customFields,
  };
}

export function clientToSnapshot(client: Client): PartySnapshot {
  return {
    name: client.name,
    company: client.company,
    addressLine1: client.addressLine1,
    addressLine2: client.addressLine2,
    city: client.city,
    state: client.state,
    pincode: client.pincode,
    phone: client.phone,
    email: client.email,
    gstin: client.gstin,
    customFields: client.customFields,
  };
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

function toCalcInput(document: DocumentRecord, lines: readonly LineItem[]) {
  const calcLines: CalcLineInput[] = lines.map((line) => ({
    qtyMilli: line.qtyMilli,
    rate: line.rate,
    taxRateBp: line.taxRateBp,
    discountBp: line.discountBp,
    isFree: line.isFree,
    hsnSac: line.hsnSac,
  }));
  return {
    lines: calcLines,
    discountMode: document.discountMode,
    discountValue: document.discountValue,
    // The GST gate is re-applied on every save so that removing the business GSTIN
    // cannot leave a stale tax mode quietly adding tax to new drafts (§9.4).
    taxMode: enforceGstGate(document.taxMode, document.businessSnapshot.gstin),
    flatTaxRateBp: document.flatTaxRateBp,
    shippingAmount: document.shippingAmount,
    roundOffEnabled: document.roundOffEnabled,
  };
}

/** Recompute totals for a document in memory, without touching the database. */
export function recalculate(
  document: DocumentRecord,
  lines: readonly LineItem[],
): { document: DocumentRecord; lines: LineItem[] } {
  const result = calculateDocument(toCalcInput(document, lines));
  const updatedLines = lines.map((line, index) => ({
    ...line,
    position: index,
    lineTotal: result.lines[index]?.lineTotal ?? 0,
  }));

  return {
    document: {
      ...document,
      subtotal: result.subtotal,
      discountTotal: result.discountTotal,
      taxTotal: result.taxTotal,
      grandTotal: result.grandTotal,
      roundOff: result.roundOff,
      amountInWords: amountInWords(result.grandTotal),
    },
    lines: updatedLines,
  };
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateDocumentOptions {
  type: DocumentType;
  clientId?: string | null;
  issueDate?: string;
}

/**
 * Create a draft and return it (§6.1).
 *
 * Deliberately does **not** allocate a number: §8.3 reserves nothing for drafts, so an
 * abandoned draft leaves no gap in the owner's numbering. The series is recorded so the
 * editor can show a "next: …" preview.
 */
export async function createDocument(
  db: SQLite.SQLiteDatabase,
  options: CreateDocumentOptions,
): Promise<FullDocument> {
  const { type } = options;
  const issueDate = options.issueDate ?? todayIso();
  const now = nowIsoWithOffset();

  const business = await getBusinessProfile(db);
  const series = await getDefaultSeries(db, type);
  const terms = await getDefaultTerms(db, type);
  const client = options.clientId ? await getClient(db, options.clientId) : null;

  const validityDays = Number((await getSetting(db, SETTINGS_KEYS.quotationValidityDays)) ?? '15');
  const dueDays = Number((await getSetting(db, SETTINGS_KEYS.invoiceDueDays)) ?? '15');
  const storedBlocks = await getSetting(db, SETTINGS_KEYS.defaultBlocks);

  const taxInference = inferTaxMode({
    businessGstin: business.gstin,
    clientGstin: client?.gstin ?? null,
    businessState: business.state,
    clientState: client?.state ?? null,
  });

  const document: DocumentRecord = {
    id: uuid(),
    type,
    number: '',
    seriesId: series?.id ?? null,
    seq: null,
    status: 'draft',
    clientId: client?.id ?? null,
    clientSnapshot: client ? clientToSnapshot(client) : null,
    businessSnapshot: businessToSnapshot(business),
    issueDate,
    validUntil: type === 'quotation' ? addDays(issueDate, validityDays) : null,
    dueDate: type === 'invoice' ? addDays(issueDate, dueDays) : null,
    currency: business.defaultCurrency,
    discountMode: 'none',
    discountValue: 0,
    taxMode: taxInference.mode,
    flatTaxRateBp: 0,
    shippingAmount: 0,
    roundOffEnabled: true,
    roundOff: 0,
    subtotal: 0,
    discountTotal: 0,
    taxTotal: 0,
    grandTotal: 0,
    amountInWords: amountInWords(0),
    notes: '',
    terms,
    templateId: business.defaultTemplateId,
    accentColor: business.accentColor,
    blocks: { ...DEFAULT_BLOCKS, ...parseBlocks(storedBlocks) },
    linkedDocumentId: null,
    paymentMethod: type === 'receipt' ? 'cash' : null,
    paymentReference: null,
    paymentAmount: null,
    customFields: [],
    numberWarning: false,
    createdAt: now,
    updatedAt: now,
  };

  await insertDocumentRow(db, document);
  return {
    document,
    lines: [],
    payments: [],
    derived: deriveStatus({ type, storedStatus: 'draft', today: todayIso() }),
  };
}

function addDays(iso: string, days: number): string {
  if (!Number.isFinite(days)) return iso;
  const base = isoDateOnly(iso);
  const [y, m, d] = base.split('-').map(Number);
  const utc = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1));
  utc.setUTCDate(utc.getUTCDate() + Math.trunc(days));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(
    utc.getUTCDate(),
  ).padStart(2, '0')}`;
}

async function insertDocumentRow(
  db: SQLite.SQLiteDatabase,
  document: DocumentRecord,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO documents (
       id, type, number, series_id, seq, status, client_id, client_snapshot, business_snapshot,
       issue_date, valid_until, due_date, currency, discount_mode, discount_value, tax_mode,
       flat_tax_rate_bp, shipping_amount, round_off_enabled, round_off, subtotal, discount_total,
       tax_total, grand_total, amount_in_words, notes, terms, template_id, accent_color, blocks,
       linked_document_id, payment_method, payment_reference, payment_amount, custom_fields,
       number_warning, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    ...documentParams(document),
  );
}

function documentParams(document: DocumentRecord): Array<string | number | null> {
  return [
    document.id,
    document.type,
    document.number,
    document.seriesId,
    document.seq,
    document.status,
    document.clientId,
    JSON.stringify(document.clientSnapshot ?? null),
    JSON.stringify(document.businessSnapshot),
    document.issueDate,
    document.validUntil,
    document.dueDate,
    document.currency,
    document.discountMode,
    document.discountValue,
    document.taxMode,
    document.flatTaxRateBp,
    document.shippingAmount,
    fromBoolean(document.roundOffEnabled),
    document.roundOff,
    document.subtotal,
    document.discountTotal,
    document.taxTotal,
    document.grandTotal,
    document.amountInWords,
    document.notes,
    document.terms,
    document.templateId,
    document.accentColor,
    JSON.stringify(document.blocks),
    document.linkedDocumentId,
    document.paymentMethod,
    document.paymentReference,
    document.paymentAmount,
    JSON.stringify(document.customFields),
    fromBoolean(document.numberWarning),
    document.createdAt,
    document.updatedAt,
  ];
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getDocument(
  db: SQLite.SQLiteDatabase,
  id: string,
): Promise<FullDocument | null> {
  const row = await db.getFirstAsync<DocumentRow>('SELECT * FROM documents WHERE id = ?;', id);
  if (!row) return null;

  const document = mapDocument(row);
  const lineRows = await db.getAllAsync<LineItemRow>(
    'SELECT * FROM line_items WHERE document_id = ? ORDER BY position;',
    id,
  );
  const paymentRows =
    document.type === 'invoice'
      ? await db.getAllAsync<PaymentRow>(
          'SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on, created_at;',
          id,
        )
      : [];

  const payments = paymentRows.map(mapPayment);
  return {
    document,
    lines: lineRows.map(mapLineItem),
    payments,
    derived: deriveStatus({
      type: document.type,
      storedStatus: document.status,
      today: todayIso(),
      validUntil: document.validUntil,
      dueDate: document.dueDate,
      grandTotal: document.grandTotal,
      payments: payments.map((p) => p.amount),
    }),
  };
}

export interface DocumentListItem {
  id: string;
  type: DocumentType;
  number: string;
  status: DocumentStatus;
  derivedStatus: DocumentStatus;
  clientName: string;
  issueDate: string;
  grandTotal: Paise;
  balance: Paise;
  numberWarning: boolean;
  updatedAt: string;
}

export interface ListDocumentsOptions {
  /** Restrict to specific ids. Resolves conversion links without a full scan. */
  ids?: readonly string[];
  types?: readonly DocumentType[];
  statuses?: readonly DocumentStatus[];
  search?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: 'date' | 'amount' | 'number';
  sortDirection?: 'asc' | 'desc';
  limit?: number;
}

/**
 * The documents list of §6.6.
 *
 * Status filtering happens after the query rather than in SQL, because `overdue`,
 * `paid` and `partially_paid` are derived from the payments table and the clock (§6.4) —
 * they are not what is stored in the `status` column, and filtering on the stored value
 * would hide exactly the invoices the owner is looking for.
 */
export async function listDocuments(
  db: SQLite.SQLiteDatabase,
  options: ListDocumentsOptions = {},
): Promise<DocumentListItem[]> {
  const {
    ids,
    types,
    statuses,
    search = '',
    fromDate,
    toDate,
    sortBy = 'date',
    sortDirection = 'desc',
    limit,
  } = options;

  const where: string[] = [];
  const params: Array<string | number> = [];

  if (ids) {
    if (ids.length === 0) return [];
    where.push(`d.id IN (${ids.map(() => '?').join(', ')})`);
    params.push(...ids);
  }
  if (types && types.length > 0) {
    where.push(`d.type IN (${types.map(() => '?').join(', ')})`);
    params.push(...types);
  }
  if (fromDate) {
    where.push('substr(d.issue_date, 1, 10) >= ?');
    params.push(isoDateOnly(fromDate));
  }
  if (toDate) {
    where.push('substr(d.issue_date, 1, 10) <= ?');
    params.push(isoDateOnly(toDate));
  }

  const term = search.trim();
  if (term.length > 0) {
    // §6.6: search across number, client name, and item names.
    where.push(`(
      d.number LIKE ? COLLATE NOCASE
      OR COALESCE(c.name, '') LIKE ? COLLATE NOCASE
      OR COALESCE(c.company, '') LIKE ? COLLATE NOCASE
      OR d.client_snapshot LIKE ? COLLATE NOCASE
      OR EXISTS (
        SELECT 1 FROM line_items li
         WHERE li.document_id = d.id AND li.name LIKE ? COLLATE NOCASE
      )
    )`);
    const like = `%${term}%`;
    params.push(like, like, like, like, like);
  }

  const orderColumn =
    sortBy === 'amount' ? 'd.grand_total' : sortBy === 'number' ? 'd.number' : 'substr(d.issue_date, 1, 10)';
  const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';

  const rows = await db.getAllAsync<
    DocumentRow & { client_name: string | null; client_company: string | null; paid_total: number | null }
  >(
    `SELECT d.*, c.name AS client_name, c.company AS client_company,
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.invoice_id = d.id) AS paid_total
       FROM documents d
       LEFT JOIN clients c ON c.id = d.client_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderColumn} ${direction}, d.created_at ${direction}
      ${limit ? `LIMIT ${Math.trunc(limit)}` : ''};`,
    ...params,
  );

  const today = todayIso();
  const items = rows.map((row) => {
    const document = mapDocument(row);
    const paid = row.paid_total ?? 0;
    const derived = deriveStatus({
      type: document.type,
      storedStatus: document.status,
      today,
      validUntil: document.validUntil,
      dueDate: document.dueDate,
      grandTotal: document.grandTotal,
      payments: paid > 0 ? [paid] : [],
    });

    const snapshotName = document.clientSnapshot?.company || document.clientSnapshot?.name || '';
    return {
      id: document.id,
      type: document.type,
      number: document.number,
      status: document.status,
      derivedStatus: derived.status,
      clientName: row.client_company || row.client_name || snapshotName,
      issueDate: document.issueDate,
      grandTotal: document.grandTotal,
      balance: derived.balance,
      numberWarning: document.numberWarning,
      updatedAt: document.updatedAt,
    } satisfies DocumentListItem;
  });

  if (!statuses || statuses.length === 0) return items;
  const wanted = new Set(statuses);
  return items.filter((item) => wanted.has(item.derivedStatus));
}

/** Numbers already used by documents of this type, for the §8.4 duplicate warning. */
export async function listUsedNumbers(
  db: SQLite.SQLiteDatabase,
  type: DocumentType,
  excludeId?: string,
): Promise<Array<{ id: string; number: string }>> {
  const rows = await db.getAllAsync<{ id: string; number: string }>(
    `SELECT id, number FROM documents WHERE type = ? AND number != '' ${
      excludeId ? 'AND id != ?' : ''
    };`,
    ...(excludeId ? [type, excludeId] : [type]),
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/**
 * Persist a document and its lines, recomputing totals first.
 *
 * The whole write is one transaction, so the autosave in §6.3 cannot leave a document
 * whose stored total disagrees with its stored lines even if the app is killed mid-save.
 * Lines are replaced wholesale rather than diffed: a handful of rows per document makes
 * delete-and-reinsert both simpler and faster than working out a minimal patch, and it
 * removes any chance of a stale row surviving a reorder.
 */
export async function saveDocument(
  db: SQLite.SQLiteDatabase,
  input: { document: DocumentRecord; lines: readonly LineItem[] },
): Promise<{ document: DocumentRecord; lines: LineItem[] }> {
  const recalculated = recalculate(input.document, input.lines);
  const document = { ...recalculated.document, updatedAt: nowIsoWithOffset() };
  const lines = recalculated.lines;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE documents SET
         type = ?, number = ?, series_id = ?, seq = ?, status = ?, client_id = ?,
         client_snapshot = ?, business_snapshot = ?, issue_date = ?, valid_until = ?, due_date = ?,
         currency = ?, discount_mode = ?, discount_value = ?, tax_mode = ?, flat_tax_rate_bp = ?,
         shipping_amount = ?, round_off_enabled = ?, round_off = ?, subtotal = ?,
         discount_total = ?, tax_total = ?, grand_total = ?, amount_in_words = ?, notes = ?,
         terms = ?, template_id = ?, accent_color = ?, blocks = ?, linked_document_id = ?,
         payment_method = ?, payment_reference = ?, payment_amount = ?, custom_fields = ?,
         number_warning = ?, updated_at = ?
       WHERE id = ?;`,
      document.type,
      document.number,
      document.seriesId,
      document.seq,
      document.status,
      document.clientId,
      JSON.stringify(document.clientSnapshot ?? null),
      JSON.stringify(document.businessSnapshot),
      document.issueDate,
      document.validUntil,
      document.dueDate,
      document.currency,
      document.discountMode,
      document.discountValue,
      document.taxMode,
      document.flatTaxRateBp,
      document.shippingAmount,
      fromBoolean(document.roundOffEnabled),
      document.roundOff,
      document.subtotal,
      document.discountTotal,
      document.taxTotal,
      document.grandTotal,
      document.amountInWords,
      document.notes,
      document.terms,
      document.templateId,
      document.accentColor,
      JSON.stringify(document.blocks),
      document.linkedDocumentId,
      document.paymentMethod,
      document.paymentReference,
      document.paymentAmount,
      JSON.stringify(document.customFields),
      fromBoolean(document.numberWarning),
      document.updatedAt,
      document.id,
    );

    await db.runAsync('DELETE FROM line_items WHERE document_id = ?;', document.id);
    for (const line of lines) {
      await db.runAsync(
        `INSERT INTO line_items (
           id, document_id, position, catalogue_item_id, price_source, name, description,
           hsn_sac, qty_milli, unit, rate, tax_rate_bp, discount_bp, is_free, line_total
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        line.id,
        document.id,
        line.position,
        line.catalogueItemId,
        line.priceSource,
        line.name,
        line.description,
        line.hsnSac,
        line.qtyMilli,
        line.unit,
        line.rate,
        line.taxRateBp,
        line.discountBp,
        fromBoolean(line.isFree),
        line.lineTotal,
      );
    }
  });

  return { document, lines };
}

export async function setDocumentStatus(
  db: SQLite.SQLiteDatabase,
  id: string,
  status: DocumentStatus,
): Promise<void> {
  await db.runAsync(
    'UPDATE documents SET status = ?, updated_at = ? WHERE id = ?;',
    status,
    nowIsoWithOffset(),
    id,
  );
}

export async function deleteDocument(db: SQLite.SQLiteDatabase, id: string): Promise<void> {
  // line_items and payments cascade.
  await db.runAsync('DELETE FROM documents WHERE id = ?;', id);
}

// ---------------------------------------------------------------------------
// Number allocation (§8.3)
// ---------------------------------------------------------------------------

/**
 * Allocate a number if the document does not have one yet.
 *
 * Called when a document leaves `draft` or is exported, whichever happens first. The read
 * of the highest used sequence and the write of the new number happen in one transaction,
 * so two rapid exports cannot both take the same number.
 *
 * Returns the number the document now holds.
 */
export async function ensureDocumentNumber(
  db: SQLite.SQLiteDatabase,
  id: string,
): Promise<string> {
  const existing = await db.getFirstAsync<DocumentRow>('SELECT * FROM documents WHERE id = ?;', id);
  if (!existing) throw new Error(`Document ${id} not found`);
  if (existing.number.trim().length > 0) return existing.number;

  const document = mapDocument(existing);
  const series =
    (document.seriesId
      ? await db.getFirstAsync<{ id: string }>('SELECT id FROM numbering_series WHERE id = ?;', document.seriesId)
      : null) ?? null;

  const seriesRecord = series
    ? await getSeries(db, series.id)
    : await getDefaultSeries(db, document.type);

  if (!seriesRecord) {
    // No series configured at all: fall back to a bare sequence so the user is never
    // blocked from exporting.
    const fallback = `${document.type.toUpperCase().slice(0, 3)}-${Date.now()}`;
    await db.runAsync('UPDATE documents SET number = ? WHERE id = ?;', fallback, id);
    return fallback;
  }

  let allocated = '';
  await db.withTransactionAsync(async () => {
    const facts = await readAllocationFacts(db, seriesRecord, document.issueDate);
    const seq = allocateNextSeq(facts);
    allocated = renderDocumentNumber(seriesRecord, seq, document.issueDate);

    await db.runAsync(
      'UPDATE documents SET number = ?, seq = ?, series_id = ?, updated_at = ? WHERE id = ?;',
      allocated,
      seq,
      seriesRecord.id,
      nowIsoWithOffset(),
      id,
    );
    await db.runAsync('UPDATE numbering_series SET next_seq = ? WHERE id = ?;', seq + 1, seriesRecord.id);
  });

  return allocated;
}

/** §8.4: the user may type any number; a duplicate is warned about, never blocked. */
export async function setDocumentNumberManually(
  db: SQLite.SQLiteDatabase,
  id: string,
  numberText: string,
  isDuplicate: boolean,
): Promise<void> {
  await db.runAsync(
    'UPDATE documents SET number = ?, number_warning = ?, updated_at = ? WHERE id = ?;',
    numberText,
    fromBoolean(isDuplicate),
    nowIsoWithOffset(),
    id,
  );
}

// ---------------------------------------------------------------------------
// Payments (§5.6)
// ---------------------------------------------------------------------------

export async function addPayment(
  db: SQLite.SQLiteDatabase,
  payment: Omit<Payment, 'id' | 'createdAt'> & { id?: string },
): Promise<Payment> {
  const record: Payment = {
    id: payment.id ?? uuid(),
    invoiceId: payment.invoiceId,
    amount: payment.amount,
    paidOn: payment.paidOn,
    method: payment.method,
    reference: payment.reference,
    notes: payment.notes,
    receiptDocumentId: payment.receiptDocumentId,
    createdAt: nowIsoWithOffset(),
  };

  await db.runAsync(
    `INSERT INTO payments (id, invoice_id, amount, paid_on, method, reference, notes, receipt_document_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    record.id,
    record.invoiceId,
    record.amount,
    record.paidOn,
    record.method,
    record.reference,
    record.notes,
    record.receiptDocumentId,
    record.createdAt,
  );
  return record;
}

export async function listPayments(
  db: SQLite.SQLiteDatabase,
  invoiceId: string,
): Promise<Payment[]> {
  const rows = await db.getAllAsync<PaymentRow>(
    'SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on, created_at;',
    invoiceId,
  );
  return rows.map(mapPayment);
}

export async function deletePayment(db: SQLite.SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM payments WHERE id = ?;', id);
}

// ---------------------------------------------------------------------------
// Conversions (§6.5)
// ---------------------------------------------------------------------------

/**
 * Quotation → Invoice.
 *
 * Copies lines, client, charges and notes; links back to the quotation; marks the
 * quotation accepted. The quotation itself is left otherwise untouched and viewable, as
 * §6.5 requires — this is a new document, not a mutation of the old one.
 */
export async function convertQuotationToInvoice(
  db: SQLite.SQLiteDatabase,
  quotationId: string,
): Promise<FullDocument> {
  const source = await getDocument(db, quotationId);
  if (!source) throw new Error(`Quotation ${quotationId} not found`);
  if (source.document.type !== 'quotation') {
    throw new Error('convertQuotationToInvoice expects a quotation');
  }

  const created = await createDocument(db, {
    type: 'invoice',
    clientId: source.document.clientId,
  });

  const document: DocumentRecord = {
    ...created.document,
    clientId: source.document.clientId,
    clientSnapshot: source.document.clientSnapshot,
    discountMode: source.document.discountMode,
    discountValue: source.document.discountValue,
    taxMode: source.document.taxMode,
    flatTaxRateBp: source.document.flatTaxRateBp,
    shippingAmount: source.document.shippingAmount,
    roundOffEnabled: source.document.roundOffEnabled,
    notes: source.document.notes,
    currency: source.document.currency,
    templateId: source.document.templateId,
    accentColor: source.document.accentColor,
    blocks: source.document.blocks,
    customFields: source.document.customFields,
    linkedDocumentId: source.document.id,
  };

  const lines: LineItem[] = source.lines.map((line, index) => ({
    ...line,
    id: uuid(),
    documentId: document.id,
    position: index,
  }));

  const saved = await saveDocument(db, { document, lines });

  await db.withTransactionAsync(async () => {
    // Link both ways so §6.5's "Converted from…/Converted to…" works from either end.
    await db.runAsync(
      'UPDATE documents SET status = ?, linked_document_id = ?, updated_at = ? WHERE id = ?;',
      'accepted',
      document.id,
      nowIsoWithOffset(),
      source.document.id,
    );
  });

  return {
    document: saved.document,
    lines: saved.lines,
    payments: [],
    derived: deriveStatus({
      type: 'invoice',
      storedStatus: saved.document.status,
      today: todayIso(),
      dueDate: saved.document.dueDate,
      grandTotal: saved.document.grandTotal,
      payments: [],
    }),
  };
}

export interface ReceiptFromInvoiceOptions {
  amount: Paise;
  method: PaymentMethod;
  reference: string;
  paidOn: string;
  notes?: string;
}

/**
 * Invoice → Receipt (§6.5).
 *
 * Writes a `payments` row, then creates a receipt whose single line summarises the
 * payment, and links the three records together. The payment and the receipt are created
 * in one transaction, because a payment recorded without its receipt — or a receipt with
 * no payment behind it — would misstate the balance.
 */
export async function createReceiptForInvoice(
  db: SQLite.SQLiteDatabase,
  invoiceId: string,
  options: ReceiptFromInvoiceOptions,
): Promise<FullDocument> {
  const source = await getDocument(db, invoiceId);
  if (!source) throw new Error(`Invoice ${invoiceId} not found`);
  if (source.document.type !== 'invoice') {
    throw new Error('createReceiptForInvoice expects an invoice');
  }

  const created = await createDocument(db, {
    type: 'receipt',
    clientId: source.document.clientId,
    issueDate: options.paidOn,
  });

  const document: DocumentRecord = {
    ...created.document,
    clientId: source.document.clientId,
    clientSnapshot: source.document.clientSnapshot,
    currency: source.document.currency,
    templateId: source.document.templateId,
    accentColor: source.document.accentColor,
    // A receipt acknowledges money received; it does not re-levy tax or discounts.
    taxMode: 'none',
    discountMode: 'none',
    discountValue: 0,
    shippingAmount: 0,
    roundOffEnabled: false,
    paymentMethod: options.method,
    paymentReference: options.reference,
    paymentAmount: options.amount,
    linkedDocumentId: source.document.id,
    notes: options.notes ?? '',
    blocks: { ...source.document.blocks, taxColumns: false, taxSummary: false, upiQr: false },
  };

  const line: LineItem = {
    id: uuid(),
    documentId: document.id,
    position: 0,
    catalogueItemId: null,
    priceSource: 'custom',
    name: `Payment received against Invoice ${source.document.number || '(unnumbered)'}`,
    description: describePayment(options),
    hsnSac: '',
    qtyMilli: 1000,
    unit: 'nos',
    rate: options.amount,
    taxRateBp: 0,
    discountBp: 0,
    isFree: false,
    lineTotal: options.amount,
  };

  const saved = await saveDocument(db, { document, lines: [line] });

  await db.withTransactionAsync(async () => {
    const payment = await addPayment(db, {
      invoiceId: source.document.id,
      amount: options.amount,
      paidOn: options.paidOn,
      method: options.method,
      reference: options.reference,
      notes: options.notes ?? '',
      receiptDocumentId: saved.document.id,
    });
    void payment;
    await db.runAsync('UPDATE documents SET status = ? WHERE id = ? AND status = ?;', 'sent', source.document.id, 'draft');
  });

  return {
    document: saved.document,
    lines: saved.lines,
    payments: [],
    derived: deriveStatus({ type: 'receipt', storedStatus: saved.document.status, today: todayIso() }),
  };
}

function describePayment(options: ReceiptFromInvoiceOptions): string {
  const methodLabels: Record<PaymentMethod, string> = {
    cash: 'Cash',
    upi: 'UPI',
    bank_transfer: 'Bank transfer',
    cheque: 'Cheque',
    card: 'Card',
    other: 'Other',
  };
  const parts = [`Received by ${methodLabels[options.method]}`];
  if (options.reference.trim().length > 0) parts.push(`Ref: ${options.reference.trim()}`);
  return parts.join(' · ');
}

/** §6.5: any document → a fresh draft of the same type, new number, today's date. */
export async function duplicateDocument(
  db: SQLite.SQLiteDatabase,
  id: string,
): Promise<FullDocument> {
  const source = await getDocument(db, id);
  if (!source) throw new Error(`Document ${id} not found`);

  const created = await createDocument(db, {
    type: source.document.type,
    clientId: source.document.clientId,
  });

  const document: DocumentRecord = {
    ...source.document,
    id: created.document.id,
    number: '',
    seq: null,
    seriesId: created.document.seriesId,
    status: 'draft',
    issueDate: created.document.issueDate,
    validUntil: created.document.validUntil,
    dueDate: created.document.dueDate,
    // A duplicate is a new document, not a continuation of the original's chain.
    linkedDocumentId: null,
    numberWarning: false,
    createdAt: created.document.createdAt,
    updatedAt: created.document.updatedAt,
  };

  const lines: LineItem[] = source.lines.map((line, index) => ({
    ...line,
    id: uuid(),
    documentId: document.id,
    position: index,
  }));

  const saved = await saveDocument(db, { document, lines });
  return {
    document: saved.document,
    lines: saved.lines,
    payments: [],
    derived: deriveStatus({ type: saved.document.type, storedStatus: 'draft', today: todayIso() }),
  };
}

/** The other end of a conversion link, for the "Converted from/to" row (§6.5). */
export async function getLinkedDocuments(
  db: SQLite.SQLiteDatabase,
  id: string,
): Promise<{ from: DocumentListItem | null; to: DocumentListItem[] }> {
  const row = await db.getFirstAsync<DocumentRow>(
    'SELECT * FROM documents WHERE id = ?;',
    id,
  );
  if (!row) return { from: null, to: [] };

  const linkedId = row.linked_document_id;
  const from = linkedId ? await getListItem(db, linkedId) : null;
  const children = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM documents WHERE linked_document_id = ?;',
    id,
  );
  const to = await listDocuments(db, { ids: children.map((child) => child.id) });
  return { from, to };
}

async function getListItem(
  db: SQLite.SQLiteDatabase,
  id: string,
): Promise<DocumentListItem | null> {
  const items = await listDocuments(db, { ids: [id] });
  return items[0] ?? null;
}

// ---------------------------------------------------------------------------
// Line item helpers (§7.3)
// ---------------------------------------------------------------------------

export function emptyLineItem(documentId: string, position: number, taxRateBp = 0): LineItem {
  return {
    id: uuid(),
    documentId,
    position,
    catalogueItemId: null,
    priceSource: 'custom',
    name: '',
    description: '',
    hsnSac: '',
    qtyMilli: 1000,
    unit: 'nos',
    rate: 0,
    taxRateBp,
    discountBp: 0,
    isFree: false,
    lineTotal: 0,
  };
}

/** Build a line from a catalogue item: everything pre-filled, `price_source = 'auto'`. */
export function lineFromCatalogueItem(
  documentId: string,
  position: number,
  item: {
    id: string;
    name: string;
    description: string;
    defaultRate: number;
    unit: string;
    hsnSac: string | null;
    taxRateBp: number;
  },
): LineItem {
  return {
    id: uuid(),
    documentId,
    position,
    catalogueItemId: item.id,
    priceSource: 'auto',
    name: item.name,
    description: item.description,
    hsnSac: item.hsnSac ?? '',
    qtyMilli: 1000,
    unit: item.unit,
    rate: item.defaultRate,
    taxRateBp: item.taxRateBp,
    discountBp: 0,
    isFree: false,
    lineTotal: item.defaultRate,
  };
}

export async function recordCatalogueUsage(
  db: SQLite.SQLiteDatabase,
  lines: readonly LineItem[],
): Promise<void> {
  const ids = lines
    .map((line) => line.catalogueItemId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  await incrementCatalogueUsage(db, [...new Set(ids)]);
}

// ---------------------------------------------------------------------------
// Dashboard summary (§4.1)
// ---------------------------------------------------------------------------

export interface DashboardSummary {
  quotationsPending: number;
  invoicesUnpaid: number;
  totalOutstanding: Paise;
  recent: DocumentListItem[];
}

export async function getDashboardSummary(
  db: SQLite.SQLiteDatabase,
): Promise<DashboardSummary> {
  const all = await listDocuments(db, { sortBy: 'date', sortDirection: 'desc' });

  let quotationsPending = 0;
  let invoicesUnpaid = 0;
  let totalOutstanding = 0;

  for (const item of all) {
    if (item.type === 'quotation' && (item.derivedStatus === 'draft' || item.derivedStatus === 'sent')) {
      quotationsPending += 1;
    }
    if (
      item.type === 'invoice' &&
      (item.derivedStatus === 'sent' ||
        item.derivedStatus === 'partially_paid' ||
        item.derivedStatus === 'overdue')
    ) {
      invoicesUnpaid += 1;
      // Only positive balances are "outstanding" — an overpaid invoice does not reduce
      // what other clients owe.
      if (item.balance > 0) totalOutstanding += item.balance;
    }
  }

  return {
    quotationsPending,
    invoicesUnpaid,
    totalOutstanding,
    recent: all.slice(0, 5),
  };
}
