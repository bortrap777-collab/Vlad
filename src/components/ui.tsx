import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FEATURES, type FeatureId, type FeatureInfo } from '../app/features';
import { useNav } from '../app/nav';
import { Icon } from './Icon';

/* =========================================================
   Общие элементы интерфейса: верхняя панель, нижний лист,
   уведомления, индикатор прогресса.
   ========================================================= */

export function TopBar({ title, action, onBack }: { title: string; action?: ReactNode; onBack?: () => void }) {
  const nav = useNav();
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={onBack ?? nav.back} aria-label="Назад">
        <Icon name="chevronLeft" size={26} stroke={2.4} />
      </button>
      <h1 className="topbar-title">{title}</h1>
      <div className="topbar-action">{action}</div>
    </header>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 260);
      return () => clearTimeout(t);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <div className={`sheet-root ${visible ? 'is-open' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-grip" />
        {title && <h2 className="sheet-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function StageBadge({ stage, status }: { stage: number; status: string }) {
  if (status === 'ready') return <span className="chip chip-ok">Работает</span>;
  if (status === 'needs-model') return <span className="chip chip-ai">Нужна модель</span>;
  return <span className="chip">Этап {stage}</span>;
}

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'ok';
}

interface Progress {
  label: string;
  /** 0…1 или null для неопределённого */
  value: number | null;
}

interface UiCtx {
  toast: (text: string, tone?: Toast['tone']) => void;
  showFeature: (id: FeatureId) => void;
  setProgress: (p: Progress | null) => void;
}

const Ctx = createContext<UiCtx | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [feature, setFeature] = useState<FeatureId | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const seq = useRef(0);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3200);
  }, []);

  const value = useMemo<UiCtx>(() => ({ toast, showFeature: setFeature, setProgress }), [toast]);
  const f: FeatureInfo | null = feature ? FEATURES[feature] : null;

  return (
    <Ctx.Provider value={value}>
      {children}

      <Sheet open={!!feature} onClose={() => setFeature(null)} title={f?.title}>
        {f && (
          <div className="feature-sheet">
            <StageBadge stage={f.stage} status={f.status} />
            <p className="feature-note">{f.note}</p>
            <p className="muted small">
              {f.status === 'ready'
                ? 'Функция уже доступна.'
                : f.status === 'needs-model'
                  ? 'Включится после подключения модели или сервера — см. раздел «ИИ-инструменты».'
                  : `Появится на этапе ${f.stage}. Сейчас кнопка ничего не делает с вашим файлом.`}
            </p>
            <button className="btn btn-primary btn-block" onClick={() => setFeature(null)}>
              Понятно
            </button>
          </div>
        )}
      </Sheet>

      {progress && (
        <div className="progress-overlay" role="status" aria-live="polite">
          <div className="progress-card">
            <div className="spinner" />
            <div className="progress-label">{progress.label}</div>
            <div className="progress-track">
              <div
                className={`progress-fill ${progress.value == null ? 'is-indeterminate' : ''}`}
                style={progress.value == null ? undefined : { width: `${Math.round(progress.value * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useUi(): UiCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUi вне UiProvider');
  return v;
}

/** Скрытый выбор файла, вызываемый из любой кнопки. */
export function useFilePicker(accept: string, onPick: (f: File) => void) {
  const ref = useRef<HTMLInputElement | null>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) onPick(f);
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}
