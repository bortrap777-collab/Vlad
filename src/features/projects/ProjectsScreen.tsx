import { useEffect, useState } from 'react';
import { Sheet, TopBar, useFilePicker, useUi } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useNav } from '../../app/nav';
import { useProjects } from '../../app/projects';
import { deleteProject, notifyProjectsChanged, type ProjectKind, type ProjectMeta } from '../../lib/db';
import { formatBytes, formatDate, formatTime } from '../../lib/format';
import { ProjectThumb } from './ProjectThumb';
import { exportProjectFile, importProjectFile } from './transfer';
import { deliverFile, isAppleMobile, prepareDelivery } from '../../lib/deliver';

const projectSize = (p: ProjectMeta) => (p.sources?.length ? p.sources.reduce((a, s) => a + s.size, 0) : p.size);

type Filter = 'all' | ProjectKind;

export function ProjectsScreen() {
  const nav = useNav();
  const ui = useUi();
  const { items, error } = useProjects();
  const [filter, setFilter] = useState<Filter>('all');
  const [toDelete, setToDelete] = useState<ProjectMeta | null>(null);
  const [transfer, setTransfer] = useState<{ p: ProjectMeta; file?: { blob: Blob; filename: string }; progress: number; label: string; error?: string } | null>(null);

  useEffect(() => prepareDelivery(), []);

  const importPicker = useFilePicker('.zip,application/zip,application/x-zip-compressed', async (f) => {
    ui.setProgress({ label: 'Импорт проекта…', value: 0 });
    try {
      const p = await importProjectFile(f, (value, label) => ui.setProgress({ value, label }));
      ui.toast(`Проект «${p.name}» добавлен`, 'ok');
      nav.push({ name: p.kind, projectId: p.id });
    } catch (e) {
      ui.toast((e as Error).message || 'Не удалось импортировать проект', 'error');
    } finally {
      ui.setProgress(null);
    }
  });

  const startTransfer = async (p: ProjectMeta) => {
    setTransfer({ p, progress: 0, label: 'Готовлю файл…' });
    try {
      const file = await exportProjectFile(p.id, (progress, label) => setTransfer((t) => (t && t.p.id === p.id ? { ...t, progress, label } : t)));
      setTransfer((t) => (t && t.p.id === p.id ? { ...t, file, progress: 1 } : t));
    } catch (e) {
      setTransfer((t) => (t ? { ...t, error: (e as Error).message } : t));
    }
  };

  const saveTransfer = async () => {
    if (!transfer?.file) return;
    try {
      const r = await deliverFile(transfer.file.blob, transfer.file.filename);
      if (r === 'shared' || r === 'saved') ui.toast('Файл проекта готов к переносу', 'ok');
      else if (r === 'downloaded') ui.toast('Файл проекта скачан', 'ok');
      else if (r === 'manual') ui.toast('Здесь браузер не разрешает сохранять файлы. Откройте Ws как приложение.', 'error');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  };

  const list = (items ?? []).filter((p) => filter === 'all' || p.kind === filter);
  const count = (k: Filter) => (items ?? []).filter((p) => k === 'all' || p.kind === k).length;

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteProject(toDelete.id);
      notifyProjectsChanged();
      ui.toast('Проект удалён', 'ok');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
    setToDelete(null);
  };

  return (
    <div className="screen screen-scroll">
      <TopBar
        title="Мои проекты"
        action={
          <button className="btn btn-soft btn-sm" onClick={importPicker.open}>
            <Icon name="download" size={16} /> Импорт
          </button>
        }
      />
      {importPicker.input}
      <div className="page">
        <div className="segmented" role="tablist">
          {(
            [
              ['all', 'Все'],
              ['video', 'Видео'],
              ['photo', 'Фото'],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'is-active' : ''} onClick={() => setFilter(k)}>
              {label} <span className="seg-count">{count(k)}</span>
            </button>
          ))}
        </div>

        {error && <p className="error-text">{error}</p>}

        {items !== null && list.length === 0 ? (
          <div className="empty-block">
            <p className="empty-title">Проектов нет</p>
            <p className="muted small">Начните с видео или фото.</p>
            <div className="empty-actions">
              <button className="btn btn-soft" onClick={() => nav.push({ name: 'video' })}>
                <Icon name="video" size={18} /> Видео
              </button>
              <button className="btn btn-soft" onClick={() => nav.push({ name: 'photo' })}>
                <Icon name="photo" size={18} /> Фото
              </button>
            </div>
          </div>
        ) : (
          <div className="group">
            {list.map((p) => (
              <div key={p.id} className="row project-row">
                <button className="project-open" onClick={() => nav.push({ name: p.kind, projectId: p.id })}>
                  <ProjectThumb p={p} className="thumb-sm" />
                  <span className="row-body">
                    <span className="row-title">{p.name}</span>
                    <span className="row-sub">
                      {p.kind === 'video' ? `Видео · ${formatTime(p.duration)}` : `Фото · ${p.width}×${p.height}`} · {formatBytes(projectSize(p))}
                    </span>
                    <span className="row-sub">Открыт {formatDate(p.openedAt)}</span>
                  </span>
                </button>
                <button className="icon-btn" aria-label={`Перенести ${p.name} на другое устройство`} onClick={() => startTransfer(p)}>
                  <Icon name="upload" size={20} />
                </button>
                <button className="icon-btn" aria-label={`Удалить ${p.name}`} onClick={() => setToDelete(p)}>
                  <Icon name="trash" size={20} />
                </button>
              </div>
            ))}
          </div>
        )}
        {items !== null && items.length > 0 && (
          <p className="muted small transfer-hint">
            <Icon name="info" size={14} /> Чтобы перенести проект на другое устройство, нажмите <Icon name="upload" size={14} /> — получится файл .zip со всеми исходниками. На другом
            устройстве откройте «Мои проекты» → «Импорт».
          </p>
        )}
      </div>

      <Sheet open={!!transfer} onClose={() => (transfer?.file || transfer?.error ? setTransfer(null) : undefined)} title="Перенос проекта">
        {transfer && (
          <div className="feature-sheet">
            <p className="feature-note">«{transfer.p.name}»</p>
            {transfer.error ? (
              <p className="notice-inline">
                <Icon name="info" size={18} /> {transfer.error}
              </p>
            ) : transfer.file ? (
              <>
                <div className="kv">
                  <span>Файл</span>
                  <b>
                    {transfer.file.filename} · {formatBytes(transfer.file.blob.size)}
                  </b>
                </div>
                <p className="muted small">
                  Отправьте файл на другое устройство (AirDrop, «Файлы», мессенджер, облако) и откройте его там в Ws: «Мои проекты» → «Импорт». Монтаж,
                  правки и все исходники сохранятся без потери качества.
                </p>
                <button className="btn btn-primary btn-block" onClick={saveTransfer}>
                  <Icon name="upload" size={18} /> {isAppleMobile() ? 'Поделиться файлом' : 'Сохранить файл'}
                </button>
              </>
            ) : (
              <>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.round(transfer.progress * 100)}%` }} />
                </div>
                <p className="muted small">{transfer.label}</p>
              </>
            )}
            {(transfer.file || transfer.error) && (
              <button className="btn btn-soft btn-block" onClick={() => setTransfer(null)}>
                Закрыть
              </button>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={!!toDelete} onClose={() => setToDelete(null)} title="Удалить проект?">
        <div className="feature-sheet">
          <p className="feature-note">«{toDelete?.name}» и его исходные файлы будут удалены с этого устройства. Оригинал в галерее не пострадает.</p>
          <div className="btn-pair">
            <button className="btn btn-soft" onClick={() => setToDelete(null)}>
              Отмена
            </button>
            <button className="btn btn-danger" onClick={confirmDelete}>
              Удалить
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
