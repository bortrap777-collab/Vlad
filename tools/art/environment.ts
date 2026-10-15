/**
 * Environment art: sky, parallax city layers, courtyard backdrop, props and the apartment interior.
 * All coordinates are in logical pixels (480×270 viewport).
 */
import { PixelCanvas, rampAt, hash, mix, bayer, darken, type RGB } from './raster';
import { P, type Ramp } from './palette';

export const VIEW_W = 480;
export const VIEW_H = 270;
export const GROUND_Y = 238; // feet line
export const HORIZON_Y = 200;

// ---------------------------------------------------------------- sky
export function drawSky(): PixelCanvas {
  const c = new PixelCanvas(VIEW_W, VIEW_H);
  const ramp = P.skyDusk;
  for (let y = 0; y < VIEW_H; y++)
    for (let x = 0; x < VIEW_W; x++) {
      const t = Math.pow(y / 215, 1.5) + (x / VIEW_W) * 0.12;
      c.set(x, y, rampAt(ramp, t, x, y));
    }
  // stars
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(hash(i, 1, 77) * VIEW_W), y = Math.floor(hash(i, 2, 77) * 110);
    const b = hash(i, 3, 77);
    c.set(x, y, mix(c.get(x, y), P.white, b > 0.8 ? 0.85 : 0.4));
    if (b > 0.95) {
      c.set(x + 1, y, mix(c.get(x + 1, y), P.white, 0.3));
      c.set(x, y + 1, mix(c.get(x, y + 1), P.white, 0.3));
    }
  }
  // moon
  c.ellipse(88, 42, 9, 9, (x, y, nx, ny) => (nx > 0.45 && ny < 0.6 ? null : rampAt([0xb8c0d8, 0xd8deec, 0xf2f4fa], 0.6 - nx * 0.3 + ny * 0.1, x, y)));
  c.ellipse(88, 42, 13, 13, (x, y) => mix(c.get(x, y), 0x8a96c0, 0.12));
  // thin clouds
  for (let i = 0; i < 5; i++) {
    const cx = hash(i, 9, 3) * VIEW_W, cy = 60 + hash(i, 8, 3) * 70;
    c.ellipse(cx, cy, 50 + hash(i, 7) * 40, 3 + hash(i, 6) * 3, (x, y) => (bayer(x, y) > 0.45 ? mix(c.get(x, y), 0x7a7fa6, 0.35) : null));
  }
  return c;
}

// ---------------------------------------------------------------- buildings
interface BuildingOpts {
  floors: number;
  cols: number;
  winW: number;
  winH: number;
  gapX: number;
  floorH: number;
  ramp: Ramp;
  lit: number; // chance a window is lit
  seed: number;
  balconies?: boolean;
  detail: 0 | 1 | 2;
  brick?: boolean;
  entrances?: number[];
}

