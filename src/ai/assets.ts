/**
 * Файлы ИИ на устройстве: модели и движок ONNX Runtime.
 *
 * Лежат рядом с приложением (папка ai/, готовит scripts/prepare-ai.mjs) и скачиваются
 * только при первом использовании инструмента — один раз. Хранятся в Cache Storage отдельно от
 * service worker: обновление приложения их не стирает, офлайн они доступны.
 * После скачивания каждый файл проверяется по SHA-256 из manifest.json.
 *
 * Файлы разбиты на наборы (packs): каждый инструмент скачивает только своё,
 * общий движок скачивается один раз.
 */
import type { AiProgress } from './types';

/** segment — удаление фона, select — выделение касанием, erase — удаление объектов */
export type AiPack = 'segment' | 'select' | 'erase';
export const AI_PACKS: AiPack[] = ['segment', 'select', 'erase'];

export interface AiFile {
  name: string;
  size: number;
  sha256: string;
  packs: AiPack[];
}

export interface AiManifest {
  files: AiFile[];
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

export function packFiles(m: AiManifest, pack: AiPack): AiFile[] {
  return m.files.filter((f) => f.packs?.includes(pack));
}

export function packSize(m: AiManifest, pack: AiPack): number {
  return packFiles(m, pack).reduce((a, f) => a + f.size, 0);
}

/** Файл набора по расширению/началу имени — чтобы код не зависел от версий в именах */
export function packFile(m: AiManifest, pack: AiPack, prefix: string): string {
  const f = packFiles(m, pack).find((x) => x.name.startsWith(prefix));
  if (!f) throw new AiAssetError('Файлы модели не найдены. Обновите приложение.');
  return f.name;
}

const keyFor = (f: AiFile) => new URL(`${f.name}?sha=${f.sha256.slice(0, 16)}`, BASE).href;

/** Скачаны ли все файлы набора (текущих версий). */
export async function aiAssetsReady(pack: AiPack): Promise<boolean> {
  if (!hasCacheApi()) return false;
  try {
    const m = await aiManifest();
    const files = packFiles(m, pack);
    if (!files.length) return false;
    const cache = await caches.open(CACHE);
    for (const f of files) if (!(await cache.match(keyFor(f)))) return false;
    return true;
  } catch {
    return false;
  }
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Файл, скачанный версией 0.5 (ключ ?v=…), не качаем заново, если он тот же */
async function fromLegacy(cache: Cache, f: AiFile): Promise<Uint8Array<ArrayBuffer> | null> {
  const old = await cache.match(new URL(f.name, BASE).href, { ignoreSearch: true });
  if (!old) return null;
  const buf = new Uint8Array(await old.arrayBuffer());
  return buf.length === f.size && (await sha256(buf.buffer)) === f.sha256 ? buf : null;
}

/** Скачать недостающие файлы набора с прогрессом. Уже скачанные пропускаются. */
export async function downloadAiAssets(pack: AiPack, onProgress: (p: AiProgress) => void, signal: AbortSignal): Promise<void> {
  if (!hasCacheApi()) throw new AiAssetError('Браузер не даёт сохранить модель на устройстве (нужен HTTPS и обычный, не приватный режим).');
  const m = await aiManifest();
  const cache = await caches.open(CACHE);
  const files = packFiles(m, pack);
  const total = packSize(m, pack);
  let done = 0;
  for (const f of files) {
    const key = keyFor(f);
    if (await cache.match(key)) {
      done += f.size;
      continue;
    }
    let buf = await fromLegacy(cache, f);
    if (!buf) {
      let res: Response;
      try {
        res = await fetch(new URL(f.name, BASE).href, { signal, cache: 'no-store' });
      } catch (e) {
        if (signal.aborted) throw e;
        throw new AiAssetError('Скачивание прервалось: нет соединения. Повторите, когда появится интернет.');
      }
      if (!res.ok || !res.body) throw new AiAssetError(`Сервер не отдал файл модели (${res.status}).`);
      const fresh = new Uint8Array(f.size);
      buf = fresh;
      let got = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        if (got + value.length > f.size) throw new AiAssetError('Файл модели больше ожидаемого — скачивание отменено.');
        fresh.set(value, got);
        got += value.length;
        onProgress({ value: (done + got) / total, label: `Скачиваю модель… ${Math.round((done + got) / 1e6)} из ${Math.round(total / 1e6)} МБ` });
      }
      if (got !== f.size || (await sha256(fresh.buffer)) !== f.sha256) throw new AiAssetError('Файл модели скачался с ошибкой. Повторите попытку.');
    }
    try {
      await cache.put(key, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } }));
    } catch (e) {
      if ((e as DOMException)?.name === 'QuotaExceededError') throw new AiAssetError(`На устройстве не хватает места для модели (~${Math.round(total / 1e6)} МБ).`);
      throw new AiAssetError('Не удалось сохранить модель на устройстве.');
    }
    done += f.size;
  }
  await cache.put(new URL('manifest.json', BASE).href, new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/json' } }));
  // Старые версии файлов больше не нужны
  const current = new Set(m.files.map(keyFor));
  current.add(new URL('manifest.json', BASE).href);
  for (const req of await cache.keys()) if (!current.has(req.url)) await cache.delete(req);
}

/** Скачать набор, если ещё не скачан, — с прогрессом «один раз». */
export async function ensureAiAssets(pack: AiPack, onProgress: (p: AiProgress) => void, signal: AbortSignal): Promise<void> {
  if (await aiAssetsReady(pack)) return;
  onProgress({ value: 0, label: 'Скачиваю модель (один раз)…' });
  await downloadAiAssets(pack, onProgress, signal);
}

export async function readAiAsset(name: string): Promise<ArrayBuffer> {
  const m = await aiManifest();
  const f = m.files.find((x) => x.name === name);
  const hit = f && hasCacheApi() ? await (await caches.open(CACHE)).match(keyFor(f)) : undefined;
  if (!hit) throw new AiAssetError('Модель не скачана.');
  return hit.arrayBuffer();
}

/** Удалить файлы набора; общие файлы остаются, если нужны другому скачанному набору. */
export async function deleteAiAssets(pack: AiPack): Promise<void> {
  if (!hasCacheApi()) return;
  const m = await aiManifest();
  const keep = new Set<string>();
  for (const p of AI_PACKS) if (p !== pack && (await aiAssetsReady(p))) packFiles(m, p).forEach((f) => keep.add(f.name));
  const cache = await caches.open(CACHE);
  for (const f of packFiles(m, pack)) if (!keep.has(f.name)) await cache.delete(keyFor(f));
}
