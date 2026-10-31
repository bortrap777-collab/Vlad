/**
 * Локальное хранилище проектов (IndexedDB).
 *  - `projects` — лёгкие метаданные (быстрый список);
 *  - `files` + `chunks` — исходные файлы, разрезанные на куски по 8 МБ (ArrayBuffer).
 *    Не храним Blob целиком: в Safari/WebKit Blob из IndexedDB после перезапуска
 *    бывает нечитаем, а ссылки на него не открываются. Обычные байты читаются всегда.
 *  - `media` — старый формат (этапы 1–4), переносится в куски при первом открытии.
 */
import { editMediaIds, type PhotoEdits } from '../features/photo/pipeline';
import type { SourceMeta, Timeline } from '../features/video/model';
import { diskCopyBroken, opfsClear, opfsDelete, opfsRead, opfsSupported, opfsWrite } from './fileStore';

export type ProjectKind = 'video' | 'photo';

export interface ProjectMeta {
  id: string;
  kind: ProjectKind;
  name: string;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  /** Длительность видео в секундах */
  duration?: number;
  /** Маленькое превью (JPEG data URL) */
  thumb?: string;
  /** Кадры для временной шкалы (JPEG data URL) */
  frames?: string[];
  /** Параметры фоторедактора */
  photoEdits?: PhotoEdits;
  /** Видео: все исходные файлы проекта (клипы и музыка). Первый имеет id проекта. */
  sources?: SourceMeta[];
  /** Видео: монтаж */
  timeline?: Timeline;
}

const DB_NAME = 'w-studio';
const DB_VERSION = 2;
const CHUNK = 8 * 1024 * 1024;

interface FileRecord {
  id: string;
  type: string;
  size: number;
  chunks: number;
  savedAt: number;
  /** Где лежат байты: на диске (OPFS) или кусками в IndexedDB (по умолчанию) */
  store?: 'opfs' | 'idb';
}

const OPFS_OFF = 'ws.opfsOff';
function opfsEnabled(): boolean {
  if (!opfsSupported()) return false;
  try {
    return localStorage.getItem(OPFS_OFF) !== '1';
  } catch {
    return true;
  }
}
/** На этом устройстве файлы с диска не открылись — дальше храним по-старому */
function disableOpfs(reason: string): void {
  try {
    localStorage.setItem(OPFS_OFF, '1');
  } catch {
    /* ничего */
  }
  console.warn('OPFS отключено:', reason);
}

async function putRecord(rec: FileRecord): Promise<void> {
  await tx<void>(['files'], 'readwrite', (t) => {
    t.objectStore('files').put(rec);
  });
}

/** Записать на диск и убедиться, что файл читается. true — получилось. */
async function tryOpfs(id: string, blob: Blob, onProgress?: (v: number) => void): Promise<boolean> {
  if (!opfsEnabled() || blob.size === 0) return false;
  try {
    await opfsWrite(id, blob, onProgress);
    const f = await opfsRead(id, blob.size, blob.type);
    if (!f) throw new Error('файл не прочитался после записи');
    if (await diskCopyBroken(blob, f)) {
      disableOpfs('файл с диска не открывается');
      await opfsDelete(id);
      return false;
    }
    await putRecord({ id, type: blob.type, size: blob.size, chunks: 0, savedAt: Date.now(), store: 'opfs' });
    return true;
  } catch (e) {
    await opfsDelete(id);
    if ((e as DOMException)?.name === 'QuotaExceededError') throw new StorageError(explain(e), e);
    console.warn('OPFS: запись не удалась, сохраняю по-старому', e);
    return false;
  }
}
const chunkKey = (id: string, i: number) => `${id}|${String(i).padStart(6, '0')}`;
let dbPromise: Promise<IDBDatabase> | null = null;

export class StorageError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'StorageError';
  }
}

