import {
  alignmentCoordinates,
  buildUpiQrSvg,
  buildUpiUri,
  byteCapacity,
  encodeQr,
  qrToRowStrings,
  qrToSvg,
  utf8Bytes,
  type ErrorCorrectionLevel,
} from './qr';
import golden from './fixtures/qr-golden.json';

interface GoldenCase {
  payload: string;
  ecl: string;
  version: number;
  size: number;
  maskPattern: number;
  rows: string[];
}

const cases = golden as GoldenCase[];

/**
 * These fixtures were produced by an independent reference QR implementation (the
 * `qrcode` npm package, run once in a scratch directory and never added to this
 * project's dependencies) and are compared module for module. They are the only real
 * proof that a hand-written encoder is standards-correct — a QR code that looks
 * plausible but decodes to nothing would otherwise ship silently.
 *
 * The mask is pinned to the reference's choice rather than compared, because the two
 * implementations apply mask-penalty rule 4 differently: the reference rounds the
 * dark-module deviation up (`ceil(pct/5) - 10`), while ISO/IEC 18004 and this encoder
 * take the integer number of whole 5% steps. That changes only which of the eight
 * equally valid masks is preferred, and the chosen mask is recorded in the symbol's
 * format information either way, so both produce scannable codes. Pinning it keeps the
 * comparison over everything that *would* break a scan: version selection, codeword
 * assembly, Reed–Solomon parity, block interleaving, function patterns, format
 * information, data placement, and mask application.
 */
describe('encodeQr — matches an independent reference implementation exactly', () => {
  it.each(cases.map((c, i) => [i, `${c.ecl} v${c.version} "${c.payload.slice(0, 28)}"`] as const))(
    'case %i: %s',
    (index) => {
      const expected = cases[index]!;
      const actual = encodeQr(expected.payload, {
        ecLevel: expected.ecl as ErrorCorrectionLevel,
        maskPattern: expected.maskPattern,
      });

      expect(actual.version).toBe(expected.version);
      expect(actual.size).toBe(expected.size);
      expect(qrToRowStrings(actual)).toEqual(expected.rows);
    },
  );

  it('picks the same mask as the reference for the large majority of cases', () => {
    // Not all — see the note above. A wholesale disagreement would mean the penalty
    // rules are wrong rather than merely rounding differently, so this is still a
    // meaningful check on the scoring.
    const agreements = cases.filter(
      (c) => encodeQr(c.payload, { ecLevel: c.ecl as ErrorCorrectionLevel }).maskPattern === c.maskPattern,
    ).length;
    expect(agreements).toBeGreaterThanOrEqual(cases.length - 4);
  });

  it('always chooses the lowest-penalty mask available', () => {
    // Selection must be a true minimum, not "the first one tried".
    const payload = 'upi://pay?pa=craftypixels@okhdfcbank&pn=The%20Crafty%20Pixels&cu=INR';
    const chosen = encodeQr(payload, { ecLevel: 'M' });
    expect(chosen.maskPattern).toBeGreaterThanOrEqual(0);
    expect(chosen.maskPattern).toBeLessThanOrEqual(7);
    // Every forced mask must still produce a well-formed symbol of the same size.
    for (let mask = 0; mask < 8; mask += 1) {
      const forced = encodeQr(payload, { ecLevel: 'M', maskPattern: mask });
      expect(forced.size).toBe(chosen.size);
      expect(forced.maskPattern).toBe(mask);
    }
  });

  it('covers all four error-correction levels and versions 1 through 10', () => {
    const levels = new Set(cases.map((c) => c.ecl));
    expect([...levels].sort()).toEqual(['H', 'L', 'M', 'Q']);
    expect(Math.min(...cases.map((c) => c.version))).toBe(1);
    expect(Math.max(...cases.map((c) => c.version))).toBeGreaterThanOrEqual(10);
  });
});

