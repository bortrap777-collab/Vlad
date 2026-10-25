/**
 * Web Worker для моделей ONNX: выделение касанием (MobileSAM) и удаление объектов (MI-GAN).
 * Держит несколько сессий по имени файла, чтобы повторные касания не загружали модель заново.
 * Входы и выходы — плоские массивы с формой; подготовка картинок — в основном потоке.
 */
import * as ort from 'onnxruntime-web/wasm';

type Feed = { type: 'float32' | 'uint8'; data: ArrayBufferView; dims: number[] };

type In =
  | { type: 'init'; wasm: ArrayBuffer }
  | { type: 'load'; id: number; name: string; model: ArrayBuffer }
  | { type: 'run'; id: number; name: string; feeds: Record<string, Feed>; outputs?: string[] };

const sessions = new Map<string, ort.InferenceSession>();
const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      ort.env.wasm.wasmBinary = m.wasm;
      // Потоки WASM требуют cross-origin isolation, которой нет на GitHub Pages
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      ort.env.wasm.proxy = false;
      post({ type: 'ready' });
      return;
    }
    if (m.type === 'load') {
      if (!sessions.has(m.name)) sessions.set(m.name, await ort.InferenceSession.create(m.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }));
      post({ type: 'done', id: m.id });
      return;
    }
    if (m.type === 'run') {
      const s = sessions.get(m.name);
      if (!s) throw new Error('Модель не загружена');
      const feeds: Record<string, ort.Tensor> = {};
      for (const [k, f] of Object.entries(m.feeds)) feeds[k] = new ort.Tensor(f.type, f.data as Float32Array, f.dims);
      const t0 = performance.now();
      const out = await s.run(feeds);
      const result: Record<string, { data: ArrayBufferView; dims: readonly number[] }> = {};
      const transfer: Transferable[] = [];
      for (const name of m.outputs ?? s.outputNames) {
        const t = out[name];
        const data = t.data as Float32Array;
        result[name] = { data, dims: t.dims };
        transfer.push(data.buffer);
      }
      post({ type: 'done', id: m.id, result, ms: performance.now() - t0 }, transfer);
    }
  } catch (err) {
    post({ type: 'error', id: 'id' in m ? m.id : undefined, message: String((err as Error)?.message ?? err) });
  }
};
