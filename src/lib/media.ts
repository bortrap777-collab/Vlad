/**
 * Чтение метаданных и превью медиафайлов в браузере, без сервера.
 * Учтены особенности Safari на iPhone: playsInline + muted, ожидание
 * loadeddata перед перемоткой, тайм-ауты на случай неподдерживаемого кодека.
 */

export interface MediaInfo {
  width: number;
  height: number;
  duration?: number;
  thumb?: string;
}

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

const THUMB = 320;

function canvasToJpeg(source: CanvasImageSource, sw: number, sh: number, maxSide: number, quality = 0.78): string {
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(source, 0, 0, w, h);
  return c.toDataURL('image/jpeg', quality);
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new MediaError(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new MediaError('Не удалось открыть изображение. Формат не поддерживается этим браузером.'));
    img.src = url;
  });
}

export async function readImageInfo(blob: Blob): Promise<MediaInfo> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await withTimeout(loadImage(url), 20000, 'Изображение открывается слишком долго.');
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    return { width, height, thumb: canvasToJpeg(img, width, height, THUMB) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function createProbeVideo(url: string): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.src = url;
  return v;
}

function once(el: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new MediaError('Браузер не может воспроизвести этот видеофайл. Попробуйте MP4 (H.264).'));
    };
    const cleanup = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener('error', fail);
    };
    el.addEventListener(event, ok);
    el.addEventListener('error', fail);
  });
}

async function seek(v: HTMLVideoElement, time: number): Promise<void> {
  const done = once(v, 'seeked');
  v.currentTime = time;
  await withTimeout(done, 6000, 'Перемотка видео не удалась.');
}

export async function readVideoInfo(blob: Blob): Promise<MediaInfo> {
  const url = URL.createObjectURL(blob);
  const v = createProbeVideo(url);
  try {
    const meta = once(v, 'loadedmetadata');
    v.load();
    await withTimeout(meta, 20000, 'Видео открывается слишком долго. Возможно, формат не поддерживается.');
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    const info: MediaInfo = { width: v.videoWidth, height: v.videoHeight, duration };
    try {
      if (v.readyState < 2) await withTimeout(once(v, 'loadeddata'), 8000, 'нет кадра');
      await seek(v, Math.min(0.5, duration / 3 || 0));
      info.thumb = canvasToJpeg(v, v.videoWidth, v.videoHeight, THUMB);
    } catch {
      /* превью необязательно — проект всё равно создаётся */
    }
    return info;
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Кадры для временной шкалы. Вызывается в фоне, сообщает прогресс.
 * Отменяется через AbortSignal, чтобы не держать память при уходе с экрана.
 */
export async function extractFrames(
  blob: Blob,
  count: number,
  onFrame: (index: number, dataUrl: string) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const url = URL.createObjectURL(blob);
  const v = createProbeVideo(url);
  const frames: string[] = [];
  try {
    const meta = once(v, 'loadedmetadata');
    v.load();
    await withTimeout(meta, 20000, 'Видео не загрузилось.');
    if (v.readyState < 2) await withTimeout(once(v, 'loadeddata'), 8000, 'Не удалось получить кадр.');
    const d = v.duration || 0;
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) break;
      const t = d * ((i + 0.5) / count);
      await seek(v, Math.min(t, Math.max(0, d - 0.05)));
      const frame = canvasToJpeg(v, v.videoWidth, v.videoHeight, 120, 0.7);
      frames.push(frame);
      onFrame(i, frame);
      // Отдаём управление интерфейсу между кадрами.
      await new Promise((r) => setTimeout(r, 0));
    }
    return frames;
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

export function isVideoFile(f: File): boolean {
  return f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name);
}

export function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|gif|avif)$/i.test(f.name);
}

export function isAudioFile(f: File): boolean {
  return f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|oga|flac|caf)$/i.test(f.name);
}

export async function readAudioInfo(blob: Blob): Promise<{ duration: number }> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('audio');
  a.preload = 'metadata';
  a.src = url;
  try {
    const meta = once(a, 'loadedmetadata');
    a.load();
    await withTimeout(meta, 20000, 'Аудиофайл открывается слишком долго.');
    const duration = Number.isFinite(a.duration) ? a.duration : 0;
    if (!duration) throw new MediaError('Не удалось определить длительность аудио.');
    return { duration };
  } catch (e) {
    if (e instanceof MediaError && e.message.includes('видеофайл')) throw new MediaError('Браузер не может воспроизвести этот аудиофайл. Попробуйте MP3 или M4A.');
    throw e;
  } finally {
    a.removeAttribute('src');
    a.load();
    URL.revokeObjectURL(url);
  }
}

/** Сколько кадров брать для полосы на шкале */
export function frameCountFor(duration: number): number {
  return Math.max(6, Math.min(40, Math.round(duration / 1.5)));
}