export function drawBuilding(c: PixelCanvas, x0: number, baseY: number, o: BuildingOpts): { w: number; h: number } {
  const w = o.cols * (o.winW + o.gapX) + o.gapX + 6;
  const h = o.floors * o.floorH + 8;
  const top = baseY - h;
  // facade
  c.rect(x0, top, w, h, (x, y) => {
    let v = 0.42 + ((x - x0) / w) * 0.18 - ((y - top) / h) * 0.12;
    if (o.brick && o.detail > 0) {
      const row = Math.floor((y - top) / 3);
      const off = row % 2 ? 3 : 0;
      if ((y - top) % 3 === 0 || (x - x0 + off) % 6 === 0) v -= 0.12;
      v += (hash(Math.floor((x - x0 + off) / 6), row, o.seed) - 0.5) * 0.12;
    } else if (o.detail > 0) {
      // panel seams
      if ((x - x0) % ((o.winW + o.gapX) * 2) === 0 || (y - top) % o.floorH === 0) v -= 0.1;
      v += (hash(x, y, o.seed) - 0.5) * 0.05;
    }
    return rampAt(o.ramp, v, x, y);
  });
  // left shadow edge, roof parapet with snow
  c.rect(x0, top, 2, h, o.ramp[0]);
  c.rect(x0 - 1, top - 2, w + 2, 3, o.ramp[1]);
  c.rect(x0 - 1, top - 4, w + 2, 2, (x, y) => rampAt(P.snow, 0.72 + (hash(x, y, 2) - 0.5) * 0.2, x, y));
  for (let x = x0; x < x0 + w; x++) if (hash(x, 5, o.seed) > 0.7) c.set(x, top - 1, P.snow[4]);
  // windows
  for (let f = 0; f < o.floors; f++)
    for (let col = 0; col < o.cols; col++) {
      const wx = x0 + 4 + o.gapX + col * (o.winW + o.gapX);
      const wy = top + 6 + f * o.floorH;
      if (o.entrances?.includes(col) && f === o.floors - 1) continue;
      const lit = hash(col, f, o.seed) < o.lit;
      const warm = hash(col, f, o.seed + 1) > 0.25;
      const winRamp = lit ? (warm ? P.windowWarm : [0x6a8aa8, 0x8aa8c8, 0xa8c4e0, 0xcfe2f2, 0xeaf4ff]) : P.windowCold;
      c.rect(wx, wy, o.winW, o.winH, (x, y) => {
        const v = lit ? 0.55 + ((y - wy) / o.winH) * 0.35 - Math.abs(x - wx - o.winW / 2) / o.winW * 0.3 : 0.3 + ((x - wx) / o.winW) * 0.3 + ((y - wy) / o.winH) * 0.2;
        return rampAt(winRamp, v, x, y);
      });
      if (o.detail > 0) {
        // frame cross
        const frame = darken(o.ramp[1], 0.3);
        c.vline(wx + Math.floor(o.winW / 2), wy, wy + o.winH - 1, frame);
        if (o.winH > 5) c.hline(wx, wx + o.winW - 1, wy + Math.floor(o.winH / 3), frame);
        // sill with snow
        c.hline(wx - 1, wx + o.winW, wy + o.winH, P.snow[4]);
        if (o.detail > 1) c.hline(wx - 1, wx + o.winW, wy - 1, o.ramp[0]);
        // curtains in lit windows
        if (lit && o.detail > 1) {
          const cur = hash(col, f, o.seed + 2) > 0.5 ? 0xb85a3a : 0x8a6a3a;
          c.rect(wx, wy, 2, o.winH, mix(cur, winRamp[3], 0.35));
          c.rect(wx + o.winW - 2, wy, 2, o.winH, mix(cur, winRamp[3], 0.35));
          if (hash(col, f, o.seed + 3) > 0.6) c.rect(wx + 3, wy + o.winH - 3, 2, 3, darken(winRamp[2], 0.6)); // plant
        }
      }
      // balconies
      if (o.balconies && f < o.floors - 1 && f > 0 && col % 2 === 1) {
        const by = wy + o.winH + 1;
        c.rect(wx - 2, by - 3, o.winW + 4, 4, (x, y) => rampAt(o.ramp, 0.3 + (x % 2 ? 0 : 0.08), x, y));
        c.hline(wx - 2, wx + o.winW + 1, by - 4, P.snow[4]);
      }
    }
  // entrances
  for (const col of o.entrances ?? []) {
    const ex = x0 + 4 + o.gapX + col * (o.winW + o.gapX);
    const ew = o.winW + 2, eh = Math.min(o.floorH - 2, 16);
    c.rect(ex - 1, baseY - eh, ew, eh, (x, y) => rampAt(P.wood, 0.3 + ((x - ex) / ew) * 0.3 + (hash(x, y) - 0.5) * 0.1, x, y));
    c.rect(ex - 3, baseY - eh - 3, ew + 4, 2, o.ramp[0]);
    c.hline(ex - 3, ex + ew, baseY - eh - 4, P.snow[4]);
    c.set(ex + ew / 2, baseY - eh - 5, P.windowWarm[4]);
  }
  return { w, h };
}

/** Bare winter tree with snow-laden branches. */
export function drawTree(c: PixelCanvas, x: number, baseY: number, height: number, ramp: Ramp, seed: number, snowy = true, thick = 3) {
  const rec = (x0: number, y0: number, ang: number, len: number, w: number, depth: number) => {
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    if (w >= 1.5) c.stroke(x0, y0, x1, y1, w / 2, (px, py) => rampAt(ramp, 0.3 + (px > (x0 + x1) / 2 ? 0.3 : 0) + (hash(px, py, seed) - 0.5) * 0.15, px, py));
    else c.line(x0, y0, x1, y1, ramp[1]);
    if (snowy && depth < 4 && Math.abs(Math.cos(ang)) > 0.3) {
      // snow resting on top of the branch
      const n = Math.round(len);
      for (let i = 1; i < n; i++) if (hash(i, depth, seed) > 0.35) c.set(x0 + Math.cos(ang) * i, y0 + Math.sin(ang) * i - Math.max(1, w / 2) - 0.5, rampAt(P.snow, 0.82, x0 + i, y0));
    }
    if (depth <= 0 || len < 3) return;
    const n = depth > 3 ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const da = (hash(k, depth, seed + Math.round(x0)) - 0.5) * 1.3 + (k - (n - 1) / 2) * 0.55;
      rec(x1, y1, ang + da, len * (0.62 + hash(k, depth + 7, seed) * 0.18), Math.max(1, w * 0.62), depth - 1);
    }
  };
  rec(x, baseY, -Math.PI / 2 + (hash(seed, 0) - 0.5) * 0.12, height * 0.36, thick, 6);
  // snow at the root
  c.ellipse(x, baseY, thick + 4, 2, (px, py, nx) => rampAt(P.snow, 0.75 + nx * 0.1, px, py));
}

