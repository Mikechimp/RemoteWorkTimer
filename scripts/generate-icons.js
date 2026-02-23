#!/usr/bin/env node
/**
 * generate-icons.js
 *
 * Generates valid PNG icon files for the RemoteWorkTimer PWA using ONLY
 * Node.js built-in modules (zlib, fs, path). No external dependencies.
 *
 * Produces:
 *   public/icon-192.png  (192x192)
 *   public/icon-512.png  (512x512)
 *
 * Design:
 *   - Dark background (#111318)
 *   - Orange (#f97316) rounded rectangle (~70% of canvas)
 *   - White "RW" text centered on the orange rectangle
 */

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// PNG helpers
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Compute CRC-32 used by PNG chunks (ISO 3309 / ITU-T V.42).
 */
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Build a single PNG chunk.
 *   chunk = length (4 bytes) + type (4 bytes) + data + crc (4 bytes)
 *   CRC covers type + data.
 */
function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const dataBytes = data ? Buffer.from(data) : Buffer.alloc(0);

  const length = Buffer.alloc(4);
  length.writeUInt32BE(dataBytes.length, 0);

  const crcInput = Buffer.concat([typeBytes, dataBytes]);
  const crcVal = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([length, typeBytes, dataBytes, crcBuf]);
}

/**
 * Create IHDR chunk data (13 bytes).
 */
function makeIHDR(width, height) {
  const buf = Buffer.alloc(13);
  buf.writeUInt32BE(width, 0);
  buf.writeUInt32BE(height, 4);
  buf[8] = 8;   // bit depth
  buf[9] = 2;   // color type: RGB
  buf[10] = 0;  // compression: deflate
  buf[11] = 0;  // filter: adaptive
  buf[12] = 0;  // interlace: none
  return buf;
}

/**
 * Encode a raw RGB pixel buffer into a valid PNG file (Buffer).
 */
function encodePNG(pixels, width, height) {
  const rowLen = width * 3;
  const rawBuf = Buffer.alloc(height * (1 + rowLen));

  for (let y = 0; y < height; y++) {
    const offset = y * (1 + rowLen);
    rawBuf[offset] = 0;  // filter byte: None
    pixels.copy(rawBuf, offset + 1, y * rowLen, (y + 1) * rowLen);
  }

  const compressed = zlib.deflateSync(rawBuf, { level: 9 });

  const ihdr = makeChunk('IHDR', makeIHDR(width, height));
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', null);

  return Buffer.concat([PNG_SIGNATURE, ihdr, idat, iend]);
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function setPixel(pixels, width, x, y, r, g, b) {
  if (x < 0 || x >= width || y < 0) return;
  const idx = (y * width + x) * 3;
  if (idx + 2 >= pixels.length) return;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
}

function fillBackground(pixels, width, height, r, g, b) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      setPixel(pixels, width, x, y, r, g, b);
    }
  }
}

/**
 * Draw a filled rounded rectangle.
 */
function fillRoundedRect(pixels, width, x0, y0, w, h, radius, r, g, b) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      let inside = true;

      // Check corners for rounding
      if (dx < radius && dy < radius) {
        const dist = Math.sqrt((radius - dx) ** 2 + (radius - dy) ** 2);
        if (dist > radius) inside = false;
      } else if (dx >= w - radius && dy < radius) {
        const dist = Math.sqrt((dx - (w - radius - 1)) ** 2 + (radius - dy) ** 2);
        if (dist > radius) inside = false;
      } else if (dx < radius && dy >= h - radius) {
        const dist = Math.sqrt((radius - dx) ** 2 + (dy - (h - radius - 1)) ** 2);
        if (dist > radius) inside = false;
      } else if (dx >= w - radius && dy >= h - radius) {
        const dist = Math.sqrt((dx - (w - radius - 1)) ** 2 + (dy - (h - radius - 1)) ** 2);
        if (dist > radius) inside = false;
      }

      if (inside) {
        setPixel(pixels, width, x0 + dx, y0 + dy, r, g, b);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Bitmap font for "R" and "W" (block-style glyphs)
//
// Each glyph is a 7-wide x 9-tall grid.  '#' = filled, '.' = empty
// ---------------------------------------------------------------------------

const GLYPH_R = [
  '#####..',
  '##..##.',
  '##..##.',
  '##..##.',
  '#####..',
  '##.##..',
  '##..##.',
  '##..##.',
  '##...##',
];

const GLYPH_W = [
  '#....#.',
  '#....#.',
  '#....#.',
  '#....#.',
  '#.##.#.',
  '#.##.#.',
  '##..##.',
  '##..##.',
  '#....#.',
];

/**
 * Draw a single glyph scaled up by `scale` pixels per cell.
 */
function drawGlyph(pixels, imgWidth, glyph, startX, startY, scale, r, g, b) {
  for (let row = 0; row < glyph.length; row++) {
    const line = glyph[row];
    for (let col = 0; col < line.length; col++) {
      if (line[col] === '#') {
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            setPixel(
              pixels, imgWidth,
              startX + col * scale + sx,
              startY + row * scale + sy,
              r, g, b
            );
          }
        }
      }
    }
  }
}

/**
 * Draw "RW" text centered on a rectangular region.
 */
function drawRW(pixels, imgWidth, rectX, rectY, rectW, rectH, scale) {
  const glyphCols = 7;
  const glyphRows = 9;
  const gap = Math.round(scale * 1.5);

  const totalTextW = glyphCols * scale * 2 + gap;
  const totalTextH = glyphRows * scale;

  const startX = rectX + Math.round((rectW - totalTextW) / 2);
  const startY = rectY + Math.round((rectH - totalTextH) / 2);

  // White text (255, 255, 255)
  drawGlyph(pixels, imgWidth, GLYPH_R, startX, startY, scale, 255, 255, 255);
  drawGlyph(pixels, imgWidth, GLYPH_W, startX + glyphCols * scale + gap, startY, scale, 255, 255, 255);
}

// ---------------------------------------------------------------------------
// Generate an icon at a given size
// ---------------------------------------------------------------------------

function generateIcon(size) {
  const pixels = Buffer.alloc(size * size * 3);

  // 1. Dark background  #111318  -> (17, 19, 24)
  fillBackground(pixels, size, size, 17, 19, 24);

  // 2. Orange rounded rectangle (~70% of canvas)
  const margin = Math.round(size * 0.15);
  const rectW = size - margin * 2;
  const rectH = size - margin * 2;
  const radius = Math.round(size * 0.08);

  // #f97316 -> (249, 115, 22)
  fillRoundedRect(pixels, size, margin, margin, rectW, rectH, radius, 249, 115, 22);

  // 3. "RW" text
  const scale = Math.max(1, Math.round(size / 50));
  drawRW(pixels, size, margin, margin, rectW, rectH, scale);

  return encodePNG(pixels, size, size);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const publicDir = path.resolve(__dirname, '..', 'public');

  const sizes = [192, 512];

  for (const size of sizes) {
    const pngData = generateIcon(size);
    const outPath = path.join(publicDir, `icon-${size}.png`);
    fs.writeFileSync(outPath, pngData);
    console.log(`Wrote ${outPath} (${pngData.length} bytes, ${size}x${size})`);
  }

  console.log('Done.');
}

main();
