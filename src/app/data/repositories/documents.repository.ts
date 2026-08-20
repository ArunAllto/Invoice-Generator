/**
 * The documents repository — creation, persistence, numbering, listing, dashboard summary.
 *
 * Two rules carried over from the React Native tree shape everything here:
 *
 *  1. **Totals are computed once and stored** (§5.4). Every save runs the document through the
 *     pure `calculateDocument` and writes the results to the row, so an issued document keeps
 *     its numbers for ever even if the calculation code later changes.
 *  2. **Snapshots are taken at creation** (§5.4). Client and business details are copied into
 *     the document as JSON. Editing a client next month must not rewrite an invoice sent last
 *     month.
 *
 * Derived statuses are never stored (§6.4) — `deriveStatus` runs on every read, because an
 * invoice marked "paid" last week may be overdue today.
 */

import { Injectable, inject } from '@angular/core';

import { calculateDocument, type CalcResult } from '../../core/calc';
import { isoDateOnly, nowIsoWithOffset, todayIso } from '../../core/dates';
import { enforceGstGate, inferTaxMode } from '../../core/gst';
import { uuid } from '../../core/ids';
import { amountInWords } from '../../core/number-to-words-indian';
import { allocateNextSeq, financialYearOf, renderDocumentNumber } from '../../core/numbering';
import { deriveStatus, type DerivedStatus } from '../../core/status';
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
} from '../../core/types';
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
} from '../rows';
import { SqliteService } from '../sqlite.service';
import { MastersRepository, type NumberingSeries } from './masters.repository';

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
  tagline?: string;
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

export interface DashboardSummary {
  quotationsPending: number;
  invoicesUnpaid: number;
  totalOutstanding: Paise;
  recent: DocumentListItem[];
}

@Injectable({ providedIn: 'root' })
export class DocumentsRepository {
  private readonly db = inject(SqliteService);
  private readonly masters = inject(MastersRepository);

  // -------------------------------------------------------------------------
  // Mapping
  // -------------------------------------------------------------------------

