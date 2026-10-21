import { useCallback, useEffect, useRef, useState } from 'react';
import { getMedia, getProject, notifyProjectsChanged, updateProject, type ProjectKind, type ProjectMeta } from '../lib/db';
import { importMedia } from './projects';
import { useUi } from '../components/ui';
import { useNav } from './nav';

/**
 * Общая логика редакторов: открыть проект из IndexedDB или импортировать файл,
 * держать object URL на исходник и освобождать его при уходе с экрана.
 */
export function useEditorProject(kind: ProjectKind, projectId?: string) {
  const ui = useUi();
  const nav = useNav();
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!projectId);
  const [error, setError] = useState<string | null>(null);
  const [persisted, setPersisted] = useState(true);
  const urlRef = useRef<string | null>(null);

  const attach = useCallback((m: ProjectMeta, b: Blob) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const u = URL.createObjectURL(b);
    urlRef.current = u;
    setMeta(m);
    setBlob(b);
    setUrl(u);
  }, []);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  // Открытие существующего проекта
  const openedId = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || openedId.current === projectId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const m = await getProject(projectId);
        if (!m) throw new Error('Проект не найден. Возможно, он был удалён.');
        const b = await getMedia(projectId);
        if (cancelled) return;
        openedId.current = projectId;
        attach(m, b);
        setLoading(false);
        if (await updateProject(projectId, { openedAt: Date.now(), updatedAt: m.updatedAt })) notifyProjectsChanged();
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, attach]);

  const importFile = useCallback(
    async (file: File) => {
      setError(null);
      ui.setProgress({ label: 'Открываю файл…', value: 0.05 });
      try {
        const res = await importMedia(file, kind, (label, value) => ui.setProgress({ label, value }));
        openedId.current = res.meta.id;
        attach(res.meta, res.blob);
        setPersisted(res.saved);
        if (res.saved) {
          nav.replace({ name: kind, projectId: res.meta.id });
        } else {
          ui.toast(`Файл открыт, но не сохранён: ${res.saveError}`, 'error');
        }
      } catch (e) {
        ui.toast((e as Error).message, 'error');
      } finally {
        ui.setProgress(null);
      }
    },
    [kind, ui, nav, attach],
  );

  const patch = useCallback(
    async (p: Partial<ProjectMeta>) => {
      setMeta((m) => (m ? { ...m, ...p } : m));
      if (!meta || !persisted) return;
      try {
        await updateProject(meta.id, p);
        notifyProjectsChanged();
      } catch (e) {
        ui.toast((e as Error).message, 'error');
      }
    },
    [meta, persisted, ui],
  );

  return { meta, blob, url, loading, error, persisted, importFile, patch };
}
