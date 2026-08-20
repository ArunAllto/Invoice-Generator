import {
  contentHeightMm,
  contentWidthMm,
  cssPageSize,
  describePage,
  normalise,
  parsePageGeometry,
  resolvePageGeometry,
  serialisePageGeometry,
} from './page-size';
import { A4_PAGE, PAGE_PRESETS, type PageGeometry } from './types';

describe('resolvePageGeometry', () => {
  it('defaults to A4 when there is nothing stored', () => {
    expect(resolvePageGeometry(null)).toEqual(A4_PAGE);
    expect(resolvePageGeometry(undefined)).toEqual(A4_PAGE);
    expect(resolvePageGeometry({})).toEqual(A4_PAGE);
  });

  it('returns each preset by id', () => {
    expect(resolvePageGeometry({ sizeId: 'letter' }).widthMm).toBe(215.9);
    expect(resolvePageGeometry({ sizeId: 'legal' }).heightMm).toBe(355.6);
    expect(resolvePageGeometry({ sizeId: 'a5' })).toEqual(PAGE_PRESETS.a5);
  });

  it('keeps the exact millimetre conversion of the US sizes', () => {
    // 8.5in and 11in exactly. A rounded 216 x 279 compounds into a wrong row count on a long
    // invoice, which is the whole reason pagination is estimated in millimetres.
    expect(PAGE_PRESETS.letter.widthMm).toBeCloseTo(8.5 * 25.4, 1);
    expect(PAGE_PRESETS.letter.heightMm).toBeCloseTo(11 * 25.4, 1);
    expect(PAGE_PRESETS.legal.heightMm).toBeCloseTo(14 * 25.4, 1);
  });

  it('lets a preset carry the owner’s own margins', () => {
    // Asking for A4 with narrow sides is a question about margins, not about paper, so it must not
    // force the choice into "custom".
    const tight = resolvePageGeometry({ sizeId: 'a4', marginXMm: 8, marginYMm: 6 });
    expect(tight.sizeId).toBe('a4');
    expect(tight.widthMm).toBe(210);
    expect(tight.marginXMm).toBe(8);
    expect(tight.marginYMm).toBe(6);
  });

  it('falls back to A4 for an unknown preset id', () => {
    expect(resolvePageGeometry({ sizeId: 'foolscap' as never })).toEqual(A4_PAGE);
  });

  it('reads a custom size', () => {
    const custom = resolvePageGeometry({
      sizeId: 'custom',
      widthMm: 100,
      heightMm: 150,
      marginXMm: 5,
      marginYMm: 5,
    });
    expect(custom).toEqual({
      sizeId: 'custom',
      widthMm: 100,
      heightMm: 150,
      marginXMm: 5,
      marginYMm: 5,
    });
  });
});

describe('normalise', () => {
  const custom = (over: Partial<PageGeometry>): PageGeometry =>
    normalise({ sizeId: 'custom', widthMm: 210, heightMm: 297, marginXMm: 20, marginYMm: 16, ...over });

  it('clamps a page smaller or larger than anything printable', () => {
    expect(custom({ widthMm: 5 }).widthMm).toBe(70);
    expect(custom({ widthMm: 5000 }).widthMm).toBe(420);
    expect(custom({ heightMm: 1 }).heightMm).toBe(100);
    expect(custom({ heightMm: 9999 }).heightMm).toBe(600);
  });

  it('never lets the margins eat the page', () => {
    // The bug this prevents: a 70mm roll keeping 20mm side margins leaves 30mm of content, and
    // pagination then divides by a width the items table cannot possibly use.
    const roll = custom({ widthMm: 70, marginXMm: 20 });
    expect(contentWidthMm(roll)).toBeGreaterThanOrEqual(50);
    expect(roll.marginXMm).toBeLessThanOrEqual(10);
  });

  it('never produces a negative content box', () => {
    const squashed = custom({ widthMm: 70, heightMm: 100, marginXMm: 40, marginYMm: 40 });
    expect(contentWidthMm(squashed)).toBeGreaterThan(0);
    expect(contentHeightMm(squashed)).toBeGreaterThan(0);
  });

  it('survives NaN and Infinity rather than propagating them into the CSS', () => {
    expect(custom({ widthMm: Number.NaN }).widthMm).toBe(70);
    expect(custom({ heightMm: Number.POSITIVE_INFINITY }).heightMm).toBe(600);
    expect(Number.isFinite(custom({ marginXMm: Number.NaN }).marginXMm)).toBe(true);
  });

  it('rounds to a tenth of a millimetre', () => {
    expect(custom({ widthMm: 123.456 }).widthMm).toBe(123.5);
  });

  it('allows zero margins', () => {
    expect(custom({ marginXMm: 0, marginYMm: 0 }).marginXMm).toBe(0);
  });
});

describe('content box', () => {
  it('subtracts both margins', () => {
    expect(contentWidthMm(A4_PAGE)).toBe(170);
    expect(contentHeightMm(A4_PAGE)).toBe(265);
  });
});

describe('cssPageSize', () => {
  it('emits a named size for the presets, which print engines match more reliably', () => {
    expect(cssPageSize(A4_PAGE)).toBe('A4');
    expect(cssPageSize(PAGE_PRESETS.a5)).toBe('A5');
    expect(cssPageSize(PAGE_PRESETS.letter)).toBe('letter');
    expect(cssPageSize(PAGE_PRESETS.legal)).toBe('legal');
  });

  it('falls back to explicit millimetres for a custom size', () => {
    expect(
      cssPageSize({ sizeId: 'custom', widthMm: 100, heightMm: 150, marginXMm: 5, marginYMm: 5 }),
    ).toBe('100mm 150mm');
  });
});

describe('round trip through the settings table', () => {
  it('survives serialise then parse', () => {
    const geometry = resolvePageGeometry({
      sizeId: 'custom',
      widthMm: 148,
      heightMm: 210,
      marginXMm: 9,
      marginYMm: 7,
    });
    expect(parsePageGeometry(serialisePageGeometry(geometry))).toEqual(geometry);
  });

  it('falls back to A4 on anything unreadable', () => {
    expect(parsePageGeometry(null)).toEqual(A4_PAGE);
    expect(parsePageGeometry('')).toEqual(A4_PAGE);
    expect(parsePageGeometry('not json')).toEqual(A4_PAGE);
    expect(parsePageGeometry('"a string"')).toEqual(A4_PAGE);
    expect(parsePageGeometry('null')).toEqual(A4_PAGE);
  });

  it('re-clamps a stored geometry that was hand-edited into nonsense', () => {
    const parsed = parsePageGeometry('{"sizeId":"custom","widthMm":9,"heightMm":9,"marginXMm":99,"marginYMm":99}');
    expect(parsed.widthMm).toBe(70);
    expect(contentWidthMm(parsed)).toBeGreaterThan(0);
    expect(contentHeightMm(parsed)).toBeGreaterThan(0);
  });
});

describe('describePage', () => {
  it('names the size and the margins', () => {
    expect(describePage(A4_PAGE)).toBe('A4 — 210 × 297 mm · 20/16 mm margins');
  });

  it('gives a custom size its dimensions instead of a name', () => {
    expect(
      describePage({ sizeId: 'custom', widthMm: 100, heightMm: 150, marginXMm: 5, marginYMm: 4 }),
    ).toBe('Custom — 100 × 150 mm · 5/4 mm margins');
  });
});
