/**
 * Локальное хранилище проектов (IndexedDB).
 * Два хранилища: `projects` — лёгкие метаданные (быстрый список),
 * `media` — исходные файлы (Blob), читаются только при открытии проекта.
 */
import type { PhotoEdits } from '../features/photo/pipeline';
import type { SourceMeta, Timeline } from '../features/video/model';

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
const DB_VERSION = 1;
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
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(new StorageError(explain(req.error), req.error));
    req.onblocked = () => reject(new StorageError('Хранилище занято другой вкладкой W Studio. Закройте её и повторите.'));
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

export async function getMedia(id: string): Promise<Blob> {
  const blob = await tx<Blob | undefined>(['media'], 'readonly', (t) => t.objectStore('media').get(id));
  if (!blob) throw new StorageError('Исходный файл проекта не найден. Возможно, браузер очистил данные сайта.');
  return materialize(blob);
}

/**
 * Safari/WebKit на iPhone (и встроенные браузеры приложений) не открывает
 * object URL у Blob, прочитанного из IndexedDB: картинка не грузится.
 * Поэтому копируем данные в обычный Blob в памяти.
 */
function needsMaterialize(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const desktopSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|Android/.test(ua);
  return iOS || desktopSafari;
}

async function materialize(blob: Blob): Promise<Blob> {
  // В Chrome/Android ссылки на Blob из IndexedDB работают — не тратим память на копию.
  if (!needsMaterialize()) return blob;
  try {
    const buf = typeof blob.arrayBuffer === 'function' ? await blob.arrayBuffer() : await readWithFileReader(blob);
    if (!buf.byteLength) throw new Error('empty');
    return new Blob([buf], { type: blob.type });
  } catch {
    throw new StorageError('Не удалось прочитать файл проекта с устройства. Возможно, браузер очистил данные. Откройте файл заново.');
  }
}

function readWithFileReader(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

export function createProject(meta: ProjectMeta, media: Blob): Promise<void> {
  return tx<void>(['projects', 'media'], 'readwrite', (t) => {
    t.objectStore('media').put(media, meta.id);
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
  const mediaIds = new Set([id, ...(meta?.sources ?? []).map((s) => s.id)]);
  return tx<void>(['projects', 'media'], 'readwrite', (t) => {
    t.objectStore('projects').delete(id);
    mediaIds.forEach((m) => t.objectStore('media').delete(m));
  });
}

/** Дополнительный файл проекта (второй клип, музыка) */
export function putMedia(mediaId: string, blob: Blob): Promise<void> {
  return tx<void>(['media'], 'readwrite', (t) => {
    t.objectStore('media').put(blob, mediaId);
  });
}

export function deleteMedia(mediaId: string): Promise<void> {
  return tx<void>(['media'], 'readwrite', (t) => {
    t.objectStore('media').delete(mediaId);
  });
}

export function clearAll(): Promise<void> {
  return tx<void>(['projects', 'media'], 'readwrite', (t) => {
    t.objectStore('projects').clear();
    t.objectStore('media').clear();
  });
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
