/**
 * Domain types shared by the pure core and the rest of the app.
 *
 * This file — and everything in `src/core/` — must never import React, react-native,
 * expo-*, or the database layer (spec §16.3). The Jest `core` project compiles this
 * directory in a plain Node environment precisely so that rule is mechanically enforced.
 *
 * Money is ALWAYS integer paise (₹1 = 100 paise). Quantities are ALWAYS integer
 * thousandths ("milli"), so 1.5 units is 1500. Percentages and tax rates are ALWAYS
 * integer basis points, so 18% is 1800. There are no floats anywhere in the money path.
 */

/** Integer paise. ₹1 = 100. Never a float. */
export type Paise = number;
/** Integer thousandths of a unit. 1.5 units = 1500. */
export type Milli = number;
/** Integer basis points. 18% = 1800, 100% = 10000. */
export type BasisPoints = number;

export type DocumentType = 'quotation' | 'invoice' | 'receipt';

export const DOCUMENT_TYPES: readonly DocumentType[] = ['quotation', 'invoice', 'receipt'];

export type DiscountMode = 'none' | 'percent' | 'amount';

export type TaxMode = 'none' | 'gst_intra' | 'gst_inter' | 'flat';

export type PriceSource = 'auto' | 'custom';

export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'cheque' | 'card' | 'other';

export type DocumentStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled'
  | 'issued';

export type TemplateId = 'classic' | 'minimal' | 'bold' | 'compact';

export const TEMPLATE_IDS: readonly TemplateId[] = ['classic', 'minimal', 'bold', 'compact'];

export type ResetRule = 'never' | 'yearly_april';

export type FyFormat = '2026-27' | '26-27';

export type CustomFieldType = 'text' | 'number' | 'date';

export type CustomFieldScope = 'business' | 'client' | 'document';

export interface CustomFieldValue {
  label: string;
  value: string;
}

/** A per-document toggle set. Every block in §7.4 is individually switchable. */
export interface DocumentBlocks {
  clientBlock: boolean;
  hsnColumn: boolean;
  unitColumn: boolean;
  taxColumns: boolean;
  bankDetails: boolean;
  upiQr: boolean;
  signature: boolean;
  terms: boolean;
  notes: boolean;
  amountInWords: boolean;
  discountRow: boolean;
  shippingRow: boolean;
  roundOffRow: boolean;
  footerLine: boolean;
  descriptions: boolean;
  taxSummary: boolean;
}

export const DEFAULT_BLOCKS: DocumentBlocks = {
  clientBlock: true,
  hsnColumn: false,
  unitColumn: true,
  taxColumns: true,
  bankDetails: true,
  upiQr: false,
  signature: true,
  terms: true,
  notes: true,
  amountInWords: true,
  discountRow: true,
  shippingRow: false,
  roundOffRow: true,
  footerLine: true,
  descriptions: true,
  taxSummary: true,
};

/**
 * Named paper sizes the document can be laid out on.
 *
 * `custom` means the width and height come from the owner's own numbers instead of this table.
 * Kept as a union rather than free-form millimetres everywhere so the common case — "A4, like
 * everyone else in India" — stays one word in the settings row and one word in a backup.
 */
export type PageSizeId = 'a4' | 'letter' | 'legal' | 'a5' | 'custom';

/**
 * The paper a document is laid out on (§10.1).
 *
 * Millimetres throughout, including for the US sizes, because the renderer works in millimetres and
 * converting once here beats carrying two units through pagination. Letter is 215.9 × 279.4mm and
 * Legal 215.9 × 355.6mm — the exact conversions of 8.5×11in and 8.5×14in, not rounded, since a
 * rounded page height compounds into a wrong row count on a long invoice.
 */
export interface PageGeometry {
  sizeId: PageSizeId;
  widthMm: number;
  heightMm: number;
  /** Left and right margin. */
  marginXMm: number;
  /** Top and bottom margin. */
  marginYMm: number;
}

/** §10.1's A4 with 20mm sides and 16mm top and bottom. The default everywhere. */
export const A4_PAGE: PageGeometry = {
  sizeId: 'a4',
  widthMm: 210,
  heightMm: 297,
  marginXMm: 20,
  marginYMm: 16,
};

export const PAGE_PRESETS: Readonly<Record<Exclude<PageSizeId, 'custom'>, PageGeometry>> = {
  a4: A4_PAGE,
  letter: { sizeId: 'letter', widthMm: 215.9, heightMm: 279.4, marginXMm: 20, marginYMm: 16 },
  legal: { sizeId: 'legal', widthMm: 215.9, heightMm: 355.6, marginXMm: 20, marginYMm: 16 },
  // A5 gets tighter margins: 20mm sides on a 148mm sheet would leave 108mm of usable width, which
  // is not enough for the items table to stay readable.
  a5: { sizeId: 'a5', widthMm: 148, heightMm: 210, marginXMm: 12, marginYMm: 10 },
};

/** Bounds for a custom page, wide enough for a receipt roll and an A3 sheet. */
export const PAGE_LIMITS = {
  minWidthMm: 70,
  maxWidthMm: 420,
  minHeightMm: 100,
  maxHeightMm: 600,
  minMarginMm: 0,
  /** A margin may not eat the page: capped so at least 50mm of content width survives. */
  maxMarginMm: 40,
} as const;
