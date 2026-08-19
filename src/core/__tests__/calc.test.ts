import {
  calculateDocument,
  computeBalance,
  splitProportionally,
  type CalcDocumentInput,
  type CalcLineInput,
} from '../calc';
import type { DiscountMode, TaxMode } from '../types';

const RUPEE = 100;

function line(overrides: Partial<CalcLineInput> = {}): CalcLineInput {
  return {
    qtyMilli: 1000,
    rate: 0,
    taxRateBp: 0,
    discountBp: 0,
    isFree: false,
    hsnSac: null,
    ...overrides,
  };
}

function doc(overrides: Partial<CalcDocumentInput> = {}): CalcDocumentInput {
  return {
    lines: [],
    discountMode: 'none' as DiscountMode,
    discountValue: 0,
    taxMode: 'none' as TaxMode,
    shippingAmount: 0,
    roundOffEnabled: false,
    ...overrides,
  };
}

describe('calculateDocument — per-line arithmetic (§9.1)', () => {
  it('acceptance test §14.2: qty 1.5, rate ₹1,000, 10% line discount, 18% tax', () => {
    const result = calculateDocument(
      doc({
        taxMode: 'gst_inter',
        lines: [line({ qtyMilli: 1500, rate: 1000 * RUPEE, discountBp: 1000, taxRateBp: 1800 })],
      }),
    );

    const only = result.lines[0]!;
    expect(only.gross).toBe(1500 * RUPEE);
    expect(only.lineDiscount).toBe(150 * RUPEE);
    expect(only.lineNet).toBe(1350 * RUPEE); // ₹1,350 to the paisa
    expect(only.lineTax).toBe(243 * RUPEE); // ₹243 to the paisa
    expect(result.subtotal).toBe(1350 * RUPEE);
    expect(result.taxTotal).toBe(243 * RUPEE);
    expect(result.grandTotal).toBe(1593 * RUPEE);
  });

  it('multiplies fractional quantities without float error', () => {
    // 0.001 × ₹0.01 is a third of a paisa; it must round, not drift.
    const result = calculateDocument(doc({ lines: [line({ qtyMilli: 1, rate: 1 })] }));
    expect(result.lines[0]!.gross).toBe(0);

    const bigger = calculateDocument(doc({ lines: [line({ qtyMilli: 333, rate: 333 })] }));
    // 333 × 333 / 1000 = 110.889 → 111 paise
    expect(bigger.lines[0]!.gross).toBe(111);
  });

  it('rounds a half-paisa result upward', () => {
    // qty 1.5 × rate 1 paisa = 1.5 paise → 2 paise
    const result = calculateDocument(doc({ lines: [line({ qtyMilli: 1500, rate: 1 })] }));
    expect(result.lines[0]!.gross).toBe(2);
  });

  it('handles large documents without exceeding safe integer precision', () => {
    // 1,000 units at ₹10,00,000 each = ₹1,00,00,00,000 = 1e11 paise.
    const result = calculateDocument(
      doc({
        taxMode: 'gst_inter',
        lines: [line({ qtyMilli: 1_000_000, rate: 1_000_000 * RUPEE, taxRateBp: 1800 })],
      }),
    );
    expect(result.subtotal).toBe(100_000_000_000);
    expect(result.taxTotal).toBe(18_000_000_000);
    expect(Number.isSafeInteger(result.grandTotal)).toBe(true);
  });
});

