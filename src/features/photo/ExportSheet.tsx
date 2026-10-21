import { useEffect, useState } from 'react';
import { Sheet, useUi } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { formatBytes } from '../../lib/format';
import { deliverFile, isAppleMobile } from '../../lib/deliver';
import type { RenderResult } from './render';

export function ExportSheet({ result, filename, onClose }: { result: RenderResult | null; filename: string; onClose: () => void }) {
  const ui = useUi();
  const [url, setUrl] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setManual(false);
    if (!result) return;
    const u = URL.createObjectURL(result.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [result]);

  const inClaude = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  const label = inClaude ? 'Сохранить файл' : isAppleMobile() ? 'Сохранить в Фото' : 'Скачать';

  const save = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const r = await deliverFile(result.blob, filename);
      if (r === 'shared') ui.toast('Готово. Если выбрали «Сохранить изображение» — фото в галерее.', 'ok');
      else if (r === 'saved') ui.toast('Файл сохранён', 'ok');
      else if (r === 'downloaded') ui.toast('Файл скачан', 'ok');
      else if (r === 'manual') setManual(true);
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!result} onClose={onClose} title="Фото готово">
      {result && (
        <div className="feature-sheet">
          <div className="export-preview" style={{ aspectRatio: `${result.width} / ${result.height}` }}>
            {url && <img src={url} alt="Готовое фото" />}
          </div>
          <div className="kv">
            <span>Размер</span>
            <b>
              {result.width}×{result.height} · {result.type === 'image/png' ? 'PNG' : 'JPEG'} · {formatBytes(result.blob.size)}
            </b>
          </div>
          {result.limited && (
            <p className="muted small">
              Браузер ограничивает размер холста, поэтому фото уменьшено с {result.sourceWidth}×{result.sourceHeight}. В нативной версии этого
              ограничения не будет.
            </p>
          )}
          {manual && (
            <p className="notice-inline">
              <Icon name="info" size={18} /> Здесь браузер не разрешает сохранять файлы напрямую. Нажмите на фото и удерживайте → «Сохранить в Фото».
            </p>
          )}
          <button className="btn btn-primary btn-block" onClick={save} disabled={busy}>
            <Icon name="upload" size={18} /> {label}
          </button>
          <button className="btn btn-soft btn-block" onClick={onClose}>
            Продолжить редактирование
          </button>
        </div>
      )}
    </Sheet>
  );
}
