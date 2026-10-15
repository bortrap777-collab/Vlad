/**
 * Minimal software rasterizer for authored pixel art.
 * Everything is drawn at 1:1 pixel scale — no anti-aliasing, no smooth gradients.
 */
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';

export type RGB = number; // 0xRRGGBB

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Ordered-dither threshold in [0,1) for a pixel. */
export function bayer(x: number, y: number): number {
  return (BAYER4[y & 3][x & 3] + 0.5) / 16;
}

/** Deterministic hash noise in [0,1). */
export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 100000) / 100000;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Pick from a colour ramp (dark → light) with dithering between steps. */
export function rampAt(ramp: readonly RGB[], v: number, x: number, y: number): RGB {
  const t = Math.max(0, Math.min(0.9999, v)) * (ramp.length - 1);
  const i = Math.floor(t);
  const f = t - i;
  if (i >= ramp.length - 1) return ramp[ramp.length - 1];
  // only dither a narrow band around the step to keep clusters clean
  const d = f < 0.35 ? 0 : f > 0.65 ? 1 : bayer(x, y) < (f - 0.35) / 0.3 ? 1 : 0;
  return ramp[i + d];
}

export class PixelCanvas {
  readonly data: Uint8ClampedArray;
  constructor(public readonly w: number, public readonly h: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  alphaAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }

  get(x: number, y: number): RGB {
    const i = (y * this.w + x) * 4;
    return (this.data[i] << 16) | (this.data[i + 1] << 8) | this.data[i + 2];
  }

