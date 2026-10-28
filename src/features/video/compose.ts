/**
 * Сборка кадра видео — общая для экспорта и предпросмотра, поэтому готовое видео
 * выглядит так же, как на экране: размытый фон по краям, вписывание/заполнение,
 * переходы между клипами.
 */
import type { TransitionType } from './model';

export type Drawable = CanvasImageSource & { width?: number; height?: number };

/** Размер исходной картинки (у <video> — videoWidth) */
export function sizeOf(src: Drawable): [number, number] {
  if (src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  if (src instanceof HTMLImageElement) return [src.naturalWidth, src.naturalHeight];
  const s = src as { width: number; height: number };
  return [s.width, s.height];
}

/** Вспомогательные холсты для размытого фона (маленький → средний → кадр) */
export class BlurHelper {
  private small: HTMLCanvasElement;
  private mid: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private mctx: CanvasRenderingContext2D;
  constructor(W: number, H: number) {
    const bw = 32;
    const bh = Math.max(1, Math.round((bw * H) / W));
    this.small = document.createElement('canvas');
    this.small.width = bw;
    this.small.height = bh;
    this.mid = document.createElement('canvas');
    this.mid.width = bw * 4;
    this.mid.height = bh * 4;
    this.sctx = this.small.getContext('2d')!;
    this.mctx = this.mid.getContext('2d')!;
    this.mctx.imageSmoothingQuality = 'high';
  }
  draw(ctx: CanvasRenderingContext2D, src: Drawable, vw: number, vh: number, W: number, H: number) {
    const bw = this.small.width;
    const bh = this.small.height;
    const bs = Math.max(bw / vw, bh / vh);
    this.sctx.drawImage(src, (bw - vw * bs) / 2, (bh - vh * bs) / 2, vw * bs, vh * bs);
    this.mctx.drawImage(this.small, 0, 0, bw * 4, bh * 4);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    // Два шага увеличения дают мягкое размытие без «квадратиков»
    ctx.drawImage(this.mid, 0, 0, bw * 4, bh * 4, -W * 0.06, -H * 0.06, W * 1.12, H * 1.12);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

export interface LayoutOptions {
  fill: boolean;
  blur: BlurHelper | null;
}

/**
 * Кадр клипа целиком (фон + картинка) в ctx размером W×H.
 * Возвращает прямоугольник картинки — для фильтра клипа.
 */
export function drawClipFrame(ctx: CanvasRenderingContext2D, src: Drawable, W: number, H: number, o: LayoutOptions): { x: number; y: number; w: number; h: number } {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const [vw0, vh0] = sizeOf(src);
  const vw = vw0 || W;
  const vh = vh0 || H;
  const s = o.fill ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh);
  const w = vw * s;
  const h = vh * s;
  const x = (W - w) / 2;
  const y = (H - h) / 2;
  if (o.blur && (w < W - 1 || h < H - 1)) o.blur.draw(ctx, src, vw, vh, W, H);
  ctx.drawImage(src, x, y, w, h);
  return { x, y, w, h };
}

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/**
 * Переход: a — уходящий кадр, b — входящий (оба уже собраны в холсты W×H), p — 0…1.
 */
export function drawTransition(ctx: CanvasRenderingContext2D, type: TransitionType, p: number, a: CanvasImageSource, b: CanvasImageSource, W: number, H: number): void {
  const e = ease(Math.min(1, Math.max(0, p)));
  ctx.save();
  switch (type) {
    case 'slideleft':
      ctx.drawImage(a, -e * W, 0, W, H);
      ctx.drawImage(b, (1 - e) * W, 0, W, H);
      break;
    case 'slideup':
      ctx.drawImage(a, 0, -e * H, W, H);
      ctx.drawImage(b, 0, (1 - e) * H, W, H);
      break;
    case 'wipe': {
      ctx.drawImage(a, 0, 0, W, H);
      const x = e * W;
      ctx.beginPath();
      ctx.rect(0, 0, x, H);
      ctx.clip();
      ctx.drawImage(b, 0, 0, W, H);
      ctx.restore();
      ctx.save();
      // Мягкая светлая кромка шторки
      if (e > 0 && e < 1) {
        const g = ctx.createLinearGradient(x - W * 0.03, 0, x, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, 'rgba(255,255,255,0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(x - W * 0.03, 0, W * 0.03, H);
      }
      break;
    }
    case 'zoom': {
      ctx.drawImage(b, 0, 0, W, H);
      const z = 1 + e * 0.6;
      ctx.globalAlpha = 1 - e;
      ctx.drawImage(a, (W - W * z) / 2, (H - H * z) / 2, W * z, H * z);
      break;
    }
    case 'circle': {
      ctx.drawImage(a, 0, 0, W, H);
      const r = e * Math.hypot(W, H) * 0.5;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, Math.max(0.01, r), 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(b, 0, 0, W, H);
      break;
    }
    case 'dissolve':
    default:
      ctx.drawImage(a, 0, 0, W, H);
      ctx.globalAlpha = e;
      ctx.drawImage(b, 0, 0, W, H);
      break;
  }
  ctx.restore();
}

/** Заливка цветом (затемнение/вспышка) поверх кадра */
export function drawDip(ctx: CanvasRenderingContext2D, color: 'black' | 'white', alpha: number, W: number, H: number): void {
  if (alpha <= 0) return;
  ctx.fillStyle = color === 'white' ? `rgba(255,255,255,${alpha.toFixed(3)})` : `rgba(0,0,0,${alpha.toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
}
