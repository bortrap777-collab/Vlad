import type { CropRect } from './pipeline';

export const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };
export const MIN_SIDE = 0.08;

export type AspectId = 'free' | 'orig' | '1:1' | '4:5' | '9:16' | '16:9';
export const ASPECTS: { id: AspectId; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Свободно', ratio: null },
  { id: 'orig', label: 'Оригинал', ratio: -1 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Самая большая рамка с заданной пропорцией (в пикселях), по центру. */
export function fitAspect(pixelRatio: number, rw: number, rh: number): CropRect {
  const rn = (pixelRatio * rh) / rw; // w/h в нормированных единицах
  let w = 1;
  let h = w / rn;
  if (h > 1) {
    h = 1;
    w = rn;
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** Поворот рамки вместе с изображением на 90° по часовой. */
export function rotateCropCW(c: CropRect | null): CropRect | null {
  if (!c) return null;
  return { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w };
}

export function isFull(c: CropRect | null): boolean {
  return !c || (c.x < 0.002 && c.y < 0.002 && c.w > 0.996 && c.h > 0.996);
}

export type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

/**
 * Изменение рамки жестом. dx, dy — смещение пальца в нормированных единицах.
 * rn — пропорция w/h в нормированных единицах или null (свободно).
 */
export function dragCrop(c0: CropRect, handle: Handle, dx: number, dy: number, rn: number | null): CropRect {
  if (handle === 'move') {
    return { ...c0, x: clamp(c0.x + dx, 0, 1 - c0.w), y: clamp(c0.y + dy, 0, 1 - c0.h) };
  }
  const west = handle === 'nw' || handle === 'sw';
  const north = handle === 'nw' || handle === 'ne';
  // Неподвижный угол
  const ax = west ? c0.x + c0.w : c0.x;
  const ay = north ? c0.y + c0.h : c0.y;
  const maxW = west ? ax : 1 - ax;
  const maxH = north ? ay : 1 - ay;

  let w = clamp(c0.w + (west ? -dx : dx), MIN_SIDE, maxW);
  let h = clamp(c0.h + (north ? -dy : dy), MIN_SIDE, maxH);
  if (rn) {
    // Ведущей берём сторону, которую палец сдвинул сильнее
    if (Math.abs(dx) >= Math.abs(dy)) h = w / rn;
    else w = h * rn;
    if (h > maxH) {
      h = maxH;
      w = h * rn;
    }
    if (w > maxW) {
      w = maxW;
      h = w / rn;
    }
    const minW = Math.max(MIN_SIDE, MIN_SIDE * rn);
    if (w < minW) {
      w = minW;
      h = w / rn;
    }
  }
  return { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h };
}