  set(x: number, y: number, c: RGB, a = 1): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inBounds(x, y)) return;
    const i = (y * this.w + x) * 4;
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    if (a >= 1 || this.data[i + 3] === 0) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = Math.round(Math.min(1, a) * 255);
      return;
    }
    const da = this.data[i + 3] / 255;
    const oa = a + da * (1 - a);
    this.data[i] = Math.round((r * a + this.data[i] * da * (1 - a)) / oa);
    this.data[i + 1] = Math.round((g * a + this.data[i + 1] * da * (1 - a)) / oa);
    this.data[i + 2] = Math.round((b * a + this.data[i + 2] * da * (1 - a)) / oa);
    this.data[i + 3] = Math.round(oa * 255);
  }

  clear(x: number, y: number): void {
    if (!this.inBounds(x, y)) return;
    this.data[(y * this.w + x) * 4 + 3] = 0;
  }

  rect(x: number, y: number, w: number, h: number, c: RGB | ((x: number, y: number) => RGB | null), a = 1): void {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
        const col = typeof c === 'function' ? c(xx, yy) : c;
        if (col !== null) this.set(xx, yy, col, a);
      }
  }

  hline(x0: number, x1: number, y: number, c: RGB, a = 1): void {
    for (let x = Math.round(Math.min(x0, x1)); x <= Math.round(Math.max(x0, x1)); x++) this.set(x, y, c, a);
  }

  vline(x: number, y0: number, y1: number, c: RGB, a = 1): void {
    for (let y = Math.round(Math.min(y0, y1)); y <= Math.round(Math.max(y0, y1)); y++) this.set(x, y, c, a);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGB | ((x: number, y: number) => RGB), a = 1): void {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, typeof c === 'function' ? c(x0, y0) : c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** Thick stroke made of stamped discs. */
  stroke(x0: number, y0: number, x1: number, y1: number, r: number, c: (x: number, y: number, t: number) => RGB): void {
    const len = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    const steps = Math.ceil(len * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
      this.disc(cx, cy, r, (x, y) => c(x, y, t));
    }
  }

  disc(cx: number, cy: number, r: number, c: RGB | ((x: number, y: number) => RGB)): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r * r + 0.25) this.set(x, y, typeof c === 'function' ? c(x, y) : c);
      }
  }

  /**
   * Ellipse filled by a shader receiving normalised coords (nx, ny in -1..1).
   */
  ellipse(cx: number, cy: number, rx: number, ry: number, shader: (x: number, y: number, nx: number, ny: number) => RGB | null): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) {
          const c = shader(x, y, nx, ny);
          if (c !== null) this.set(x, y, c);
        }
      }
  }

  /** Superellipse-ish rounded box with shader. */
  box(x: number, y: number, w: number, h: number, r: number, shader: (x: number, y: number, u: number, v: number) => RGB | null): void {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
        const lx = xx - x, ly = yy - y;
        const cx = lx < r ? r - lx - 0.5 : lx > w - r ? lx - (w - r) + 0.5 : 0;
        const cy = ly < r ? r - ly - 0.5 : ly > h - r ? ly - (h - r) + 0.5 : 0;
        if (cx * cx + cy * cy > r * r) continue;
        const c = shader(xx, yy, (lx + 0.5) / w, (ly + 0.5) / h);
        if (c !== null) this.set(xx, yy, c);
      }
  }

  /** Polygon fill (even-odd) with shader. */
  poly(pts: [number, number][], shader: RGB | ((x: number, y: number) => RGB | null)): void {
    const ys = pts.map((p) => p[1]);
    const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) {
          const c = typeof shader === 'function' ? shader(x, y) : shader;
          if (c !== null) this.set(x, y, c);
        }
    }
  }

  /**
   * Selective outline: transparent pixels touching opaque ones get a darkened
   * version of the neighbour colour (or a fixed colour).
   */
  outline(colorFor: (neighbour: RGB) => RGB, diagonal = false): void {
    const src = new Uint8ClampedArray(this.data);
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < this.w && y < this.h && src[(y * this.w + x) * 4 + 3] > 127;
    const col = (x: number, y: number) => {
      const i = (y * this.w + x) * 4;
      return (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
    };
    const n4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const n8: [number, number][] = diagonal ? [...n4, [1, 1], [-1, -1], [1, -1], [-1, 1]] : n4;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (at(x, y)) continue;
        for (const [dx, dy] of n8) {
          if (at(x + dx, y + dy)) {
            this.set(x, y, colorFor(col(x + dx, y + dy)));
            break;
          }
        }
      }
  }

  /** Draw another canvas onto this one. */
  blit(src: PixelCanvas, dx: number, dy: number, flipX = false, alpha = 1): void {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        const a = src.data[i + 3];
        if (!a) continue;
        const tx = flipX ? dx + src.w - 1 - x : dx + x;
        this.set(tx, dy + y, (src.data[i] << 16) | (src.data[i + 1] << 8) | src.data[i + 2], (a / 255) * alpha);
      }
  }

  /** Multiply colours in a region toward a tint (used for night variants, shadows). */
  tint(fn: (x: number, y: number, c: RGB) => RGB): void {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        if (!this.data[i + 3]) continue;
        const c = fn(x, y, (this.data[i] << 16) | (this.data[i + 1] << 8) | this.data[i + 2]);
        this.data[i] = (c >> 16) & 255;
        this.data[i + 1] = (c >> 8) & 255;
        this.data[i + 2] = c & 255;
      }
  }

  scaled(k: number): PixelCanvas {
    const out = new PixelCanvas(this.w * k, this.h * k);
    for (let y = 0; y < out.h; y++)
      for (let x = 0; x < out.w; x++) {
        const si = (Math.floor(y / k) * this.w + Math.floor(x / k)) * 4;
        const di = (y * out.w + x) * 4;
        out.data[di] = this.data[si];
        out.data[di + 1] = this.data[si + 1];
        out.data[di + 2] = this.data[si + 2];
        out.data[di + 3] = this.data[si + 3];
      }
    return out;
  }

  savePNG(path: string): void {
    const png = new PNG({ width: this.w, height: this.h });
    png.data = Buffer.from(this.data.buffer);
    writeFileSync(path, PNG.sync.write(png));
  }
}

/** Pack frames horizontally into one spritesheet. */
export function packStrip(frames: PixelCanvas[]): PixelCanvas {
  const fw = frames[0].w, fh = frames[0].h;
  const sheet = new PixelCanvas(fw * frames.length, fh);
  frames.forEach((f, i) => sheet.blit(f, i * fw, 0));
  return sheet;
}

export function darken(c: RGB, k: number): RGB {
  return mix(c, 0x0d0f1e, k);
}

export function lighten(c: RGB, k: number): RGB {
  return mix(c, 0xffffff, k);
}
