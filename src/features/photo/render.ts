/**
 * Рендер фото в файл: поворот → обрезка → цвет → текст → JPEG/PNG.
 * Тяжёлая попиксельная часть выполняется в Web Worker, интерфейс не зависает,
 * прогресс передаётся наружу.
 */
import { loadImage, MediaError } from '../../lib/media';
import { applyAdjustments, pixelParams, TEXT_FONTS, type PhotoEdits, type PixelParams, type TextLayer } from './pipeline';

export interface RenderResult {
  blob: Blob;
  width: number;
  height: number;
  /** Разрешение уменьшено из-за ограничения холста браузера */
  limited: boolean;
  sourceWidth: number;
  sourceHeight: number;
  type: string;
}

export interface RenderOptions {
  /** Максимум пикселей итогового кадра */
  maxPixels?: number;
  maxSide?: number;
  type?: 'image/jpeg' | 'image/png';
  quality?: number;
  useWorker?: boolean;
  onProgress?: (value: number, label: string) => void;
}

/** Safari на iPhone/iPad не рисует холст больше 16 777 216 пикселей. */
export function canvasPixelLimit(): number {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return iOS ? 16_777_216 : 50_000_000;
}

export async function ensureFonts(texts: TextLayer[]): Promise<void> {
  if (!texts.length || !document.fonts?.load) return;
  const used = new Set(texts.map((t) => t.font));
  await Promise.all(
    [...used].map((f) => {
      const def = TEXT_FONTS[f];
      return document.fonts.load(`${def.weight} 48px ${def.family}`).catch(() => undefined);
    }),
  );
}