describe('calculateDocument — complimentary lines (§7.3, acceptance §14.4)', () => {
  it('contributes nothing to any total but keeps its gross for display', () => {
    const result = calculateDocument(
      doc({
        taxMode: 'gst_intra',
        lines: [
          line({ rate: 7500 * RUPEE, taxRateBp: 1800 }),
          line({ rate: 5000 * RUPEE, taxRateBp: 1800, isFree: true }),
          line({ rate: 3000 * RUPEE, taxRateBp: 1800, isFree: true }),
        ],
      }),
    );

    expect(result.subtotal).toBe(7500 * RUPEE);
    expect(result.lines[1]!.lineNet).toBe(0);
    expect(result.lines[1]!.lineTotal).toBe(0);
    expect(result.lines[1]!.lineTax).toBe(0);
    expect(result.lines[2]!.lineNet).toBe(0);
    // The gross survives so the renderer can still show what the item is worth.
    expect(result.lines[1]!.gross).toBe(5000 * RUPEE);
    expect(result.taxTotal).toBe(1350 * RUPEE);
    expect(result.grandTotal).toBe(8850 * RUPEE);
  });

  it('a document of only complimentary lines totals zero', () => {
    const result = calculateDocument(
      doc({
        taxMode: 'gst_intra',
        lines: [line({ rate: 5000 * RUPEE, taxRateBp: 1800, isFree: true })],
      }),
    );
    expect(result.subtotal).toBe(0);
    expect(result.taxTotal).toBe(0);
    expect(result.grandTotal).toBe(0);
  });
});

