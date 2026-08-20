/**
 * Row types and the narrowing between SQLite's loose values and the app's strict ones.
 *
 * SQLite has no boolean and no enum, so every 0/1 flag and every union-typed TEXT column has to
 * be narrowed on the way out. Doing it here — once, in typed mappers — is what lets the rest of
 * the app treat a mapped row as trustworthy. A row written by an older build, or restored from a
 * backup, is exactly the case these defend against.
 *
 * Ported from the React Native tree; nothing here touches a platform API.
 */

import { DEFAULT_BLOCKS, type DocumentBlocks } from '../core/types';
import type {
  CustomFieldScope,
  CustomFieldType,
  CustomFieldValue,
  DiscountMode,
  DocumentStatus,
  DocumentType,
  FyFormat,
  PaymentMethod,
  PriceSource,
  ResetRule,
  TaxMode,
  TemplateId,
} from '../core/types';

// ---------------------------------------------------------------------------
// Raw shapes, exactly as SQLite returns them
// ---------------------------------------------------------------------------

export interface BusinessProfileRow {
  id: number;
  name: string;
  tagline: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  website: string;
  gstin: string | null;
  pan: string | null;
  logo_uri: string | null;
  signature_uri: string | null;
  signature_label: string;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  upi_id: string | null;
  default_currency: string;
  default_template_id: string;
  accent_color: string;
  custom_fields: string;
  created_at: string;
  updated_at: string;
}

export interface ClientRow {
  id: string;
  name: string;
  company: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  gstin: string | null;
  notes: string;
  custom_fields: string;
  created_at: string;
  updated_at: string;
  archived: number;
}

export interface CatalogueItemRow {
  id: string;
  name: string;
  description: string;
  default_rate: number;
  unit: string;
  hsn_sac: string | null;
  tax_rate_bp: number;
  category: string;
  is_favourite: number;
  times_used: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface NumberingSeriesRow {
  id: string;
  doc_type: string;
  label: string;
  prefix: string;
  suffix: string;
  include_fy: number;
  fy_format: string;
  fy_separator: string;
  pad_width: number;
  next_seq: number;
  reset_rule: string;
  is_default: number;
}

export interface DocumentRow {
  id: string;
  type: string;
  number: string;
  series_id: string | null;
  seq: number | null;
  status: string;
  client_id: string | null;
  client_snapshot: string;
  business_snapshot: string;
  issue_date: string;
  valid_until: string | null;
  due_date: string | null;
  currency: string;
  discount_mode: string;
  discount_value: number;
  tax_mode: string;
  flat_tax_rate_bp: number;
  shipping_amount: number;
  round_off_enabled: number;
  round_off: number;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
  amount_in_words: string;
  notes: string;
  terms: string;
  template_id: string;
  accent_color: string | null;
  blocks: string;
  linked_document_id: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  payment_amount: number | null;
  custom_fields: string;
  number_warning: number;
  created_at: string;
  updated_at: string;
}

export interface LineItemRow {
  id: string;
  document_id: string;
  position: number;
  catalogue_item_id: string | null;
  price_source: string;
  name: string;
  description: string;
  hsn_sac: string;
  qty_milli: number;
  unit: string;
  rate: number;
  tax_rate_bp: number;
  discount_bp: number;
  is_free: number;
  line_total: number;
}

export interface PaymentRow {
  id: string;
  invoice_id: string;
  amount: number;
  paid_on: string;
  method: string;
  reference: string;
  notes: string;
  receipt_document_id: string | null;
  created_at: string;
}

export interface TermsBlockRow {
  id: string;
  title: string;
  body: string;
  doc_type: string;
  is_default: number;
  position: number;
}

export interface TaxPresetRow {
  id: string;
  label: string;
  rate_bp: number;
  is_default: number;
}

export interface CustomFieldDefRow {
  id: string;
  label: string;
  field_type: string;
  applies_to: string;
  show_on_document: number;
  position: number;
}

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

export function toBoolean(value: number | null | undefined): boolean {
  return value === 1;
}

export function fromBoolean(value: boolean): number {
  return value ? 1 : 0;
}

/** Narrow a TEXT column to a union, falling back rather than throwing. */
function oneOf<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function asDocumentType(value: string): DocumentType {
  return oneOf(value, ['quotation', 'invoice', 'receipt'] as const, 'invoice');
}

export function asDocumentStatus(value: string): DocumentStatus {
  return oneOf(
    value,
    [
      'draft',
      'sent',
      'accepted',
      'rejected',
      'expired',
      'partially_paid',
      'paid',
      'overdue',
      'cancelled',
      'issued',
    ] as const,
    'draft',
  );
}

export function asDiscountMode(value: string): DiscountMode {
  return oneOf(value, ['none', 'percent', 'amount'] as const, 'none');
}

export function asTaxMode(value: string): TaxMode {
  return oneOf(value, ['none', 'gst_intra', 'gst_inter', 'flat'] as const, 'none');
}

export function asPriceSource(value: string): PriceSource {
  return oneOf(value, ['auto', 'custom'] as const, 'custom');
}

export function asTemplateId(value: string): TemplateId {
  return oneOf(value, ['classic', 'minimal', 'bold', 'compact'] as const, 'classic');
}

export function asPaymentMethod(value: string | null): PaymentMethod {
  return oneOf(value, ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'] as const, 'cash');
}

export function asResetRule(value: string): ResetRule {
  return oneOf(value, ['never', 'yearly_april'] as const, 'yearly_april');
}

export function asFyFormat(value: string): FyFormat {
  return oneOf(value, ['2026-27', '26-27'] as const, '2026-27');
}

export function asCustomFieldType(value: string): CustomFieldType {
  return oneOf(value, ['text', 'number', 'date'] as const, 'text');
}

export function asCustomFieldScope(value: string): CustomFieldScope {
  return oneOf(value, ['business', 'client', 'document'] as const, 'document');
}

/**
 * Parse a JSON column defensively.
 *
 * A malformed snapshot must not make a document unopenable — the owner would lose access to a
 * real invoice over a syntax error. Bad JSON degrades to the fallback instead.
 */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

export function parseCustomFields(raw: string | null | undefined): CustomFieldValue[] {
  const parsed = parseJson<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      label: typeof entry['label'] === 'string' ? entry['label'] : '',
      value: typeof entry['value'] === 'string' ? entry['value'] : String(entry['value'] ?? ''),
    }))
    .filter((field) => field.label.length > 0);
}

/**
 * Parse the per-document block toggles, filling anything absent from the defaults.
 *
 * A document saved by an earlier build will not have keys added later, and the renderer must not
 * read `undefined` as "off" — that would silently drop the client block from an old invoice the
 * first time it was re-exported.
 */
export function parseBlocks(raw: string | null | undefined): DocumentBlocks {
  const parsed = parseJson<Partial<Record<keyof DocumentBlocks, unknown>>>(raw, {});
  const result = { ...DEFAULT_BLOCKS };
  for (const key of Object.keys(DEFAULT_BLOCKS) as Array<keyof DocumentBlocks>) {
    const value = parsed[key];
    if (typeof value === 'boolean') result[key] = value;
    else if (value === 0 || value === 1) result[key] = value === 1;
  }
  return result;
}
