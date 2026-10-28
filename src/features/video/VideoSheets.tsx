import { useState } from 'react';
import { Sheet } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { formatTime } from '../../lib/format';
import { PRESETS, PRESET_GROUPS, temperatureLayer, toCssFilter, DEFAULT_EDITS } from '../photo/pipeline';
import { FORMATS, SPEEDS, TRANSITIONS, lookEdits, type ClipLook, type Timeline, type TransitionType } from './model';

/* ---------------- Скорость ---------------- */
export function SpeedSheet({ open, value, onChange, onClose }: { open: boolean; value: number; onChange: (v: number) => void; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Скорость клипа">
      <div className="feature-sheet">
        <div className="chip-row speed-row" role="radiogroup" aria-label="Скорость">
          {SPEEDS.map((s) => (
            <button key={s} role="radio" aria-checked={value === s} className={`pill ${value === s ? 'is-active' : ''}`} onClick={() => onChange(s)}>
              {String(s).replace('.', ',')}×
            </button>
          ))}
        </div>
        <p className="muted small">
          {value < 1 ? 'Замедление' : value > 1 ? 'Ускорение' : 'Обычная скорость'}. Звук меняется вместе с видео, как на плёнке. Чтобы убрать звук клипа, откройте «Звук» → «Без звука».
        </p>
        <button className="btn btn-primary btn-block" onClick={onClose}>
          Готово
        </button>
      </div>
    </Sheet>
  );
}

/* ---------------- Фильтр и цвет клипа ---------------- */
const ADJ: { key: 'brightness' | 'contrast' | 'saturation' | 'temperature'; label: string }[] = [
  { key: 'brightness', label: 'Яркость' },
  { key: 'contrast', label: 'Контраст' },
  { key: 'saturation', label: 'Насыщенность' },
  { key: 'temperature', label: 'Температура' },
];

