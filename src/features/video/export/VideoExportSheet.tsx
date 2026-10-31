import { useEffect, useRef, useState } from 'react';
import { Sheet, useUi } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { formatBytes, formatTime } from '../../../lib/format';
import { usePref } from '../../../lib/storage';
import { deliverFile, isAppleMobile, prepareDelivery } from '../../../lib/deliver';
import { totalDuration, type Timeline } from '../model';
import type { LoadedSource } from '../useVideoProject';
import { ExportError, exportVideo, planExport, type ExportPlan, type ExportQuality, type ExportResult } from './exportVideo';

type Phase = 'setup' | 'running' | 'done' | 'error';

const QUALITY: { id: ExportQuality; label: string }[] = [
  { id: 'original', label: 'Оригинал' },
  { id: '1080', label: '1080p' },
  { id: '720', label: '720p' },
];

const CODEC_LABEL = (p: ExportPlan) =>
  `${p.codec.startsWith('avc1') ? 'H.264' : 'VP9'}${p.audio ? ' + ' + (p.audio === 'mp4a' ? 'AAC' : p.audio === 'opus' ? 'Opus' : 'PCM') : ', без звука'}`;

export function VideoExportSheet({
  open,
  onClose,
  timeline,
  sources,
  readSource,
  name,
  beforeStart,
}: {
  open: boolean;
  onClose: () => void;
  timeline: Timeline;
  sources: Record<string, LoadedSource>;
  readSource: (id: string) => Promise<Blob>;
  name: string;
  beforeStart: () => void;
}) {
  const ui = useUi();
  const [quality, setQuality] = usePref<ExportQuality>('ws.exportQuality', 'original');
  const [phase, setPhase] = useState<Phase>('setup');
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ value: 0, label: '' });
  const [result, setResult] = useState<ExportResult | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const duration = totalDuration(timeline);

  useEffect(() => prepareDelivery(), []);

  // План пересчитываем при открытии и смене качества
  useEffect(() => {
    if (!open || phase !== 'setup') return;
    let cancelled = false;
    setPlan(null);
    setPlanError(null);
    planExport(timeline, sources, quality)
      .then((p) => !cancelled && setPlan(p))
      .catch((e) => !cancelled && setPlanError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [open, quality, phase, timeline, sources]);

  useEffect(() => {
    if (!result) return;
    const u = URL.createObjectURL(result.blob);
    setResultUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [result]);

  const start = async () => {
    if (!plan) return;
    beforeStart();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase('running');
    setProgress({ value: 0, label: 'Подготовка…' });
    try {
      const r = await exportVideo(timeline, sources, readSource, plan, { signal: ac.signal, onProgress: (value, label) => setProgress({ value, label }) });
      setResult(r);
      setPhase('done');
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') {
        setPhase('setup');
        ui.toast('Экспорт отменён');
      } else {
        setError(e instanceof ExportError ? e.message : 'Не удалось создать видео: ' + ((e as Error).message || 'неизвестная ошибка'));
        setPhase('error');
      }
    } finally {
      abortRef.current = null;
    }
  };

  const close = () => {
    if (phase === 'running') return; // закрыть можно только через «Отменить»
    setPhase('setup');
    setResult(null);
    setError(null);
    onClose();
  };

  const ext = result?.plan.container === 'mov' ? 'mov' : 'mp4';
  const filename = `${name.replace(/[\\/:*?"<>|]+/g, '_') || 'video'}-wstudio.${ext}`;
  const inClaude = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const r = await deliverFile(result.blob, filename);
      if (r === 'shared') ui.toast('Готово. Если выбрали «Сохранить видео» — оно в галерее.', 'ok');
      else if (r === 'saved') ui.toast('Видео сохранено', 'ok');
      else if (r === 'downloaded') ui.toast('Видео скачано', 'ok');
      else if (r === 'manual') ui.toast('Здесь браузер не разрешает сохранять файлы. Откройте Ws в Safari.', 'error');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const estimate = plan ? ((plan.bitrate + (plan.audio === 'lpcm' ? 1_536_000 : plan.audio ? 192_000 : 0)) * duration) / 8 : 0;

  return (
    <Sheet open={open} onClose={close} title={phase === 'done' ? 'Видео готово' : 'Экспорт видео'}>
      {phase === 'setup' && (
        <div className="feature-sheet">
          <div className="field" style={{ width: '100%' }}>
            <span className="field-label">Качество</span>
            <div className="segmented">
              {QUALITY.map((q) => (
                <button key={q.id} className={quality === q.id ? 'is-active' : ''} onClick={() => setQuality(q.id)}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>
          {plan ? (
            <>
              <div className="kv">
                <span>Разрешение</span>
                <b>
                  {plan.width}×{plan.height} · {plan.fps} кадр/с
                </b>
              </div>
              <div className="kv">
                <span>Формат</span>
                <b>
                  {plan.container.toUpperCase()} · {CODEC_LABEL(plan)}
                </b>
              </div>
              <div className="kv">
                <span>Длительность · размер</span>
                <b>
                  {formatTime(duration)} · ~{formatBytes(estimate)}
                </b>
              </div>
              {plan.notes.map((n) => (
                <p key={n} className="notice-inline">
                  <Icon name="info" size={18} /> {n}
                </p>
              ))}
              <p className="muted small">Видео собирается на телефоне. Не закрывайте приложение, пока идёт экспорт.</p>
            </>
          ) : planError ? (
            <p className="error-text">{planError}</p>
          ) : (
            <p className="muted small">Проверяю возможности устройства…</p>
          )}
          <button className="btn btn-primary btn-block" onClick={start} disabled={!plan}>
            <Icon name="video" size={18} /> Создать видео
          </button>
        </div>
      )}

      {phase === 'running' && (
        <div className="feature-sheet export-running">
          <div className="export-pct">{Math.floor(progress.value * 100)}%</div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.round(progress.value * 100)}%` }} />
          </div>
          <p className="muted small export-label">{progress.label}</p>
          <button className="btn btn-soft btn-block" onClick={() => abortRef.current?.abort()}>
            Отменить
          </button>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="feature-sheet">
          <div className="export-video" style={{ aspectRatio: `${result.plan.width} / ${result.plan.height}` }}>
            {resultUrl && <video src={resultUrl} controls playsInline preload="metadata" />}
          </div>
          <div className="kv">
            <span>Файл</span>
            <b>
              {result.plan.width}×{result.plan.height} · {result.plan.container.toUpperCase()} · {formatBytes(result.blob.size)}
            </b>
          </div>
          <div className="kv">
            <span>Создано за</span>
            <b>{Math.max(1, Math.round(result.seconds))} с</b>
          </div>
          {result.warnings.map((w) => (
            <p key={w} className="notice-inline">
              <Icon name="info" size={18} /> {w}
            </p>
          ))}
          <button className="btn btn-primary btn-block" onClick={save} disabled={saving}>
            <Icon name="upload" size={18} /> {inClaude ? 'Сохранить файл' : isAppleMobile() ? 'Сохранить в Фото' : 'Скачать'}
          </button>
          <button className="btn btn-soft btn-block" onClick={close}>
            Вернуться к монтажу
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="feature-sheet">
          <p className="notice-inline">
            <Icon name="info" size={18} /> {error}
          </p>
          <button className="btn btn-primary btn-block" onClick={() => setPhase('setup')}>
            Попробовать снова
          </button>
        </div>
      )}
    </Sheet>
  );
}