export function drawTexts(ctx: CanvasRenderingContext2D, texts: TextLayer[], w: number, h: number): void {
  for (const t of texts) {
    if (!t.text.trim()) continue;
    const def = TEXT_FONTS[t.font];
    const fs = t.size * w;
    const lh = fs * 1.2;
    const lines = t.text.split('\n');
    ctx.save();
    ctx.font = `${def.weight} ${fs}px ${def.family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = t.x * w;
    const cy = t.y * h;
    const blockH = lines.length * lh;
    if (t.style === 'box') {
      const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const padX = fs * 0.5;
      const padY = fs * 0.25;
      const bw = maxW + padX * 2;
      const bh = blockH + padY * 2;
      roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, fs * 0.3);
      ctx.fillStyle = t.color;
      ctx.fill();
    }
    if (t.style === 'shadow') {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = fs * 0.25;
      ctx.shadowOffsetY = fs * 0.05;
    }
    ctx.fillStyle = t.style === 'box' ? boxInk(t.color) : t.color;
    lines.forEach((line, i) => ctx.fillText(line, cx, cy - blockH / 2 + lh * (i + 0.5)));
    ctx.restore();
  }
}

/** Цвет текста на плашке: тёмный на светлой, белый на тёмной. */
export function boxInk(bg: string): string {
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111111' : '#FFFFFF';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function isNeutral(p: PixelParams): boolean {
  return Math.abs(p.b - 1) < 1e-4 && Math.abs(p.c - 1) < 1e-4 && Math.abs(p.s - 1) < 1e-4 && !p.gray && !p.sepia && !p.temp;
}

let workerUrl: string | null = null;
function makeWorker(): Worker | null {
  try {
    if (!workerUrl) {
      const src = `const applyAdjustments = ${applyAdjustments.toString()};
self.onmessage = (e) => {
  const { buf, p } = e.data;
  try {
    const d = new Uint8ClampedArray(buf);
    let last = 0;
    applyAdjustments(d, p, (v) => { if (v - last > 0.04 || v === 1) { last = v; self.postMessage({ progress: v }); } });
    self.postMessage({ done: true, buf }, [buf]);
  } catch (err) { self.postMessage({ error: String(err && err.message || err) }); }
};`;
      workerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    }
    return new Worker(workerUrl);
  } catch {
    return null;
  }
}

function processInWorker(img: ImageData, p: PixelParams, onProgress: (v: number) => void): Promise<ImageData> {
  const worker = makeWorker();
  if (!worker) return processOnMain(img, p, onProgress);
  return new Promise((resolve, reject) => {
    const buf = img.data.buffer;
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.progress != null) onProgress(m.progress);
      else if (m.done) {
        worker.terminate();
        resolve(new ImageData(new Uint8ClampedArray(m.buf), img.width, img.height));
      } else if (m.error) {
        worker.terminate();
        reject(new MediaError('Ошибка обработки изображения: ' + m.error));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      // Если браузер не запустил worker — обрабатываем здесь, кусками.
      processOnMain(img, p, onProgress).then(resolve, reject);
    };
    worker.postMessage({ buf, p }, [buf]);
  });
}

async function processOnMain(img: ImageData, p: PixelParams, onProgress: (v: number) => void): Promise<ImageData> {
  const rows = 256;
  const rowBytes = img.width * 4;
  for (let y = 0; y < img.height; y += rows) {
    const part = img.data.subarray(y * rowBytes, Math.min(img.height, y + rows) * rowBytes);
    applyAdjustments(part, p);
    onProgress(Math.min(1, (y + rows) / img.height));
    await new Promise((r) => setTimeout(r, 0));
  }
  return img;
}

/** Размеры кадра после поворота и обрезки (в пикселях исходника). */
export function outputGeometry(srcW: number, srcH: number, e: PhotoEdits) {
  const quarter = e.rotation % 180 !== 0;
  const rw = quarter ? srcH : srcW;
  const rh = quarter ? srcW : srcH;
  const c = e.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  return { rw, rh, crop: c, cw: Math.max(1, Math.round(c.w * rw)), ch: Math.max(1, Math.round(c.h * rh)) };
}

export async function renderPhoto(source: Blob, edits: PhotoEdits, opts: RenderOptions = {}): Promise<RenderResult> {
  const report = opts.onProgress ?? (() => undefined);
  report(0.02, 'Открываю оригинал…');
  const url = URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    if (img.decode) await img.decode().catch(() => undefined);
    const W0 = img.naturalWidth;
    const H0 = img.naturalHeight;
    const g = outputGeometry(W0, H0, edits);
    const maxPixels = opts.maxPixels ?? canvasPixelLimit();
    let scale = Math.min(1, Math.sqrt(maxPixels / (g.cw * g.ch)));
    if (opts.maxSide) scale = Math.min(scale, opts.maxSide / Math.max(g.cw, g.ch));
    const ow = Math.max(1, Math.floor(g.cw * scale));
    const oh = Math.max(1, Math.floor(g.ch * scale));
    const limited = !opts.maxSide && scale < 1;

    report(0.1, 'Поворот и обрезка…');
    const canvas = document.createElement('canvas');
    canvas.width = ow;
    canvas.height = oh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new MediaError('Браузер не дал холст для рендера. Закройте другие вкладки и повторите.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const s = ow / g.cw;
    ctx.setTransform(s, 0, 0, s, -g.crop.x * g.rw * s, -g.crop.y * g.rh * s);
    ctx.translate(g.rw / 2, g.rh / 2);
    ctx.rotate((edits.rotation * Math.PI) / 180);
    ctx.drawImage(img, -W0 / 2, -H0 / 2, W0, H0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const p = pixelParams(edits);
    if (!isNeutral(p)) {
      report(0.2, 'Цветокоррекция…');
      let data: ImageData;
      try {
        data = ctx.getImageData(0, 0, ow, oh);
      } catch {
        throw new MediaError('Не хватает памяти для обработки такого большого фото.');
      }
      const done =
        opts.useWorker === false
          ? await processOnMain(data, p, (v) => report(0.2 + v * 0.6, 'Цветокоррекция…'))
          : await processInWorker(data, p, (v) => report(0.2 + v * 0.6, 'Цветокоррекция…'));
      ctx.putImageData(done, 0, 0);
    }

    if (edits.texts.length) {
      report(0.84, 'Текст…');
      await ensureFonts(edits.texts);
      drawTexts(ctx, edits.texts, ow, oh);
    }

    report(0.9, 'Сохраняю файл…');
    const type = opts.type ?? 'image/jpeg';
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, opts.quality ?? 0.95));
    // Освобождаем память холста сразу (важно для iOS).
    canvas.width = canvas.height = 1;
    if (!blob) throw new MediaError('Браузер не смог закодировать изображение. Попробуйте ещё раз.');
    report(1, 'Готово');
    return { blob, width: ow, height: oh, limited, sourceWidth: g.cw, sourceHeight: g.ch, type };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
