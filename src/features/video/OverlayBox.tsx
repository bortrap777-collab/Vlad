import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';

export interface BoxGeometry {
  x: number;
  y: number;
  w: number;
  rotation: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
function snapAngle(deg: number): number {
  const n = Math.round(deg / 90) * 90;
  return Math.abs(deg - n) < 4 ? n : deg;
}

/**
 * Рамка наложения: один палец — двигать, два пальца — размер и поворот,
 * ручка в углу — размер и поворот одним пальцем. Картинку рисует холст под рамкой.
 */
export function OverlayBox({
  g,
  aspect,
  dw,
  dh,
  selected,
  onChange,
  onEnd,
  onTap,
}: {
  g: BoxGeometry;
  /** Высота / ширина картинки */
  aspect: number;
  dw: number;
  dh: number;
  selected: boolean;
  onChange: (g: BoxGeometry) => void;
  onEnd: () => void;
  onTap: () => void;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const s = useRef<{ mode: 'drag' | 'handle'; g0: BoxGeometry; p0: Map<number, { x: number; y: number }>; c: { x: number; y: number }; moved: boolean } | null>(null);
  const cur = useRef(g);
  cur.current = g;

  const center = () => {
    const r = el.current!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const rebase = () => {
    if (s.current) s.current = { ...s.current, g0: cur.current, p0: new Map(pts.current), c: center() };
  };

  const onMove = (e: PointerEvent) => {
    const st = s.current;
    if (!st || !pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ids = [...st.p0.keys()].filter((id) => pts.current.has(id));
    if (ids.length >= 2) {
      const [a0, b0] = [st.p0.get(ids[0])!, st.p0.get(ids[1])!];
      const [a1, b1] = [pts.current.get(ids[0])!, pts.current.get(ids[1])!];
      const k = Math.hypot(b1.x - a1.x, b1.y - a1.y) / (Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1);
      const turn = ((Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x)) * 180) / Math.PI;
      st.moved = true;
      onChange({
        x: clamp(st.g0.x + (a1.x + b1.x - a0.x - b0.x) / 2 / dw, -0.2, 1.2),
        y: clamp(st.g0.y + (a1.y + b1.y - a0.y - b0.y) / 2 / dh, -0.2, 1.2),
        w: clamp(st.g0.w * k, 0.05, 3),
        rotation: snapAngle(st.g0.rotation + turn),
      });
    } else if (ids.length === 1) {
      const p0 = st.p0.get(ids[0])!;
      const p1 = pts.current.get(ids[0])!;
      if (!st.moved && Math.hypot(p1.x - p0.x, p1.y - p0.y) < 5) return;
      st.moved = true;
      if (st.mode === 'handle') {
        const v0 = { x: p0.x - st.c.x, y: p0.y - st.c.y };
        const v1 = { x: p1.x - st.c.x, y: p1.y - st.c.y };
        const k = Math.hypot(v1.x, v1.y) / (Math.hypot(v0.x, v0.y) || 1);
        const turn = ((Math.atan2(v1.y, v1.x) - Math.atan2(v0.y, v0.x)) * 180) / Math.PI;
        onChange({ ...st.g0, w: clamp(st.g0.w * k, 0.05, 3), rotation: snapAngle(st.g0.rotation + turn) });
      } else {
        onChange({ ...st.g0, x: clamp(st.g0.x + (p1.x - p0.x) / dw, -0.2, 1.2), y: clamp(st.g0.y + (p1.y - p0.y) / dh, -0.2, 1.2) });
      }
    }
  };
  const onWindowDown = (e: PointerEvent) => {
    if (!s.current || pts.current.has(e.pointerId) || pts.current.size >= 2) return;
    e.stopPropagation();
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rebase();
  };
  const onUp = (e: PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return;
    const st = s.current;
    if (pts.current.size > 0) {
      rebase();
      return;
    }
    detach();
    s.current = null;
    if (st && !st.moved && st.mode === 'drag') onTap();
    else if (st?.moved) onEnd();
  };
  const L = useRef({ onMove, onWindowDown, onUp });
  L.current = { onMove, onWindowDown, onUp };
  const h = useRef({
    move: (e: PointerEvent) => L.current.onMove(e),
    down: (e: PointerEvent) => L.current.onWindowDown(e),
    up: (e: PointerEvent) => L.current.onUp(e),
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
  useEffect(() => detach, []); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = (mode: 'drag' | 'handle') => (e: RPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (s.current) return;
    pts.current.clear();
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    s.current = { mode, g0: cur.current, p0: new Map(pts.current), c: center(), moved: false };
    attach();
  };

  const w = g.w * dw;
  const hgt = w * aspect;
  return (
    <div
      ref={el}
      className={`ov-box ${selected ? 'is-selected' : ''}`}
      style={{ left: g.x * dw, top: g.y * dh, width: w, height: hgt, transform: `translate(-50%, -50%) rotate(${g.rotation}deg)` }}
      onPointerDown={begin('drag')}
      onClick={(e) => e.stopPropagation()}
      role="button"
      aria-label="Наложение"
    >
      {selected && (
        <span className="text-handle" onPointerDown={begin('handle')} aria-label="Размер и поворот" role="button">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </div>
  );
}
