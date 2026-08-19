/**
 * Turns a stored document into `RenderInput`.
 *
 * This is the only asynchronous part of rendering: logo, signature and font bytes have to
 * be read off disk and base64-encoded before the pure renderer can run. Keeping that
 * separation means `renderDocumentHtml` stays synchronous and testable, and it means the
 * expensive reads are cached in one place.
 */

import * as FileSystem from 'expo-file-system/legacy';

import { calculateDocument, computeBalance, type CalcResult } from '../core/calc';
import { buildUpiUri, encodeQr, qrToSvg } from '../core/qr';
import type { DocumentBlocks, PaymentMethod } from '../core/types';
import type { DocumentRecord, LineItem, Payment, PartySnapshot } from '../db/documents';
import { loadEmbeddedFonts } from '../export/fonts';
import type { RenderDocument, RenderInput, RenderLine, RenderParty } from './html';

const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  card: 'Card',
  other: 'Other',
};

/** Cache of file URI → data URI, so re-exports do not re-read the logo every time. */
const imageCache = new Map<string, string>();

function mimeFromUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  // The signature canvas and the image manipulator both emit PNG, so it is the safer
  // default than guessing JPEG and losing transparency.
  return 'image/png';
}

/**
 * Read a local image as a `data:` URI.
 *
 * Returns `null` rather than throwing when the file has gone missing: a logo deleted from
 * the device must degrade to a document without a logo, not to an export that fails.
 */
export async function toDataUri(uri: string | null | undefined): Promise<string | null> {
  if (!uri || uri.trim().length === 0) return null;
  if (uri.startsWith('data:')) return uri;

  const cached = imageCache.get(uri);
  if (cached) return cached;

  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const dataUri = `data:${mimeFromUri(uri)};base64,${base64}`;
    imageCache.set(uri, dataUri);
    return dataUri;
  } catch {
    return null;
  }
}

export function clearImageCache(): void {
  imageCache.clear();
}

function snapshotToParty(snapshot: PartySnapshot | null | undefined): RenderParty | null {
  if (!snapshot) return null;
  return {
    name: snapshot.name ?? '',
    company: snapshot.company,
    tagline: snapshot.tagline,
    addressLine1: snapshot.addressLine1,
    addressLine2: snapshot.addressLine2,
    city: snapshot.city,
    state: snapshot.state,
    pincode: snapshot.pincode,
    phone: snapshot.phone,
    email: snapshot.email,
    website: snapshot.website,
    gstin: snapshot.gstin,
    pan: snapshot.pan,
    bankName: snapshot.bankName,
    bankAccountName: snapshot.bankAccountName,
    bankAccountNo: snapshot.bankAccountNo,
    bankIfsc: snapshot.bankIfsc,
    upiId: snapshot.upiId,
    signatureLabel: snapshot.signatureLabel,
    customFields: snapshot.customFields,
  };
}

function toRenderLines(lines: readonly LineItem[]): RenderLine[] {
  return lines.map((line) => ({
    name: line.name,
    description: line.description,
    hsnSac: line.hsnSac,
    qtyMilli: line.qtyMilli,
    unit: line.unit,
    rate: line.rate,
    taxRateBp: line.taxRateBp,
    discountBp: line.discountBp,
    isFree: line.isFree,
  }));
}

/**
 * Recompute the document's figures for rendering.
 *
 * Note that this recalculates rather than reading the stored totals. That is deliberate
 * and it is not a contradiction of §5.4: the renderer needs the *per-line* breakdown
 * (each line's tax, each line's share of the document discount, the HSN-wise summary),
 * and only `line_total` is stored. Because `saveDocument` persists the result of the same
 * pure function over the same inputs, the recomputed grand total always equals the stored
 * one — a fact asserted by a test rather than assumed.
 */
export function calcForRender(document: DocumentRecord, lines: readonly LineItem[]): CalcResult {
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
    taxMode: document.taxMode,
    flatTaxRateBp: document.flatTaxRateBp,
    shippingAmount: document.shippingAmount,
    roundOffEnabled: document.roundOffEnabled,
  });
}

export interface PrepareOptions {
  /** Screen preview styling (grey field, page shadows). */
  forScreen?: boolean;
  /** Fixed pixel width for image export. */
  pixelWidth?: number;
  /** Skip embedding fonts. Only for tests — export must always embed (§3). */
  skipFonts?: boolean;
  /** Override the template, for the export sheet's template switcher. */
  templateId?: DocumentRecord['templateId'];
  /** Override the block toggles, for the "what's included" preview. */
  blocks?: DocumentBlocks;
}

export interface PreparedRender {
  input: RenderInput;
  /** Number of A4 pages this document will produce. */
  pageCount: number;
}

