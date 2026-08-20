/**
 * The document calculation engine — spec §9, implemented literally.
 *
 * Pure. No React, no database, no I/O. Given a document's inputs it returns every
 * number that will ever be printed, so the renderer and the DB layer never do
 * arithmetic of their own.
 *
 * The one invariant that governs the whole file: **a document's parts always sum
 * exactly to its whole.** Every proportional split therefore ends with a
 * reconciliation pass that pushes the rounding remainder onto the largest line
 * (§9.1 "Penny reconciliation"). If you change anything here, the reconciliation
 * tests are the ones to watch.
 */

import { applyBasisPoints, mulDivRound, multiplyQuantity, roundToNearestRupee } from './money';
import type { BasisPoints, DiscountMode, Milli, Paise, TaxMode } from './types';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The only line fields that affect money. Deliberately narrower than the DB row. */
export interface CalcLineInput {
  /** Quantity in thousandths. 1500 = 1.5. */
  qtyMilli: Milli;
  /** Unit rate in paise. */
  rate: Paise;
  /** Per-line tax rate in basis points. 1800 = 18%. */
  taxRateBp: BasisPoints;
  /** Per-line discount in basis points. */
  discountBp: BasisPoints;
  /** Complimentary line: prints "FREE", contributes nothing (§7.3). */
  isFree: boolean;
  /** Grouping key for the HSN-wise tax summary (§9.3). */
  hsnSac?: string | null;
}

export interface CalcDocumentInput {
  lines: readonly CalcLineInput[];
  discountMode: DiscountMode;
  /** Basis points when `discountMode` is 'percent', paise when 'amount'. */
  discountValue: number;
  taxMode: TaxMode;
  /**
   * Single rate applied to the whole taxable base when `taxMode` is 'flat'.
   *
   * SPEC ADDITION: §9.2 defines a 'flat' tax mode as "one Tax row at a single rate
   * applied to taxBase", but §5.4 has no column to hold that rate. Added as
   * `documents.flat_tax_rate_bp` via migration 2 rather than guessing from the line
   * items, which would not be a single rate at all. Flagged in the phase report.
   */
  flatTaxRateBp?: BasisPoints;
  /** Shipping / delivery charge in paise. */
  shippingAmount: Paise;
  /** Round the grand total to the nearest rupee. */
  roundOffEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface CalcLineResult {
  /** Index into the input array, so callers can zip results back onto their rows. */
  index: number;
  /** qty × rate, before any discount. */
  gross: Paise;
  /** Per-line discount amount. */
  lineDiscount: Paise;
  /** gross − lineDiscount, forced to 0 for complimentary lines. */
  lineNet: Paise;
  /** Stored on the line as `line_total`. Equal to `lineNet`. */
  lineTotal: Paise;
  /** This line's proportional share of the document-level discount. */
  docDiscountShare: Paise;
  /** lineNet − docDiscountShare. The taxable value of this line. */
  lineBase: Paise;
  /** Tax on `lineBase`. */
  lineTax: Paise;
  /** Half of `lineTax`, rounded up, when taxMode is gst_intra. Else 0. */
  cgst: Paise;
  /** The remainder of `lineTax` after CGST, when taxMode is gst_intra. Else 0. */
  sgst: Paise;
  /** Equal to `lineTax` when taxMode is gst_inter. Else 0. */
  igst: Paise;
  /** The rate actually applied to this line, after taxMode overrides. */
  effectiveTaxRateBp: BasisPoints;
}

export interface TaxSummaryRow {
  hsnSac: string;
  taxRateBp: BasisPoints;
  taxableValue: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  totalTax: Paise;
}

export interface CalcResult {
  lines: readonly CalcLineResult[];
  /** Σ lineNet. */
  subtotal: Paise;
  /** The document-level discount actually applied (capped at subtotal for 'amount'). */
  discountTotal: Paise;
  /** subtotal − discountTotal. */
  taxBase: Paise;
  /** Σ lineTax. */
  taxTotal: Paise;
  cgstTotal: Paise;
  sgstTotal: Paise;
  igstTotal: Paise;
  shipping: Paise;
  /** taxBase + taxTotal + shipping, before rounding. */
  preRound: Paise;
  /** Signed. grandTotal − preRound. Printed only when non-zero. */
  roundOff: Paise;
  grandTotal: Paise;
  /** Only meaningful when more than one distinct rate appears (§9.3). */
  taxSummary: readonly TaxSummaryRow[];
  /** True when the summary table should be printed at all. */
  showTaxSummary: boolean;
  /** Distinct non-zero tax rates present across the lines. */
  distinctTaxRates: readonly BasisPoints[];
}

// ---------------------------------------------------------------------------
// Proportional split with exact reconciliation
// ---------------------------------------------------------------------------

/**
 * Split `total` across `weights` proportionally, guaranteeing the parts sum to
 * `total` exactly.
 *
 * The naive `round(total × weight / Σweights)` per element can drift by a few units.
 * §9.1 fixes the remedy: give the difference to the largest line. Ties break toward
 * the earliest index so the result is deterministic — two runs of the same document
 * must produce byte-identical output, otherwise the export cache in §10.5 would
 * thrash and stored totals could disagree with recomputed ones.
 */
export function splitProportionally(total: Paise, weights: readonly Paise[]): Paise[] {
  const shares = new Array<Paise>(weights.length).fill(0);
  if (weights.length === 0 || total === 0) return shares;

  const sumWeights = weights.reduce((acc, w) => acc + w, 0);
  if (sumWeights === 0) return shares;

  let assigned = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const weight = weights[i] ?? 0;
    const share = mulDivRound(total, weight, sumWeights);
    shares[i] = share;
    assigned += share;
  }

