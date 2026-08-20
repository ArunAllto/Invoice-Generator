/**
 * QR code encoder — spec §7.6.
 *
 * Written by hand rather than added as a dependency because §7.6 requires the UPI
 * payment QR to be generated locally with no network call and no third-party QR image
 * API, and §3.1 forbids adding libraries. It implements ISO/IEC 18004 byte mode for
 * versions 1–20 at all four error-correction levels, which covers any UPI URI with room
 * to spare (version 20 at level M holds 666 bytes).
 *
 * Byte mode only. Numeric and alphanumeric modes would produce smaller symbols for
 * digit-only payloads, but a UPI URI is mixed-case with punctuation, so it would fall to
 * byte mode anyway; supporting one mode well beats three half-tested ones.
 *
 * Verified against a reference implementation's output for 24 payload/level
 * combinations, module for module, including the chosen mask pattern — see
 * `__tests__/qr.test.ts` and `__tests__/fixtures/qr-golden.json`.
 */

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrCode {
  /** Modules per side. */
  size: number;
  /** Row-major. `true` is a dark module. */
  modules: boolean[][];
  version: number;
  maskPattern: number;
}

const MAX_VERSION = 20;

/** Total codewords (data + error correction) per version, versions 1–20. */
const TOTAL_CODEWORDS = [
  26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
] as const;

/**
 * Error-correction codewords per block, and block count, per version.
 *
 * Everything else about the block layout is derived: total data codewords is
 * `TOTAL_CODEWORDS − ecPerBlock × blocks`, and the split into short and long blocks
 * follows from the remainder. Two arrays are far easier to keep correct than the
 * five-column table usually printed for this, and the invariant is asserted by a test.
 */
const EC_PER_BLOCK: Readonly<Record<ErrorCorrectionLevel, readonly number[]>> = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28],
};

const BLOCK_COUNT: Readonly<Record<ErrorCorrectionLevel, readonly number[]>> = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25],
};

/** Two-bit EC level indicator used in the format information. */
const EC_LEVEL_BITS: Readonly<Record<ErrorCorrectionLevel, number>> = {
  L: 0b01,
  M: 0b00,
  Q: 0b11,
  H: 0b10,
};

// ---------------------------------------------------------------------------
// GF(256) arithmetic for Reed–Solomon
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField(): void {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    // 0x11D is the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 that QR specifies.
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255] ?? 0;
})();

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[((GF_LOG[a] ?? 0) + (GF_LOG[b] ?? 0)) % 255] ?? 0;
}

/** Generator polynomial for `degree` error-correction codewords. */
function generatorPolynomial(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    // Multiply by (x - α^i).
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] ?? 0) ^ gfMultiply(poly[j] ?? 0, 1);
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMultiply(poly[j] ?? 0, GF_EXP[i] ?? 0);
    }
    poly = next;
  }
  return poly;
}

/** The Reed–Solomon remainder: the error-correction codewords for one block. */
function reedSolomonEncode(data: readonly number[], ecCount: number): number[] {
  const generator = generatorPolynomial(ecCount);
  const remainder = new Array<number>(ecCount).fill(0);

  for (const byte of data) {
    const factor = byte ^ (remainder[0] ?? 0);
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecCount; i += 1) {
      remainder[i] = (remainder[i] ?? 0) ^ gfMultiply(generator[i + 1] ?? 0, factor);
    }
  }
  return remainder;
}

// ---------------------------------------------------------------------------
// Capacity and version selection
// ---------------------------------------------------------------------------

function dataCodewordCount(version: number, ecLevel: ErrorCorrectionLevel): number {
  const index = version - 1;
  const total = TOTAL_CODEWORDS[index];
  const ecPerBlock = EC_PER_BLOCK[ecLevel][index];
  const blocks = BLOCK_COUNT[ecLevel][index];
  if (total === undefined || ecPerBlock === undefined || blocks === undefined) {
    throw new RangeError(`Unsupported QR version ${version}`);
  }
  return total - ecPerBlock * blocks;
}

/** Character-count field width for byte mode: 8 bits to version 9, then 16. */
function characterCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/** Bytes of payload that fit at a given version and level. */
export function byteCapacity(version: number, ecLevel: ErrorCorrectionLevel): number {
  const bits = dataCodewordCount(version, ecLevel) * 8;
  // 4 bits of mode indicator plus the character-count field.
  return Math.max(0, Math.floor((bits - 4 - characterCountBits(version)) / 8));
}