// ---------------------------------------------------------------- far & mid layers
export function drawFarCity(): PixelCanvas {
  const W = 960;
  const c = new PixelCanvas(W, VIEW_H);
  // factory chimneys with smoke
  for (const [cx, hgt] of [[150, 120], [176, 100], [690, 130]] as const) {
    c.rect(cx - 3, 205 - hgt, 6, hgt, (x, y) => rampAt(P.panel, 0.18 + ((x - cx + 3) / 6) * 0.15 + (((y >> 3) % 2) ? 0.06 : 0), x, y));
    c.rect(cx - 3, 205 - hgt + 6, 6, 3, (x) => (x % 2 ? 0xa83c3c : 0xd8d8e0));
    c.set(cx, 205 - hgt - 1, 0xff4a3a);
    for (let i = 0; i < 9; i++) c.ellipse(cx + 6 + i * 7, 205 - hgt - 6 - i * 3, 5 + i * 1.3, 3 + i * 0.6, (x, y) => (bayer(x, y) < 0.55 - i * 0.04 ? mix(0x5e6688, 0x8a90ae, 0.4) : null));
  }
  // TV tower
  c.line(820, 205, 828, 60, P.panel[1]);
  c.line(836, 205, 828, 60, P.panel[1]);
  for (let y = 70; y < 205; y += 9) c.line(828 - (y - 60) * 0.06, y, 828 + (y - 60) * 0.06, y + 6, P.panel[1]);
  c.set(828, 58, 0xff4a3a);
  let x = -10;
  let seed = 1;
  while (x < W) {
    const floors = 9 + Math.floor(hash(seed, 1, 5) * 4);
    const cols = 6 + Math.floor(hash(seed, 2, 5) * 6);
    const base = 206 - Math.floor(hash(seed, 3, 5) * 6);
    const { w } = drawBuilding(c, x, base, { floors, cols, winW: 2, winH: 2, gapX: 2, floorH: 5, ramp: P.panel.map((v) => darken(v, 0.38)), lit: 0.18, seed, detail: 0 });
    x += w + 4 + Math.floor(hash(seed, 4, 5) * 26);
    seed++;
  }
  // haze over the base
  for (let y = 170; y < VIEW_H; y++) for (let xx = 0; xx < W; xx++) if (c.alphaAt(xx, y)) c.set(xx, y, mix(c.get(xx, y), 0x56658e, Math.min(0.5, (y - 170) / 70)));
  // tree line
  for (let i = 0; i < 40; i++) drawTree(c, i * 25 + hash(i, 0, 9) * 15, 210, 26 + hash(i, 1, 9) * 18, P.bark.map((v) => mix(v, 0x3a4670, 0.5)), i + 300, false, 2);
  c.rect(0, 206, W, 64, (xx, y) => rampAt(P.snow, 0.32 + (y - 206) * 0.01, xx, y));
  return c;
}

export function drawMidCity(): PixelCanvas {
  const W = 1360;
  const c = new PixelCanvas(W, VIEW_H);
  let x = 0;
  let seed = 50;
  while (x < W) {
    const floors = 5 + Math.floor(hash(seed, 1, 6) * 5);
    const cols = 8 + Math.floor(hash(seed, 2, 6) * 6);
    const brick = hash(seed, 3, 6) > 0.6;
    const { w } = drawBuilding(c, x, 208, { floors, cols, winW: 4, winH: 5, gapX: 4, floorH: 10, ramp: (brick ? P.brick : P.panel).map((v) => darken(v, 0.2)), lit: 0.32, seed, detail: 1, balconies: !brick, brick });
    x += w + 30 + Math.floor(hash(seed, 4, 6) * 60);
    seed++;
  }
  for (let i = 0; i < 22; i++) drawTree(c, 30 + i * 62 + hash(i, 0, 3) * 30, 212, 50 + hash(i, 1, 3) * 30, P.bark.map((v) => mix(v, 0x2c3658, 0.35)), i + 500, true, 3);
  c.rect(0, 210, W, 60, (xx, y) => rampAt(P.snow, 0.4 + (y - 210) * 0.008 + (hash(xx, y) - 0.5) * 0.05, xx, y));
  for (let y = 150; y < 214; y++) for (let xx = 0; xx < W; xx++) if (c.alphaAt(xx, y)) c.set(xx, y, mix(c.get(xx, y), 0x56658e, Math.max(0, (y - 150) / 64) * 0.35));
  return c;
}

