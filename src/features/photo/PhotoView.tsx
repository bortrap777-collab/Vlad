import { useEffect, useRef, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useElementSize } from '../../lib/useElementSize';
import { inkFor, outlineColor } from '../video/textFx';
import { dragCrop, FULL, type Handle } from './geometry';
import { TEXT_FONTS, temperatureLayer, toCssFilter, type CropRect, type PhotoEdits, type TextLayer } from './pipeline';
import { layerBox, type PhotoLayer } from './layers';

export interface LayerEditing {
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Новое положение слоя во время жеста; end — жест закончен */
  onTransform: (id: string, p: Pick<PhotoLayer, 'x' | 'y' | 'scale' | 'rotation'>, end: boolean) => void;
}

interface Props {
  url: string | null;
  srcW: number;
  srcH: number;
  edits: PhotoEdits;
  loading?: boolean;
  /** Режим обрезки: показываем всё изображение и рамку */
  crop?: { rect: CropRect; rn: number | null; onChange: (c: CropRect) => void } | null;
  selectedText?: string | null;
  onTextChange?: (id: string, g: TextGeometry) => void;
  onTextEnd?: () => void;
  onTextTap?: (id: string) => void;
  onMediaError?: () => void;
  /** Файлы слоёв: id → object URL */
  files?: Record<string, string>;
  /** Размытое исходное фото (для слоя «размытие») */
  blurUrl?: string | null;
  /** Перемещение слоёв пальцами (вкладка «Слои») */
  layerEdit?: LayerEditing | null;
}

const maskCss = (url: string): CSSProperties => ({
  WebkitMaskImage: `url("${url}")`,
  maskImage: `url("${url}")`,
  WebkitMaskSize: '100% 100%',
  maskSize: '100% 100%',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
});

/**
 * Предпросмотр фото. Геометрия считается так же, как в рендере (render.ts):
 * документ (слои) → поворот → окно обрезки → вписывание в экран.
 */
