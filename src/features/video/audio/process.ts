/**
 * Звук для дорожек: расшифровка файла и обработка (скорость, тон) с кэшем.
 * Тяжёлый расчёт — в Web Worker; если он недоступен — в основном потоке.
 */
import { decodeAudio } from './ctx';
import { changeSpeedPitch } from './dsp';

type OfflineCtor = typeof OfflineAudioContext;
function offlineCtor(): OfflineCtor | null {
  const w = window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null;
}

function makeBuffer(channels: Float32Array[], rate: number): AudioBuffer {
  const Off = offlineCtor();
  const len = Math.max(1, channels[0]?.length ?? 1);
  const b = Off ? new Off(channels.length || 1, 1, rate).createBuffer(channels.length || 1, len, rate) : new AudioBuffer({ length: len, numberOfChannels: channels.length || 1, sampleRate: rate });
  channels.forEach((c, i) => b.getChannelData(i).set(c));
  return b;
}

const decoded = new Map<string, Promise<AudioBuffer>>();
const processed = new Map<string, Promise<AudioBuffer>>();

/** Звук файла с частотой rate (кэш на время работы приложения) */
export function decodeSource(id: string, read: () => Promise<Blob>, rate: number): Promise<AudioBuffer> {
  const key = `${id}@${rate}`;
  let p = decoded.get(key);
  if (!p) {
    p = (async () => {
      const Off = offlineCtor();
      if (!Off) throw new Error('Браузер не умеет обрабатывать звук.');
      const blob = await read();
      return decodeAudio(new Off(2, 1, rate), await blob.arrayBuffer());
    })();
    p.catch(() => decoded.delete(key));
    decoded.set(key, p);
  }
  return p;
}

const round = (v: number, k = 100) => Math.round(v * k) / k;
export const processKey = (id: string, rate: number, speed = 1, pitch = 0) => `${id}@${rate}|${round(speed)}|${round(pitch, 10)}`;

let worker: Worker | null = null;
let workerFailed = false;
let seq = 0;
const jobs = new Map<number, { resolve: (c: Float32Array[]) => void; reject: (e: Error) => void; progress?: (v: number) => void }>();

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./dsp.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const j = jobs.get(e.data.id);
        if (!j) return;
        if (e.data.progress !== undefined) j.progress?.(e.data.progress);
        else {
          jobs.delete(e.data.id);
          if (e.data.error) j.reject(new Error(e.data.error));
          else j.resolve(e.data.done);
        }
      };
      worker.onerror = () => {
        workerFailed = true;
        jobs.forEach((j) => j.reject(new Error('worker')));
        jobs.clear();
        worker = null;
      };
    } catch {
      workerFailed = true;
      return null;
    }
  }
  return worker;
}

async function runDsp(channels: Float32Array[], speed: number, pitch: number, rate: number, progress?: (v: number) => void): Promise<Float32Array[]> {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise<Float32Array[]>((resolve, reject) => {
        const id = ++seq;
        jobs.set(id, { resolve, reject, progress });
        // Копии каналов: исходный буфер остаётся в кэше
        const copies = channels.map((c) => c.slice());
        w.postMessage({ id, channels: copies, speed, pitch, rate }, copies.map((c) => c.buffer));
      });
    } catch {
      /* в основном потоке */
    }
  }
  await new Promise((r) => setTimeout(r, 0));
  return changeSpeedPitch(channels, speed, pitch, rate, progress);
}

/** Звук дорожки с изменёнными скоростью и тоном (весь файл — обрезка делается при воспроизведении) */
export function processedSource(id: string, read: () => Promise<Blob>, rate: number, speed = 1, pitch = 0, progress?: (v: number) => void): Promise<AudioBuffer> {
  if (Math.abs(speed - 1) < 1e-3 && Math.abs(pitch) < 1e-3) return decodeSource(id, read, rate);
  const key = processKey(id, rate, speed, pitch);
  let p = processed.get(key);
  if (!p) {
    p = (async () => {
      const src = await decodeSource(id, read, rate);
      const ch: Float32Array[] = [];
      for (let i = 0; i < src.numberOfChannels; i++) ch.push(src.getChannelData(i));
      const out = await runDsp(ch, speed, pitch, rate, progress);
      return makeBuffer(out, rate);
    })();
    p.catch(() => processed.delete(key));
    processed.set(key, p);
  }
  return p;
}

/** Освободить память: оставить в кэше только нужные ключи обработки */
export function retainProcessed(keys: Set<string>): void {
  for (const k of [...processed.keys()]) if (!keys.has(k)) processed.delete(k);
}

/** Эхо: свёртка с синтетической импульсной характеристикой */
export function impulseBuffer(ctx: BaseAudioContext, channels: Float32Array[]): AudioBuffer {
  const b = ctx.createBuffer(2, channels[0].length, ctx.sampleRate);
  channels.forEach((c, i) => b.getChannelData(i).set(c));
  return b;
}
