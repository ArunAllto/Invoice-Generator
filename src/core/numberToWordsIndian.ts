/**
 * Amount in words, Indian numbering system — spec §9.5.
 *
 * Hand-written rather than pulled from a library, per §3, because Western libraries
 * group in thousands/millions and produce "one hundred twenty thousand five hundred"
 * where an Indian invoice must read "One Lakh Twenty Thousand Five Hundred".
 *
 * Grouping is lakh (10^5) and crore (10^7). Above a crore the crore count is itself
 * written in the same system, so 10^9 reads "One Hundred Crore" and 10^11 reads
 * "Ten Thousand Crore" — which is how Indian accounting actually writes those figures,
 * rather than inventing "arab" and "kharab" terms most readers would not recognise.
 */

import type { Paise } from './types';

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
] as const;

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
] as const;

const CRORE = 10_000_000;
const LAKH = 100_000;
const THOUSAND = 1_000;

export interface NumberToWordsOptions {
  /**
   * Insert "and" between the hundreds and the tens, as in "Nine Hundred and Ninety
   * Nine".
   *
   * ASSUMPTION (§16.7): the spec's own worked example — "Rupees One Lakh Twenty
   * Thousand Five Hundred and Fifty Paise Only" — uses "and" only to introduce the
   * paise clause, so the default here is `false`. Indian invoice convention varies;
   * this flag exists so the owner can flip the house style in one place.
   */
  useAndBeforeTens?: boolean;
}

/** Write a two-digit number (0–99). Returns '' for 0. */
function twoDigitsToWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n] ?? '';
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tensWord = TENS[tens] ?? '';
  return ones === 0 ? tensWord : `${tensWord} ${ONES[ones] ?? ''}`;
}

/** Write a three-digit number (0–999). Returns '' for 0. */
function threeDigitsToWords(n: number, useAnd: boolean): string {
  if (n === 0) return '';
  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;
  if (hundreds === 0) return twoDigitsToWords(remainder);

  const head = `${ONES[hundreds] ?? ''} Hundred`;
  if (remainder === 0) return head;
  return useAnd ? `${head} and ${twoDigitsToWords(remainder)}` : `${head} ${twoDigitsToWords(remainder)}`;
}

/**
 * Write a non-negative integer in the Indian system. Returns 'Zero' for 0.
 *
 * Throws on negatives and on values beyond `Number.MAX_SAFE_INTEGER`, because a
 * silently wrong amount in words on a legal document is worse than a loud failure.
 */
export function numberToWordsIndian(value: number, options: NumberToWordsOptions = {}): string {
  const { useAndBeforeTens = false } = options;

  if (!Number.isFinite(value)) throw new RangeError(`numberToWordsIndian received ${value}`);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`numberToWordsIndian needs a safe integer, received ${value}`);
  }
  if (value < 0) throw new RangeError('numberToWordsIndian does not accept negative values');
  if (value === 0) return 'Zero';

  const parts: string[] = [];

  const crores = Math.floor(value / CRORE);
  let rest = value % CRORE;

  if (crores > 0) {
    // Recurse for 100 crore and above so the count itself is written in the Indian
    // system: 1,00,00,00,000 becomes "One Hundred Crore".
    const croreWords =
      crores < THOUSAND
        ? threeDigitsToWords(crores, useAndBeforeTens)
        : numberToWordsIndian(crores, options);
    parts.push(`${croreWords} Crore`);
  }

  const lakhs = Math.floor(rest / LAKH);
  rest %= LAKH;
  if (lakhs > 0) parts.push(`${twoDigitsToWords(lakhs)} Lakh`);

  const thousands = Math.floor(rest / THOUSAND);
  rest %= THOUSAND;
  if (thousands > 0) parts.push(`${twoDigitsToWords(thousands)} Thousand`);

  if (rest > 0) parts.push(threeDigitsToWords(rest, useAndBeforeTens));

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export interface AmountInWordsOptions extends NumberToWordsOptions {
  /** Currency noun for the whole part. Default 'Rupees'. */
  majorUnit?: string;
  /** Currency noun for the fractional part. Default 'Paise'. */
  minorUnit?: string;
  /** Trailing word. Default 'Only'. Pass '' to omit. */
  suffix?: string;
}

/**
 * The full "amount in words" line printed on a document, from integer paise.
 *
 *   1_100_000 → "Rupees Eleven Thousand Only"
 *      12_050_050 → "Rupees One Lakh Twenty Thousand Five Hundred and Fifty Paise Only"
 *
 * The paise clause is omitted entirely for exact rupee amounts (§9.5). A negative
 * amount is prefixed "Minus", which only arises on a credit adjustment.
 */
export function amountInWords(paise: Paise, options: AmountInWordsOptions = {}): string {
  const { majorUnit = 'Rupees', minorUnit = 'Paise', suffix = 'Only', ...wordOptions } = options;

  if (!Number.isSafeInteger(paise)) {
    throw new RangeError(`amountInWords needs a safe integer of paise, received ${paise}`);
  }

  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;

  const segments: string[] = [];
  if (negative) segments.push('Minus');
  segments.push(majorUnit);
  segments.push(numberToWordsIndian(rupees, wordOptions));
  if (fraction > 0) {
    segments.push('and');
    segments.push(twoDigitsToWords(fraction));
    segments.push(minorUnit);
  }
  if (suffix) segments.push(suffix);

  return segments.join(' ').replace(/\s+/g, ' ').trim();
}
