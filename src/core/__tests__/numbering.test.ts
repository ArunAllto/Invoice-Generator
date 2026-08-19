import {
  allocateNextSeq,
  financialYearOf,
  findSequenceGaps,
  formatFyToken,
  isDateInFinancialYear,
  isDuplicateNumber,
  previewNextNumber,
  renderDocumentNumber,
  type AllocationFacts,
  type NumberingSeriesShape,
} from '../numbering';

const SERIES: NumberingSeriesShape = {
  prefix: 'CP/Q/',
  suffix: '',
  includeFy: true,
  fyFormat: '2026-27',
  fySeparator: '/',
  padWidth: 3,
};

describe('financialYearOf — Indian FY starts 1 April (§8.2)', () => {
  it('places 18 August 2026 in FY 2026-27, as the spec states', () => {
    const fy = financialYearOf('2026-08-18');
    expect(fy).toEqual({ startYear: 2026, endYear: 2027, key: 'FY2026' });
  });

  it('places 31 March 2027 in the OLD financial year', () => {
    expect(financialYearOf('2027-03-31')).toEqual({
      startYear: 2026,
      endYear: 2027,
      key: 'FY2026',
    });
  });

  it('places 1 April 2027 in the NEW financial year', () => {
    expect(financialYearOf('2027-04-01')).toEqual({
      startYear: 2027,
      endYear: 2028,
      key: 'FY2027',
    });
  });

  it('handles the January–March tail of a financial year', () => {
    expect(financialYearOf('2027-01-01').startYear).toBe(2026);
    expect(financialYearOf('2027-02-28').startYear).toBe(2026);
  });

  it('is unaffected by a time and offset on the input', () => {
    expect(financialYearOf('2027-04-01T00:15:00+05:30').startYear).toBe(2027);
    expect(financialYearOf('2027-03-31T23:59:59+05:30').startYear).toBe(2026);
  });
});

describe('formatFyToken', () => {
  it('renders both configured styles', () => {
    const fy = financialYearOf('2026-08-18');
    expect(formatFyToken(fy, '2026-27')).toBe('2026-27');
    expect(formatFyToken(fy, '26-27')).toBe('26-27');
  });

  it('renders a century boundary correctly', () => {
    const fy = financialYearOf('2099-12-01');
    expect(formatFyToken(fy, '2026-27')).toBe('2099-00');
    expect(formatFyToken(fy, '26-27')).toBe('99-00');
  });
});

describe('renderDocumentNumber — format (§8.1)', () => {
  it('produces the spec example with the FY token', () => {
    expect(renderDocumentNumber(SERIES, 1, '2026-08-18')).toBe('CP/Q/2026-27/001');
  });

  it('produces the spec example without the FY token', () => {
    const series = { ...SERIES, prefix: 'CP/Q/2026-', includeFy: false };
    expect(renderDocumentNumber(series, 1, '2026-08-18')).toBe('CP/Q/2026-001');
  });

  it('pads to the configured width and grows past it', () => {
    expect(renderDocumentNumber(SERIES, 7, '2026-08-18')).toBe('CP/Q/2026-27/007');
    expect(renderDocumentNumber(SERIES, 42, '2026-08-18')).toBe('CP/Q/2026-27/042');
    expect(renderDocumentNumber(SERIES, 1234, '2026-08-18')).toBe('CP/Q/2026-27/1234');
  });

  it('appends a suffix when configured', () => {
    expect(renderDocumentNumber({ ...SERIES, suffix: '-REV' }, 3, '2026-08-18')).toBe(
      'CP/Q/2026-27/003-REV',
    );
  });

  it('honours a non-default FY separator', () => {
    expect(renderDocumentNumber({ ...SERIES, fySeparator: '-' }, 3, '2026-08-18')).toBe(
      'CP/Q/2026-27-003',
    );
  });

  it('rolls the FY token over on 1 April', () => {
    expect(renderDocumentNumber(SERIES, 1, '2027-03-31')).toBe('CP/Q/2026-27/001');
    expect(renderDocumentNumber(SERIES, 1, '2027-04-01')).toBe('CP/Q/2027-28/001');
  });

  it('rejects a negative sequence rather than printing nonsense', () => {
    expect(() => renderDocumentNumber(SERIES, -1, '2026-08-18')).toThrow(RangeError);
  });
});

