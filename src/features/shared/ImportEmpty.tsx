import { Icon } from '../../components/Icon';

export function ImportEmpty({ kind, onPick, hint, error }: { kind: 'video' | 'photo'; onPick: () => void; hint: string; error?: string | null }) {
  const isVideo = kind === 'video';
  return (
    <div className="import-empty">
      <button className={`import-drop import-${kind}`} onClick={onPick}>
        <span className="import-icon">
          <Icon name={isVideo ? 'video' : 'photo'} size={34} stroke={2} />
        </span>
        <span className="import-title">{isVideo ? 'Выберите видео' : 'Выберите фото'}</span>
        <span className="import-sub">Из галереи, камеры или «Файлов»</span>
      </button>
      {error && <p className="error-text">{error}</p>}
      <p className="muted small import-hint">{hint}</p>
      <p className="muted small import-hint">
        <Icon name="shield" size={14} /> Файлы обрабатываются на устройстве и никуда не отправляются.
      </p>
    </div>
  );
}
