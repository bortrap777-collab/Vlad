import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '../../components/Icon';
import { formatTime } from '../../lib/format';
import {
  TRANSITIONS,
  audioLen,
  audioSpeed,
  clipLen,
  clipStarts,
  hasLook,
  hasTransition,
  moveClip,
  packLanes,
  retimeText,
  shiftText,
  speedOf,
  totalDuration,
  trimClip,
  updateAudio,
  updateMarker,
  updateOverlay,
  type Timeline as TL,
} from './model';
import type { LoadedSource } from './useVideoProject';
import { Waveform } from './Waveform';

export type Selection =
  | { kind: 'clip'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'audio'; id: string }
  | { kind: 'overlay'; id: string }
  | { kind: 'marker'; id: string }
  | null;

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
  /** Палец начал прокручивать шкалу (перемотка) */
  onScrubStart?: () => void;
  /** Прокрутка закончилась (палец отпущен, инерция остановилась) */
  onScrubEnd?: () => void;
  live: (fn: (t: TL) => TL) => void;
  apply: (fn: (t: TL) => TL) => void;
  endGesture: () => void;
  onAddClip: () => void;
  onAddMusic: () => void;
  onAddText: () => void;
  onTransition?: (clipId: string) => void;
  readSource: (id: string) => Promise<Blob>;
}

/* Раскладка строк (px) */
const PAD = 4;
const MARK_H = 18;
const RULER_H = 18;
const CLIP_H = 60;
const LANE_H = 34;
const GAP = 6;
const TILE = 58;
const TILE_GAP = 6;

function tickStep(pps: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s * pps >= 58) return s;
  return 600;
}

type BarKind = 'text' | 'audio' | 'overlay' | 'marker';
type Drag =
  | { type: 'trim'; id: string; edge: 'in' | 'out'; x0: number; s0: number; v0: number; srcDur: number; start: number; moved: boolean }
  | { type: 'bar'; kind: BarKind; id: string; mode: 'move' | 'start' | 'end'; x0: number; s0: number; snap: unknown; limit: number };