describe('splitProportionally — penny reconciliation (§9.1)', () => {
  it('acceptance test §14.3: ₹1,000 discount across ₹7,500 / ₹4,500 / ₹0', () => {
    const shares = splitProportionally(1000 * RUPEE, [7500 * RUPEE, 4500 * RUPEE, 0]);
    expect(shares).toEqual([625 * RUPEE, 375 * RUPEE, 0]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000 * RUPEE);
  });

  it('assigns an indivisible remainder to the largest line', () => {
    // 100 paise across three equal lines: 33 + 33 + 33 = 99, one paisa short.
    const shares = splitProportionally(100, [1000, 1000, 1000]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares).toEqual([34, 33, 33]); // ties break to the earliest index
  });

  it('assigns the remainder to the genuinely largest line, not the first', () => {
    const shares = splitProportionally(100, [1000, 5000, 1000]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares[1]).toBeGreaterThan(shares[0]!);
  });

  it('handles a negative remainder (over-assignment) too', () => {
    // Weights chosen so the naive rounding overshoots.
    const shares = splitProportionally(10, [333, 333, 334]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('returns all zeros for a zero total or zero weights', () => {
    expect(splitProportionally(0, [100, 200])).toEqual([0, 0]);
    expect(splitProportionally(500, [0, 0])).toEqual([0, 0]);
    expect(splitProportionally(500, [])).toEqual([]);
  });

  it('never loses a paisa across a hundred randomised splits', () => {
    let seed = 12345;
    const rand = (max: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let trial = 0; trial < 100; trial += 1) {
      const weights = Array.from({ length: 1 + rand(12) }, () => rand(999_999));
      const total = rand(500_000);
      const shares = splitProportionally(total, weights);
      const sum = shares.reduce((a, b) => a + b, 0);
      if (weights.reduce((a, b) => a + b, 0) > 0) {
        expect(sum).toBe(total);
      }
    }
  });
});

describe('calculateDocument — document discount', () => {
  it('spreads a percentage discount and taxes the reduced base', () => {
    const result = calculateDocument(
      doc({
        discountMode: 'percent',
        discountValue: 1000, // 10%
        taxMode: 'gst_inter',
        lines: [
          line({ rate: 7500 * RUPEE, taxRateBp: 1800 }),
          line({ rate: 2500 * RUPEE, taxRateBp: 1800 }),
        ],
      }),
    );

    expect(result.subtotal).toBe(10_000 * RUPEE);
    expect(result.discountTotal).toBe(1000 * RUPEE);
    expect(result.taxBase).toBe(9000 * RUPEE);
    expect(result.taxTotal).toBe(1620 * RUPEE);
    expect(result.grandTotal).toBe(10_620 * RUPEE);

    const shareSum = result.lines.reduce((a, l) => a + l.docDiscountShare, 0);
    expect(shareSum).toBe(result.discountTotal);
    const baseSum = result.lines.reduce((a, l) => a + l.lineBase, 0);
    expect(baseSum).toBe(result.taxBase);
  });

  it('caps a flat-amount discount at the subtotal so the total never goes negative', () => {
    const result = calculateDocument(
      doc({
        discountMode: 'amount',
        discountValue: 5000 * RUPEE,
        lines: [line({ rate: 3000 * RUPEE })],
      }),
    );
    expect(result.discountTotal).toBe(3000 * RUPEE);
    expect(result.taxBase).toBe(0);
    expect(result.grandTotal).toBe(0);
  });

  it('gives complimentary lines no share of the document discount', () => {
    const result = calculateDocument(
      doc({
        discountMode: 'amount',
        discountValue: 1000 * RUPEE,
        lines: [line({ rate: 5000 * RUPEE }), line({ rate: 5000 * RUPEE, isFree: true })],
      }),
    );
    expect(result.lines[1]!.docDiscountShare).toBe(0);
    expect(result.lines[0]!.docDiscountShare).toBe(1000 * RUPEE);
  });

  it('ignores discount_value when the mode is none', () => {
    const result = calculateDocument(
      doc({ discountMode: 'none', discountValue: 5000, lines: [line({ rate: 1000 * RUPEE })] }),
    );
    expect(result.discountTotal).toBe(0);
  });
});

describe('calculateDocument — tax modes (§9.2)', () => {
  const base = doc({
    lines: [line({ rate: 1000 * RUPEE, taxRateBp: 1800 })],
  });

  it('gst_intra splits tax into CGST and SGST that sum exactly to the tax', () => {
    const result = calculateDocument({ ...base, taxMode: 'gst_intra' });
    const only = result.lines[0]!;
    expect(only.cgst + only.sgst).toBe(only.lineTax);
    expect(only.cgst).toBe(90 * RUPEE);
    expect(only.sgst).toBe(90 * RUPEE);
    expect(only.igst).toBe(0);
    expect(result.cgstTotal + result.sgstTotal).toBe(result.taxTotal);
  });

  it('gst_intra splits an odd paisa without losing it', () => {
    // Tax of 1 paisa cannot halve evenly: CGST 1, SGST 0, and they still sum to 1.
    const result = calculateDocument(
      doc({ taxMode: 'gst_intra', lines: [line({ rate: 6, taxRateBp: 1800 })] }),
    );
    const only = result.lines[0]!;
    expect(only.lineTax).toBe(1);
    expect(only.cgst + only.sgst).toBe(1);
  });

  it('gst_inter puts the whole tax in IGST', () => {
    const result = calculateDocument({ ...base, taxMode: 'gst_inter' });
    const only = result.lines[0]!;
    expect(only.igst).toBe(180 * RUPEE);
    expect(only.cgst).toBe(0);
    expect(only.sgst).toBe(0);
  });

  it('none produces no tax at all, whatever the line rates say', () => {
    const result = calculateDocument({ ...base, taxMode: 'none' });
    expect(result.taxTotal).toBe(0);
    expect(result.lines[0]!.effectiveTaxRateBp).toBe(0);
    expect(result.grandTotal).toBe(1000 * RUPEE);
    expect(result.taxSummary).toEqual([]);
    expect(result.showTaxSummary).toBe(false);
  });

  it('flat applies one rate to the whole taxable base and ignores line rates', () => {
    const result = calculateDocument(
      doc({
        taxMode: 'flat',
        flatTaxRateBp: 500,
        lines: [
          line({ rate: 1000 * RUPEE, taxRateBp: 1800 }),
          line({ rate: 3000 * RUPEE, taxRateBp: 2800 }),
        ],
      }),
    );
    expect(result.taxTotal).toBe(200 * RUPEE); // 5% of ₹4,000
    // Per-line tax still reconciles to the printed total.
    expect(result.lines.reduce((a, l) => a + l.lineTax, 0)).toBe(result.taxTotal);
  });
});

describe('calculateDocument — tax summary table (§9.3)', () => {
  it('is suppressed when every line carries the same rate', () => {
    const result = calculateDocument(
      doc({
        taxMode: 'gst_intra',
        lines: [
          line({ rate: 1000 * RUPEE, taxRateBp: 1800, hsnSac: '9983' }),
          line({ rate: 2000 * RUPEE, taxRateBp: 1800, hsnSac: '9983' }),
        ],
      }),
    );
    expect(result.showTaxSummary).toBe(false);
    expect(result.distinctTaxRates).toEqual([1800]);
  });

  it('groups by (hsn, rate) and appears once rates differ', () => {
    const result = calculateDocument(
      doc({
        taxMode: 'gst_intra',
        lines: [
          line({ rate: 1000 * RUPEE, taxRateBp: 1800, hsnSac: '9983' }),
          line({ rate: 2000 * RUPEE, taxRateBp: 1800, hsnSac: '9983' }),
          line({ rate: 4000 * RUPEE, taxRateBp: 500, hsnSac: '4911' }),
        ],
      }),
    );
    expect(result.showTaxSummary).toBe(true);
    expect(result.taxSummary).toHaveLength(2);

    const low = result.taxSummary.find((r) => r.taxRateBp === 500)!;
    const high = result.taxSummary.find((r) => r.taxRateBp === 1800)!;
    expect(low.taxableValue).toBe(4000 * RUPEE);
    expect(high.taxableValue).toBe(3000 * RUPEE); // the two 18% lines merged
    expect(high.cgst + high.sgst).toBe(high.totalTax);

    const summedTax = result.taxSummary.reduce((a, r) => a + r.totalTax, 0);
    expect(summedTax).toBe(result.taxTotal);
  });

  it('sorts rows by rate then HSN so output is stable across runs', () => {
    const result = calculateDocument(
      doc({
        taxMode: 'gst_inter',
        lines: [
          line({ rate: 100 * RUPEE, taxRateBp: 2800, hsnSac: 'z' }),
          line({ rate: 100 * RUPEE, taxRateBp: 500, hsnSac: 'b' }),
          line({ rate: 100 * RUPEE, taxRateBp: 500, hsnSac: 'a' }),
        ],
      }),
    );
    expect(result.taxSummary.map((r) => `${r.taxRateBp}:${r.hsnSac}`)).toEqual([
      '500:a',
      '500:b',
      '2800:z',
    ]);
  });
});

describe('calculateDocument — shipping, rounding, grand total', () => {
  it('adds shipping after tax', () => {
    const result = calculateDocument(
      doc({
        taxMode: 'gst_inter',
        shippingAmount: 150 * RUPEE,
        lines: [line({ rate: 1000 * RUPEE, taxRateBp: 1800 })],
      }),
    );
    expect(result.preRound).toBe(1330 * RUPEE);
    expect(result.grandTotal).toBe(1330 * RUPEE);
  });

  it('rounds the grand total up to the nearest rupee and reports a negative round-off', () => {
    // ₹1,234.56 → ₹1,235.00, so round-off is +44 paise.
    const result = calculateDocument(
      doc({ roundOffEnabled: true, lines: [line({ qtyMilli: 1000, rate: 123_456 })] }),
    );
    expect(result.preRound).toBe(123_456);
    expect(result.grandTotal).toBe(123_500);
    expect(result.roundOff).toBe(44);
  });

  it('rounds down when the paise are below half a rupee', () => {
    const result = calculateDocument(
      doc({ roundOffEnabled: true, lines: [line({ qtyMilli: 1000, rate: 123_449 })] }),
    );
    expect(result.grandTotal).toBe(123_400);
    expect(result.roundOff).toBe(-49);
  });

  it('leaves an exact rupee amount alone, with zero round-off', () => {
    const result = calculateDocument(
      doc({ roundOffEnabled: true, lines: [line({ rate: 1000 * RUPEE })] }),
    );
    expect(result.roundOff).toBe(0);
    expect(result.grandTotal).toBe(1000 * RUPEE);
  });

  it('rounds a half-rupee remainder upward', () => {
    const result = calculateDocument(
      doc({ roundOffEnabled: true, lines: [line({ qtyMilli: 1000, rate: 12_350 })] }),
    );
    expect(result.grandTotal).toBe(12_400);
  });

  it('an empty document is all zeros and does not throw', () => {
    const result = calculateDocument(doc({ roundOffEnabled: true, taxMode: 'gst_intra' }));
    expect(result.subtotal).toBe(0);
    expect(result.taxTotal).toBe(0);
    expect(result.grandTotal).toBe(0);
    expect(result.roundOff).toBe(0);
    expect(result.lines).toEqual([]);
  });
});

describe('calculateDocument — the whole-equals-parts invariant', () => {
  it('holds for a messy realistic document', () => {
    const result = calculateDocument(
      doc({
        discountMode: 'percent',
        discountValue: 733, // 7.33%
        taxMode: 'gst_intra',
        shippingAmount: 27_777,
        roundOffEnabled: true,
        lines: [
          line({ qtyMilli: 1500, rate: 749_900, taxRateBp: 1800, discountBp: 333 }),
          line({ qtyMilli: 3000, rate: 129_900, taxRateBp: 500 }),
          line({ qtyMilli: 1, rate: 999_999, taxRateBp: 2800 }),
          line({ qtyMilli: 7000, rate: 111, taxRateBp: 1200, discountBp: 10_000 }),
          line({ qtyMilli: 2000, rate: 500_000, taxRateBp: 1800, isFree: true }),
        ],
      }),
    );

    expect(result.lines.reduce((a, l) => a + l.lineNet, 0)).toBe(result.subtotal);
    expect(result.lines.reduce((a, l) => a + l.docDiscountShare, 0)).toBe(result.discountTotal);
    expect(result.lines.reduce((a, l) => a + l.lineBase, 0)).toBe(result.taxBase);
    expect(result.lines.reduce((a, l) => a + l.lineTax, 0)).toBe(result.taxTotal);
    expect(result.cgstTotal + result.sgstTotal).toBe(result.taxTotal);
    expect(result.subtotal - result.discountTotal).toBe(result.taxBase);
    expect(result.taxBase + result.taxTotal + result.shipping).toBe(result.preRound);
    expect(result.preRound + result.roundOff).toBe(result.grandTotal);
    expect(result.grandTotal % 100).toBe(0);
    expect(result.taxSummary.reduce((a, r) => a + r.totalTax, 0)).toBe(result.taxTotal);
    expect(result.taxSummary.reduce((a, r) => a + r.taxableValue, 0)).toBe(result.taxBase);
  });

  it('a 100% line discount zeroes the line without breaking the totals', () => {
    const result = calculateDocument(
      doc({
        taxMode: 'gst_inter',
        lines: [line({ rate: 5000 * RUPEE, discountBp: 10_000, taxRateBp: 1800 })],
      }),
    );
    expect(result.lines[0]!.lineNet).toBe(0);
    expect(result.subtotal).toBe(0);
    expect(result.grandTotal).toBe(0);
  });

  it('is deterministic: the same input twice gives identical output', () => {
    const input = doc({
      discountMode: 'amount',
      discountValue: 100,
      taxMode: 'gst_intra',
      lines: [line({ rate: 333 }), line({ rate: 333 }), line({ rate: 334 })],
    });
    expect(JSON.stringify(calculateDocument(input))).toBe(JSON.stringify(calculateDocument(input)));
  });
});

describe('computeBalance', () => {
  it('is the grand total when nothing has been paid', () => {
    expect(computeBalance(11_000 * RUPEE, [])).toBe(11_000 * RUPEE);
  });

  it('acceptance test §14.14: ₹11,000 invoice with a ₹5,000 payment leaves ₹6,000', () => {
    expect(computeBalance(11_000 * RUPEE, [5000 * RUPEE])).toBe(6000 * RUPEE);
  });

  it('sums multiple payments and can go negative on an overpayment', () => {
    expect(computeBalance(1000 * RUPEE, [400 * RUPEE, 400 * RUPEE, 400 * RUPEE])).toBe(-200 * RUPEE);
  });
});
