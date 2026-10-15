/** Kolya's apartment: hallway, kitchen and living room in one continuous 640-px interior. */
import { PixelCanvas, rampAt, hash, mix, bayer, darken } from './raster';
import { P } from './palette';
import { drawDigits, GROUND_Y } from './environment';

export const APARTMENT_W = 640;
const FLOOR_TOP = 228;
const CEIL = 22;

export const APARTMENT = {
  doorX: 56,
  hooksX: 112,
  boxesX: 152,
  stoveX: 196,
  windowX: 292,
  tableX: 292,
  fridgeX: 372,
  calendarX: 236,
  carpetX: 500,
  photoX: 590,
  tvX: 590,
};

export function drawApartment(): PixelCanvas {
  const W = APARTMENT_W;
  const c = new PixelCanvas(W, 270);
  const A = APARTMENT;
  // ceiling
  c.rect(0, 0, W, CEIL, (x, y) => rampAt(P.wallpaper.map((v) => darken(v, 0.55)), 0.3 + y / CEIL * 0.3, x, y));
  // walls by zone
  for (let y = CEIL; y < FLOOR_TOP; y++)
    for (let x = 0; x < W; x++) {
      let col: number;
      if (x < 170) {
        // hallway: green striped wallpaper
        const stripe = (x % 12) < 2 ? -0.12 : (x % 12) === 6 ? 0.08 : 0;
        const motif = (x % 12 === 9) && (y % 10 < 3) ? 0.15 : 0;
        col = rampAt(P.wallpaperGreen, 0.42 + stripe + motif - (y - CEIL) / 400, x, y);
      } else if (x < 404) {
        // kitchen: tiles below, beige paint above
        if (y > 150) {
          const grout = (x % 10 === 0) || ((y - 150) % 10 === 0);
          col = rampAt(P.tile, grout ? 0.25 : 0.55 + (hash(x >> 3, y >> 3, 2) - 0.5) * 0.1, x, y);
        } else col = rampAt(P.wallpaper, 0.55 + (hash(x, y, 4) - 0.5) * 0.05 - (y - CEIL) / 600, x, y);
      } else {
        // room: brown floral wallpaper
        const fx = x % 16, fy = y % 18;
        const flower = (fx - 8) ** 2 + (fy - 9) ** 2 < 6;
        const stem = fx === 8 && fy > 11;
        col = rampAt(P.wallpaper, 0.38 + (flower ? 0.22 : 0) + (stem ? -0.15 : 0) + ((fx + fy) % 16 === 0 ? 0.06 : 0), x, y);
      }
      c.set(x, y, col);
    }
  // ambient occlusion: walls darken towards the floor and the ceiling corner
  for (let y = CEIL; y < FLOOR_TOP; y++)
    for (let x = 0; x < W; x++) {
      const low = Math.max(0, (y - (FLOOR_TOP - 34)) / 34);
      const high = Math.max(0, 1 - (y - CEIL) / 14);
      const k = low * 0.28 + high * 0.3;
      if (k > 0 && bayer(x, y) < 0.85) c.set(x, y, mix(c.get(x, y), 0x0d0f1e, k));
    }
  // baseboard + floor
  c.rect(0, FLOOR_TOP - 4, W, 4, (x, y) => rampAt(P.wood, 0.3 + (y === FLOOR_TOP - 4 ? 0.3 : 0), x, y));
  for (let y = FLOOR_TOP; y < 270; y++)
    for (let x = 0; x < W; x++) {
      const persp = (x - W / 2) * (1 + (y - FLOOR_TOP) / 30);
      const plank = Math.floor(persp / 40);
      let v = 0.45 + ((plank % 2) ? 0.06 : 0) + (y - FLOOR_TOP) * 0.004;
      if (x >= 170 && x < 404) v += ((Math.floor(x / 12) + Math.floor(y / 6)) % 2 ? 0.08 : -0.04); // checker lino in kitchen
      c.set(x, y, rampAt(P.lino, v, x, y));
    }
  // rug in the room
  c.rect(430, 240, 170, 22, (x, y) => {
    const border = y < 243 || y > 258 || x < 434 || x > 595;
    const pat = ((x + y) % 8 < 2) || ((x - y + 400) % 8 < 2);
    return rampAt(P.carpet, border ? 0.25 : pat ? 0.7 : 0.45, x, y);
  });

  // doorframes between zones (with a soft cast shadow on the wall)
  for (const dx of [170, 404]) {
    for (let y = CEIL; y < FLOOR_TOP; y++) for (let x = dx + 4; x < dx + 9; x++) c.set(x, y, mix(c.get(x, y), 0x0d0f1e, 0.22 * (1 - (x - dx - 4) / 5)));
    c.rect(dx - 3, CEIL, 7, FLOOR_TOP - CEIL, (x, y) => rampAt(P.wood.map((v) => mix(v, 0xe0d8c8, 0.55)), 0.35 + (x - dx + 3) / 7 * 0.4, x, y));
  }

  // --- hallway: padded leatherette front door
  const dx = A.doorX;
  c.rect(dx - 24, 90, 48, FLOOR_TOP - 90, (x, y) => rampAt(P.wood.map((v) => mix(v, 0xe0d8c8, 0.5)), 0.4, x, y));
  c.rect(dx - 20, 94, 40, FLOOR_TOP - 94, (x, y) => {
    const lx = x - (dx - 20), ly = y - 94;
    const diamond = ((lx + ly) % 10 === 0) || ((lx - ly + 400) % 10 === 0);
    const stud = diamond && ((lx + ly) % 20 === 0);
    if (stud) return P.windowWarm[3];
    return rampAt(P.coatBrown, 0.45 + (diamond ? -0.2 : 0.05) + lx / 40 * 0.2, x, y);
  });
  c.rect(dx + 12, 160, 4, 3, P.windowWarm[3]);
  c.rect(dx - 2, 130, 3, 3, P.metal[3]); // peephole
  drawDigits(c, dx - 3, 108, '27', P.windowWarm[3]);
  // coat hooks with coats
  c.rect(A.hooksX - 22, 98, 44, 4, P.wood[2]);
  for (let i = 0; i < 4; i++) c.rect(A.hooksX - 18 + i * 12, 102, 2, 3, P.metal[3]);
  c.poly([[A.hooksX - 20, 104], [A.hooksX - 6, 104], [A.hooksX - 4, 168], [A.hooksX - 23, 168]], (x, y) => rampAt(P.coatGrey, 0.35 + (x - A.hooksX + 23) / 20 * 0.35 + (hash(x, y) - 0.5) * 0.06, x, y));
  c.poly([[A.hooksX + 2, 104], [A.hooksX + 16, 104], [A.hooksX + 20, 160], [A.hooksX - 1, 160]], (x, y) => rampAt(P.coatPlum, 0.4 + (x - A.hooksX) / 20 * 0.35, x, y));
  c.rect(A.hooksX + 2, 100, 14, 5, (x, y) => rampAt(P.furBrown, 0.5 + (hash(x, y) - 0.5) * 0.4, x, y));
  // shoe shelf
  c.rect(A.hooksX - 22, 210, 44, 14, P.wood[1]);
  c.rect(A.hooksX - 20, 205, 10, 5, P.boot[2]);
  c.rect(A.hooksX - 8, 206, 10, 4, P.shoeRed[2]);
  c.rect(A.hooksX + 6, 204, 12, 6, P.boot[1]);
  // mirror
  c.rect(146, 70, 18, 32, P.wood[2]);
  c.rect(148, 72, 14, 28, (x, y) => rampAt([0x5a6a84, 0x7a8aa4, 0x9aaac4, 0xc8d4e4], 0.4 + (x - y) % 9 / 18, x, y));

  // --- kitchen
  // window with frost and the courtyard at dusk behind it
  const wx = A.windowX;
  c.rect(wx - 34, 60, 68, 72, (x, y) => rampAt(P.wood.map((v) => mix(v, 0xf0ece4, 0.7)), 0.5, x, y));
  c.rect(wx - 30, 64, 60, 64, (x, y) => {
    const t = (y - 64) / 64;
    let col = rampAt(P.skyDusk, t * 0.9 + 0.1, x, y);
    // distant building with lights
    if (y > 92 && x > wx - 26 && x < wx + 22) col = ((x % 5 < 2) && (y % 6 < 3)) ? (hash(x, y, 4) > 0.6 ? P.windowWarm[3] : P.panel[1]) : P.panel[1];
    if (y > 118) col = rampAt(P.snow, 0.6, x, y);
    // frost creeping from the corners
    const fr = Math.min(x - (wx - 30), wx + 30 - x, 128 - y);
    if (fr < 7 && hash(x, y, 9) * 7 > fr) col = mix(col, 0xe8f0ff, 0.75);
    return col;
  });
  c.rect(wx - 1, 64, 3, 64, P.wood.map((v) => mix(v, 0xf0ece4, 0.7))[3]);
  c.rect(wx - 30, 86, 60, 3, P.wood.map((v) => mix(v, 0xf0ece4, 0.7))[3]);
  c.rect(wx - 38, 130, 76, 4, P.wood.map((v) => mix(v, 0xf0ece4, 0.7))[2]);
  // curtain (tulle)
  for (let y = 58; y < 132; y++) for (let x = wx - 36; x < wx - 22; x++) if (bayer(x, y) < 0.35) c.set(x, y, 0xf0f0ff, 0.6);
  for (let y = 58; y < 132; y++) for (let x = wx + 22; x < wx + 36; x++) if (bayer(x, y) < 0.35) c.set(x, y, 0xf0f0ff, 0.6);
  c.rect(wx - 40, 56, 80, 2, P.metal[3]);
  // cactus on the sill
  c.rect(wx + 14, 124, 6, 6, P.rust[3]);
  c.rect(wx + 15, 117, 4, 7, P.green[3]);
  // gas stove with kettle
  const sx = A.stoveX;
  c.box(sx - 16, 180, 32, 48, 2, (x, y, u) => rampAt(P.appliance, 0.5 + u * 0.3, x, y));
  c.rect(sx - 13, 196, 26, 22, (x, y) => rampAt(P.appliance.map((v) => darken(v, 0.4)), 0.4 + (y - 196) / 22 * 0.2, x, y));
  c.rect(sx - 10, 199, 20, 2, P.metal[1]);
  for (let i = 0; i < 4; i++) c.disc(sx - 11 + i * 7, 186, 1.5, P.ink);
  c.rect(sx - 15, 178, 30, 2, P.metal[1]);
  c.box(sx - 10, 166, 12, 12, 4, (x, y, u) => rampAt([0x7a1c1c, 0xb03030, 0xd85050, 0xf08080], 0.35 + u * 0.5, x, y));
  c.line(sx + 2, 170, sx + 6, 167, 0xb03030);
  c.rect(sx - 6, 163, 4, 3, P.ink);
  // wall radio
  c.rect(sx + 22, 100, 14, 18, P.appliance[1]);
  for (let y = 103; y < 112; y += 2) c.hline(sx + 24, sx + 33, y, P.metal[2]);
  // calendar 1996
  const cx = A.calendarX;
  c.rect(cx - 9, 72, 18, 26, 0xf2ece0);
  c.rect(cx - 8, 73, 16, 9, (x, y) => rampAt([0x6a8ab8, 0x8aa8d0, 0xb8d0ec], 0.3 + (y - 73) / 9 * 0.5, x, y));
  drawDigits(c, cx - 8, 85, '1996', 0x9a2020);
  for (let y = 92; y < 97; y += 2) c.hline(cx - 7, cx + 6, y, 0xa0a0a8);
  c.set(cx + 2, 94, 0xd02020);
  c.set(cx + 3, 94, 0xd02020);
  // table with oilcloth and stools
  const tx = A.tableX;
  c.rect(tx - 34, 184, 68, 6, (x, y) => {
    const check = ((x >> 2) + (y >> 1)) % 2 === 0;
    return rampAt(P.oilcloth, check ? 0.75 : 0.45, x, y);
  });
  c.rect(tx - 34, 190, 68, 6, (x, y) => rampAt(P.oilcloth, (x % 6 < 3 ? 0.5 : 0.3), x, y));
  c.rect(tx - 30, 196, 3, 32, P.wood[1]);
  c.rect(tx + 27, 196, 3, 32, P.wood[1]);
  for (const st of [tx - 46, tx + 40]) {
    c.rect(st, 206, 14, 3, P.wood[3]);
    c.rect(st + 1, 209, 2, 19, P.wood[1]);
    c.rect(st + 11, 209, 2, 19, P.wood[1]);
  }
  // teapot and cups on the table
  c.box(tx - 14, 174, 10, 10, 3, (x, y, u) => rampAt([0xc8c8d8, 0xe8e8f0, 0xffffff], 0.3 + u * 0.6, x, y));
  c.set(tx - 10, 177, 0x3060c0);
  c.set(tx - 9, 178, 0x3060c0);
  c.rect(tx + 8, 179, 5, 5, 0xe8e8f0);
  c.rect(tx + 16, 179, 5, 5, 0xe8e8f0);
  // fridge ZIL
  const fx = A.fridgeX;
  c.box(fx - 16, 132, 32, 96, 6, (x, y, u) => rampAt(P.appliance, 0.42 + u * 0.4 - (y - 132) / 400, x, y));
  c.rect(fx + 10, 160, 3, 18, P.metal[3]);
  c.hline(fx - 10, fx + 10, 140, P.metal[3]);
  c.rect(fx - 6, 145, 12, 3, P.metal[2]);
  c.rect(fx - 12, 122, 24, 10, P.cardboard[2]);
  c.rect(fx - 10, 124, 20, 1, P.cardboard[0]);

  // --- living room
  // wall carpet — the iconic ковёр
  const kx = A.carpetX;
  c.rect(kx - 60, 64, 120, 80, (x, y) => {
    const lx = x - (kx - 60), ly = y - 64;
    const border = lx < 6 || lx > 113 || ly < 6 || ly > 73;
    const d = Math.abs(lx - 60) / 54 + Math.abs(ly - 40) / 34;
    const medallion = d < 0.55;
    const ring = Math.abs(d - 0.75) < 0.06;
    const pat = ((lx + ly) % 6 === 0) || ((lx - ly + 300) % 6 === 0);
    if (border) return (lx + ly) % 4 < 2 ? P.carpetGold[1] : P.carpet[0];
    if (medallion) return rampAt(P.carpet, pat ? 0.85 : 0.6, x, y);
    if (ring) return P.carpetGold[2];
    return rampAt(P.carpet, pat ? 0.55 : 0.32, x, y);
  });
  for (let x = kx - 60; x < kx + 60; x += 2) c.vline(x, 144, 146, P.carpetGold[1]);
  // sofa
  c.box(kx - 58, 186, 116, 42, 5, (x, y, u, v) => rampAt(P.coatBrown, 0.4 + u * 0.2 - v * 0.15 + ((x % 14) === 0 ? -0.1 : 0), x, y));
  c.box(kx - 54, 196, 108, 12, 3, (x, y) => rampAt(P.coatBrown, 0.6 + (hash(x, y) - 0.5) * 0.06, x, y));
  c.box(kx - 64, 192, 10, 36, 3, (x, y) => rampAt(P.coatBrown, 0.3, x, y));
  c.box(kx + 54, 192, 10, 36, 3, (x, y) => rampAt(P.coatBrown, 0.55, x, y));
  // TV on a stand with rabbit-ear antenna
  const tvx = A.tvX;
  c.rect(tvx - 20, 196, 40, 32, (x, y) => rampAt(P.wood, 0.45 + (x === tvx ? -0.2 : 0), x, y));
  c.box(tvx - 22, 158, 44, 38, 3, (x, y, u) => rampAt(P.wood.map((v) => darken(v, 0.2)), 0.35 + u * 0.3, x, y));
  c.box(tvx - 18, 162, 30, 28, 5, (x, y, u, v) => rampAt([0x1a2030, 0x2a3448, 0x3e4c66, 0x5a6c8a], 0.25 + u * 0.3 - v * 0.2, x, y));
  c.set(tvx - 12, 167, 0x8aa0c0);
  c.set(tvx - 11, 167, 0x8aa0c0);
  for (let i = 0; i < 3; i++) c.disc(tvx + 17, 168 + i * 7, 1.5, P.metal[3]);
  c.line(tvx, 158, tvx - 12, 136, P.metal[3]);
  c.line(tvx, 158, tvx + 10, 134, P.metal[3]);
  // family photo frame above the TV
  c.rect(tvx - 9, 112, 18, 22, P.wood[3]);
  c.rect(tvx - 7, 114, 14, 18, (x, y) => rampAt([0x6a5a48, 0x8a7a64, 0xb0a084, 0xd0c4a8], 0.3 + (y - 114) / 18 * 0.4, x, y));
  c.disc(tvx - 3, 120, 2, P.skin[3]);
  c.disc(tvx + 2, 120, 2, P.skin[3]);
  c.disc(tvx, 125, 1.5, P.skin[3]);
  c.set(tvx + 2, 117, P.hairGinger[2]);
  c.set(tvx, 123, P.hairGinger[3]);
  // floor lamp
  c.rect(426, 150, 2, 78, P.metal[2]);
  c.poly([[418, 150], [436, 150], [432, 136], [422, 136]], (x, y) => rampAt([0x8a5a30, 0xc88a40, 0xf0b860], 0.3 + (x - 418) / 18 * 0.6, x, y));
  // ceiling lamp shades
  for (const lx of [100, 290, 520]) {
    c.vline(lx, CEIL, CEIL + 10, P.ink);
    c.poly([[lx - 10, CEIL + 18], [lx + 10, CEIL + 18], [lx + 5, CEIL + 10], [lx - 5, CEIL + 10]], (x, y) => rampAt([0x8a3a2a, 0xc8603a, 0xf0a050, 0xffd080], 0.4 + (x - lx + 10) / 20 * 0.4, x, y));
  }
  // overall soft vignetting at the floor edge
  for (let y = 258; y < 270; y++) for (let x = 0; x < W; x++) c.set(x, y, mix(c.get(x, y), 0x0d0f1e, (y - 258) / 30));
  void GROUND_Y;
  return c;
}

