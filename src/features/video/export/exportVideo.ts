/**
 * Экспорт монтажа в видеофайл на устройстве, без сервера.
 *
 *  1. Звук: сведение (OfflineAudioContext) → AudioEncoder (AAC, иначе Opus, иначе PCM в MOV).
 *  2. Видео: для каждого кадра 30 fps — перемотка нужного исходника на точное время,
 *     отрисовка в canvas (вписывание + титры) → VideoEncoder (H.264, иначе VP9).
 *  3. Сборка файла своим MP4/MOV-сборщиком (mp4.ts).
 *
 * Перемотка по кадрам медленнее простого проигрывания, зато кадры точные,
 * не зависят от нагрузки и экспорт продолжается, если экран на секунду погас.
 */
import { drawTexts, ensureFonts } from '../../photo/render';
import { clipStarts, locate, totalDuration, type Timeline } from '../model';
import type { LoadedSource } from '../useVideoProject';
import { MIX_RATE, mixAudio } from './audioMix';
import { muxMp4, type AudioTrack, type VideoSample } from './mp4';

export type ExportQuality = 'original' | '1080' | '720';
export type AudioCodecChoice = 'mp4a' | 'opus' | 'lpcm';

export interface ExportPlan {
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  audio: AudioCodecChoice | null;
  container: 'mp4' | 'mov';
  notes: string[];
}

export interface ExportResult {
  blob: Blob;
  plan: ExportPlan;
  duration: number;
  warnings: string[];
  seconds: number;
}

export class ExportError extends Error {}

const FPS = 30;
const TIMESCALE = 90000;

