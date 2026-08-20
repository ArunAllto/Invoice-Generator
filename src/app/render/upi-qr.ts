/**
 * The UPI payment QR for a document (§7.6).
 *
 * Lives here, beside the adapter, because two callers need exactly the same answer: the preview
 * screen and every export path. When the editor had its own copy that passed `null`, the preview
 * showed a QR and the exported file did not — the one difference between them that actually costs
 * the owner money, since the client receives the file, not the preview.
 *
 * Not folded into `toRenderInput` because encoding a QR is real work — a few thousand operations —
 * and the adapter is called once per page for a paginated image export. Keeping it separate lets the
 * cost be paid once and the finished SVG handed in.
 */

import { buildUpiQrSvg } from '../core/qr';
import type { DocumentRecord } from '../data/repositories/documents.repository';
import type { Paise } from '../core/types';

export interface UpiQrInput {
  document: DocumentRecord;
  /** Outstanding amount for an invoice, from the derived status. */
  balance: Paise;
  grandTotal: Paise;
}

/**
 * Build the QR, or return null when there is nothing to encode.
 *
 * Null covers three cases the caller should not have to distinguish: the block is switched off, the
 * business has no UPI ID, or the payload will not encode. All three mean the same thing to the
 * renderer — no QR — and the document reads perfectly well without one.
 */
export function buildDocumentUpiQr(input: UpiQrInput): string | null {
  const { document: record, balance, grandTotal } = input;
  const vpa = record.businessSnapshot.upiId;
  if (!record.blocks.upiQr || !vpa || vpa.trim().length === 0) return null;

  try {
    return buildUpiQrSvg({
      vpa,
      payeeName: record.businessSnapshot.name,
      // An invoice asks for what is still owed; anything else encodes an open amount, since asking
      // for the full total of a part-paid invoice would collect the money twice.
      amountPaise: record.type === 'invoice' ? balance || grandTotal : null,
      note: record.number,
    });
  } catch {
    // A payload that will not encode must not take the document down with it.
    return null;
  }
}
