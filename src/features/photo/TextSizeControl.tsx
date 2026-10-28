import { Icon } from '../../components/Icon';

export const TEXT_SIZE_MIN = 0.02;
export const TEXT_SIZE_MAX = 0.6;

/**
 * Размер выбранной надписи — всегда под рукой, без открытия окна.
 * Ползунок идёт по квадратичной шкале: мелкие размеры настраиваются точнее.
 */
export function TextSizeControl({
  size,
  rotation,
  onChange,
  onEnd,
  onResetRotation,
}: {
  size: number;
  rotation?: number;
  onChange: (size: number) => void;
  onEnd: () => void;
  onResetRotation?: () => void;
}) {
  const toSlider = (v: number) => Math.round(Math.sqrt((v - TEXT_SIZE_MIN) / (TEXT_SIZE_MAX - TEXT_SIZE_MIN)) * 1000);
  const fromSlider = (n: number) => TEXT_SIZE_MIN + Math.pow(n / 1000, 2) * (TEXT_SIZE_MAX - TEXT_SIZE_MIN);
  const clamp = (v: number) => Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, v));
  const step = (k: number) => {
    onChange(clamp(size * k));
    onEnd();
  };
  return (
    <div className="text-size" role="group" aria-label="Размер текста">
      <button className="icon-btn icon-btn-sm text-size-btn" aria-label="Меньше" onClick={() => step(1 / 1.15)}>
        <span className="text-size-a small">A</span>
      </button>
      <input
        id="text-size-quick"
        className="slider"
        type="range"
        min={0}
        max={1000}
        step={1}
        value={toSlider(size)}
        onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
        onPointerUp={onEnd}
        onKeyUp={onEnd}
        aria-label="Размер текста"
      />
      <button className="icon-btn icon-btn-sm text-size-btn" aria-label="Больше" onClick={() => step(1.15)}>
        <span className="text-size-a">A</span>
      </button>
      <output className="slider-value" htmlFor="text-size-quick">
        {Math.round(size * 100)}%
      </output>
      {onResetRotation && !!rotation && Math.abs(rotation) > 0.5 && (
        <button className="icon-btn icon-btn-sm" aria-label="Убрать поворот" onClick={onResetRotation}>
          <Icon name="rotate" size={18} />
        </button>
      )}
    </div>
  );
}
