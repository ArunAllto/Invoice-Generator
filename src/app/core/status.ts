/**
 * Document status — spec §6.4.
 *
 * The important distinction the spec draws: some statuses are *set* by the user (draft,
 * sent, accepted, rejected, cancelled) and some are *derived* from facts (expired,
 * overdue, partially_paid, paid). Derived statuses are computed on read, every time, and
 * are never written back as a stored value that could go stale — an invoice does not
 * become overdue because someone opened the app, it is overdue because its due date has
 * passed.
 *
 * Pure: dates and payments are passed in, nothing here reads the clock or the database.
 */

import { computeBalance } from './calc';
import { compareIsoDates } from './dates';
import type { DocumentStatus, DocumentType, Paise } from './types';

/** The statuses a user is allowed to select directly, per type. */
export const USER_SETTABLE_STATUSES: Readonly<Record<DocumentType, readonly DocumentStatus[]>> = {
  quotation: ['draft', 'sent', 'accepted', 'rejected'],
  invoice: ['draft', 'sent', 'cancelled'],
  receipt: ['draft', 'issued', 'cancelled'],
};

/** Legal manual transitions. Anything not listed is refused by `canTransition`. */
const TRANSITIONS: Readonly<Record<DocumentType, Readonly<Record<string, readonly DocumentStatus[]>>>> =
  {
    quotation: {
      draft: ['sent', 'accepted'],
      sent: ['accepted', 'rejected', 'draft'],
      accepted: ['sent'],
      rejected: ['sent'],
      expired: ['sent', 'accepted', 'rejected'],
    },
    invoice: {
      draft: ['sent', 'cancelled'],
      sent: ['cancelled', 'draft'],
      partially_paid: ['cancelled'],
      paid: [],
      overdue: ['cancelled'],
      cancelled: [],
    },
    receipt: {
      // §6.4: a receipt is not editable once issued — only cancelled.
      draft: ['issued'],
      issued: ['cancelled'],
      cancelled: [],
    },
  };

export function canTransition(
  type: DocumentType,
  from: DocumentStatus,
  to: DocumentStatus,
): boolean {
  return (TRANSITIONS[type][from] ?? []).includes(to);
}

/**
 * Whether a document's content may still be edited.
 *
 * §6.4 makes issued receipts immutable, which is the point of a receipt: it is evidence
 * that money changed hands, and evidence you can quietly rewrite is not evidence.
 * Cancelled documents of every type are frozen too, and kept rather than deleted.
 */
export function isEditable(type: DocumentType, status: DocumentStatus): boolean {
  if (status === 'cancelled') return false;
  if (type === 'receipt') return status === 'draft';
  return true;
}

/** §6.4: hard-deleting an issued receipt is not permitted. */
export function canHardDelete(type: DocumentType, status: DocumentStatus): boolean {
  if (type === 'receipt') return status === 'draft';
  return true;
}

export interface DerivedStatusInput {
  type: DocumentType;
  /** The status as stored. */
  storedStatus: DocumentStatus;
  /** Today's calendar date, injected so this stays pure and testable. */
  today: string;
  /** Quotations only. */
  validUntil?: string | null;
  /** Invoices only. */
  dueDate?: string | null;
  /** Invoices only: the document's stored grand total. */
  grandTotal?: Paise;
  /** Invoices only: every payment recorded against this invoice. */
  payments?: readonly Paise[];
}

export interface DerivedStatus {
  status: DocumentStatus;
  /** Outstanding amount for invoices; 0 for other types. */
  balance: Paise;
  /** Total received for invoices. */
  paid: Paise;
  /** True when the status shown differs from the status stored. */
  isDerived: boolean;
}

/**
 * The status to display, derived from the stored status plus the facts.
 *
 * Precedence matters. `cancelled` beats everything — a cancelled invoice is not
 * "overdue". Payment beats time: an invoice paid in full after its due date is `paid`,
 * not `overdue`, because the debt is settled. Only an unsettled invoice past its date is
 * `overdue`.
 */
export function deriveStatus(input: DerivedStatusInput): DerivedStatus {
  const { type, storedStatus, today, validUntil, dueDate, grandTotal = 0, payments = [] } = input;

  const paid = payments.reduce((acc, p) => acc + p, 0);
  const balance = type === 'invoice' ? computeBalance(grandTotal, payments) : 0;

  const unchanged = (status: DocumentStatus): DerivedStatus => ({
    status,
    balance,
    paid,
    isDerived: status !== storedStatus,
  });

  // Cancelled and draft are never overridden by derivation.
  if (storedStatus === 'cancelled') return unchanged('cancelled');
  if (storedStatus === 'draft') return unchanged('draft');

  if (type === 'quotation') {
    // §6.4: expired is derived when valid_until has passed and it is still merely sent.
    if (storedStatus === 'sent' && validUntil && compareIsoDates(validUntil, today) < 0) {
      return unchanged('expired');
    }
    return unchanged(storedStatus);
  }

  if (type === 'invoice') {
    if (grandTotal > 0 && paid >= grandTotal) return unchanged('paid');
    if (paid > 0) {
      // Part-paid and past due: the shortfall is the more urgent fact.
      if (dueDate && compareIsoDates(dueDate, today) < 0) return unchanged('overdue');
      return unchanged('partially_paid');
    }
    if (dueDate && compareIsoDates(dueDate, today) < 0 && balance > 0) {
      return unchanged('overdue');
    }
    return unchanged(storedStatus);
  }

  return unchanged(storedStatus);
}

/** Display label for a status pill. */
export function statusLabel(status: DocumentStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'sent':
      return 'Sent';
    case 'accepted':
      return 'Accepted';
    case 'rejected':
      return 'Rejected';
    case 'expired':
      return 'Expired';
    case 'partially_paid':
      return 'Part paid';
    case 'paid':
      return 'Paid';
    case 'overdue':
      return 'Overdue';
    case 'cancelled':
      return 'Cancelled';
    case 'issued':
      return 'Issued';
    default:
      return status;
  }
}

export type StatusTone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger';

/** Semantic tone for the status pill, resolved to colours in the theme. */
export function statusTone(status: DocumentStatus): StatusTone {
  switch (status) {
    case 'draft':
      return 'neutral';
    case 'sent':
    case 'issued':
      return 'info';
    case 'accepted':
    case 'paid':
      return 'positive';
    case 'partially_paid':
    case 'expired':
      return 'warning';
    case 'rejected':
    case 'overdue':
      return 'danger';
    case 'cancelled':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** Statuses that count as "still open" for the dashboard summary strip (§4.1). */
export function isOpenQuotation(status: DocumentStatus): boolean {
  return status === 'draft' || status === 'sent';
}

export function isUnpaidInvoice(status: DocumentStatus): boolean {
  return status === 'sent' || status === 'partially_paid' || status === 'overdue';
}
