/**
 * Identifier generation.
 *
 * Pure and dependency-free. `Math.random` is the entropy source, which would be
 * unacceptable for anything security-bearing but is the right call here: these ids are
 * row keys in a single-user database that never leaves the device and never faces an
 * adversary. Adding a native crypto dependency (§3.1) to key local rows would buy
 * nothing.
 *
 * The collision arithmetic supports that: at 122 bits of randomness, a business
 * generating a thousand documents a year for a century stays around one in 10^28.
 */

const HEX = '0123456789abcdef';

/** A random UUID v4 string, as §5.2 specifies for primary keys. */
export function uuid(): string {
  let out = '';
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      out += '-';
    } else if (i === 14) {
      out += '4'; // version
    } else if (i === 19) {
      out += HEX[(Math.floor(Math.random() * 16) & 0x3) | 0x8] ?? '8'; // variant
    } else {
      out += HEX[Math.floor(Math.random() * 16)] ?? '0';
    }
  }
  return out;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * A short, human-quotable id for things the owner might read aloud, such as a backup
 * filename. Avoids the characters that get confused when read from a screen (0/O, 1/I/l).
 */
const UNAMBIGUOUS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function shortId(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += UNAMBIGUOUS[Math.floor(Math.random() * UNAMBIGUOUS.length)] ?? 'A';
  }
  return out;
}
