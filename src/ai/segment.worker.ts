/**
 * Web Worker: модель ISNet через ONNX Runtime Web (WASM).
 * Интерфейс не зависает во время расчёта; сессия модели живёт, пока жив worker,
 * поэтому повторное удаление фона не загружает модель заново.
 *
 * Вход модели: RGB 1024×1024, (x − 128) / 256, раскладка CHW.
 * Выход: маска 1024×1024, 0…1 (1 — объект).
 */
import * as ort from 'onnxruntime-web/wasm';

const SIZE = 1024;

type In =
  | { type: 'init'; model: ArrayBuffer; wasm: ArrayBuffer }
  | { type: 'run'; id: number; rgba: ArrayBuffer };

let session: ort.InferenceSession | null = null;

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      ort.env.wasm.wasmBinary = m.wasm;
      // Потоки WASM требуют cross-origin isolation, которой нет на GitHub Pages
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      ort.env.wasm.proxy = false;
      session = await ort.InferenceSession.create(m.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      post({ type: 'ready' });
      return;
    }
    if (m.type === 'run') {
      if (!session) throw new Error('Модель не загружена');
      const px = new Uint8ClampedArray(m.rgba);
      const n = SIZE * SIZE;
      const input = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) {
        input[i] = (px[i * 4] - 128) / 256;
        input[i + n] = (px[i * 4 + 1] - 128) / 256;
        input[i + 2 * n] = (px[i * 4 + 2] - 128) / 256;
      }
      const t0 = performance.now();
      const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
      const data = out[session.outputNames[0]].data as Float32Array;
      const mask = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const v = data[i];
        mask[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
      }
      post({ type: 'result', id: m.id, mask: mask.buffer, ms: performance.now() - t0 }, [mask.buffer]);
    }
  } catch (err) {
    post({ type: 'error', id: m.type === 'run' ? m.id : undefined, message: String((err as Error)?.message ?? err) });
  }
};
