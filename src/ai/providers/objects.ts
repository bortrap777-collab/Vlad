/**
 * Объекты на фото — на устройстве, без сервера:
 *  - выделение касанием: MobileSAM (энкодер считает «карту» фото один раз, ~3–6 с,
 *    дальше каждое касание — декодер масок, доли секунды). Декодер даёт три уровня:
 *    деталь (лицо), часть (голова), целиком (весь человек);
 *  - удаление объекта: MI-GAN (Picsart AI Research) дорисовывает фон на месте объекта.
 *    Модель работает с участком вокруг объекта, остальное фото не пересчитывается
 *    и остаётся в исходном качестве.
 */
import { MediaError } from '../../lib/media';
import { aiManifest, ensureAiAssets, packFile, readAiAsset } from '../assets';
import type { AiProgress } from '../types';

/* ---------- Worker с моделями ---------- */

type Feed = { type: 'float32' | 'uint8'; data: ArrayBufferView; dims: number[] };
type Out =
  | { type: 'ready' }
  | { type: 'done'; id: number; result?: Record<string, { data: ArrayBufferView; dims: number[] }>; ms?: number }
  | { type: 'error'; id?: number; message: string };

const IDLE_MS = 120_000;
let worker: Worker | null = null;
let ready: Promise<Worker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
const pending = new Map<number, { resolve: (m: Out & { type: 'done' }) => void; reject: (e: unknown) => void }>();
const loaded = new Set<string>();

function explain(message: string): string {
  if (/memory|alloc|OOM|out of bounds/i.test(message)) return 'Не хватило памяти устройства для модели. Закройте другие вкладки и приложения и повторите.';
  return `Модель не смогла обработать фото: ${message}`;
}

function shutdown(reason: unknown = new DOMException('Отменено', 'AbortError')) {
  worker?.terminate();
  worker = null;
  ready = null;
  loaded.clear();
  embedding = null;
  pending.forEach((p) => p.reject(reason));
  pending.clear();
}

/** Модели занимают сотни МБ памяти — на iPhone освобождаем их, когда инструмент не нужен. */
function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => shutdown(), IDLE_MS);
}

/** Освободить память сразу (закрыли инструмент) */
export function releaseObjectModels() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => shutdown(), 15_000);
}

function startWorker(): Promise<Worker> {
  if (ready) return ready;
  ready = (async () => {
    const m = await aiManifest();
    const wasm = await readAiAsset(m.files.find((f) => f.name.startsWith('ort-wasm'))!.name);
    const w = new Worker(new URL('../onnx.worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    await new Promise<void>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<Out>) => {
        if (e.data.type === 'ready') resolve();
        else if (e.data.type === 'error') reject(new MediaError(explain(e.data.message)));
      };
      w.onerror = (e) => reject(new MediaError(explain(e.message || 'не удалось запустить обработчик')));
      w.postMessage({ type: 'init', wasm }, [wasm]);
    });
    w.onmessage = (e: MessageEvent<Out>) => {
      const msg = e.data;
      if (msg.type === 'ready' || msg.id == null) return;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.type === 'done') p.resolve(msg);
      else p.reject(new MediaError(explain(msg.message)));
    };
    w.onerror = (e) => shutdown(new MediaError(explain(e.message || 'обработчик остановился (вероятно, не хватило памяти)')));
    return w;
  })().catch((e) => {
    shutdown(e);
    throw e;
  });
  return ready;
}

async function call(msg: Record<string, unknown>, transfer: Transferable[], signal?: AbortSignal): Promise<Out & { type: 'done' }> {
  clearTimeout(idleTimer);
  const w = await startWorker();
  if (signal?.aborted) throw new DOMException('Отменено', 'AbortError');
  const id = ++seq;
  return new Promise((resolve, reject) => {
    // Расчёт внутри WASM прервать нельзя — останавливаем worker целиком
    const onAbort = () => shutdown();
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      resolve: (m) => {
        signal?.removeEventListener('abort', onAbort);
        scheduleIdle();
        resolve(m);
      },
      reject: (e) => {
        signal?.removeEventListener('abort', onAbort);
        reject(e);
      },
    });
    w.postMessage({ ...msg, id }, transfer);
  });
}

async function loadModel(name: string, signal?: AbortSignal) {
  if (loaded.has(name)) return;
  const model = await readAiAsset(name);
  await call({ type: 'load', name, model }, [model], signal);
  loaded.add(name);
}

async function run(name: string, feeds: Record<string, Feed>, signal?: AbortSignal) {
  const transfer = Object.values(feeds).map((f) => f.data.buffer as ArrayBuffer);
  const r = await call({ type: 'run', name, feeds }, transfer, signal);
  return { result: r.result!, ms: r.ms ?? 0 };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new MediaError('Браузер не дал холст для обработки. Закройте другие вкладки и повторите.');
  return [c, ctx];
}

/* ---------- Выделение: MobileSAM ---------- */

const SAM = 1024;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export interface SamEmbedding {
  key: string;
  /** Рабочий размер фото (длинная сторона 1024) — в нём точки и маски */
  w: number;
  h: number;
  data: Float32Array;
  ms: number;
}

