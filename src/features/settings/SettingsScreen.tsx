import { useEffect, useState } from 'react';
import { Sheet, StageBadge, TopBar, useUi } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useTheme, type ThemePref } from '../../app/theme';
import { usePref } from '../../lib/storage';
import { APP_STAGE, APP_VERSION, FEATURES } from '../../app/features';
import { clearAll, notifyProjectsChanged, requestPersistence, storageEstimate } from '../../lib/db';
import { formatBytes } from '../../lib/format';

type Quality = 'original' | '1080' | '720';
const QUALITY: { id: Quality; title: string; sub: string }[] = [
  { id: 'original', title: 'Оригинал', sub: 'Без потери разрешения' },
  { id: '1080', title: '1080p', sub: 'Баланс качества и размера' },
  { id: '720', title: '720p', sub: 'Меньше файл, быстрее экспорт' },
];

const THEMES: { id: ThemePref; title: string; icon: string }[] = [
  { id: 'auto', title: 'Автоматически', icon: 'auto' },
  { id: 'light', title: 'Светлая', icon: 'sun' },
  { id: 'dark', title: 'Тёмная', icon: 'moon' },
];

export function SettingsScreen() {
  const ui = useUi();
  const { pref, resolved, setPref } = useTheme();
  const [quality, setQuality] = usePref<Quality>('ws.exportQuality', 'original');
  const [sheet, setSheet] = useState<'quality' | 'lang' | 'about' | 'clear' | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [persist, setPersist] = useState<boolean | null>(null);

  useEffect(() => {
    if (sheet !== 'about') return;
    storageEstimate().then(setUsage);
    requestPersistence().then(setPersist);
  }, [sheet]);

  const doClear = async () => {
    try {
      await clearAll();
      notifyProjectsChanged();
      ui.toast('Все проекты удалены', 'ok');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
    setSheet(null);
  };

  return (
    <div className="screen screen-scroll">
      <TopBar title="Настройки" />
      <div className="page">
        <h2 className="group-title">Тема оформления</h2>
        <div className="group" role="radiogroup" aria-label="Тема оформления">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={pref === t.id} className={`row ${pref === t.id ? 'is-selected' : ''}`} onClick={() => setPref(t.id)}>
              <span className="row-icon plain">
                <Icon name={t.icon} size={20} />
              </span>
              <span className="row-body">
                <span className="row-title">{t.title}</span>
                {t.id === 'auto' && <span className="row-sub">Сейчас: {resolved === 'dark' ? 'тёмная' : 'светлая'}</span>}
              </span>
              <span className={`radio ${pref === t.id ? 'is-on' : ''}`}>{pref === t.id && <Icon name="check" size={14} stroke={3} />}</span>
            </button>
          ))}
        </div>

        <div className="group">
          <label className="row switch-row" htmlFor="follow-system">
            <span className="row-body">
              <span className="row-title">Следовать теме устройства</span>
            </span>
            <input
              id="follow-system"
              type="checkbox"
              className="switch"
              checked={pref === 'auto'}
              onChange={(e) => setPref(e.target.checked ? 'auto' : resolved)}
            />
          </label>
        </div>

        <div className="group">
          <button className="row" onClick={() => setSheet('quality')}>
            <span className="row-icon plain">
              <Icon name="quality" size={20} />
            </span>
            <span className="row-body">
              <span className="row-title">Качество экспорта</span>
            </span>
            <span className="row-value">{QUALITY.find((q) => q.id === quality)?.title}</span>
            <Icon name="chevronRight" size={18} className="row-chev" />
          </button>
          <button className="row" onClick={() => setSheet('lang')}>
            <span className="row-icon plain">
              <Icon name="globe" size={20} />
            </span>
            <span className="row-body">
              <span className="row-title">Язык</span>
            </span>
            <span className="row-value">Русский</span>
            <Icon name="chevronRight" size={18} className="row-chev" />
          </button>
          <button className="row" onClick={() => setSheet('about')}>
            <span className="row-icon plain">
              <Icon name="info" size={20} />
            </span>
            <span className="row-body">
              <span className="row-title">О приложении</span>
            </span>
            <span className="row-value">{APP_VERSION}</span>
            <Icon name="chevronRight" size={18} className="row-chev" />
          </button>
        </div>
      </div>

      <Sheet open={sheet === 'quality'} onClose={() => setSheet(null)} title="Качество экспорта">
        <div className="group flush">
          {QUALITY.map((q) => (
            <button key={q.id} className="row" onClick={() => setQuality(q.id)}>
              <span className="row-body">
                <span className="row-title">{q.title}</span>
                <span className="row-sub">{q.sub}</span>
              </span>
              <span className={`radio ${quality === q.id ? 'is-on' : ''}`}>{quality === q.id && <Icon name="check" size={14} stroke={3} />}</span>
            </button>
          ))}
        </div>
        <p className="muted small">Настройка запоминается сейчас и применится, когда появится экспорт видео (этап 4).</p>
      </Sheet>

      <Sheet open={sheet === 'lang'} onClose={() => setSheet(null)} title="Язык">
        <div className="feature-sheet">
          <p className="feature-note">Сейчас интерфейс на русском. Тексты собраны так, чтобы позже добавить английский.</p>
          <button className="btn btn-primary btn-block" onClick={() => setSheet(null)}>
            Понятно
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'about'} onClose={() => setSheet(null)} title="W Studio">
        <div className="feature-sheet">
          <p className="feature-note">
            Версия {APP_VERSION} · этап {APP_STAGE} из 5
          </p>
          <div className="status-list">
            {Object.values(FEATURES).map((f) => (
              <div key={f.title} className="status-item">
                <span>{f.title}</span>
                <StageBadge stage={f.stage} status={f.status} />
              </div>
            ))}
          </div>
          <div className="kv">
            <span>Занято на устройстве</span>
            <b>{usage ? formatBytes(usage.usage) : '—'}</b>
          </div>
          <div className="kv">
            <span>Защита от автоочистки</span>
            <b>{persist === null ? 'не поддерживается' : persist ? 'включена' : 'не разрешена браузером'}</b>
          </div>
          <button className="btn btn-danger-soft btn-block" onClick={() => setSheet('clear')}>
            <Icon name="trash" size={18} /> Удалить все проекты
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'clear'} onClose={() => setSheet(null)} title="Удалить все проекты?">
        <div className="feature-sheet">
          <p className="feature-note">Все проекты и их файлы будут удалены с этого устройства. Это нельзя отменить.</p>
          <div className="btn-pair">
            <button className="btn btn-soft" onClick={() => setSheet(null)}>
              Отмена
            </button>
            <button className="btn btn-danger" onClick={doClear}>
              Удалить всё
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
