import { Component, inject } from '@angular/core';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonRadio,
  IonRadioGroup,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { StatusChipComponent } from '../../../shared/ui/status-chip/status-chip.component';
import {
  ACCENT_OPTIONS,
  TEXT_SCALE_OPTIONS,
  THEME_OPTIONS,
  ThemeService,
  type AccentChoice,
  type TextScale,
  type ThemeChoice,
} from '../../../shared/theme/theme.service';

/**
 * Settings → Appearance.
 *
 * Three independent choices: theme, accent and text size. Independent because they answer different
 * questions — dark or light is about the room, the accent is about taste, and text size is about
 * eyesight — and folding any two together would force a compromise on someone.
 *
 * Shows a live sample and the token swatches beneath the choices, because a list of theme names
 * tells the owner nothing about what they are choosing — and the swatches read the real CSS
 * variables, so they cannot drift from what the app actually uses.
 */
@Component({
  selector: 'app-appearance',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonRadioGroup,
    IonRadio,
    StatusChipComponent,
  ],
  templateUrl: './appearance.page.html',
  styleUrl: './appearance.page.scss',
})
export class AppearancePage {
  private readonly theme = inject(ThemeService);

  readonly options = THEME_OPTIONS;
  readonly accents = ACCENT_OPTIONS;
  readonly textScales = TEXT_SCALE_OPTIONS;

  readonly choice = this.theme.choice;
  readonly resolved = this.theme.resolved;
  readonly accent = this.theme.accent;
  readonly textScale = this.theme.textScale;

  readonly swatches: ReadonlyArray<{ token: string; label: string }> = [
    { token: '--cd-accent', label: 'Accent' },
    { token: '--cd-surface', label: 'Surface' },
    { token: '--cd-surface-sunken', label: 'Sunken' },
    { token: '--cd-text', label: 'Text' },
    { token: '--cd-text-muted', label: 'Muted' },
    { token: '--cd-border', label: 'Border' },
    { token: '--cd-success', label: 'Success' },
    { token: '--cd-warning', label: 'Warning' },
    { token: '--cd-danger', label: 'Danger' },
  ];

  onChange(value: ThemeChoice): void {
    this.theme.set(value);
  }

  onAccent(value: AccentChoice): void {
    this.theme.setAccent(value);
  }

  onTextScale(value: TextScale): void {
    this.theme.setTextScale(value);
  }
}
