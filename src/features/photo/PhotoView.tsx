import { useRef, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useElementSize } from '../../lib/useElementSize';
import { boxInk } from './render';
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
  onTextMove?: (id: string, x: number, y: number) => void;
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
export function PhotoView({ url, srcW, srcH, edits, loading, crop, selectedText, onTextMove, onTextTap, onMediaError, files = {}, blurUrl, layerEdit }: Props) {
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
              <TextItem key={t.id} t={t} dw={dw} dh={dh} selected={selectedText === t.id} onMove={onTextMove} onTap={onTextTap} />
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
    color: t.style === 'box' ? boxInk(t.color) : t.color,
  };
  if (t.style === 'shadow') s.textShadow = '0 0.05em 0.25em rgba(0,0,0,0.55)';
  if (t.style === 'box') {
    s.background = t.color;
    s.padding = '0.25em 0.5em';
    s.borderRadius = '0.3em';
  }
  return s;
}

export function TextItem({
  t,
  dw,
  dh,
  selected,
  onMove,
  onTap,
  onEnd,
}: {
  t: TextLayer;
  dw: number;
  dh: number;
  selected: boolean;
  onMove?: (id: string, x: number, y: number) => void;
  onTap?: (id: string) => void;
  onEnd?: () => void;
}) {
  const start = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, x: t.x, y: t.y, moved: false };
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.px;
    const dy = e.clientY - s.py;
    if (!s.moved && Math.hypot(dx, dy) < 5) return;
    s.moved = true;
    onMove?.(t.id, Math.min(1, Math.max(0, s.x + dx / dw)), Math.min(1, Math.max(0, s.y + dy / dh)));
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (s && !s.moved) onTap?.(t.id);
    else if (s?.moved) onEnd?.();
  };
  return (
    <div
      className={`text-layer ${selected ? 'is-selected' : ''}`}
      style={{ left: t.x * dw, top: t.y * dh }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => (start.current = null)}
      onClick={(e) => e.stopPropagation()}
      role="button"
      aria-label={`Текст: ${t.text}`}
    >
      <span style={textStyle(t, dw)}>{t.text || ' '}</span>
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
