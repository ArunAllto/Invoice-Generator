/**
 * Adapter from what the database holds to what the renderer wants.
 *
 * `renderDocumentHtml` takes a deliberately narrow input: parties, lines, totals, blocks. It knows
 * nothing about snapshots, derived status or payments. This file is the one place that translation
 * happens, so the on-screen preview, the PDF and the PNG export cannot drift apart — they all render
 * the same `RenderInput`.
 *
 * ## Pure by construction
 *
 * Every import here is `import type`, so nothing from the data layer (which injects Angular) exists
 * at runtime. That keeps this file inside the pure layer the Vitest suite runs in plain Node, which
 * is what makes the "no framework in core/render" rule build-enforced rather than aspirational.
 *
 * ## Why the party fields are copied one by one
 *
 * `PartySnapshot` and `RenderParty` overlap but are not the same shape: the snapshot carries
 * `logoUri` and `signatureUri`, which belong in `RenderOptions` rather than on the party, and its
 * custom fields are a different type. Spreading would smuggle those through and silently rely on
 * the renderer ignoring them.
 */

import type { CalcResult } from '../core/calc';
import type { DerivedStatus } from '../core/status';
import type { DocumentRecord, LineItem, PartySnapshot } from '../data/repositories/documents.repository';
import type { RenderInput, RenderLine, RenderOptions, RenderParty } from './html';

/**
 * A font stack for the on-screen preview.
 *
 * The exported document embeds a real font so the file renders identically anywhere (§10.1). The
 * preview does not need that — it is being looked at on this device, right now — so it uses the
 * platform's own serif-free stack and skips a megabyte of base64.
 */
export const PREVIEW_FONT_FAMILY =
  "'Noto Sans', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Copy the printable half of a snapshot. See the note above on why this is field by field. */
export function snapshotToParty(snapshot: PartySnapshot): RenderParty {
  return {
    name: snapshot.name,
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
    customFields: (snapshot.customFields ?? []).map((field) => ({
      label: field.label,
      value: field.value,
    })),
  };
}

function lineToRenderLine(line: LineItem): RenderLine {
  return {
    name: line.name,
    description: line.description,
    hsnSac: line.hsnSac,
    qtyMilli: line.qtyMilli,
    unit: line.unit,
    rate: line.rate,
    taxRateBp: line.taxRateBp,
    discountBp: line.discountBp,
    isFree: line.isFree,
  };
}

/**
 * A watermark, or null.
 *
 * §10.2: a draft must be unmistakable on paper, because the whole hazard of a draft is that it looks
 * exactly like the real thing once printed. Cancelled is marked for the same reason. The derived
 * status is used rather than the stored one, so an invoice that is *shown* as cancelled is *marked*
 * as cancelled.
 */
export function watermarkFor(status: string): string | null {
  if (status === 'draft') return 'DRAFT';
  if (status === 'cancelled') return 'CANCELLED';
  return null;
}

export interface AdaptOptions {
  /** Screen preview rather than export: drops print-only page shadows and centring. */
  forScreen?: boolean;
  /** Render only this page (1-based), still numbered against the whole document. */
  onlyPage?: number;
  /** Fixed pixel width, for image export. */
  pixelWidth?: number;
  logoDataUri?: string | null;
  signatureDataUri?: string | null;
  upiQrSvg?: string | null;
  fontCss?: string;
  fontFamily?: string;
}

/** Build the renderer's input from a loaded document. */
export function toRenderInput(
  input: {
    document: DocumentRecord;
    lines: readonly LineItem[];
    calc: CalcResult;
    derived: DerivedStatus;
  },
  options: AdaptOptions = {},
): RenderInput {
  const { document: record, lines, calc, derived } = input;

  const renderOptions: RenderOptions = {
    fontCss: options.fontCss ?? '',
    fontFamily: options.fontFamily ?? PREVIEW_FONT_FAMILY,
    logoDataUri: options.logoDataUri ?? record.businessSnapshot.logoUri ?? null,
    signatureDataUri: options.signatureDataUri ?? record.businessSnapshot.signatureUri ?? null,
    upiQrSvg: options.upiQrSvg ?? null,
    forScreen: options.forScreen ?? false,
    ...(options.onlyPage === undefined ? {} : { onlyPage: options.onlyPage }),
    ...(options.pixelWidth === undefined ? {} : { pixelWidth: options.pixelWidth }),
  };

  return {
    document: {
      type: record.type,
      number: record.number,
      // The status shown on paper is the derived one (§6.4): an invoice past its due date prints as
      // overdue even though nothing wrote that word into the database.
      status: derived.status,
      issueDate: record.issueDate,
      validUntil: record.validUntil,
      dueDate: record.dueDate,
      currency: record.currency,
      taxMode: record.taxMode,
      notes: record.notes,
      terms: record.terms,
      templateId: record.templateId,
      // `accentColor` is nullable in the database, meaning "use the template's own". The renderer
      // wants a concrete colour, and the template default is the brand navy.
      accentColor: record.accentColor ?? '#0f4c81',
      amountInWords: record.amountInWords,
      paymentMethodLabel: record.paymentMethod,
      paymentReference: record.paymentReference,
      paymentAmount: record.paymentAmount,
      customFields: record.customFields.map((field) => ({
        label: field.label,
        value: field.value,
      })),
      paidTotal: derived.paid,
      balanceDue: derived.balance,
      watermark: watermarkFor(derived.status),
    },
    lines: lines.map(lineToRenderLine),
    business: snapshotToParty(record.businessSnapshot),
    client: record.clientSnapshot ? snapshotToParty(record.clientSnapshot) : null,
    calc,
    blocks: record.blocks,
    options: renderOptions,
  };
}
