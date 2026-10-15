/**
 * Parametric, authored pixel-art character renderer.
 * Characters are drawn in 3/4 view facing right (mirrored in-engine when walking left —
 * all designs are kept left/right symmetric so mirroring stays correct), plus a front view
 * used for turning.
 */
import { PixelCanvas, rampAt, hash, mix, darken, type RGB } from './raster';
import { P, type Ramp } from './palette';

export type Build = 'kid' | 'teen' | 'adult' | 'old' | 'big';
export type HairStyle = 'messy' | 'long' | 'punk' | 'short' | 'perm' | 'bald' | 'cropped';
export type Hat = 'none' | 'ushanka' | 'pompom' | 'petushok' | 'beanie' | 'kepka' | 'kerchief' | 'militia';
export type Top = 'tracksuit' | 'puffer' | 'coat' | 'leather' | 'alaska' | 'robe' | 'sweater' | 'greatcoat' | 'vatnik' | 'sports';
export type Bottom = 'trackpants' | 'puffer' | 'pants' | 'skirt' | 'sweatpants' | 'valenki';
export type Expr = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised';

export interface CharSpec {
  id: string;
  build: Build;
  skin: Ramp;
  hair: Ramp;
  hairStyle: HairStyle;
  eyes: RGB;
  hat: Hat;
  hatRamp?: Ramp;
  hatRamp2?: Ramp;
  top: Top;
  topRamp: Ramp;
  bottom: Bottom;
  bottomRamp: Ramp;
  shoes: Ramp;
  hands?: Ramp; // mittens/gloves; skin if absent
  backpack?: Ramp;
  scarf?: Ramp;
  freckles?: boolean;
  mustache?: boolean;
  stubble?: boolean;
  glasses?: boolean;
  wrinkles?: boolean;
  earrings?: boolean;
}

interface Dim {
  leg: number;
  torso: number;
  torsoW: number;
  headR: number;
  arm: number;
  limb: number;
}

const DIMS: Record<Build, Dim> = {
  kid: { leg: 13, torso: 16, torsoW: 15, headR: 11, arm: 13, limb: 2.2 },
  teen: { leg: 17, torso: 18, torsoW: 15, headR: 10, arm: 15, limb: 2.2 },
  adult: { leg: 23, torso: 23, torsoW: 17, headR: 9.5, arm: 18, limb: 2.5 },
  old: { leg: 17, torso: 22, torsoW: 20, headR: 9.5, arm: 16, limb: 2.6 },
  big: { leg: 15, torso: 18, torsoW: 19, headR: 10.5, arm: 14, limb: 2.8 },
};

export interface Pose {
  bob?: number;
  lean?: number;
  legF?: [number, number]; // foot dx, lift
  legB?: [number, number];
  armF?: [number, number]; // hand offset from shoulder
  armB?: [number, number];
  front?: boolean;
  eyes?: 'open' | 'closed' | 'wide' | 'squint';
  mouth?: 'closed' | 'open' | 'smile' | 'frown' | 'o' | 'grit';
  brows?: 'neutral' | 'angry' | 'worried' | 'up';
  sit?: boolean;
  kneel?: boolean;
  headTilt?: number;
}

export const FRAME_W = 48;
export const FRAME_H = 80;
const FEET = 77;

function limbShade(ramp: Ramp, off: number): RGB {
  // off: signed perpendicular-ish offset; negative = shadow side
  if (off < -0.9) return ramp[1];
  if (off > 1.0) return ramp[3];
  return ramp[2];
}

/** Draw a limb as a thick stroke, shaded on the back side. */
function limb(c: PixelCanvas, x0: number, y0: number, x1: number, y1: number, r: number, ramp: Ramp, stripe?: Ramp) {
  c.stroke(x0, y0, x1, y1, r, (x, _y, t) => {
    const lx = x0 + (x1 - x0) * t;
    return limbShade(ramp, x - lx);
  });
  if (stripe) {
    c.line(x0 + r - 0.6, y0 + 1, x1 + r - 0.6, y1 - 1, (x, y) => (hash(x, y, 3) > 0.15 ? stripe[1] : stripe[0]));
  }
}

function shoe(c: PixelCanvas, x: number, y: number, ramp: Ramp, dir: number, big = false) {
  const rx = big ? 4.2 : 3.6;
  c.ellipse(x + dir * 1.5, y - 1.6, rx, 2.4, (px, py, nx, ny) => {
    if (ny > 0.55) return ramp[0];
    return rampAt(ramp, 0.55 + nx * dir * 0.25 - ny * 0.3, px, py);
  });
  // sole highlight
  c.hline(x + dir * 1.5 - rx + 1, x + dir * 1.5 + rx - 1, Math.round(y), mix(ramp[0], P.white, 0.15));
}

function torsoShader(spec: CharSpec, ramp: Ramp, front: boolean) {
  return (x: number, y: number, u: number, v: number): RGB => {
    let val = front ? 0.55 - Math.abs(u - 0.55) * 0.8 - v * 0.15 : 0.22 + u * 0.62 - v * 0.18;
    if (spec.top === 'puffer' || spec.top === 'alaska') {
      // quilting bands
      const band = (y % 5) === 0;
      if (band) val -= 0.28;
      val += 0.08 * Math.sin(((y % 5) / 5) * Math.PI);
    }
    if (spec.top === 'leather') val += hash(x, y, 7) > 0.92 ? 0.25 : 0;
    if (spec.top === 'vatnik' && (x % 3 === 0)) val -= 0.18;
    return rampAt(ramp, val, x, y);
  };
}