export function PhotoView({ url, srcW, srcH, edits, loading, crop, selectedText, onTextChange, onTextEnd, onTextTap, onMediaError, files = {}, blurUrl, layerEdit }: Props) {
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const quarter = edits.rotation % 180 !== 0;
  const rw = quarter ? srcH : srcW;
  const rh = quarter ? srcW : srcH;
  const pad = crop ? 18 : 0;
  const c = crop ? FULL : edits.crop ?? FULL;
  const contentW = c.w * rw;
  const contentH = c.h * rh;
  const k = rw && rh && stage.width ? Math.min((stage.width - pad * 2) / contentW, (stage.height - pad * 2) / contentH) : 0;
  const dw = contentW * k;
  const dh = contentH * k;

  const filter = toCssFilter(edits);
  const temp = temperatureLayer(edits);

  const boxStyle: CSSProperties = {
    width: rw * k,
    height: rh * k,
    left: -c.x * rw * k,
    top: -c.y * rh * k,
  };
  // Документ (исходное фото без поворота) в пикселях экрана
  const docW = srcW * k;
  const docH = srcH * k;
  const rotStyle: CSSProperties = { width: docW, height: docH, transform: `translate(-50%, -50%) rotate(${edits.rotation}deg)` };

  const stack = edits.stack;
  const layers: PhotoLayer[] = stack && !stack.merged ? stack.layers : [];
  const mergedUrl = stack?.merged ? files[stack.merged.media] : null;

  /* ---------- Жесты слоя: один палец — перемещение, два — масштаб и поворот ---------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ id: string; l0: PhotoLayer; p0: Map<number, { x: number; y: number }> } | null>(null);
  // Последнее положение из жеста: события могут прийти раньше перерисовки, поэтому не берём его из props
  const live = useRef<Pick<PhotoLayer, 'x' | 'y' | 'scale' | 'rotation'> | null>(null);
  const transform = (id: string, p: Pick<PhotoLayer, 'x' | 'y' | 'scale' | 'rotation'>) => {
    live.current = p;
    layerEdit!.onTransform(id, p, false);
  };
  const editable = !!layerEdit && !crop && layers.length > 0;

  const toDoc = (dx: number, dy: number) => {
    // Экранный сдвиг → сдвиг в координатах документа (с учётом поворота фото)
    const a = (-edits.rotation * Math.PI) / 180;
    return { x: (dx * Math.cos(a) - dy * Math.sin(a)) / docW, y: (dx * Math.sin(a) + dy * Math.cos(a)) / docH };
  };

  const restart = () => {
    const sel = layers.find((l) => l.id === layerEdit?.selected);
    gesture.current = sel && sel.kind === 'photo' ? { id: sel.id, l0: sel, p0: new Map(pointers.current) } : null;
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!editable) return;
    const hit = (e.target as HTMLElement).closest('[data-layer]') as HTMLElement | null;
    if (pointers.current.size === 0 && hit && hit.dataset.layer !== layerEdit!.selected) layerEdit!.onSelect(hit.dataset.layer!);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Выбор применяется после перерисовки — жест начинаем с актуального слоя
    if (pointers.current.size === 1) live.current = null;
    const id = pointers.current.size === 1 && hit ? hit.dataset.layer! : gesture.current?.id ?? layerEdit!.selected;
    const sel = layers.find((l) => l.id === id);
    gesture.current = sel && sel.kind === 'photo' ? { id: sel.id, l0: { ...sel, ...live.current }, p0: new Map(pointers.current) } : null;
  };

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const ids = [...g.p0.keys()].filter((id) => pointers.current.has(id));
    if (ids.length === 1) {
      const a0 = g.p0.get(ids[0])!;
      const a1 = pointers.current.get(ids[0])!;
      const d = toDoc(a1.x - a0.x, a1.y - a0.y);
      transform(g.id, { x: g.l0.x + d.x, y: g.l0.y + d.y, scale: g.l0.scale, rotation: g.l0.rotation });
    } else if (ids.length >= 2) {
      const [a0, b0] = [g.p0.get(ids[0])!, g.p0.get(ids[1])!];
      const [a1, b1] = [pointers.current.get(ids[0])!, pointers.current.get(ids[1])!];
      const dist0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
      const dist1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
      const ang0 = Math.atan2(b0.y - a0.y, b0.x - a0.x);
      const ang1 = Math.atan2(b1.y - a1.y, b1.x - a1.x);
      const d = toDoc((a1.x + b1.x - a0.x - b0.x) / 2, (a1.y + b1.y - a0.y - b0.y) / 2);
      transform(g.id, {
        x: g.l0.x + d.x,
        y: g.l0.y + d.y,
        scale: Math.min(8, Math.max(0.03, g.l0.scale * (dist1 / dist0))),
        rotation: g.l0.rotation + ((ang1 - ang0) * 180) / Math.PI,
      });
    }
  };

  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g && pointers.current.size === 0) {
      if (live.current) layerEdit!.onTransform(g.id, live.current, true);
      gesture.current = null;
      live.current = null;
    } else if (g) {
      // Палец убрали, другой остался — продолжаем от текущего положения
      gesture.current = { id: g.id, l0: { ...g.l0, ...live.current }, p0: new Map(pointers.current) };
    } else restart();
  };

  const selected = layers.find((l) => l.id === layerEdit?.selected && l.visible);

  return (
    <div className="photo-stage-inner" ref={stageRef}>
      {(loading || !k) && <div className="skeleton fill" />}
      {url && k > 0 && (
        <div
          className={`photo-canvas ${crop ? 'is-cropping' : ''} ${editable ? 'is-layer-edit' : ''}`}
          style={{ width: dw, height: dh }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <div className="photo-box" style={boxStyle}>
            {stack && <div className="checker" aria-hidden="true" />}
            {/* Общая цветокоррекция действует на всю композицию — как в рендере */}
            <div className="photo-composite" style={{ filter }}>
              <div className="ph-layer ph-doc" style={rotStyle}>
                {!stack && <img className="ph-fill" src={url} alt="" draggable={false} onError={onMediaError} />}
                {mergedUrl && <img className="ph-fill" src={mergedUrl} alt="" draggable={false} />}
                {layers.map((l) => (
                  <LayerView key={l.id} l={l} url={l.media ? files[l.media] : url} mask={l.mask ? files[l.mask] : null} blurUrl={blurUrl ?? null} docW={docW} docH={docH} srcW={srcW} srcH={srcH} />
                ))}
              </div>
            </div>
            {temp && <div className="temp-layer" style={{ background: temp.color, opacity: temp.opacity }} />}
            {editable && selected && selected.kind === 'photo' && (
              <div className="ph-layer ph-doc ph-guides" style={rotStyle}>
                <SelectionFrame l={selected} docW={docW} docH={docH} srcW={srcW} srcH={srcH} />
              </div>
            )}
          </div>

          {!crop &&
            edits.texts.map((t) => (
              <TextItem key={t.id} t={t} dw={dw} dh={dh} selected={selectedText === t.id} onChange={onTextChange} onEnd={onTextEnd} onTap={onTextTap} />
            ))}

          {crop && <CropFrame rect={crop.rect} rn={crop.rn} dw={dw} dh={dh} onChange={crop.onChange} />}
        </div>
      )}
    </div>
  );
}

