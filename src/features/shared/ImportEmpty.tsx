import { Icon } from '../../components/Icon';

export function ImportEmpty({
  kind,
  onPick,
  hint,
  error,
  onRetry,
}: {
  kind: 'video' | 'photo';
  onPick: () => void;
  hint: string;
  error?: string | null;
  onRetry?: () => void;
}) {
  const isVideo = kind === 'video';
  if (error && onRetry) {
    return (
      <div className="import-empty">
        <div className="open-error" role="alert">
          <Icon name="info" size={28} />
          <p className="empty-title">Проект не открылся</p>
          <p className="small">{error}</p>
          <div className="btn-pair">
            <button className="btn btn-soft" onClick={onPick}>
              Новый файл
            </button>
            <button className="btn btn-primary" onClick={onRetry}>
              Повторить
            </button>
          </div>
        </div>
      </div>
    );
  }
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