export function LookSheet({
  open,
  look,
  thumb,
  onChange,
  onApplyAll,
  onClose,
}: {
  open: boolean;
  look: ClipLook | undefined;
  thumb?: string;
  onChange: (l: ClipLook) => void;
  onApplyAll: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<(typeof ADJ)[number]['key']>('brightness');
  const [group, setGroup] = useState<(typeof PRESET_GROUPS)[number]['id']>('all');
  const e = lookEdits(look);
  const cur: ClipLook = { preset: e.preset, brightness: e.brightness, contrast: e.contrast, saturation: e.saturation, temperature: e.temperature };
  const a = ADJ.find((x) => x.key === tab)!;
  return (
    <Sheet open={open} onClose={onClose} title="Фильтр клипа">
      <div className="feature-sheet look-sheet">
        <div className="chip-row chip-row-scroll preset-groups" role="tablist" aria-label="Группы фильтров">
          {PRESET_GROUPS.map((g) => (
            <button key={g.id} role="tab" aria-selected={group === g.id} className={`pill pill-sm ${group === g.id ? 'is-active' : ''}`} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <div className="preset-row" role="listbox" aria-label="Фильтры">
          {PRESETS.filter((p) => group === 'all' || p.id === 'original' || p.group === group).map((p) => {
            const t = temperatureLayer({ ...DEFAULT_EDITS }, p.id);
            return (
              <button key={p.id} role="option" aria-selected={cur.preset === p.id} className={`preset ${cur.preset === p.id ? 'is-active' : ''}`} onClick={() => onChange({ ...cur, preset: p.id })}>
                <span className="preset-img">
                  {thumb && <img src={thumb} alt="" style={{ filter: toCssFilter(DEFAULT_EDITS, p.id) }} draggable={false} />}
                  {t && <span className="temp-layer" style={{ background: t.color, opacity: t.opacity }} />}
                </span>
                <span className="preset-name">{p.name}</span>
              </button>
            );
          })}
        </div>
        <div className="adjust-tabs" role="tablist">
          {ADJ.map((x) => (
            <button
              key={x.key}
              role="tab"
              aria-selected={tab === x.key}
              className={`adjust-tab ${tab === x.key ? 'is-active' : ''} ${cur[x.key] !== 0 ? 'is-changed' : ''}`}
              onClick={() => setTab(x.key)}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="slider-row" style={{ width: '100%' }}>
          <input
            id={`look-${a.key}`}
            className={`slider ${a.key === 'temperature' ? 'slider-temp' : ''}`}
            type="range"
            min={-100}
            max={100}
            value={cur[a.key]}
            onChange={(ev) => onChange({ ...cur, [a.key]: Number(ev.target.value) })}
            aria-label={a.label}
          />
          <output className="slider-value" htmlFor={`look-${a.key}`}>
            {cur[a.key] > 0 ? `+${cur[a.key]}` : cur[a.key]}
          </output>
        </div>
        <div className="btn-pair">
          <button className="btn btn-soft" onClick={onApplyAll}>
            Ко всем клипам
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ---------------- Формат кадра и плавность ---------------- */
export function FormatSheet({ open, timeline, onChange, onClose }: { open: boolean; timeline: Timeline; onChange: (p: Partial<Timeline>) => void; onClose: () => void }) {
  const format = timeline.format ?? 'original';
  const fit = timeline.fit ?? 'fit';
  const bg = timeline.background ?? 'blur';
  return (
    <Sheet open={open} onClose={onClose} title="Формат и плавность">
      <div className="feature-sheet">
        <div className="field" style={{ width: '100%' }}>
          <span className="field-label">Формат кадра</span>
          <div className="format-row" role="radiogroup" aria-label="Формат кадра">
            {FORMATS.map((f) => (
              <button key={f.id} role="radio" aria-checked={format === f.id} className={`format-opt ${format === f.id ? 'is-active' : ''}`} onClick={() => onChange({ format: f.id })}>
                <span className="format-shape" style={{ aspectRatio: f.ratio ? String(f.ratio) : '16 / 10' }}>
                  {!f.ratio && <Icon name="video" size={14} />}
                </span>
                <span>{f.label}</span>
              </button>
            ))}
          </div>
          <p className="muted small">9:16 — Reels, TikTok, Shorts и истории. 1:1 и 4:5 — лента. 16:9 — YouTube.</p>
        </div>
        <div className="field" style={{ width: '100%' }}>
          <span className="field-label">Видео в кадре</span>
          <div className="segmented segmented-2">
            <button className={fit === 'fit' ? 'is-active' : ''} onClick={() => onChange({ fit: 'fit' })}>
              Вписать
            </button>
            <button className={fit === 'fill' ? 'is-active' : ''} onClick={() => onChange({ fit: 'fill' })}>
              Заполнить
            </button>
          </div>
        </div>
        {fit === 'fit' && (
          <div className="field" style={{ width: '100%' }}>
            <span className="field-label">Фон по краям</span>
            <div className="segmented segmented-2">
              <button className={bg === 'blur' ? 'is-active' : ''} onClick={() => onChange({ background: 'blur' })}>
                Размытие
              </button>
              <button className={bg === 'black' ? 'is-active' : ''} onClick={() => onChange({ background: 'black' })}>
                Чёрный
              </button>
            </div>
          </div>
        )}
        <div className="group flush" style={{ width: '100%' }}>
          <label className="row switch-row" htmlFor="fade-in">
            <span className="row-body">
              <span className="row-title">Плавное начало</span>
              <span className="row-sub">Появление из чёрного, звук нарастает</span>
            </span>
            <input id="fade-in" type="checkbox" className="switch" checked={!!timeline.fadeIn} onChange={(e) => onChange({ fadeIn: e.target.checked })} />
          </label>
          <label className="row switch-row" htmlFor="fade-out">
            <span className="row-body">
              <span className="row-title">Плавный конец</span>
              <span className="row-sub">Уход в чёрный, звук затихает</span>
            </span>
            <input id="fade-out" type="checkbox" className="switch" checked={!!timeline.fadeOut} onChange={(e) => onChange({ fadeOut: e.target.checked })} />
          </label>
        </div>
        <p className="muted small">Переход между клипами — кнопка ＋ на стыке клипов на шкале.</p>
        <button className="btn btn-primary btn-block" onClick={onClose}>
          Готово
        </button>
      </div>
    </Sheet>
  );
}

/* ---------------- Музыка ---------------- */
export function MusicSettings({
  timeline,
  trackDuration,
  onChange,
}: {
  timeline: Timeline;
  trackDuration: number;
  onChange: (p: Partial<NonNullable<Timeline['music']>>) => void;
}) {
  const m = timeline.music;
  if (!m) return null;
  const maxOff = Math.max(0, Math.floor(trackDuration - 1));
  const off = Math.min(m.offset ?? 0, maxOff);
  return (
    <>
      {maxOff > 0 && (
        <div className="field" style={{ width: '100%' }}>
          <label className="field-label" htmlFor="music-offset">
            Начать трек с {formatTime(off)}
          </label>
          <input id="music-offset" className="slider" type="range" min={0} max={maxOff} step={1} value={off} onChange={(e) => onChange({ offset: Number(e.target.value) })} />
        </div>
      )}
      <div className="group flush" style={{ width: '100%' }}>
        <label className="row switch-row" htmlFor="music-fade-in">
          <span className="row-body">
            <span className="row-title">Плавное появление</span>
          </span>
          <input id="music-fade-in" type="checkbox" className="switch" checked={!!m.fadeIn} onChange={(e) => onChange({ fadeIn: e.target.checked })} />
        </label>
        <label className="row switch-row" htmlFor="music-fade-out">
          <span className="row-body">
            <span className="row-title">Плавное затухание</span>
          </span>
          <input id="music-fade-out" type="checkbox" className="switch" checked={!!m.fadeOut} onChange={(e) => onChange({ fadeOut: e.target.checked })} />
        </label>
      </div>
    </>
  );
}

/* ---------------- Переход между клипами ---------------- */
const DURATIONS: { v: number; label: string }[] = [
  { v: 0.4, label: 'Быстро' },
  { v: 0.6, label: 'Обычно' },
  { v: 1, label: 'Плавно' },
];

export function TransitionSheet({
  open,
  value,
  duration,
  onChange,
  onApplyAll,
  onClose,
}: {
  open: boolean;
  value: TransitionType;
  duration: number;
  onChange: (p: { transition?: TransitionType; transitionDuration?: number }) => void;
  onApplyAll: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Переход">
      <div className="feature-sheet">
        <div className="trans-grid" role="radiogroup" aria-label="Переход">
          {TRANSITIONS.map((t) => (
            <button key={t.id} role="radio" aria-checked={value === t.id} className={`trans-tile ${value === t.id ? 'is-active' : ''}`} onClick={() => onChange({ transition: t.id })}>
              <span className={`trans-demo trans-demo-${t.id}`} aria-hidden="true">
                <i className="a" />
                <i className="b" />
              </span>
              <span className="trans-name">{t.label}</span>
            </button>
          ))}
        </div>
        {value !== 'none' && (
          <div className="field" style={{ width: '100%' }}>
            <span className="field-label">Длительность</span>
            <div className="segmented">
              {DURATIONS.map((d) => (
                <button key={d.v} className={Math.abs(duration - d.v) < 0.01 ? 'is-active' : ''} onClick={() => onChange({ transitionDuration: d.v })}>
                  {d.label} · {String(d.v).replace('.', ',')} с
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="muted small">Длина ролика не меняется: на стыке клипы на мгновение задерживают крайние кадры.</p>
        <div className="btn-pair">
          <button className="btn btn-soft" onClick={onApplyAll}>
            На все стыки
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </Sheet>
  );
}
