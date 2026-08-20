import { amountInWords, numberToWordsIndian } from './number-to-words-indian';

describe('numberToWordsIndian — the boundary cases named in §9.5', () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [0, 'Zero'],
    [1, 'One'],
    [2, 'Two'],
    [9, 'Nine'],
    [10, 'Ten'],
    [11, 'Eleven'],
    [13, 'Thirteen'],
    [19, 'Nineteen'],
    [20, 'Twenty'],
    [21, 'Twenty One'],
    [40, 'Forty'],
    [45, 'Forty Five'],
    [90, 'Ninety'],
    [99, 'Ninety Nine'],
    [100, 'One Hundred'],
    [101, 'One Hundred One'],
    [110, 'One Hundred Ten'],
    [119, 'One Hundred Nineteen'],
    [500, 'Five Hundred'],
    [550, 'Five Hundred Fifty'],
    [999, 'Nine Hundred Ninety Nine'],
    [1000, 'One Thousand'],
    [1001, 'One Thousand One'],
    [1100, 'One Thousand One Hundred'],
    [11_000, 'Eleven Thousand'],
    [19_999, 'Nineteen Thousand Nine Hundred Ninety Nine'],
    [20_000, 'Twenty Thousand'],
    [99_999, 'Ninety Nine Thousand Nine Hundred Ninety Nine'],
    [100_000, 'One Lakh'],
    [100_001, 'One Lakh One'],
    [120_500, 'One Lakh Twenty Thousand Five Hundred'],
    [999_999, 'Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine'],
    [1_000_000, 'Ten Lakh'],
    [9_999_999, 'Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine'],
    [10_000_000, 'One Crore'],
    [10_000_001, 'One Crore One'],
    [10_100_000, 'One Crore One Lakh'],
    [12_345_678, 'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight'],
    [99_99_99_999, 'Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine'],
  ];

  it.each(cases)('%d → %s', (input, expected) => {
    expect(numberToWordsIndian(input)).toBe(expected);
  });
});

describe('numberToWordsIndian — above one crore (§9.5)', () => {
  it('writes the crore count in the Indian system too', () => {
    expect(numberToWordsIndian(1_000_000_000)).toBe('One Hundred Crore');
    expect(numberToWordsIndian(1_000_000_0000)).toBe('One Thousand Crore');
    expect(numberToWordsIndian(100_000_000_000)).toBe('Ten Thousand Crore');
    expect(numberToWordsIndian(1_000_000_000_000)).toBe('One Lakh Crore');
  });

  it('keeps the lower groups after a large crore count', () => {
    expect(numberToWordsIndian(1_000_000_100)).toBe('One Hundred Crore One Hundred');
    expect(numberToWordsIndian(2_50_00_00_000)).toBe('Two Hundred Fifty Crore');
  });
});

describe('numberToWordsIndian — optional "and" before the tens', () => {
  it('inserts "and" only when asked', () => {
    expect(numberToWordsIndian(999, { useAndBeforeTens: true })).toBe('Nine Hundred and Ninety Nine');
    expect(numberToWordsIndian(999)).toBe('Nine Hundred Ninety Nine');
  });

  it('does not insert "and" when there are no tens to join', () => {
    expect(numberToWordsIndian(500, { useAndBeforeTens: true })).toBe('Five Hundred');
  });
});

describe('numberToWordsIndian — refuses to guess', () => {
  it('throws on a negative value', () => {
    expect(() => numberToWordsIndian(-1)).toThrow(RangeError);
  });

  it('throws on a non-integer', () => {
    expect(() => numberToWordsIndian(1.5)).toThrow(RangeError);
  });

  it('throws beyond safe integer range rather than printing a wrong amount', () => {
    expect(() => numberToWordsIndian(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => numberToWordsIndian(Infinity)).toThrow(RangeError);
    expect(() => numberToWordsIndian(NaN)).toThrow(RangeError);
  });
});

describe('amountInWords — the printed line (§9.5)', () => {
  it('matches the spec example for ₹11,000', () => {
    expect(amountInWords(11_000 * 100)).toBe('Rupees Eleven Thousand Only');
  });

  it('matches the spec example for ₹1,20,500.50', () => {
    expect(amountInWords(120_500 * 100 + 50)).toBe(
      'Rupees One Lakh Twenty Thousand Five Hundred and Fifty Paise Only',
    );
  });

  it('omits the paise clause for an exact rupee amount', () => {
    expect(amountInWords(750_000)).toBe('Rupees Seven Thousand Five Hundred Only');
    expect(amountInWords(750_000)).not.toContain('Paise');
  });

  it('handles zero', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });

  it('handles paise-only amounts', () => {
    expect(amountInWords(1)).toBe('Rupees Zero and One Paise Only');
    expect(amountInWords(99)).toBe('Rupees Zero and Ninety Nine Paise Only');
  });

  it('handles a single paisa above a rupee boundary', () => {
    expect(amountInWords(100_01)).toBe('Rupees One Hundred and One Paise Only');
  });

  it('handles a crore-scale invoice', () => {
    expect(amountInWords(1_00_00_000 * 100)).toBe('Rupees One Crore Only');
    expect(amountInWords(1_23_45_678 * 100 + 90)).toBe(
      'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Paise Only',
    );
  });

  it('prefixes "Minus" for a negative adjustment', () => {
    expect(amountInWords(-150_050)).toBe('Minus Rupees One Thousand Five Hundred and Fifty Paise Only');
  });

  it('lets the currency nouns and suffix be replaced', () => {
    expect(amountInWords(150_050, { majorUnit: 'Dollars', minorUnit: 'Cents', suffix: '' })).toBe(
      'Dollars One Thousand Five Hundred and Fifty Cents',
    );
  });

  it('never emits doubled or leading whitespace', () => {
    for (const paise of [0, 1, 100, 10_000, 1_00_00_000_00, 123_456_789]) {
      const words = amountInWords(paise);
      expect(words).toBe(words.trim());
      expect(words).not.toMatch(/\s{2}/);
    }
  });

  it('throws rather than printing a wrong amount for a non-integer paise value', () => {
    expect(() => amountInWords(10.5)).toThrow(RangeError);
  });
});
