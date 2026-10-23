// Generates the PWA icons (a white water drop on the brand blue) as PNGs with no
// dependencies: rasterise with 4x4 supersampling, then encode a minimal PNG.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../docs/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const BG = [0x1d, 0x5b, 0x86];
const FG = [0xff, 0xff, 0xff];

// Drop: circle (cx, cy, r) plus a tip at (cx, tipY) joined by tangent lines. Units 0..1.
function inDrop(x, y, s) {
  const cx = 0.5, cy = 0.5 + 0.1 * s, r = 0.22 * s, tipY = cy - 0.42 * s;
  if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return true;
  if (y < tipY || y > cy) return false;
  const d = cy - tipY;
  const ty = cy - (r * r) / d; // y of the tangent points
  const tx = r * Math.sqrt(1 - (r / d) ** 2);
  if (y > ty) return false;
  return Math.abs(x - cx) <= (tx * (y - tipY)) / (ty - tipY);
}

function render(size, { scale = 1, rounded = true } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const rad = rounded ? 0.22 : 0;
  const SS = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let fg = 0, bg = 0;
      for (let a = 0; a < SS; a++) {
        for (let b = 0; b < SS; b++) {
          const x = (i + (a + 0.5) / SS) / size, y = (j + (b + 0.5) / SS) / size;
          // Rounded-square background.
          const qx = Math.max(Math.abs(x - 0.5) - (0.5 - rad), 0), qy = Math.max(Math.abs(y - 0.5) - (0.5 - rad), 0);
          if (Math.hypot(qx, qy) > rad) continue;
          if (inDrop(x, y, scale)) fg++;
          else bg++;
        }
      }
      const n = SS * SS, o = (j * size + i) * 4, cov = fg + bg;
      for (let c = 0; c < 3; c++) px[o + c] = cov ? Math.round((FG[c] * fg + BG[c] * bg) / cov) : 0;
      px[o + 3] = Math.round((cov / n) * 255);
    }
  }
  return png(size, px);
}

const CRC = new Int32Array(256).map((_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(new URL('icon-192.png', OUT), render(192));
writeFileSync(new URL('icon-512.png', OUT), render(512));
// Maskable: full-bleed square, drop shrunk into the safe zone.
writeFileSync(new URL('icon-maskable-512.png', OUT), render(512, { scale: 0.78, rounded: false }));
// iOS adds its own rounding.
writeFileSync(new URL('apple-touch-icon.png', OUT), render(180, { rounded: false }));

writeFileSync(
  new URL('icon.svg', OUT),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#1d5b86"/><path d="M50 18 C50 18 72 46 72 60 A22 22 0 0 1 28 60 C28 46 50 18 50 18Z" fill="#fff"/></svg>\n`,
);
console.log('Icons written to docs/icons/');
