/**
 * Date-only helpers.
 *
 * Everything here works on the calendar-date portion of an ISO 8601 string as *text*.
 * That is deliberate: `new Date('2026-04-01')` parses as UTC midnight, which in IST
 * (UTC+5:30) is still 2026-04-01, but in any negative-offset zone becomes 31 March.
 * The financial-year reset in §8.2 turns on exactly that boundary, so treating a
 * calendar date as a `Date` object is how you get an invoice numbered into the wrong
 * financial year. Strings avoid the whole class of bug.
 *
 * `todayIso()` is the only function here that reads the clock, so tests inject dates
 * instead of mocking time.
 */

export interface DateParts {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MONTH_NAMES_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Take the `YYYY-MM-DD` head of any ISO string. Throws on anything unparseable. */
export function isoDateOnly(iso: string): string {
  const match = ISO_DATE.exec(iso);
  if (!match) throw new RangeError(`Not an ISO date: ${JSON.stringify(iso)}`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseIsoDateParts(iso: string): DateParts {
  const match = ISO_DATE.exec(iso);
  if (!match) throw new RangeError(`Not an ISO date: ${JSON.stringify(iso)}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Negative if a is earlier, 0 if the same day, positive if a is later. */
export function compareIsoDates(a: string, b: string): number {
  const left = isoDateOnly(a);
  const right = isoDateOnly(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isBeforeIso(a: string, b: string): boolean {
  return compareIsoDates(a, b) < 0;
}

export function isAfterIso(a: string, b: string): boolean {
  return compareIsoDates(a, b) > 0;
}

/** Local calendar date as `YYYY-MM-DD`, using the device's own timezone. */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Full timestamp in local time *with offset*, as §5 requires for `created_at` and
 * friends: `2026-08-18T15:42:07+05:30`.
 */
export function nowIsoWithOffset(now: Date = new Date()): string {
  const pad = (n: number): string => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset = `${sign}${pad(offsetMinutes / 60)}:${pad(offsetMinutes % 60)}`;
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offset}`
  );
}

/** Add (or subtract) whole days to a calendar date, returning `YYYY-MM-DD`. */
export function addDaysIso(iso: string, days: number): string {
  const { year, month, day } = parseIsoDateParts(iso);
  // UTC arithmetic only — this Date never leaves the function, so no zone can shift it.
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetweenIso(a: string, b: string): number {
  const pa = parseIsoDateParts(a);
  const pb = parseIsoDateParts(b);
  const ua = Date.UTC(pa.year, pa.month - 1, pa.day);
  const ub = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((ub - ua) / 86_400_000);
}

export type DateDisplayStyle = 'dd/MM/yyyy' | 'dd MMM yyyy' | 'd MMMM yyyy' | 'yyyy-MM-dd';

/**
 * Format a calendar date for display or for print.
 *
 * Hand-rolled rather than delegated to date-fns so that the HTML renderer — which
 * must stay pure and synchronous — has no dependency to load, and so the output is
 * identical in the app, the PDF, and the DOCX.
 */
export function formatIsoDate(iso: string, style: DateDisplayStyle = 'dd MMM yyyy'): string {
  const { year, month, day } = parseIsoDateParts(iso);
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  switch (style) {
    case 'dd/MM/yyyy':
      return `${dd}/${mm}/${year}`;
    case 'yyyy-MM-dd':
      return `${year}-${mm}-${dd}`;
    case 'd MMMM yyyy':
      return `${day} ${MONTH_NAMES_LONG[month - 1] ?? ''} ${year}`;
    case 'dd MMM yyyy':
    default:
      return `${dd} ${MONTH_NAMES[month - 1] ?? ''} ${year}`;
  }
}

/** True when the string is a real calendar date, rejecting 2026-02-30 and 2026-13-01. */
export function isValidIsoDate(iso: string): boolean {
  const match = ISO_DATE.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}