/** Draw the head (face, hair, hat). Works at any radius — used for sprites and portraits. */
export function drawHead(c: PixelCanvas, spec: CharSpec, hx: number, hy: number, R: number, pose: Pose, expr: Expr = 'neutral') {
  const front = !!pose.front;
  const s = R / 11; // feature scale
  const hairR = spec.hair;
  const hatR = spec.hatRamp ?? P.furBrown;

  // ---------- back layers ----------
  if (spec.hairStyle === 'long') {
    // long hair behind, falling to shoulders
    c.poly(
      [
        [hx - R * 1.05, hy - R * 0.4],
        [hx + R * 0.95, hy - R * 0.5],
        [hx + R * 1.12, hy + R * 1.35],
        [hx + R * 0.7, hy + R * 1.6],
        [hx - R * 0.3, hy + R * 1.7],
        [hx - R * 1.2, hy + R * 1.45],
      ],
      (x, y) => rampAt(hairR, 0.3 + ((x - hx) / R) * 0.25 + (hash(x >> 0, 0, 2) - 0.5) * 0.25 - ((y - hy) / R) * 0.1, x, y),
    );
  }
  if (spec.hairStyle === 'punk') {
    c.poly(
      [
        [hx - R * 1.15, hy - R * 0.5],
        [hx + R * 0.9, hy - R * 0.6],
        [hx + R * 1.1, hy + R * 0.7],
        [hx + R * 0.8, hy + R * 0.95],
        [hx + R * 0.5, hy + R * 0.75],
        [hx - R * 0.1, hy + R * 1.05],
        [hx - R * 0.6, hy + R * 0.85],
        [hx - R * 1.25, hy + R * 1.0],
      ],
      (x, y) => rampAt(hairR, 0.25 + ((x - hx) / R) * 0.25 + (hash(x, 0, 5) - 0.5) * 0.3, x, y),
    );
  }
  if (spec.hairStyle === 'perm') {
    for (let i = 0; i < 14; i++) {
      const a = Math.PI * (0.95 + (i / 13) * 1.1);
      const rr = R * (1.02 + 0.12 * Math.sin(i * 2.3));
      c.disc(hx + Math.cos(a) * rr * 0.95, hy - R * 0.1 + Math.sin(a) * rr * 0.9, R * 0.42, (x, y) => rampAt(hairR, 0.35 + ((x - hx) / R) * 0.2 + (hash(x, y, 9) - 0.5) * 0.35, x, y));
    }
    c.disc(hx - R * 0.95, hy + R * 0.55, R * 0.45, (x, y) => rampAt(hairR, 0.3 + (hash(x, y, 9) - 0.5) * 0.3, x, y));
  }
  if (spec.hat === 'ushanka' && !front) {
    // back ear flap
    c.box(hx - R * 1.18, hy - R * 0.55, R * 0.66, R * 1.12, R * 0.28, (x, y, u, v) => rampAt(hatR, 0.2 + u * 0.35 - v * 0.15 + (hash(x, y, 4) - 0.5) * 0.25, x, y));
  }
  if (spec.hat === 'kerchief') {
    c.ellipse(hx - R * 0.05, hy - R * 0.05, R * 1.22, R * 1.2, (x, y, nx, ny) => rampAt(hatR, 0.45 + nx * 0.25 - ny * 0.2, x, y));
    // knot under chin and tails
    c.disc(hx + R * 0.15, hy + R * 1.05, R * 0.3, (x, y) => rampAt(hatR, 0.5 + (hash(x, y) - 0.5) * 0.3, x, y));
  }

  // ---------- face ----------
  const sk = spec.skin;
  c.ellipse(hx, hy, R, R * 0.96, (x, y, nx, ny) => {
    const lx = front ? -Math.abs(nx) * 0.3 : nx * 0.32;
    let v = 0.62 + lx - ny * 0.12;
    if (nx * nx + ny * ny > 0.78 && (front || nx < 0)) v -= 0.22;
    if (ny > 0.55) v -= 0.12;
    return rampAt(sk, v, x, y);
  });
  // chin bump in 3/4
  if (!front) c.ellipse(hx + R * 0.35, hy + R * 0.62, R * 0.45, R * 0.32, (x, y, nx) => rampAt(sk, 0.55 + nx * 0.2, x, y));

  // ear (3/4 view, visible on the back side)
  const showEar = spec.hat !== 'ushanka' && spec.hat !== 'kerchief' && spec.hairStyle !== 'long' && spec.hairStyle !== 'perm' && spec.hairStyle !== 'punk';
  if (showEar && !front) {
    c.ellipse(hx - R * 0.5, hy + R * 0.12, R * 0.2, R * 0.28, (x, y, nx) => rampAt(sk, 0.42 + nx * 0.25, x, y));
    c.set(hx - R * 0.5, hy + R * 0.15, sk[1]);
  }
  if (spec.earrings && !front) c.set(hx - R * 0.48, hy + R * 0.48, P.windowWarm[3]);

  // ---------- front hair ----------
  const hairShade = (x: number, y: number, base: number) => rampAt(hairR, base + ((x - hx) / R) * (front ? 0 : 0.25) + (hash(x, 0, 1) - 0.5) * 0.3 - ((y - hy) / R) * 0.1, x, y);
  switch (spec.hairStyle) {
    case 'messy': {
      // spiky ginger fringe
      // hair mass under the hat
      c.ellipse(hx - R * 0.05, hy - R * 0.62, R * 1.0, R * 0.32, (x, y) => hairShade(x, y, 0.5));
      const spikes = front ? [-0.75, -0.42, -0.1, 0.22, 0.55, 0.82] : [-0.55, -0.25, 0.05, 0.35, 0.62, 0.88];
      spikes.forEach((sx, k) => {
        const bx = hx + sx * R;
        const tip = hy - R * (k % 2 ? 0.14 : 0.02) + hash(Math.round(sx * 10), 1) * R * 0.08;
        c.poly([[bx - R * 0.2, hy - R * 0.62], [bx + R * 0.22, hy - R * 0.62], [bx + (front ? 0 : R * 0.12), tip]], (x, y) => hairShade(x, y, 0.66 - (y - (hy - R * 0.6)) / R * 0.4));
      });
      // sideburn tufts
      if (!front) c.poly([[hx - R * 0.75, hy - R * 0.4], [hx - R * 0.45, hy - R * 0.4], [hx - R * 0.55, hy + R * 0.25]], (x, y) => hairShade(x, y, 0.4));
      if (spec.hat === 'none') c.ellipse(hx - R * 0.1, hy - R * 0.55, R * 1.02, R * 0.55, (x, y, nx) => (y < hy - R * 0.35 || nx < -0.6 ? hairShade(x, y, 0.5) : null));
      break;
    }
    case 'long': {
      c.ellipse(hx, hy - R * 0.5, R * 1.04, R * 0.58, (x, y, nx, ny) => (ny < 0.35 || Math.abs(nx) > 0.8 ? hairShade(x, y, 0.62 - ny * 0.2) : null));
      // fringe
      const fr = front ? [-0.6, -0.25, 0.1, 0.45] : [-0.35, 0.0, 0.35, 0.68];
      for (const sx of fr) {
        const bx = hx + sx * R;
        c.poly([[bx - R * 0.24, hy - R * 0.5], [bx + R * 0.24, hy - R * 0.5], [bx + R * 0.04, hy - R * 0.05]], (x, y) => hairShade(x, y, 0.7));
      }
      // locks in front of the far cheek
      if (front) {
        c.poly([[hx - R * 1.02, hy - R * 0.3], [hx - R * 0.72, hy - R * 0.3], [hx - R * 0.8, hy + R * 1.3], [hx - R * 1.1, hy + R * 1.2]], (x, y) => hairShade(x, y, 0.55));
        c.poly([[hx + R * 1.02, hy - R * 0.3], [hx + R * 0.72, hy - R * 0.3], [hx + R * 0.8, hy + R * 1.3], [hx + R * 1.1, hy + R * 1.2]], (x, y) => hairShade(x, y, 0.65));
      } else {
        c.poly([[hx + R * 0.82, hy - R * 0.35], [hx + R * 1.06, hy - R * 0.3], [hx + R * 1.08, hy + R * 1.25], [hx + R * 0.78, hy + R * 1.05]], (x, y) => hairShade(x, y, 0.68));
        c.poly([[hx - R * 1.05, hy - R * 0.4], [hx - R * 0.65, hy - R * 0.35], [hx - R * 0.75, hy + R * 1.0], [hx - R * 1.12, hy + R * 1.2]], (x, y) => hairShade(x, y, 0.45));
      }
      break;
    }
    case 'punk': {
      c.ellipse(hx - R * 0.05, hy - R * 0.5, R * 1.08, R * 0.62, (x, y, nx, ny) => (ny < 0.3 || nx < -0.55 ? hairShade(x, y, 0.45 - ny * 0.15) : null));
      // asymmetric choppy fringe sweeping over one eye
      c.poly([[hx - R * 0.6, hy - R * 0.62], [hx + R * 0.95, hy - R * 0.55], [hx + R * 0.7, hy - R * 0.05], [hx + R * 0.45, hy - R * 0.25], [hx + R * 0.2, hy + R * 0.02], [hx - R * 0.1, hy - R * 0.3], [hx - R * 0.45, hy - R * 0.1]], (x, y) => hairShade(x, y, 0.5));
      // spiky top
      for (const sx of [-0.7, -0.3, 0.1, 0.5]) {
        const bx = hx + sx * R;
        c.poly([[bx - R * 0.25, hy - R * 0.85], [bx + R * 0.25, hy - R * 0.85], [bx - R * 0.05, hy - R * 1.3]], (x, y) => hairShade(x, y, 0.55));
      }
      // red streak
      c.line(hx + R * 0.2, hy - R * 0.9, hx + R * 0.5, hy - R * 0.2, 0xa0303e);
      break;
    }
    case 'short':
      if (spec.hat === 'none' || R > 14) c.ellipse(hx - R * 0.05, hy - R * 0.5, R * 1.03, R * 0.6, (x, y, nx, ny) => (ny < 0.15 || nx < -0.65 ? hairShade(x, y, 0.5 - ny * 0.1) : null));
      if (!front) c.poly([[hx - R * 0.2, hy - R * 0.7], [hx + R * 0.85, hy - R * 0.55], [hx + R * 0.55, hy - R * 0.25], [hx - R * 0.1, hy - R * 0.38]], (x, y) => hairShade(x, y, 0.55));
      break;
    case 'cropped':
      c.ellipse(hx - R * 0.05, hy - R * 0.45, R * 1.02, R * 0.6, (x, y, nx, ny) => (ny < -0.05 || nx < -0.7 ? rampAt(hairR, 0.45 + nx * 0.2 + (hash(x, y, 3) - 0.5) * 0.4, x, y) : null));
      break;
    case 'perm':
      for (let i = 0; i < 6; i++) c.disc(hx - R * 0.65 + i * R * 0.3, hy - R * 0.72 + (i % 2) * R * 0.08, R * 0.3, (x, y) => rampAt(hairR, 0.5 + (hash(x, y, 9) - 0.5) * 0.35, x, y));
      break;
    case 'bald':
      break;
  }

  // ---------- features ----------
  const eyeY = hy + R * 0.12;
  const ew = Math.max(2, Math.round(2.6 * s));
  const eh = Math.max(3, Math.round(3.6 * s));
  const eyes = pose.eyes ?? 'open';
  const iris = spec.eyes;
  const irisDark = darken(iris, 0.45);
  const lash = P.outline;
  const sclera = mix(P.white, sk[3], 0.18);
  const drawEye = (ex: number, w: number, white: -1 | 0 | 1 = 0) => {
    ex = Math.round(ex);
    const ey = Math.round(eyeY - eh / 2);
    if (eyes === 'closed' || (expr === 'happy' && R > 14)) {
      // closed / smiling arc
      for (let i = 0; i < w + 1; i++) c.set(ex + i, ey + Math.round(eh * 0.55) - (i > 0 && i < w ? 1 : 0), lash);
      return;
    }
    const h = eyes === 'squint' ? Math.max(2, eh - 2) : eyes === 'wide' ? eh + 1 : eh;
    const top = eyes === 'squint' ? ey + 1 : ey - (eyes === 'wide' ? 1 : 0);
    c.rect(ex, top, w, h, (_x, y) => {
      const ty = (y - top) / h;
      if (ty < 0.34) return irisDark;
      return mix(iris, P.white, ty > 0.75 ? 0.15 : 0);
    });
    // white of the eye on the side away from the gaze (big expressive eyes like the reference)
    if (white !== 0) {
      const sx = white < 0 ? ex - 1 : ex + w;
      c.rect(sx, top + 1, R > 14 ? 1 : 1, h - 1, sclera);
      c.set(sx, top + h - 1, mix(sclera, sk[2], 0.4));
      c.set(sx, top - 1, lash);
    }
    // pupil
    if (R > 14) c.rect(ex + Math.floor(w / 2) - 1 + 1, top + Math.round(h * 0.35), Math.max(1, Math.round(w / 2.6)), Math.max(1, Math.round(h * 0.4)), P.ink);
    // lash line, slightly longer on the outer side
    c.hline(ex - (R > 14 ? 1 : 0), ex + w - 1 + (front ? 0 : 1), top - 1, lash);
    // highlight
    c.set(ex + w - 1, top + 1, P.white);
    if (R > 14) c.set(ex + 1, top + h - 2, mix(iris, P.white, 0.6));
  };
  if (front) {
    drawEye(hx - R * 0.42 - ew / 2 + 0.5, ew, -1);
    drawEye(hx + R * 0.42 - ew / 2 + 0.5, ew, 1);
  } else {
    drawEye(hx + R * 0.36 - ew / 2 + 1, ew, -1);
    drawEye(hx - R * 0.28 - (ew - 1) / 2, Math.max(2, ew - 1));
  }

  // brows
  const brows = pose.brows ?? (expr === 'angry' ? 'angry' : expr === 'sad' ? 'worried' : expr === 'surprised' ? 'up' : 'neutral');
  const browC = darken(hairR[1], 0.2);
  const browY = Math.round(eyeY - eh / 2 - 2.6 * s - (brows === 'up' ? s : 0));
  const browAt = (bx: number, w: number, inner: 'left' | 'right') => {
    for (let i = 0; i < w; i++) {
      let dy = 0;
      const tIn = inner === 'left' ? 1 - i / Math.max(1, w - 1) : i / Math.max(1, w - 1);
      if (brows === 'angry') dy = Math.round(tIn * 1.6 * s);
      if (brows === 'worried') dy = -Math.round(tIn * 1.4 * s);
      c.set(Math.round(bx) + i, browY + dy, browC);
      if (R > 14) c.set(Math.round(bx) + i, browY + dy + 1, browC);
    }
  };
  if (spec.hat !== 'ushanka' || R > 14 || spec.hairStyle === 'bald') {
    if (front) {
      browAt(hx - R * 0.42 - ew / 2, ew + 1, 'right');
      browAt(hx + R * 0.42 - ew / 2, ew + 1, 'left');
    } else {
      browAt(hx + R * 0.36 - ew / 2 + 1, ew + 1, 'left');
      browAt(hx - R * 0.3 - ew / 2, ew, 'right');
    }
  }

  // glasses
  if (spec.glasses) {
    const gc = 0x5a5a6e;
    const gy = Math.round(eyeY - eh / 2 - 1);
    const frame = (gx: number, w: number) => {
      gx = Math.round(gx);
      c.hline(gx - 1, gx + w, gy, gc);
      c.hline(gx - 1, gx + w, gy + eh + 1, gc);
      c.vline(gx - 1, gy, gy + eh + 1, gc);
      c.vline(gx + w, gy, gy + eh + 1, gc);
    };
    if (front) {
      frame(hx - R * 0.42 - ew / 2 + 0.5, ew);
      frame(hx + R * 0.42 - ew / 2 + 0.5, ew);
    } else {
      frame(hx + R * 0.36 - ew / 2 + 1, ew);
      c.hline(hx - R * 0.15, hx + R * 0.2, gy + 1, gc);
      c.hline(hx - R * 0.95, hx - R * 0.4, gy + 1, gc);
    }
    // tape on bridge
    c.set(hx + (front ? 0 : R * 0.02), gy + 1, P.white);
  }

  // nose
  const noseC = sk[1];
  if (front) c.set(hx, eyeY + 2.2 * s, noseC);
  else {
    c.set(hx + R * 0.86, eyeY + 2 * s, sk[2]);
    c.set(hx + R * 0.8, eyeY + 2.6 * s, noseC);
  }

  // blush & freckles
  const cheekX = front ? [hx - R * 0.55, hx + R * 0.55] : [hx + R * 0.55, hx - R * 0.45];
  for (const cx of cheekX) {
    c.set(cx, eyeY + 3 * s, P.blush, 0.55);
    c.set(cx + 1, eyeY + 3 * s, P.blush, 0.45);
    if (R > 14) {
      c.set(cx, eyeY + 3 * s + 1, P.blush, 0.35);
      c.set(cx + 1, eyeY + 3 * s + 1, P.blush, 0.3);
    }
  }
  if (spec.freckles) {
    const fr: [number, number][] = [[0.42, 0.42], [0.6, 0.48], [0.5, 0.56], [-0.4, 0.44], [-0.52, 0.52], [0.12, 0.4]];
    for (const [fx, fy] of fr) c.set(hx + fx * R + (front && fx > 0 ? -0.15 * R : 0), hy + fy * R, P.freckle);
  }
  if (spec.stubble) {
    for (let y = Math.round(hy + R * 0.45); y < hy + R * 0.95; y++)
      for (let x = Math.round(hx - R * 0.5); x < hx + R * 0.9; x++)
        if (c.alphaAt(x, y) && hash(x, y, 11) > 0.55) c.set(x, y, mix(c.get(x, y), 0x4a4250, 0.35));
  }
  if (spec.wrinkles) {
    c.set(hx + R * 0.62, eyeY + 1, sk[1]);
    c.hline(hx - R * 0.25, hx + R * 0.15, hy - R * 0.4, sk[2]);
  }

  // mouth
  const mouth = pose.mouth ?? (expr === 'happy' ? 'smile' : expr === 'sad' ? 'frown' : expr === 'surprised' ? 'o' : expr === 'angry' ? 'grit' : 'closed');
  const mx = Math.round(front ? hx - 1 : hx + R * 0.32);
  const my = Math.round(hy + R * 0.58);
  const mc = 0x6a2a32;
  const k = R > 14 ? 2 : 1;
  switch (mouth) {
    case 'closed':
      c.hline(mx, mx + k, my, mc);
      break;
    case 'smile':
      c.hline(mx, mx + 1 + k, my, mc);
      c.set(mx - 1, my - 1, mc);
      c.set(mx + 2 + k, my - 1, mc);
      if (R > 14) c.hline(mx + 1, mx + 2, my + 1, 0xc0505a);
      break;
    case 'frown':
      c.hline(mx, mx + k, my, mc);
      c.set(mx - 1, my + 1, mc);
      c.set(mx + k + 1, my + 1, mc);
      break;
    case 'open':
      c.rect(mx, my - 1, 2 + k - 1, 2 + (k - 1), mc);
      c.set(mx + 1, my + k - 0, 0xd06a70);
      break;
    case 'o':
      c.rect(mx, my - 1, 1 + k, 2 + k - 1, mc);
      break;
    case 'grit':
      c.hline(mx - 1, mx + 1 + k, my, mc);
      if (R > 14) c.hline(mx, mx + k, my - 1, P.white);
      break;
  }

  if (spec.mustache) {
    const mY = my - 1 - (R > 14 ? 1 : 0);
    c.hline(mx - 1, mx + 2 + k, mY, darken(hairR[1], 0.1));
    if (R > 14) c.hline(mx - 2, mx + 3 + k, mY - 1, hairR[1]);
  }

  // ---------- hats ----------
  const fur = (x: number, y: number, base: number) => rampAt(hatR, base + (hash(x, y, 4) - 0.5) * 0.32, x, y);
  switch (spec.hat) {
    case 'ushanka': {
      // dome
      c.ellipse(hx - R * 0.04, hy - R * 0.98, R * 1.12, R * 0.66, (x, y, nx, ny) => {
        if (y > hy - R * 0.78) return null;
        return fur(x, y, 0.3 + nx * (front ? 0 : 0.25) - ny * 0.12 - (front ? Math.abs(nx) * 0.15 : 0));
      });
      // folded front brim — lighter fur with a crisp seam
      const by0 = hy - R * 0.94, bh = R * 0.42;
      c.box(hx - R * 1.16, by0, R * 2.34, bh, R * 0.2, (x, y, u, v) => fur(x, y, (front ? 0.66 - Math.abs(u - 0.5) * 0.45 : 0.45 + u * 0.38) - v * 0.12));
      for (let x = Math.round(hx - R * 1.1); x <= hx + R * 1.1; x++) {
        if (c.alphaAt(x, Math.round(by0))) c.set(x, Math.round(by0), hatR[0]);
        const sy = Math.round(by0 + bh);
        if (c.alphaAt(x, sy)) c.set(x, sy, mix(c.get(x, sy), P.ink, 0.35));
      }
      // ear flaps
      if (front) {
        for (const side of [-1, 1]) c.box(hx + side * R * 1.0 - R * 0.3, hy - R * 0.6, R * 0.58, R * 1.18, R * 0.26, (x, y, u, v) => fur(x, y, 0.32 + (side > 0 ? u : 1 - u) * 0.22 - v * 0.1));
      } else {
        c.box(hx + R * 0.78, hy - R * 0.6, R * 0.38, R * 0.7, R * 0.18, (x, y, u) => fur(x, y, 0.45 + u * 0.3));
      }
      if (R > 14 && !front) c.line(hx - R * 0.85, hy + R * 0.62, hx - R * 0.72, hy + R * 1.0, hatR[0]);
      break;
    }
    case 'militia': {
      c.ellipse(hx - R * 0.05, hy - R * 0.62, R * 1.16, R * 0.72, (x, y, nx, ny) => {
        if (y > hy - R * 0.32) return null;
        return fur(x, y, 0.4 + nx * (front ? 0 : 0.3) - ny * 0.15 - (front ? Math.abs(nx) * 0.2 : 0));
      });
      c.box(hx - R * 1.12, hy - R * 0.72, R * 2.3, R * 0.5, R * 0.22, (x, y, u, v) => fur(x, y, (front ? 0.62 - Math.abs(u - 0.5) * 0.5 : 0.35 + u * 0.4) - v * 0.15));
      for (let x = Math.round(hx - R); x <= hx + R; x++) {
        const y = Math.round(hy - R * 0.22);
        if (c.alphaAt(x, y + 1)) c.set(x, y + 1, hatR[0], 0.55);
      }
      c.box(hx - R * 1.05, hy - R * 1.32, R * 2.1, R * 0.38, R * 0.16, (x, y, u) => fur(x, y, 0.35 + u * 0.35));
      const kx = front ? hx : hx + R * 0.35;
      c.ellipse(kx, hy - R * 0.5, R * 0.18 + 0.6, R * 0.22 + 0.6, (x, y, nx) => rampAt(P.windowWarm, 0.7 + nx * 0.2, x, y));
      c.set(kx, hy - R * 0.5, P.redBand[2]);
      break;
    }
    case 'pompom':
    case 'beanie':
    case 'petushok': {
      const knit = hatR;
      c.ellipse(hx - R * 0.02, hy - R * 0.55, R * 1.1, R * 0.82, (x, y, nx, ny) => {
        if (y > hy - R * 0.35) return null;
        const rib = (x % 2 === 0) ? -0.12 : 0.04;
        return rampAt(knit, 0.48 + nx * (front ? 0 : 0.28) - ny * 0.12 + rib, x, y);
      });
      // cuff
      c.box(hx - R * 1.12, hy - R * 0.62, R * 2.26, R * 0.36, R * 0.15, (x, y, u) => {
        const rib = (x % 2 === 0) ? -0.15 : 0.08;
        return rampAt(knit, (front ? 0.62 - Math.abs(u - 0.5) * 0.4 : 0.38 + u * 0.38) + rib, x, y);
      });
      if (spec.hat === 'petushok') {
        // the iconic 90s sports hat with a pointed top and stripe
        const tip: [number, number] = [hx - R * 0.95, hy - R * 1.6];
        c.poly([[hx - R * 0.75, hy - R * 1.0], [hx + R * 0.4, hy - R * 1.32], tip], (x, y) => rampAt(knit, 0.55 + (x % 2 === 0 ? -0.1 : 0.05), x, y));
        const r2 = spec.hatRamp2 ?? P.sweaterBlue;
        c.box(hx - R * 1.0, hy - R * 1.12, R * 2.0, R * 0.22, 1, (x, y, u) => rampAt(r2, 0.4 + u * 0.4, x, y));
        c.disc(tip[0], tip[1], R * 0.22, (x, y) => rampAt(r2, 0.5 + (hash(x, y) - 0.5) * 0.4, x, y));
      }
      if (spec.hat === 'pompom') {
        const px = front ? hx : hx + R * 0.2;
        c.disc(px, hy - R * 1.32, R * 0.42, (x, y) => rampAt(P.pompom, 0.55 + ((x - px) / R) * 0.6 - ((y - (hy - R * 1.32)) / R) * 0.6 + (hash(x, y, 8) - 0.5) * 0.35, x, y));
      }
      break;
    }
    case 'kepka': {
      c.ellipse(hx - R * 0.05, hy - R * 0.62, R * 1.1, R * 0.55, (x, y, nx, ny) => (y > hy - R * 0.38 ? null : rampAt(hatR, 0.4 + nx * 0.3 - ny * 0.1 + (y % 3 === 0 ? -0.1 : 0), x, y)));
      if (front) c.box(hx - R * 0.9, hy - R * 0.5, R * 1.8, R * 0.25, 1, (x, y) => rampAt(hatR, 0.2, x, y));
      else c.poly([[hx + R * 0.5, hy - R * 0.6], [hx + R * 1.45, hy - R * 0.42], [hx + R * 1.35, hy - R * 0.3], [hx + R * 0.5, hy - R * 0.38]], (x, y) => rampAt(hatR, 0.25, x, y));
      c.set(hx - R * 0.05, hy - R * 1.12, hatR[1]);
      break;
    }
    case 'kerchief': {
      // band over forehead + pattern
      c.ellipse(hx - R * 0.02, hy - R * 0.5, R * 1.12, R * 0.66, (x, y, nx, ny) => {
        if (y > hy - R * 0.3) return null;
        const dot = (x + y) % 4 === 0 && (x - y) % 4 === 0;
        return dot ? P.windowWarm[3] : rampAt(hatR, 0.5 + nx * 0.25 - ny * 0.15, x, y);
      });
      break;
    }
    case 'none':
      break;
  }
}

