/**
 * Компактные панели правки снизу экрана: кадр остаётся на виду, и каждое изменение
 * (шрифт, цвет, анимация, звук, хромакей) сразу видно и слышно в предпросмотре.
 */
import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { formatTime } from '../../lib/format';
import { TEXT_COLORS, TEXT_FONTS, type TextFont, type TextStyle } from '../photo/pipeline';
import { TextSizeControl } from '../photo/TextSizeControl';
import {
  MARKER_COLORS,
  SPEEDS,
  TEXT_ANIMS_IN,
  TEXT_ANIMS_OUT,
  audioLen,
  type AudioItem,
  type ChromaKey,
  type Marker,
  type Overlay,
  type VideoText,
  type WordMode,
} from './model';

export function Dock({ title, onDone, children, tabs, tab, onTab }: { title: string; onDone: () => void; children: ReactNode; tabs?: { id: string; label: string }[]; tab?: string; onTab?: (id: string) => void }) {
  return (
    <section className="dock" aria-label={title}>
      <header className="dock-head">
        <h2>{title}</h2>
        <button className="btn btn-primary btn-sm" onClick={onDone}>
          Готово
        </button>
      </header>
      {tabs && (
        <div className="dock-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => onTab?.(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="dock-body">{children}</div>
    </section>
  );
}

function Slider({ id, label, value, min, max, step, onChange, format }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <div className="dock-slider">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="slider" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output htmlFor={id}>{format(value)}</output>
    </div>
  );
}

/* ---------------- Текст ---------------- */
const STYLES: { id: TextStyle; label: string }[] = [
  { id: 'plain', label: 'Обычный' },
  { id: 'shadow', label: 'Тень' },
  { id: 'outline', label: 'Контур' },
  { id: 'box', label: 'Плашка' },
  { id: 'neon', label: 'Неон' },
];
const WORD_MODES: { id: WordMode; label: string; sub: string }[] = [
  { id: 'build', label: 'По словам', sub: 'появляются в момент речи' },
  { id: 'single', label: 'Одно слово', sub: 'крупно, как в Reels' },
  { id: 'karaoke', label: 'Караоке', sub: 'фраза, слово подсвечено' },
  { id: 'phrase', label: 'Фраза', sub: 'целиком' },
];

export function TextPanel({
  t,
  onChange,
  onCommit,
  onDone,
  onApplyStyleAll,
}: {
  t: VideoText;
  onChange: (p: Partial<VideoText>) => void;
  onCommit: () => void;
  onDone: () => void;
  onApplyStyleAll?: () => void;
}) {
  const [tab, setTab] = useState('font');
  const tabs = [
    { id: 'font', label: 'Шрифт' },
    { id: 'color', label: 'Цвет' },
    { id: 'style', label: 'Стиль' },
    { id: 'anim', label: 'Анимация' },
    ...(t.words?.length ? [{ id: 'words', label: 'Слова' }] : []),
  ];
  const fontDef = TEXT_FONTS[t.font] ?? TEXT_FONTS.accent;
  return (
    <Dock title={t.subtitle ? 'Субтитр' : 'Текст'} onDone={onDone} tabs={tabs} tab={tab} onTab={setTab}>
      <textarea
        className="dock-input"
        value={t.text}
        rows={1}
        maxLength={300}
        placeholder="Введите текст"
        onChange={(e) => onChange({ text: e.target.value })}
        onBlur={onCommit}
        style={{ fontFamily: fontDef.family, fontWeight: fontDef.weight }}
      />
      {tab === 'font' && (
        <>
          <div className="font-grid" role="listbox" aria-label="Шрифт">
            {(Object.keys(TEXT_FONTS) as TextFont[]).map((f) => (
              <button
                key={f}
                role="option"
                aria-selected={t.font === f}
                className={`font-opt ${t.font === f ? 'is-active' : ''}`}
                style={{ fontFamily: TEXT_FONTS[f].family, fontWeight: TEXT_FONTS[f].weight }}
                onClick={() => onChange({ font: f })}
              >
                Аа
                <small>{TEXT_FONTS[f].name}</small>
              </button>
            ))}
          </div>
          <TextSizeControl size={t.size} rotation={t.rotation} onChange={(size) => onChange({ size })} onEnd={onCommit} onResetRotation={() => onChange({ rotation: 0 })} />
        </>
      )}
      {tab === 'color' && (
        <>
          <div className="swatches swatches-scroll">
            {TEXT_COLORS.map((c) => (
              <button key={c} className={`swatch ${t.color.toLowerCase() === c.toLowerCase() ? 'is-active' : ''}`} style={{ background: c }} aria-label={`Цвет ${c}`} onClick={() => onChange({ color: c })} />
            ))}
            <label className="swatch swatch-custom" aria-label="Свой цвет">
              <input type="color" value={t.color} onChange={(e) => onChange({ color: e.target.value.toUpperCase() })} />
            </label>
          </div>
          <Slider id="text-op" label="Прозрачность" value={Math.round((t.opacity ?? 1) * 100)} min={5} max={100} step={1} onChange={(v) => onChange({ opacity: v / 100 })} format={(v) => `${v}%`} />
        </>
      )}
      {tab === 'style' && (
        <>
          <div className="chip-row chip-row-scroll">
            {STYLES.map((s) => (
              <button key={s.id} className={`pill pill-sm ${t.style === s.id ? 'is-active' : ''}`} onClick={() => onChange({ style: s.id })}>
                {s.label}
              </button>
            ))}
          </div>
          {onApplyStyleAll && (
            <button className="btn btn-soft btn-sm" onClick={onApplyStyleAll}>
              Этот вид — ко всем субтитрам
            </button>
          )}
        </>
      )}
      {tab === 'anim' && (
        <>
          <span className="dock-label">Появление</span>
          <div className="chip-row chip-row-scroll">
            {TEXT_ANIMS_IN.map((a) => (
              <button key={a.id} className={`pill pill-sm ${(t.animIn ?? 'none') === a.id ? 'is-active' : ''}`} onClick={() => onChange({ animIn: a.id })}>
                {a.label}
              </button>
            ))}
          </div>
          <span className="dock-label">Исчезновение</span>
          <div className="chip-row chip-row-scroll">
            {TEXT_ANIMS_OUT.map((a) => (
              <button key={a.id} className={`pill pill-sm ${(t.animOut ?? 'none') === a.id ? 'is-active' : ''}`} onClick={() => onChange({ animOut: a.id })}>
                {a.label}
              </button>
            ))}
          </div>
          <Slider id="text-ad" label="Длительность" value={t.animDur ?? 0.5} min={0.15} max={2} step={0.05} onChange={(v) => onChange({ animDur: v })} format={(v) => `${v.toFixed(2).replace('.', ',')} с`} />
        </>
      )}
      {tab === 'words' && (
        <div className="word-modes">
          {WORD_MODES.map((m) => (
            <button key={m.id} className={`word-mode ${(t.wordMode ?? 'build') === m.id ? 'is-active' : ''}`} onClick={() => onChange({ wordMode: m.id })}>
              <b>{m.label}</b>
              <small>{m.sub}</small>
            </button>
          ))}
        </div>
      )}
    </Dock>
  );
}

/* ---------------- Звук ---------------- */
const VOICE_PRESETS: { label: string; speed: number; pitch: number; reverb: number }[] = [
  { label: 'Обычный', speed: 1, pitch: 0, reverb: 0 },
  { label: 'Slowed + Reverb', speed: 0.85, pitch: -2, reverb: 0.55 },
  { label: 'Speed up', speed: 1.25, pitch: 3, reverb: 0 },
  { label: 'Ниже', speed: 1, pitch: -4, reverb: 0 },
  { label: 'Выше', speed: 1, pitch: 4, reverb: 0 },
  { label: 'Эхо зала', speed: 1, pitch: 0, reverb: 0.6 },
];

export function AudioPanel({ a, trackDuration, busy, onChange, onCommit, onDone }: { a: AudioItem; trackDuration: number; busy: boolean; onChange: (p: Partial<AudioItem>) => void; onCommit: () => void; onDone: () => void }) {
  const [tab, setTab] = useState('volume');
  const len = audioLen(a);
  return (
    <Dock
      title="Звук"
      onDone={onDone}
      tabs={[
        { id: 'volume', label: 'Громкость' },
        { id: 'fade', label: 'Затухание' },
        { id: 'fx', label: 'Эффекты' },
        { id: 'trim', label: 'Обрезка' },
      ]}
      tab={tab}
      onTab={setTab}
    >
      <div onPointerUp={onCommit} onKeyUp={onCommit}>
        {tab === 'volume' && (
          <>
            <Slider id="a-vol" label="Громкость" value={Math.round(a.volume * 100)} min={0} max={200} step={5} onChange={(v) => onChange({ volume: v / 100 })} format={(v) => `${v}%`} />
            <div className="chip-row">
              {[0, 50, 100, 150].map((v) => (
                <button key={v} className={`pill pill-sm ${Math.round(a.volume * 100) === v ? 'is-active' : ''}`} onClick={() => onChange({ volume: v / 100 })}>
                  {v === 0 ? 'Без звука' : `${v}%`}
                </button>
              ))}
            </div>
          </>
        )}
        {tab === 'fade' && (
          <>
            <Slider id="a-fi" label="Подъём" value={a.fadeIn} min={0} max={Math.min(8, len / 2)} step={0.1} onChange={(v) => onChange({ fadeIn: v })} format={(v) => (v ? `${v.toFixed(1).replace('.', ',')} с` : 'нет')} />
            <Slider id="a-fo" label="Затухание" value={a.fadeOut} min={0} max={Math.min(8, len / 2)} step={0.1} onChange={(v) => onChange({ fadeOut: v })} format={(v) => (v ? `${v.toFixed(1).replace('.', ',')} с` : 'нет')} />
            <p className="muted small">Громкость плавно нарастает в начале и уходит в тишину в конце. На шкале это видно по скосам.</p>
          </>
        )}
        {tab === 'fx' && (
          <>
            <div className="chip-row chip-row-scroll">
              {VOICE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`pill pill-sm ${(a.speed ?? 1) === p.speed && (a.pitch ?? 0) === p.pitch && (a.reverb ?? 0) === p.reverb ? 'is-active' : ''}`}
                  onClick={() => onChange({ speed: p.speed, pitch: p.pitch, reverb: p.reverb })}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Slider id="a-sp" label="Скорость" value={a.speed ?? 1} min={0.5} max={2} step={0.05} onChange={(v) => onChange({ speed: v })} format={(v) => `${v.toFixed(2).replace('.', ',')}×`} />
            <Slider id="a-pi" label="Тональность" value={a.pitch ?? 0} min={-12} max={12} step={1} onChange={(v) => onChange({ pitch: v })} format={(v) => (v > 0 ? `+${v}` : String(v))} />
            <Slider id="a-rv" label="Эхо" value={Math.round((a.reverb ?? 0) * 100)} min={0} max={100} step={5} onChange={(v) => onChange({ reverb: v / 100 })} format={(v) => `${v}%`} />
            <p className="muted small">{busy ? 'Обрабатываю звук… это несколько секунд.' : 'Скорость не меняет тон, тон не меняет скорость. Так же прозвучит и в готовом видео.'}</p>
          </>
        )}
        {tab === 'trim' && (
          <>
            <Slider id="a-in" label="Начало трека" value={a.in} min={0} max={Math.max(0, a.out - 0.3)} step={0.1} onChange={(v) => onChange({ in: v })} format={formatTime} />
            <Slider id="a-out" label="Конец трека" value={a.out} min={a.in + 0.3} max={Math.max(a.in + 0.3, trackDuration)} step={0.1} onChange={(v) => onChange({ out: v })} format={formatTime} />
            <p className="muted small">Или тяните края полосы звука на шкале. Длинное нажатие не нужно: выберите полосу и тяните её целиком, чтобы сдвинуть.</p>
          </>
        )}
      </div>
    </Dock>
  );
}

/* ---------------- Наложение ---------------- */
const KEY_COLORS = ['#00FF00', '#00B140', '#0047BB', '#FFFFFF', '#000000'];
const DEFAULT_KEY: ChromaKey = { color: '#00FF00', similarity: 0.4, smoothness: 0.15, spill: 0.5 };

export function OverlayPanel({ o, isVideo, onChange, onCommit, onDone, onAutoKey }: { o: Overlay; isVideo: boolean; onChange: (p: Partial<Overlay>) => void; onCommit: () => void; onDone: () => void; onAutoKey: () => void }) {
  const [tab, setTab] = useState('key');
  const k = o.key;
  return (
    <Dock
      title="Наложение"
      onDone={onDone}
      tabs={[
        { id: 'key', label: 'Хромакей' },
        { id: 'look', label: 'Вид' },
        ...(isVideo ? [{ id: 'sound', label: 'Звук' }] : []),
      ]}
      tab={tab}
      onTab={setTab}
    >
      <div onPointerUp={onCommit} onKeyUp={onCommit}>
        {tab === 'key' && (
          <>
            <label className="row switch-row dock-switch" htmlFor="ov-key">
              <span className="row-body">
                <span className="row-title">Убрать фон по цвету</span>
                <span className="row-sub">Зелёный или синий фон, однотонная стена</span>
              </span>
              <input id="ov-key" type="checkbox" className="switch" checked={!!k} onChange={(e) => (e.target.checked ? onAutoKey() : onChange({ key: null }))} />
            </label>
            {k && (
              <>
                <div className="swatches swatches-scroll">
                  <button className="pill pill-sm" onClick={onAutoKey}>
                    <Icon name="wand" size={14} /> Авто
                  </button>
                  {KEY_COLORS.map((c) => (
                    <button key={c} className={`swatch ${k.color.toUpperCase() === c ? 'is-active' : ''}`} style={{ background: c }} aria-label={`Фон ${c}`} onClick={() => onChange({ key: { ...k, color: c } })} />
                  ))}
                  <label className="swatch swatch-custom" aria-label="Свой цвет фона" style={{ background: k.color }}>
                    <input type="color" value={k.color} onChange={(e) => onChange({ key: { ...k, color: e.target.value } })} />
                  </label>
                </div>
                <Slider id="k-sim" label="Сила" value={Math.round(k.similarity * 100)} min={0} max={100} step={1} onChange={(v) => onChange({ key: { ...k, similarity: v / 100 } })} format={(v) => `${v}`} />
                <Slider id="k-sm" label="Мягкость края" value={Math.round(k.smoothness * 100)} min={0} max={100} step={1} onChange={(v) => onChange({ key: { ...k, smoothness: v / 100 } })} format={(v) => `${v}`} />
                <Slider id="k-sp" label="Убрать кайму" value={Math.round(k.spill * 100)} min={0} max={100} step={1} onChange={(v) => onChange({ key: { ...k, spill: v / 100 } })} format={(v) => `${v}`} />
              </>
            )}
          </>
        )}
        {tab === 'look' && (
          <>
            <Slider id="ov-op" label="Прозрачность" value={Math.round(o.opacity * 100)} min={5} max={100} step={1} onChange={(v) => onChange({ opacity: v / 100 })} format={(v) => `${v}%`} />
            <Slider id="ov-w" label="Размер" value={Math.round(o.w * 100)} min={10} max={200} step={1} onChange={(v) => onChange({ w: v / 100 })} format={(v) => `${v}%`} />
            <div className="chip-row">
              <button className="pill pill-sm" onClick={() => onChange({ x: 0.5, y: 0.5, w: 1, rotation: 0 })}>
                На весь кадр
              </button>
              <button className="pill pill-sm" onClick={() => onChange({ x: 0.5, y: 0.5 })}>
                По центру
              </button>
              <button className="pill pill-sm" onClick={() => onChange({ rotation: 0 })}>
                Без поворота
              </button>
            </div>
          </>
        )}
        {tab === 'sound' && <Slider id="ov-vol" label="Громкость" value={Math.round(o.volume * 100)} min={0} max={200} step={5} onChange={(v) => onChange({ volume: v / 100 })} format={(v) => `${v}%`} />}
      </div>
    </Dock>
  );
}
export { DEFAULT_KEY };

/* ---------------- Скорость клипа ---------------- */
export function SpeedPanel({ speed, smooth, onChange, onDone }: { speed: number; smooth: boolean; onChange: (p: { speed?: number; smooth?: boolean }) => void; onDone: () => void }) {
  return (
    <Dock title="Скорость клипа" onDone={onDone}>
      <div className="chip-row chip-row-scroll speed-row" role="radiogroup" aria-label="Скорость">
        {SPEEDS.map((s) => (
          <button key={s} role="radio" aria-checked={speed === s} className={`pill pill-sm ${Math.abs(speed - s) < 1e-3 ? 'is-active' : ''}`} onClick={() => onChange({ speed: s })}>
            {String(s).replace('.', ',')}×
          </button>
        ))}
      </div>
      <Slider id="sp" label="Точно" value={speed} min={0.1} max={4} step={0.05} onChange={(v) => onChange({ speed: Math.round(v * 100) / 100 })} format={(v) => `${v.toFixed(2).replace('.', ',')}×`} />
      <button className={`smooth-btn ${smooth ? 'is-on' : ''}`} onClick={() => onChange({ smooth: !smooth })} aria-pressed={smooth}>
        <Icon name="sparkle" size={20} />
        <span className="row-body">
          <span className="row-title">Сделать плавнее</span>
          <span className="row-sub">Мягкий разгон и торможение на краях, смешивание соседних кадров при замедлении — без рывков и подёргиваний</span>
        </span>
        <span className={`check-dot ${smooth ? 'is-on' : ''}`}>{smooth && <Icon name="check" size={14} stroke={3} />}</span>
      </button>
      <p className="muted small">
        Смешивание кадров делает движение мягким, но не дорисовывает новые кадры. Для идеального слоумо снимайте в 60 или 120 к/с — тогда замедление будет чистым.
      </p>
    </Dock>
  );
}

/* ---------------- Ключ ---------------- */
export function MarkerPanel({ m, onChange, onCommit, onDone, onToPlayhead, onDelete }: { m: Marker; onChange: (p: Partial<Marker>) => void; onCommit: () => void; onDone: () => void; onToPlayhead: () => void; onDelete: () => void }) {
  return (
    <Dock title="Ключ" onDone={onDone}>
      <input className="dock-input" value={m.label} maxLength={40} placeholder="Название (например: «бит», «смена кадра»)" onChange={(e) => onChange({ label: e.target.value })} onBlur={onCommit} />
      <div className="swatches">
        {MARKER_COLORS.map((c) => (
          <button key={c} className={`swatch ${m.color === c ? 'is-active' : ''}`} style={{ background: c }} aria-label={`Цвет ${c}`} onClick={() => onChange({ color: c })} />
        ))}
      </div>
      <p className="muted small">
        {formatTime(m.start)} — {formatTime(m.end)}. Тяните края ключа на шкале, чтобы отметить нужный промежуток. Нажатие на выбранный ключ переносит плейхед к его началу.
      </p>
      <div className="btn-pair">
        <button className="btn btn-soft" onClick={onToPlayhead}>
          Конец — по плейхеду
        </button>
        <button className="btn btn-danger-soft" onClick={onDelete}>
          <Icon name="trash" size={18} /> Удалить
        </button>
      </div>
    </Dock>
  );
}
