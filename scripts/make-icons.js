// Generates PNG app icons with zero dependencies (pure Node: zlib + manual PNG encoding).
// Usage: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- tiny software rasterizer -------------------------------------------
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function render(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const S = size / 512; // scale from 512 design space
  const bgA = hex('#3b2f8f'), bgB = hex('#0f0c29');
  const blocks = [
    { y: 336, h: 64, c: hex('#54a0ff') },
    { y: 268, h: 64, c: hex('#feca57') },
    { y: 200, h: 64, c: hex('#ff6b6b') },
  ];
  const leafA = hex('#a8ff78'), leafB = hex('#1dd1a1');
  const pad = maskable ? 0.82 : 1; // maskable: shrink art into safe zone

  const put = (x, y, rgb, a = 1) => {
    const i = (y * size + x) * 4;
    const sa = a, da = px[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) px[i + k] = Math.round((rgb[k] * sa + px[i + k] * da * (1 - sa)) / (oa || 1));
    px[i + 3] = Math.round(oa * 255);
  };
  const inRoundRect = (x, y, rx, ry, w, h, r) => {
    if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
    const cx = Math.max(rx + r, Math.min(x, rx + w - r)), cy = Math.max(ry + r, Math.min(y, ry + h - r));
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };

  for (let py = 0; py < size; py++) for (let pxx = 0; pxx < size; pxx++) {
    // design-space coords (with maskable padding)
    const dx = (pxx / S - 256) / pad + 256, dy = (py / S - 256) / pad + 256;
    const t = (pxx + py) / (2 * size);
    const bg = mix(bgA, bgB, t);
    if (maskable) put(pxx, py, bg, 1);
    else if (inRoundRect(pxx / S, py / S, 0, 0, 512, 512, 112)) {
      // anti-alias edge by sampling a slightly smaller radius
      const edge = inRoundRect(pxx / S + .7, py / S + .7, 0, 0, 512, 512, 112) && inRoundRect(pxx / S - .7, py / S - .7, 0, 0, 512, 512, 112);
      put(pxx, py, bg, edge ? 1 : .55);
    } else continue;

    // glow orbs
    const d1 = Math.hypot(dx - 400, dy - 90); if (d1 < 120) put(pxx, py, hex('#6a4cff'), .35 * (1 - d1 / 120));
    const d2 = Math.hypot(dx - 110, dy - 430); if (d2 < 110) put(pxx, py, hex('#ff5fa2'), .25 * (1 - d2 / 110));

    // ground
    if (inRoundRect(dx, dy, 80, 404, 352, 30, 8)) put(pxx, py, dy < 410 ? hex('#63d471') : hex('#4a3226'));

    // blocks with gloss
    for (const b of blocks) {
      if (inRoundRect(dx, dy, 96, b.y, 320, b.h, 16)) {
        put(pxx, py, b.c);
        const g = (dy - b.y) / b.h;
        if (g < .45) put(pxx, py, [255, 255, 255], .45 * (1 - g / .45));
        if (g > .85) put(pxx, py, [0, 0, 0], .18);
      }
    }

    // sprout stem
    if (Math.abs(dx - 256) < 8 && dy > 108 && dy < 200) put(pxx, py, mix(leafA, leafB, (dy - 108) / 92));
    // leaves (ellipses rotated)
    const leaf = (cx, cy, rw, rh, ang) => {
      const c = Math.cos(ang), s = Math.sin(ang), ux = dx - cx, uy = dy - cy;
      const lx = ux * c + uy * s, ly = -ux * s + uy * c;
      return (lx / rw) ** 2 + (ly / rh) ** 2 <= 1;
    };
    if (leaf(220, 122, 44, 22, -0.75)) put(pxx, py, mix(leafA, leafB, .3));
    if (leaf(292, 94, 44, 22, -0.75)) put(pxx, py, mix(leafA, leafB, .6));

    // coin
    const dc = Math.hypot(dx - 376, dy - 122);
    if (dc < 40) put(pxx, py, dc > 34 ? hex('#e0a800') : hex('#ffd166'));
    // ₩ glyph approximated by strokes
    if (dc < 30) {
      const wx = dx - 376, wy = dy - 122;
      const onW = (Math.abs(Math.abs(wx) - 14 + (wy + 16) * 0.35) < 3 && wy > -16 && wy < 14) || (Math.abs(Math.abs(wx) - (wy + 16) * 0.35) < 3 && wy > -16 && wy < 14);
      const bars = (Math.abs(wy + 4) < 2.2 || Math.abs(wy - 4) < 2.2) && Math.abs(wx) < 17;
      if (onW || bars) put(pxx, py, hex('#8a5a00'));
    }
  }
  return px;
}

fs.mkdirSync(OUT, { recursive: true });
const jobs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
];
for (const [name, size, opts] of jobs) {
  fs.writeFileSync(path.join(OUT, name), encodePNG(size, render(size, opts)));
  console.log('wrote', name);
}
