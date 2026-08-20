/**
 * Formatting pipes.
 *
 * Every one delegates to `core/money.ts` or `core/dates.ts` rather than formatting inline. That
 * matters: §16.5 makes those modules the only place a monetary value is parsed or rendered, so a
 * template that wants a rupee amount has to come through here and cannot invent its own
 * `toFixed(2)`.
 */

import { Pipe, type PipeTransform } from '@angular/core';

import { formatIsoDate, type DateDisplayStyle } from '../../core/dates';
import { formatBasisPoints, formatMilli, formatPaise } from '../../core/money';

/** Integer paise to a grouped Indian amount, with the rupee sign by default. */
@Pipe({ name: 'paise', standalone: true })
export class PaisePipe implements PipeTransform {
  transform(
    value: number | null | undefined,
    options: { symbol?: boolean; decimals?: boolean } = {},
  ): string {
    const { symbol = true, decimals = true } = options;
    const amount = formatPaise(value ?? 0, { decimals });
    return symbol ? `₹${amount}` : amount;
  }
}

/** Milli-quantity (1500) to a readable quantity (1.5). */
@Pipe({ name: 'milli', standalone: true })
export class MilliPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatMilli(value ?? 0);
  }
}

/** Basis points (1800) to a percentage (18). */
@Pipe({ name: 'basisPoints', standalone: true })
export class BasisPointsPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatBasisPoints(value ?? 0);
  }
}

/**
 * ISO date to a display string.
 *
 * Uses the core's text-based formatter rather than Angular's `DatePipe`, because `DatePipe`
 * parses into a `Date` and a UTC-midnight string becomes the previous day in any negative-offset
 * zone — which is exactly the bug §8.2's financial-year boundary cannot tolerate.
 */
@Pipe({ name: 'isoDate', standalone: true })
export class IsoDatePipe implements PipeTransform {
  transform(value: string | null | undefined, style: DateDisplayStyle = 'dd MMM yyyy'): string {
    if (!value) return '';
    try {
      return formatIsoDate(value, style);
    } catch {
      // A malformed stored date should show as itself, not blow up the screen.
      return value;
    }
  }
}
