/**
 * Design tokens.
 *
 * Sizing obeys §11's accessibility line: touch targets are at least 44dp and nothing
 * here sets a fixed height on a text container, so system font scaling up to 200% grows
 * rows instead of clipping them.
 */

import { Platform } from 'react-native';

export const palette = {
  navy: '#0F4C81',
  navyDark: '#0A3459',
  navyLight: '#E8F0F7',

  ink: '#14181F',
  inkMuted: '#5A6472',
  inkFaint: '#8A93A1',

  surface: '#FFFFFF',
  surfaceAlt: '#F6F8FA',
  surfaceSunken: '#EEF1F5',
  border: '#DCE2EA',
  borderStrong: '#C3CCD8',

  success: '#0F7B4F',
  successBg: '#E4F5EC',
  warning: '#9A6400',
  warningBg: '#FDF3DF',
  danger: '#B3261E',
  dangerBg: '#FCE9E7',
  info: '#0F4C81',
  infoBg: '#E8F0F7',
  neutral: '#5A6472',
  neutralBg: '#EEF1F5',

  overlay: 'rgba(20, 24, 31, 0.45)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

/**
 * Font sizes are plain numbers so React Native's own `allowFontScaling` handles system
 * text scaling; nothing here opts out of it.
 */
export const fontSize = {
  caption: 12,
  small: 13,
  body: 15,
  bodyLarge: 17,
  title: 20,
  heading: 24,
  display: 30,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** §11: minimum 44dp touch targets. */
export const TOUCH_TARGET = 44;

export const shadow = Platform.select({
  android: { elevation: 2 },
  default: {
    shadowColor: '#0F1A2A',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
}) as { elevation: number } | Record<string, unknown>;

export type StatusTone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger';

export function toneColors(tone: StatusTone): { fg: string; bg: string } {
  switch (tone) {
    case 'positive':
      return { fg: palette.success, bg: palette.successBg };
    case 'warning':
      return { fg: palette.warning, bg: palette.warningBg };
    case 'danger':
      return { fg: palette.danger, bg: palette.dangerBg };
    case 'info':
      return { fg: palette.info, bg: palette.infoBg };
    case 'neutral':
    default:
      return { fg: palette.neutral, bg: palette.neutralBg };
  }
}

/**
 * Readable foreground for an arbitrary user-chosen accent colour.
 *
 * The accent is configurable (§10.6), so white text on a pale yellow accent is a real
 * possibility; relative luminance decides rather than a guess.
 */
export function contrastOn(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.45 ? palette.ink : '#FFFFFF';
}

/** Accent presets offered in Settings → Branding. */
export const ACCENT_PRESETS: readonly string[] = [
  '#0F4C81',
  '#1B7F79',
  '#7A3E9D',
  '#B3261E',
  '#B26A00',
  '#2E5B2A',
  '#1F2933',
];
