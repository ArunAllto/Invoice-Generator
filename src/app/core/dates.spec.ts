import {
  addDaysIso,
  compareIsoDates,
  daysBetweenIso,
  formatIsoDate,
  isAfterIso,
  isBeforeIso,
  isoDateOnly,
  isValidIsoDate,
  nowIsoWithOffset,
  parseIsoDateParts,
  todayIso,
} from './dates';

describe('isoDateOnly / parseIsoDateParts', () => {
  it('takes the calendar date out of a bare date or a full timestamp', () => {
    expect(isoDateOnly('2026-08-18')).toBe('2026-08-18');
    expect(isoDateOnly('2026-08-18T15:42:07+05:30')).toBe('2026-08-18');
    expect(isoDateOnly('2026-08-18T00:00:00Z')).toBe('2026-08-18');
  });

  it('splits into numeric parts', () => {
    expect(parseIsoDateParts('2026-08-18T15:42:07+05:30')).toEqual({
      year: 2026,
      month: 8,
      day: 18,
    });
  });

  it('throws on anything that is not an ISO date', () => {
    for (const bad of ['', '18/08/2026', '2026-8-18', 'yesterday', '20260818']) {
      expect(() => isoDateOnly(bad)).toThrow(RangeError);
    }
  });

  it('reads a date the same way regardless of the running timezone', () => {
    // The whole reason this module works on strings: `new Date('2026-04-01')` is UTC
    // midnight, which is 31 March in any negative-offset zone. String parsing cannot
    // drift, so the financial-year boundary is safe wherever the phone is.
    const original = process.env['TZ'];
    try {
      for (const zone of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env['TZ'] = zone;
        expect(parseIsoDateParts('2026-04-01').day).toBe(1);
        expect(parseIsoDateParts('2026-04-01').month).toBe(4);
      }
    } finally {
      process.env['TZ'] = original;
    }
  });
});

describe('comparison', () => {
  it('orders dates', () => {
    expect(compareIsoDates('2026-08-18', '2026-08-19')).toBeLessThan(0);
    expect(compareIsoDates('2026-08-19', '2026-08-18')).toBeGreaterThan(0);
    expect(compareIsoDates('2026-08-18', '2026-08-18')).toBe(0);
  });

  it('orders across month and year boundaries', () => {
    expect(compareIsoDates('2026-03-31', '2026-04-01')).toBeLessThan(0);
    expect(compareIsoDates('2026-12-31', '2027-01-01')).toBeLessThan(0);
  });

  it('ignores the time portion', () => {
    expect(compareIsoDates('2026-08-18T23:59:00+05:30', '2026-08-18T00:01:00+05:30')).toBe(0);
  });

  it('exposes readable predicates', () => {
    expect(isBeforeIso('2026-08-17', '2026-08-18')).toBe(true);
    expect(isAfterIso('2026-08-19', '2026-08-18')).toBe(true);
    expect(isBeforeIso('2026-08-18', '2026-08-18')).toBe(false);
  });
});

describe('addDaysIso', () => {
  it('adds and subtracts days', () => {
    expect(addDaysIso('2026-08-18', 1)).toBe('2026-08-19');
    expect(addDaysIso('2026-08-18', -1)).toBe('2026-08-17');
    expect(addDaysIso('2026-08-18', 0)).toBe('2026-08-18');
    expect(addDaysIso('2026-08-18', 30)).toBe('2026-09-17');
  });

  it('crosses month and year boundaries', () => {
    expect(addDaysIso('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDaysIso('2027-03-31', 1)).toBe('2027-04-01');
  });

  it('handles leap years', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29'); // 2028 is a leap year
    expect(addDaysIso('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDaysIso('2027-02-28', 1)).toBe('2027-03-01'); // 2027 is not
  });

  it('is the natural inverse of itself', () => {
    expect(addDaysIso(addDaysIso('2026-08-18', 45), -45)).toBe('2026-08-18');
  });
});

describe('daysBetweenIso', () => {
  it('counts whole days, signed', () => {
    expect(daysBetweenIso('2026-08-18', '2026-08-19')).toBe(1);
    expect(daysBetweenIso('2026-08-19', '2026-08-18')).toBe(-1);
    expect(daysBetweenIso('2026-08-18', '2026-08-18')).toBe(0);
    expect(daysBetweenIso('2026-08-18', '2026-09-17')).toBe(30);
  });

  it('is unaffected by daylight-saving transitions in the host timezone', () => {
    const original = process.env['TZ'];
    try {
      process.env['TZ'] = 'America/New_York';
      // A DST change inside this span would make a local-time subtraction return 29.96.
      expect(daysBetweenIso('2027-03-01', '2027-03-31')).toBe(30);
    } finally {
      process.env['TZ'] = original;
    }
  });
});

describe('formatIsoDate', () => {
  it('renders each supported style', () => {
    expect(formatIsoDate('2026-08-18', 'dd MMM yyyy')).toBe('18 Aug 2026');
    expect(formatIsoDate('2026-08-18', 'dd/MM/yyyy')).toBe('18/08/2026');
    expect(formatIsoDate('2026-08-18', 'd MMMM yyyy')).toBe('18 August 2026');
    expect(formatIsoDate('2026-08-18', 'yyyy-MM-dd')).toBe('2026-08-18');
  });

  it('defaults to the print style and pads single digits', () => {
    expect(formatIsoDate('2026-01-05')).toBe('05 Jan 2026');
    expect(formatIsoDate('2026-01-05', 'd MMMM yyyy')).toBe('5 January 2026');
  });

  it('renders every month name', () => {
    const names = Array.from({ length: 12 }, (_unused, i) =>
      formatIsoDate(`2026-${String(i + 1).padStart(2, '0')}-01`).slice(3, 6),
    );
    expect(names).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]);
  });
});

describe('isValidIsoDate', () => {
  it('accepts real dates', () => {
    expect(isValidIsoDate('2026-08-18')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
  });

  it('rejects impossible dates', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-00-10')).toBe(false);
    expect(isValidIsoDate('2026-08-32')).toBe(false);
    expect(isValidIsoDate('not a date')).toBe(false);
  });
});

describe('todayIso / nowIsoWithOffset', () => {
  it('formats a supplied clock reading as a local calendar date', () => {
    expect(todayIso(new Date(2026, 7, 18, 15, 42))).toBe('2026-08-18');
    expect(todayIso(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });

  it('produces a timestamp with an offset, as §5 requires', () => {
    const stamp = nowIsoWithOffset(new Date(2026, 7, 18, 15, 42, 7));
    expect(stamp).toMatch(/^2026-08-18T15:42:07[+-]\d{2}:\d{2}$/);
    // It must round-trip back through the date-only parser.
    expect(isoDateOnly(stamp)).toBe('2026-08-18');
  });

  it('reads the real clock without throwing', () => {
    expect(isValidIsoDate(todayIso())).toBe(true);
    expect(isoDateOnly(nowIsoWithOffset())).toBe(todayIso());
  });
});