describe('allocateNextSeq — reset rules (§8.2, §8.3)', () => {
  const facts = (overrides: Partial<AllocationFacts> = {}): AllocationFacts => ({
    maxSeqOverall: null,
    maxSeqInFy: null,
    nextSeq: 1,
    resetRule: 'never',
    ...overrides,
  });

  it('starts at 1 for a brand-new series', () => {
    expect(allocateNextSeq(facts())).toBe(1);
    expect(allocateNextSeq(facts({ resetRule: 'yearly_april' }))).toBe(1);
  });

  it("acceptance test §14.8: abandoned drafts leave no gaps — 12 deleted drafts then '001'", () => {
    // Drafts never get a number (§8.3), so the repository reports no history at all.
    expect(allocateNextSeq(facts({ maxSeqOverall: null, maxSeqInFy: null, nextSeq: 1 }))).toBe(1);
  });

  it('restarts at 1 in a new financial year under yearly_april', () => {
    // 23 documents issued last FY; the first of the new FY must be 001.
    const allocated = allocateNextSeq(
      facts({ resetRule: 'yearly_april', maxSeqOverall: 23, maxSeqInFy: null, nextSeq: 24 }),
    );
    expect(allocated).toBe(1);
  });

  it('continues the run inside the same financial year under yearly_april', () => {
    expect(
      allocateNextSeq(
        facts({ resetRule: 'yearly_april', maxSeqOverall: 23, maxSeqInFy: 23, nextSeq: 24 }),
      ),
    ).toBe(24);
  });

  it('never resets under the never rule, even across a financial year', () => {
    expect(
      allocateNextSeq(facts({ resetRule: 'never', maxSeqOverall: 23, maxSeqInFy: null, nextSeq: 24 })),
    ).toBe(24);
  });

  it('refuses to hand out a number already used, even if the stored counter is stale', () => {
    // A restored backup could leave next_seq behind the real history.
    expect(
      allocateNextSeq(facts({ resetRule: 'never', maxSeqOverall: 50, nextSeq: 4 })),
    ).toBe(51);
  });

  it('honours a stored counter jumped forward by the user in settings', () => {
    expect(allocateNextSeq(facts({ resetRule: 'never', maxSeqOverall: 10, nextSeq: 500 }))).toBe(500);
  });

  it('treats a zero or negative stored counter as 1', () => {
    expect(allocateNextSeq(facts({ resetRule: 'never', maxSeqOverall: null, nextSeq: 0 }))).toBe(1);
  });

  it('acceptance test §14.7: 31 March then 1 April with yearly_april', () => {
    // Document A on 31 March 2027 — third of FY 2026-27.
    const seqA = allocateNextSeq({
      resetRule: 'yearly_april',
      maxSeqOverall: 2,
      maxSeqInFy: 2,
      nextSeq: 3,
    });
    expect(seqA).toBe(3);
    expect(renderDocumentNumber(SERIES, seqA, '2027-03-31')).toBe('CP/Q/2026-27/003');

    // Document B the next day — first of FY 2027-28, so back to 001 with a new token.
    const seqB = allocateNextSeq({
      resetRule: 'yearly_april',
      maxSeqOverall: 3,
      maxSeqInFy: null,
      nextSeq: 4,
    });
    expect(seqB).toBe(1);
    expect(renderDocumentNumber(SERIES, seqB, '2027-04-01')).toBe('CP/Q/2027-28/001');
  });

  it('backdating into the previous FY continues that year, not this one', () => {
    // This FY already has 5 documents; last FY had 30. A backdated document gets 31.
    expect(
      allocateNextSeq({
        resetRule: 'yearly_april',
        maxSeqOverall: 30,
        maxSeqInFy: 30,
        nextSeq: 6,
      }),
    ).toBe(31);
  });
});

describe('previewNextNumber (§8.3)', () => {
  it('shows the number a draft would receive', () => {
    expect(
      previewNextNumber(
        SERIES,
        { resetRule: 'never', maxSeqOverall: 3, maxSeqInFy: 3, nextSeq: 4 },
        '2026-08-18',
      ),
    ).toBe('CP/Q/2026-27/004');
  });
});

describe('isDuplicateNumber (§8.4)', () => {
  it('detects an exact duplicate', () => {
    expect(isDuplicateNumber('CP/Q/2026-27/001', ['CP/Q/2026-27/001'])).toBe(true);
  });

  it('detects a duplicate that differs only by case or padding whitespace', () => {
    expect(isDuplicateNumber('cp/q/2026-27/001', ['CP/Q/2026-27/001'])).toBe(true);
    expect(isDuplicateNumber('  CP/Q/2026-27/001  ', ['CP/Q/2026-27/001'])).toBe(true);
  });

  it('does not flag a genuinely different number', () => {
    expect(isDuplicateNumber('CP/Q/2026-27/002', ['CP/Q/2026-27/001'])).toBe(false);
    expect(isDuplicateNumber('CP/Q/2026-27/001', [])).toBe(false);
  });

  it('does not flag a document against itself', () => {
    const owners = new Map([['CP/Q/2026-27/001', 'doc-a']]);
    expect(isDuplicateNumber('CP/Q/2026-27/001', ['CP/Q/2026-27/001'], 'doc-a', owners)).toBe(false);
    expect(isDuplicateNumber('CP/Q/2026-27/001', ['CP/Q/2026-27/001'], 'doc-b', owners)).toBe(true);
  });
});

describe('findSequenceGaps', () => {
  it('finds nothing in a contiguous run', () => {
    expect(findSequenceGaps([1, 2, 3, 4])).toEqual([]);
    expect(findSequenceGaps([])).toEqual([]);
    expect(findSequenceGaps([1])).toEqual([]);
  });

  it('reports missing numbers below the highest issued', () => {
    expect(findSequenceGaps([1, 2, 5])).toEqual([3, 4]);
    expect(findSequenceGaps([3])).toEqual([1, 2]);
  });

  it('ignores duplicates and order', () => {
    expect(findSequenceGaps([4, 1, 2, 2, 4])).toEqual([3]);
  });
});

describe('isDateInFinancialYear', () => {
  const fy = financialYearOf('2026-08-18');

  it('includes both endpoints', () => {
    expect(isDateInFinancialYear('2026-04-01', fy)).toBe(true);
    expect(isDateInFinancialYear('2027-03-31', fy)).toBe(true);
  });

  it('excludes the day either side', () => {
    expect(isDateInFinancialYear('2026-03-31', fy)).toBe(false);
    expect(isDateInFinancialYear('2027-04-01', fy)).toBe(false);
  });
});
