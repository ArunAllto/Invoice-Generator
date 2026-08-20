import { Pipe, type PipeTransform } from '@angular/core';

import { formatIsoDate, type DateDisplayStyle } from '../../core/dates';

/**
 * ISO date to a display string.
 *
 * Uses the core's text-based formatter rather than Angular's `DatePipe`. `DatePipe` parses into a
 * `Date`, and a UTC-midnight string becomes the previous day in any negative-offset zone — exactly
 * the drift §8.2's financial-year boundary cannot tolerate.
 */
@Pipe({ name: 'isoDate', standalone: true })
export class IsoDatePipe implements PipeTransform {
  transform(value: string | null | undefined, style: DateDisplayStyle = 'dd MMM yyyy'): string {
    if (!value) return '';
    try {
      return formatIsoDate(value, style);
    } catch {
      // A malformed stored date should show as itself rather than blow up the screen.
      return value;
    }
  }
}
