/**
 * Generates the app icons and splash mark.
 *
 * Run with `node scripts/generate-icons.mjs`. Committed so the icons can be regenerated or
 * recoloured without needing a design tool, and so the accent colour lives in exactly one
 * place if the owner changes it.
 *
 * Written against Node's built-in `zlib` rather than an image library, because §3.1 forbids
 * adding dependencies and a PNG is only a deflate stream wrapped in four chunks. Shapes are
 * drawn at 4× and box-downsampled, which is what gives the curves clean edges.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

const NAVY = [0x0f, 0x4c, 0x81];
const WHITE = [0xff, 0xff, 0xff];
const SUPERSAMPLE = 4;

/** A simple RGBA canvas. */
function createCanvas(size) {
  return { size, pixels: new Uint8Array(size * size * 4) };
}

function setPixel(canvas, x, y, [r, g, b], alpha = 255) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const offset = (y * canvas.size + x) * 4;
  // Source-over composite, so overlapping shapes blend rather than punch holes.
  const src = alpha / 255;
  const dstAlpha = canvas.pixels[offset + 3] / 255;
  const outAlpha = src + dstAlpha * (1 - src);
  if (outAlpha === 0) return;
  for (let channel = 0; channel < 3; channel += 1) {
    const dst = canvas.pixels[offset + channel];
    const value = ([r, g, b][channel] * src + dst * dstAlpha * (1 - src)) / outAlpha;
    canvas.pixels[offset + channel] = Math.round(value);
  }
  canvas.pixels[offset + 3] = Math.round(outAlpha * 255);
}

function fillRect(canvas, x0, y0, width, height, colour) {
  for (let y = Math.round(y0); y < Math.round(y0 + height); y += 1) {
    for (let x = Math.round(x0); x < Math.round(x0 + width); x += 1) {
      setPixel(canvas, x, y, colour);
    }
  }
}

function fillRoundRect(canvas, x0, y0, width, height, radius, colour) {
  const right = x0 + width;
  const bottom = y0 + height;
  for (let y = Math.round(y0); y < Math.round(bottom); y += 1) {
    for (let x = Math.round(x0); x < Math.round(right); x += 1) {
      // Distance to the nearest corner centre decides whether the pixel is inside.
      const cx = Math.min(Math.max(x, x0 + radius), right - radius);
      const cy = Math.min(Math.max(y, y0 + radius), bottom - radius);
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) setPixel(canvas, x, y, colour);
    }
  }
}

/** Box-downsample by `factor`, which is where the anti-aliasing comes from. */
function downsample(canvas, factor) {
  const size = canvas.size / factor;
  const out = createCanvas(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const offset = ((y * factor + sy) * canvas.size + (x * factor + sx)) * 4;
          const alpha = canvas.pixels[offset + 3] / 255;
          r += canvas.pixels[offset] * alpha;
          g += canvas.pixels[offset + 1] * alpha;
          b += canvas.pixels[offset + 2] * alpha;
          a += alpha;
        }
      }
      const samples = factor * factor;
      const outOffset = (y * size + x) * 4;
      if (a > 0) {
        out.pixels[outOffset] = Math.round(r / a);
        out.pixels[outOffset + 1] = Math.round(g / a);
        out.pixels[outOffset + 2] = Math.round(b / a);
      }
      out.pixels[outOffset + 3] = Math.round((a / samples) * 255);
    }
  }
  return out;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(canvas) {
  const { size, pixels } = canvas;
  // Each scanline is prefixed with its filter byte; filter 0 means "none".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The mark: a document sheet with an accent bar and three text lines.
 *
 * `inset` is the fraction of the canvas the mark occupies. Android's adaptive icons mask the
 * outer ~27%, so the foreground layer uses a smaller mark to stay inside the safe zone.
 */
function drawMark(canvas, { background, inset }) {
  const size = canvas.size;
  if (background) fillRect(canvas, 0, 0, size, size, background);

  const sheetWidth = size * inset * 0.74;
  const sheetHeight = size * inset;
  const x = (size - sheetWidth) / 2;
  const y = (size - sheetHeight) / 2;
  const radius = sheetWidth * 0.08;

  fillRoundRect(canvas, x, y, sheetWidth, sheetHeight, radius, WHITE);

  // Accent bar across the top of the sheet, echoing the Classic template.
  const barInset = sheetWidth * 0.12;
  fillRoundRect(
    canvas,
    x + barInset,
    y + sheetHeight * 0.14,
    sheetWidth - barInset * 2,
    sheetHeight * 0.075,
    sheetHeight * 0.02,
    NAVY,
  );

  // Three lines of "text", the last one short, like a total.
  const lineHeight = sheetHeight * 0.045;
  const lineGap = sheetHeight * 0.105;
  const widths = [1, 0.82, 0.45];
  widths.forEach((factor, index) => {
    fillRoundRect(
      canvas,
      x + barInset,
      y + sheetHeight * 0.35 + index * lineGap,
      (sheetWidth - barInset * 2) * factor,
      lineHeight,
      lineHeight / 2,
      NAVY,
    );
  });

  // A heavier bar for the grand total.
  fillRoundRect(
    canvas,
    x + barInset,
    y + sheetHeight * 0.73,
    (sheetWidth - barInset * 2) * 0.62,
    sheetHeight * 0.085,
    sheetHeight * 0.02,
    NAVY,
  );
}

function render(outputName, size, options) {
  const canvas = createCanvas(size * SUPERSAMPLE);
  drawMark(canvas, {
    ...options,
    inset: options.inset,
  });
  const final = downsample(canvas, SUPERSAMPLE);
  mkdirSync(ASSETS, { recursive: true });
  writeFileSync(join(ASSETS, outputName), encodePng(final));
  console.log(`${outputName}  ${size}×${size}`);
}

// Launcher icon: full navy tile.
render('icon.png', 1024, { background: NAVY, inset: 0.62 });
// Adaptive foreground: transparent, mark kept well inside the mask's safe zone.
render('adaptive-icon.png', 1024, { background: null, inset: 0.44 });
// Splash mark: transparent; the background colour comes from app.json.
render('splash.png', 512, { background: null, inset: 0.7 });

console.log('Icons written to assets/.');
