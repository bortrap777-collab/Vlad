import { useRef, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useElementSize } from '../../lib/useElementSize';
import { boxInk } from './render';
import { dragCrop, FULL, type Handle } from './geometry';
import { TEXT_FONTS, temperatureLayer, toCssFilter, type CropRect, type PhotoEdits, type TextLayer } from './pipeline';

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
  /** Замена фона: object URL маски, картинки фона и размытого фона */
  layers?: BackgroundLayers;
}

export interface BackgroundLayers {
  mask: string | null;
  bgImage: string | null;
  blur: string | null;
}

/**
 * Предпросмотр фото. Геометрия считается так же, как в рендере (render.ts):
 * повёрнутое изображение → окно обрезки → вписывание в экран.
 */
export function PhotoView({ url, srcW, srcH, edits, loading, crop, selectedText, onTextMove, onTextTap, onMediaError, layers }: Props) {
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
  const imgW = (quarter ? rh : rw) * k;
  const imgH = (quarter ? rw : rh) * k;
  const rotStyle: CSSProperties = { width: imgW, height: imgH, transform: `translate(-50%, -50%) rotate(${edits.rotation}deg)` };

  // Замена фона: объект вырезается маской (та же маска, что и в рендере)
  const bg = edits.background && layers?.mask ? edits.background : null;
  const alpha = !!bg && (bg.mode === 'transparent' || (bg.mode === 'image' && !layers?.bgImage));
  const maskStyle: CSSProperties = bg
    ? {
        WebkitMaskImage: `url("${layers!.mask}")`,
        maskImage: `url("${layers!.mask}")`,
        WebkitMaskSize: '100% 100%',
        maskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
      }
    : {};

  return (
    <div className="photo-stage-inner" ref={stageRef}>
      {(loading || !k) && <div className="skeleton fill" />}
      {url && k > 0 && (
        <div className={`photo-canvas ${crop ? 'is-cropping' : ''}`} style={{ width: dw, height: dh }}>
          <div className="photo-box" style={boxStyle}>
            {alpha && <div className="checker" aria-hidden="true" />}
            {/* Цветокоррекция действует на всю композицию — как в рендере */}
            <div className="photo-composite" style={{ filter }}>
              {bg?.mode === 'color' && <div className="bg-fill" style={{ background: bg.color }} />}
              {bg?.mode === 'image' && layers?.bgImage && <div className="bg-fill" style={{ backgroundImage: `url("${layers.bgImage}")` }} />}
              {bg?.mode === 'blur' && layers?.blur && <img className="ph-layer" src={layers.blur} alt="" draggable={false} style={rotStyle} />}
              <img className="ph-layer" src={url} alt="" draggable={false} onError={onMediaError} style={{ ...rotStyle, ...maskStyle }} />
            </div>
            {temp && (
              <div
                className={`temp-layer ${alpha ? 'ph-layer' : ''}`}
                style={{ background: temp.color, opacity: temp.opacity, ...(alpha ? { ...rotStyle, ...maskStyle } : null) }}
              />
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