  private mapDocument(row: DocumentRow): DocumentRecord {
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

  private mapLineItem(row: LineItemRow): LineItem {
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

  private mapPayment(row: PaymentRow): Payment {
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

  // -------------------------------------------------------------------------
  // Totals
  // -------------------------------------------------------------------------

  /** Recompute a document's figures in memory, without touching the database. */
  calculate(document: DocumentRecord, lines: readonly LineItem[]): CalcResult {
    return calculateDocument({
      lines: lines.map((line) => ({
        qtyMilli: line.qtyMilli,
        rate: line.rate,
        taxRateBp: line.taxRateBp,
        discountBp: line.discountBp,
        isFree: line.isFree,
        hsnSac: line.hsnSac,
      })),
      discountMode: document.discountMode,
      discountValue: document.discountValue,
      // The GST gate is re-applied on every save, so removing the business GSTIN cannot leave a
      // stale tax mode quietly adding tax to new drafts (§9.4).
      taxMode: enforceGstGate(document.taxMode, document.businessSnapshot.gstin),
      flatTaxRateBp: document.flatTaxRateBp,
      shippingAmount: document.shippingAmount,
      roundOffEnabled: document.roundOffEnabled,
    });
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  /**
   * Create a draft and return it (§6.1).
   *
   * Deliberately does **not** allocate a number: §8.3 reserves nothing for drafts, so an
   * abandoned draft leaves no gap in the owner's numbering. The series is recorded so the editor
   * can show a "next: …" preview.
   */
  async create(options: { type: DocumentType; clientId?: string | null; issueDate?: string }): Promise<FullDocument> {
    const { type } = options;
    const issueDate = options.issueDate ?? todayIso();
    const now = nowIsoWithOffset();

    const business = await this.masters.getBusinessProfile();
    const series = await this.masters.getDefaultSeries(type);
    const terms = await this.masters.getDefaultTerms(type);
    const client = options.clientId ? await this.masters.getClient(options.clientId) : null;

    const validityDays = readDayCount(
      await this.masters.getSetting('document.quotationValidityDays'),
      15,
    );
    const dueDays = readDayCount(await this.masters.getSetting('document.invoiceDueDays'), 15);
    const storedBlocks = await this.masters.getSetting('document.defaultBlocks');

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
      clientSnapshot: client ? this.masters.clientToSnapshot(client) : null,
      businessSnapshot: this.masters.businessToSnapshot(business),
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

    await this.db.run(
      `INSERT INTO documents (
         id, type, number, series_id, seq, status, client_id, client_snapshot, business_snapshot,
         issue_date, valid_until, due_date, currency, discount_mode, discount_value, tax_mode,
         flat_tax_rate_bp, shipping_amount, round_off_enabled, round_off, subtotal, discount_total,
         tax_total, grand_total, amount_in_words, notes, terms, template_id, accent_color, blocks,
         linked_document_id, payment_method, payment_reference, payment_amount, custom_fields,
         number_warning, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      this.documentParams(document),
    );

    return {
      document,
      lines: [],
      payments: [],
      derived: deriveStatus({ type, storedStatus: 'draft', today: todayIso() }),
    };
  }

  private documentParams(document: DocumentRecord): unknown[] {
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

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  async get(id: string): Promise<FullDocument | null> {
    const row = await this.db.first<DocumentRow>('SELECT * FROM documents WHERE id = ?;', [id]);
    if (!row) return null;

    const document = this.mapDocument(row);
    const lineRows = await this.db.query<LineItemRow>(
      'SELECT * FROM line_items WHERE document_id = ? ORDER BY position;',
      [id],
    );
    const paymentRows =
      document.type === 'invoice'
        ? await this.db.query<PaymentRow>(
            'SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on, created_at;',
            [id],
          )
        : [];

    const payments = paymentRows.map((payment) => this.mapPayment(payment));
    return {
      document,
      lines: lineRows.map((line) => this.mapLineItem(line)),
      payments,
      derived: deriveStatus({
        type: document.type,
        storedStatus: document.status,
        today: todayIso(),
        validUntil: document.validUntil,
        dueDate: document.dueDate,
        grandTotal: document.grandTotal,
        payments: payments.map((payment) => payment.amount),
      }),
    };
  }

  /**
   * The documents list of §6.6.
   *
   * Status filtering happens after the query rather than in SQL, because `overdue`, `paid` and
   * `partially_paid` are derived from the payments table and the clock (§6.4) — they are not
   * what the `status` column holds, and filtering on the stored value would hide exactly the
   * invoices the owner is looking for.
   */
  async list(options: ListDocumentsOptions = {}): Promise<DocumentListItem[]> {
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
    const params: unknown[] = [];

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
      sortBy === 'amount'
        ? 'd.grand_total'
        : sortBy === 'number'
          ? 'd.number'
          : 'substr(d.issue_date, 1, 10)';
    const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';

    const rows = await this.db.query<
      DocumentRow & { client_name: string | null; client_company: string | null; paid_total: number | null }
    >(
      `SELECT d.*, c.name AS client_name, c.company AS client_company,
              (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.invoice_id = d.id) AS paid_total
         FROM documents d
         LEFT JOIN clients c ON c.id = d.client_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${orderColumn} ${direction}, d.created_at ${direction}
        ${limit ? `LIMIT ${Math.trunc(limit)}` : ''};`,
      params,
    );

    const today = todayIso();
    const items = rows.map((row) => {
      const document = this.mapDocument(row);
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

  /** The dashboard figures of §4.1. */
  async dashboardSummary(): Promise<DashboardSummary> {
    const all = await this.list({ sortBy: 'date', sortDirection: 'desc' });

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
        // Only positive balances are outstanding — an overpaid invoice does not reduce what
        // other clients owe.
        if (item.balance > 0) totalOutstanding += item.balance;
      }
    }

    return { quotationsPending, invoicesUnpaid, totalOutstanding, recent: all.slice(0, 5) };
  }

  // -------------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------------

  /**
   * Persist a document and its lines, recomputing totals first.
   *
   * The whole write is one transaction, so the autosave of §6.3 cannot leave a document whose
   * stored total disagrees with its stored lines even if the app is killed mid-save. Lines are
   * replaced wholesale rather than diffed: a handful of rows per document makes
   * delete-and-reinsert simpler and faster than a minimal patch, and it removes any chance of a
   * stale row surviving a reorder.
   */
  async save(input: { document: DocumentRecord; lines: readonly LineItem[] }): Promise<{
    document: DocumentRecord;
    lines: LineItem[];
  }> {
    const calc = this.calculate(input.document, input.lines);
    const document: DocumentRecord = {
      ...input.document,
      subtotal: calc.subtotal,
      discountTotal: calc.discountTotal,
      taxTotal: calc.taxTotal,
      grandTotal: calc.grandTotal,
      roundOff: calc.roundOff,
      amountInWords: amountInWords(calc.grandTotal),
      updatedAt: nowIsoWithOffset(),
    };
    const lines = input.lines.map((line, index) => ({
      ...line,
      position: index,
      lineTotal: calc.lines[index]?.lineTotal ?? 0,
    }));

    await this.db.transaction(async (run) => {
      await run(
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
        [
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
        ],
      );

      await run('DELETE FROM line_items WHERE document_id = ?;', [document.id]);
      for (const line of lines) {
        await run(
          `INSERT INTO line_items (
             id, document_id, position, catalogue_item_id, price_source, name, description,
             hsn_sac, qty_milli, unit, rate, tax_rate_bp, discount_bp, is_free, line_total
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
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
          ],
        );
      }
    });

    return { document, lines };
  }

  /**
   * Attach a client to a document, or detach one.
   *
   * Writes the snapshot as well as the id, because §5.4 wants the document to carry its own copy of
   * whoever it was addressed to. Taking the snapshot *here* rather than only at creation is the
   * point: a document created as a walk-in and later assigned to a client would otherwise keep an
   * empty client block for ever, and one reassigned to a different client would print the old one.
   *
   * Passing `null` clears both, which §7.4 renders as no client block at all rather than an empty
   * heading.
   */
  async setClient(documentId: string, clientId: string | null): Promise<void> {
    const client = clientId ? await this.masters.getClient(clientId) : null;
    const snapshot = client ? this.masters.clientToSnapshot(client) : null;
    await this.db.run(
      'UPDATE documents SET client_id = ?, client_snapshot = ?, updated_at = ? WHERE id = ?;',
      [
        client ? client.id : null,
        // `client_snapshot` is NOT NULL, so "no client" is stored as the JSON literal `null` — the
        // same convention `documentParams` uses. Passing SQL NULL here fails the constraint, and
        // the failure surfaces only as a toast, which makes it look like the button did nothing.
        JSON.stringify(snapshot ?? null),
        nowIsoWithOffset(),
        documentId,
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Payments (§6.5)
  // -------------------------------------------------------------------------

  /**
   * Record a payment against an invoice.
   *
   * Nothing is written to the invoice itself. `paid`, `partially_paid` and the outstanding balance
   * are derived on every read from the sum of this table (§6.4), so a stored copy would be a second
   * truth to keep in step — and the one that goes stale silently. Deleting a payment therefore needs
   * no compensating update either.
   *
   * The amount is clamped at zero rather than rejected. A negative payment is nonsense the UI should
   * not offer, but turning it into an exception here would make a refund typo abort a save; zero is
   * visible in the list and can be deleted.
   */
  async addPayment(input: {
    invoiceId: string;
    amount: Paise;
    paidOn?: string;
    method?: PaymentMethod;
    reference?: string;
    notes?: string;
  }): Promise<Payment> {
    const now = nowIsoWithOffset();
    const payment: Payment = {
      id: uuid(),
      invoiceId: input.invoiceId,
      amount: Math.max(0, Math.trunc(input.amount)),
      paidOn: isoDateOnly(input.paidOn ?? todayIso()),
      method: input.method ?? 'cash',
      reference: input.reference ?? '',
      notes: input.notes ?? '',
      receiptDocumentId: null,
      createdAt: now,
    };

    await this.db.run(
      `INSERT INTO payments (id, invoice_id, amount, paid_on, method, reference, notes,
                             receipt_document_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        payment.id,
        payment.invoiceId,
        payment.amount,
        payment.paidOn,
        payment.method,
        payment.reference,
        payment.notes,
        payment.receiptDocumentId,
        payment.createdAt,
      ],
    );
    return payment;
  }

  async deletePayment(id: string): Promise<void> {
    await this.db.run('DELETE FROM payments WHERE id = ?;', [id]);
  }

  async listPayments(invoiceId: string): Promise<Payment[]> {
    const rows = await this.db.query<PaymentRow>(
      'SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on, created_at;',
      [invoiceId],
    );
    return rows.map((row) => this.mapPayment(row));
  }

  /**
   * Turn a payment into a receipt document, and link the two.
   *
   * The receipt is a document in its own right — it gets a number from the receipt series, carries
   * its own snapshots, and can be previewed and sent like anything else. `linked_document_id` points
   * back at the invoice so the receipt can name what it settles, and `receipt_document_id` on the
   * payment stops a second receipt being raised for money already acknowledged.
   *
   * The invoice's own line items are deliberately *not* copied. A receipt says "we received ₹X
   * against invoice N", not "here is that invoice again": §5.4 wants one line describing the
   * payment, so a part-payment does not print a full itemised bill that looks settled.
   */
  async issueReceiptForPayment(paymentId: string): Promise<FullDocument | null> {
    const payment = await this.db.first<PaymentRow>('SELECT * FROM payments WHERE id = ?;', [
      paymentId,
    ]);
    if (!payment) return null;
    if (payment.receipt_document_id) return this.get(payment.receipt_document_id);

    const invoice = await this.get(payment.invoice_id);
    if (!invoice) return null;

    const receipt = await this.create({
      type: 'receipt',
      clientId: invoice.document.clientId,
      issueDate: payment.paid_on,
    });

    const label = invoice.document.number.trim().length > 0
      ? `Payment received against invoice ${invoice.document.number}`
      : 'Payment received';

    const line: LineItem = {
      id: uuid(),
      documentId: receipt.document.id,
      position: 0,
      catalogueItemId: null,
      priceSource: 'custom',
      name: label,
      description: payment.reference.trim().length > 0 ? `Reference: ${payment.reference}` : '',
      hsnSac: '',
      qtyMilli: 1000,
      unit: '',
      rate: payment.amount,
      // A receipt records money already taken, tax included. Charging tax on top would invent an
      // amount nobody paid.
      taxRateBp: 0,
      discountBp: 0,
      isFree: false,
      lineTotal: payment.amount,
    };

    const saved = await this.save({
      document: {
        ...receipt.document,
        linkedDocumentId: invoice.document.id,
        paymentMethod: asPaymentMethod(payment.method),
        paymentReference: payment.reference,
        paymentAmount: payment.amount,
        taxMode: 'none',
        // Round-off is on by default for a normal document, where rounding to the rupee is a
        // courtesy. On a receipt it is a lie: rounding a ₹1,000.50 payment would print a receipt
        // for ₹1,001.00 and acknowledge fifty paise nobody handed over.
        roundOffEnabled: false,
        notes: payment.notes,
      },
      lines: [line],
    });

    await this.db.run('UPDATE payments SET receipt_document_id = ? WHERE id = ?;', [
      saved.document.id,
      paymentId,
    ]);

    const full = await this.get(saved.document.id);
    return full;
  }

  async setStatus(id: string, status: DocumentStatus): Promise<void> {
    await this.db.run('UPDATE documents SET status = ?, updated_at = ? WHERE id = ?;', [
      status,
      nowIsoWithOffset(),
      id,
    ]);
  }

  async delete(id: string): Promise<void> {
    // line_items and payments cascade.
    await this.db.run('DELETE FROM documents WHERE id = ?;', [id]);
  }

  // -------------------------------------------------------------------------
  // Number allocation (§8.3)
  // -------------------------------------------------------------------------

  /**
   * Allocate a number if the document does not have one yet.
   *
   * Called when a document leaves `draft` or is exported, whichever happens first. The read of
   * the highest used sequence and the write of the new number happen in one transaction, so two
   * rapid exports cannot both take the same number.
   */
  async ensureNumber(id: string): Promise<string> {
    const existing = await this.db.first<DocumentRow>('SELECT * FROM documents WHERE id = ?;', [id]);
    if (!existing) throw new Error(`Document ${id} not found`);
    if (existing.number.trim().length > 0) return existing.number;

    const document = this.mapDocument(existing);
    const series =
      (document.seriesId ? await this.masters.getSeries(document.seriesId) : null) ??
      (await this.masters.getDefaultSeries(document.type));

    if (!series) {
      // No series configured at all: fall back to a bare sequence so the user is never blocked
      // from exporting.
      const fallback = `${document.type.toUpperCase().slice(0, 3)}-${Date.now()}`;
      await this.db.run('UPDATE documents SET number = ? WHERE id = ?;', [fallback, id]);
      return fallback;
    }

    const facts = await this.allocationFacts(series, document.issueDate);
    const seq = allocateNextSeq(facts);
    const allocated = renderDocumentNumber(series, seq, document.issueDate);

    await this.db.transaction(async (run) => {
      await run('UPDATE documents SET number = ?, seq = ?, series_id = ?, updated_at = ? WHERE id = ?;', [
        allocated,
        seq,
        series.id,
        nowIsoWithOffset(),
        id,
      ]);
      await run('UPDATE numbering_series SET next_seq = ? WHERE id = ?;', [seq + 1, series.id]);
    });

    return allocated;
  }

  /**
   * The facts `allocateNextSeq` needs, read from the documents actually numbered.
   *
   * Only rows with a non-null `seq` count, which is what makes §8.3 work: drafts hold no number,
   * so abandoned ones leave no gap behind.
   */
  async allocationFacts(
    series: NumberingSeries,
    issueDate: string,
  ): Promise<{ maxSeqOverall: number | null; maxSeqInFy: number | null; nextSeq: number; resetRule: NumberingSeries['resetRule'] }> {
    const fy = financialYearOf(issueDate);
    const overall = await this.db.first<{ value: number | null }>(
      'SELECT MAX(seq) AS value FROM documents WHERE series_id = ? AND seq IS NOT NULL;',
      [series.id],
    );
    const inFy = await this.db.first<{ value: number | null }>(
      `SELECT MAX(seq) AS value FROM documents
        WHERE series_id = ? AND seq IS NOT NULL
          AND substr(issue_date, 1, 10) >= ? AND substr(issue_date, 1, 10) <= ?;`,
      [series.id, `${fy.startYear}-04-01`, `${fy.endYear}-03-31`],
    );

    return {
      maxSeqOverall: overall?.value ?? null,
      maxSeqInFy: inFy?.value ?? null,
      nextSeq: series.nextSeq,
      resetRule: series.resetRule,
    };
  }

  /** Numbers already used by documents of this type, for the §8.4 duplicate warning. */
  async usedNumbers(type: DocumentType, excludeId?: string): Promise<string[]> {
    const rows = await this.db.query<{ number: string }>(
      `SELECT number FROM documents WHERE type = ? AND number != ''${excludeId ? ' AND id != ?' : ''};`,
      excludeId ? [type, excludeId] : [type],
    );
    return rows.map((row) => row.number);
  }

  /** §8.4: the user may type any number; a duplicate is warned about, never blocked. */
  async setNumberManually(id: string, numberText: string, isDuplicate: boolean): Promise<void> {
    await this.db.run('UPDATE documents SET number = ?, number_warning = ?, updated_at = ? WHERE id = ?;', [
      numberText,
      fromBoolean(isDuplicate),
      nowIsoWithOffset(),
      id,
    ]);
  }
}

/**
 * Read a stored day count, falling back on anything unusable.
 *
 * `?? '15'` alone is not enough: it catches `null` but not an empty string, and `Number('')` is
 * `0` — which would silently make every invoice due on the day it was raised. A settings row can be
 * blank after a restore from an older backup, so the check has to cover it.
 */
function readDayCount(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim().length === 0) return fallback;
  const parsed = Math.trunc(Number(raw));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Add days to an ISO date.
 *
 * Uses UTC arithmetic on a date-only string so it cannot drift across a daylight-saving boundary
 * — the same reason `core/dates.ts` treats dates as text.
 */
function addDays(iso: string, days: number): string {
  if (!Number.isFinite(days)) return iso;
  const [year, month, day] = isoDateOnly(iso).split('-').map(Number);
  const utc = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1));
  utc.setUTCDate(utc.getUTCDate() + Math.trunc(days));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(
    utc.getUTCDate(),
  ).padStart(2, '0')}`;
}
