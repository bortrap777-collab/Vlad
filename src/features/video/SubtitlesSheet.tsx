import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { usePref } from '../../lib/storage';
import { formatBytes } from '../../lib/format';
import { aiAssetsReady, aiManifest, packSize } from '../../ai/assets';
import { transcribe, type SpeechModel } from '../../ai/providers/speech';
import { mixAudio } from './export/audioMix';
import { SUBTITLE_STYLES, segmentsToSubtitles, type SubtitleStyle } from './subtitles';
import { totalDuration, type Timeline, type VideoText } from './model';

const LANGS: { id: string; label: string }[] = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' },
  { id: 'auto', label: 'Определить' },
];

const MODELS: { id: SpeechModel; label: string; sub: string }[] = [
  { id: 'speech', label: 'Быстро', sub: 'base' },
  { id: 'speech-hq', label: 'Точнее', sub: 'small' },
];

type Phase = 'setup' | 'running' | 'error';

/**
 * Субтитры из речи в видео: звук монтажа (без музыки) → Whisper на устройстве → надписи по времени.
 */
export function SubtitlesSheet({
  open,
  onClose,
  timeline,
  ratio,
  readSource,
  onDone,
  onRemoveAll,
}: {
  open: boolean;
  onClose: () => void;
  timeline: Timeline;
  ratio: number;
  readSource: (id: string) => Promise<Blob>;
  onDone: (texts: VideoText[], info: { language: string; seconds: number }) => void;
  onRemoveAll: () => void;
}) {
  const [lang, setLang] = usePref<string>('ws.subLang', 'ru');
  const [model, setModel] = usePref<SpeechModel>('ws.subModel', 'speech');
  const [style, setStyle] = usePref<SubtitleStyle>('ws.subStyle', 'classic');
  const [phase, setPhase] = useState<Phase>('setup');
  const [progress, setProgress] = useState({ value: 0, label: '' });
  const [error, setError] = useState<string | null>(null);
  const [sizes, setSizes] = useState<Partial<Record<SpeechModel, { size: number; ready: boolean }>>>({});
  const abortRef = useRef<AbortController | null>(null);
  const existing = timeline.texts.filter((t) => t.subtitle).length;
  const total = totalDuration(timeline);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const m = await aiManifest();
        const entries = await Promise.all(MODELS.map(async (x) => [x.id, { size: packSize(m, x.id), ready: await aiAssetsReady(x.id) }] as const));
        if (!cancelled) setSizes(Object.fromEntries(entries));
      } catch {
        /* без сети размеры не покажем — скачивание сообщит само */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const start = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase('running');
    setError(null);
    setProgress({ value: 0, label: 'Готовлю звук…' });
    const t0 = performance.now();
    try {
      const mix = await mixAudio(timeline, readSource, ac.signal, (v) => setProgress({ value: v * 0.05, label: 'Готовлю звук…' }), { rate: 16000, channels: 1, music: false });
      if (!mix.buffer) throw new Error('В клипах нет звука — распознавать нечего. Проверьте громкость клипов.');
      const audio = mix.buffer.getChannelData(0);
      const r = await transcribe(audio, {
        language: lang,
        model,
        signal: ac.signal,
        onProgress: (p) => setProgress({ value: 0.05 + (p.value ?? 0) * 0.95, label: p.label }),
      });
      if (!r.segments.length) throw new Error('Речь не найдена. Возможно, в видео только музыка или звук слишком тихий.');
      const texts = segmentsToSubtitles(r.segments, { ratio, style, total });
      onDone(texts, { language: r.language, seconds: (performance.now() - t0) / 1000 });
      setPhase('setup');
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') {
        setPhase('setup');
      } else {
        setError((e as Error).message || 'Не удалось создать субтитры.');
        setPhase('error');
      }
    } finally {
      abortRef.current = null;
    }
  };

  const close = () => {
    if (phase === 'running') return;
    setPhase('setup');
    onClose();
  };

  const sizeLabel = (id: SpeechModel) => {
    const s = sizes[id];
    if (!s) return '';
    return s.ready ? 'скачана' : formatBytes(s.size);
  };

  return (
    <Sheet open={open} onClose={close} title="Субтитры">
      {phase === 'setup' && (
        <div className="feature-sheet">
          <p className="feature-note">Распознаём речь в видео прямо на телефоне и расставляем текст по времени. Музыка не мешает — она не учитывается.</p>
          <div className="field" style={{ width: '100%' }}>
            <span className="field-label">Язык речи</span>
            <div className="segmented">
              {LANGS.map((l) => (
                <button key={l.id} className={lang === l.id ? 'is-active' : ''} onClick={() => setLang(l.id)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field" style={{ width: '100%' }}>
            <span className="field-label">Распознавание</span>
            <div className="segmented seg-two-line">
              {MODELS.map((m) => (
                <button key={m.id} className={model === m.id ? 'is-active' : ''} onClick={() => setModel(m.id)}>
                  {m.label}
                  <small>{sizeLabel(m.id) || m.sub}</small>
                </button>
              ))}
            </div>
            <span className="muted small">
              {model === 'speech' ? 'Быстрая модель: минута видео — примерно 30–60 секунд.' : 'Ошибок примерно в 2 раза меньше, но в 3 раза медленнее и нужно больше памяти — для новых iPhone.'}
            </span>
          </div>
          <div className="field" style={{ width: '100%' }}>
            <span className="field-label">Оформление</span>
            <div className="chip-row">
              {SUBTITLE_STYLES.map((s) => (
                <button key={s.id} className={`pill sub-pill sub-${s.id} ${style === s.id ? 'is-active' : ''}`} onClick={() => setStyle(s.id)}>
                  <span>Аа</span> {s.label}
                </button>
              ))}
            </div>
          </div>
          {existing > 0 && <p className="muted small">Сейчас в ролике {existing} субтитров — новые заменят их. Обычные надписи останутся.</p>}
          <button className="btn btn-primary btn-block" onClick={start} disabled={total <= 0}>
            <Icon name="captions" size={18} /> {existing ? 'Создать заново' : 'Создать субтитры'}
          </button>
          {existing > 0 && (
            <button className="btn btn-danger-soft btn-block" onClick={onRemoveAll}>
              <Icon name="trash" size={18} /> Удалить субтитры
            </button>
          )}
        </div>
      )}

      {phase === 'running' && (
        <div className="feature-sheet export-running">
          <div className="export-pct">{Math.floor(progress.value * 100)}%</div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.round(progress.value * 100)}%` }} />
          </div>
          <p className="muted small export-label">{progress.label}</p>
          <p className="muted small">Не закрывайте приложение: распознавание идёт на телефоне.</p>
          <button className="btn btn-soft btn-block" onClick={() => abortRef.current?.abort()}>
            Отменить
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="feature-sheet">
          <p className="notice-inline">
            <Icon name="info" size={18} /> {error}
          </p>
          <button className="btn btn-primary btn-block" onClick={() => setPhase('setup')}>
            Понятно
          </button>
        </div>
      )}
    </Sheet>
  );
}