export function webCodecsAvailable(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

function targetSize(srcW: number, srcH: number, q: ExportQuality): [number, number] {
  const cap = q === '1080' ? 1080 : q === '720' ? 720 : Infinity;
  const short = Math.min(srcW, srcH);
  const s = short > cap ? cap / short : 1;
  return [even(srcW * s), even(srcH * s)];
}

function bitrateFor(w: number, h: number, fps: number): number {
  return Math.round(Math.min(40e6, Math.max(2.5e6, w * h * fps * 0.11)));
}

async function supportedVideo(w: number, h: number, fps: number): Promise<string | null> {
  const big = w * h > 1920 * 1088;
  const avc = big ? ['avc1.640033', 'avc1.4d0033'] : ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640033'];
  const level = w * h <= 1280 * 720 ? '31' : w * h <= 1920 * 1088 ? '40' : '51';
  const candidates = [...avc, `vp09.00.${level}.08`];
  for (const codec of candidates) {
    try {
      const r = await VideoEncoder.isConfigSupported({
        codec,
        width: w,
        height: h,
        bitrate: bitrateFor(w, h, fps),
        framerate: fps,
        ...(codec.startsWith('avc1') ? { avc: { format: 'avc' as const } } : {}),
      });
      if (r.supported) return codec;
    } catch {
      /* следующий */
    }
  }
  return null;
}

async function supportedAudio(): Promise<AudioCodecChoice> {
  // Тестовый переключатель для проверки запасных путей
  const forced = (window as unknown as { __wsForceAudio?: AudioCodecChoice }).__wsForceAudio;
  if (forced) return forced;
  if (!('AudioEncoder' in window)) return 'lpcm';
  for (const [codec, id] of [
    ['mp4a.40.2', 'mp4a'],
    ['opus', 'opus'],
  ] as const) {
    try {
      const r = await AudioEncoder.isConfigSupported({ codec, sampleRate: MIX_RATE, numberOfChannels: 2, bitrate: 192000 });
      if (r.supported) return id;
    } catch {
      /* следующий */
    }
  }
  return 'lpcm';
}

export function hasAudio(t: Timeline): boolean {
  return t.clips.some((c) => c.volume > 0) || !!(t.music && t.music.volume > 0);
}

export async function planExport(timeline: Timeline, sources: Record<string, LoadedSource>, quality: ExportQuality): Promise<ExportPlan> {
  if (!webCodecsAvailable()) {
    throw new ExportError('Этот браузер не умеет кодировать видео. Нужен iOS 16.4 или новее, либо свежий Chrome.');
  }
  if (!timeline.clips.length) throw new ExportError('Добавьте хотя бы один клип.');
  const first = sources[timeline.clips[0].src];
  const sw = first?.width || 1280;
  const sh = first?.height || 720;
  const notes: string[] = [];
  let [w, h] = targetSize(sw, sh, quality);
  let codec = await supportedVideo(w, h, FPS);
  if (!codec && Math.min(w, h) > 1080) {
    [w, h] = targetSize(sw, sh, '1080');
    codec = await supportedVideo(w, h, FPS);
    if (codec) notes.push('Устройство не кодирует такое разрешение — видео будет 1080p.');
  }
  if (!codec) throw new ExportError('На этом устройстве нет подходящего видеокодировщика.');
  if (codec.startsWith('vp09')) notes.push('H.264 недоступен — видео будет в формате VP9. Его может не открыть приложение «Фото».');

  const audio = hasAudio(timeline) ? await supportedAudio() : null;
  if (audio === 'lpcm') notes.push('Аудиокодировщика нет — звук без сжатия, файл .mov будет крупнее.');
  if (audio === 'opus') notes.push('AAC недоступен — звук в формате Opus.');
  return { width: w, height: h, fps: FPS, codec, bitrate: bitrateFor(w, h, FPS), audio, container: audio === 'lpcm' ? 'mov' : 'mp4', notes };
}

/* ---------------- звук ---------------- */
async function encodeAudio(buffer: AudioBuffer, codec: AudioCodecChoice, signal: AbortSignal, onProgress: (v: number) => void): Promise<AudioTrack> {
  const len = buffer.length;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;

  if (codec === 'lpcm') {
    const out = new Uint8Array(len * 4);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < len; i++) {
      dv.setInt16(i * 4, Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), true);
      dv.setInt16(i * 4 + 2, Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), true);
    }
    onProgress(1);
    return { codec: 'lpcm', sampleRate: MIX_RATE, channels: 2, samples: [{ data: out, duration: len }], pcmFrames: len };
  }

  const chunks: { data: Uint8Array; ts: number; dur: number | null }[] = [];
  let description: Uint8Array | undefined;
  let failure: unknown = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const d = new Uint8Array(chunk.byteLength);
      chunk.copyTo(d);
      chunks.push({ data: d, ts: chunk.timestamp, dur: chunk.duration ?? null });
      const desc = meta?.decoderConfig?.description;
      if (desc && !description) description = desc instanceof ArrayBuffer ? new Uint8Array(desc.slice(0)) : new Uint8Array((desc as ArrayBufferView).buffer.slice(0));
    },
    error: (e) => (failure = e),
  });
  const bitrate = 192000;
  enc.configure({ codec: codec === 'mp4a' ? 'mp4a.40.2' : 'opus', sampleRate: MIX_RATE, numberOfChannels: 2, bitrate });
  const step = 4800;
  for (let off = 0; off < len; off += step) {
    if (signal.aborted) {
      enc.close();
      throw new DOMException('cancelled', 'AbortError');
    }
    if (failure) break;
    const n = Math.min(step, len - off);
    const data = new Float32Array(n * 2);
    data.set(L.subarray(off, off + n), 0);
    data.set(R.subarray(off, off + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: MIX_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off * 1e6) / MIX_RATE), data });
    enc.encode(ad);
    ad.close();
    while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
    onProgress(off / len);
  }
  await enc.flush();
  enc.close();
  if (failure) throw new ExportError('Ошибка кодирования звука: ' + String((failure as Error).message ?? failure));
  if (!chunks.length) throw new ExportError('Кодировщик звука не вернул данных.');

  const frameSize = codec === 'mp4a' ? 1024 : 960;
  const samples = chunks.map((c) => ({ data: c.data, duration: c.dur ? Math.round((c.dur * MIX_RATE) / 1e6) : frameSize }));
  let priming = 0;
  if (codec === 'mp4a') {
    if (chunks[0].ts < 0) priming = Math.round((-chunks[0].ts * MIX_RATE) / 1e6);
    else {
      // Кодировщики Apple добавляют 2112 сэмплов тишины в начало и не сообщают об этом
      const encoded = samples.reduce((a, s) => a + s.duration, 0);
      if (encoded - len >= 2112) priming = 2112;
    }
  }
  return { codec, sampleRate: MIX_RATE, channels: 2, description, bitrate, samples, primingSamples: priming };
}

