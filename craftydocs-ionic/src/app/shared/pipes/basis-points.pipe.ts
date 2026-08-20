import { Pipe, type PipeTransform } from '@angular/core';

import { formatBasisPoints } from '../../core/money';

/** Basis points (1800) to a percentage (18). Rates are stored as integers, never floats. */
@Pipe({ name: 'basisPoints', standalone: true })
export class BasisPointsPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatBasisPoints(value ?? 0);
  }
}
