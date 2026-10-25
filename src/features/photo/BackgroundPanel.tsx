import { Icon } from '../../components/Icon';
import { BG_COLORS } from './pipeline';
import type { BgMode, PhotoLayer } from './layers';

const MODES: { id: BgMode; label: string }[] = [
  { id: 'original', label: 'Оригинал' },
  { id: 'none', label: 'Без фона' },
  { id: 'color', label: 'Цвет' },
  { id: 'blur', label: 'Размытие' },
  { id: 'image', label: 'Фото' },
];

interface Props {
  /** Объект уже вырезан (есть слой «Объект») */
  cut: boolean;
  mode: BgMode;
  bg: PhotoLayer | null;
  merged: boolean;
  onRemove: () => void;
  onMode: (m: BgMode) => void;
  onColor: (c: string) => void;
  onBlur: (v: number, end: boolean) => void;
  onPickImage: () => void;
  onRestore: () => void;
}

/** Панель «Фон»: одна кнопка «Удалить фон», затем выбор, что поставить вместо фона. */
export function BackgroundPanel({ cut, mode, bg, merged, onRemove, onMode, onColor, onBlur, onPickImage, onRestore }: Props) {
  if (!cut || merged) {
    return (
      <div className="bg-panel">
        <button className="btn btn-primary btn-block" onClick={onRemove}>
          <Icon name="cutout" size={20} /> Удалить фон
        </button>
        <p className="muted small">
          {merged
            ? 'Слои объединены. Удаление фона разъединит их и вырежет объект из исходного фото.'
            : 'Объект станет отдельным слоем: его можно двигать, вращать и менять пальцами. Работает на устройстве, без интернета после первой загрузки модели.'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-panel">
      <div className="chip-row chip-row-scroll" role="radiogroup" aria-label="Фон">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={mode === m.id}
            className={`pill ${mode === m.id ? 'is-active' : ''}`}
            onClick={() => (m.id === 'image' ? onPickImage() : onMode(m.id))}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'none' && <p className="muted small">Сохранится в PNG с прозрачным фоном.</p>}
      {mode === 'original' && <p className="muted small">Объект — отдельный слой поверх исходного фото. Двигайте его во вкладке «Слои».</p>}

      {mode === 'color' && bg && (
        <div className="swatches swatches-row">
          {BG_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${bg.color.toUpperCase() === c ? 'is-active' : ''}`}
              style={{ background: c }}
              aria-label={`Цвет ${c}`}
              onClick={() => onColor(c)}
            />
          ))}
          <label className={`swatch swatch-custom ${BG_COLORS.includes(bg.color.toUpperCase()) ? '' : 'is-active'}`} aria-label="Свой цвет">
            <input type="color" value={bg.color} onChange={(e) => onColor(e.target.value.toUpperCase())} />
          </label>
        </div>
      )}

      {mode === 'blur' && bg && (
        <div className="slider-row">
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(bg.blur * 100)}
            onChange={(e) => onBlur(Number(e.target.value) / 100, false)}
            onPointerUp={() => onBlur(bg.blur, true)}
            onKeyUp={() => onBlur(bg.blur, true)}
            aria-label="Сила размытия"
          />
          <output className="slider-value">{Math.round(bg.blur * 100)}</output>
        </div>
      )}

      {mode === 'image' && (
        <button className="pill pill-add" onClick={onPickImage}>
          <Icon name="image" size={16} /> Выбрать другое фото
        </button>
      )}

      <div className="panel-foot">
        <button className="link-btn" onClick={onRemove}>
          <Icon name="cutout" size={16} /> Вырезать заново
        </button>
        <button className="link-btn" onClick={onRestore}>
          <Icon name="reset" size={16} /> Вернуть как было
        </button>
      </div>
    </div>
  );
}
