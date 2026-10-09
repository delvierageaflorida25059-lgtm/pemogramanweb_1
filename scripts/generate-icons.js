/**
 * Generator ikon PWA.
 *
 * Menghasilkan ikon PNG 192 dan 512 dari SVG tanpa dependency.
 * Dipakai sekali saat menyiapkan proyek:
 *   node scripts/generate-icons.js
 *
 * Ikon digambar sebagai piring dan garpu sederhana agar tetap terbaca
 * pada ukuran kecil (192px ke bawah).
 */

const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('node:module').createRequire ? require('node:module') : {};
const zlib = require('node:zlib');

// Tanpa dependency gambar, PNG ditulis manual.
// Fungsi ini membuat PNG truecolor+alpha dari matriks RGBA.

const ASSETS_DIR = path.resolve(__dirname, '../frontend/assets');

/** @param {number} size */
function buildPng(size) {
  const width = size;
  const height = size;
  const bytesPerPixel = 4;
  const raw = Buffer.alloc((width * bytesPerPixel + 1) * height);

  // Warna dasar: oranye hangat sesuai tema aplikasi
  const bg = [180, 83, 9, 255];
  const plate = [255, 255, 255, 255];
  const accent = [253, 230, 138, 255];

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * bytesPerPixel + 1);
    raw[rowStart] = 0; // filter type: none

    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * bytesPerPixel;
      const color = pixelColor(x, y, width, height, bg, plate, accent);

      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3];
    }
  }

  return encodePng(raw, width, height);
}

/**
 * Tentukan warna satu piksel.
 * Menggambar: latar, piring (lingkaran), makanan di tengah, garpu.
 */
function pixelColor(x, y, width, height, bg, plate, accent) {
  const cx = width / 2;
  const cy = height / 2;
  const scale = width / 512;

  const dx = x - cx;
  const dy = y - cy;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Piring: lingkaran luar
  const plateRadius = width * 0.34;
  if (distance > plateRadius) {
    // Garpu di sisi kanan
    if (isFork(x, y, width, height, scale)) return plate;
    return bg;
  }

  // Cincin luar piring
  if (distance > plateRadius * 0.82) return plate;

  // Isi piring
  const foodRadius = plateRadius * 0.55;
  if (distance < foodRadius) {
      // Titik terang di tengah piring
    if (distance < foodRadius * 0.45) return accent;
    return plate;
  }

  return plate;
}

/** Garpu sederhana: batang vertikal + tiga duri. */
function isFork(x, y, width, height, scale) {
  const forkX = width * 0.79;
  const headWidth = width * 0.09;
  const tineWidth = width * 0.018;

  // Tangkai
  if (Math.abs(x - forkX) < width * 0.02) {
    if (y > height * 0.3 && y < height * 0.72) return true;
  }

  // Kepala garpu
  if (y >= height * 0.3 && y <= height * 0.4) {
    if (Math.abs(x - forkX) < headWidth) return true;
  }

  // Tiga duri
  if (y >= height * 0.24 && y <= height * 0.32) {
    const positions = [-0.06, 0, 0.06].map((offset) => forkX + offset * width);
    for (const position of positions) {
      if (Math.abs(x - position) < tineWidth) return true;
    }
  }

  return false;
}

/**
 * Encode buffer mentah (dengan filter byte per baris) menjadi PNG.
 * @param {Buffer} raw
 */
function encodePng(raw, width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bentuk satu chunk PNG. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/** Tabel CRC32 untuk PNG. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

// ---------------------------------------------------------------------------

function main() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  for (const size of [192, 512]) {
    const file = path.join(ASSETS_DIR, `icon-${size}.png`);
    fs.writeFileSync(file, buildPng(size));
    console.log(`Dibuat: ${path.relative(process.cwd(), file)} (${size}x${size})`);
  }

  // Favicon sederhana 32x32
  const favicon = path.join(ASSETS_DIR, 'favicon.png');
  fs.writeFileSync(favicon, buildPng(32));
  console.log(`Dibuat: ${path.relative(process.cwd(), favicon)} (32x32)`);
}

if (require.main === module) main();

module.exports = { buildPng };
