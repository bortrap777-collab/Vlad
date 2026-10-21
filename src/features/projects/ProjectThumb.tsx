import type { ProjectMeta } from '../../lib/db';
import { formatTime } from '../../lib/format';
import { Icon } from '../../components/Icon';

export function ProjectThumb({ p, className = '' }: { p: ProjectMeta; className?: string }) {
  return (
    <div className={`thumb ${className}`}>
      {p.thumb ? (
        <img src={p.thumb} alt="" loading="lazy" draggable={false} />
      ) : (
        <div className={`thumb-empty thumb-${p.kind}`}>
          <Icon name={p.kind === 'video' ? 'video' : 'photo'} size={26} />
        </div>
      )}
      {p.kind === 'video' && <span className="thumb-badge">{formatTime(p.duration)}</span>}
    </div>
  );
}

export function kindLabel(p: ProjectMeta): string {
  return p.kind === 'video' ? 'Видео' : 'Фото';
}