export interface SamPoint {
  x: number;
  y: number;
  positive: boolean;
}

export interface SamMasks {
  /** Четыре маски (логиты) размером w×h: 0 — для нескольких точек, 1 — деталь, 2 — часть, 3 — целиком */
  masks: Float32Array;
  iou: number[];
  w: number;
  h: number;
}

let embedding: SamEmbedding | null = null;
let names: { enc: string; dec: string; migan: string } | null = null;

async function modelNames() {
  if (!names) {
    const m = await aiManifest();
    names = { enc: packFile(m, 'select', 'sam-encoder'), dec: packFile(m, 'select', 'sam-decoder'), migan: packFile(m, 'erase', 'migan') };
  }
  return names;
}

export function samWorkSize(w: number, h: number) {
  const k = SAM / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** «Изучить» фото: один раз на изображение, потом касания работают быстро */
export async function samEncode(key: string, img: CanvasImageSource, natW: number, natH: number, onProgress: (p: AiProgress) => void, signal: AbortSignal): Promise<SamEmbedding> {
  if (embedding?.key === key) return embedding;
  await ensureAiAssets('select', onProgress, signal);
  const n = await modelNames();
  onProgress({ value: null, label: 'Загружаю модель выделения…' });
  await loadModel(n.enc, signal);
  await loadModel(n.dec, signal);

  onProgress({ value: null, label: 'Изучаю фото…' });
  const { w, h } = samWorkSize(natW, natH);
  const [c, ctx] = canvas(w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  c.width = c.height = 1;
  // Нормализация как у SAM; область за пределами фото — нули (так дополняет сама модель)
  const plane = SAM * SAM;
  const x = new Float32Array(3 * plane);
  for (let y = 0; y < h; y++)
    for (let i = 0; i < w; i++) {
      const s = (y * w + i) * 4;
      const d = y * SAM + i;
      x[d] = (px[s] / 255 - MEAN[0]) / STD[0];
      x[d + plane] = (px[s + 1] / 255 - MEAN[1]) / STD[1];
      x[d + 2 * plane] = (px[s + 2] / 255 - MEAN[2]) / STD[2];
    }
  const { result, ms } = await run(n.enc, { x: { type: 'float32', data: x, dims: [1, 3, SAM, SAM] } }, signal);
  embedding = { key, w, h, data: result.image_embeddings.data as Float32Array, ms };
  return embedding;
}

export async function samDecode(emb: SamEmbedding, points: SamPoint[], signal?: AbortSignal): Promise<SamMasks> {
  const n = await modelNames();
  // Точки — в координатах 1024; последняя точка-заглушка нужна модели, когда нет рамки
  const coords = new Float32Array((points.length + 1) * 2);
  const labels = new Float32Array(points.length + 1);
  points.forEach((p, i) => {
    coords[i * 2] = p.x;
    coords[i * 2 + 1] = p.y;
    labels[i] = p.positive ? 1 : 0;
  });
  labels[points.length] = -1;
  const { result } = await run(
    n.dec,
    {
      image_embeddings: { type: 'float32', data: emb.data.slice(), dims: [1, 256, 64, 64] },
      point_coords: { type: 'float32', data: coords, dims: [1, points.length + 1, 2] },
      point_labels: { type: 'float32', data: labels, dims: [1, points.length + 1] },
      mask_input: { type: 'float32', data: new Float32Array(256 * 256), dims: [1, 1, 256, 256] },
      has_mask_input: { type: 'float32', data: new Float32Array([0]), dims: [1] },
      orig_im_size: { type: 'float32', data: new Float32Array([emb.h, emb.w]), dims: [2] },
    },
    signal,
  );
  return { masks: result.masks.data as Float32Array, iou: [...(result.iou_predictions.data as Float32Array)], w: emb.w, h: emb.h };
}

/** Маска уровня → альфа-канал с мягким краем (логит ±2 → плавный переход в пару пикселей) */
export function maskAlpha(m: SamMasks, index: number): Uint8ClampedArray {
  const size = m.w * m.h;
  const out = new Uint8ClampedArray(size);
  const off = index * size;
  for (let i = 0; i < size; i++) out[i] = ((m.masks[off + i] + 2) / 4) * 255;
  return out;
}

/* ---------- Удаление: MI-GAN ---------- */

const INPAINT_MAX = 1024;

/** Бинарная маска (a ≥ 64) из канваса и её расширение на r пикселей — чтобы не оставались края объекта */
function dilatedMask(sel: HTMLCanvasElement, r: number): { data: Uint8Array; w: number; h: number } {
  const w = sel.width;
  const h = sel.height;
  const a = sel.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  let cur = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) cur[i] = a[i * 4 + 3] >= 64 ? 1 : 0;
  // Квадратное расширение: максимум по строкам, потом по столбцам (окно 2r+1)
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) {
      if (cur[y * w + x]) last = x;
      if (x - last <= r) tmp[y * w + x] = 1;
    }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (cur[y * w + x]) last = x;
      if (last - x <= r) tmp[y * w + x] = 1;
    }
  }
  cur = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= r) cur[y * w + x] = 1;
    }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= r) cur[y * w + x] = 1;
    }
  }
  return { data: cur, w, h };
}