function layerRect(l: PhotoLayer, docW: number, docH: number, srcW: number, srcH: number): CSSProperties {
  const b = layerBox(l, srcW, srcH);
  return {
    left: l.x * docW,
    top: l.y * docH,
    width: b.w * docW,
    height: b.h * docH,
    transform: `translate(-50%, -50%) rotate(${l.rotation}deg)${l.flip ? ' scaleX(-1)' : ''}`,
  };
}

/** Один слой: изображение с маской, своей цветокоррекцией и прозрачностью */
function LayerView({ l, url, mask, blurUrl, docW, docH, srcW, srcH }: { l: PhotoLayer; url: string | null; mask: string | null; blurUrl: string | null; docW: number; docH: number; srcW: number; srcH: number }) {
  if (!l.visible) return null;
  const f = toCssFilter(l.adjust);
  const t = temperatureLayer(l.adjust);
  const tempEl = t && <div className="temp-layer" style={{ background: t.color, opacity: t.opacity }} />;
  if (l.kind === 'color')
    return (
      <div className="ph-fill ph-iso" style={{ opacity: l.opacity }}>
        <div className="ph-fill" style={{ background: l.color, filter: f }} />
        {tempEl}
      </div>
    );
  if (l.kind === 'blur')
    return (
      <div className="ph-fill ph-iso" style={{ opacity: l.opacity }}>
        {blurUrl && <img className="ph-fill" src={blurUrl} alt="" draggable={false} style={{ filter: f }} />}
        {tempEl}
      </div>
    );
  if (!url) return null;
  return (
    <div data-layer={l.id} className="ph-item ph-iso" style={{ ...layerRect(l, docW, docH, srcW, srcH), opacity: l.opacity, ...(mask ? maskCss(mask) : null) }}>
      <img className="ph-fill" src={url} alt="" draggable={false} style={{ filter: f }} />
      {tempEl}
    </div>
  );
}

function SelectionFrame({ l, docW, docH, srcW, srcH }: { l: PhotoLayer; docW: number; docH: number; srcW: number; srcH: number }) {
  return <div className="ph-item ph-select" style={layerRect(l, docW, docH, srcW, srcH)} aria-hidden="true" />;
}

export function textStyle(t: TextLayer, frameW: number): CSSProperties {
  const def = TEXT_FONTS[t.font];
  const s: CSSProperties = {
    fontFamily: def.family,
    fontWeight: def.weight,
    fontSize: t.size * frameW,
    color: inkFor(t),
    opacity: t.opacity ?? 1,
  };
  if (t.style === 'shadow') s.textShadow = '0 0.05em 0.25em rgba(0,0,0,0.55)';
  if (t.style === 'outline') {
    const o = outlineColor(t.color);
    const d = '0.07em';
    s.textShadow = [`${d} 0`, `-${d} 0`, `0 ${d}`, `0 -${d}`, `${d} ${d}`, `-${d} ${d}`, `${d} -${d}`, `-${d} -${d}`].map((v) => `${v} 0 ${o}`).join(', ');
  }
  if (t.style === 'neon') s.textShadow = `0 0 0.12em ${t.color}, 0 0 0.35em ${t.color}, 0 0 0.7em ${t.color}`;
  if (t.style === 'box') {
    s.background = t.color;
    s.padding = '0.25em 0.5em';
    s.borderRadius = '0.3em';
  }
  return s;
}

