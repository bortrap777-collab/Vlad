/**
 * Web Worker распознавания речи: Whisper (ONNX Runtime Web, WASM).
 * Весь цикл — спектрограмма, кодировщик, пошаговый декодер — внутри воркера,
 * поэтому интерфейс не подвисает и кэш декодера не гоняется между потоками.
 */
import * as ort from 'onnxruntime-web/wasm';
import { Whisper, WhisperTokenizer, type GenerationConfig, type OrtLike, type OrtSession } from './whisper/whisper';

type In =
  | { type: 'init'; wasm: ArrayBuffer; encoder: ArrayBuffer; decoder: ArrayBuffer; vocab: string; generation: string }
  | { type: 'run'; id: number; audio: Float32Array; language: string };

let model: Whisper | null = null;
let cancelled = false;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      ort.env.wasm.wasmBinary = m.wasm;
      // Потоки WASM требуют cross-origin isolation, которой нет на GitHub Pages
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      ort.env.wasm.proxy = false;
      const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' as const };
      const encoder = await ort.InferenceSession.create(m.encoder, opts);
      const decoder = await ort.InferenceSession.create(m.decoder, opts);
      const meta = (decoder as unknown as { inputMetadata?: { name: string; shape?: (number | string)[] }[] }).inputMetadata?.find?.((x) => x.name === 'past_key_values.0.decoder.key');
      const dims = meta?.shape && typeof meta.shape[1] === 'number' && typeof meta.shape[3] === 'number' ? { heads: meta.shape[1], headDim: meta.shape[3] } : undefined;
      model = new Whisper(ort as unknown as OrtLike, encoder as unknown as OrtSession, decoder as unknown as OrtSession, JSON.parse(m.generation) as GenerationConfig, new WhisperTokenizer(JSON.parse(m.vocab)), dims);
      post({ type: 'ready' });
      return;
    }
    if (m.type === 'run') {
      if (!model) throw new Error('Модель не загружена');
      cancelled = false;
      const t0 = performance.now();
      const r = await model.transcribe(m.audio, {
        language: m.language,
        onProgress: (value, label) => post({ type: 'progress', id: m.id, value, label }),
        isCancelled: () => cancelled,
      });
      post({ type: 'result', id: m.id, segments: r.segments, language: r.language, ms: performance.now() - t0 });
    }
  } catch (err) {
    post({ type: 'error', id: 'id' in m ? m.id : undefined, message: String((err as Error)?.message ?? err) });
  }
};