function chooseVersion(
  byteLength: number,
  ecLevel: ErrorCorrectionLevel,
  minVersion: number,
): number {
  for (let version = Math.max(1, minVersion); version <= MAX_VERSION; version += 1) {
    if (byteCapacity(version, ecLevel) >= byteLength) return version;
  }
  throw new RangeError(
    `Payload of ${byteLength} bytes does not fit in a version ${MAX_VERSION} QR code at level ${ecLevel}`,
  );
}

// ---------------------------------------------------------------------------
// Bit buffer
// ---------------------------------------------------------------------------

class BitBuffer {
  private readonly bits: number[] = [];

  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.bits.push((value >>> i) & 1);
    }
  }

  get length(): number {
    return this.bits.length;
  }

  /** Pad to a byte boundary and return the codewords. */
  toBytes(): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) {
        byte = (byte << 1) | (this.bits[i + j] ?? 0);
      }
      bytes.push(byte);
    }
    return bytes;
  }
}

/** UTF-8 encode without depending on TextEncoder, which RN's Hermes lacked historically. */
export function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = ((code - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
        i += 1;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Codeword assembly
// ---------------------------------------------------------------------------

function buildCodewords(
  payload: readonly number[],
  version: number,
  ecLevel: ErrorCorrectionLevel,
): number[] {
  const capacity = dataCodewordCount(version, ecLevel);
  const buffer = new BitBuffer();

  buffer.put(0b0100, 4); // byte mode
  buffer.put(payload.length, characterCountBits(version));
  for (const byte of payload) buffer.put(byte, 8);

  // Terminator: up to four zero bits, but never past capacity.
  const capacityBits = capacity * 8;
  const terminator = Math.min(4, capacityBits - buffer.length);
  if (terminator > 0) buffer.put(0, terminator);

  // Pad to a byte boundary.
  if (buffer.length % 8 !== 0) buffer.put(0, 8 - (buffer.length % 8));

  const data = buffer.toBytes();
  // Then alternate the two specified pad codewords to fill the capacity.
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (data.length < capacity) {
    data.push(PAD[padIndex % 2] ?? 0);
    padIndex += 1;
  }

  return interleave(data, version, ecLevel);
}

/**
 * Split into blocks, compute each block's EC codewords, then interleave.
 *
 * Interleaving is what makes a QR code survive a smudge: consecutive codewords of one
 * block end up spread across the symbol, so localised damage costs each block a little
 * rather than costing one block everything.
 */
function interleave(
  data: readonly number[],
  version: number,
  ecLevel: ErrorCorrectionLevel,
): number[] {
  const index = version - 1;
  const ecPerBlock = EC_PER_BLOCK[ecLevel][index] ?? 0;
  const blocks = BLOCK_COUNT[ecLevel][index] ?? 1;
  const totalData = data.length;

  const longBlocks = totalData % blocks; // blocks holding one extra data codeword
  const shortBlocks = blocks - longBlocks;
  const shortLength = Math.floor(totalData / blocks);

  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < blocks; b += 1) {
    const length = b < shortBlocks ? shortLength : shortLength + 1;
    const block = data.slice(offset, offset + length);
    offset += length;
    dataBlocks.push(block);
    ecBlocks.push(reedSolomonEncode(block, ecPerBlock));
  }

  const result: number[] = [];
  const maxDataLength = shortLength + (longBlocks > 0 ? 1 : 0);
  for (let i = 0; i < maxDataLength; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i] ?? 0);
    }
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) {
      result.push(block[i] ?? 0);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------

type Grid = Array<Array<boolean | null>>;

function symbolSize(version: number): number {
  return version * 4 + 17;
}

/** Alignment-pattern centre coordinates, per the standard's spacing formula. */
export function alignmentCoordinates(version: number): number[] {
  if (version === 1) return [];
  const positionCount = Math.floor(version / 7) + 2;
  const size = symbolSize(version);
  // Version 32 is the one case the formula does not cover.
  const interval = size === 145 ? 26 : Math.ceil((size - 13) / (2 * positionCount - 2)) * 2;

  const positions = [size - 7];
  for (let i = 1; i < positionCount - 1; i += 1) {
    positions.push((positions[i - 1] ?? 0) - interval);
  }
  positions.push(6);
  return positions.reverse();
}

/**
 * Draw a 7×7 finder pattern plus its one-module light separator.
 *
 * The separator is the reason the bounds are −1..7 rather than 0..6, and it must be
 * *light*: a dark separator merges the finder into the data area and no scanner will
 * locate the symbol.
 */
function placeFinderPattern(grid: Grid, row: number, col: number): void {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || y >= grid.length || x < 0 || x >= grid.length) continue;

      const insideFinder = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const onOuterRing = r === 0 || r === 6 || c === 0 || c === 6;
      const inInnerBlock = r >= 2 && r <= 4 && c >= 2 && c <= 4;

      const gridRow = grid[y];
      if (gridRow) gridRow[x] = insideFinder && (onOuterRing || inInnerBlock);
    }
  }
}

function placeFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.length;

  placeFinderPattern(grid, 0, 0);
  placeFinderPattern(grid, 0, size - 7);
  placeFinderPattern(grid, size - 7, 0);

  // Timing patterns: alternating modules along row 6 and column 6.
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    const row6 = grid[6];
    if (row6) row6[i] = dark;
    const rowI = grid[i];
    if (rowI) rowI[6] = dark;
  }

  // Alignment patterns, skipping the three finder corners.
  const coords = alignmentCoordinates(version);
  for (const row of coords) {
    for (const col of coords) {
      const nearFinder =
        (row === 6 && col === 6) ||
        (row === 6 && col === size - 7) ||
        (row === size - 7 && col === 6);
      if (nearFinder) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const gridRow = grid[row + r];
          if (gridRow) {
            gridRow[col + c] = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
          }
        }
      }
    }
  }

  // Reserve the format-information areas so `placeData` skips them; the real bits are
  // written later, once the mask is known. `false` here just means "not a data module".
  const reserve = (row: number, col: number): void => {
    const gridRow = grid[row];
    if (gridRow && gridRow[col] === null) gridRow[col] = false;
  };
  for (let i = 0; i < 9; i += 1) {
    reserve(8, i);
    reserve(i, 8);
  }
  for (let i = 0; i < 8; i += 1) {
    reserve(8, size - 1 - i);
    reserve(size - 1 - i, 8);
  }
  // The module just above the bottom-left format block is always dark.
  const darkRow = grid[size - 8];
  if (darkRow) darkRow[8] = true;

  // Version information blocks for version 7 and above.
  if (version >= 7) {
    const versionBits = versionInformation(version);
    for (let i = 0; i < 18; i += 1) {
      const bit = ((versionBits >> i) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      const rowA = grid[r];
      if (rowA) rowA[c] = bit;
      const rowB = grid[c];
      if (rowB) rowB[r] = bit;
    }
  }
}

/** BCH(18,6) version information, generator 0x1F25. */
function versionInformation(version: number): number {
  let value = version << 12;
  for (let i = 0; i < 6; i += 1) {
    if (value & (1 << (17 - i))) value ^= 0x1f25 << (5 - i);
  }
  return (version << 12) | value;
}

/** BCH(15,5) format information, generator 0x537, masked with 0x5412. */
function formatInformation(ecLevel: ErrorCorrectionLevel, maskPattern: number): number {
  const data = ((EC_LEVEL_BITS[ecLevel] << 3) | maskPattern) & 0x1f;
  let value = data << 10;
  for (let i = 0; i < 5; i += 1) {
    if (value & (1 << (14 - i))) value ^= 0x537 << (4 - i);
  }
  return ((data << 10) | value) ^ 0x5412;
}

function placeFormatInformation(
  grid: boolean[][],
  ecLevel: ErrorCorrectionLevel,
  maskPattern: number,
): void {
  const size = grid.length;
  const bits = formatInformation(ecLevel, maskPattern);

  for (let i = 0; i < 15; i += 1) {
    const bit = ((bits >> i) & 1) === 1;

    // Copy 1: around the top-left finder.
    if (i < 6) {
      const row = grid[i];
      if (row) row[8] = bit;
    } else if (i < 8) {
      const row = grid[i + 1];
      if (row) row[8] = bit;
    } else {
      const row = grid[size - 15 + i];
      if (row) row[8] = bit;
    }

    // Copy 2: split between the top-right and bottom-left finders.
    const row8 = grid[8];
    if (row8) {
      if (i < 8) {
        row8[size - 1 - i] = bit;
      } else if (i < 9) {
        row8[15 - i] = bit;
      } else {
        row8[15 - i - 1] = bit;
      }
    }
  }
}