  const remainder = total - assigned;
  if (remainder !== 0) {
    let largestIndex = -1;
    let largestWeight = -Infinity;
    for (let i = 0; i < weights.length; i += 1) {
      const weight = weights[i] ?? 0;
      if (weight > largestWeight) {
        largestWeight = weight;
        largestIndex = i;
      }
    }
    if (largestIndex >= 0) {
      shares[largestIndex] = (shares[largestIndex] ?? 0) + remainder;
    }
  }

  return shares;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function calculateDocument(input: CalcDocumentInput): CalcResult {
  const {
    lines,
    discountMode,
    discountValue,
    taxMode,
    flatTaxRateBp = 0,
    shippingAmount,
    roundOffEnabled,
  } = input;

  // --- Per line, before the document discount is known (§9.1) ------------------
  const gross: Paise[] = [];
  const lineDiscount: Paise[] = [];
  const lineNet: Paise[] = [];

  for (const line of lines) {
    const g = multiplyQuantity(line.qtyMilli, line.rate);
    const d = applyBasisPoints(g, line.discountBp);
    gross.push(g);
    lineDiscount.push(d);
    lineNet.push(line.isFree ? 0 : g - d);
  }

  const subtotal = lineNet.reduce((acc, n) => acc + n, 0);

  // --- Document-level discount ------------------------------------------------
  let discountTotal: Paise;
  if (discountMode === 'percent') {
    discountTotal = applyBasisPoints(subtotal, discountValue);
  } else if (discountMode === 'amount') {
    // Never discount below zero: a ₹5,000 discount on a ₹3,000 document is ₹3,000.
    discountTotal = Math.min(discountValue, subtotal);
  } else {
    discountTotal = 0;
  }
  if (discountTotal < 0) discountTotal = 0;

  const taxBase = subtotal - discountTotal;

  // --- Spread the document discount across lines, then tax each line -----------
  const docDiscountShares = splitProportionally(discountTotal, lineNet);

  const lineBase: Paise[] = [];
  const effectiveRates: BasisPoints[] = [];
  const lineTax: Paise[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const net = lineNet[i] ?? 0;
    const share = docDiscountShares[i] ?? 0;
    const base = net - share;
    lineBase.push(base);

    // In 'flat' mode every line carries the single document rate; in 'none' mode no
    // line carries any. Only the GST modes honour the per-line rate.
    const rate =
      taxMode === 'none' ? 0 : taxMode === 'flat' ? flatTaxRateBp : (line?.taxRateBp ?? 0);
    effectiveRates.push(rate);
    lineTax.push(applyBasisPoints(base, rate));
  }

  let taxTotal = lineTax.reduce((acc, t) => acc + t, 0);

  // In flat mode the authoritative figure is the one rate applied to the whole taxable
  // base (§9.2), not the sum of per-line roundings. Reconcile the per-line values onto
  // that figure so the printed lines still add up to the printed tax row.
  if (taxMode === 'flat') {
    const flatTax = applyBasisPoints(taxBase, flatTaxRateBp);
    const reconciled = splitProportionally(flatTax, lineBase);
    for (let i = 0; i < reconciled.length; i += 1) lineTax[i] = reconciled[i] ?? 0;
    taxTotal = flatTax;
  }

  // --- CGST / SGST / IGST -----------------------------------------------------
  const cgst: Paise[] = [];
  const sgst: Paise[] = [];
  const igst: Paise[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const tax = lineTax[i] ?? 0;
    if (taxMode === 'gst_intra') {
      // Halve the computed tax rather than applying half the rate twice. Halving the
      // result guarantees CGST + SGST === lineTax to the paisa; applying half a rate
      // to the base twice can drift by 1 paisa on odd amounts.
      const half = mulDivRound(tax, 1, 2);
      cgst.push(half);
      sgst.push(tax - half);
      igst.push(0);
    } else if (taxMode === 'gst_inter') {
      cgst.push(0);
      sgst.push(0);
      igst.push(tax);
    } else {
      cgst.push(0);
      sgst.push(0);
      igst.push(0);
    }
  }

  // --- Totals and rounding ----------------------------------------------------
  const shipping = shippingAmount;
  const preRound = taxBase + taxTotal + shipping;
  const grandTotal = roundOffEnabled ? roundToNearestRupee(preRound) : preRound;
  const roundOff = grandTotal - preRound;

  const lineResults: CalcLineResult[] = lines.map((_line, i) => ({
    index: i,
    gross: gross[i] ?? 0,
    lineDiscount: lineDiscount[i] ?? 0,
    lineNet: lineNet[i] ?? 0,
    lineTotal: lineNet[i] ?? 0,
    docDiscountShare: docDiscountShares[i] ?? 0,
    lineBase: lineBase[i] ?? 0,
    lineTax: lineTax[i] ?? 0,
    cgst: cgst[i] ?? 0,
    sgst: sgst[i] ?? 0,
    igst: igst[i] ?? 0,
    effectiveTaxRateBp: effectiveRates[i] ?? 0,
  }));

  // --- HSN-wise tax summary (§9.3) --------------------------------------------
  const { rows: taxSummary, distinctRates } = buildTaxSummary(lines, lineResults, taxMode);

  return {
    lines: lineResults,
    subtotal,
    discountTotal,
    taxBase,
    taxTotal,
    cgstTotal: cgst.reduce((a, v) => a + v, 0),
    sgstTotal: sgst.reduce((a, v) => a + v, 0),
    igstTotal: igst.reduce((a, v) => a + v, 0),
    shipping,
    preRound,
    roundOff,
    grandTotal,
    taxSummary,
    // Printed only when the lines genuinely carry different rates — a single-rate
    // document already states its rate in the totals block, so the table would just
    // repeat it.
    showTaxSummary: taxMode !== 'none' && distinctRates.length > 1,
    distinctTaxRates: distinctRates,
  };
}

function buildTaxSummary(
  lines: readonly CalcLineInput[],
  results: readonly CalcLineResult[],
  taxMode: TaxMode,
): { rows: TaxSummaryRow[]; distinctRates: BasisPoints[] } {
  const grouped = new Map<string, TaxSummaryRow>();
  const rates = new Set<BasisPoints>();

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    if (!result) continue;
    const rate = result.effectiveTaxRateBp;
    if (rate > 0) rates.add(rate);

    const hsn = (lines[i]?.hsnSac ?? '').trim();
    const key = `${hsn}::${rate}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.taxableValue += result.lineBase;
      existing.cgst += result.cgst;
      existing.sgst += result.sgst;
      existing.igst += result.igst;
      existing.totalTax += result.lineTax;
    } else {
      grouped.set(key, {
        hsnSac: hsn,
        taxRateBp: rate,
        taxableValue: result.lineBase,
        cgst: result.cgst,
        sgst: result.sgst,
        igst: result.igst,
        totalTax: result.lineTax,
      });
    }
  }

  const rows = [...grouped.values()].sort(
    (a, b) => a.taxRateBp - b.taxRateBp || a.hsnSac.localeCompare(b.hsnSac),
  );
  const distinctRates = [...rates].sort((a, b) => a - b);
  return { rows: taxMode === 'none' ? [] : rows, distinctRates };
}

/**
 * The balance still owed on an invoice: grand total minus everything received.
 * Kept here rather than in the repository so §6.4's status derivation is testable
 * without a database.
 */
export function computeBalance(grandTotal: Paise, payments: readonly Paise[]): Paise {
  const paid = payments.reduce((acc, p) => acc + p, 0);
  return grandTotal - paid;
}