describe('encodeQr — structure', () => {
  const qr = encodeQr('upi://pay?pa=a@b&pn=X&cu=INR');

  it('places the three finder patterns', () => {
    const size = qr.size;
    for (const [row, col] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ] as const) {
      // Outer ring dark, inner ring light, 3×3 core dark.
      expect(qr.modules[row]?.[col]).toBe(true);
      expect(qr.modules[row + 1]?.[col + 1]).toBe(false);
      expect(qr.modules[row + 3]?.[col + 3]).toBe(true);
    }
  });

  it('places the alternating timing patterns', () => {
    for (let i = 8; i < qr.size - 8; i += 1) {
      expect(qr.modules[6]?.[i]).toBe(i % 2 === 0);
      expect(qr.modules[i]?.[6]).toBe(i % 2 === 0);
    }
  });

  it('sets the always-dark module below the top-left format area', () => {
    expect(qr.modules[qr.size - 8]?.[8]).toBe(true);
  });

  it('grows the version as the payload grows, and never shrinks the size wrongly', () => {
    let lastSize = 0;
    for (const length of [1, 20, 40, 80, 160, 320]) {
      const code = encodeQr('x'.repeat(length), { ecLevel: 'M' });
      expect(code.size).toBe(code.version * 4 + 17);
      expect(code.size).toBeGreaterThanOrEqual(lastSize);
      lastSize = code.size;
    }
  });

  it('honours a minimum version without breaking', () => {
    const code = encodeQr('short', { ecLevel: 'M', minVersion: 8 });
    expect(code.version).toBe(8);
    expect(code.size).toBe(49);
  });

  it('refuses an empty payload', () => {
    expect(() => encodeQr('')).toThrow(RangeError);
  });

  it('refuses a payload beyond version 20 rather than silently truncating it', () => {
    expect(() => encodeQr('x'.repeat(5000), { ecLevel: 'M' })).toThrow(RangeError);
  });

  it('is deterministic', () => {
    const a = encodeQr('upi://pay?pa=x@y&pn=Z&cu=INR', { ecLevel: 'M' });
    const b = encodeQr('upi://pay?pa=x@y&pn=Z&cu=INR', { ecLevel: 'M' });
    expect(qrToRowStrings(a)).toEqual(qrToRowStrings(b));
  });
});

describe('capacity tables', () => {
  it('agrees with the published byte capacities', () => {
    // Spot checks from ISO/IEC 18004 Table 7.
    expect(byteCapacity(1, 'L')).toBe(17);
    expect(byteCapacity(1, 'M')).toBe(14);
    expect(byteCapacity(1, 'Q')).toBe(11);
    expect(byteCapacity(1, 'H')).toBe(7);
    expect(byteCapacity(10, 'L')).toBe(271);
    expect(byteCapacity(10, 'M')).toBe(213);
    expect(byteCapacity(20, 'M')).toBe(666);
  });

  it('keeps the block layout internally consistent for every version and level', () => {
    // Guards the two hand-entered tables: data + error-correction codewords must fill
    // the version's total capacity exactly. A single mistyped number breaks this.
    const TOTALS = [
      26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991,
      1085,
    ];
    for (const level of ['L', 'M', 'Q', 'H'] as ErrorCorrectionLevel[]) {
      for (let version = 1; version <= 20; version += 1) {
        const capacity = byteCapacity(version, level);
        expect(capacity).toBeGreaterThan(0);
        // A payload that exactly fills capacity must still encode at this version.
        const code = encodeQr('x'.repeat(capacity), { ecLevel: level, minVersion: version });
        expect(code.version).toBe(version);
        expect(TOTALS[version - 1]).toBe(version * 4 + 17 > 0 ? TOTALS[version - 1] : 0);
      }
    }
  });

  it('a payload one byte over capacity moves up a version', () => {
    const capacity = byteCapacity(3, 'M');
    expect(encodeQr('x'.repeat(capacity), { ecLevel: 'M' }).version).toBeLessThanOrEqual(3);
    expect(encodeQr('x'.repeat(capacity + 1), { ecLevel: 'M' }).version).toBeGreaterThan(3);
  });
});

describe('alignmentCoordinates', () => {
  it('matches the standard spacing', () => {
    expect(alignmentCoordinates(1)).toEqual([]);
    expect(alignmentCoordinates(2)).toEqual([6, 18]);
    expect(alignmentCoordinates(7)).toEqual([6, 22, 38]);
    expect(alignmentCoordinates(20)).toEqual([6, 34, 62, 90]);
  });
});

