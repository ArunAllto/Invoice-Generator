/**
 * The status pill used on every document row (§6.4).
 *
 * Takes the *derived* status, not the stored one, and maps it through the core's `statusTone` so
 * the colour semantics live in one place.
 */

import { Component, computed, input } from '@angular/core';
import { IonBadge } from '@ionic/angular';

import { statusLabel, statusTone } from '../../core/status';
import type { DocumentStatus } from '../../core/types';

@Component({
  selector: 'cd-status-chip',
  standalone: true,
  imports: [IonBadge],
  template: `<ion-badge [color]="color()">{{ label() }}</ion-badge>`,
})
export class StatusChipComponent {
  readonly status = input.required<DocumentStatus>();

  readonly label = computed(() => statusLabel(this.status()));

  readonly color = computed(() => {
    switch (statusTone(this.status())) {
      case 'positive':
        return 'success';
      case 'warning':
        return 'warning';
      case 'danger':
        return 'danger';
      case 'info':
        return 'primary';
      default:
        return 'medium';
    }
  });
}