export function Timeline(props: Props) {
  const { timeline, sources, pps, setPps, selection, onSelect, subscribe, timeRef, onScrub, onUserInteract, live, apply, endGesture } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(360);
  const lastSet = useRef(-1);
  const total = totalDuration(timeline);
  const starts = clipStarts(timeline);
  const half = viewW / 2;
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const tlRef = useRef(timeline);
  tlRef.current = timeline;
  const drag = useRef<Drag | null>(null);
  const holdScroll = useRef(false);
  const [trimShift, setTrimShift] = useState<{ id: string; px: number } | null>(null);

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

  // Время плеера → прокрутка шкалы (плейхед всегда по центру). Во время жеста шкала стоит на месте.
  const setScroll = (t: number) => {
    const el = scroller.current;
    if (!el || holdScroll.current) return;
    const x = Math.round(t * ppsRef.current);
    if (Math.abs(el.scrollLeft - x) < 1) return;
    lastSet.current = x;
    el.scrollLeft = x;
  };
  useEffect(() => subscribe(setScroll), [subscribe]);
  useEffect(() => setScroll(timeRef.current), [pps, viewW, total]); // eslint-disable-line react-hooks/exhaustive-deps

  // Прокрутка пальцем → перемотка. Начало и конец прокрутки сообщаем наверх:
  // если видео играло, после остановки оно продолжается с нового места.
  const scrubbing = useRef(false);
  const touching = useRef(false);
  const scrubIdle = useRef(0);
  const finishScrubSoon = () => {
    window.clearTimeout(scrubIdle.current);
    scrubIdle.current = window.setTimeout(() => {
      if (touching.current || !scrubbing.current) return;
      scrubbing.current = false;
      props.onScrubEnd?.();
    }, 180);
  };
  const onScroll = () => {
    const el = scroller.current;
    if (!el || holdScroll.current) return;
    if (Math.abs(el.scrollLeft - lastSet.current) <= 1) return;
    lastSet.current = -1;
    if (!scrubbing.current) {
      scrubbing.current = true;
      props.onScrubStart?.();
    }
    onScrub(el.scrollLeft / ppsRef.current);
    finishScrubSoon();
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const down = () => (touching.current = true);
    const up = () => {
      touching.current = false;
      if (scrubbing.current) finishScrubSoon();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('touchstart', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
      window.clearTimeout(scrubIdle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /* ---------- Автопрокрутка у краёв во время жеста ---------- */
  const pointer = useRef({ x: 0, scroll0: 0 });
  const autoRaf = useRef(0);
  const autoScroll = () => {
    const el = scroller.current;
    const d = drag.current;
    if (!el || !d) {
      autoRaf.current = 0;
      return;
    }
    const r = el.getBoundingClientRect();
    const edge = 44;
    const x = pointer.current.x;
    let v = 0;
    if (x < r.left + edge) v = -Math.ceil(((r.left + edge - x) / edge) * 12);
    else if (x > r.right - edge) v = Math.ceil(((x - (r.right - edge)) / edge) * 12);
    if (v) {
      el.scrollLeft = Math.max(0, el.scrollLeft + v);
      applyDrag(x);
    }
    autoRaf.current = requestAnimationFrame(autoScroll);
  };
  const startAuto = () => {
    if (!autoRaf.current) autoRaf.current = requestAnimationFrame(autoScroll);
  };
  useEffect(() => () => cancelAnimationFrame(autoRaf.current), []);

  /** Смещение пальца по шкале в секундах (с учётом автопрокрутки) */
  const deltaT = (clientX: number, d: { x0: number }) => {
    const el = scroller.current;
    const ds = el ? el.scrollLeft - pointer.current.scroll0 : 0;
    return (clientX - d.x0 + ds) / ppsRef.current;
  };

  const begin = (e: RPointerEvent<HTMLElement>, d: Drag) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onUserInteract();
    drag.current = d;
    holdScroll.current = true;
    pointer.current = { x: e.clientX, scroll0: scroller.current?.scrollLeft ?? 0 };
    startAuto();
  };

  const applyDrag = (clientX: number) => {
    const d = drag.current;
    if (!d) return;
    const dt = deltaT(clientX, d);
    const t = tlRef.current;
    if (d.type === 'trim') {
      const c = t.clips.find((x) => x.id === d.id);
      if (!c) return;
      d.moved = true;
      // Палец двигается по шкале, обрезка — в секундах исходника (с учётом скорости)
      const sp = speedOf(c);
      const value = d.v0 + dt * sp;
      const next = trimClip(t, d.id, d.edge, value, d.srcDur);
      live(() => next);
      const nc = next.clips.find((x) => x.id === d.id)!;
      if (d.edge === 'in') {
        // Левая граница идёт за пальцем; клипы правее стоят на месте до отпускания
        setTrimShift({ id: d.id, px: (d.s0 - clipLen(nc)) * ppsRef.current });
        onScrub(d.start + 0.001);
      } else {
        setTrimShift(null);
        onScrub(d.start + Math.max(0, clipLen(nc) - 0.02));
      }
    } else if (d.type === 'bar') {
      live((tl) => barEdit(tl, d, dt));
    }
  };

  const onMove = (e: RPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    pointer.current.x = e.clientX;
    applyDrag(e.clientX);
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    holdScroll.current = false;
    cancelAnimationFrame(autoRaf.current);
    autoRaf.current = 0;
    if (!d) return;
    endGesture();
    const el = scroller.current;
    if (d.type === 'trim' && trimShift && el) {
      // Клипы сдвинулись влево на обрезанное — шкалу тоже, чтобы картинка не прыгнула
      el.scrollLeft = Math.max(0, el.scrollLeft - trimShift.px);
    }
    setTrimShift(null);
    if (el) {
      lastSet.current = el.scrollLeft;
      onScrub(el.scrollLeft / ppsRef.current);
    }
  };

  const onTrimDown = (id: string, edge: 'in' | 'out') => (e: RPointerEvent<HTMLElement>) => {
    const i = timeline.clips.findIndex((c) => c.id === id);
    const c = timeline.clips[i];
    begin(e, { type: 'trim', id, edge, x0: e.clientX, s0: clipLen(c), v0: edge === 'in' ? c.in : c.out, srcDur: sources[c.src]?.duration ?? c.out, start: starts[i], moved: false });
  };

  const onBarDown = (kind: BarKind, id: string, mode: 'move' | 'start' | 'end') => (e: RPointerEvent<HTMLElement>) => {
    if (mode === 'move' && !(selection?.kind === kind && selection.id === id)) return; // невыбранный — обычная прокрутка
    const snap = kind === 'text' ? timeline.texts.find((x) => x.id === id) : kind === 'audio' ? timeline.audios.find((x) => x.id === id) : kind === 'overlay' ? timeline.overlays.find((x) => x.id === id) : timeline.markers.find((x) => x.id === id);
    if (!snap) return;
    const limit = 'src' in snap ? sources[snap.src]?.kind === 'image' ? Infinity : sources[snap.src]?.duration ?? Infinity : Infinity;
    begin(e, { type: 'bar', kind, id, mode, x0: e.clientX, s0: 0, snap, limit });
  };

  /* ---------- Перестановка клипов: удержание → компактные плитки ---------- */
  const [reorder, setReorder] = useState<{ from: number; to: number; x: number; offset: number } | null>(null);
  const press = useRef<{ timer: number; x: number; y: number; index: number; pointerId: number; target: HTMLElement } | null>(null);
  const reorderRef = useRef(reorder);
  reorderRef.current = reorder;

  const enterReorder = (index: number, clientX: number) => {
    const r = root.current?.getBoundingClientRect();
    const x = clientX - (r?.left ?? 0);
    navigator.vibrate?.(12);
    onUserInteract();
    setReorder({ from: index, to: index, x, offset: x - (index * (TILE + TILE_GAP) + TILE / 2) });
  };

  const onClipDown = (id: string, index: number) => (e: RPointerEvent<HTMLElement>) => {
    const target = e.currentTarget as HTMLElement;
    const selected = selection?.kind === 'clip' && selection.id === id;
    press.current = {
      x: e.clientX,
      y: e.clientY,
      index,
      pointerId: e.pointerId,
      target,
      timer: window.setTimeout(() => {
        const p = press.current;
        if (!p) return;
        try {
          p.target.setPointerCapture(p.pointerId);
        } catch {
          /* палец уже ушёл */
        }
        enterReorder(p.index, p.x);
      }, 380),
    };
    if (selected) {
      // Выбранный клип можно сразу тащить
      e.stopPropagation();
      target.setPointerCapture(e.pointerId);
    }
  };
  const onClipMove = (e: RPointerEvent<HTMLElement>) => {
    const p = press.current;
    const r = reorderRef.current;
    if (r) {
      reorderMove(e.clientX);
      return;
    }
    if (!p) return;
    const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (moved > 8) {
      clearTimeout(p.timer);
      const selected = selection?.kind === 'clip' && timeline.clips[p.index]?.id === selection.id;
      press.current = null;
      if (selected) enterReorder(p.index, e.clientX);
    }
  };
  const onClipUp = () => {
    const p = press.current;
    if (p) clearTimeout(p.timer);
    press.current = null;
    const r = reorderRef.current;
    if (r) {
      if (r.to !== r.from) apply((t) => moveClip(t, r.from, r.to));
      setReorder(null);
    }
  };

  const reorderMove = (clientX: number) => {
    const rr = root.current?.getBoundingClientRect();
    if (!rr) return;
    const x = clientX - rr.left;
    setReorder((r) => {
      if (!r) return r;
      let offset = r.offset;
      // У краёв — прокрутка ленты плиток
      if (x < 36) offset += 6;
      if (x > rr.width - 36) offset -= 6;
      const n = tlRef.current.clips.length;
      const minOff = Math.min(16, rr.width - 16 - n * (TILE + TILE_GAP));
      offset = Math.max(minOff, Math.min(rr.width / 2, offset));
      const to = Math.max(0, Math.min(n - 1, Math.floor((x - offset + TILE_GAP / 2) / (TILE + TILE_GAP))));
      return { ...r, x, offset, to };
    });
  };

  // Во время перестановки страница не прокручивается
  useEffect(() => {
    if (!reorder) return;
    const block = (e: TouchEvent) => e.preventDefault();
    const tick = window.setInterval(() => reorderRef.current && reorderMove(reorderRef.current.x + (root.current?.getBoundingClientRect().left ?? 0)), 50);
    window.addEventListener('touchmove', block, { passive: false });
    return () => {
      window.removeEventListener('touchmove', block);
      clearInterval(tick);
    };
  }, [!!reorder]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Раскладка ---------- */
  const contentW = total * pps;
  const step = tickStep(pps);
  const ticks: number[] = [];
  for (let s = 0; s <= total + 0.001; s += step) ticks.push(s);

  const textLanes = packLanes(timeline.texts, (x) => [x.start, x.end]);
  const ovLanes = packLanes(timeline.overlays, (x) => [x.start, x.end]);
  const audioLanes = packLanes(timeline.audios, (x) => [x.start, x.start + audioLen(x)]);
  const nOv = timeline.overlays.length ? Math.max(...ovLanes.values()) + 1 : 0;
  const nText = Math.max(1, timeline.texts.length ? Math.max(...textLanes.values()) + 1 : 1);
  const nAudio = Math.max(1, timeline.audios.length ? Math.max(...audioLanes.values()) + 1 : 1);
  const markerLanes = packLanes(timeline.markers, (x) => [x.start, Math.max(x.end, x.start + 12 / pps)]);

  const yMarks = PAD;
  const yRuler = yMarks + MARK_H + 2;
  const yClips = yRuler + RULER_H + GAP;
  const yOv = yClips + CLIP_H + GAP;
  const yText = yOv + nOv * (LANE_H + GAP);
  const yAudio = yText + nText * (LANE_H + GAP);
  const height = yAudio + nAudio * (LANE_H + GAP) + PAD;

  const isSel = (kind: BarKind | 'clip', id: string) => selection?.kind === kind && selection.id === id;
  const handles = (kind: BarKind, id: string) => (
    <>
      <span className="tl-handle tl-handle-l sm" onPointerDown={onBarDown(kind, id, 'start')} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      <span className="tl-handle tl-handle-r sm" onPointerDown={onBarDown(kind, id, 'end')} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
    </>
  );
  const barEvents = (kind: BarKind, id: string) => ({
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect({ kind, id } as Selection);
    },
    onPointerDown: onBarDown(kind, id, 'move'),
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: onUp,
  });

  return (
    <div className="tl" ref={root}>
      <div className="tl-scroll" ref={scroller} onScroll={onScroll} onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
        <div className="tl-content" style={{ width: contentW + viewW, height }} onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
          {/* Ключи — отмеченные промежутки */}
          <div className="tl-abs" style={{ top: yMarks, left: half, width: contentW, height: MARK_H }}>
            {timeline.markers.map((m) => {
              const sel = isSel('marker', m.id);
              const lane = markerLanes.get(m.id) ?? 0;
              return (
                <div
                  key={m.id}
                  className={`tl-marker ${sel ? 'is-selected' : ''}`}
                  style={{ left: m.start * pps, width: Math.max(10, (m.end - m.start) * pps), background: m.color, top: lane ? 9 : 0, height: lane ? 9 : MARK_H }}
                  {...barEvents('marker', m.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (sel) onScrub(m.start);
                    onSelect({ kind: 'marker', id: m.id });
                  }}
                >
                  {m.label && <span>{m.label}</span>}
                  {sel && handles('marker', m.id)}
                </div>
              );
            })}
          </div>

          <div className="tl-ruler tl-abs" style={{ top: yRuler, left: half, width: contentW }} aria-hidden="true">
            {ticks.map((s) => (
              <span key={s} className="tl-tick" style={{ left: s * pps }}>
                {formatTime(s)}
              </span>
            ))}
            {timeline.markers.map((m) => (
              <i key={m.id} className="tl-mark-band" style={{ left: m.start * pps, width: Math.max(2, (m.end - m.start) * pps), background: m.color }} />
            ))}
          </div>

          {/* Видео */}
          <div className="tl-row-clips tl-abs" style={{ top: yClips, left: half, height: CLIP_H, width: contentW }}>
            {timeline.clips.map((c, i) => {
              const src = sources[c.src];
              const selected = isSel('clip', c.id);
              const frames = src?.frames ?? [];
              const srcDur = src?.duration || c.out;
              const shiftIdx = trimShift ? timeline.clips.findIndex((x) => x.id === trimShift.id) : -1;
              const shift = trimShift && i >= shiftIdx ? trimShift.px : 0;
              const sp = speedOf(c);
              return (
                <div
                  key={c.id}
                  className={`tl-clip ${selected ? 'is-selected' : ''} ${c.smooth && sp !== 1 ? 'is-smooth' : ''}`}
                  style={{ left: starts[i] * pps + shift, width: clipLen(c) * pps }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!selected) onSelect({ kind: 'clip', id: c.id });
                  }}
                  onPointerDown={onClipDown(c.id, i)}
                  onPointerMove={onClipMove}
                  onPointerUp={onClipUp}
                  onPointerCancel={onClipUp}
                  onContextMenu={(e) => e.preventDefault()}
                  role="button"
                  aria-label={`Клип ${i + 1}, ${formatTime(clipLen(c))}`}
                >
                  <div className="tl-strip-box">
                    <div className="tl-strip" style={{ left: (-c.in * pps) / sp, width: (srcDur * pps) / sp }}>
                      {frames.length ? frames.map((f, k) => <img key={k} src={f} alt="" draggable={false} />) : <span className="frame-ph" />}
                    </div>
                  </div>
                  {(c.volume === 0 || sp !== 1 || hasLook(c)) && (
                    <span className="tl-badge">
                      {sp !== 1 && (
                        <b>
                          {String(sp).replace('.', ',')}×{c.smooth ? ' ∿' : ''}
                        </b>
                      )}
                      {hasLook(c) && <Icon name="filters" size={12} />}
                      {c.volume === 0 && <Icon name="music" size={12} />}
                      {c.volume === 0 && 'выкл'}
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
            {/* Переходы между клипами: нажатие открывает выбор эффекта */}
            {!trimShift &&
              timeline.clips.slice(1).map((c, k) => {
                const on = hasTransition(c);
                // У краёв выбранного клипа — ручки обрезки: кнопку перехода поднимаем на верхний край, чтобы не перекрывала их
                const raised = selection?.kind === 'clip' && (selection.id === c.id || selection.id === timeline.clips[k].id);
                return (
                  <button
                    key={'tr' + c.id}
                    className={`tl-trans ${on ? 'is-on' : ''} ${raised ? 'is-raised' : ''}`}
                    style={{ left: starts[k + 1] * pps }}
                    aria-label={on ? `Переход: ${TRANSITIONS.find((x) => x.id === c.transition)?.label}` : 'Добавить переход'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUserInteract();
                      props.onTransition?.(c.id);
                    }}
                  >
                    <Icon name={on ? 'transition' : 'plus'} size={on ? 13 : 12} stroke={2.6} />
                  </button>
                );
              })}
            <button className="tl-add" style={{ left: contentW + 8 + (trimShift?.px ?? 0) }} onClick={props.onAddClip} aria-label="Добавить клип">
              <Icon name="plus" size={22} stroke={2.6} />
            </button>
          </div>

          {/* Наложения */}
          {timeline.overlays.map((o) => {
            const sel = isSel('overlay', o.id);
            const s = sources[o.src];
            return (
              <div
                key={o.id}
                className={`tl-bar tl-bar-ov tl-abs ${sel ? 'is-selected' : ''}`}
                style={{ top: yOv + (ovLanes.get(o.id) ?? 0) * (LANE_H + GAP), height: LANE_H, left: half + o.start * pps, width: Math.max(12, (o.end - o.start) * pps) }}
                {...barEvents('overlay', o.id)}
              >
                {s?.frames?.[0] ? <img className="tl-bar-thumb" src={s.frames[0]} alt="" draggable={false} /> : <Icon name="layers" size={13} />}
                <span>{o.key ? 'Хромакей · ' : ''}{s?.name ?? 'Наложение'}</span>
                {sel && handles('overlay', o.id)}
              </div>
            );
          })}

          {/* Текст и субтитры */}
          {timeline.texts.map((t) => {
            const sel = isSel('text', t.id);
            return (
              <div
                key={t.id}
                className={`tl-bar tl-bar-text tl-abs ${t.subtitle ? 'tl-bar-sub' : ''} ${sel ? 'is-selected' : ''}`}
                style={{ top: yText + (textLanes.get(t.id) ?? 0) * (LANE_H + GAP), height: LANE_H, left: half + t.start * pps, width: Math.max(12, (t.end - t.start) * pps) }}
                {...barEvents('text', t.id)}
              >
                <Icon name={t.subtitle ? 'captions' : 'text'} size={13} />
                <span>{t.text.split('\n')[0] || 'Текст'}</span>
                {sel && handles('text', t.id)}
              </div>
            );
          })}

          {/* Музыка и звуки */}
          {timeline.audios.map((a) => {
            const sel = isSel('audio', a.id);
            const s = sources[a.src];
            const len = audioLen(a);
            const w = Math.max(12, len * pps);
            return (
              <div
                key={a.id}
                className={`tl-bar tl-bar-music tl-abs ${sel ? 'is-selected' : ''}`}
                style={{ top: yAudio + (audioLanes.get(a.id) ?? 0) * (LANE_H + GAP), height: LANE_H, left: half + a.start * pps, width: w }}
                {...barEvents('audio', a.id)}
              >
                <Waveform srcId={a.src} read={props.readSource} from={a.in} to={a.out} width={w} height={LANE_H} />
                {a.fadeIn > 0 && <i className="tl-fade tl-fade-in" style={{ width: Math.min(w / 2, (a.fadeIn * pps) / 1) }} />}
                {a.fadeOut > 0 && <i className="tl-fade tl-fade-out" style={{ width: Math.min(w / 2, a.fadeOut * pps) }} />}
                <Icon name="music" size={13} />
                <span>
                  {s?.name ?? 'Звук'}
                  {audioSpeed(a) !== 1 ? ` · ${String(audioSpeed(a)).replace('.', ',')}×` : ''}
                  {a.pitch ? ` · ${a.pitch > 0 ? '+' : ''}${a.pitch} тон` : ''}
                </span>
                {sel && handles('audio', a.id)}
              </div>
            );
          })}
        </div>
      </div>

      {/* Кнопки «добавить» — от плейхеда, видны при любой прокрутке */}
      {!timeline.texts.length && timeline.clips.length > 0 && (
        <button className="tl-ghost" style={{ top: yText, height: LANE_H }} onClick={props.onAddText}>
          <Icon name="text" size={14} /> Текст отсюда
        </button>
      )}
      {!timeline.audios.length && timeline.clips.length > 0 && (
        <button className="tl-ghost" style={{ top: yAudio, height: LANE_H }} onClick={props.onAddMusic}>
          <Icon name="music" size={14} /> Добавить музыку
        </button>
      )}
      <div className="tl-playhead" aria-hidden="true" />

      {/* Перестановка: клипы — одинаковые плитки, палец тащит плитку, остальные расступаются */}
      {reorder && (
        <div className="tl-reorder" style={{ top: yClips - 6, height: CLIP_H + 12 }}>
          <div className="tl-reorder-hint">Перетащите клип на новое место</div>
          {timeline.clips.map((c, i) => {
            const s = sources[c.src];
            const thumb = s?.frames?.[Math.min((s.frames?.length ?? 1) - 1, Math.floor(((c.in + c.out) / 2 / Math.max(0.1, s.duration)) * (s.frames?.length ?? 1)))];
            let slot = i;
            if (i !== reorder.from) {
              if (reorder.from < i && i <= reorder.to) slot = i - 1;
              if (reorder.to <= i && i < reorder.from) slot = i + 1;
            }
            const dragging = i === reorder.from;
            const x = dragging ? reorder.x - TILE / 2 : reorder.offset + slot * (TILE + TILE_GAP);
            return (
              <div key={c.id} className={`tl-tile ${dragging ? 'is-dragging' : ''}`} style={{ transform: `translateX(${x}px)` }}>
                {thumb ? <img src={thumb} alt="" draggable={false} /> : <span className="frame-ph" />}
                <span className="tl-tile-n">{i + 1}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Правка полосы (текст, звук, наложение, ключ) при перетаскивании */
function barEdit(t: TL, d: Extract<Drag, { type: 'bar' }>, dt: number): TL {
  const total = totalDuration(t);
  const MIN = 0.2;
  if (d.kind === 'text') {
    const x0 = d.snap as TL['texts'][number];
    if (d.mode === 'move') {
      const len = x0.end - x0.start;
      const s = Math.min(Math.max(0, x0.start + dt), Math.max(0, total - len));
      return { ...t, texts: t.texts.map((x) => (x.id === d.id ? shiftText(x0, s) : x)) };
    }
    const s = d.mode === 'start' ? Math.min(Math.max(0, x0.start + dt), x0.end - MIN) : x0.start;
    const e = d.mode === 'end' ? Math.max(Math.min(total, x0.end + dt), x0.start + MIN) : x0.end;
    return { ...t, texts: t.texts.map((x) => (x.id === d.id ? retimeText(x0, s, e) : x)) };
  }
  if (d.kind === 'marker') {
    const m = d.snap as TL['markers'][number];
    if (d.mode === 'move') {
      const len = m.end - m.start;
      const s = Math.min(Math.max(0, m.start + dt), Math.max(0, total - len));
      return updateMarker(t, d.id, { start: s, end: s + len });
    }
    if (d.mode === 'start') return updateMarker(t, d.id, { start: Math.min(Math.max(0, m.start + dt), m.end - 0.05) });
    return updateMarker(t, d.id, { end: Math.max(Math.min(total, m.end + dt), m.start + 0.05) });
  }
  if (d.kind === 'overlay') {
    const o = d.snap as TL['overlays'][number];
    if (d.mode === 'move') {
      const len = o.end - o.start;
      const s = Math.min(Math.max(0, o.start + dt), Math.max(0, total - len));
      return updateOverlay(t, d.id, { start: s, end: s + len });
    }
    if (d.mode === 'start') {
      const s = Math.min(Math.max(0, o.start + dt, o.start - o.in), o.end - MIN);
      return updateOverlay(t, d.id, { start: s, in: Math.max(0, o.in + (s - o.start)) });
    }
    return updateOverlay(t, d.id, { end: Math.max(Math.min(total, o.end + dt, o.start + (d.limit - o.in)), o.start + MIN) });
  }
  const a = d.snap as TL['audios'][number];
  const sp = audioSpeed(a);
  if (d.mode === 'move') return updateAudio(t, d.id, { start: Math.max(0, a.start + dt) });
  if (d.mode === 'start') {
    // Левый край: начало звука обрезается, остальное остаётся на своём месте шкалы
    const ds = Math.min(Math.max(dt, -a.in / sp, -a.start), audioLen(a) - MIN);
    return updateAudio(t, d.id, { start: a.start + ds, in: a.in + ds * sp });
  }
  return updateAudio(t, d.id, { out: Math.max(a.in + MIN * sp, Math.min(d.limit, a.out + dt * sp)) });
}

export function clampPps(v: number): number {
  return Math.min(240, Math.max(4, v));
}

