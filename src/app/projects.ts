import { useCallback, useEffect, useState } from 'react';
import { createProject, listProjects, newId, notifyProjectsChanged, onProjectsChanged, type ProjectKind, type ProjectMeta } from '../lib/db';
import { baseName } from '../lib/format';
import { isImageFile, isVideoFile, MediaError, readImageInfo, readVideoInfo } from '../lib/media';
import { DEFAULT_EDITS } from '../features/photo/pipeline';

export function useProjects() {
  const [items, setItems] = useState<ProjectMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    listProjects()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((e: Error) => {
        setItems([]);
        setError(e.message);
      });
  }, []);

  useEffect(() => {
    reload();
    return onProjectsChanged(reload);
  }, [reload]);

  return { items, error, reload };
}

type Report = (label: string, value: number | null) => void;

/**
 * Импорт файла: проверка типа → чтение метаданных → превью → запись в IndexedDB.
 * Если запись не удалась (нет места, приватный режим), проект всё равно
 * открывается в текущей сессии — это отражается флагом `saved`.
 */
export async function importMedia(file: File, kind: ProjectKind, report: Report): Promise<{ meta: ProjectMeta; blob: Blob; saved: boolean; saveError?: string }> {
  if (kind === 'video' && !isVideoFile(file)) throw new MediaError('Это не видеофайл. Выберите видео из галереи или «Файлов».');
  if (kind === 'photo' && !isImageFile(file)) throw new MediaError('Это не изображение. Выберите фото из галереи или «Файлов».');

  report('Читаю файл…', 0.15);
  const info = kind === 'video' ? await readVideoInfo(file) : await readImageInfo(file);
  report('Создаю превью…', 0.55);

  const now = Date.now();
  const meta: ProjectMeta = {
    id: newId(),
    kind,
    name: baseName(file.name),
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    mime: file.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
    size: file.size,
    width: info.width,
    height: info.height,
    duration: info.duration,
    thumb: info.thumb,
    photoEdits: kind === 'photo' ? { ...DEFAULT_EDITS } : undefined,
  };

  report('Сохраняю проект на устройстве…', 0.75);
  try {
    await createProject(meta, file.type ? file : new Blob([file], { type: meta.mime }), (v) => report('Сохраняю проект на устройстве…', 0.75 + v * 0.24));
    notifyProjectsChanged();
    report('Готово', 1);
    return { meta, blob: file, saved: true };
  } catch (e) {
    return { meta, blob: file, saved: false, saveError: (e as Error).message };
  }
}
