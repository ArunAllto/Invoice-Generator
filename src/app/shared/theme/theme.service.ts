/**
 * Theme selection and persistence.
 *
 * Three independent choices, because they answer different questions:
 *
 * - **Theme** — `system`, `light`, `dark`, `high-contrast`. Written as `data-theme` on `<html>`; the
 *   stylesheet in `src/theme/variables.scss` does the rest and nothing here knows a single colour.
 * - **Accent** — which hue the app's chrome uses. Overrides the theme's `--cd-accent` group with a
 *   per-theme-appropriate value, since a navy that reads well on white fails badly on near-black.
 * - **Text size** — a root font scale, for §11. Ionic and our own styles size everything in `px`
 *   relative to the root, so one multiplier moves the whole app without touching a component.
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
 * All three have to be applied before the first paint. The settings table lives in SQLite, which
 * needs jeep-sqlite, a WASM module and an async open — several hundred milliseconds during which the
 * app would show the wrong theme and then snap. `localStorage` is synchronous and available
 * immediately, which is exactly what a pre-paint read needs.
 */

import { Injectable, computed, signal } from '@angular/core';

export const THEME_CHOICES = ['system', 'light', 'dark', 'high-contrast'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** The theme actually in force, once `system` has been resolved. */
export type ResolvedTheme = Exclude<ThemeChoice, 'system'>;

export const ACCENT_CHOICES = ['navy', 'teal', 'plum', 'forest', 'ink'] as const;
export type AccentChoice = (typeof ACCENT_CHOICES)[number];

export const TEXT_SCALES = ['small', 'normal', 'large', 'largest'] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

const STORAGE_KEY = 'craftydocs.theme';
const ACCENT_KEY = 'craftydocs.accent';
const TEXT_SCALE_KEY = 'craftydocs.textScale';

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

export interface AccentOption {
  value: AccentChoice;
  label: string;
  description: string;
}

export const ACCENT_OPTIONS: readonly AccentOption[] = [
  { value: 'navy', label: 'Navy', description: 'The Crafty Pixels house colour.' },
  { value: 'teal', label: 'Teal', description: 'Cooler, and easier to tell from the status colours.' },
  { value: 'plum', label: 'Plum', description: 'Warm, and distinct from every status tone.' },
  { value: 'forest', label: 'Forest', description: 'Close to the success green — a deliberate match.' },
  { value: 'ink', label: 'Ink', description: 'Near-black chrome. The quietest option.' },
];

export interface TextScaleOption {
  value: TextScale;
  label: string;
  /** The multiplier applied to the root font size. */
  factor: number;
}

export const TEXT_SCALE_OPTIONS: readonly TextScaleOption[] = [
  { value: 'small', label: 'Small', factor: 0.9 },
  { value: 'normal', label: 'Normal', factor: 1 },
  { value: 'large', label: 'Large', factor: 1.15 },
  { value: 'largest', label: 'Largest', factor: 1.3 },
];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly choiceSignal = signal<ThemeChoice>(this.readStored(STORAGE_KEY, THEME_CHOICES, 'system'));
  private readonly accentSignal = signal<AccentChoice>(this.readStored(ACCENT_KEY, ACCENT_CHOICES, 'navy'));
  private readonly textScaleSignal = signal<TextScale>(
    this.readStored(TEXT_SCALE_KEY, TEXT_SCALES, 'normal'),
  );

  /** What the user picked, including `system`. */
  readonly choice = this.choiceSignal.asReadonly();
  readonly accent = this.accentSignal.asReadonly();
  readonly textScale = this.textScaleSignal.asReadonly();

  /** Tracks the OS preference so `resolved` stays correct if it changes while the app is open. */
  private readonly systemPrefersDark = signal(this.matchDark());

  /** The theme actually rendering — `system` resolved to a concrete one. */
  readonly resolved = computed<ResolvedTheme>(() => {
    const choice = this.choiceSignal();
    if (choice !== 'system') return choice;
    return this.systemPrefersDark() ? 'dark' : 'light';
  });

  readonly isDark = computed(() => this.resolved() === 'dark');

  readonly textScaleFactor = computed(
    () => TEXT_SCALE_OPTIONS.find((option) => option.value === this.textScaleSignal())?.factor ?? 1,
  );

  constructor() {
    this.applyTheme(this.choiceSignal());
    this.applyAccent(this.accentSignal());
    this.applyTextScale(this.textScaleSignal());

    // Keep `resolved` honest if the OS setting changes mid-session. Only meaningful while the
    // choice is `system`, but the listener is harmless either way.
    this.darkQuery()?.addEventListener('change', (event) => {
      this.systemPrefersDark.set(event.matches);
    });
  }

  set(choice: ThemeChoice): void {
    this.choiceSignal.set(choice);
    this.applyTheme(choice);
    this.store(STORAGE_KEY, choice);
  }

  setAccent(accent: AccentChoice): void {
    this.accentSignal.set(accent);
    this.applyAccent(accent);
    this.store(ACCENT_KEY, accent);
  }

  setTextScale(scale: TextScale): void {
    this.textScaleSignal.set(scale);
    this.applyTextScale(scale);
    this.store(TEXT_SCALE_KEY, scale);
  }

  /**
   * Write (or clear) the attribute the stylesheet keys off.
   *
   * `system` deliberately *removes* the attribute rather than writing a resolved value — see the
   * note at the top of the file.
   */
  private applyTheme(choice: ThemeChoice): void {
    const root = document.documentElement;
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
  }

  /**
   * `data-accent` on the root, which the stylesheet turns into an accent token group.
   *
   * `navy` writes nothing, so the theme's own accent stands. That keeps the default path free of an
   * override the stylesheet would otherwise have to undo per theme.
   */
  private applyAccent(accent: AccentChoice): void {
    const root = document.documentElement;
    if (accent === 'navy') root.removeAttribute('data-accent');
    else root.setAttribute('data-accent', accent);
  }

  /**
   * Scale the root font size.
   *
   * Written as an inline style rather than an attribute because it is a computed number, not one of
   * a fixed set of looks — and because the root font size is the one thing every `px` in the app is
   * ultimately relative to, so it belongs on the element rather than in a stylesheet rule.
   */
  private applyTextScale(scale: TextScale): void {
    const factor = TEXT_SCALE_OPTIONS.find((option) => option.value === scale)?.factor ?? 1;
    const root = document.documentElement;
    if (factor === 1) root.style.removeProperty('font-size');
    else root.style.setProperty('font-size', `${Math.round(16 * factor)}px`);
  }

  private store(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private browsing can refuse storage. The choice still applies for this session; forgetting
      // it next launch is a far better outcome than failing to apply it at all.
    }
  }

  private readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    try {
      const stored = localStorage.getItem(key);
      return allowed.includes(stored as T) ? (stored as T) : fallback;
    } catch {
      return fallback;
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
