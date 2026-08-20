/**
 * Integer money and quantity arithmetic.
 *
 * Every value that represents money in this app is an integer number of paise.
 * Every quantity is an integer number of thousandths. Nothing here uses floating
 * point for a value that will be stored or printed.
 *
 * `parseCurrencyToPaise` and `parseQuantityToMilli` are the ONLY functions in the
 * codebase permitted to interpret a human-typed decimal string (spec §16.5). They do it
 * by string surgery rather than `parseFloat`, so "7500.50" cannot become 7500.499999.
 */

import type { BasisPoints, Milli, Paise } from './types';

/**
 * Round half away from zero.
 *
 * Spec §9 says "half-up at every step where a division occurs". For the non-negative
 * values that dominate this app, half-up and half-away-from-zero are the same thing.
 * They differ only for negatives, where `Math.round` is asymmetric (`Math.round(-0.5)`
 * is `-0`, not `-1`). Symmetry matters because a negative adjustment must round to the
 * same magnitude as its positive twin, otherwise an amount and its reversal would not
 * cancel exactly.
 */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`roundHalfUp received ${value}`);
  return value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, received ${value}`);
  }
}

/**
 * Exact `round(value * numerator / denominator)` with half-up rounding.
 *
 * Uses BigInt for the intermediate product. `qty_milli × rate` can exceed
 * `Number.MAX_SAFE_INTEGER` for large-but-legitimate documents, and the ×10000
 * basis-point scaling on top of that overflows sooner still. A silent precision loss in
 * the money path is exactly the class of bug this spec was written to prevent.
 *
 * `floor((2·a + d) / (2·d))` is `floor(a/d + 1/2)`, i.e. half-up, computed in integers.
 */
export function mulDivRound(value: number, numerator: number, denominator: number): number {
  assertSafeInteger(value, 'mulDivRound value');
  assertSafeInteger(numerator, 'mulDivRound numerator');
  assertSafeInteger(denominator, 'mulDivRound denominator');
  if (denominator === 0) throw new RangeError('mulDivRound denominator must not be zero');

  const product = BigInt(value) * BigInt(numerator);
  const divisor = BigInt(denominator);
  const negative = product < 0n !== divisor < 0n;
  const absProduct = product < 0n ? -product : product;
  const absDivisor = divisor < 0n ? -divisor : divisor;
  const quotient = (absProduct * 2n + absDivisor) / (absDivisor * 2n);
  const result = negative ? -quotient : quotient;

  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('mulDivRound result exceeds safe integer range');
  }
  return Number(result);
}

/** Apply a basis-point rate to an integer amount. 1800 bp of 10000 paise is 1800 paise. */
export function applyBasisPoints(amount: Paise, rateBp: BasisPoints): Paise {
  return mulDivRound(amount, rateBp, 10_000);
}

/** qty (in milli) × rate (in paise) → paise. */
export function multiplyQuantity(qtyMilli: Milli, rate: Paise): Paise {
  return mulDivRound(qtyMilli, rate, 1000);
}

/** Round a paise amount to the nearest whole rupee (100 paise), half-up. */
export function roundToNearestRupee(amount: Paise): Paise {
  return mulDivRound(amount, 1, 100) * 100;
}

// ---------------------------------------------------------------------------
// Parsing — the only place allowed to read a human-typed decimal (§16.5)
// ---------------------------------------------------------------------------

/**
 * Turn a human-typed amount into integer paise, or `null` if it cannot be read.
 *
 * Accepts "7500", "7,500", "7500.50", "₹7,500.50", "  7500.5 ", "-250", ".5", "7500.".
 * Rejects "", "abc", "1.2.3", "--5".
 *
 * A third decimal place is truncated rather than rounded, because a user mid-typing
 * "7500.509" should not see their input silently jump to 7500.51. Truncation never
 * invents money; the value is normalised on blur anyway.
 */
export function parseCurrencyToPaise(input: string | number | null | undefined): Paise | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? roundHalfUp(input * 100) : null;
  }
  if (input == null) return null;

  const cleaned = input.replace(/[\s,₹]/g, '').replace(/^\+/, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;

  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  if (!/^\d*(\.\d*)?$/.test(unsigned)) return null;

  const parts = unsigned.split('.');
  const wholePart = parts[0] ?? '';
  const fracPart = parts[1] ?? '';
  const whole = wholePart === '' ? 0 : Number(wholePart);
  if (!Number.isSafeInteger(whole)) return null;
  const frac = Number((fracPart + '00').slice(0, 2));
  const paise = whole * 100 + frac;
  if (!Number.isSafeInteger(paise)) return null;
  return negative ? -paise : paise;
}

/** Turn a human-typed quantity into integer milli-units, or `null`. Supports 3 decimals. */
export function parseQuantityToMilli(input: string | number | null | undefined): Milli | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? roundHalfUp(input * 1000) : null;
  }
  if (input == null) return null;

  const cleaned = input.replace(/[\s,]/g, '').replace(/^\+/, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '-' || cleaned === '-.') return null;

  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  if (!/^\d*(\.\d*)?$/.test(unsigned)) return null;

  const parts = unsigned.split('.');
  const wholePart = parts[0] ?? '';
  const fracPart = parts[1] ?? '';
  const whole = wholePart === '' ? 0 : Number(wholePart);
  if (!Number.isSafeInteger(whole)) return null;
  const frac = Number((fracPart + '000').slice(0, 3));
  const milli = whole * 1000 + frac;
  if (!Number.isSafeInteger(milli)) return null;
  return negative ? -milli : milli;
}

/**
 * Read a percentage like "18", "18.5", "18 %" into basis points.
 *
 * A percentage with two decimal places maps onto basis points exactly the way rupees
 * map onto paise — 18.5% is 1850 bp just as ₹18.50 is 1850 paise — so this reuses the
 * currency parser rather than duplicating the string surgery.
 */
export function parsePercentToBasisPoints(
  input: string | number | null | undefined,
): BasisPoints | null {
  return parseCurrencyToPaise(typeof input === 'string' ? input.replace('%', '') : input);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Group an integer digit string the Indian way: last three, then pairs. 1234567 → 12,34,567 */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + tail;
}

export interface FormatMoneyOptions {
  /** Prefix the currency symbol. Default false. */
  symbol?: boolean;
  /** Always show two decimals. Default true — invoices show 7,500.00, not 7,500. */
  decimals?: boolean;
  /** Indian lakh/crore grouping. Default true. Superseded by `grouping` when that is given. */
  indianGrouping?: boolean;
  /**
   * How to group the whole part.
   *
   * Explicit, because `indianGrouping: false` has always meant "no grouping at all" rather than
   * "group in thousands", and changing that meaning would silently reformat every existing caller.
   */
  grouping?: 'indian' | 'thousands' | 'none';
  /** Symbol to use when `symbol` is set. Default '₹'. */
  currencySymbol?: string;
}

/** Format integer paise for display. 750050 → "7,500.50". */
/**
 * Group in thousands: 123456789 -> "123,456,789".
 *
 * Needed because `groupIndian` is not a general grouper — lakh/crore placement is correct for
 * rupees and wrong for every other currency, and a document billed in dollars showing '1,23,456' is
 * a bug the owner would be blamed for.
 */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatPaise(amount: Paise, options: FormatMoneyOptions = {}): string {
  const {
    symbol = false,
    decimals = true,
    indianGrouping = true,
    currencySymbol = '₹',
    grouping = indianGrouping ? 'indian' : 'none',
  } = options;
  const negative = amount < 0;
  const abs = Math.abs(Math.trunc(amount));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;

  const wholeStr =
    grouping === 'indian'
      ? groupIndian(String(whole))
      : grouping === 'thousands'
        ? groupThousands(String(whole))
        : String(whole);
  // When decimals are switched off we still print them if they are non-zero: dropping
  // paise from a total would misstate the amount due, which is never an acceptable
  // formatting shortcut.
  const showFraction = decimals || frac !== 0;
  let out = showFraction ? `${wholeStr}.${String(frac).padStart(2, '0')}` : wholeStr;
  if (symbol) out = `${currencySymbol}${out}`;
  return negative ? `-${out}` : out;
}

/** Format milli-units, trimming pointless trailing zeros. 1500 → "1.5", 2000 → "2". */
export function formatMilli(qtyMilli: Milli): string {
  const negative = qtyMilli < 0;
  const abs = Math.abs(Math.trunc(qtyMilli));
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  const out = frac === '' ? String(whole) : `${whole}.${frac}`;
  return negative ? `-${out}` : out;
}

/** Format basis points as a percentage string. 1800 → "18", 1850 → "18.5". */
export function formatBasisPoints(rateBp: BasisPoints): string {
  const negative = rateBp < 0;
  const abs = Math.abs(Math.trunc(rateBp));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  const out = frac === '' ? String(whole) : `${whole}.${frac}`;
  return negative ? `-${out}` : out;
}

/**
 * Currency symbols and grouping for the currencies the app offers (§9.1).
 *
 * Two facts per currency, not one. The symbol is the obvious part; the grouping matters just as
 * much, because Indian lakh/crore grouping applied to a dollar amount produces `$1,23,456.00` —
 * correct for rupees and wrong everywhere else. Anything unrecognised falls back to its own code as
 * a prefix, which is ugly but unambiguous, and never to a bare number.
 */
export interface CurrencyFormat {
  symbol: string;
  grouping: 'indian' | 'thousands';
}

const CURRENCIES: Readonly<Record<string, CurrencyFormat>> = {
  INR: { symbol: '₹', grouping: 'indian' },
  USD: { symbol: '$', grouping: 'thousands' },
  EUR: { symbol: '€', grouping: 'thousands' },
  GBP: { symbol: '£', grouping: 'thousands' },
  AED: { symbol: 'AED ', grouping: 'thousands' },
  SGD: { symbol: 'S$', grouping: 'thousands' },
};

export function currencyFormat(code: string): CurrencyFormat {
  const key = code.trim().toUpperCase();
  return CURRENCIES[key] ?? { symbol: key.length > 0 ? `${key} ` : '', grouping: 'thousands' };
}

/**
 * Format an amount in a given currency.
 *
 * The one entry point for money on a document, so a currency can never be honoured in one place and
 * silently dropped in another — which is what happened when the renderer tested for `'INR'` and
 * emitted no symbol at all for anything else.
 */
export function formatMoneyIn(amount: Paise, code: string, options: FormatMoneyOptions = {}): string {
  const format = currencyFormat(code);
  return formatPaise(amount, {
    symbol: true,
    currencySymbol: format.symbol,
    grouping: format.grouping,
    ...options,
  });
}
