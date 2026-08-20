import {
  canHardDelete,
  canTransition,
  deriveStatus,
  isEditable,
  isOpenQuotation,
  isUnpaidInvoice,
  statusLabel,
  statusTone,
} from './status';
import type { DocumentStatus } from './types';

const TODAY = '2026-08-18';
const RUPEE = 100;

describe('deriveStatus — quotations (§6.4)', () => {
  it('leaves a draft alone even when past its validity', () => {
    const result = deriveStatus({
      type: 'quotation',
      storedStatus: 'draft',
      today: TODAY,
      validUntil: '2026-01-01',
    });
    expect(result.status).toBe('draft');
  });

  it('derives expired when validity has passed and it is still sent', () => {
    const result = deriveStatus({
      type: 'quotation',
      storedStatus: 'sent',
      today: TODAY,
      validUntil: '2026-08-17',
    });
    expect(result.status).toBe('expired');
    expect(result.isDerived).toBe(true);
  });

  it('does not expire on the last valid day', () => {
    const result = deriveStatus({
      type: 'quotation',
      storedStatus: 'sent',
      today: TODAY,
      validUntil: TODAY,
    });
    expect(result.status).toBe('sent');
    expect(result.isDerived).toBe(false);
  });

  it('does not expire an accepted quotation', () => {
    const result = deriveStatus({
      type: 'quotation',
      storedStatus: 'accepted',
      today: TODAY,
      validUntil: '2026-01-01',
    });
    expect(result.status).toBe('accepted');
  });

  it('does not expire a rejected or cancelled quotation', () => {
    expect(
      deriveStatus({
        type: 'quotation',
        storedStatus: 'rejected',
        today: TODAY,
        validUntil: '2026-01-01',
      }).status,
    ).toBe('rejected');
    expect(
      deriveStatus({
        type: 'quotation',
        storedStatus: 'cancelled',
        today: TODAY,
        validUntil: '2026-01-01',
      }).status,
    ).toBe('cancelled');
  });

  it('never expires a quotation with no validity date', () => {
    const result = deriveStatus({
      type: 'quotation',
      storedStatus: 'sent',
      today: TODAY,
      validUntil: null,
    });
    expect(result.status).toBe('sent');
  });
});

describe('deriveStatus — invoices (§6.4, acceptance §14.14)', () => {
  const invoice = (overrides: Partial<Parameters<typeof deriveStatus>[0]> = {}) =>
    deriveStatus({
      type: 'invoice',
      storedStatus: 'sent',
      today: TODAY,
      dueDate: '2026-09-18',
      grandTotal: 11_000 * RUPEE,
      payments: [],
      ...overrides,
    });

  it('reports the full amount outstanding when nothing is paid', () => {
    const result = invoice();
    expect(result.status).toBe('sent');
    expect(result.balance).toBe(11_000 * RUPEE);
    expect(result.paid).toBe(0);
  });

  it('acceptance test §14.14: a ₹5,000 payment on ₹11,000 → partially_paid, ₹6,000 left', () => {
    const result = invoice({ payments: [5000 * RUPEE] });
    expect(result.status).toBe('partially_paid');
    expect(result.balance).toBe(6000 * RUPEE);
    expect(result.paid).toBe(5000 * RUPEE);
  });

  it('derives paid once payments cover the total', () => {
    const result = invoice({ payments: [5000 * RUPEE, 6000 * RUPEE] });
    expect(result.status).toBe('paid');
    expect(result.balance).toBe(0);
  });

  it('treats an overpayment as paid, with a negative balance', () => {
    const result = invoice({ payments: [12_000 * RUPEE] });
    expect(result.status).toBe('paid');
    expect(result.balance).toBe(-1000 * RUPEE);
  });

  it('derives overdue when the due date has passed and money is still owed', () => {
    const result = invoice({ dueDate: '2026-08-17' });
    expect(result.status).toBe('overdue');
  });

  it('is not overdue on the due date itself', () => {
    expect(invoice({ dueDate: TODAY }).status).toBe('sent');
  });

  it('prefers paid over overdue — a settled debt is not late', () => {
    const result = invoice({ dueDate: '2026-01-01', payments: [11_000 * RUPEE] });
    expect(result.status).toBe('paid');
  });

  it('prefers overdue over partially_paid when part-paid and past due', () => {
    const result = invoice({ dueDate: '2026-01-01', payments: [5000 * RUPEE] });
    expect(result.status).toBe('overdue');
    expect(result.balance).toBe(6000 * RUPEE);
  });

  it('cancelled beats every derivation', () => {
    const result = invoice({
      storedStatus: 'cancelled',
      dueDate: '2026-01-01',
      payments: [5000 * RUPEE],
    });
    expect(result.status).toBe('cancelled');
  });

  it('a draft is never overdue', () => {
    expect(invoice({ storedStatus: 'draft', dueDate: '2026-01-01' }).status).toBe('draft');
  });

  it('a zero-total invoice is not silently "paid"', () => {
    // Guards against 0 >= 0 marking an empty draft as settled.
    const result = invoice({ grandTotal: 0, payments: [] });
    expect(result.status).not.toBe('paid');
  });

  it('is not overdue when the balance is zero even without recorded payments', () => {
    const result = invoice({ grandTotal: 0, dueDate: '2026-01-01' });
    expect(result.status).toBe('sent');
  });
});

