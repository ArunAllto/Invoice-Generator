import { Component, computed, input } from '@angular/core';
import { IonBadge } from '@ionic/angular';

import { statusLabel, statusTone } from '../../../core/status';
import type { DocumentStatus } from '../../../core/types';

/**
 * The status pill used on every document row (§6.4).
 *
 * It maps a status to a colour but decides nothing itself: both the label and the tone come from
 * the pure `core/status` module, so the app cannot end up with two disagreeing opinions about what
 * "overdue" looks like.
 */
@Component({
  selector: 'cd-status-chip',
  standalone: true,
  imports: [IonBadge],
  templateUrl: './status-chip.component.html',
  styleUrl: './status-chip.component.scss',
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