// ---------------------------------------------------------------- courtyard backdrop
export const COURTYARD_W = 1920;

function snowGround(c: PixelCanvas, x0: number, x1: number, warmAt: number[]) {
  for (let y = HORIZON_Y + 4; y < VIEW_H; y++)
    for (let x = x0; x < x1; x++) {
      let v = 0.5 + (y - HORIZON_Y) * 0.004 + (hash(x >> 1, y, 3) - 0.5) * 0.08;
      // sastrugi / ruts
      v += Math.sin(x * 0.07 + y * 0.6) * 0.03;
      let col = rampAt(P.snow, v, x, y);
      // warm light pools
      for (const wx of warmAt) {
        const d = Math.hypot((x - wx) / 60, (y - GROUND_Y + 6) / 18);
        if (d < 1) col = mix(col, rampAt(P.snowWarm, 0.75, x, y), (1 - d) * 0.55);
      }
      c.set(x, y, col);
    }
}

function asphaltPath(c: PixelCanvas, warmAt: number[]) {
  const top = GROUND_Y - 14, bot = GROUND_Y + 12;
  for (let y = top; y < bot; y++)
    for (let x = 0; x < COURTYARD_W; x++) {
      const edge = Math.min(y - top, bot - y);
      const n = hash(x >> 2, y >> 1, 9);
      // ragged snow edges / snow patches on the asphalt
      if (edge < 3 && n > 0.45 + edge * 0.12) continue;
      const patch = hash(x >> 4, y >> 2, 21) > 0.82 && hash(x >> 2, y, 4) > 0.3;
      if (patch) {
        c.set(x, y, rampAt(P.snow, 0.62 + (hash(x, y) - 0.5) * 0.1, x, y));
        continue;
      }
      let col = rampAt(P.asphalt, 0.45 + (hash(x, y, 5) - 0.5) * 0.25, x, y);
      for (const wx of warmAt) {
        const d = Math.abs(x - wx) / 22;
        // wet reflection streak of a lamp
        if (d < 1 && y > GROUND_Y - 4) col = mix(col, P.windowWarm[2], (1 - d) * 0.35 * (bayer(x, y) > 0.5 ? 1 : 0.4));
      }
      c.set(x, y, col);
    }
}

function chainFence(c: PixelCanvas, x0: number, x1: number, top: number, base: number) {
  for (let y = top; y < base; y++)
    for (let x = x0; x < x1; x++) {
      const a = (x + y) % 6 === 0, b = (x - y + 600) % 6 === 0;
      if (a || b) c.set(x, y, mix(P.metal[1], c.get(x, y), 0.35));
    }
  c.hline(x0, x1, top, P.metal[2]);
  c.hline(x0, x1, top - 1, P.snow[4]);
  for (let x = x0; x <= x1; x += 48) {
    c.rect(x, top - 3, 2, base - top + 3, (xx, yy) => rampAt(P.metal, xx === x ? 0.2 : 0.6, xx, yy));
    c.set(x, top - 4, P.snow[5]);
    c.set(x + 1, top - 4, P.snow[5]);
  }
  // snow drifted against the fence
  for (let x = x0; x < x1; x++) {
    const hgt = 2 + Math.round(hash(x >> 3, 1, 4) * 3 + Math.sin(x * 0.05) * 1.5);
    for (let y = base - hgt; y < base; y++) c.set(x, y, rampAt(P.snow, 0.7 + (base - y) * 0.03, x, y));
  }
}