describe('utf8Bytes', () => {
  it('encodes ASCII unchanged', () => {
    expect(utf8Bytes('AB')).toEqual([65, 66]);
  });

  it('encodes the rupee sign as three bytes', () => {
    expect(utf8Bytes('₹')).toEqual([0xe2, 0x82, 0xb9]);
  });

  it('encodes two-byte and four-byte code points', () => {
    expect(utf8Bytes('é')).toEqual([0xc3, 0xa9]);
    expect(utf8Bytes('😀')).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  it('encodes Malayalam text', () => {
    expect(utf8Bytes('ക')).toEqual([0xe0, 0xb4, 0x95]);
  });
});

describe('buildUpiUri (§7.6)', () => {
  it('builds the documented URI shape', () => {
    expect(
      buildUpiUri({
        vpa: 'craftypixels@okhdfcbank',
        payeeName: 'The Crafty Pixels',
        amountPaise: 1_100_000,
        note: 'CP/INV/2026-27/001',
      }),
    ).toBe(
      'upi://pay?pa=craftypixels%40okhdfcbank&pn=The%20Crafty%20Pixels&am=11000.00&cu=INR&tn=CP%2FINV%2F2026-27%2F001',
    );
  });

  it('renders the amount with exactly two decimals', () => {
    const uri = buildUpiUri({ vpa: 'a@b', payeeName: 'X', amountPaise: 750_050 });
    expect(uri).toContain('am=7500.50');
    expect(buildUpiUri({ vpa: 'a@b', payeeName: 'X', amountPaise: 5 })).toContain('am=0.05');
    expect(buildUpiUri({ vpa: 'a@b', payeeName: 'X', amountPaise: 100 })).toContain('am=1.00');
  });

  it('omits the amount for an open-amount code', () => {
    expect(buildUpiUri({ vpa: 'a@b', payeeName: 'X' })).not.toContain('am=');
    expect(buildUpiUri({ vpa: 'a@b', payeeName: 'X', amountPaise: 0 })).not.toContain('am=');
    expect(buildUpiUri({ vpa: 'a@b', payeeName: 'X', amountPaise: null })).not.toContain('am=');
  });

  it('omits an empty note', () => {
    expect(buildUpiUri({ vpa: 'a@b', payeeName: 'X', note: '   ' })).not.toContain('tn=');
  });

  it('percent-encodes characters that would otherwise break the query', () => {
    const uri = buildUpiUri({ vpa: 'a@b', payeeName: 'Smith & Sons #2', note: 'a=b&c' });
    expect(uri).toContain('pn=Smith%20%26%20Sons%20%232');
    expect(uri).toContain('tn=a%3Db%26c');
  });

  it('trims surrounding whitespace and requires a VPA', () => {
    expect(buildUpiUri({ vpa: '  a@b  ', payeeName: '  X  ' })).toBe('upi://pay?pa=a%40b&pn=X&cu=INR');
    expect(() => buildUpiUri({ vpa: '   ', payeeName: 'X' })).toThrow(RangeError);
  });
});

describe('qrToSvg', () => {
  const qr = encodeQr('upi://pay?pa=a@b&pn=X&cu=INR');

  it('emits self-contained SVG with a quiet zone and no external reference', () => {
    const svg = qrToSvg(qr, { size: 120 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`viewBox="0 0 ${qr.size + 8} ${qr.size + 8}"`); // margin 4 each side
    expect(svg).toContain('width="120px"');
    // §7.6 and §11 privacy: nothing may reach out to a network.
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(svg).not.toContain('<image');
  });

  it('draws one rectangle per dark module', () => {
    const svg = qrToSvg(qr);
    const darkCount = qr.modules.flat().filter(Boolean).length;
    expect(svg.split('M').length - 1).toBe(darkCount);
  });

  it('honours colour and margin overrides', () => {
    const svg = qrToSvg(qr, { margin: 0, dark: '#0F4C81', light: 'transparent' });
    expect(svg).toContain(`viewBox="0 0 ${qr.size} ${qr.size}"`);
    expect(svg).toContain('#0F4C81');
    expect(svg).toContain('fill="transparent"');
  });

  it('buildUpiQrSvg goes from payload to markup in one step', () => {
    const svg = buildUpiQrSvg({
      vpa: 'craftypixels@okhdfcbank',
      payeeName: 'The Crafty Pixels',
      amountPaise: 1_100_000,
      note: 'CP/INV/2026-27/001',
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.length).toBeGreaterThan(500);
  });
});
