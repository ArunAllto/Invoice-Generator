import { Pipe, type PipeTransform } from '@angular/core';

import { formatMilli } from '../../core/money';

/** Milli-quantity (1500) to a readable quantity (1.5), trailing zeros trimmed. */
@Pipe({ name: 'milli', standalone: true })
export class MilliPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatMilli(value ?? 0);
  }
}