function garage(c: PixelCanvas, x: number, base: number, w: number, h: number, ramp: Ramp, num: string, open = false) {
  const top = base - h;
  c.rect(x, top, w, h, (xx, yy) => rampAt(ramp, 0.35 + ((xx - x) / w) * 0.2 + ((xx - x) % 4 === 0 ? -0.15 : 0) + (hash(xx, yy, 2) > 0.97 ? 0.15 : 0), xx, yy));
  // rust streaks
  for (let i = 0; i < 4; i++) {
    const rx = x + 3 + Math.floor(hash(i, x) * (w - 6));
    for (let y = top + 2; y < top + 6 + hash(i, 3) * 20; y++) if (bayer(rx, y) < 0.7) c.set(rx, y, mix(c.get(rx, y), P.rust[2], 0.6));
  }
  // roof with heavy snow
  c.rect(x - 2, top - 2, w + 4, 2, ramp[0]);
  for (let xx = x - 3; xx < x + w + 3; xx++) {
    const sh = 3 + Math.round(hash(xx >> 2, 5) * 2);
    for (let y = top - 2 - sh; y < top - 1; y++) c.set(xx, y, rampAt(P.snow, 0.72 + (top - y) * 0.03, xx, y));
  }
  // icicles
  for (let xx = x; xx < x + w; xx += 3) if (hash(xx, 9) > 0.55) c.vline(xx, top, top + 1 + Math.round(hash(xx, 8) * 3), P.snow[5]);
  // door
  const dx = x + 4, dw = w - 8, dy = top + 6, dh = h - 6;
  if (open) {
    c.rect(dx, dy, dw, dh, (xx, yy) => rampAt([0x08080e, 0x10121c, 0x1a1c2a, 0x26283a], 0.2 + (yy - dy) / dh * 0.3, xx, yy));
    // warm work lamp inside
    c.ellipse(dx + dw / 2, dy + 8, 14, 10, (xx, yy, nx, ny) => mix(c.get(xx, yy), P.windowWarm[2], (1 - Math.hypot(nx, ny)) * 0.6));
    c.rect(dx + dw / 2 - 1, dy + 6, 3, 3, P.windowWarm[4]);
    // shelves
    c.hline(dx + 2, dx + 12, dy + 16, P.wood[2]);
    c.rect(dx + 3, dy + 13, 3, 3, P.tin[2]);
    c.rect(dx + 8, dy + 12, 2, 4, P.redMetal[3]);
  } else {
    c.rect(dx, dy, dw, dh, (xx, yy) => rampAt(ramp, 0.42 + ((xx - dx) % 3 === 0 ? -0.18 : 0.05) + ((xx - dx) / dw) * 0.15, xx, yy));
    c.vline(dx + Math.floor(dw / 2), dy, base - 1, ramp[0]);
    c.rect(dx + Math.floor(dw / 2) - 2, dy + dh / 2, 2, 3, P.tin[3]);
  }
  // painted number
  drawDigits(c, x + w / 2 - num.length * 2, top + 1, num, P.white);
  // snow at the base
  for (let xx = x - 2; xx < x + w + 2; xx++) for (let y = base - 2 - Math.round(hash(xx >> 2, 3) * 2); y < base; y++) c.set(xx, y, rampAt(P.snow, 0.68, xx, y));
}

const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'], '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

export function drawDigits(c: PixelCanvas, x: number, y: number, s: string, col: RGB) {
  [...s].forEach((ch, i) => {
    const g = DIGITS[ch];
    if (!g) return;
    g.forEach((row, r) => [...row].forEach((b, k) => b === '1' && c.set(x + i * 4 + k, y + r, col, 0.85)));
  });
}

export interface CourtyardLayout {
  entranceX: number;
  benchX: number;
  playground: [number, number];
  garages: { x: number; w: number; num: string; open?: boolean }[];
  lamps: number[];
  archX: number;
}

export const COURTYARD: CourtyardLayout = {
  entranceX: 196,
  benchX: 300,
  playground: [420, 980],
  garages: [
    { x: 1180, w: 44, num: '3' },
    { x: 1228, w: 44, num: '5' },
    { x: 1276, w: 44, num: '7', open: true },
    { x: 1324, w: 44, num: '9' },
    { x: 1372, w: 44, num: '11' },
    { x: 1420, w: 44, num: '12' },
    { x: 1468, w: 44, num: '14' },
    { x: 1516, w: 44, num: '16' },
    { x: 1564, w: 44, num: '17' },
    { x: 1612, w: 44, num: '19' },
  ],
  lamps: [140, 560, 1080, 1460, 1760],
  archX: 1810,
};

