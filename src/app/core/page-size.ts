/**
 * Resolving and validating the paper a document prints on (§10.1).
 *
 * Pure, so the settings screen, the renderer and the tests all agree about what "A5 with 4mm
 * margins" means. The clamping in particular has to be shared: a page whose margins exceed its own
 * width produces negative content width, and the renderer's pagination divides by that — so the one
 * place that decides a geometry is legal is the place that has to be trusted by everything else.
 */

import {
  A4_PAGE,
  PAGE_LIMITS,
  PAGE_PRESETS,
  type PageGeometry,
  type PageSizeId,
} from './types';

/** Human labels, with the dimensions, because "Legal" means nothing without them. */
export const PAGE_SIZE_LABELS: Readonly<Record<PageSizeId, string>> = {
  a4: 'A4 — 210 × 297 mm',
  letter: 'Letter — 8.5 × 11 in',
  legal: 'Legal — 8.5 × 14 in',
  a5: 'A5 — 148 × 210 mm',
  custom: 'Custom',
};

/** The smallest content width the items table stays readable at. */
const MIN_CONTENT_WIDTH_MM = 50;

/** The smallest content height that can hold a header, one row and a footer. */
const MIN_CONTENT_HEIGHT_MM = 60;

/**
 * Clamp into range, treating only NaN as unusable.
 *
 * `Infinity` deliberately falls through to the arithmetic, where it clamps to `max` — "as large as
 * possible" is a coherent request and answering it with the *minimum* would be the opposite of what
 * was asked. NaN has no such reading, so it takes the minimum.
 */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Round to a tenth of a millimetre.
 *
 * Finer than that is meaningless on paper and makes the CSS noisy, but a whole millimetre would
 * lose Letter's 215.9 — and rounding that to 216 shifts every column by a hair on a page the owner
 * is comparing side by side with one from their old software.
 */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Turn whatever was stored into a geometry the renderer can safely use.
 *
 * Deliberately total: every input, including nonsense, yields a usable page rather than throwing.
 * This runs on the read path for every document render, and a document that will not display
 * because its stored page size is malformed is far worse than one that displays on A4.
 */
export function resolvePageGeometry(input: Partial<PageGeometry> | null | undefined): PageGeometry {
  if (!input) return A4_PAGE;

  const sizeId = input.sizeId ?? 'a4';
  if (sizeId !== 'custom') {
    const preset = PAGE_PRESETS[sizeId];
    if (!preset) return A4_PAGE;
    // A preset may still carry the owner's own margins: someone wanting A4 with 10mm sides is
    // asking about margins, not about paper, and should not be forced into "custom" to say so.
    return normalise({
      ...preset,
      marginXMm: input.marginXMm ?? preset.marginXMm,
      marginYMm: input.marginYMm ?? preset.marginYMm,
    });
  }

  return normalise({
    sizeId: 'custom',
    widthMm: input.widthMm ?? A4_PAGE.widthMm,
    heightMm: input.heightMm ?? A4_PAGE.heightMm,
    marginXMm: input.marginXMm ?? A4_PAGE.marginXMm,
    marginYMm: input.marginYMm ?? A4_PAGE.marginYMm,
  });
}

/**
 * Clamp a geometry into the legal range, margins last.
 *
 * Order matters. The page is sized first, then the margins are clamped against *that* width — so a
 * 70mm receipt roll cannot keep 20mm side margins and end up with 30mm of usable width. The margin
 * ceiling is derived from the page rather than fixed, which is the only way the two stay consistent.
 */
export function normalise(geometry: PageGeometry): PageGeometry {
  const widthMm = round(clamp(geometry.widthMm, PAGE_LIMITS.minWidthMm, PAGE_LIMITS.maxWidthMm));
  const heightMm = round(clamp(geometry.heightMm, PAGE_LIMITS.minHeightMm, PAGE_LIMITS.maxHeightMm));

  const maxMarginX = Math.min(PAGE_LIMITS.maxMarginMm, (widthMm - MIN_CONTENT_WIDTH_MM) / 2);
  const maxMarginY = Math.min(PAGE_LIMITS.maxMarginMm, (heightMm - MIN_CONTENT_HEIGHT_MM) / 2);

  return {
    sizeId: geometry.sizeId,
    widthMm,
    heightMm,
    marginXMm: round(clamp(geometry.marginXMm, PAGE_LIMITS.minMarginMm, Math.max(0, maxMarginX))),
    marginYMm: round(clamp(geometry.marginYMm, PAGE_LIMITS.minMarginMm, Math.max(0, maxMarginY))),
  };
}

export function contentWidthMm(geometry: PageGeometry): number {
  return round(geometry.widthMm - geometry.marginXMm * 2);
}

export function contentHeightMm(geometry: PageGeometry): number {
  return round(geometry.heightMm - geometry.marginYMm * 2);
}

/**
 * The `size` value for the CSS `@page` rule.
 *
 * Named sizes are emitted by name — `size: A4` — because print engines match their own paper
 * definitions more reliably than they match two lengths that happen to equal one. Custom sizes have
 * no name to give, so they fall back to explicit millimetres.
 */
export function cssPageSize(geometry: PageGeometry): string {
  switch (geometry.sizeId) {
    case 'a4':
      return 'A4';
    case 'a5':
      return 'A5';
    case 'letter':
      return 'letter';
    case 'legal':
      return 'legal';
    default:
      return `${geometry.widthMm}mm ${geometry.heightMm}mm`;
  }
}

/** A one-line description for a settings row, e.g. "A5 — 148 × 210 mm · 12/10 mm margins". */
export function describePage(geometry: PageGeometry): string {
  const size =
    geometry.sizeId === 'custom'
      ? `Custom — ${geometry.widthMm} × ${geometry.heightMm} mm`
      : PAGE_SIZE_LABELS[geometry.sizeId];
  return `${size} · ${geometry.marginXMm}/${geometry.marginYMm} mm margins`;
}

/** Serialise for the settings table. */
export function serialisePageGeometry(geometry: PageGeometry): string {
  return JSON.stringify(geometry);
}

/** Parse from the settings table, falling back to A4 on anything unreadable. */
export function parsePageGeometry(raw: string | null | undefined): PageGeometry {
  if (!raw || raw.trim().length === 0) return A4_PAGE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return A4_PAGE;
    return resolvePageGeometry(parsed as Partial<PageGeometry>);
  } catch {
    return A4_PAGE;
  }
}
