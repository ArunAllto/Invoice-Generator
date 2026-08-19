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
