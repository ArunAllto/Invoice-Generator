/**
 * Document numbering — spec §8.
 *
 * Pure. The repository layer supplies the two facts this module cannot know (the
 * highest sequence already used overall, and the highest already used inside the
 * current financial year) and this module decides the next number. Keeping the decision
 * here means the financial-year reset in §8.2 is unit-testable at its boundary dates
 * without a database.
 */

import { compareIsoDates, isoDateOnly, parseIsoDateParts } from './dates';
import type { FyFormat, ResetRule } from './types';

/** The Indian financial year starts on 1 April. */
export const FY_START_MONTH = 4;

export interface FinancialYear {
  /** Calendar year the FY starts in. FY 2026-27 → 2026. */
  startYear: number;
  /** Calendar year the FY ends in. FY 2026-27 → 2027. */
  endYear: number;
  /** Stable key for grouping and comparison, e.g. 'FY2026'. */
  key: string;
}

/**
 * Which financial year a calendar date falls in.
 *
 * 31 March 2027 is FY 2026-27; 1 April 2027 is FY 2027-28. That single day is the whole
 * point of §8.2, and it is tested at both sides.
 */
export function financialYearOf(iso: string): FinancialYear {
  const { year, month } = parseIsoDateParts(iso);
  const startYear = month >= FY_START_MONTH ? year : year - 1;
  return { startYear, endYear: startYear + 1, key: `FY${startYear}` };
}

/** Render a financial year in either configured style. */
export function formatFyToken(fy: FinancialYear, format: FyFormat): string {
  const shortEnd = String(fy.endYear).slice(-2);
  return format === '26-27' ? `${String(fy.startYear).slice(-2)}-${shortEnd}` : `${fy.startYear}-${shortEnd}`;
}

/** The shape of a `numbering_series` row, as far as number rendering is concerned. */
export interface NumberingSeriesShape {
  prefix: string;
  suffix: string;
  includeFy: boolean;
  fyFormat: FyFormat;
  /**
   * Separator printed between the financial-year token and the sequence.
   *
   * SPEC ADDITION: §8.1 gives the format as `{prefix}{FY token}{padded seq}{suffix}`
   * and the example `CP/Q/2026-27/001`. With prefix "CP/Q/" those two only reconcile if
   * the FY token carries a trailing separator, so it is an explicit, configurable field
   * (`numbering_series.fy_separator`, default "/") rather than a hidden constant.
   * Flagged in the phase report.
   */
  fySeparator: string;
  padWidth: number;
}

/** Render the full document number for a given sequence and issue date. */
export function renderDocumentNumber(
  series: NumberingSeriesShape,
  seq: number,
  issueDate: string,
): string {
  if (!Number.isInteger(seq) || seq < 0) {
    throw new RangeError(`renderDocumentNumber needs a non-negative integer seq, got ${seq}`);
  }
  const padded = String(seq).padStart(Math.max(1, series.padWidth), '0');
  const fyPart = series.includeFy
    ? `${formatFyToken(financialYearOf(issueDate), series.fyFormat)}${series.fySeparator}`
    : '';
  return `${series.prefix}${fyPart}${padded}${series.suffix}`;
}

export interface AllocationFacts {
  /**
   * Highest `seq` already allocated in this series, across all financial years.
   * `null` when the series has never been used.
   */
  maxSeqOverall: number | null;
  /**
   * Highest `seq` already allocated in this series for documents whose issue date
   * falls in the *same* financial year as the document being numbered. `null` when
   * this is the first document of that year.
   */
  maxSeqInFy: number | null;
  /** The series' stored counter, which the user may edit directly in settings. */
  nextSeq: number;
  resetRule: ResetRule;
}

/**
 * Decide the sequence number for a document being issued.
 *
 * Two rules, both from §8:
 *  - `yearly_april`: the sequence restarts at 1 in each new financial year, so it is
 *    derived from the highest number *within that year* rather than from a stored
 *    counter. Backdating a document into last financial year therefore continues last
 *    year's run instead of stealing a number from this year's.
 *  - `never`: a single ascending run. The stored counter is honoured, but never allowed
 *    to hand out a number already in use — hence the `max` against observed history.
 *
 * §8.3's promise that abandoned drafts leave no gaps falls out of this for free,
 * because the repository only counts documents that actually got numbered.
 */
export function allocateNextSeq(facts: AllocationFacts): number {
  const { maxSeqOverall, maxSeqInFy, nextSeq, resetRule } = facts;

  if (resetRule === 'yearly_april') {
    return (maxSeqInFy ?? 0) + 1;
  }
  const floor = (maxSeqOverall ?? 0) + 1;
  return Math.max(nextSeq > 0 ? nextSeq : 1, floor);
}

/**
 * Whether two documents of the same type would share a number.
 *
 * §8.4 is explicit that a manual duplicate must be warned about and then permitted, so
 * this returns a flag for the UI to render as a badge — it is not a gate.
 */
export function isDuplicateNumber(
  candidate: string,
  existingNumbersOfSameType: readonly string[],
  selfId?: string,
  ownerIdByNumber?: ReadonlyMap<string, string>,
): boolean {
  const normalised = normaliseNumberForComparison(candidate);
  for (const existing of existingNumbersOfSameType) {
    if (normaliseNumberForComparison(existing) !== normalised) continue;
    // A document is never a duplicate of itself.
    if (selfId && ownerIdByNumber?.get(existing) === selfId) continue;
    return true;
  }
  return false;
}

/**
 * Compare numbers case- and whitespace-insensitively.
 *
 * "cp/q/2026-27/001" and "CP/Q/2026-27/001 " are the same number to a human reading a
 * ledger, so they must collide for the §8.4 warning to be worth anything.
 */
export function normaliseNumberForComparison(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * The preview string shown on a draft: `next: CP/Q/2026-27/004` (§8.3).
 *
 * Drafts hold no number, so this is computed on demand and is explicitly a guess — if
 * the user issues a different document first, the next draft's preview simply moves on.
 */
export function previewNextNumber(
  series: NumberingSeriesShape,
  facts: AllocationFacts,
  issueDate: string,
): string {
  return renderDocumentNumber(series, allocateNextSeq(facts), issueDate);
}

/**
 * Sequence numbers missing from an otherwise contiguous run, for the gap report in
 * settings. GST audits ask about gaps in invoice numbering, so it is worth surfacing.
 */
export function findSequenceGaps(seqs: readonly number[]): number[] {
  if (seqs.length === 0) return [];
  const present = new Set(seqs);
  const highest = Math.max(...seqs);
  const gaps: number[] = [];
  for (let i = 1; i < highest; i += 1) {
    if (!present.has(i)) gaps.push(i);
  }
  return gaps;
}

/** True when `date` falls inside the given financial year. */
export function isDateInFinancialYear(iso: string, fy: FinancialYear): boolean {
  const start = `${fy.startYear}-04-01`;
  const end = `${fy.endYear}-03-31`;
  const day = isoDateOnly(iso);
  return compareIsoDates(day, start) >= 0 && compareIsoDates(day, end) <= 0;
}
