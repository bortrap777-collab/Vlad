/** Dog, items, small FX sprites. */
import { PixelCanvas, rampAt, hash, mix, darken } from './raster';
import { P } from './palette';

export const DOG_W = 44;
export const DOG_H = 32;

interface DogPose {
  bob?: number;
  legs?: [number, number, number, number]; // x offsets of feet: back-far, back-near, front-far, front-near
  lift?: [number, number, number, number];
  tail?: number; // -1 down … 1 up
  ears?: 'up' | 'back';
  cower?: boolean;
  mouth?: boolean;
  sit?: boolean;
  head?: number;
}

export function drawDog(p: DogPose = {}): PixelCanvas {
  const c = new PixelCanvas(DOG_W, DOG_H);
  const fur = P.dogFur, light = P.dogLight;
  const ground = 30;
  const low = p.cower ? 3 : 0;
  const bob = (p.bob ?? 0) + low;
  const bx = 20, by = 17 + bob;
  const legs = p.legs ?? [0, 0, 0, 0];
  const lift = p.lift ?? [0, 0, 0, 0];
  const legAt = (hx: number, fx: number, lf: number, far: boolean) => {
    const ramp = far ? fur.map((v) => darken(v, 0.25)) : fur;
    c.stroke(hx, by + 2, hx + fx, ground - lf, 1.3, (x) => (x < hx + fx / 2 ? ramp[1] : ramp[2]));
    c.rect(hx + fx - 1, ground - lf, 3, 1, far ? light[0] : light[2]);
  };
  // tail
  const tail = p.tail ?? 0.3;
  const tx = bx - 10, ty = by - 2;
  c.stroke(tx, ty, tx - 6, ty - 6 * tail + 2, 1.2, (x, y) => rampAt(fur, 0.55 + (hash(x, y) - 0.5) * 0.2, x, y));
  c.set(tx - 6, ty - 6 * tail + 1, light[3]);
  if (p.sit) {
    legAt(bx - 7, 3, 0, true);
    c.ellipse(bx - 6, by + 6, 7, 6, (x, y, nx, ny) => rampAt(fur, 0.45 + nx * 0.25 - ny * 0.2, x, y));
    legAt(bx + 7, 0, 0, true);
    legAt(bx + 9, 0, 0, false);
    c.ellipse(bx + 1, by + 1, 9, 6, (x, y, nx, ny) => rampAt(fur, 0.45 + nx * 0.25 - ny * 0.25, x, y));
  } else {
    legAt(bx - 7, legs[0], lift[0], true);
    legAt(bx + 7, legs[2], lift[2], true);
    c.ellipse(bx, by, 11, 5.5, (x, y, nx, ny) => {
      if (ny > 0.45 && nx > 0.2) return rampAt(light, 0.55, x, y); // light belly/chest
      return rampAt(fur, 0.48 + nx * 0.2 - ny * 0.3 + (hash(x >> 1, y, 3) - 0.5) * 0.15, x, y);
    });
    legAt(bx - 5, legs[1], lift[1], false);
    legAt(bx + 9, legs[3], lift[3], false);
  }
  // head
  const hx = bx + 11, hy = by - 6 + (p.head ?? 0) + (p.cower ? 4 : 0);
  c.ellipse(hx, hy, 5.5, 5, (x, y, nx, ny) => rampAt(fur, 0.55 + nx * 0.2 - ny * 0.25, x, y));
  c.ellipse(hx + 5, hy + 2, 3.5, 2.4, (x, y, nx) => rampAt(light, 0.5 + nx * 0.3, x, y));
  c.set(hx + 8, hy + 1, P.ink);
  c.set(hx + 8, hy + 2, P.ink);
  c.set(hx + 2, hy - 1, P.ink);
  c.set(hx + 3, hy - 2, mix(P.ink, P.white, 0.6));
  if (p.mouth) {
    c.hline(hx + 4, hx + 8, hy + 4, 0x5a1a1a);
    c.set(hx + 6, hy + 5, 0xd06070);
  }
  // ears
  if ((p.ears ?? 'up') === 'up') c.poly([[hx - 3, hy - 3], [hx + 1, hy - 4], [hx - 2, hy - 9]], (x, y) => rampAt(fur, 0.3, x, y));
  else c.poly([[hx - 3, hy - 2], [hx + 1, hy - 3], [hx - 7, hy - 4]], (x, y) => rampAt(fur, 0.3, x, y));
  c.outline((n) => mix(darken(n, 0.72), P.outline, 0.45));
  return c;
}

export function dogAnims(): Record<string, { frames: PixelCanvas[]; fps: number; loop: boolean }> {
  const walk: PixelCanvas[] = [];
  const run: PixelCanvas[] = [];
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    const s = Math.sin(t), co = Math.cos(t);
    walk.push(drawDog({ legs: [s * 3, -s * 3, -s * 3, s * 3], lift: [Math.max(0, co) * 2, Math.max(0, -co) * 2, Math.max(0, -co) * 2, Math.max(0, co) * 2], bob: Math.round(Math.abs(s) * 0.8), tail: 0.6 + s * 0.2 }));
    run.push(drawDog({ legs: [s * 5, s * 4, -s * 5, -s * 4], lift: [Math.max(0, co) * 3, Math.max(0, co) * 3, Math.max(0, -co) * 3, Math.max(0, -co) * 3], bob: Math.round(-co), tail: 0.8, ears: 'back' }));
  }
  return {
    idle: { frames: [0.6, 0.9, 0.6, 0.3].map((t, i) => drawDog({ tail: t, bob: i === 2 ? 1 : 0 })), fps: 6, loop: true },
    walk: { frames: walk, fps: 10, loop: true },
    run: { frames: run, fps: 14, loop: true },
    cower: { frames: [drawDog({ cower: true, tail: -1, ears: 'back' }), drawDog({ cower: true, tail: -1, ears: 'back', bob: 1 })], fps: 8, loop: true },
    bark: { frames: [drawDog({ mouth: true, head: -1, tail: 0.9 }), drawDog({ mouth: false, tail: 0.9 })], fps: 6, loop: true },
    sit: { frames: [drawDog({ sit: true, tail: -0.3 }), drawDog({ sit: true, tail: 0.1 })], fps: 3, loop: true },
  };
}