/** Lay the codewords into the reserved modules, two columns at a time, bottom-up. */
function placeData(grid: Grid, codewords: readonly number[]): void {
  const size = grid.length;
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right > 0; right -= 2) {
    // Column 6 is the vertical timing pattern; the two-wide columns step over it.
    const columnRight = right <= 6 ? right - 1 : right;

    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = columnRight - offset;
        const gridRow = grid[row];
        if (!gridRow || gridRow[col] !== null) continue;

        const byte = codewords[bitIndex >> 3] ?? 0;
        const bit = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
        gridRow[col] = bit;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

const MASK_FUNCTIONS: ReadonlyArray<(row: number, col: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/**
 * Penalty score for a masked symbol, per the four standard rules.
 *
 * Masking exists to break up large blank areas and anything resembling a finder
 * pattern, either of which confuses a scanner. All eight masks are tried and the lowest
 * score wins.
 */
function maskPenalty(grid: readonly boolean[][]): number {
  const size = grid.length;
  let penalty = 0;

  // Rule 1: runs of five or more same-coloured modules in a row or column.
  for (let i = 0; i < size; i += 1) {
    let rowRun = 1;
    let colRun = 1;
    for (let j = 1; j < size; j += 1) {
      if (grid[i]?.[j] === grid[i]?.[j - 1]) {
        rowRun += 1;
      } else {
        if (rowRun >= 5) penalty += 3 + (rowRun - 5);
        rowRun = 1;
      }
      if (grid[j]?.[i] === grid[j - 1]?.[i]) {
        colRun += 1;
      } else {
        if (colRun >= 5) penalty += 3 + (colRun - 5);
        colRun = 1;
      }
    }
    if (rowRun >= 5) penalty += 3 + (rowRun - 5);
    if (colRun >= 5) penalty += 3 + (colRun - 5);
  }

  // Rule 2: every 2×2 block of one colour.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const value = grid[r]?.[c];
      if (
        value === grid[r]?.[c + 1] &&
        value === grid[r + 1]?.[c] &&
        value === grid[r + 1]?.[c + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: the finder-like 1:1:3:1:1 sequence with four light modules on one side —
  // the shape a scanner mistakes for a finder pattern. Implemented as an 11-module
  // sliding window over every row and column, counting each occurrence, so a run with
  // four light modules on *both* sides scores twice (it matches two distinct windows).
  const DARK_LIGHT_RUN = 0b10111010000;
  const LIGHT_DARK_RUN = 0b00001011101;
  for (let i = 0; i < size; i += 1) {
    let rowWindow = 0;
    let colWindow = 0;
    for (let j = 0; j < size; j += 1) {
      rowWindow = ((rowWindow << 1) & 0x7ff) | (grid[i]?.[j] ? 1 : 0);
      colWindow = ((colWindow << 1) & 0x7ff) | (grid[j]?.[i] ? 1 : 0);
      if (j >= 10) {
        if (rowWindow === DARK_LIGHT_RUN || rowWindow === LIGHT_DARK_RUN) penalty += 40;
        if (colWindow === DARK_LIGHT_RUN || colWindow === LIGHT_DARK_RUN) penalty += 40;
      }
    }
  }

  // Rule 4: deviation of the dark-module proportion from 50%, in 5% steps.
  let dark = 0;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (grid[r]?.[c]) dark += 1;
    }
  }
  const percent = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return penalty;
}

export interface EncodeQrOptions {
  ecLevel?: ErrorCorrectionLevel;
  /** Force a minimum version. The encoder still grows if the payload needs more. */
  minVersion?: number;
  /** Force a mask (0–7) instead of choosing by penalty score. For tests. */
  maskPattern?: number;
}

/**
 * Encode text as a QR code.
 *
 * Error-correction level M is the default: it tolerates ~15% damage, which is the right
 * trade for a code printed on an invoice that may be photographed off a screen or
 * scanned from a creased printout.
 */
export function encodeQr(text: string, options: EncodeQrOptions = {}): QrCode {
  const { ecLevel = 'M', minVersion = 1 } = options;
  if (text.length === 0) throw new RangeError('encodeQr requires a non-empty payload');

  const payload = utf8Bytes(text);
  const version = chooseVersion(payload.length, ecLevel, minVersion);
  const size = symbolSize(version);
  const codewords = buildCodewords(payload, version, ecLevel);

  // Build the unmasked grid once; `null` marks a data module still to be filled.
  const template: Grid = Array.from({ length: size }, () =>
    new Array<boolean | null>(size).fill(null),
  );
  placeFunctionPatterns(template, version);
  const reserved: boolean[][] = template.map((row) => row.map((cell) => cell !== null));
  placeData(template, codewords);

  const candidates: Array<{ grid: boolean[][]; mask: number; penalty: number }> = [];
  const masksToTry =
    options.maskPattern === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.maskPattern];

  for (const mask of masksToTry) {
    const maskFn = MASK_FUNCTIONS[mask];
    if (!maskFn) throw new RangeError(`Invalid mask pattern ${mask}`);

    const grid: boolean[][] = template.map((row, r) =>
      row.map((cell, c) => {
        const value = cell ?? false;
        // Function patterns are never masked.
        if (reserved[r]?.[c]) return value;
        return maskFn(r, c) ? !value : value;
      }),
    );
    placeFormatInformation(grid, ecLevel, mask);
    candidates.push({ grid, mask, penalty: maskPenalty(grid) });
  }

  let best = candidates[0];
  if (!best) throw new Error('encodeQr produced no candidate symbol');
  for (const candidate of candidates) {
    if (candidate.penalty < best.penalty) best = candidate;
  }

  return { size, modules: best.grid, version, maskPattern: best.mask };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface QrSvgOptions {
  /** Rendered edge length, in whatever unit the caller supplies via `unit`. */
  size?: number;
  unit?: string;
  /** Quiet-zone width in modules. The standard says 4; scanners need it. */
  margin?: number;
  dark?: string;
  light?: string;
}

/**
 * Render as a single-path SVG.
 *
 * One `<path>` of rectangles rather than a few hundred `<rect>` elements: the same
 * markup is inlined into the export HTML, where a smaller DOM measurably speeds up
 * `expo-print`'s render, and it keeps the PDF's vector content compact.
 */
export function qrToSvg(qr: QrCode, options: QrSvgOptions = {}): string {
  const { size = 120, unit = 'px', margin = 4, dark = '#000000', light = '#FFFFFF' } = options;
  const total = qr.size + margin * 2;

  let path = '';
  for (let r = 0; r < qr.size; r += 1) {
    for (let c = 0; c < qr.size; c += 1) {
      if (qr.modules[r]?.[c]) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}${unit}" height="${size}${unit}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/>` +
    `</svg>`
  );
}

/** The module rows as strings of '1' and '0'. Handy for tests and debugging. */
export function qrToRowStrings(qr: QrCode): string[] {
  return qr.modules.map((row) => row.map((cell) => (cell ? '1' : '0')).join(''));
}

// ---------------------------------------------------------------------------
// UPI payload
// ---------------------------------------------------------------------------

export interface UpiPayload {
  /** Virtual payment address, e.g. `craftypixels@okhdfcbank`. */
  vpa: string;
  /** Payee name as it should appear in the payer's app. */
  payeeName: string;
  /** Amount in integer paise. Omit for an open-amount code. */
  amountPaise?: number | null;
  /** Transaction note — the document number, in practice. */
  note?: string | null;
  currency?: string;
}

/**
 * Build the `upi://pay` URI of §7.6.
 *
 * Values are percent-encoded because a payee name with a space or an ampersand would
 * otherwise truncate the query and produce a QR that pays the wrong-looking payee. The
 * amount is rendered with exactly two decimals, which is what UPI apps expect.
 */
export function buildUpiUri(payload: UpiPayload): string {
  const { vpa, payeeName, amountPaise, note, currency = 'INR' } = payload;
  const trimmedVpa = vpa.trim();
  if (trimmedVpa.length === 0) throw new RangeError('buildUpiUri requires a VPA');

  const params: string[] = [
    `pa=${encodeURIComponent(trimmedVpa)}`,
    `pn=${encodeURIComponent(payeeName.trim())}`,
  ];
  if (amountPaise != null && amountPaise > 0) {
    const rupees = Math.floor(amountPaise / 100);
    const paise = String(amountPaise % 100).padStart(2, '0');
    params.push(`am=${rupees}.${paise}`);
  }
  params.push(`cu=${encodeURIComponent(currency)}`);
  if (note && note.trim().length > 0) params.push(`tn=${encodeURIComponent(note.trim())}`);

  return `upi://pay?${params.join('&')}`;
}

/** Convenience: a UPI payment QR, ready to inline. */
export function buildUpiQrSvg(payload: UpiPayload, svgOptions: QrSvgOptions = {}): string {
  return qrToSvg(encodeQr(buildUpiUri(payload), { ecLevel: 'M' }), svgOptions);
}