/** Moving boxes (interactable). */
export function drawBoxes(): PixelCanvas {
  const c = new PixelCanvas(48, 44);
  const box = (x: number, y: number, w: number, h: number) => {
    c.rect(x, y, w, h, (xx, yy) => rampAt(P.cardboard, 0.35 + (xx - x) / w * 0.35 + (hash(xx, yy) - 0.5) * 0.06, xx, yy));
    c.rect(x, y, w, 2, P.cardboard[4]);
    c.rect(x + w / 2 - 2, y, 4, h, (xx, yy) => rampAt([0xa89a70, 0xc8ba90, 0xe0d4ac], 0.5 + (hash(xx, yy) - 0.5) * 0.2, xx, yy));
  };
  box(2, 18, 24, 26);
  box(24, 22, 22, 22);
  box(8, 2, 20, 16);
  c.hline(30, 40, 30, 0x2a2a3a);
  c.hline(30, 38, 33, 0x2a2a3a);
  c.outline((n) => darken(n, 0.7));
  return c;
}

/** Bread crust (item) on a plate. */
export function drawBread(): PixelCanvas {
  const c = new PixelCanvas(14, 8);
  c.ellipse(7, 6, 6.5, 1.8, (x, y) => rampAt([0xb8b8c8, 0xe0e0ea, 0xffffff], 0.6, x, y));
  c.ellipse(7, 4, 4.5, 2.5, (x, y, nx, ny) => rampAt([0x6a3a1a, 0x9a5a28, 0xc8843c, 0xe8b070], 0.5 + nx * 0.2 - ny * 0.3, x, y));
  return c;
}

/** Apartment key on a ribbon. */
export function drawKey(): PixelCanvas {
  const c = new PixelCanvas(8, 12);
  c.vline(3, 0, 4, 0xc03030);
  c.ellipse(3.5, 6, 2.5, 2.5, (x, y, nx) => rampAt(P.windowWarm, 0.5 + nx * 0.3, x, y));
  c.set(3, 6, P.ink);
  c.vline(3, 8, 11, P.windowWarm[2]);
  c.set(4, 10, P.windowWarm[2]);
  return c;
}
