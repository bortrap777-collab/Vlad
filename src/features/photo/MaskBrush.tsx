import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '../../components/Icon';
import { loadImage } from '../../lib/media';
import { useElementSize } from '../../lib/useElementSize';
import type { PhotoLayer } from './layers';

const MAX_SIDE = 2048;
const UNDO = 20;

interface Props {
  layer: PhotoLayer;
  srcUrl: string;
  files: Record<string, string>;
  blobs: Map<string, Blob>;
  docW: number;
  docH: number;
  /** Новая маска (PNG) или null — отмена */
  onDone: (mask: Blob | null) => void;
}

type Tool = 'erase' | 'restore';

/**
 * Кисть и ластик для маски слоя. Один палец рисует, два — двигают и увеличивают картинку.
 * Ластик убирает часть слоя, кисть возвращает её из исходного изображения.
 */
export function MaskBrush({ layer, srcUrl, files, docW, docH, onDone }: Props) {
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const viewRef = useRef<HTMLCanvasElement | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const mask = useRef<HTMLCanvasElement | null>(null);
  const history = useRef<ImageData[]>([]);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>('erase');
  const [size, setSize] = useState(40);
  const [canUndo, setCanUndo] = useState(false);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [changed, setChanged] = useState(false);

  const url = layer.media ? files[layer.media] : srcUrl;
  const maskUrl = layer.mask ? files[layer.mask] : null;
  // Пропорции слоя: исходное фото — пропорции документа
  const aspect = layer.media ? layer.w / layer.h : docW / docH;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const im = await loadImage(url);
      const k = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
      const mw = Math.max(1, Math.round(im.naturalWidth * k));
      const mh = Math.max(1, Math.round(im.naturalHeight * k));
      const c = document.createElement('canvas');
      c.width = mw;
      c.height = mh;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      if (maskUrl) ctx.drawImage(await loadImage(maskUrl), 0, 0, mw, mh);
      else {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, mw, mh);
      }
      if (cancelled) return;
      img.current = im;
      mask.current = c;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [url, maskUrl]);

  // Размер картинки на экране (вписана в область)
  const pad = 12;
  const fitW = stage.width ? Math.min(stage.width - pad * 2, (stage.height - pad * 2) * aspect) : 0;
  const fitH = fitW / aspect;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const redraw = () => {
    const v = viewRef.current;
    const m = mask.current;
    const im = img.current;
    if (!v || !m || !im || !fitW) return;
    const w = Math.round(fitW * dpr);
    const h = Math.round(fitH * dpr);
    if (v.width !== w || v.height !== h) {
      v.width = w;
      v.height = h;
    }
    const ctx = v.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(im, 0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(m, 0, 0, w, h);
    // Убранная часть видна полупрозрачно — чтобы было понятно, что можно вернуть
    ctx.globalCompositeOperation = 'destination-over';
    ctx.globalAlpha = 0.28;
    ctx.drawImage(im, 0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  useEffect(redraw);

  /* ---------- Рисование и жесты ---------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number } | null>(null);
  const pinch = useRef<{ d: number; mx: number; my: number; v: typeof view } | null>(null);

  const toMask = (cx: number, cy: number) => {
    const r = viewRef.current!.getBoundingClientRect();
    const m = mask.current!;
    return { x: ((cx - r.left) / r.width) * m.width, y: ((cy - r.top) / r.height) * m.height, k: m.width / r.width };
  };

  const dab = (from: { x: number; y: number }, to: { x: number; y: number }, k: number) => {
    const ctx = mask.current!.getContext('2d')!;
    const r = (size / 2) * k;
    ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.25)));
    for (let i = 0; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      // Мягкий край, чтобы не было резкой границы
      const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (!ready) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      const m = mask.current!;
      history.current = [...history.current, m.getContext('2d')!.getImageData(0, 0, m.width, m.height)].slice(-UNDO);
      setCanUndo(true);
      const p = toMask(e.clientX, e.clientY);
      last.current = p;
      dab(p, p, p.k);
      setChanged(true);
      redraw();
    } else if (pointers.current.size === 2) {
      // Второй палец: это не рисование, а масштаб — убираем начатый мазок
      const prev = history.current.pop();
      if (prev) mask.current!.getContext('2d')!.putImageData(prev, 0, 0);
      setCanUndo(history.current.length > 0);
      last.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, v: view };
      redraw();
    }
  };

  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const p = pinch.current;
      const zoom = Math.min(8, Math.max(1, p.v.zoom * (Math.hypot(b.x - a.x, b.y - a.y) / p.d)));
      setView({ zoom, x: p.v.x + (a.x + b.x) / 2 - p.mx, y: p.v.y + (a.y + b.y) / 2 - p.my });
    } else if (last.current) {
      const p = toMask(e.clientX, e.clientY);
      dab(last.current, p, p.k);
      last.current = p;
      redraw();
    }
  };

  const up = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) last.current = null;
  };

  const undo = () => {
    const prev = history.current.pop();
    if (prev) mask.current!.getContext('2d')!.putImageData(prev, 0, 0);
    setCanUndo(history.current.length > 0);
    redraw();
  };

  const done = async () => {
    if (!changed || !mask.current) return onDone(null);
    const b = await new Promise<Blob | null>((r) => mask.current!.toBlob(r, 'image/png'));
    onDone(b);
  };

  return (
    <>
      <div className="photo-stage">
        <div className="photo-stage-inner brush-stage" ref={stageRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {!ready && <div className="skeleton fill" />}
          {fitW > 0 && (
            <div className="brush-view checker-bg" style={{ width: fitW, height: fitH, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
              <canvas ref={viewRef} style={{ width: '100%', height: '100%' }} />
            </div>
          )}
        </div>
      </div>
      <div className="photo-panel">
        <div className="chip-row" role="radiogroup" aria-label="Инструмент">
          <button role="radio" aria-checked={tool === 'erase'} className={`pill ${tool === 'erase' ? 'is-active' : ''}`} onClick={() => setTool('erase')}>
            <Icon name="eraser" size={18} /> Ластик
          </button>
          <button role="radio" aria-checked={tool === 'restore'} className={`pill ${tool === 'restore' ? 'is-active' : ''}`} onClick={() => setTool('restore')}>
            <Icon name="brush" size={18} /> Кисть
          </button>
          <button className="icon-btn icon-btn-sm" onClick={undo} disabled={!canUndo} aria-label="Отменить мазок">
            <Icon name="undo" size={20} />
          </button>
        </div>
        <div className="slider-row">
          <span className="muted small">Размер</span>
          <input className="slider" type="range" min={6} max={140} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Размер кисти" />
          <span className="brush-dot" style={{ width: Math.max(6, size / 3), height: Math.max(6, size / 3) }} aria-hidden="true" />
        </div>
        <p className="muted small">Ластик убирает, кисть возвращает. Двумя пальцами — приблизить.</p>
        <div className="panel-foot">
          <button className="btn btn-soft btn-sm" onClick={() => onDone(null)}>
            Отмена
          </button>
          <button className="btn btn-primary btn-sm" onClick={done} disabled={!ready}>
            Готово
          </button>
        </div>
      </div>
    </>
  );
}