export function drawCourtyard(): PixelCanvas {
  const W = COURTYARD_W;
  const c = new PixelCanvas(W, VIEW_H);
  const L = COURTYARD;
  const warm = [...L.lamps, L.entranceX];
  snowGround(c, 0, W, warm);

  // our building (left) — brick khrushchevka, 5 floors
  drawBuilding(c, -20, HORIZON_Y + 8, { floors: 5, cols: 10, winW: 10, winH: 13, gapX: 13, floorH: 34, ramp: P.brick, lit: 0.45, seed: 900, detail: 2, brick: true, balconies: true });
  // second block across the yard behind the playground
  drawBuilding(c, 470, HORIZON_Y - 2, { floors: 5, cols: 18, winW: 6, winH: 8, gapX: 9, floorH: 22, ramp: P.panel, lit: 0.38, seed: 901, detail: 2, balconies: true });
  // block behind garages
  drawBuilding(c, 1160, HORIZON_Y - 4, { floors: 9, cols: 16, winW: 5, winH: 6, gapX: 9, floorH: 15, ramp: P.panel.map((v) => darken(v, 0.12)), lit: 0.3, seed: 902, detail: 1, balconies: true });

  // trees in the yard (behind the fence)
  drawTree(c, 410, 206, 120, P.bark, 11, true, 5);
  drawTree(c, 1000, 205, 110, P.bark, 12, true, 4);
  drawTree(c, 1120, 206, 90, P.bark, 13, true, 4);
  drawTree(c, 1720, 206, 130, P.bark, 14, true, 5);

  // building entrance (подъезд) with concrete canopy and lamp
  const ex = L.entranceX;
  c.rect(ex - 18, 156, 36, 44, (x, y) => rampAt(P.brick, 0.25 + (hash(x, y) - 0.5) * 0.08, x, y));
  c.rect(ex - 12, 166, 24, 34, (x, y) => rampAt(P.wood, 0.25 + ((x - ex + 12) / 24) * 0.35 + ((x - ex) === 0 ? -0.2 : 0) + (hash(x >> 1, y) - 0.5) * 0.08, x, y));
  c.vline(ex, 166, 199, P.wood[0]);
  c.rect(ex - 9, 172, 7, 9, P.windowCold[2]);
  c.rect(ex + 3, 172, 7, 9, P.windowCold[2]);
  c.rect(ex - 24, 154, 48, 4, (x, y) => rampAt(P.panel, 0.4 + ((x - ex + 24) / 48) * 0.2, x, y));
  c.rect(ex - 25, 150, 50, 4, (x, y) => rampAt(P.snow, 0.8 + (hash(x, y) - 0.5) * 0.1, x, y));
  c.rect(ex - 3, 158, 6, 3, P.windowWarm[4]);
  c.ellipse(ex, 170, 40, 30, (x, y, nx, ny) => mix(c.get(x, y), P.windowWarm[3], Math.max(0, 1 - Math.hypot(nx, ny)) * 0.35));
  // steps
  c.rect(ex - 16, 200, 32, 3, P.panel[3]);
  c.rect(ex - 18, 203, 36, 3, P.panel[2]);
  drawDigits(c, ex + 16, 160, '3', P.white);
  // mailbox-ish board with notices
  c.rect(ex + 22, 172, 10, 12, P.wood[2]);
  c.rect(ex + 23, 173, 4, 5, 0xe8e2d0);
  c.rect(ex + 28, 175, 3, 6, 0xd8d0b8);

  // playground fence and snow-covered sandbox
  chainFence(c, 380, 1010, 168, 206);
  c.rect(840, 196, 70, 8, (x, y) => rampAt(P.wood, 0.4 + (x % 8 === 0 ? -0.2 : 0), x, y));
  c.rect(840, 192, 70, 4, (x, y) => rampAt(P.snow, 0.8, x, y));

  // garages
  for (const g of L.garages) garage(c, g.x, 206, g.w, 34, g.num === '12' ? P.garageGreen : g.num === '7' ? P.garageBrown : P.garage, g.num, g.open);
  // arch passage at the far right
  c.rect(L.archX - 10, 120, 140, 86, (x, y) => rampAt(P.panel, 0.38 + (hash(x, y, 7) - 0.5) * 0.06, x, y));
  c.rect(L.archX + 20, 150, 50, 56, (x, y) => rampAt([0x0a0c18, 0x121628, 0x1c2238], 0.2 + (y - 150) / 56 * 0.6, x, y));
  c.ellipse(L.archX + 45, 150, 25, 10, (x, y, _nx, ny) => (ny > 0 ? null : rampAt([0x0a0c18, 0x121628], 0.5, x, y)));
  c.rect(L.archX + 40, 140, 10, 6, 0x3a5aa0);
  c.hline(L.archX + 41, L.archX + 48, 142, P.white);
  asphaltPath(c, warm);
  return c;
}

// ---------------------------------------------------------------- props (separate sprites)
export function drawLamp(): PixelCanvas {
  const c = new PixelCanvas(28, 110);
  c.rect(12, 14, 3, 96, (x, y) => rampAt(P.metal, x === 12 ? 0.2 : 0.55, x, y));
  c.rect(10, 104, 7, 6, P.metal[1]);
  c.line(13, 14, 22, 10, P.metal[2]);
  c.line(13, 15, 22, 11, P.metal[1]);
  c.rect(17, 10, 9, 3, P.metal[2]);
  c.rect(18, 13, 7, 2, P.windowWarm[4]);
  c.hline(17, 25, 9, P.snow[5]);
  return c;
}