/**
 * Удалить выделенное и дорисовать фон.
 * src — фото в полном размере W×H; sel — выделение (альфа) любого размера с теми же пропорциями.
 * Возвращает новый канвас W×H: вне выделения пиксели исходные.
 */
export async function eraseObject(src: CanvasImageSource, W: number, H: number, sel: HTMLCanvasElement, onProgress: (p: AiProgress) => void, signal: AbortSignal): Promise<{ canvas: HTMLCanvasElement; ms: number }> {
  await ensureAiAssets('erase', onProgress, signal);
  const n = await modelNames();
  onProgress({ value: null, label: 'Загружаю модель удаления…' });
  await loadModel(n.migan, signal);

  onProgress({ value: null, label: 'Удаляю объект…' });
  const r = Math.max(2, Math.round(Math.max(sel.width, sel.height) * 0.007));
  const m = dilatedMask(sel, r);
  let x0 = m.w;
  let y0 = m.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (m.data[y * m.w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) throw new MediaError('Сначала выделите, что удалить.');

  // Участок с запасом вокруг объекта: модели нужен окружающий фон
  const sx = W / m.w;
  const sy = H / m.h;
  const bw = (x1 - x0 + 1) * sx;
  const bh = (y1 - y0 + 1) * sy;
  const pad = Math.max(bw, bh) * 0.6 + 24;
  const cx0 = Math.max(0, Math.floor(x0 * sx - pad));
  const cy0 = Math.max(0, Math.floor(y0 * sy - pad));
  const cx1 = Math.min(W, Math.ceil((x1 + 1) * sx + pad));
  const cy1 = Math.min(H, Math.ceil((y1 + 1) * sy + pad));
  const cw = cx1 - cx0;
  const ch = cy1 - cy0;
  const k = Math.min(1, INPAINT_MAX / Math.max(cw, ch));
  const iw = Math.max(8, Math.round(cw * k));
  const ih = Math.max(8, Math.round(ch * k));

  // Маска расширенная, в виде канваса (белый = удалить)
  const [mc, mctx] = canvas(m.w, m.h);
  const mi = mctx.createImageData(m.w, m.h);
  for (let i = 0; i < m.data.length; i++) {
    mi.data[i * 4] = mi.data[i * 4 + 1] = mi.data[i * 4 + 2] = 255;
    mi.data[i * 4 + 3] = m.data[i] ? 255 : 0;
  }
  mctx.putImageData(mi, 0, 0);

  // Вход модели: участок фото и маска (255 — оставить, 0 — дорисовать)
  const [ic, ictx] = canvas(iw, ih);
  ictx.imageSmoothingQuality = 'high';
  ictx.drawImage(src, cx0, cy0, cw, ch, 0, 0, iw, ih);
  const rgba = ictx.getImageData(0, 0, iw, ih).data;
  ictx.clearRect(0, 0, iw, ih);
  ictx.drawImage(mc, cx0 / sx, cy0 / sy, cw / sx, ch / sy, 0, 0, iw, ih);
  const ma = ictx.getImageData(0, 0, iw, ih).data;
  const plane = iw * ih;
  const image = new Uint8Array(3 * plane);
  const mask = new Uint8Array(plane);
  for (let i = 0; i < plane; i++) {
    image[i] = rgba[i * 4];
    image[i + plane] = rgba[i * 4 + 1];
    image[i + 2 * plane] = rgba[i * 4 + 2];
    mask[i] = ma[i * 4 + 3] > 0 ? 0 : 255;
  }
  const { result, ms } = await run(
    n.migan,
    { image: { type: 'uint8', data: image, dims: [1, 3, ih, iw] }, mask: { type: 'uint8', data: mask, dims: [1, 1, ih, iw] } },
    signal,
  );
  const out = result.result.data as Uint8Array;
  const [oh, ow] = [result.result.dims[2], result.result.dims[3]];
  const [rc, rctx] = canvas(ow, oh);
  const ri = rctx.createImageData(ow, oh);
  const op = ow * oh;
  for (let i = 0; i < op; i++) {
    ri.data[i * 4] = out[i];
    ri.data[i * 4 + 1] = out[i + op];
    ri.data[i * 4 + 2] = out[i + 2 * op];
    ri.data[i * 4 + 3] = 255;
  }
  rctx.putImageData(ri, 0, 0);

  // Заплатка: результат модели только внутри маски, край мягкий
  onProgress({ value: 0.95, label: 'Собираю фото…' });
  const [pc, pctx] = canvas(cw, ch);
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(rc, 0, 0, cw, ch);
  pctx.globalCompositeOperation = 'destination-in';
  pctx.drawImage(mc, cx0 / sx, cy0 / sy, cw / sx, ch / sy, 0, 0, cw, ch);
  const [fc, fctx] = canvas(W, H);
  fctx.drawImage(src, 0, 0, W, H);
  fctx.drawImage(pc, cx0, cy0);
  ic.width = ic.height = rc.width = rc.height = pc.width = pc.height = mc.width = mc.height = 1;
  return { canvas: fc, ms };
}
