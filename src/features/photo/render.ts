/**
 * Рендер фото в файл: поворот → обрезка → цвет → текст → JPEG/PNG.
 * Тяжёлая попиксельная часть выполняется в Web Worker, интерфейс не зависает,
 * прогресс передаётся наружу.
 */
import { drawVideoText } from '../video/textFx';
import { loadImage, MediaError } from '../../lib/media';
import { applyAdjustments, blurredBackdrop, isNeutralAdjust, pixelParams, TEXT_FONTS, type PhotoEdits, type PixelParams, type TextLayer } from './pipeline';
import { layerBox, type LayerStack, type PhotoLayer } from './layers';

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
  /** Файлы слоёв (изображения, маски, объединённое фото) по id */
  files?: Record<string, Blob>;
}

/** Закрывает ли слой весь документ без прозрачности */
function opaqueCover(l: PhotoLayer, docW: number, docH: number): boolean {
  if (!l.visible || l.opacity < 1) return false;
  if (l.kind !== 'photo') return true;
  if (l.mask || l.rotation % 360 !== 0) return false;
  const b = layerBox(l, docW, docH);
  return l.x - b.w / 2 <= 0.001 && l.x + b.w / 2 >= 0.999 && l.y - b.h / 2 <= 0.001 && l.y + b.h / 2 >= 0.999;
}

/** Нужна ли прозрачность в итоговом файле (JPEG её не поддерживает). */
export function stackHasAlpha(stack: LayerStack | null, docW: number, docH: number): boolean {
  if (!stack) return false;
  if (stack.merged) return stack.merged.alpha;
  return !stack.layers.some((l) => opaqueCover(l, docW, docH));
}

async function loadBlobImage(blob: Blob, urls: string[]): Promise<HTMLImageElement> {
  const u = URL.createObjectURL(blob);
  urls.push(u);
  const img = await loadImage(u);
  if (img.decode) await img.decode().catch(() => undefined);
  return img;
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
  // Образец текста нужен, чтобы загрузилась и кириллическая часть шрифта (unicode-range)
  const sample = [...new Set(texts.map((t) => t.text).join('').replace(/\s/g, ''))].join('').slice(0, 200) || 'AaЯя';
  await Promise.all(
    [...used].map((f) => {
      const def = TEXT_FONTS[f] ?? TEXT_FONTS.accent;
      return document.fonts.load(`${def.weight} 48px ${def.family}`, sample).catch(() => undefined);
    }),
  );
}

export function drawTexts(ctx: CanvasRenderingContext2D, texts: TextLayer[], w: number, h: number): void {
  // Те же стили, что у надписей видео (тень, плашка, контур, неон, прозрачность)
  for (const t of texts) drawVideoText(ctx, { ...t, start: 0, end: 1 }, 0.5, w, h);
}

