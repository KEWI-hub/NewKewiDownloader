// Renders the Prism mark into PNG toolbar/store icons (no dependencies).
// Same geometry as src/shared/icons.ts → prismMark(). Run: node scripts/gen-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'static', 'icons');

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function inTri(px, py, [a, b, c]) {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const P = [px, py];
  const d1 = s(P, a, b), d2 = s(P, b, c), d3 = s(P, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
function inRoundRect(px, py, x, y, w, h, r) {
  const cx = Math.max(x + r, Math.min(px, x + w - r));
  const cy = Math.max(y + r, Math.min(py, y + h - r));
  return Math.hypot(px - cx, py - cy) <= r;
}

const TRI = [[11.6, 3.2], [19.4, 18.6], [3.8, 18.6]];
const RAYS = [
  [[15.2, 10.9], [22.6, 7.6], '#ff6b8b'],
  [[15.6, 11.9], [22.9, 11.0], '#ffc65c'],
  [[16.0, 12.9], [22.9, 14.5], '#4fe0a3'],
  [[16.4, 13.9], [22.5, 17.9], '#5fa8ff'],
];
const G0 = hex('#bff3ff'), G1 = hex('#9fb4ff'), G2 = hex('#c39bff');
const grad = (x, y) => {
  const t = Math.max(0, Math.min(1, ((x - 5) + (y - 4)) / 29));
  return t < 0.55 ? lerp(G0, G1, t / 0.55) : lerp(G1, G2, (t - 0.55) / 0.45);
};

/** Color (premultiplied RGBA) of one sample in 24-unit icon space. */
function sample(u, v) {
  let acc = [0, 0, 0, 0];
  const over = (rgb, a) => {
    acc = [rgb[0] * a + acc[0] * (1 - a), rgb[1] * a + acc[1] * (1 - a), rgb[2] * a + acc[2] * (1 - a), a + acc[3] * (1 - a)];
  };
  // Tile
  if (inRoundRect(u, v, 0, 0, 24, 24, 5.4)) {
    over(lerp(hex('#232838'), hex('#0d0f17'), v / 24), 1);
    if (!inRoundRect(u, v, 0.45, 0.45, 23.1, 23.1, 5.0)) over([1, 1, 1], 0.10);
  }
  // Mark in 24-space scaled into the tile
  const s = 0.80, o = (24 - 24 * s) / 2;
  const x = (u - o) / s, y = (v - o) / s;
  if (distSeg(x, y, 1.2, 13.6, 7.6, 12.1) <= 0.85) over([1, 1, 1], 0.95);
  for (const [a, b, c] of RAYS) if (distSeg(x, y, a[0], a[1], b[0], b[1]) <= 0.8) over(hex(c), 1);
  if (inTri(x, y, TRI)) over(grad(x, y), 0.30);
  const edge = Math.min(distSeg(x, y, ...TRI[0], ...TRI[1]), distSeg(x, y, ...TRI[1], ...TRI[2]), distSeg(x, y, ...TRI[2], ...TRI[0]));
  if (edge <= 0.9) over(grad(x, y), 1);
  if (distSeg(x, y, 11.6, 6.4, 9.0, 11.6) <= 0.5) over([1, 1, 1], 0.55);
  return acc;
}

function render(size) {
  const ss = 6;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample(((i + (sx + 0.5) / ss) / size) * 24, ((j + (sy + 0.5) / ss) / size) * 24);
          r += c[0]; g += c[1]; b += c[2]; a += c[3];
        }
      }
      const n = ss * ss;
      a /= n;
      const k = (j * size + i) * 4;
      px[k] = a ? Math.round((r / n / a) * 255) : 0;
      px[k + 1] = a ? Math.round((g / n / a) * 255) : 0;
      px[k + 2] = a ? Math.round((b / n / a) * 255) : 0;
      px[k + 3] = Math.round(a * 255);
    }
  }
  return png(size, size, px);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(outDir, `icon-${size}.png`), render(size));
  console.log(`icon-${size}.png`);
}
