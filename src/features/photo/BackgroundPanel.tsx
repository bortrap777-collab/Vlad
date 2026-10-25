import { Icon } from '../../components/Icon';
import { formatBytes } from '../../lib/format';
import { BG_COLORS, type BackgroundEdit, type BackgroundMode } from './pipeline';

const MODES: { id: BackgroundMode; label: string }[] = [
  { id: 'transparent', label: 'Без фона' },
  { id: 'color', label: 'Цвет' },
  { id: 'blur', label: 'Размытие' },
  { id: 'image', label: 'Фото' },
];

interface Props {
  bg: BackgroundEdit | null;
  /** null — ещё неизвестно, true — модель на устройстве */
  modelReady: boolean | null;
  modelSize: number | null;
  onRemove: () => void;
  onChange: (p: Partial<BackgroundEdit>) => void;
  onPickImage: () => void;
  onRestore: () => void;
}

/** Панель «Фон» фоторедактора: удаление фона моделью и выбор замены. */
export function BackgroundPanel({ bg, modelReady, modelSize, onRemove, onChange, onPickImage, onRestore }: Props) {
  if (!bg) {
    return (
      <div className="bg-panel">
        <button className="btn btn-primary btn-block" onClick={onRemove}>
          <Icon name="cutout" size={20} /> Удалить фон
        </button>
        <p className="muted small">
          {modelReady
            ? 'Модель на устройстве: фото обрабатывается здесь же, без интернета.'
            : `При первом запуске скачается модель${modelSize ? ` (${formatBytes(modelSize)})` : ''} — один раз, лучше по Wi-Fi. Фото никуда не отправляется.`}
        </p>
      </div>
    );
  }

  const choose = (mode: BackgroundMode) => {
    if (mode === 'image' && !bg.image) onPickImage();
    else onChange({ mode });
  };

  return (
    <div className="bg-panel">
      <div className="chip-row chip-row-scroll" role="radiogroup" aria-label="Фон">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={bg.mode === m.id} className={`pill ${bg.mode === m.id ? 'is-active' : ''}`} onClick={() => choose(m.id)}>
            {m.label}
          </button>
        ))}
      </div>

      {bg.mode === 'transparent' && <p className="muted small">Сохранится в PNG с прозрачным фоном.</p>}

      {bg.mode === 'color' && (
        <div className="swatches swatches-row">
          {BG_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${bg.color.toUpperCase() === c ? 'is-active' : ''}`}
              style={{ background: c }}
              aria-label={`Цвет ${c}`}
              onClick={() => onChange({ color: c })}
            />
          ))}
          <label className={`swatch swatch-custom ${BG_COLORS.includes(bg.color.toUpperCase()) ? '' : 'is-active'}`} aria-label="Свой цвет">
            <input type="color" value={bg.color} onChange={(e) => onChange({ color: e.target.value.toUpperCase() })} />
          </label>
        </div>
      )}

      {bg.mode === 'blur' && (
        <div className="slider-row">
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(bg.blur * 100)}
            onChange={(e) => onChange({ blur: Number(e.target.value) / 100 })}
            aria-label="Сила размытия"
          />
          <output className="slider-value">{Math.round(bg.blur * 100)}</output>
        </div>
      )}

      {bg.mode === 'image' && (
        <button className="pill pill-add" onClick={onPickImage}>
          <Icon name="image" size={16} /> {bg.image ? 'Выбрать другое фото' : 'Выбрать фото для фона'}
        </button>
      )}

      <div className="panel-foot">
        <button className="link-btn" onClick={onRemove}>
          <Icon name="cutout" size={16} /> Вырезать заново
        </button>
        <button className="link-btn" onClick={onRestore}>
          <Icon name="reset" size={16} /> Вернуть исходный фон
        </button>
      </div>
    </div>
  );
}
