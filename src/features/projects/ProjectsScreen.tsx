import { useState } from 'react';
import { Sheet, TopBar, useUi } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useNav } from '../../app/nav';
import { useProjects } from '../../app/projects';
import { deleteProject, notifyProjectsChanged, type ProjectKind, type ProjectMeta } from '../../lib/db';
import { formatBytes, formatDate, formatTime } from '../../lib/format';
import { ProjectThumb } from './ProjectThumb';

type Filter = 'all' | ProjectKind;

export function ProjectsScreen() {
  const nav = useNav();
  const ui = useUi();
  const { items, error } = useProjects();
  const [filter, setFilter] = useState<Filter>('all');
  const [toDelete, setToDelete] = useState<ProjectMeta | null>(null);

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
      <TopBar title="Мои проекты" />
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
                      {p.kind === 'video' ? `Видео · ${formatTime(p.duration)}` : `Фото · ${p.width}×${p.height}`} · {formatBytes(p.size)}
                    </span>
                    <span className="row-sub">Открыт {formatDate(p.openedAt)}</span>
                  </span>
                </button>
                <button className="icon-btn" aria-label={`Удалить ${p.name}`} onClick={() => setToDelete(p)}>
                  <Icon name="trash" size={20} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={!!toDelete} onClose={() => setToDelete(null)} title="Удалить проект?">
        <div className="feature-sheet">
          <p className="feature-note">«{toDelete?.name}» и его исходный файл будут удалены с этого устройства. Оригинал в галерее не пострадает.</p>
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
