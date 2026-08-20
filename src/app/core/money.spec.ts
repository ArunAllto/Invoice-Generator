import {
  applyBasisPoints,
  formatBasisPoints,
  formatMilli,
  formatPaise,
  groupIndian,
  mulDivRound,
  multiplyQuantity,
  parseCurrencyToPaise,
  parsePercentToBasisPoints,
  parseQuantityToMilli,
  roundHalfUp,
  roundToNearestRupee,
} from './money';

describe('roundHalfUp', () => {
  it('rounds a half upward', () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(2.5)).toBe(3); // not banker's rounding
  });

  it('rounds below a half downward', () => {
    expect(roundHalfUp(0.49)).toBe(0);
    expect(roundHalfUp(1.4999)).toBe(1);
  });

  it('is symmetric about zero, unlike Math.round', () => {
    expect(roundHalfUp(-0.5)).toBe(-1);
    expect(Math.round(-0.5)).toBe(-0); // the asymmetry we are avoiding
    expect(roundHalfUp(-1.5)).toBe(-2);
    expect(roundHalfUp(-1.4)).toBe(-1);
  });

  it('leaves integers alone', () => {
    expect(roundHalfUp(0)).toBe(0);
    expect(roundHalfUp(7)).toBe(7);
    expect(roundHalfUp(-7)).toBe(-7);
  });

  it('throws on non-finite input', () => {
    expect(() => roundHalfUp(NaN)).toThrow(RangeError);
    expect(() => roundHalfUp(Infinity)).toThrow(RangeError);
  });
});

describe('mulDivRound', () => {
  it('computes exact proportions', () => {
    expect(mulDivRound(1000, 18, 100)).toBe(180);
    expect(mulDivRound(100, 1, 3)).toBe(33);
    expect(mulDivRound(200, 1, 3)).toBe(67);
  });

  it('rounds halves up', () => {
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(mulDivRound(3, 1, 2)).toBe(2);
    expect(mulDivRound(5, 1, 10)).toBe(1);
  });

  it('is exact where floating point is not', () => {
    // 0.1 + 0.2 style error: 8100 * 1800 / 10000 must be exactly 1458.
    expect(mulDivRound(8100, 1800, 10_000)).toBe(1458);
    // The float path would give 1458.0000000000002 here.
    expect(mulDivRound(2_099_999, 1800, 10_000)).toBe(378_000);
  });

  it('survives products beyond Number.MAX_SAFE_INTEGER', () => {
    // 1e10 × 1e6 = 1e16, past 2^53. BigInt keeps it exact.
    expect(mulDivRound(10_000_000_000, 1_000_000, 1_000_000)).toBe(10_000_000_000);
    expect(mulDivRound(999_999_999, 1800, 10_000)).toBe(180_000_000);
  });

  it('handles negative values symmetrically', () => {
    expect(mulDivRound(-1000, 18, 100)).toBe(-180);
    expect(mulDivRound(1000, -18, 100)).toBe(-180);
    expect(mulDivRound(-1, 1, 2)).toBe(-1);
  });

  it('refuses a zero denominator and unsafe inputs', () => {
    expect(() => mulDivRound(100, 1, 0)).toThrow(RangeError);
    expect(() => mulDivRound(1.5, 1, 2)).toThrow(RangeError);
    expect(() => mulDivRound(NaN, 1, 2)).toThrow(RangeError);
  });

  it('throws instead of silently losing precision on an unsafe result', () => {
    expect(() => mulDivRound(Number.MAX_SAFE_INTEGER, 1000, 1)).toThrow(RangeError);
  });
});

describe('applyBasisPoints', () => {
  it('applies GST rates', () => {
    expect(applyBasisPoints(100_000, 1800)).toBe(18_000); // 18% of ₹1,000
    expect(applyBasisPoints(100_000, 500)).toBe(5000);
    expect(applyBasisPoints(100_000, 2800)).toBe(28_000);
    expect(applyBasisPoints(100_000, 0)).toBe(0);
  });

  it('handles fractional rates like 2.5%', () => {
    expect(applyBasisPoints(100_000, 250)).toBe(2500);
  });

  it('rounds a half-paisa result upward', () => {
    // 1 paisa at 50% is half a paisa → 1 paisa.
    expect(applyBasisPoints(1, 5000)).toBe(1);
  });
});