/** Full-body frame. */
export function drawCharacter(spec: CharSpec, pose: Pose = {}, expr: Expr = 'neutral'): PixelCanvas {
  const c = new PixelCanvas(FRAME_W, FRAME_H);
  const d = DIMS[spec.build];
  const cx = 24 + (pose.lean ?? 0) * 0.5;
  const front = !!pose.front;
  const bob = pose.bob ?? 0;
  const sit = !!pose.sit;
  const kneel = !!pose.kneel;
  const legLen = sit ? 4 : kneel ? d.leg * 0.55 : d.leg;
  const hipY = FEET - legLen + bob;
  const shY = hipY - d.torso + 2;
  const R = d.headR;
  const headX = cx + (pose.lean ?? 0) * 0.6 + (front ? 0 : 1);
  const headY = shY - R + 3 + (pose.headTilt ?? 0);
  const sleeve = spec.topRamp;
  const hands = spec.hands ?? spec.skin;
  const legRamp = spec.bottom === 'skirt' ? P.trackBlack : spec.bottomRamp;
  const pantStripe = spec.bottom === 'trackpants' ? P.stripe : undefined;
  const sleeveStripe = spec.top === 'tracksuit' || spec.top === 'sports' ? P.stripe : undefined;
  const limbR = d.limb + (spec.top === 'puffer' || spec.top === 'alaska' ? 0.8 : 0);
  const legR = d.limb + (spec.bottom === 'puffer' ? 0.9 : spec.bottom === 'valenki' ? 0.6 : 0.2);
  const isLongCoat = spec.top === 'greatcoat' || spec.top === 'robe' || spec.top === 'coat';

  // ---- back arm ----
  const armB = pose.armB ?? [-1, d.arm];
  const sBx = cx - d.torsoW / 2 + 3.5, sBy = shY + 3;
  if (!front) {
    limb(c, sBx, sBy, sBx + armB[0], sBy + armB[1] - 2, limbR, sleeve.map((x) => darken(x, 0.25)));
    c.disc(sBx + armB[0], sBy + armB[1] - 1, limbR + 0.3, (x, y) => rampAt(hands.map((h) => darken(h, 0.2)), 0.5 + (hash(x, y) - 0.5) * 0.2, x, y));
  }

  // ---- backpack ----
  if (spec.backpack && !front) {
    c.box(cx - d.torsoW / 2 - 4, shY + 1, 8, d.torso - 3, 3, (x, y, u, v) => rampAt(spec.backpack!, 0.25 + u * 0.4 - v * 0.15 + (hash(x, y, 2) - 0.5) * 0.12, x, y));
    c.hline(cx - d.torsoW / 2 - 3, cx - d.torsoW / 2 + 2, shY + 6, spec.backpack[0]);
    c.set(cx - d.torsoW / 2 - 1, shY + 7, P.tin[3]);
  }

  // ---- legs ----
  const legBack = pose.legB ?? [-1.5, 0];
  const legFront = pose.legF ?? [1.5, 0];
  const legs: [number, number, number, boolean][] = front
    ? [[cx - 3, -0.5, 0, false], [cx + 3, 0.5, 0, true]]
    : [[cx - 2, legBack[0], legBack[1], false], [cx + 2, legFront[0], legFront[1], true]];
  for (const [lx, dx, lift, isFront] of legs) {
    const ramp = isFront ? legRamp : legRamp.map((x) => darken(x, 0.22));
    if (sit) {
      // sitting in the snow, legs stretched forward
      limb(c, lx, hipY, lx + 9, FEET - 2, legR, ramp);
      shoe(c, lx + 10, FEET, isFront ? spec.shoes : spec.shoes.map((x) => darken(x, 0.2)), 1);
      continue;
    }
    if (kneel && isFront) {
      limb(c, lx, hipY, lx + 6, hipY + 1, legR, ramp);
      limb(c, lx + 6, hipY + 1, lx + 6, FEET - 1, legR, ramp);
      shoe(c, lx + 6, FEET, spec.shoes, 1);
      continue;
    }
    if (kneel) {
      limb(c, lx, hipY, lx - 2, FEET - 2, legR, ramp);
      limb(c, lx - 2, FEET - 2, lx - 8, FEET - 1, legR, ramp);
      continue;
    }
    const fx = lx + dx, fy = FEET - lift;
    const kneeY = spec.bottom === 'valenki' ? fy - 5 : fy - 2;
    limb(c, lx, hipY, fx, kneeY, legR, ramp, isFront ? pantStripe : undefined);
    if (spec.bottom === 'valenki') {
      c.box(fx - 3, fy - 7, 6.5, 7, 2, (x, y, u) => rampAt(P.coatGrey.map((x) => mix(x, 0x8a8aa0, 0.25)), 0.35 + u * 0.4 + (hash(x, y) - 0.5) * 0.2, x, y));
    } else {
      shoe(c, fx, fy, isFront ? spec.shoes : spec.shoes.map((x) => darken(x, 0.2)), front ? 0 : 1, spec.build === 'adult');
    }
  }

  // ---- torso ----
  const tW = d.torsoW;
  const tTop = shY;
  let tH = d.torso + (isLongCoat ? d.leg * 0.55 : spec.top === 'puffer' ? 3 : 2);
  if (sit) tH = Math.min(tH, d.torso + 1);
  const tx = cx - tW / 2;
  const shade = torsoShader(spec, spec.topRamp, front);
  if (isLongCoat) {
    // flared coat
    c.poly(
      [
        [tx + 2, tTop],
        [tx + tW - 2, tTop],
        [tx + tW + 1.5, tTop + tH],
        [tx - 1.5, tTop + tH],
      ],
      (x, y) => shade(x, y, (x - tx + 1.5) / (tW + 3), (y - tTop) / tH),
    );
    c.box(tx, tTop, tW, 8, 4, (x, y, u, v) => shade(x, y, u, v * 0.3));
  } else {
    c.box(tx, tTop, tW, tH, spec.top === 'puffer' || spec.build === 'big' || spec.build === 'old' ? 5 : 4, shade);
  }
  if (spec.bottom === 'skirt') {
    c.poly([[tx + 1, hipY - 2], [tx + tW - 1, hipY - 2], [tx + tW + 2, hipY + 6], [tx - 2, hipY + 6]], (x, y) => {
      const check = ((x >> 1) + (y >> 1)) % 3 === 0 || (x % 4 === 0);
      return rampAt(P.plaidRed, (check ? 0.25 : 0.55) + (x - tx) / tW * 0.2, x, y);
    });
  }

  // top details
  const frontEdge = front ? cx : tx + tW - 4;
  switch (spec.top) {
    case 'tracksuit':
    case 'sports':
      // zipper and collar
      c.vline(frontEdge, tTop + 2, tTop + tH - 2, mix(spec.topRamp[3], P.white, 0.2));
      c.box(front ? cx - 4 : tx + 4, tTop - 1, front ? 8 : 9, 3, 1, (x, y) => rampAt(spec.topRamp, 0.65, x, y));
      if (spec.top === 'tracksuit') {
        // white side stripes on the torso (like the reference)
        if (!front) {
          c.vline(tx + 2, tTop + 3, tTop + tH - 2, P.stripe[1]);
          c.vline(tx + 3, tTop + 3, tTop + tH - 2, P.stripe[0]);
        }
      } else {
        c.hline(tx + 1, tx + tW - 2, tTop + 7, P.stripe[1]);
      }
      // hem band
      c.hline(tx + 1, tx + tW - 2, tTop + tH - 1, spec.topRamp[0]);
      break;
    case 'puffer':
      c.vline(frontEdge, tTop + 2, tTop + tH - 2, spec.topRamp[1]);
      c.box(front ? cx - 5 : tx + 3, tTop - 2, front ? 10 : 11, 4, 2, (x, y, u) => rampAt(spec.topRamp, 0.55 + u * 0.25, x, y));
      break;
    case 'alaska':
      // fur-trimmed hood resting on the back + zip
      c.box(tx - 2, tTop - 3, 9, 6, 3, (x, y) => rampAt(P.furBrown, 0.55 + (hash(x, y, 4) - 0.5) * 0.4, x, y));
      c.vline(frontEdge, tTop + 2, tTop + tH - 2, spec.topRamp[0]);
      c.rect(frontEdge - 4, tTop + 9, 3, 1, 0xd8462e);
      break;
    case 'leather':
      c.poly([[frontEdge - 3, tTop], [frontEdge + 1, tTop], [frontEdge - 1, tTop + 7]], (x, y) => rampAt(P.plaidRed, 0.5 + ((x + y) % 3 === 0 ? -0.3 : 0), x, y));
      c.vline(frontEdge, tTop + 6, tTop + tH - 2, P.leather[3]);
      c.set(frontEdge - 3, tTop + 10, P.tin[4]);
      c.set(frontEdge - 5, tTop + 8, 0xd0d040);
      break;
    case 'greatcoat':
      for (let i = 0; i < 4; i++) c.set(frontEdge - 1, tTop + 4 + i * 5, P.windowWarm[3]);
      c.hline(tx - 1, tx + tW, tTop + d.torso - 2, P.coatBrown[1]);
      // shoulder board
      c.rect(front ? tx + 1 : tx + tW - 7, tTop, 5, 2, (x) => (x % 2 ? P.windowWarm[2] : spec.topRamp[3]));
      c.box(front ? cx - 4 : tx + 4, tTop - 2, 9, 4, 1, (x, y) => rampAt(spec.topRamp, 0.6, x, y));
      break;
    case 'coat':
      for (let i = 0; i < 3; i++) c.set(frontEdge - 1, tTop + 5 + i * 6, spec.topRamp[0]);
      c.box(front ? cx - 5 : tx + 2, tTop - 2, 11, 4, 2, (x, y) => rampAt(P.furBrown, 0.55 + (hash(x, y, 4) - 0.5) * 0.3, x, y));
      break;
    case 'robe':
      // floral pattern
      for (let y = tTop + 3; y < tTop + tH; y += 4)
        for (let x = Math.round(tx); x < tx + tW + 2; x += 4) if (c.alphaAt(x + ((y >> 2) % 2) * 2, y)) c.set(x + ((y >> 2) % 2) * 2, y, mix(spec.topRamp[4], 0xf0c0d0, 0.4));
      c.hline(tx + 1, tx + tW - 2, tTop + d.torso - 2, spec.topRamp[0]);
      break;
    case 'sweater':
      for (let x = Math.round(tx) + 1; x < tx + tW - 1; x++) {
        c.set(x, tTop + 6 + ((x % 4) < 2 ? 0 : 1), P.white);
        c.set(x, tTop + 9 + ((x % 4) < 2 ? 1 : 0), P.redBand[2]);
      }
      c.box(front ? cx - 4 : tx + 4, tTop - 1, 8, 3, 1, (x, y) => rampAt(spec.topRamp, 0.3, x, y));
      break;
    case 'vatnik':
      c.vline(frontEdge, tTop + 2, tTop + tH - 2, spec.topRamp[0]);
      c.box(front ? cx - 5 : tx + 3, tTop - 2, 10, 4, 2, (x, y) => rampAt(spec.topRamp, 0.25, x, y));
      break;
  }
  if (spec.scarf) {
    c.box(front ? cx - 6 : tx + 1, tTop - 2, front ? 12 : tW - 1, 4, 2, (x, y) => rampAt(spec.scarf!, 0.45 + (x % 3 === 0 ? -0.2 : 0.05), x, y));
    if (!front) c.box(tx + tW - 6, tTop + 1, 3, 8, 1, (x, y) => rampAt(spec.scarf!, 0.6 + (y % 3 === 0 ? -0.2 : 0), x, y));
  }

  // ---- head ----
  drawHead(c, spec, headX, headY, R, pose, expr);

  // ---- front arm ----
  const armF = pose.armF ?? [1, d.arm];
  const sFx = front ? cx + tW / 2 - 2 : cx + tW / 2 - 4.5, sFy = shY + 3;
  if (front) {
    const bx = cx - tW / 2 + 2;
    limb(c, bx, sFy, bx - 1.5, sFy + d.arm - 2, limbR, sleeve, sleeveStripe);
    c.disc(bx - 1.5, sFy + d.arm - 1, limbR + 0.3, (x, y) => rampAt(hands, 0.5 + (hash(x, y) - 0.5) * 0.2, x, y));
    limb(c, sFx, sFy, sFx + 1.5, sFy + d.arm - 2, limbR, sleeve, sleeveStripe);
    c.disc(sFx + 1.5, sFy + d.arm - 1, limbR + 0.3, (x, y) => rampAt(hands, 0.6 + (hash(x, y) - 0.5) * 0.2, x, y));
  } else {
    limb(c, sFx, sFy, sFx + armF[0], sFy + armF[1] - 2, limbR, sleeve, sleeveStripe);
    c.disc(sFx + armF[0], sFy + armF[1] - 1, limbR + 0.4, (x, y) => rampAt(hands, 0.62 + (hash(x, y) - 0.5) * 0.2, x, y));
  }

  rimLight(c);
  // selective outline
  c.outline((n) => mix(darken(n, 0.72), P.outline, 0.45));
  return c;
}

