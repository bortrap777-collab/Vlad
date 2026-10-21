import { useCallback, useEffect, useRef, useState } from 'react';
import { getMedia, getProject, newId, notifyProjectsChanged, putMedia, updateProject, type ProjectMeta } from '../../lib/db';
import { baseName } from '../../lib/format';
import { extractFrames, frameCountFor, isAudioFile, isVideoFile, MediaError, readAudioInfo, readVideoInfo } from '../../lib/media';
import { importMedia } from '../../app/projects';
import { useNav } from '../../app/nav';
import { useUi } from '../../components/ui';
import { EMPTY_TIMELINE, type SourceMeta, type Timeline } from './model';

export interface LoadedSource extends SourceMeta {
  url: string;
}

/** Проект этапа 1 (один файл) → многоклиповый проект этапа 3. */
function migrate(m: ProjectMeta): { sources: SourceMeta[]; timeline: Timeline } {
  const sources: SourceMeta[] = m.sources?.length
    ? m.sources
    : [{ id: m.id, kind: 'video', name: m.name, mime: m.mime, size: m.size, duration: m.duration ?? 0, width: m.width, height: m.height, frames: m.frames }];
  const timeline: Timeline = m.timeline
    ? { ...EMPTY_TIMELINE, ...m.timeline }
    : { clips: [{ id: newId(), src: m.id, in: 0, out: m.duration ?? 0, volume: 1 }], music: null, texts: [] };
  return { sources, timeline };
}

export function useVideoProject(projectId?: string) {
  const ui = useUi();
  const nav = useNav();
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [sources, setSources] = useState<Record<string, LoadedSource>>({});
  const [initialTimeline, setInitialTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(!!projectId);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  const metaRef = useRef<ProjectMeta | null>(null);
  metaRef.current = meta;
  const opened = useRef<string | null>(null);

  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  const blobRef = useRef(new Map<string, Blob>());
  const toLoaded = (s: SourceMeta, blob: Blob): LoadedSource => {
    blobRef.current.set(s.id, blob);
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    return { ...s, url };
  };

  /** Кадры для шкалы — в фоне, строго по одному файлу (очередь), с сохранением в проект. */
  const framesQueue = useRef<Promise<void>>(Promise.resolve());
  const ensureFrames = useCallback((s: SourceMeta, blob: Blob) => {
    if (s.kind !== 'video' || s.frames?.length) return;
    framesQueue.current = framesQueue.current.then(() => buildFrames(s, blob));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const buildFrames = async (s: SourceMeta, blob: Blob) => {
    try {
      const frames = await extractFrames(blob, frameCountFor(s.duration), () => undefined);
      setSources((cur) => (cur[s.id] ? { ...cur, [s.id]: { ...cur[s.id], frames } } : cur));
      const m = metaRef.current;
      if (m) {
        const nextSources = (m.sources ?? []).map((x) => (x.id === s.id ? { ...x, frames } : x));
        const thumbPatch = !m.thumb && frames[0] ? { thumb: frames[0] } : {};
        const updated = await updateProject(m.id, { sources: nextSources, ...thumbPatch, updatedAt: m.updatedAt });
        if (updated) setMeta(updated);
      }
    } catch {
      /* шкала без кадров тоже работает */
    }
  };

  const openProject = useCallback(
    async (m: ProjectMeta, firstBlob?: Blob) => {
      const { sources: list, timeline } = migrate(m);
      const loaded: Record<string, LoadedSource> = {};
      const blobs: Record<string, Blob> = {};
      for (const s of list) {
        const b = s.id === m.id && firstBlob ? firstBlob : await getMedia(s.id);
        blobs[s.id] = b;
        loaded[s.id] = toLoaded(s, b);
      }
      const saved = (await updateProject(m.id, { sources: list, timeline, openedAt: Date.now(), updatedAt: m.updatedAt })) ?? { ...m, sources: list, timeline };
      notifyProjectsChanged();
      setMeta(saved);
      setSources(loaded);
      setInitialTimeline(timeline);
      list.forEach((s) => ensureFrames(s, blobs[s.id]));
    },
    [ensureFrames],
  );

  useEffect(() => {
    if (!projectId || opened.current === projectId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const m = await getProject(projectId);
        if (!m) throw new Error('Проект не найден. Возможно, он был удалён.');
        if (cancelled) return;
        opened.current = projectId;
        await openProject(m);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, openProject]);

  /** Первый файл: создаёт проект */
  const importFirst = useCallback(
    async (file: File) => {
      setError(null);
      ui.setProgress({ label: 'Открываю видео…', value: 0.05 });
      try {
        const res = await importMedia(file, 'video', (label, value) => ui.setProgress({ label, value }));
        if (!res.saved) throw new MediaError(`Видео не сохранено на устройстве: ${res.saveError}`);
        opened.current = res.meta.id;
        await openProject(res.meta, res.blob);
        nav.replace({ name: 'video', projectId: res.meta.id });
      } catch (e) {
        ui.toast((e as Error).message, 'error');
      } finally {
        ui.setProgress(null);
      }
    },
    [ui, nav, openProject],
  );

  /** Добавить видео или музыку в существующий проект */
  const addSource = useCallback(
    async (file: File, kind: 'video' | 'audio'): Promise<SourceMeta | null> => {
      const m = metaRef.current;
      if (!m) return null;
      if (kind === 'video' && !isVideoFile(file)) throw new MediaError('Это не видеофайл.');
      if (kind === 'audio' && !isAudioFile(file)) throw new MediaError('Это не аудиофайл. Подойдут MP3, M4A, WAV.');
      ui.setProgress({ label: kind === 'video' ? 'Добавляю клип…' : 'Добавляю музыку…', value: 0.2 });
      try {
        const info = kind === 'video' ? await readVideoInfo(file) : { ...(await readAudioInfo(file)), width: undefined, height: undefined };
        ui.setProgress({ label: 'Сохраняю на устройстве…', value: 0.6 });
        const s: SourceMeta = {
          id: newId(),
          kind,
          name: baseName(file.name),
          mime: file.type || (kind === 'video' ? 'video/mp4' : 'audio/mpeg'),
          size: file.size,
          duration: info.duration ?? 0,
          width: info.width,
          height: info.height,
        };
        const blob = new Blob([file], { type: s.mime });
        await putMedia(s.id, blob);
        const nextSources = [...(metaRef.current?.sources ?? []), s];
        const updated = await updateProject(m.id, { sources: nextSources });
        if (updated) setMeta(updated);
        setSources((cur) => ({ ...cur, [s.id]: toLoaded(s, file) }));
        ensureFrames(s, file);
        return s;
      } finally {
        ui.setProgress(null);
      }
    },
    [ui, ensureFrames],
  );

  const saveTimeline = useCallback(async (timeline: Timeline, duration: number) => {
    const m = metaRef.current;
    if (!m) return;
    try {
      await updateProject(m.id, { timeline, duration });
      notifyProjectsChanged();
    } catch {
      /* сообщение покажет следующая попытка */
    }
  }, []);

  /** Исходный файл для экспорта: из памяти, иначе из хранилища */
  const getBlob = useCallback(async (id: string) => blobRef.current.get(id) ?? getMedia(id), []);

  return { meta, sources, initialTimeline, loading, error, importFirst, addSource, saveTimeline, getBlob };
}