export function drawCan(): PixelCanvas {
  const c = new PixelCanvas(6, 7);
  c.rect(0, 1, 6, 6, (x, y) => rampAt(P.tin, 0.3 + x / 6 * 0.6, x, y));
  c.hline(0, 5, 0, P.tin[4]);
  c.hline(0, 5, 3, 0xb03030);
  c.hline(0, 5, 4, 0xb03030);
  return c;
}

/** 16×16 inventory icons. */
export const ITEM_ICONS = ['key', 'bread', 'mitten', 'drawing', 'flashlight', 'cans'] as const;

export function drawItemIcon(id: (typeof ITEM_ICONS)[number]): PixelCanvas {
  const c = new PixelCanvas(16, 16);
  switch (id) {
    case 'key':
      c.ellipse(5, 5, 4, 4, (x, y, nx) => rampAt(P.windowWarm, 0.5 + nx * 0.35, x, y));
      c.disc(5, 5, 1.2, 0x00000000);
      c.clear(5, 5);
      c.stroke(7, 7, 13, 13, 1, () => P.windowWarm[2]);
      c.rect(11, 13, 2, 2, P.windowWarm[1]);
      c.rect(13, 11, 2, 2, P.windowWarm[1]);
      c.line(1, 1, 3, 3, 0xc03030);
      break;
    case 'bread':
      c.ellipse(8, 9, 7, 5, (x, y, nx, ny) => rampAt([0x6a3a1a, 0x9a5a28, 0xc8843c, 0xe8b070, 0xf8d8a0], 0.5 + nx * 0.2 - ny * 0.35, x, y));
      c.ellipse(5, 10, 3, 2.5, (x, y) => rampAt([0xe8d0a0, 0xf8ead0], 0.5, x, y));
      break;
    case 'mitten':
      c.box(3, 3, 9, 11, 4, (x, y, u) => rampAt(P.redBand, 0.4 + u * 0.4 + (x % 2 ? 0 : -0.1), x, y));
      c.box(10, 6, 4, 5, 2, (x, y) => rampAt(P.redBand, 0.6, x, y));
      c.rect(3, 12, 9, 3, (x) => (x % 2 ? P.white : 0xd8d8e8));
      c.set(6, 7, P.white);
      c.set(8, 7, P.white);
      c.set(7, 9, P.white);
      break;
    case 'drawing':
      c.rect(2, 2, 12, 13, 0xf0ece0);
      c.rect(2, 2, 12, 1, 0xc8c0b0);
      c.rect(4, 9, 8, 3, 0x3a3a48);
      c.rect(5, 7, 5, 2, 0x3a3a48);
      c.set(11, 10, P.windowWarm[3]);
      c.disc(5, 12, 1, 0x1a1a24);
      c.disc(10, 12, 1, 0x1a1a24);
      c.line(3, 5, 7, 4, 0x6a6a7a);
      break;
    case 'flashlight':
      c.rect(2, 6, 9, 5, (x, y) => rampAt(P.metal, 0.3 + (y - 6) / 5 * 0.5, x, y));
      c.rect(10, 5, 4, 7, (x, y) => rampAt(P.tin, 0.4 + (y - 5) / 7 * 0.5, x, y));
      c.rect(14, 6, 1, 5, P.windowWarm[4]);
      c.rect(5, 5, 2, 1, 0xc03030);
      break;
    case 'cans':
      for (const [x, y] of [[2, 6], [8, 4]] as const) c.blit(drawCan(), x, y);
      c.line(4, 6, 12, 2, 0xb8a888);
      break;
  }
  c.outline((n) => darken(n, 0.75));
  return c;
}

export function drawFlake(size: number): PixelCanvas {
  const c = new PixelCanvas(size, size);
  c.rect(0, 0, size, size, 0xf4f7ff);
  return c;
}

export function drawPuff(): PixelCanvas {
  const c = new PixelCanvas(8, 6);
  c.ellipse(4, 3, 3.5, 2.5, (x, y) => (hash(x, y) > 0.3 ? 0xe8eefa : null));
  return c;
}

export function drawUiFrame(): PixelCanvas {
  // 9-slice friendly 24×24 frame: dark navy panel with a warm inner rim
  const c = new PixelCanvas(24, 24);
  c.rect(0, 0, 24, 24, 0x0b0e1e);
  c.rect(1, 1, 22, 22, 0x2a3456);
  c.rect(2, 2, 20, 20, 0x141a32);
  c.rect(3, 3, 18, 18, 0x10152a);
  for (const [x, y] of [[0, 0], [23, 0], [0, 23], [23, 23]] as const) c.clear(x, y);
  c.set(2, 2, 0xf0a848);
  c.set(21, 2, 0xf0a848);
  c.set(2, 21, 0xf0a848);
  c.set(21, 21, 0xf0a848);
  return c;
}
