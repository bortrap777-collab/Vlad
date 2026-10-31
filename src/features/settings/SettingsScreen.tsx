import { useEffect, useState } from 'react';
import { Sheet, StageBadge, TopBar, useUi } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useTheme, type ThemePref } from '../../app/theme';
import { usePref } from '../../lib/storage';
import { APP_STAGE, APP_VERSION, FEATURES } from '../../app/features';
import { clearAll, notifyProjectsChanged, requestPersistence, storageEstimate } from '../../lib/db';
import { formatBytes } from '../../lib/format';
import { clearErrors, errorReport, readErrors } from '../../app/errors';
import { opfsSupported } from '../../lib/fileStore';
import { canPromptInstall, iosNotSafari, isStandalone, onInstallChange, platform, promptInstall } from '../../app/install';

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
  const [sheet, setSheet] = useState<'quality' | 'lang' | 'about' | 'clear' | 'install' | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [persist, setPersist] = useState<boolean | null>(null);
  const [errCount, setErrCount] = useState(() => readErrors().length);
  const [canInstall, setCanInstall] = useState(canPromptInstall);
  useEffect(() => onInstallChange(() => setCanInstall(canPromptInstall())), []);
  const standalone = isStandalone();
  const os = platform();
  const install = async () => {
    if (await promptInstall()) {
      ui.toast('Ws установлен — значок появится на главном экране', 'ok');
      setSheet(null);
    }
  };
  const diskStore = (() => {
    try {
      return opfsSupported() && localStorage.getItem('ws.opfsOff') !== '1';
    } catch {
      return opfsSupported();
    }
  })();

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(errorReport());
      ui.toast('Отчёт скопирован — пришлите его в чат', 'ok');
    } catch {
      ui.toast('Не удалось скопировать: браузер запретил доступ к буферу обмена', 'error');
    }
  };

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
          <button className="row" onClick={() => setSheet('install')}>
            <span className="row-icon plain">
              <Icon name="download" size={20} />
            </span>
            <span className="row-body">
              <span className="row-title">Установить на телефон или ПК</span>
              <span className="row-sub">{standalone ? 'Ws уже открыт как приложение' : 'Значок на экране, полный экран, работа без интернета'}</span>
            </span>
            <Icon name="chevronRight" size={18} className="row-chev" />
          </button>
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

      <Sheet open={sheet === 'install'} onClose={() => setSheet(null)} title="Установить Ws">
        <div className="feature-sheet install-sheet">
          {standalone ? (
            <p className="feature-note">Ws уже установлен и открыт как приложение. Обновления приходят сами: когда выйдет новая версия, внизу появится кнопка «Обновить».</p>
          ) : (
            <>
              {canInstall && (
                <button className="btn btn-primary btn-block" onClick={install}>
                  <Icon name="download" size={18} /> Установить Ws
                </button>
              )}
              {(os === 'ios' || !canInstall) && (
                <div className="install-block">
                  <b>iPhone и iPad</b>
                  {iosNotSafari() && <p className="feature-note">Откройте эту страницу в Safari — другие браузеры на iPhone не умеют устанавливать приложения.</p>}
                  <ol>
                    <li>Откройте Ws в Safari.</li>
                    <li>Нажмите «Поделиться» (квадрат со стрелкой вверх).</li>
                    <li>Выберите «На экран „Домой“» и нажмите «Добавить».</li>
                  </ol>
                </div>
              )}
              {os !== 'ios' && !canInstall && (
                <div className="install-block">
                  <b>Android</b>
                  <ol>
                    <li>Откройте Ws в Chrome.</li>
                    <li>Меню ⋮ → «Установить приложение» (или «Добавить на гл. экран»).</li>
                  </ol>
                  <b>Компьютер</b>
                  <ol>
                    <li>Chrome или Edge: значок установки в адресной строке справа.</li>
                  </ol>
                </div>
              )}
              <p className="muted small">
                После установки Ws открывается со значка без адресной строки, на весь экран, и работает без интернета. Проекты хранятся только на этом устройстве; перенести
                их можно через «Мои проекты» → «Экспорт».
              </p>
            </>
          )}
        </div>
      </Sheet>

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
        <p className="muted small">Применяется при экспорте видео.</p>
      </Sheet>

      <Sheet open={sheet === 'lang'} onClose={() => setSheet(null)} title="Язык">
        <div className="feature-sheet">
          <p className="feature-note">Сейчас интерфейс на русском. Тексты собраны так, чтобы позже добавить английский.</p>
          <button className="btn btn-primary btn-block" onClick={() => setSheet(null)}>
            Понятно
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'about'} onClose={() => setSheet(null)} title="Ws">
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
          <div className="kv">
            <span>Хранение файлов</span>
            <b>{diskStore ? 'на диске устройства' : 'в базе браузера'}</b>
          </div>
          <div className="kv">
            <span>Журнал ошибок</span>
            <b>{errCount ? `${errCount} записей` : 'пусто'}</b>
          </div>
          {errCount > 0 && (
            <div className="btn-pair">
              <button className="btn btn-soft" onClick={copyReport}>
                Скопировать отчёт
              </button>
              <button
                className="btn btn-soft"
                onClick={() => {
                  clearErrors();
                  setErrCount(0);
                }}
              >
                Очистить
              </button>
            </div>
          )}
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
