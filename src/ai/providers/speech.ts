/**
 * Субтитры: распознавание речи Whisper на устройстве.
 * Две модели: быстрая (base, 77 МБ) и точная (small, 249 МБ). Скачиваются один раз.
 */
import { MediaError } from '../../lib/media';
import { aiManifest, ensureAiAssets, packFile, readAiAsset, readAiAssetJoined, type AiPack } from '../assets';
import type { AiProgress } from '../types';
import type { Segment } from '../whisper/whisper';

export type SpeechModel = 'speech' | 'speech-hq';
export type { Segment };

type Out =
  | { type: 'ready' }
  | { type: 'progress'; id: number; value: number; label: string }
  | { type: 'result'; id: number; segments: Segment[]; language: string; ms: number }
  | { type: 'error'; id?: number; message: string };

const IDLE_MS = 60_000;
let worker: Worker | null = null;
let workerPack: SpeechModel | null = null;
let ready: Promise<Worker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

function shutdown() {
  worker?.terminate();
  worker = null;
  workerPack = null;
  ready = null;
}

function explain(message: string): string {
  if (/memory|alloc|OOM|out of bounds|RangeError/i.test(message))
    return 'Не хватило памяти устройства для модели. Закройте другие приложения или выберите быструю модель.';
  return `Распознавание не удалось: ${message}`;
}

function startWorker(pack: SpeechModel): Promise<Worker> {
  if (ready && workerPack === pack) return ready;
  shutdown();
  workerPack = pack;
  ready = (async () => {
    const m = await aiManifest();
    const size = pack === 'speech-hq' ? 'small' : 'base';
    const [encoder, decoder, vocabBuf, genBuf, wasm] = await Promise.all([
      readAiAssetJoined(pack as AiPack, `whisper-${size}-encoder`),
      readAiAssetJoined(pack as AiPack, `whisper-${size}-decoder`),
      readAiAsset(packFile(m, pack as AiPack, 'whisper-vocab')),
      readAiAsset(packFile(m, pack as AiPack, `whisper-${size}-generation`)),
      readAiAsset(packFile(m, pack as AiPack, 'ort-wasm')),
    ]);
    const dec = new TextDecoder();
    const w = new Worker(new URL('../speech.worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    await new Promise<void>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<Out>) => {
        if (e.data.type === 'ready') resolve();
        else if (e.data.type === 'error') reject(new MediaError(explain(e.data.message)));
      };
      w.onerror = (e) => reject(new MediaError(explain(e.message || 'не удалось запустить обработчик')));
      w.postMessage({ type: 'init', wasm, encoder, decoder, vocab: dec.decode(vocabBuf), generation: dec.decode(genBuf) }, [wasm, encoder, decoder]);
    });
    return w;
  })().catch((e) => {
    shutdown();
    throw e;
  });
  return ready;
}

/**
 * Распознать речь. audio — 16 кГц, моно. language — 'ru', 'en', … или 'auto'.
 * Метки времени — в секундах от начала audio.
 */
export async function transcribe(
  audio: Float32Array,
  opts: { language: string; model: SpeechModel; onProgress: (p: AiProgress) => void; signal: AbortSignal },
): Promise<{ segments: Segment[]; language: string; ms: number }> {
  const { onProgress, signal } = opts;
  clearTimeout(idleTimer);
  await ensureAiAssets(opts.model as AiPack, (p) => onProgress({ value: (p.value ?? 0) * 0.5, label: p.label }), signal);
  if (signal.aborted) throw new DOMException('Отменено', 'AbortError');
  onProgress({ value: 0.5, label: 'Загружаю модель в память…' });
  const w = await startWorker(opts.model);
  if (signal.aborted) throw new DOMException('Отменено', 'AbortError');
  const id = ++seq;
  try {
    return await new Promise((resolve, reject) => {
      const onAbort = () => {
        // Расчёт внутри WASM прервать нельзя — останавливаем воркер целиком
        shutdown();
        reject(new DOMException('Отменено', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      w.onmessage = (e: MessageEvent<Out>) => {
        const m = e.data;
        if (m.type === 'progress' && m.id === id) onProgress({ value: 0.55 + m.value * 0.45, label: m.label });
        else if (m.type === 'result' && m.id === id) {
          signal.removeEventListener('abort', onAbort);
          resolve({ segments: m.segments, language: m.language, ms: m.ms });
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
      const copy = audio.slice();
      w.postMessage({ type: 'run', id, audio: copy, language: opts.language }, [copy.buffer]);
    });
  } finally {
    idleTimer = setTimeout(shutdown, IDLE_MS);
  }
}
