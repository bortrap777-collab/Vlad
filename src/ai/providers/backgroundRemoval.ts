/**
 * Удаление фона на устройстве: ISNet (DIS) через ONNX Runtime Web в Web Worker.
 *
 * Результат — маска (PNG: белый цвет, прозрачность = фон) с пропорциями исходного фото,
 * без поворота и обрезки. Сама замена фона — композиция в фоторедакторе по этой маске,
 * поэтому поворот, обрезку и цвет можно менять и после удаления фона.
 */
import { loadImage, MediaError } from '../../lib/media';
import { aiAssetsReady, aiManifest, packFile, readAiAsset } from '../assets';
import type { AiProgress, AiProvider } from '../types';

const SIZE = 1024;
const MASK_MAX_SIDE = 2048;
const IDLE_MS = 90_000;

export interface MaskResult {
  mask: Blob;
  width: number;
  height: number;
  /** Время расчёта модели, мс */
  ms: number;
}

type Out =
  | { type: 'ready' }
  | { type: 'result'; id: number; mask: ArrayBuffer; ms: number }
  | { type: 'error'; id?: number; message: string };

let worker: Worker | null = null;
let ready: Promise<Worker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

function shutdown() {
  worker?.terminate();
  worker = null;
  ready = null;
}

/** Модель занимает сотни МБ памяти — на iPhone освобождаем её, когда инструмент не нужен. */
function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdown, IDLE_MS);
}

function explain(message: string): string {
  if (/memory|alloc|OOM|out of bounds/i.test(message)) return 'Не хватило памяти устройства для модели. Закройте другие вкладки и приложения и повторите.';
  return `Модель не смогла обработать фото: ${message}`;
}

function startWorker(): Promise<Worker> {
  if (ready) return ready;
  ready = (async () => {
    const m = await aiManifest();
    const modelName = packFile(m, 'segment', 'isnet');
    const wasmName = packFile(m, 'segment', 'ort-wasm');
    const [model, wasm] = await Promise.all([readAiAsset(modelName), readAiAsset(wasmName)]);
    const w = new Worker(new URL('../segment.worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    await new Promise<void>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<Out>) => {
        if (e.data.type === 'ready') resolve();
        else if (e.data.type === 'error') reject(new MediaError(explain(e.data.message)));
      };
      w.onerror = (e) => reject(new MediaError(explain(e.message || 'не удалось запустить обработчик')));
      w.postMessage({ type: 'init', model, wasm }, [model, wasm]);
    });
    return w;
  })().catch((e) => {
    shutdown();
    throw e;
  });
  return ready;
}

function runModel(w: Worker, rgba: ArrayBuffer, signal: AbortSignal): Promise<{ mask: Uint8Array; ms: number }> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      // Расчёт внутри WASM прервать нельзя — останавливаем worker целиком
      shutdown();
      reject(new DOMException('Отменено', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    w.onmessage = (e: MessageEvent<Out>) => {
      const m = e.data;
      if (m.type === 'result' && m.id === id) {
        signal.removeEventListener('abort', onAbort);
        resolve({ mask: new Uint8Array(m.mask), ms: m.ms });
      } else if (m.type === 'error') {
        signal.removeEventListener('abort', onAbort);
        reject(new MediaError(explain(m.message)));
      }
    };
    w.onerror = (e) => {
      signal.removeEventListener('abort', onAbort);
      shutdown();
      reject(new MediaError(explain(e.message || 'обработчик остановился (вероятно, не хватило памяти)')));
    };
    w.postMessage({ type: 'run', id, rgba }, [rgba]);
  });
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new MediaError('Браузер не дал холст для обработки. Закройте другие вкладки и повторите.');
  return [c, ctx];
}

export async function computeMask(image: Blob, onProgress: (p: AiProgress) => void, signal: AbortSignal): Promise<MaskResult> {
  onProgress({ value: 0.05, label: 'Загружаю модель…' });
  clearTimeout(idleTimer);
  const w = await startWorker();
  if (signal.aborted) throw new DOMException('Отменено', 'AbortError');

  onProgress({ value: 0.2, label: 'Готовлю фото…' });
  const url = URL.createObjectURL(image);
  let srcW: number;
  let srcH: number;
  let rgba: ArrayBuffer;
  try {
    const img = await loadImage(url);
    srcW = img.naturalWidth;
    srcH = img.naturalHeight;
    const [c, ctx] = canvas(SIZE, SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    rgba = ctx.getImageData(0, 0, SIZE, SIZE).data.buffer;
    c.width = c.height = 1;
  } finally {
    URL.revokeObjectURL(url);
  }

  onProgress({ value: null, label: 'Отделяю объект от фона…' });
  const { mask, ms } = await runModel(w, rgba, signal);
  scheduleIdle();

  onProgress({ value: 0.92, label: 'Сохраняю маску…' });
  const [mc, mctx] = canvas(SIZE, SIZE);
  const img = mctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
    img.data[o + 3] = mask[i];
  }
  mctx.putImageData(img, 0, 0);
  const k = Math.min(1, MASK_MAX_SIDE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * k));
  const height = Math.max(1, Math.round(srcH * k));
  const [oc, octx] = canvas(width, height);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(mc, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((r) => oc.toBlob(r, 'image/png'));
  mc.width = mc.height = oc.width = oc.height = 1;
  if (!blob) throw new MediaError('Не удалось сохранить маску.');
  onProgress({ value: 1, label: 'Готово' });
  return { mask: blob, width, height, ms };
}

export const isnetProvider: AiProvider<Blob, MaskResult> = {
  id: 'isnet-on-device',
  tool: 'bg-remove',
  kind: 'on-device',
  title: 'ISNet на устройстве',
  isAvailable: () => aiAssetsReady('segment'),
  run: computeMask,
};
