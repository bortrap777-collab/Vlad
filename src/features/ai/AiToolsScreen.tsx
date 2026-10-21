import { useState } from 'react';
import { Sheet, TopBar } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { AI_TOOLS, isToolConnected } from '../../ai/registry';
import type { AiToolSpec, ProviderKind } from '../../ai/types';

const KIND_LABEL: Record<ProviderKind, string> = {
  'on-device': 'На устройстве',
  server: 'Сервер',
  api: 'API',
};

export function AiToolsScreen() {
  const [open, setOpen] = useState<AiToolSpec | null>(null);

  return (
    <div className="screen screen-scroll">
      <TopBar title="ИИ-инструменты" />

      <div className="page">
        <div className="notice">
          <Icon name="info" size={20} />
          <p>
            ИИ-функции требуют модель или сервер. Пока они не подключены, инструменты не выполняют обработку и не показывают
            поддельный результат. Подключение — этап 5.
          </p>
        </div>

        <div className="group">
          {AI_TOOLS.map((t) => {
            const connected = isToolConnected(t.id);
            return (
              <button key={t.id} className="row row-tall" onClick={() => setOpen(t)}>
                <span className={`row-icon ai-icon ai-${t.media}`}>
                  <Icon name={t.icon} size={22} />
                </span>
                <span className="row-body">
                  <span className="row-title">{t.title}</span>
                  <span className="row-sub">{t.description}</span>
                </span>
                <span className={`chip ${connected ? 'chip-ok' : 'chip-ai'}`}>{connected ? 'Готово' : 'Не подключено'}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.title}>
        {open && (
          <div className="feature-sheet">
            <p className="feature-note">{open.description}</p>
            <h3 className="sheet-sub">Что нужно для работы</h3>
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
            <p className="muted small">Статус: не подключено. Модуль-провайдер добавляется в src/ai/registry.ts, интерфейс уже готов.</p>
            <button className="btn btn-primary btn-block" onClick={() => setOpen(null)}>
              Понятно
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
