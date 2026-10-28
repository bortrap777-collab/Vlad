/**
 * Файлы проектов на диске устройства: Origin Private File System (OPFS).
 *
 * Зачем: раньше при открытии видеопроекта каждый исходник целиком собирался в
 * оперативной памяти из кусков IndexedDB. Несколько больших роликов с iPhone
 * (4K HEVC — сотни мегабайт) выбивали вкладку по памяти. Файл из OPFS браузер
 * читает с диска по мере надобности, как файл из галереи.
 *
 * Запись идёт в Web Worker через createSyncAccessHandle — так умеют Safari 15.2+
 * и Chrome 102+ (основной поток в Safari писать в OPFS не умеет до Safari 26).
 * Если OPFS нет или запись не удалась, вызывающий код сохраняет файл по-старому.
 */

const DIR = 'media';

export function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function' && typeof Worker !== 'undefined';
}

async function mediaDir(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create });
}

const fileName = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.bin';

/* Исходник воркера — строкой: так он работает и в резервной сборке, и в превью */
const WORKER_SRC = `
self.onmessage = async (e) => {
  const { dir, name, blob } = e.data;
  let h = null;
  try {
    const root = await navigator.storage.getDirectory();
    const d = await root.getDirectoryHandle(dir, { create: true });
    const fh = await d.getFileHandle(name, { create: true });
    h = await fh.createSyncAccessHandle();
    await h.truncate(0);
    const CH = 4 * 1024 * 1024;
    let off = 0;
    while (off < blob.size) {
      const buf = new Uint8Array(await blob.slice(off, Math.min(blob.size, off + CH)).arrayBuffer());
      let written = 0;
      while (written < buf.length) {
        const n = await h.write(written ? buf.subarray(written) : buf, { at: off + written });
        if (!n) throw new Error('запись не удалась');
        written += n;
      }
      off += buf.length;
      self.postMessage({ progress: off / blob.size });
    }
    await h.flush();
    const size = await h.getSize();
    await h.close();
    h = null;
    self.postMessage({ done: true, size });
  } catch (err) {
    try { if (h) await h.close(); } catch (_) {}
    self.postMessage({ error: String((err && err.message) || err) });
  }
};`;

let workerUrl: string | null = null;

export async function opfsWrite(id: string, blob: Blob, onProgress?: (v: number) => void): Promise<void> {
  if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  const w = new Worker(workerUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      w.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.progress != null) onProgress?.(m.progress);
        else if (m.done) {
          if (m.size !== blob.size) reject(new Error(`размер ${m.size} вместо ${blob.size}`));
          else resolve();
        } else if (m.error) reject(new Error(m.error));
      };
      w.onerror = (e) => reject(new Error(e.message || 'воркер записи не запустился'));
      w.postMessage({ dir: DIR, name: fileName(id), blob });
    });
  } catch (e) {
    await opfsDelete(id);
    throw e;
  } finally {
    w.terminate();
  }
}

/** Файл с диска (не копируется в память). null — файла нет или размер не совпал. */
export async function opfsRead(id: string, size: number, type: string): Promise<File | null> {
  try {
    const d = await mediaDir(false);
    const fh = await d.getFileHandle(fileName(id));
    const f = await fh.getFile();
    if (f.size !== size) return null;
    // Тип файла в OPFS не хранится — возвращаем с правильным MIME
    return f.type === type ? f : new File([f], f.name, { type });
  } catch {
    return null;
  }
}

export async function opfsDelete(id: string): Promise<void> {
  try {
    const d = await mediaDir(false);
    await d.removeEntry(fileName(id));
  } catch {
    /* файла нет */
  }
}

export async function opfsClear(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(DIR, { recursive: true });
  } catch {
    /* нечего удалять */
  }
}

/** Открывается ли файл в этом браузере: видео/звук — метаданные, фото — картинка. */
export function canOpen(blob: Blob, timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const type = blob.type || '';
    const isImage = type.startsWith('image/');
    const isMedia = type.startsWith('video/') || type.startsWith('audio/') || type === 'application/octet-stream';
    if (!isImage && !isMedia) return resolve(true);
    const url = URL.createObjectURL(blob);
    let el: HTMLImageElement | HTMLMediaElement;
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (el instanceof HTMLMediaElement) {
        el.removeAttribute('src');
        el.load();
      }
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    const timer = window.setTimeout(() => done(false), timeoutMs);
    if (isImage) {
      const img = new Image();
      el = img;
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = url;
    } else {
      const v = document.createElement(type.startsWith('audio/') ? 'audio' : 'video');
      el = v;
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => done(true);
      v.onerror = () => done(false);
      v.src = url;
    }
  });
}

/**
 * Файл с диска сломан, если оригинал открывается, а копия — нет.
 * Если не открывается и оригинал (формат не поддерживается браузером) — диск ни при чём.
 */
export async function diskCopyBroken(original: Blob, copy: File): Promise<boolean> {
  if (await canOpen(copy)) return false;
  return canOpen(original);
}
