import { Pipe, type PipeTransform } from '@angular/core';

import { formatPaise } from '../../core/money';

/**
 * Integer paise to a grouped Indian amount, with the rupee sign by default.
 *
 * Delegates to `core/money.ts` rather than formatting here. §16.5 makes that module the only place
 * a monetary value is parsed or rendered, so a template wanting a rupee amount must come through
 * this pipe and cannot invent its own `toFixed(2)`.
 */
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