/* ---------------- видео ---------------- */
function waitSeek(v: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.0005 && v.readyState >= 2) return resolve(true);
    let timer = 0;
    const done = (ok: boolean) => {
      clearTimeout(timer);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('error', onError);
      resolve(ok);
    };
    const onSeeked = () => done(true);
    const onError = () => done(false);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('error', onError);
    timer = window.setTimeout(() => done(false), 8000);
    v.currentTime = t;
  });
}

function waitReady(v: HTMLVideoElement): Promise<void> {
  if (v.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new ExportError('Один из клипов не открывается. Удалите его или добавьте заново.'));
    };
    const cleanup = () => {
      v.removeEventListener('loadedmetadata', ok);
      v.removeEventListener('error', bad);
    };
    v.addEventListener('loadedmetadata', ok);
    v.addEventListener('error', bad);
  });
}

export async function exportVideo(
  timeline: Timeline,
  sources: Record<string, LoadedSource>,
  readSource: (id: string) => Promise<Blob>,
  plan: ExportPlan,
  opts: { signal: AbortSignal; onProgress: (value: number, label: string) => void },
): Promise<ExportResult> {
  const { signal, onProgress } = opts;
  const t0 = performance.now();
  const total = totalDuration(timeline);
  const warnings: string[] = [];
  const abort = () => {
    throw new DOMException('cancelled', 'AbortError');
  };

  let wake: { release: () => Promise<void> } | null = null;
  try {
    wake = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null;
  } catch {
    /* экран может погаснуть — экспорт продолжится после включения */
  }

  // Скрытые видео только для экспорта: плеер на экране не трогаем
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.appendChild(host);
  const els = new Map<string, HTMLVideoElement>();
  const used = [...new Set(timeline.clips.map((c) => c.src))];

  try {
    for (const id of used) {
      const src = sources[id];
      if (!src) throw new ExportError('Исходный файл клипа не найден.');
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.src = src.url;
      host.appendChild(v);
      els.set(id, v);
      // iOS отдаёт кадры в canvas только после первого запуска
      v.play().then(() => v.pause()).catch(() => undefined);
    }

    /* ---- 1. Звук ---- */
    let audioTrack: AudioTrack | null = null;
    if (plan.audio) {
      onProgress(0.01, 'Свожу звук…');
      const mix = await mixAudio(timeline, readSource, signal, (v) => onProgress(0.01 + v * 0.05, 'Свожу звук…'));
      if (mix.failed.length) {
        const names = mix.failed.map((id) => sources[id]?.name ?? 'файл').join(', ');
        warnings.push(`Без звука: ${names} (в файле нет звуковой дорожки или формат не поддерживается).`);
      }
      if (mix.buffer) {
        onProgress(0.06, 'Кодирую звук…');
        audioTrack = await encodeAudio(mix.buffer, plan.audio, signal, (v) => onProgress(0.06 + v * 0.04, 'Кодирую звук…'));
      }
    }
    if (signal.aborted) abort();

    /* ---- 2. Видео ---- */
    await Promise.all([...els.values()].map(waitReady));
    const texts = timeline.texts;
    await ensureFonts(texts);

    const W = plan.width;
    const H = plan.height;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new ExportError('Браузер не дал холст для отрисовки.');
    ctx.imageSmoothingQuality = 'high';

    const samples: VideoSample[] = [];
    let description: Uint8Array | undefined;
    let failure: unknown = null;
    const enc = new VideoEncoder({
      output: (chunk, meta) => {
        const d = new Uint8Array(chunk.byteLength);
        chunk.copyTo(d);
        samples.push({
          data: d,
          pts: Math.round((chunk.timestamp * TIMESCALE) / 1e6),
          duration: Math.round(((chunk.duration ?? 1e6 / plan.fps) * TIMESCALE) / 1e6),
          key: chunk.type === 'key',
        });
        const desc = meta?.decoderConfig?.description;
        if (desc && !description) description = desc instanceof ArrayBuffer ? new Uint8Array(desc.slice(0)) : new Uint8Array((desc as ArrayBufferView).buffer.slice(0));
      },
      error: (e) => (failure = e),
    });
    enc.configure({
      codec: plan.codec,
      width: W,
      height: H,
      bitrate: plan.bitrate,
      framerate: plan.fps,
      latencyMode: 'quality',
      ...(plan.codec.startsWith('avc1') ? { avc: { format: 'avc' as const } } : {}),
    });

    const frames = Math.max(1, Math.round(total * plan.fps));
    const starts = clipStarts(timeline);
    let missed = 0;
    let lastReport = 0;
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) {
        enc.close();
        abort();
      }
      if (failure) break;
      const T = i / plan.fps;
      const loc = locate(timeline, T);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      if (loc) {
        const c = timeline.clips[loc.index];
        const v = els.get(c.src)!;
        const local = Math.min(c.in + (T - starts[loc.index]), Math.max(c.in, (v.duration || c.out) - 0.5 / plan.fps));
        if (!(await waitSeek(v, local))) missed++;
        const vw = v.videoWidth || W;
        const vh = v.videoHeight || H;
        const s = Math.min(W / vw, H / vh);
        const dw = vw * s;
        const dh = vh * s;
        try {
          ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
        } catch {
          missed++;
        }
      }
      const active = texts.filter((t) => T >= t.start && T < t.end);
      if (active.length) drawTexts(ctx, active, W, H);

      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / plan.fps), duration: Math.round(1e6 / plan.fps) });
      enc.encode(frame, { keyFrame: i % (plan.fps * 2) === 0 });
      frame.close();
      while (enc.encodeQueueSize > 5) await new Promise((r) => setTimeout(r, 1));

      const now = performance.now();
      if (now - lastReport > 120 || i === frames - 1) {
        lastReport = now;
        const done = (i + 1) / frames;
        const elapsed = (now - t0) / 1000;
        const left = done > 0.03 ? Math.max(0, Math.round((elapsed / done) * (1 - done))) : null;
        onProgress(0.1 + done * 0.86, `Кадр ${i + 1} из ${frames}${left !== null ? ` · осталось ~${left} с` : ''}`);
      }
    }
    if (!failure) await enc.flush();
    enc.close();
    if (failure) throw new ExportError('Ошибка кодирования видео: ' + String((failure as Error).message ?? failure));
    if (missed > frames * 0.02) warnings.push(`${missed} кадр(ов) не удалось точно прочитать — в этих местах повторён соседний кадр.`);

    /* ---- 3. Файл ---- */
    onProgress(0.97, 'Собираю файл…');
    const blob = muxMp4({
      container: plan.container,
      video: {
        codec: plan.codec.startsWith('avc1') ? 'avc1' : 'vp09',
        width: W,
        height: H,
        timescale: TIMESCALE,
        description,
        vp9: plan.codec.startsWith('vp09') ? { profile: 0, level: Number(plan.codec.split('.')[2]), bitDepth: 8 } : undefined,
        samples,
      },
      audio: audioTrack,
    });
    onProgress(1, 'Готово');
    return { blob, plan, duration: total, warnings, seconds: (performance.now() - t0) / 1000 };
  } finally {
    els.forEach((v) => {
      v.removeAttribute('src');
      v.load();
    });
    host.remove();
    wake?.release().catch(() => undefined);
  }
}