describe('deriveStatus — receipts', () => {
  it('passes issued through unchanged', () => {
    const result = deriveStatus({ type: 'receipt', storedStatus: 'issued', today: TODAY });
    expect(result.status).toBe('issued');
    expect(result.balance).toBe(0);
  });

  it('passes cancelled through unchanged', () => {
    expect(
      deriveStatus({ type: 'receipt', storedStatus: 'cancelled', today: TODAY }).status,
    ).toBe('cancelled');
  });
});

describe('canTransition (§6.4)', () => {
  it('allows the documented quotation path', () => {
    expect(canTransition('quotation', 'draft', 'sent')).toBe(true);
    expect(canTransition('quotation', 'sent', 'accepted')).toBe(true);
    expect(canTransition('quotation', 'sent', 'rejected')).toBe(true);
  });

  it('allows the documented invoice path', () => {
    expect(canTransition('invoice', 'draft', 'sent')).toBe(true);
    expect(canTransition('invoice', 'sent', 'cancelled')).toBe(true);
  });

  it('refuses to set derived invoice statuses by hand', () => {
    expect(canTransition('invoice', 'sent', 'paid')).toBe(false);
    expect(canTransition('invoice', 'sent', 'partially_paid')).toBe(false);
    expect(canTransition('invoice', 'sent', 'overdue')).toBe(false);
  });

  it('refuses to reopen a paid or cancelled invoice', () => {
    expect(canTransition('invoice', 'paid', 'draft')).toBe(false);
    expect(canTransition('invoice', 'cancelled', 'sent')).toBe(false);
  });

  it('lets a receipt go draft → issued → cancelled and no further', () => {
    expect(canTransition('receipt', 'draft', 'issued')).toBe(true);
    expect(canTransition('receipt', 'issued', 'cancelled')).toBe(true);
    expect(canTransition('receipt', 'issued', 'draft')).toBe(false);
    expect(canTransition('receipt', 'cancelled', 'issued')).toBe(false);
  });
});

describe('isEditable / canHardDelete (§6.4)', () => {
  it('freezes an issued receipt', () => {
    expect(isEditable('receipt', 'draft')).toBe(true);
    expect(isEditable('receipt', 'issued')).toBe(false);
    expect(isEditable('receipt', 'cancelled')).toBe(false);
  });

  it('keeps quotations and invoices editable until cancelled', () => {
    expect(isEditable('quotation', 'sent')).toBe(true);
    expect(isEditable('invoice', 'partially_paid')).toBe(true);
    expect(isEditable('invoice', 'cancelled')).toBe(false);
  });

  it('forbids hard-deleting an issued receipt', () => {
    expect(canHardDelete('receipt', 'issued')).toBe(false);
    expect(canHardDelete('receipt', 'cancelled')).toBe(false);
    expect(canHardDelete('receipt', 'draft')).toBe(true);
    expect(canHardDelete('invoice', 'paid')).toBe(true);
  });
});

describe('dashboard predicates (§4.1)', () => {
  it('counts drafts and sent quotations as pending', () => {
    expect(isOpenQuotation('draft')).toBe(true);
    expect(isOpenQuotation('sent')).toBe(true);
    expect(isOpenQuotation('accepted')).toBe(false);
    expect(isOpenQuotation('expired')).toBe(false);
  });

  it('counts sent, part-paid and overdue invoices as unpaid', () => {
    expect(isUnpaidInvoice('sent')).toBe(true);
    expect(isUnpaidInvoice('partially_paid')).toBe(true);
    expect(isUnpaidInvoice('overdue')).toBe(true);
    expect(isUnpaidInvoice('paid')).toBe(false);
    expect(isUnpaidInvoice('draft')).toBe(false);
    expect(isUnpaidInvoice('cancelled')).toBe(false);
  });
});

describe('status presentation', () => {
  const all: DocumentStatus[] = [
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
  ];

  it('gives every status a human label and a tone', () => {
    for (const status of all) {
      expect(statusLabel(status)).not.toBe('');
      expect(statusLabel(status)).not.toContain('_');
      expect(['neutral', 'info', 'positive', 'warning', 'danger']).toContain(statusTone(status));
    }
  });

  it('tones the alarming statuses as alarming', () => {
    expect(statusTone('overdue')).toBe('danger');
    expect(statusTone('paid')).toBe('positive');
    expect(statusTone('draft')).toBe('neutral');
  });
});