/**
 * Assemble everything the renderer needs.
 *
 * The UPI QR is generated here so the same SVG string reaches PDF, image and preview
 * (§10.1) — and locally, with no network call, as §7.6 requires.
 */
export async function prepareRender(
  args: {
    document: DocumentRecord;
    lines: readonly LineItem[];
    payments?: readonly Payment[];
    blocks?: DocumentBlocks;
  },
  options: PrepareOptions = {},
): Promise<RenderInput> {
  const document = options.templateId
    ? { ...args.document, templateId: options.templateId }
    : args.document;
  const blocks = options.blocks ?? args.blocks ?? document.blocks;
  const business = snapshotToParty(document.businessSnapshot) ?? { name: '' };
  const client = snapshotToParty(document.clientSnapshot);
  const calc = calcForRender(document, args.lines);

  const paidTotal = (args.payments ?? []).reduce((sum, payment) => sum + payment.amount, 0);
  const balanceDue = computeBalance(calc.grandTotal, (args.payments ?? []).map((p) => p.amount));

  const [logoDataUri, signatureDataUri] = await Promise.all([
    toDataUri(document.businessSnapshot.logoUri),
    blocks.signature ? toDataUri(document.businessSnapshot.signatureUri) : Promise.resolve(null),
  ]);

  // §7.6: only on invoices, only when a UPI ID exists, only when the toggle is on.
  let upiQrSvg: string | null = null;
  if (blocks.upiQr && document.type === 'invoice' && business.upiId) {
    try {
      const uri = buildUpiUri({
        vpa: business.upiId,
        payeeName: business.name,
        amountPaise: balanceDue > 0 ? balanceDue : calc.grandTotal,
        note: document.number || undefined,
      });
      upiQrSvg = qrToSvg(encodeQr(uri, { ecLevel: 'M' }), { size: 26, unit: 'mm', margin: 2 });
    } catch {
      // A malformed VPA must not stop the invoice being produced.
      upiQrSvg = null;
    }
  }

  const renderDocument: RenderDocument = {
    type: document.type,
    number: document.number,
    status: document.status,
    issueDate: document.issueDate,
    validUntil: document.validUntil,
    dueDate: document.dueDate,
    currency: document.currency,
    taxMode: calc.taxTotal === 0 && document.taxMode === 'none' ? 'none' : document.taxMode,
    notes: document.notes,
    terms: document.terms,
    templateId: document.templateId,
    accentColor: document.accentColor ?? '#0F4C81',
    amountInWords: document.amountInWords,
    paymentMethodLabel: document.paymentMethod ? PAYMENT_METHOD_LABELS[document.paymentMethod] : null,
    paymentReference: document.paymentReference,
    paymentAmount: document.paymentAmount,
    customFields: document.customFields,
    paidTotal,
    balanceDue,
    // A draft or cancelled document must be unmistakable if it is shared by accident.
    watermark:
      document.status === 'cancelled' ? 'CANCELLED' : document.status === 'draft' ? 'DRAFT' : null,
  };

  const fonts = options.skipFonts
    ? { css: '', familyStack: "'Noto Sans', sans-serif", includesMalayalam: false }
    : await loadEmbeddedFonts(collectDocumentText(renderDocument, args.lines, business, client));

  return {
    document: renderDocument,
    lines: toRenderLines(args.lines),
    business,
    client,
    calc,
    blocks,
    options: {
      fontCss: fonts.css,
      fontFamily: fonts.familyStack,
      logoDataUri,
      signatureDataUri,
      upiQrSvg,
      dateStyle: 'dd MMM yyyy',
      pixelWidth: options.pixelWidth,
      forScreen: options.forScreen,
    },
  };
}

/**
 * All the free text on a document, concatenated.
 *
 * Used only to decide whether the Malayalam font face is needed — see
 * `src/export/fonts.ts`. Concatenating is cheaper than a per-field scan and the string is
 * discarded immediately.
 */
function collectDocumentText(
  document: RenderDocument,
  lines: readonly LineItem[],
  business: RenderParty,
  client: RenderParty | null,
): string {
  const parts: Array<string | null | undefined> = [
    document.notes,
    document.terms,
    document.amountInWords,
    business.name,
    business.tagline,
    business.addressLine1,
    business.addressLine2,
    business.city,
    client?.name,
    client?.company,
    client?.addressLine1,
    client?.addressLine2,
    client?.city,
  ];
  for (const line of lines) {
    parts.push(line.name, line.description, line.unit);
  }
  for (const field of document.customFields) parts.push(field.label, field.value);
  return parts.filter((part): part is string => typeof part === 'string').join(' ');
}