export function drawBench(): PixelCanvas {
  const c = new PixelCanvas(56, 26);
  c.rect(2, 4, 52, 3, (x, y) => rampAt(P.wood, 0.55 + (x % 9 === 0 ? -0.3 : 0), x, y));
  c.rect(2, 8, 52, 3, (x, y) => rampAt(P.wood, 0.45 + (x % 9 === 0 ? -0.3 : 0), x, y));
  c.rect(0, 14, 56, 4, (x, y) => rampAt(P.wood, 0.6, x, y));
  for (const lx of [6, 46]) c.rect(lx, 4, 3, 22, P.metal[1]);
  c.rect(0, 12, 56, 2, (x, y) => rampAt(P.snow, 0.82 + (hash(x, y) - 0.5) * 0.1, x, y));
  c.rect(4, 2, 48, 2, (x, y) => (hash(x, 1) > 0.3 ? rampAt(P.snow, 0.85, x, y) : null));
  return c;
}

export function drawSlide(): PixelCanvas {
  const c = new PixelCanvas(120, 96);
  // ladder tower
  c.rect(14, 10, 3, 86, P.redMetal[2]);
  c.rect(40, 10, 3, 86, P.redMetal[2]);
  c.rect(12, 8, 34, 3, P.redMetal[3]);
  c.rect(12, 6, 34, 2, P.snow[5]);
  for (let y = 22; y < 96; y += 8) c.rect(17, y, 23, 2, P.metal[2]);
  c.rect(14, 40, 29, 3, P.redMetal[1]);
  c.rect(14, 38, 29, 2, P.snow[4]);
  // roof
  c.poly([[10, 8], [48, 8], [29, -2]], (x, y) => rampAt(P.redMetal, 0.4 + (x - 10) / 40 * 0.3, x, y));
  // slide chute
  c.poly([[43, 40], [50, 40], [116, 90], [108, 92]], (x, y) => rampAt(P.metal, 0.6 + ((x + y) % 7 === 0 ? 0.15 : 0), x, y));
  c.line(43, 38, 112, 88, P.snow[5]);
  c.line(44, 38, 113, 88, P.snow[4]);
  c.line(46, 43, 108, 92, P.metal[0]);
  c.rect(104, 88, 14, 8, (x, y) => rampAt(P.snow, 0.75, x, y));
  return c;
}

export function drawSwings(): PixelCanvas {
  const c = new PixelCanvas(150, 96);
  for (const px of [6, 140]) {
    c.line(px - 4, 95, px + 2, 6, P.redMetal[1]);
    c.line(px + 8, 95, px + 2, 6, P.redMetal[2]);
  }
  c.rect(4, 4, 142, 4, (x, y) => rampAt(P.redMetal, 0.5 + (y === 4 ? 0.2 : 0), x, y));
  c.rect(4, 2, 142, 2, (x, y) => rampAt(P.snow, 0.85 + (hash(x, y) - 0.5) * 0.1, x, y));
  return c;
}

/** One swing seat with chains, pivot at top-centre. */
export function drawSwingSeat(): PixelCanvas {
  const c = new PixelCanvas(24, 62);
  for (let y = 0; y < 56; y++) {
    if (y % 2 === 0) {
      c.set(3, y, P.metal[3]);
      c.set(20, y, P.metal[3]);
    } else {
      c.set(3, y, P.metal[1]);
      c.set(20, y, P.metal[1]);
    }
  }
  c.rect(1, 55, 22, 4, (x, y) => rampAt(P.wood, 0.5 + (y === 55 ? 0.2 : 0), x, y));
  c.rect(1, 53, 22, 2, (x, y) => rampAt(P.snow, 0.85, x, y));
  c.rect(1, 59, 22, 2, P.wood[0]);
  return c;
}

export function drawClimber(): PixelCanvas {
  const c = new PixelCanvas(90, 70);
  for (const px of [4, 44, 84]) c.rect(px, 6, 3, 64, P.metal[2]);
  c.rect(2, 4, 87, 3, P.metal[3]);
  c.rect(2, 2, 87, 2, P.snow[5]);
  for (let x = 8; x < 86; x += 7) c.vline(x, 7, 9, P.metal[1]);
  for (let y = 20; y < 70; y += 12) c.rect(4, y, 83, 2, P.metal[1]);
  return c;
}

