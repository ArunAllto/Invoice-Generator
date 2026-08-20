/**
 * Theme selection and persistence.
 *
 * Four choices: `system`, `light`, `dark`, `high-contrast`. The service writes `data-theme` onto
 * `<html>` and the stylesheet in `src/theme/variables.scss` does the rest — nothing here knows a
 * single colour.
 *
 * ## Why `system` writes no attribute
 *
 * With no `data-theme`, the `prefers-color-scheme` block in the stylesheet decides. That keeps one
 * source of truth for "what does the OS want" — the browser's own media query — instead of this
 * service reading `matchMedia` and then hard-writing `dark`, which would go stale the moment the
 * user changed their phone's setting while the app was open.
 *
 * ## Why localStorage and not the settings table
 *
 * The preference has to be applied before the first paint. The settings table lives in SQLite,
 * which needs jeep-sqlite, a WASM module and an async open — several hundred milliseconds during
 * which the app would show the wrong theme and then snap. `localStorage` is synchronous and
 * available immediately, which is exactly what a pre-paint read needs.
 */

import { Injectable, computed, signal } from '@angular/core';

export const THEME_CHOICES = ['system', 'light', 'dark', 'high-contrast'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** The theme actually in force, once `system` has been resolved. */
export type ResolvedTheme = Exclude<ThemeChoice, 'system'>;

const STORAGE_KEY = 'craftydocs.theme';

export interface ThemeOption {
  value: ThemeChoice;
  label: string;
  description: string;
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: 'system', label: 'Match device', description: 'Follows your phone’s light or dark setting.' },
  { value: 'light', label: 'Light', description: 'The palette the printed document uses.' },
  { value: 'dark', label: 'Dark', description: 'Easier at night; documents still print on white.' },
  {
    value: 'high-contrast',
    label: 'High contrast',
    description: 'Black on white with heavier borders, for bright sunlight.',
  },
];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly choiceSignal = signal<ThemeChoice>(this.readStored());

  /** What the user picked, including `system`. */
  readonly choice = this.choiceSignal.asReadonly();

  /** Tracks the OS preference so `resolved` stays correct if it changes while the app is open. */
  private readonly systemPrefersDark = signal(this.matchDark());

  /** The theme actually rendering — `system` resolved to a concrete one. */
  readonly resolved = computed<ResolvedTheme>(() => {
    const choice = this.choiceSignal();
    if (choice !== 'system') return choice;
    return this.systemPrefersDark() ? 'dark' : 'light';
  });

  readonly isDark = computed(() => this.resolved() === 'dark');

  constructor() {
    this.apply(this.choiceSignal());

    // Keep `resolved` honest if the OS setting changes mid-session. Only meaningful while the
    // choice is `system`, but the listener is harmless either way.
    const query = this.darkQuery();
    query?.addEventListener('change', (event) => {
      this.systemPrefersDark.set(event.matches);
    });
  }

  set(choice: ThemeChoice): void {
    this.choiceSignal.set(choice);
    this.apply(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Private browsing can refuse storage. The theme still applies for this session; forgetting
      // it next launch is a far better outcome than failing to switch at all.
    }
  }

  /**
   * Write (or clear) the attribute the stylesheet keys off.
   *
   * `system` deliberately *removes* the attribute rather than writing a resolved value — see the
   * note at the top of the file.
   */
  private apply(choice: ThemeChoice): void {
    const root = document.documentElement;
    if (choice === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', choice);
    }
  }

  private readStored(): ThemeChoice {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return THEME_CHOICES.includes(stored as ThemeChoice) ? (stored as ThemeChoice) : 'system';
    } catch {
      return 'system';
    }
  }

  private darkQuery(): MediaQueryList | null {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  }

  private matchDark(): boolean {
    return this.darkQuery()?.matches ?? false;
  }
}