function isNeutral(p: PixelParams): boolean {
  return Math.abs(p.b - 1) < 1e-4 && Math.abs(p.c - 1) < 1e-4 && Math.abs(p.s - 1) < 1e-4 && !p.gray && !p.sepia && !p.hue && !p.temp;
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

export function makeCanvas(w: number, h: number, read = false): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', read ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new MediaError('Браузер не дал холст для рендера. Закройте другие вкладки и повторите.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

/**
 * Слои → один холст размером cw×ch (документ = исходное фото W0×H0).
 * Каждый слой рисуется отдельно, со своей цветокоррекцией и прозрачностью.
 */
export async function composeStack(
  src: HTMLImageElement,
  stack: LayerStack,
  files: Record<string, Blob>,
  cw: number,
  ch: number,
  opts: { useWorker?: boolean; onProgress?: (v: number, label: string) => void } = {},
): Promise<HTMLCanvasElement> {
  const W0 = src.naturalWidth;
  const H0 = src.naturalHeight;
  const urls: string[] = [];
  const images = new Map<string, HTMLImageElement>();
  const image = async (id: string) => {
    if (!images.has(id)) {
      const b = files[id];
      if (!b) throw new MediaError('Файл слоя не найден. Откройте проект заново.');
      images.set(id, await loadBlobImage(b, urls));
    }
    return images.get(id)!;
  };
  const [out, octx] = makeCanvas(cw, ch);
  try {
    // Фото после удаления объектов заменяет оригинал во всех слоях
    const doc = stack.photo ? await image(stack.photo.media) : src;
    if (stack.merged) {
      octx.drawImage(await image(stack.merged.media), 0, 0, cw, ch);
      return out;
    }
    const [lc, lctx] = makeCanvas(cw, ch, true);
    const visible = stack.layers.filter((l) => l.visible && l.opacity > 0);
    for (let i = 0; i < visible.length; i++) {
      const l = visible[i];
      opts.onProgress?.(i / visible.length, `Слой «${l.name}»…`);
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, cw, ch);
      if (l.kind === 'color') {
        lctx.fillStyle = l.color;
        lctx.fillRect(0, 0, cw, ch);
      } else if (l.kind === 'blur') {
        const b = blurredBackdrop(doc, W0, H0, l.blur);
        lctx.drawImage(b, 0, 0, cw, ch);
        b.width = b.height = 1;
      } else {
        const im = l.media ? await image(l.media) : doc;
        const box = layerBox(l, W0, H0);
        const lw = box.w * cw;
        const lh = box.h * ch;
        const place = () => {
          lctx.setTransform(1, 0, 0, 1, l.x * cw, l.y * ch);
          lctx.rotate((l.rotation * Math.PI) / 180);
          if (l.flip) lctx.scale(-1, 1);
        };
        place();
        lctx.drawImage(im, -lw / 2, -lh / 2, lw, lh);
        if (l.mask) {
          lctx.globalCompositeOperation = 'destination-in';
          lctx.drawImage(await image(l.mask), -lw / 2, -lh / 2, lw, lh);
        }
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.globalCompositeOperation = 'source-over';
      }
      if (!isNeutralAdjust(l.adjust)) {
        const p = pixelParams(l.adjust);
        const data = lctx.getImageData(0, 0, cw, ch);
        const done = opts.useWorker === false ? await processOnMain(data, p, () => undefined) : await processInWorker(data, p, () => undefined);
        lctx.putImageData(done, 0, 0);
      }
      octx.globalAlpha = l.opacity;
      octx.drawImage(lc, 0, 0);
      octx.globalAlpha = 1;
    }
    lc.width = lc.height = 1;
    return out;
  } finally {
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
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
    // Координаты повёрнутого кадра (до обрезки) → холст
    const frame = (c: CanvasRenderingContext2D) => c.setTransform(s, 0, 0, s, -g.crop.x * g.rw * s, -g.crop.y * g.rh * s);
    // Координаты исходника с центром в нуле → холст
    const imageSpace = (c: CanvasRenderingContext2D) => {
      frame(c);
      c.translate(g.rw / 2, g.rh / 2);
      c.rotate((edits.rotation * Math.PI) / 180);
    };
    if (!edits.stack) {
      imageSpace(ctx);
      ctx.drawImage(img, -W0 / 2, -H0 / 2, W0, H0);
    } else {
      // Слои собираются в размере документа (не больше, чем нужно для итогового кадра)
      const ds = Math.min(scale, Math.sqrt(maxPixels / (W0 * H0)));
      const comp = await composeStack(img, edits.stack, opts.files ?? {}, Math.max(1, Math.round(W0 * ds)), Math.max(1, Math.round(H0 * ds)), {
        useWorker: opts.useWorker,
        onProgress: (v, label) => report(0.1 + v * 0.1, label),
      });
      imageSpace(ctx);
      ctx.drawImage(comp, -W0 / 2, -H0 / 2, W0, H0);
      comp.width = comp.height = 1;
    }
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
    const type = stackHasAlpha(edits.stack, W0, H0) ? 'image/png' : opts.type ?? 'image/jpeg';
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