export function drawCar(): PixelCanvas {
  const c = new PixelCanvas(96, 44);
  const body = P.redMetal.map((v) => mix(v, 0x6a3a40, 0.3));
  c.poly([[4, 22], [24, 20], [32, 8], [66, 8], [76, 20], [93, 23], [94, 36], [2, 36]], (x, y) => rampAt(body, 0.35 + (x / 96) * 0.25 - (y - 8) / 30 * 0.15, x, y));
  c.poly([[34, 11], [48, 11], [48, 20], [28, 20]], (x, y) => rampAt([0x1c2238, 0x2c3654, 0x46587e], 0.3 + (x - 28) / 20 * 0.4, x, y));
  c.poly([[51, 11], [64, 11], [72, 20], [51, 20]], (x, y) => rampAt([0x1c2238, 0x2c3654, 0x46587e], 0.3 + (x - 51) / 20 * 0.4, x, y));
  c.hline(4, 92, 27, body[0]);
  c.rect(2, 30, 6, 3, P.windowWarm[3]);
  c.rect(90, 29, 4, 3, 0xb83030);
  for (const wx of [20, 76]) {
    c.disc(wx, 36, 7, (x, y) => rampAt(P.metal, 0.15 + (hash(x, y) - 0.5) * 0.1, x, y));
    c.disc(wx, 36, 3, P.metal[3]);
  }
  // heavy snow on roof and hood
  c.poly([[30, 9], [68, 9], [66, 2], [34, 3]], (x, y) => rampAt(P.snow, 0.82 + (hash(x, y) - 0.5) * 0.12, x, y));
  c.poly([[4, 22], [26, 19], [26, 16], [6, 19]], (x, y) => rampAt(P.snow, 0.8, x, y));
  c.poly([[76, 20], [93, 23], [93, 20], [78, 17]], (x, y) => rampAt(P.snow, 0.8, x, y));
  c.outline((n) => darken(n, 0.7));
  return c;
}

export function drawTrash(): PixelCanvas {
  const c = new PixelCanvas(60, 34);
  for (const bx of [0, 30]) {
    c.box(bx + 1, 6, 28, 28, 2, (x, y, u) => rampAt(P.garageGreen, 0.3 + u * 0.4 + (x % 5 === 0 ? -0.1 : 0), x, y));
    c.rect(bx, 3, 30, 4, (x, y) => rampAt(P.snow, 0.8 + (hash(x, y) - 0.5) * 0.1, x, y));
  }
  c.rect(26, 26, 8, 5, P.cardboard[2]);
  return c;
}

export function drawDrift(w: number, h: number, seed: number): PixelCanvas {
  const c = new PixelCanvas(w, h);
  for (let x = 0; x < w; x++) {
    const t = x / w;
    const hh = Math.round(h * (0.35 + 0.55 * Math.sin(t * Math.PI) + (hash(x >> 3, 1, seed) - 0.5) * 0.15));
    for (let y = h - hh; y < h; y++) c.set(x, y, rampAt(P.snow.map((v) => darken(v, 0.35)), 0.55 + (h - y) / h * 0.3 - (t - 0.5) * 0.2, x, y));
  }
  return c;
}

export function drawPost(): PixelCanvas {
  const c = new PixelCanvas(10, 40);
  c.rect(3, 4, 4, 36, (x, y) => rampAt(P.wood, x === 3 ? 0.2 : 0.5, x, y));
  c.rect(2, 2, 6, 3, P.snow[5]);
  // rope where the dog was tied
  c.line(7, 30, 9, 33, 0xb8a888);
  return c;
}

export function drawArchSign(): PixelCanvas {
  const c = new PixelCanvas(40, 16);
  c.rect(0, 0, 40, 16, (x, y) => rampAt(P.wood, 0.4 + (hash(x, y) - 0.5) * 0.1, x, y));
  c.rect(2, 2, 36, 12, 0x2a4a8a);
  return c;
}

// ---------------------------------------------------------------- glow / fx textures
export function drawGlow(r: number, col: RGB): PixelCanvas {
  const c = new PixelCanvas(r * 2, r * 2);
  for (let y = 0; y < r * 2; y++)
    for (let x = 0; x < r * 2; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      if (d >= 1) continue;
      // stepped falloff — banded like hand-made pixel light
      const step = Math.floor((1 - d) * 5) / 5;
      if (step <= 0) continue;
      c.set(x, y, col, step * step * 0.9);
    }
  return c;
}

export function drawFootprint(): PixelCanvas {
  const c = new PixelCanvas(5, 3);
  c.rect(0, 0, 4, 2, P.snow[2]);
  c.set(4, 1, P.snow[2]);
  c.rect(1, 2, 2, 1, P.snow[3]);
  return c;
}

export function drawShadow(w: number): PixelCanvas {
  const c = new PixelCanvas(w, 5);
  c.ellipse(w / 2, 2.5, w / 2, 2.5, () => 0x10142a);
  return c;
}