export type TextGeometry = Pick<TextLayer, 'x' | 'y' | 'size'> & { rotation: number };

const TEXT_MIN = 0.02;
const TEXT_MAX = 0.6;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Притягиваем к 0°, 90°, 180°, 270° — ровный текст легко поставить пальцами */
function snapAngle(deg: number): number {
  const n = Math.round(deg / 90) * 90;
  return Math.abs(deg - n) < 4 ? n : deg;
}

/**
 * Надпись на кадре. Один палец — двигать; два пальца (второй можно поставить где угодно) —
 * размер и поворот; ручка в углу выбранной надписи — размер и поворот одним пальцем.
 */
export function TextItem({
  t,
  dw,
  dh,
  selected,
  onChange,
  onTap,
  onEnd,
  inner,
}: {
  t: TextLayer;
  dw: number;
  dh: number;
  selected: boolean;
  onChange?: (id: string, g: TextGeometry) => void;
  onTap?: (id: string) => void;
  onEnd?: () => void;
  /** Своё содержимое вместо обычного текста (анимация, слова субтитров) */
  inner?: ReactNode;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<{ mode: 'drag' | 'handle'; t0: TextGeometry; p0: Map<number, { x: number; y: number }>; c: { x: number; y: number }; moved: boolean } | null>(null);
  // Последнее значение жеста: события приходят быстрее перерисовки
  const live = useRef<TextGeometry | null>(null);
  const cur = (): TextGeometry => live.current ?? { x: t.x, y: t.y, size: t.size, rotation: t.rotation ?? 0 };
  const center = () => {
    const r = el.current!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const rebase = () => {
    if (g.current) g.current = { ...g.current, t0: cur(), p0: new Map(pts.current), c: center() };
  };
  const emit = (v: TextGeometry) => {
    live.current = v;
    onChange?.(t.id, v);
  };

  const onMove = (e: PointerEvent) => {
    const s = g.current;
    if (!s || !pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ids = [...s.p0.keys()].filter((id) => pts.current.has(id));
    if (ids.length >= 2) {
      const [a0, b0] = [s.p0.get(ids[0])!, s.p0.get(ids[1])!];
      const [a1, b1] = [pts.current.get(ids[0])!, pts.current.get(ids[1])!];
      const k = Math.hypot(b1.x - a1.x, b1.y - a1.y) / (Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1);
      const turn = ((Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x)) * 180) / Math.PI;
      s.moved = true;
      emit({
        x: clamp01(s.t0.x + (a1.x + b1.x - a0.x - b0.x) / 2 / dw),
        y: clamp01(s.t0.y + (a1.y + b1.y - a0.y - b0.y) / 2 / dh),
        size: Math.min(TEXT_MAX, Math.max(TEXT_MIN, s.t0.size * k)),
        rotation: snapAngle(s.t0.rotation + turn),
      });
    } else if (ids.length === 1) {
      const p0 = s.p0.get(ids[0])!;
      const p1 = pts.current.get(ids[0])!;
      if (!s.moved && Math.hypot(p1.x - p0.x, p1.y - p0.y) < 5) return;
      s.moved = true;
      if (s.mode === 'handle') {
        // Ручка: расстояние до центра — размер, угол вокруг центра — поворот
        const v0 = { x: p0.x - s.c.x, y: p0.y - s.c.y };
        const v1 = { x: p1.x - s.c.x, y: p1.y - s.c.y };
        const k = Math.hypot(v1.x, v1.y) / (Math.hypot(v0.x, v0.y) || 1);
        const turn = ((Math.atan2(v1.y, v1.x) - Math.atan2(v0.y, v0.x)) * 180) / Math.PI;
        emit({ ...s.t0, size: Math.min(TEXT_MAX, Math.max(TEXT_MIN, s.t0.size * k)), rotation: snapAngle(s.t0.rotation + turn) });
      } else {
        emit({ ...s.t0, x: clamp01(s.t0.x + (p1.x - p0.x) / dw), y: clamp01(s.t0.y + (p1.y - p0.y) / dh) });
      }
    }
  };

  // Второй палец может лечь мимо надписи — ловим его на всём окне, пока первый держит надпись
  const onWindowDown = (e: PointerEvent) => {
    if (!g.current || pts.current.has(e.pointerId) || pts.current.size >= 2) return;
    e.stopPropagation();
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rebase();
  };
  const onUp = (e: PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return;
    const s = g.current;
    if (pts.current.size > 0) {
      rebase();
      return;
    }
    detach();
    g.current = null;
    live.current = null;
    if (s && !s.moved && s.mode === 'drag') onTap?.(t.id);
    else if (s?.moved) onEnd?.();
  };
  const listeners = useRef({ onMove, onWindowDown, onUp });
  listeners.current = { onMove, onWindowDown, onUp };
  const h = useRef({
    move: (e: PointerEvent) => listeners.current.onMove(e),
    down: (e: PointerEvent) => listeners.current.onWindowDown(e),
    up: (e: PointerEvent) => listeners.current.onUp(e),
  }).current;
  const attach = () => {
    window.addEventListener('pointerdown', h.down, true);
    window.addEventListener('pointermove', h.move, true);
    window.addEventListener('pointerup', h.up, true);
    window.addEventListener('pointercancel', h.up, true);
  };
  const detach = () => {
    window.removeEventListener('pointerdown', h.down, true);
    window.removeEventListener('pointermove', h.move, true);
    window.removeEventListener('pointerup', h.up, true);
    window.removeEventListener('pointercancel', h.up, true);
  };

  const begin = (mode: 'drag' | 'handle') => (e: RPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (g.current) return;
    pts.current.clear();
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    live.current = null;
    g.current = { mode, t0: cur(), p0: new Map(pts.current), c: center(), moved: false };
    attach();
  };

  // Ушли с экрана посреди жеста — снимаем слушатели окна
  useEffect(() => detach, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={el}
      className={`text-layer ${selected ? 'is-selected' : ''}`}
      style={{ left: t.x * dw, top: t.y * dh, transform: `translate(-50%, -50%) rotate(${t.rotation ?? 0}deg)` }}
      onPointerDown={begin('drag')}
      onClick={(e) => e.stopPropagation()}
      role="button"
      aria-label={`Текст: ${t.text}`}
    >
      {inner ?? <span style={textStyle(t, dw)}>{t.text || ' '}</span>}
      {selected && onChange && (
        <span className="text-handle" onPointerDown={begin('handle')} aria-label="Размер и поворот" role="button">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </div>
  );
}

const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'ne', 'sw', 'se'];

function CropFrame({ rect, rn, dw, dh, onChange }: { rect: CropRect; rn: number | null; dw: number; dh: number; onChange: (c: CropRect) => void }) {
  const drag = useRef<{ handle: Handle; px: number; py: number; c0: CropRect } | null>(null);
  const begin = (handle: Handle) => (e: RPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, px: e.clientX, py: e.clientY, c0: rect };
  };
  const move = (e: RPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    onChange(dragCrop(d.c0, d.handle, (e.clientX - d.px) / dw, (e.clientY - d.py) / dh, rn));
  };
  const end = () => (drag.current = null);

  return (
    <div
      className="crop-frame"
      style={{ left: rect.x * dw, top: rect.y * dh, width: rect.w * dw, height: rect.h * dh }}
      onPointerDown={begin('move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span className="crop-grid" aria-hidden="true" />
      {HANDLES.map((h) => (
        <span
          key={h}
          className={`crop-handle crop-${h}`}
          onPointerDown={begin(h)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
