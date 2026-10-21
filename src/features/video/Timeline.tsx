import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '../../components/Icon';
import { formatTime } from '../../lib/format';
import { clipLen, clipStarts, moveClip, totalDuration, trimClip, updateText, type Timeline as TL } from './model';
import type { LoadedSource } from './useVideoProject';

export type Selection = { kind: 'clip'; id: string } | { kind: 'text'; id: string } | { kind: 'music' } | null;

interface Props {
  timeline: TL;
  sources: Record<string, LoadedSource>;
  pps: number;
  setPps: (v: number) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Плеер: подписка на время и перемотка */
  subscribe: (f: (t: number) => void) => () => void;
  timeRef: { current: number };
  onScrub: (t: number) => void;
  onUserInteract: () => void;
  live: (fn: (t: TL) => TL) => void;
  apply: (fn: (t: TL) => TL) => void;
  endGesture: () => void;
  onAddClip: () => void;
  onAddMusic: () => void;
  onAddText: () => void;
}

const ROW_CLIP = 56;

function tickStep(pps: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s * pps >= 58) return s;
  return 600;
}

export function Timeline(props: Props) {
  const { timeline, sources, pps, setPps, selection, onSelect, subscribe, timeRef, onScrub, onUserInteract, live, apply, endGesture } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(360);
  const lastSet = useRef(-1);
  const total = totalDuration(timeline);
  const starts = clipStarts(timeline);
  const half = viewW / 2;
  const ppsRef = useRef(pps);
  ppsRef.current = pps;

  // Ширина видимой области
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setViewW(el.clientWidth || 360);
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // Время плеера → прокрутка шкалы (плейхед всегда по центру)
  const setScroll = (t: number) => {
    const el = scroller.current;
    if (!el) return;
    const x = Math.round(t * ppsRef.current);
    if (Math.abs(el.scrollLeft - x) < 1) return;
    lastSet.current = x;
    el.scrollLeft = x;
  };
  useEffect(() => subscribe(setScroll), [subscribe]);
  useEffect(() => setScroll(timeRef.current), [pps, viewW, total]); // eslint-disable-line react-hooks/exhaustive-deps

  // Прокрутка пальцем → перемотка
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    if (Math.abs(el.scrollLeft - lastSet.current) <= 1) return;
    lastSet.current = -1;
    onScrub(el.scrollLeft / ppsRef.current);
  };

  // Масштаб двумя пальцами
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let startDist = 0;
    let startPps = 0;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = dist(e);
        startPps = ppsRef.current;
      }
    };
    const tm = (e: TouchEvent) => {
      if (e.touches.length === 2 && startDist) {
        e.preventDefault();
        setPps(clampPps(startPps * (dist(e) / startDist)));
      }
    };
    const te = () => (startDist = 0);
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
    };
  }, [setPps]);

  /* ---------- Жесты клипов ---------- */
  type Drag =
    | { type: 'trim'; id: string; edge: 'in' | 'out'; x0: number; v0: number; srcDur: number; start: number }
    | { type: 'move'; id: string; index: number; x0: number; dx: number; moved: boolean }
    | { type: 'text-move'; id: string; x0: number; s0: number; e0: number }
    | { type: 'text-trim'; id: string; edge: 'start' | 'end'; x0: number; v0: number };
  const drag = useRef<Drag | null>(null);
  const [moveDx, setMoveDx] = useState<{ id: string; dx: number } | null>(null);

  const capture = (e: RPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onUserInteract();
  };

  const onTrimDown = (id: string, edge: 'in' | 'out') => (e: RPointerEvent<HTMLElement>) => {
    capture(e);
    const i = timeline.clips.findIndex((c) => c.id === id);
    const c = timeline.clips[i];
    drag.current = { type: 'trim', id, edge, x0: e.clientX, v0: edge === 'in' ? c.in : c.out, srcDur: sources[c.src]?.duration ?? c.out, start: starts[i] };
  };
  const onClipDown = (id: string, index: number) => (e: RPointerEvent<HTMLElement>) => {
    if (!(selection?.kind === 'clip' && selection.id === id)) return; // невыбранный клип — обычная прокрутка
    capture(e);
    drag.current = { type: 'move', id, index, x0: e.clientX, dx: 0, moved: false };
  };
  const onTextDown = (id: string) => (e: RPointerEvent<HTMLElement>) => {
    if (!(selection?.kind === 'text' && selection.id === id)) return;
    capture(e);
    const t = timeline.texts.find((x) => x.id === id)!;
    drag.current = { type: 'text-move', id, x0: e.clientX, s0: t.start, e0: t.end };
  };
  const onTextTrimDown = (id: string, edge: 'start' | 'end') => (e: RPointerEvent<HTMLElement>) => {
    capture(e);
    const t = timeline.texts.find((x) => x.id === id)!;
    drag.current = { type: 'text-trim', id, edge, x0: e.clientX, v0: edge === 'start' ? t.start : t.end };
  };

  const onMove = (e: RPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dt = (e.clientX - d.x0) / pps;
    if (d.type === 'trim') {
      const value = d.v0 + dt;
      live((t) => trimClip(t, d.id, d.edge, value, d.srcDur));
      // Показываем кадр на месте среза
      const c = timeline.clips.find((x) => x.id === d.id);
      if (c) onScrub(d.edge === 'in' ? d.start : d.start + Math.max(0, Math.min(d.srcDur, value) - c.in) - 0.02);
    } else if (d.type === 'move') {
      const dx = e.clientX - d.x0;
      if (!d.moved && Math.abs(dx) < 8) return;
      d.moved = true;
      d.dx = dx;
      setMoveDx({ id: d.id, dx });
    } else if (d.type === 'text-move') {
      const len = d.e0 - d.s0;
      const s = Math.min(Math.max(0, d.s0 + dt), Math.max(0, total - len));
      live((t) => updateText(t, d.id, { start: s, end: s + len }));
    } else if (d.type === 'text-trim') {
      live((t) => {
        const x = t.texts.find((y) => y.id === d.id)!;
        if (d.edge === 'start') return updateText(t, d.id, { start: Math.min(Math.max(0, d.v0 + dt), x.end - 0.3) });
        return updateText(t, d.id, { end: Math.max(Math.min(total, d.v0 + dt), x.start + 0.3) });
      });
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.type === 'move') {
      setMoveDx(null);
      if (!d.moved) return;
      // Новое место: сколько клипов левее центра перетаскиваемого
      const c = timeline.clips[d.index];
      const mid = (starts[d.index] + clipLen(c) / 2) * pps + d.dx;
      let to = 0;
      timeline.clips.forEach((o, i) => {
        if (i !== d.index && (starts[i] + clipLen(o) / 2) * pps < mid) to++;
      });
      apply((t) => moveClip(t, d.index, to));
    } else {
      endGesture();
    }
  };

  const contentW = total * pps;
  const step = tickStep(pps);
  const ticks: number[] = [];
  for (let s = 0; s <= total + 0.001; s += step) ticks.push(s);
  const music = timeline.music ? sources[timeline.music.src] : null;
  const musicLen = music ? Math.min(music.duration, total) : 0;

  return (
    <div className="tl">
      <div
        className="tl-scroll"
        ref={scroller}
        onScroll={onScroll}
        onPointerDown={onUserInteract}
        onClick={(e) => e.target === e.currentTarget && onSelect(null)}
      >
        <div className="tl-content" style={{ width: contentW + viewW }} onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
          <div className="tl-ruler" style={{ marginLeft: half, width: contentW }} aria-hidden="true">
            {ticks.map((s) => (
              <span key={s} className="tl-tick" style={{ left: s * pps }}>
                {formatTime(s)}
              </span>
            ))}
          </div>

          {/* Видео */}
          <div className="tl-row tl-row-clips" style={{ marginLeft: half, height: ROW_CLIP }}>
            {timeline.clips.map((c, i) => {
              const src = sources[c.src];
              const selected = selection?.kind === 'clip' && selection.id === c.id;
              const dx = moveDx?.id === c.id ? moveDx.dx : 0;
              const frames = src?.frames ?? [];
              const srcDur = src?.duration || c.out;
              return (
                <div
                  key={c.id}
                  className={`tl-clip ${selected ? 'is-selected' : ''} ${dx ? 'is-dragging' : ''}`}
                  style={{ left: starts[i] * pps, width: clipLen(c) * pps, transform: dx ? `translateX(${dx}px)` : undefined }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!selected) onSelect({ kind: 'clip', id: c.id });
                  }}
                  onPointerDown={onClipDown(c.id, i)}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                  role="button"
                  aria-label={`Клип ${i + 1}, ${formatTime(clipLen(c))}`}
                >
                  <div className="tl-strip" style={{ left: -c.in * pps, width: srcDur * pps }}>
                    {frames.length ? frames.map((f, k) => <img key={k} src={f} alt="" draggable={false} />) : <span className="frame-ph" />}
                  </div>
                  {c.volume === 0 && (
                    <span className="tl-badge">
                      <Icon name="music" size={12} /> выкл
                    </span>
                  )}
                  {selected && (
                    <>
                      <span className="tl-handle tl-handle-l" onPointerDown={onTrimDown(c.id, 'in')} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
                      <span className="tl-handle tl-handle-r" onPointerDown={onTrimDown(c.id, 'out')} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
                      <span className="tl-dur">{formatTime(clipLen(c))}</span>
                    </>
                  )}
                </div>
              );
            })}
            <button className="tl-add" style={{ left: contentW + 8 }} onClick={props.onAddClip} aria-label="Добавить клип">
              <Icon name="plus" size={22} stroke={2.6} />
            </button>
          </div>

          {/* Текст */}
          <div className="tl-row tl-row-sub" style={{ marginLeft: half, width: contentW }}>
            {timeline.texts.map((t) => {
              const selected = selection?.kind === 'text' && selection.id === t.id;
              return (
                <div
                  key={t.id}
                  className={`tl-bar tl-bar-text ${selected ? 'is-selected' : ''}`}
                  style={{ left: t.start * pps, width: Math.max(12, (t.end - t.start) * pps) }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'text', id: t.id });
                  }}
                  onPointerDown={onTextDown(t.id)}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                >
                  <Icon name="text" size={13} />
                  <span>{t.text.split('\n')[0] || 'Текст'}</span>
                  {selected && (
                    <>
                      <span className="tl-handle tl-handle-l sm" onPointerDown={onTextTrimDown(t.id, 'start')} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
                      <span className="tl-handle tl-handle-r sm" onPointerDown={onTextTrimDown(t.id, 'end')} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
                    </>
                  )}
                </div>
              );
            })}

          </div>

          {/* Музыка */}
          <div className="tl-row tl-row-sub" style={{ marginLeft: half, width: contentW }}>
            {timeline.music && music && (
              <div
                className={`tl-bar tl-bar-music ${selection?.kind === 'music' ? 'is-selected' : ''}`}
                style={{ left: 0, width: Math.max(12, musicLen * pps) }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: 'music' });
                }}
              >
                <Icon name="music" size={13} />
                <span>{music.name}</span>
                <i className="tl-wave" aria-hidden="true" />
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Кнопки «добавить» — от плейхеда, видны при любой прокрутке */}
      {!timeline.texts.length && timeline.clips.length > 0 && (
        <button className="tl-ghost tl-ghost-text" onClick={props.onAddText}>
          <Icon name="text" size={14} /> Текст отсюда
        </button>
      )}
      {!timeline.music && timeline.clips.length > 0 && (
        <button className="tl-ghost tl-ghost-music" onClick={props.onAddMusic}>
          <Icon name="music" size={14} /> Добавить музыку
        </button>
      )}
      <div className="tl-playhead" aria-hidden="true" />
    </div>
  );
}

export function clampPps(v: number): number {
  return Math.min(200, Math.max(4, v));
}
