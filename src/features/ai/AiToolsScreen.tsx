import { useCallback, useEffect, useState } from 'react';
import { Sheet, TopBar, useUi } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useNav } from '../../app/nav';
import { formatBytes } from '../../lib/format';
import { AI_TOOLS, toolState, type ToolState } from '../../ai/registry';
import { aiAssetsReady, aiManifest, deleteAiAssets, downloadAiAssets, totalSize } from '../../ai/assets';
import type { AiToolId, AiToolSpec, ProviderKind } from '../../ai/types';

const KIND_LABEL: Record<ProviderKind, string> = {
  'on-device': 'На устройстве',
  server: 'Сервер',
  api: 'API',
};

const STATE_CHIP: Record<ToolState, { text: string; cls: string }> = {
  ready: { text: 'Готово', cls: 'chip-ok' },
  'needs-download': { text: 'Скачать модель', cls: 'chip-ai' },
  'not-connected': { text: 'Не подключено', cls: '' },
};

/** Что нужно, чтобы инструмент заработал, — когда он не подключён */
const NEXT_STEP: Partial<Record<AiToolId, string>> = {
  captions: 'Включится после подключения API-ключа сервиса распознавания речи.',
  'smart-edit': 'Включится после автосубтитров и подключения языковой модели.',
  enhance: 'Включится после проверки модели на iPhone или подключения API.',
};

export function AiToolsScreen() {
  const ui = useUi();
  const nav = useNav();
  const [open, setOpen] = useState<AiToolSpec | null>(null);
  const [states, setStates] = useState<Partial<Record<AiToolId, ToolState>>>({});
  const [model, setModel] = useState<{ ready: boolean; size: number | null } | null>(null);

  const refresh = useCallback(async () => {
    const entries = await Promise.all(AI_TOOLS.map(async (t) => [t.id, await toolState(t.id)] as const));
    setStates(Object.fromEntries(entries));
    const ready = await aiAssetsReady();
    const size = await aiManifest().then(totalSize, () => null);
    setModel({ ready, size });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const download = async () => {
    const ctrl = new AbortController();
    try {
      await downloadAiAssets((p) => ui.setProgress({ ...p, onCancel: () => ctrl.abort() }), ctrl.signal);
      ui.toast('Модель скачана и работает без интернета', 'ok');
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') ui.toast((e as Error).message, 'error');
    } finally {
      ui.setProgress(null);
      refresh();
    }
  };

  const remove = async () => {
    await deleteAiAssets().catch(() => undefined);
    ui.toast('Модель удалена с устройства', 'ok');
    refresh();
  };

  const openState = open ? states[open.id] : undefined;

  return (
    <div className="screen screen-scroll">
      <TopBar title="ИИ-инструменты" />

      <div className="page">
        <div className="notice">
          <Icon name="info" size={20} />
          <p>
            Удаление и замена фона работают прямо на телефоне, без сервера. Остальным инструментам нужен внешний сервис — пока он не подключён,
            инструмент ничего не обрабатывает и не показывает поддельный результат.
          </p>
        </div>

        <div className="group">
          {AI_TOOLS.map((t) => {
            const st = states[t.id] ?? 'not-connected';
            return (
              <button key={t.id} className="row row-tall" onClick={() => setOpen(t)}>
                <span className={`row-icon ai-icon ai-${t.media}`}>
                  <Icon name={t.icon} size={22} />
                </span>
                <span className="row-body">
                  <span className="row-title">{t.title}</span>
                  <span className="row-sub">{t.description}</span>
                </span>
                <span className={`chip ${STATE_CHIP[st].cls}`}>{STATE_CHIP[st].text}</span>
              </button>
            );
          })}
        </div>

        <h2 className="group-title">Модели на устройстве</h2>
        <div className="group">
          <div className="row row-tall">
            <span className="row-icon ai-icon ai-photo">
              <Icon name="cutout" size={22} />
            </span>
            <span className="row-body">
              <span className="row-title">Фон · ISNet</span>
              <span className="row-sub">
                {model == null ? 'Проверяю…' : model.ready ? `Скачана${model.size ? ` · ${formatBytes(model.size)}` : ''} · работает офлайн` : `Не скачана${model.size ? ` · ${formatBytes(model.size)}` : ''}`}
              </span>
            </span>
            {model?.ready ? (
              <button className="btn btn-soft btn-sm" onClick={remove}>
                Удалить
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={download} disabled={!model}>
                Скачать
              </button>
            )}
          </div>
        </div>
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.title}>
        {open && (
          <div className="feature-sheet">
            <p className="feature-note">{open.description}</p>
            <h3 className="sheet-sub">{openState === 'not-connected' ? 'Что нужно для работы' : 'Как работает'}</h3>
            <ul className="req-list">
              {open.requirements.map((r) => (
                <li key={r.title}>
                  <span className="chip">{KIND_LABEL[r.kind]}</span>
                  <div>
                    <div className="req-title">{r.title}</div>
                    <div className="muted small">{r.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
            {openState === 'not-connected' ? (
              <>
                <p className="muted small">Статус: не подключено. {NEXT_STEP[open.id]}</p>
                <button className="btn btn-primary btn-block" onClick={() => setOpen(null)}>
                  Понятно
                </button>
              </>
            ) : (
              <>
                <p className="muted small">
                  {openState === 'ready' ? 'Модель на устройстве.' : 'Модель скачается при первом использовании.'} В редакторе фото: инструмент «Фон».
                </p>
                <button
                  className="btn btn-primary btn-block"
                  onClick={() => {
                    setOpen(null);
                    nav.push({ name: 'photo', tool: 'background' });
                  }}
                >
                  <Icon name="photo" size={20} /> Выбрать фото
                </button>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
