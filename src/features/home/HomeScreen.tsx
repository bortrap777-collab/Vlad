import { useNav } from '../../app/nav';
import { useProjects } from '../../app/projects';
import { Icon, LogoMark } from '../../components/Icon';
import { formatTime } from '../../lib/format';
import { ProjectThumb, kindLabel } from '../projects/ProjectThumb';

export function HomeScreen() {
  const nav = useNav();
  const { items, error } = useProjects();
  const recent = (items ?? []).slice(0, 6);

  return (
    <div className="screen screen-scroll home">
      <header className="home-header">
        <h1 className="brand" aria-label="Ws">
          <LogoMark size={44} />
        </h1>
        <button className="icon-btn icon-btn-lg" onClick={() => nav.push({ name: 'settings' })} aria-label="Настройки">
          <Icon name="gear" size={26} />
        </button>
      </header>

      <section className="hero-cards">
        <button className="hero-card hero-video" onClick={() => nav.push({ name: 'video' })}>
          <span className="hero-icon">
            <Icon name="video" size={28} stroke={2} fill />
          </span>
          <span className="hero-text">
            <span className="hero-title">Редактор видео</span>
            <span className="hero-sub">Монтаж, эффекты, музыка</span>
          </span>
          <Icon name="chevronRight" size={22} stroke={2.4} className="hero-chev" />
        </button>

        <button className="hero-card hero-photo" onClick={() => nav.push({ name: 'photo' })}>
          <span className="hero-icon">
            <Icon name="photo" size={28} stroke={2} />
          </span>
          <span className="hero-text">
            <span className="hero-title">Редактор фото</span>
            <span className="hero-sub">Фильтры, ретушь, ИИ-инструменты</span>
          </span>
          <Icon name="chevronRight" size={22} stroke={2.4} className="hero-chev" />
        </button>
      </section>

      <nav className="quick-tiles" aria-label="Разделы">
        <button className="tile" onClick={() => nav.push({ name: 'ai' })}>
          <Icon name="sparkle" size={26} />
          <span>ИИ-инструменты</span>
        </button>
        <button className="tile" onClick={() => nav.push({ name: 'projects' })}>
          <Icon name="folder" size={26} />
          <span>Мои проекты</span>
        </button>
        <button className="tile" onClick={() => nav.push({ name: 'settings' })}>
          <Icon name="gear" size={26} />
          <span>Настройки</span>
        </button>
      </nav>

      <section className="recent">
        <div className="section-head">
          <h2>Недавние проекты</h2>
          {recent.length > 0 && (
            <button className="link-btn" onClick={() => nav.push({ name: 'projects' })}>
              Все <Icon name="chevronRight" size={16} stroke={2.6} />
            </button>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}

        {items === null ? (
          <div className="recent-row">
            {[0, 1, 2].map((i) => (
              <div key={i} className="recent-item">
                <div className="thumb skeleton" />
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="empty-recent">
            <div className="empty-art" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className="empty-title">Пока пусто</p>
            <p className="muted small">Откройте видео или фото — проект появится здесь и сохранится на этом устройстве.</p>
          </div>
        ) : (
          <div className="recent-row">
            {recent.map((p) => (
              <button key={p.id} className="recent-item" onClick={() => nav.push({ name: p.kind, projectId: p.id })}>
                <ProjectThumb p={p} />
                <span className="recent-kind">{kindLabel(p)}</span>
                <span className="recent-meta">{p.kind === 'video' ? formatTime(p.duration) : p.width ? `${p.width}×${p.height}` : ''}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