function explain(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === 'QuotaExceededError') return 'На устройстве не хватает места для сохранения файла. Освободите место или удалите старые проекты.';
  if (name === 'InvalidStateError' || name === 'UnknownError') return 'Браузер запретил локальное хранилище. В приватном режиме Safari проекты не сохраняются.';
  return 'Не удалось обратиться к локальному хранилищу.';
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new StorageError('Этот браузер не поддерживает IndexedDB.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        const s = db.createObjectStore('projects', { keyPath: 'id' });
        s.createIndex('openedAt', 'openedAt');
      }
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(new StorageError(explain(req.error), req.error));
    req.onblocked = () => reject(new StorageError('Хранилище занято другой вкладкой Ws. Закройте её и повторите.'));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let result: T;
        const t = db.transaction(stores, mode);
        const req = run(t);
        if (req) req.onsuccess = () => (result = req.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(new StorageError(explain(t.error), t.error));
        t.onabort = () => reject(new StorageError(explain(t.error), t.error));
      }),
  );
}

export function newId(): string {
  return (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ?? `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await tx<ProjectMeta[]>(['projects'], 'readonly', (t) => t.objectStore('projects').getAll());
  return (all ?? []).sort((a, b) => b.openedAt - a.openedAt);
}

export function getProject(id: string): Promise<ProjectMeta | undefined> {
  return tx<ProjectMeta | undefined>(['projects'], 'readonly', (t) => t.objectStore('projects').get(id));
}

/* ---------------- файлы проекта ---------------- */

function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

/**
 * Сохранить файл: на диск (OPFS), а если нельзя — кусками в IndexedDB.
 * Метка `files` пишется последней — значит, файл записан целиком.
 */
export async function putMedia(id: string, blob: Blob, onProgress?: (v: number) => void): Promise<void> {
  await deleteMediaData(id);
  if (await tryOpfs(id, blob, onProgress)) return;
  await putChunks(id, blob, onProgress);
}

async function putChunks(id: string, blob: Blob, onProgress?: (v: number) => void): Promise<void> {
  const n = Math.max(1, Math.ceil(blob.size / CHUNK));
  for (let i = 0; i < n; i++) {
    let buf: ArrayBuffer;
    try {
      buf = await readBytes(blob.slice(i * CHUNK, Math.min(blob.size, (i + 1) * CHUNK)));
    } catch (e) {
      throw new StorageError('Не удалось прочитать выбранный файл. Попробуйте выбрать его снова.', e);
    }
    await tx<void>(['chunks'], 'readwrite', (t) => {
      t.objectStore('chunks').put(buf, chunkKey(id, i));
    });
    onProgress?.((i + 1) / n);
  }
  await putRecord({ id, type: blob.type, size: blob.size, chunks: n, savedAt: Date.now(), store: 'idb' });
}

const migrating = new Set<string>();
/** Старый проект: перенести файл из кусков на диск в фоне — следующие открытия без нагрузки на память */
function migrateToDisk(id: string, blob: Blob): void {
  if (!opfsEnabled() || migrating.has(id)) return;
  migrating.add(id);
  (async () => {
    try {
      await opfsWrite(id, blob);
      const f = await opfsRead(id, blob.size, blob.type);
      if (!f) throw new Error('не прочитался');
      if (await diskCopyBroken(blob, f)) {
        disableOpfs('файл с диска не открывается');
        throw new Error('не открывается');
      }
      await putRecord({ id, type: blob.type, size: blob.size, chunks: 0, savedAt: Date.now(), store: 'opfs' });
      await tx<void>(['chunks'], 'readwrite', (t) => {
        t.objectStore('chunks').delete(IDBKeyRange.bound(`${id}|`, `${id}|~`));
      });
    } catch {
      await opfsDelete(id);
    } finally {
      migrating.delete(id);
    }
  })();
}

export async function getMedia(id: string): Promise<Blob> {
  const rec = await tx<FileRecord | undefined>(['files'], 'readonly', (t) => t.objectStore('files').get(id));
  if (rec?.store === 'opfs') {
    const f = await opfsRead(id, rec.size, rec.type);
    if (!f) throw new StorageError('Файл проекта не найден на устройстве. Возможно, браузер очистил данные сайта.');
    return f;
  }
  if (rec) {
    let blob = new Blob([], { type: rec.type });
    for (let i = 0; i < rec.chunks; i++) {
      const buf = await tx<ArrayBuffer | undefined>(['chunks'], 'readonly', (t) => t.objectStore('chunks').get(chunkKey(id, i)));
      if (!buf) throw new StorageError('Файл проекта повреждён: часть данных пропала. Удалите проект и создайте заново.');
      // Склеиваем по одному куску — в памяти не бывает двух копий файла
      blob = new Blob([blob, buf], { type: rec.type });
    }
    if (blob.size !== rec.size) throw new StorageError('Файл проекта повреждён: размер не совпадает.');
    migrateToDisk(id, blob);
    return blob;
  }

  // Старый формат: Blob целиком в `media`
  const legacy = await tx<Blob | undefined>(['media'], 'readonly', (t) => t.objectStore('media').get(id));
  if (!legacy) throw new StorageError('Исходный файл проекта не найден. Возможно, браузер очистил данные сайта.');
  try {
    await putMedia(id, legacy);
  } catch {
    throw new StorageError('Safari не смог прочитать файл этого старого проекта. Создайте проект заново — новые проекты хранятся надёжнее.');
  }
  await tx<void>(['media'], 'readwrite', (t) => {
    t.objectStore('media').delete(id);
  }).catch(() => undefined);
  return getMedia(id);
}

async function deleteMediaData(id: string): Promise<void> {
  await opfsDelete(id);
  await tx<void>(['files', 'chunks', 'media'], 'readwrite', (t) => {
    t.objectStore('files').delete(id);
    t.objectStore('chunks').delete(IDBKeyRange.bound(`${id}|`, `${id}|~`));
    t.objectStore('media').delete(id);
  });
}

export async function createProject(meta: ProjectMeta, media: Blob, onProgress?: (v: number) => void): Promise<void> {
  await putMedia(meta.id, media, onProgress);
  await tx<void>(['projects'], 'readwrite', (t) => {
    t.objectStore('projects').put(meta);
  });
}

/** Записать готовые метаданные (импорт проекта с другого устройства) */
export function putProject(meta: ProjectMeta): Promise<void> {
  return tx<void>(['projects'], 'readwrite', (t) => {
    t.objectStore('projects').put(meta);
  });
}

export async function updateProject(id: string, patch: Partial<ProjectMeta>): Promise<ProjectMeta | undefined> {
  const current = await getProject(id);
  if (!current) return undefined;
  const next: ProjectMeta = { ...current, ...patch, id, updatedAt: patch.updatedAt ?? Date.now() };
  await tx<void>(['projects'], 'readwrite', (t) => {
    t.objectStore('projects').put(next);
  });
  return next;
}

export async function deleteProject(id: string): Promise<void> {
  const meta = await getProject(id);
  const mediaIds = new Set(meta ? projectMediaIds(meta) : [id]);
  await tx<void>(['projects'], 'readwrite', (t) => {
    t.objectStore('projects').delete(id);
  });
  for (const m of mediaIds) await deleteMediaData(m);
}

/** Все файлы проекта: исходники, музыка, маска и картинка фона. */
export function projectMediaIds(m: ProjectMeta): string[] {
  const ids = m.kind === 'video' && m.sources?.length ? m.sources.map((s) => s.id) : [m.id];
  return [...new Set([...ids, ...editMediaIds(m.photoEdits)])];
}

export function deleteMedia(mediaId: string): Promise<void> {
  return deleteMediaData(mediaId);
}

export async function clearAll(): Promise<void> {
  await tx<void>(['projects', 'media', 'files', 'chunks'], 'readwrite', (t) => {
    ['projects', 'media', 'files', 'chunks'].forEach((n) => t.objectStore(n).clear());
  });
  await opfsClear();
}

/** Просим браузер не удалять данные при нехватке места (Safari 17+, Chrome). */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e) return null;
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

/* --- Простейшая шина событий: экраны узнают об изменении списка проектов --- */
type Listener = () => void;
const listeners = new Set<Listener>();
export function onProjectsChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notifyProjectsChanged(): void {
  listeners.forEach((fn) => fn());
}