describe('multiplyQuantity', () => {
  it('multiplies whole quantities', () => {
    expect(multiplyQuantity(1000, 750_000)).toBe(750_000); // 1 × ₹7,500
    expect(multiplyQuantity(3000, 100_000)).toBe(300_000); // 3 × ₹1,000
  });

  it('multiplies fractional quantities exactly', () => {
    expect(multiplyQuantity(1500, 100_000)).toBe(150_000); // 1.5 × ₹1,000 = ₹1,500
    expect(multiplyQuantity(500, 100_001)).toBe(50_001); // 0.5 × ₹1,000.01
    expect(multiplyQuantity(250, 3)).toBe(1); // 0.25 × 3 paise = 0.75 → 1
  });

  it('handles a zero quantity or rate', () => {
    expect(multiplyQuantity(0, 100_000)).toBe(0);
    expect(multiplyQuantity(1500, 0)).toBe(0);
  });
});

describe('roundToNearestRupee', () => {
  it('rounds to whole rupees, half up', () => {
    expect(roundToNearestRupee(123_456)).toBe(123_500);
    expect(roundToNearestRupee(123_449)).toBe(123_400);
    expect(roundToNearestRupee(123_450)).toBe(123_500);
    expect(roundToNearestRupee(123_400)).toBe(123_400);
  });

  it('handles zero and negatives', () => {
    expect(roundToNearestRupee(0)).toBe(0);
    expect(roundToNearestRupee(-123_456)).toBe(-123_500);
  });
});

describe('parseCurrencyToPaise — the only decimal parser (§16.5)', () => {
  it('reads plain digits', () => {
    expect(parseCurrencyToPaise('7500')).toBe(750_000);
    expect(parseCurrencyToPaise('0')).toBe(0);
  });

  it('reads grouped digits, spaces and a rupee sign', () => {
    expect(parseCurrencyToPaise('7,500')).toBe(750_000);
    expect(parseCurrencyToPaise('₹7,500.50')).toBe(750_050);
    expect(parseCurrencyToPaise('  7500 ')).toBe(750_000);
    expect(parseCurrencyToPaise('12,34,567')).toBe(123_456_700);
  });

  it('reads decimals exactly, with no float drift', () => {
    expect(parseCurrencyToPaise('7500.50')).toBe(750_050);
    expect(parseCurrencyToPaise('7500.5')).toBe(750_050);
    expect(parseCurrencyToPaise('0.01')).toBe(1);
    expect(parseCurrencyToPaise('0.1')).toBe(10);
    // The classic float failure: 8.07 * 100 is 806.9999999999999 in IEEE 754.
    expect(parseCurrencyToPaise('8.07')).toBe(807);
    expect(parseCurrencyToPaise('1.005')).toBe(100); // third decimal truncated, not rounded
  });

  it('accepts partial input a user is mid-way through typing', () => {
    expect(parseCurrencyToPaise('.5')).toBe(50);
    expect(parseCurrencyToPaise('7500.')).toBe(750_000);
  });

  it('reads negatives', () => {
    expect(parseCurrencyToPaise('-250')).toBe(-25_000);
    expect(parseCurrencyToPaise('-0.50')).toBe(-50);
  });

  it('returns null for anything it cannot read', () => {
    for (const bad of ['', '   ', 'abc', '1.2.3', '--5', '-', '.', '1-2', '5%', '1e3']) {
      expect(parseCurrencyToPaise(bad)).toBeNull();
    }
    expect(parseCurrencyToPaise(null)).toBeNull();
    expect(parseCurrencyToPaise(undefined)).toBeNull();
  });

  it('accepts a number input for convenience', () => {
    expect(parseCurrencyToPaise(7500)).toBe(750_000);
    expect(parseCurrencyToPaise(7500.5)).toBe(750_050);
    expect(parseCurrencyToPaise(NaN)).toBeNull();
  });
});

describe('parseQuantityToMilli', () => {
  it('reads whole and fractional quantities', () => {
    expect(parseQuantityToMilli('1')).toBe(1000);
    expect(parseQuantityToMilli('1.5')).toBe(1500);
    expect(parseQuantityToMilli('0.25')).toBe(250);
    expect(parseQuantityToMilli('2.125')).toBe(2125);
    expect(parseQuantityToMilli('10')).toBe(10_000);
  });

  it('truncates beyond three decimals', () => {
    expect(parseQuantityToMilli('1.9999')).toBe(1999);
  });

  it('returns null for junk', () => {
    expect(parseQuantityToMilli('abc')).toBeNull();
    expect(parseQuantityToMilli('')).toBeNull();
    expect(parseQuantityToMilli('1.2.3')).toBeNull();
  });
});