/**
 * Two-tone rim light matching the scenes: warm lamp/sunset light on the leading edge,
 * cool sky light on the back edge and on top. Applied before the outline pass.
 */
export function rimLight(c: PixelCanvas, strength = 1) {
  const W = c.w, H = c.h;
  const a = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && c.alphaAt(x, y) > 127;
  const warm = 0xffc58a, cool = 0x9db8ff;
  const snapshot: [number, number, number][] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!a(x, y)) continue;
      let k = 0, col = warm;
      if (!a(x + 1, y)) k = 0.32;
      else if (!a(x + 2, y)) k = 0.12;
      else if (!a(x - 1, y)) {
        k = 0.2;
        col = cool;
      } else if (!a(x, y - 1)) {
        k = 0.14;
        col = cool;
      }
      if (k) snapshot.push([x, y, mix(c.get(x, y), col, k * strength)]);
    }
  for (const [x, y, v] of snapshot) c.set(x, y, v);
}

/** Bust portrait 64×64 for dialogue boxes. */
export function drawPortrait(spec: CharSpec, expr: Expr): PixelCanvas {
  const c = new PixelCanvas(64, 64);
  const R = spec.build === 'adult' || spec.build === 'old' ? 15.5 : 16.5;
  const hx = 31, hy = 34;
  // shoulders
  const tr = spec.topRamp;
  c.box(8, 50, 48, 20, 10, (x, y, u) => rampAt(tr, 0.25 + u * 0.55 + (spec.top === 'puffer' && y % 5 === 0 ? -0.25 : 0), x, y));
  if (spec.top === 'tracksuit') {
    c.vline(42, 52, 63, P.stripe[1]);
    c.vline(14, 54, 63, P.stripe[1]);
    c.vline(15, 54, 63, P.stripe[0]);
    c.box(24, 48, 18, 6, 2, (x, y) => rampAt(tr, 0.62, x, y));
  }
  if (spec.top === 'greatcoat') c.rect(43, 52, 9, 3, (x) => (x % 2 ? P.windowWarm[2] : tr[3]));
  if (spec.top === 'leather') c.poly([[34, 50], [44, 50], [38, 63]], (x, y) => rampAt(P.plaidRed, 0.5 + ((x + y) % 3 === 0 ? -0.3 : 0), x, y));
  if (spec.top === 'sweater') for (let x = 10; x < 54; x++) c.set(x, 57 + ((x % 4) < 2 ? 0 : 1), P.white);
  if (spec.top === 'coat' || spec.top === 'alaska') c.box(16, 46, 30, 8, 4, (x, y) => rampAt(P.furBrown, 0.55 + (hash(x, y, 4) - 0.5) * 0.35, x, y));
  if (spec.scarf) c.box(18, 47, 30, 7, 3, (x, y) => rampAt(spec.scarf!, 0.45 + (x % 3 === 0 ? -0.2 : 0.05), x, y));
  if (spec.top === 'puffer') c.box(20, 46, 26, 7, 3, (x, y, u) => rampAt(tr, 0.55 + u * 0.25, x, y));
  if (spec.top === 'vatnik') c.box(18, 47, 28, 6, 3, (x, y) => rampAt(tr, 0.25, x, y));
  drawHead(c, spec, hx, hy, R, {}, expr);
  c.outline((n) => mix(darken(n, 0.72), P.outline, 0.45));
  return c;
}

