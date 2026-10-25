/**
 * Перенос проекта на другое устройство: один файл .zip
 *   project.json  — описание проекта (правки фото / монтаж видео, превью);
 *   media/N       — исходные файлы без пережатия.
 * При импорте все идентификаторы заменяются новыми, чтобы не пересечься с проектами на устройстве.
 */
import { getMedia, getProject, newId, notifyProjectsChanged, projectMediaIds, putMedia, putProject, deleteMedia, type ProjectMeta } from '../../lib/db';
import { remapEditIds } from '../photo/pipeline';
import { readText, readZip, verifyEntry, writeZip, ZipError, type ZipInput } from '../../lib/zip';

const FORMAT = 'w-studio-project';
const VERSION = 1;

interface Manifest {
  format: typeof FORMAT;
  version: number;
  exportedAt: number;
  project: ProjectMeta;
  media: { id: string; type: string; size: number; file: string }[];
}

export async function exportProjectFile(id: string, onProgress: (v: number, label: string) => void): Promise<{ blob: Blob; filename: string }> {
  const meta = await getProject(id);
  if (!meta) throw new Error('Проект не найден.');
  const ids = projectMediaIds(meta);
  const entries: ZipInput[] = [];
  const media: Manifest['media'] = [];
  for (let i = 0; i < ids.length; i++) {
    onProgress((i / ids.length) * 0.4, `Читаю файлы проекта (${i + 1} из ${ids.length})…`);
    const blob = await getMedia(ids[i]);
    const file = `media/${i + 1}`;
    entries.push({ name: file, data: blob });
    media.push({ id: ids[i], type: blob.type, size: blob.size, file });
  }
  const manifest: Manifest = { format: FORMAT, version: VERSION, exportedAt: Date.now(), project: meta, media };
  entries.unshift({ name: 'project.json', data: new Blob([JSON.stringify(manifest)], { type: 'application/json' }) });
  const blob = await writeZip(entries, (v) => onProgress(0.4 + v * 0.6, 'Упаковываю…'));
  const safe = meta.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'project';
  return { blob, filename: `${safe}.wstudio.zip` };
}

export async function importProjectFile(file: Blob, onProgress: (v: number, label: string) => void): Promise<ProjectMeta> {
  onProgress(0.02, 'Читаю файл…');
  const entries = await readZip(file);
  const mf = entries.find((e) => e.name === 'project.json');
  if (!mf) throw new ZipError('В архиве нет описания проекта W Studio.');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readText(mf));
  } catch {
    throw new ZipError('Описание проекта повреждено.');
  }
  if (manifest.format !== FORMAT) throw new ZipError('Это не проект W Studio.');
  if (manifest.version > VERSION) throw new ZipError('Проект создан в более новой версии W Studio. Обновите приложение.');

  // Новые идентификаторы
  const old = manifest.project;
  const map = new Map<string, string>();
  const idFor = (o: string) => {
    if (!map.has(o)) map.set(o, newId());
    return map.get(o)!;
  };
  const project: ProjectMeta = {
    ...old,
    id: idFor(old.id),
    openedAt: Date.now(),
    updatedAt: Date.now(),
    sources: old.sources?.map((s) => ({ ...s, id: idFor(s.id) })),
    timeline: old.timeline
      ? {
          ...old.timeline,
          clips: old.timeline.clips.map((c) => ({ ...c, src: idFor(c.src) })),
          music: old.timeline.music ? { ...old.timeline.music, src: idFor(old.timeline.music.src) } : null,
        }
      : undefined,
    photoEdits: old.photoEdits ? remapEditIds(old.photoEdits, idFor) : old.photoEdits,
  };

  const total = manifest.media.reduce((a, m) => a + m.size, 0) || 1;
  let done = 0;
  const written: string[] = [];
  try {
    for (const m of manifest.media) {
      const entry = entries.find((e) => e.name === m.file);
      if (!entry || entry.size !== m.size) throw new ZipError('В архиве не хватает файлов проекта.');
      const base = done;
      let checked = 0;
      const ok = await verifyEntry(entry, (n) => {
        checked += n;
        onProgress(0.05 + ((base + checked * 0.5) / total) * 0.9, 'Проверяю файлы…');
      });
      if (!ok) throw new ZipError('Файл проекта повреждён при передаче. Перешлите его заново.');
      const target = idFor(m.id);
      await putMedia(target, new Blob([entry.data], { type: m.type }), (v) => onProgress(0.05 + ((base + m.size * (0.5 + v * 0.5)) / total) * 0.9, 'Сохраняю на устройстве…'));
      written.push(target);
      done += m.size;
    }
    await putProject(project);
  } catch (e) {
    // Ничего не оставляем наполовину
    for (const id of written) await deleteMedia(id).catch(() => undefined);
    throw e;
  }
  notifyProjectsChanged();
  onProgress(1, 'Готово');
  return project;
}