describe('parsePercentToBasisPoints', () => {
  it('reads whole and fractional percentages', () => {
    expect(parsePercentToBasisPoints('18')).toBe(1800);
    expect(parsePercentToBasisPoints('18.5')).toBe(1850);
    expect(parsePercentToBasisPoints('2.5')).toBe(250);
    expect(parsePercentToBasisPoints('0')).toBe(0);
    expect(parsePercentToBasisPoints('100')).toBe(10_000);
  });

  it('tolerates a trailing percent sign', () => {
    expect(parsePercentToBasisPoints('18 %')).toBe(1800);
    expect(parsePercentToBasisPoints('18%')).toBe(1800);
  });
});

describe('groupIndian', () => {
  it('groups the Indian way: last three, then pairs', () => {
    expect(groupIndian('1')).toBe('1');
    expect(groupIndian('999')).toBe('999');
    expect(groupIndian('1000')).toBe('1,000');
    expect(groupIndian('99999')).toBe('99,999');
    expect(groupIndian('100000')).toBe('1,00,000');
    expect(groupIndian('1234567')).toBe('12,34,567');
    expect(groupIndian('10000000')).toBe('1,00,00,000');
    expect(groupIndian('1234567890')).toBe('1,23,45,67,890');
  });
});

describe('formatPaise', () => {
  it('formats with two decimals and Indian grouping by default', () => {
    expect(formatPaise(750_050)).toBe('7,500.50');
    expect(formatPaise(0)).toBe('0.00');
    expect(formatPaise(100)).toBe('1.00');
    expect(formatPaise(12_345_678_900)).toBe('12,34,56,789.00');
  });

  it('adds the rupee sign on request', () => {
    expect(formatPaise(750_050, { symbol: true })).toBe('₹7,500.50');
    expect(formatPaise(750_050, { symbol: true, currencySymbol: 'Rs. ' })).toBe('Rs. 7,500.50');
  });

  it('can drop decimals — but never when there are paise to lose', () => {
    expect(formatPaise(750_000, { decimals: false })).toBe('7,500');
    // Dropping ".50" here would misstate the amount, so it is kept.
    expect(formatPaise(750_050, { decimals: false })).toBe('7,500.50');
  });

  it('can switch off Indian grouping', () => {
    expect(formatPaise(12_345_678_900, { indianGrouping: false })).toBe('123456789.00');
  });

  it('formats negatives with the sign outside the symbol', () => {
    expect(formatPaise(-750_050)).toBe('-7,500.50');
    expect(formatPaise(-750_050, { symbol: true })).toBe('-₹7,500.50');
  });

  it('round-trips through the parser', () => {
    for (const paise of [0, 1, 99, 100, 750_050, 123_456_789]) {
      expect(parseCurrencyToPaise(formatPaise(paise))).toBe(paise);
    }
  });
});

describe('formatMilli', () => {
  it('trims meaningless trailing zeros', () => {
    expect(formatMilli(1000)).toBe('1');
    expect(formatMilli(1500)).toBe('1.5');
    expect(formatMilli(2125)).toBe('2.125');
    expect(formatMilli(250)).toBe('0.25');
    expect(formatMilli(0)).toBe('0');
    expect(formatMilli(10_000)).toBe('10');
  });

  it('round-trips through the parser', () => {
    for (const milli of [0, 1, 250, 1000, 1500, 2125, 999_999]) {
      expect(parseQuantityToMilli(formatMilli(milli))).toBe(milli);
    }
  });
});

describe('formatBasisPoints', () => {
  it('renders rates the way an invoice prints them', () => {
    expect(formatBasisPoints(1800)).toBe('18');
    expect(formatBasisPoints(1850)).toBe('18.5');
    expect(formatBasisPoints(250)).toBe('2.5');
    expect(formatBasisPoints(0)).toBe('0');
    expect(formatBasisPoints(10_000)).toBe('100');
    expect(formatBasisPoints(1)).toBe('0.01');
  });
});