// ---------------- animation sets ----------------

export interface AnimDef {
  key: string;
  frames: PixelCanvas[];
  fps: number;
  loop: boolean;
}

export function walkPose(i: number, n: number, d: Dim, run = false): Pose {
  const t = (i / n) * Math.PI * 2;
  const stride = run ? 4.5 : 3.2;
  const s = Math.sin(t);
  const lift = (v: number) => Math.max(0, v) * (run ? 2.5 : 1.6);
  return {
    bob: Math.round(-Math.abs(Math.cos(t)) * (run ? 1.4 : 1) + (run ? 0 : 0.4)),
    lean: run ? 2 : 0.5,
    legF: [s * stride + 1, Math.round(lift(Math.cos(t)))],
    legB: [-s * stride - 1, Math.round(lift(-Math.cos(t)))],
    armF: [-s * 3 + 1, d.arm - Math.abs(s)],
    armB: [s * 3 - 1, d.arm - Math.abs(s)],
  };
}

export function buildAnims(spec: CharSpec, extra: Record<string, { poses: Pose[]; fps: number; loop: boolean; expr?: Expr }> = {}): AnimDef[] {
  const d = DIMS[spec.build];
  const anims: AnimDef[] = [];
  const idle: PixelCanvas[] = [];
  for (let i = 0; i < 8; i++) {
    const breath = i >= 2 && i < 6 ? 1 : 0;
    idle.push(drawCharacter(spec, { bob: breath, eyes: i === 6 ? 'closed' : 'open', armF: [1, d.arm - breath * 0.5], armB: [-1, d.arm - breath * 0.5] }));
  }
  anims.push({ key: 'idle', frames: idle, fps: 4, loop: true });
  const walk: PixelCanvas[] = [];
  for (let i = 0; i < 6; i++) walk.push(drawCharacter(spec, walkPose(i, 6, d)));
  anims.push({ key: 'walk', frames: walk, fps: 9, loop: true });
  const run: PixelCanvas[] = [];
  for (let i = 0; i < 6; i++) run.push(drawCharacter(spec, walkPose(i, 6, d, true)));
  anims.push({ key: 'run', frames: run, fps: 13, loop: true });
  anims.push({ key: 'turn', frames: [drawCharacter(spec, { front: true }), drawCharacter(spec, { front: true, bob: 0 })], fps: 12, loop: false });
  anims.push({
    key: 'talk',
    frames: [
      drawCharacter(spec, { mouth: 'open' }),
      drawCharacter(spec, { mouth: 'closed', bob: 0 }),
      drawCharacter(spec, { mouth: 'open', armF: [4, d.arm - 4] }),
      drawCharacter(spec, { mouth: 'closed', armF: [3, d.arm - 3] }),
    ],
    fps: 6,
    loop: true,
  });
  anims.push({ key: 'front', frames: [drawCharacter(spec, { front: true }), drawCharacter(spec, { front: true, bob: 1 }), drawCharacter(spec, { front: true, bob: 1 }), drawCharacter(spec, { front: true, eyes: 'closed' })], fps: 3, loop: true });
  for (const [key, def] of Object.entries(extra)) anims.push({ key, frames: def.poses.map((p) => drawCharacter(spec, p, def.expr)), fps: def.fps, loop: def.loop });
  return anims;
}

export { DIMS };
