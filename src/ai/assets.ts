/**
 * Файлы ИИ на устройстве: модель и движок ONNX Runtime.
 *
 * Лежат рядом с приложением (папка ai/, готовит scripts/prepare-ai.mjs) и скачиваются
 * только по просьбе пользователя — один раз. Хранятся в Cache Storage отдельно от
 * service worker: обновление приложения их не стирает, офлайн они доступны.
 * После скачивания каждый файл проверяется по SHA-256 из manifest.json.
 */
import type { AiProgress } from './types';

export interface AiManifest {
  version: string;
  files: { name: string; size: number; sha256: string }[];
}

export class AiAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiAssetError';
  }
}

const CACHE = 'w-studio-ai-v1';
const BASE = new URL('ai/', document.baseURI);
let manifestPromise: Promise<AiManifest> | null = null;

function hasCacheApi(): boolean {
  return typeof caches !== 'undefined';
}

/** Описание файлов: из сети, а без сети — из кэша (сохраняется вместе с файлами). */
export function aiManifest(): Promise<AiManifest> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const url = new URL('manifest.json', BASE).href;
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) return (await res.json()) as AiManifest;
      } catch {
        /* нет сети — ниже пробуем кэш */
      }
      if (hasCacheApi()) {
        const hit = await (await caches.open(CACHE)).match(url);
        if (hit) return (await hit.json()) as AiManifest;
      }
      throw new AiAssetError('Нет соединения с интернетом. Модель скачивается один раз — подключитесь к сети и повторите.');
    })().catch((e) => {
      manifestPromise = null;
      throw e;
    });
  }
  return manifestPromise;
}

export function totalSize(m: AiManifest): number {
  return m.files.reduce((a, f) => a + f.size, 0);
}

const keyFor = (m: AiManifest, name: string) => new URL(`${name}?v=${encodeURIComponent(m.version)}`, BASE).href;

/** Скачаны ли все файлы текущей версии. */
export async function aiAssetsReady(): Promise<boolean> {
  if (!hasCacheApi()) return false;
  try {
    const m = await aiManifest();
    const cache = await caches.open(CACHE);
    for (const f of m.files) if (!(await cache.match(keyFor(m, f.name)))) return false;
    return true;
  } catch {
    return false;
  }
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Скачать недостающие файлы с прогрессом. Уже скачанные пропускаются. */
export async function downloadAiAssets(onProgress: (p: AiProgress) => void, signal: AbortSignal): Promise<void> {
  if (!hasCacheApi()) throw new AiAssetError('Браузер не даёт сохранить модель на устройстве (нужен HTTPS и обычный, не приватный режим).');
  const m = await aiManifest();
  const cache = await caches.open(CACHE);
  const total = totalSize(m);
  let done = 0;
  for (const f of m.files) {
    const key = keyFor(m, f.name);
    if (await cache.match(key)) {
      done += f.size;
      continue;
    }
    let res: Response;
    try {
      res = await fetch(new URL(f.name, BASE).href, { signal, cache: 'no-store' });
    } catch (e) {
      if (signal.aborted) throw e;
      throw new AiAssetError('Скачивание прервалось: нет соединения. Повторите, когда появится интернет.');
    }
    if (!res.ok || !res.body) throw new AiAssetError(`Сервер не отдал файл модели (${res.status}).`);
    const buf = new Uint8Array(f.size);
    let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      if (got + value.length > f.size) throw new AiAssetError('Файл модели больше ожидаемого — скачивание отменено.');
      buf.set(value, got);
      got += value.length;
      onProgress({ value: (done + got) / total, label: `Скачиваю модель… ${Math.round((done + got) / 1e6)} из ${Math.round(total / 1e6)} МБ` });
    }
    if (got !== f.size || (await sha256(buf.buffer)) !== f.sha256) throw new AiAssetError('Файл модели скачался с ошибкой. Повторите попытку.');
    try {
      await cache.put(key, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } }));
    } catch (e) {
      if ((e as DOMException)?.name === 'QuotaExceededError') throw new AiAssetError('На устройстве не хватает места для модели (~56 МБ).');
      throw new AiAssetError('Не удалось сохранить модель на устройстве.');
    }
    done += f.size;
  }
  await cache.put(new URL('manifest.json', BASE).href, new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/json' } }));
  // Старые версии файлов больше не нужны
  for (const req of await cache.keys()) {
    const u = new URL(req.url);
    if (u.searchParams.has('v') && u.searchParams.get('v') !== m.version) await cache.delete(req);
  }
}

export async function readAiAsset(name: string): Promise<ArrayBuffer> {
  const m = await aiManifest();
  const hit = hasCacheApi() ? await (await caches.open(CACHE)).match(keyFor(m, name)) : undefined;
  if (!hit) throw new AiAssetError('Модель не скачана.');
  return hit.arrayBuffer();
}

export async function deleteAiAssets(): Promise<void> {
  if (hasCacheApi()) await caches.delete(CACHE);
}
