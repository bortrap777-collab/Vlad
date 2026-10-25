import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '../../components/Icon';
import { useUi } from '../../components/ui';
import { loadImage } from '../../lib/media';
import { useElementSize } from '../../lib/useElementSize';
import { aiAssetsReady } from '../../ai/assets';
import { maskAlpha, releaseObjectModels, samDecode, samEncode, samWorkSize, type SamEmbedding, type SamMasks, type SamPoint } from '../../ai/providers/objects';

const UNDO = 15;
const TAP_SLOP = 10;

type Tool = 'tap' | 'exclude' | 'brush' | 'eraser';
/** auto — лучший по оценке модели; 1–3 — деталь, часть, целиком */
type Level = 'auto' | 1 | 2 | 3;
export type ObjectAction = 'remove' | 'layer' | 'move';

const LEVELS: { id: 1 | 2 | 3; label: string }[] = [
  { id: 1, label: 'Деталь' },
  { id: 2, label: 'Часть' },
  { id: 3, label: 'Целиком' },
];

type Step = { kind: 'points'; points: SamPoint[]; level: Level } | { kind: 'stroke'; add: ImageData; sub: ImageData };

interface Props {
  /** Изображение, с которым работаем (слой без маски или всё фото) */
  url: string;
  /** Ключ для кэша «изученного» фото */
  imageKey: string;
  /** Подпись: что именно меняем */
  targetLabel: string;
  /** В режиме объединённых слоёв «В слой» и «Перенести» недоступны */
  canLayer: boolean;
  onApply: (action: ObjectAction, selection: HTMLCanvasElement) => void;
}

/**
 * Инструмент «Объекты»: выделить касанием (модель понимает, где объект и его части),
 * уточнить кистью и ластиком, затем удалить с дорисовкой фона, вынести в слой или перенести.
 * Один палец — касание или рисование, два — приблизить и сдвинуть.
 */
export function ObjectTool({ url, imageKey, targetLabel, canLayer, onApply }: Props) {
  const ui = useUi();
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const viewRef = useRef<HTMLCanvasElement | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Рабочие холсты (длинная сторона 1024): маска модели, добавлено кистью, убрано ластиком, итог
  const ai = useRef<HTMLCanvasElement | null>(null);
  const add = useRef<HTMLCanvasElement | null>(null);
  const sub = useRef<HTMLCanvasElement | null>(null);
  const sel = useRef<HTMLCanvasElement | null>(null);
  const tint = useRef<HTMLCanvasElement | null>(null);

  const [tool, setTool] = useState<Tool>('tap');
  const [brush, setBrush] = useState(36);
  const [points, setPoints] = useState<SamPoint[]>([]);
  const [level, setLevel] = useState<Level>('auto');
  const [masks, setMasks] = useState<SamMasks | null>(null);
  const [emb, setEmb] = useState<SamEmbedding | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'ready' | 'error'>('idle');
  const [hasSel, setHasSel] = useState(false);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const history = useRef<Step[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const encoding = useRef<Promise<SamEmbedding | null> | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  /* ---------- Загрузка фото ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const im = await loadImage(url);
      if (cancelled) return;
      const ws = samWorkSize(im.naturalWidth, im.naturalHeight);
      const mk = () => {
        const c = document.createElement('canvas');
        c.width = ws.w;
        c.height = ws.h;
        return c;
      };
      img.current = im;
      ai.current = mk();
      add.current = mk();
      sub.current = mk();
      sel.current = mk();
      tint.current = mk();
      setSize(ws);
      // Модель уже скачана — «изучаем» фото сразу, чтобы первое касание сработало быстро
      if (await aiAssetsReady('select')) encode(false);
    })();
    return () => {
      cancelled = true;
      ctrl.current?.abort();
      releaseObjectModels();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  /** Изучить фото. modal — с окном прогресса (первое скачивание модели), иначе тихо в фоне */
  const encode = (modal: boolean): Promise<SamEmbedding | null> => {
    if (emb) return Promise.resolve(emb);
    if (encoding.current) return encoding.current;
    const im = img.current!;
    const c = new AbortController();
    ctrl.current = c;
    setStatus('busy');
    const show = modal ? (p: { value: number | null; label: string }) => ui.setProgress({ ...p, onCancel: () => c.abort() }) : () => undefined;
    encoding.current = samEncode(imageKey, im, im.naturalWidth, im.naturalHeight, show, c.signal)
      .then((e) => {
        setEmb(e);
        setStatus('ready');
        return e;
      })
      .catch((e) => {
        setStatus('error');
        if ((e as DOMException)?.name !== 'AbortError') ui.toast((e as Error).message || 'Модель выделения не запустилась', 'error');
        return null;
      })
      .finally(() => {
        encoding.current = null;
        if (modal) ui.setProgress(null);
      });
    return encoding.current;
  };

  /* ---------- Маска модели по точкам ---------- */
  const decodeSeq = useRef(0);
  useEffect(() => {
    if (!emb || !points.length) {
      setMasks(null);
      return;
    }
    const n = ++decodeSeq.current;
    samDecode(emb, points)
      .then((m) => n === decodeSeq.current && setMasks(m))
      .catch((e) => n === decodeSeq.current && ui.toast((e as Error).message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emb, points]);

  const autoLevel = (m: SamMasks): 0 | 1 | 2 | 3 => {
    if (points.length > 1) return 0;
    let best = 1;
    for (let i = 2; i <= 3; i++) if (m.iou[i] > m.iou[best]) best = i;
    return best as 1 | 2 | 3;
  };
  const shownLevel = masks ? (level === 'auto' ? autoLevel(masks) : level) : null;

  useEffect(() => {
    const c = ai.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (masks && shownLevel != null && points.length) {
      const a = maskAlpha(masks, shownLevel);
      const im = ctx.createImageData(masks.w, masks.h);
      for (let i = 0; i < a.length; i++) {
        im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255;
        im.data[i * 4 + 3] = a[i];
      }
      ctx.putImageData(im, 0, 0);
    }
    compose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masks, shownLevel]);

  /* ---------- Итоговое выделение и отрисовка ---------- */
  const compose = () => {
    const s = sel.current;
    if (!s) return;
    const ctx = s.getContext('2d', { willReadFrequently: true })!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, s.width, s.height);
    ctx.drawImage(ai.current!, 0, 0);
    ctx.drawImage(add.current!, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(sub.current!, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    // Есть ли что-то выделено — по уменьшенной копии
    const t = tint.current!.getContext('2d', { willReadFrequently: true })!;
    t.clearRect(0, 0, 64, 64);
    t.drawImage(s, 0, 0, 64, 64);
    const d = t.getImageData(0, 0, 64, 64).data;
    let any = false;
    for (let i = 3; i < d.length; i += 4)
      if (d[i] > 24) {
        any = true;
        break;
      }
    setHasSel(any);
    redraw();
  };

  const aspect = size ? size.w / size.h : 1;
  const pad = 12;
  const fitW = stage.width && size ? Math.min(stage.width - pad * 2, (stage.height - pad * 2) * aspect) : 0;
  const fitH = fitW / aspect;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const redraw = () => {
    const v = viewRef.current;
    const im = img.current;
    const s = sel.current;
    const t = tint.current;
    if (!v || !im || !s || !t || !fitW) return;
    const w = Math.round(fitW * dpr);
    const h = Math.round(fitH * dpr);
    if (v.width !== w || v.height !== h) {
      v.width = w;
      v.height = h;
    }
    const ctx = v.getContext('2d')!;
    ctx.globalAlpha = 1;
    ctx.drawImage(im, 0, 0, w, h);
    // Выделение — полупрозрачной заливкой цвета приложения
    const tc = t.getContext('2d')!;
    tc.globalCompositeOperation = 'source-over';
    tc.clearRect(0, 0, t.width, t.height);
    tc.drawImage(s, 0, 0);
    tc.globalCompositeOperation = 'source-in';
    tc.fillStyle = '#8366FF';
    tc.fillRect(0, 0, t.width, t.height);
    tc.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(t, 0, 0, w, h);
    ctx.globalAlpha = 1;
    // Точки касаний
    const k = w / s.width;
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x * k, p.y * k, 7 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = p.positive ? '#22C55E' : '#EF4444';
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  };

  useEffect(redraw);

  /* ---------- Отмена ---------- */
  const snapshot = (): Step => {
    const a = add.current!;
    const s = sub.current!;
    return { kind: 'stroke', add: a.getContext('2d')!.getImageData(0, 0, a.width, a.height), sub: s.getContext('2d')!.getImageData(0, 0, s.width, s.height) };
  };
  const push = (s: Step) => {
    history.current = [...history.current, s].slice(-UNDO);
    setCanUndo(true);
  };
  const undo = () => {
    const s = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (!s) return;
    if (s.kind === 'points') {
      setPoints(s.points);
      setLevel(s.level);
    } else {
      add.current!.getContext('2d')!.putImageData(s.add, 0, 0);
      sub.current!.getContext('2d')!.putImageData(s.sub, 0, 0);
      compose();
    }
  };
  const clear = () => {
    push({ kind: 'points', points, level });
    push(snapshot());
    setPoints([]);
    setLevel('auto');
    add.current!.getContext('2d')!.clearRect(0, 0, add.current!.width, add.current!.height);
    sub.current!.getContext('2d')!.clearRect(0, 0, sub.current!.width, sub.current!.height);
    compose();
  };

  /* ---------- Касания, кисть, жесты ---------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const strokeSnap = useRef<Step | null>(null);
  const pinch = useRef<{ d: number; mx: number; my: number; v: typeof view } | null>(null);

  const toWork = (cx: number, cy: number) => {
    const r = viewRef.current!.getBoundingClientRect();
    const s = sel.current!;
    return { x: ((cx - r.left) / r.width) * s.width, y: ((cy - r.top) / r.height) * s.height, k: s.width / r.width };
  };

  const paint = (from: { x: number; y: number }, to: { x: number; y: number }, k: number) => {
    const on = (tool === 'brush' ? add : sub).current!.getContext('2d')!;
    const off = (tool === 'brush' ? sub : add).current!.getContext('2d')!;
    const r = (brush / 2) * k;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.3)));
    on.globalCompositeOperation = 'source-over';
    off.globalCompositeOperation = 'destination-out';
    for (let i = 0; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      for (const ctx of [on, off]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    off.globalCompositeOperation = 'source-over';
    compose();
  };

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (!size) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      start.current = { x: e.clientX, y: e.clientY, moved: false };
      if (tool === 'brush' || tool === 'eraser') {
        strokeSnap.current = snapshot();
        const p = toWork(e.clientX, e.clientY);
        last.current = p;
        paint(p, p, p.k);
      }
    } else if (pointers.current.size === 2) {
      // Второй палец — это масштаб: начатый мазок отменяем
      if (strokeSnap.current && strokeSnap.current.kind === 'stroke') {
        add.current!.getContext('2d')!.putImageData(strokeSnap.current.add, 0, 0);
        sub.current!.getContext('2d')!.putImageData(strokeSnap.current.sub, 0, 0);
        compose();
      }
      strokeSnap.current = null;
      last.current = null;
      start.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, v: view };
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
      return;
    }
    if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > TAP_SLOP) start.current.moved = true;
    if (last.current) {
      const p = toWork(e.clientX, e.clientY);
      paint(last.current, p, p.k);
      last.current = p;
    }
  };

  const up = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size > 0) return;
    if (strokeSnap.current) push(strokeSnap.current);
    strokeSnap.current = null;
    last.current = null;
    const s = start.current;
    start.current = null;
    if (s && !s.moved && (tool === 'tap' || tool === 'exclude')) tap(e.clientX, e.clientY);
  };

  const tap = async (cx: number, cy: number) => {
    const p = toWork(cx, cy);
    const s = sel.current!;
    if (p.x < 0 || p.y < 0 || p.x > s.width || p.y > s.height) return;
    const e = emb ?? (await encode(true));
    if (!e) return;
    push({ kind: 'points', points, level });
    // «Исключить» без выделения не имеет смысла — тогда это обычное касание
    const positive = tool === 'tap' || !points.length;
    setPoints((ps) => [...ps, { x: p.x, y: p.y, positive }]);
  };

  const chooseLevel = (l: 1 | 2 | 3) => {
    push({ kind: 'points', points, level });
    setLevel(l);
  };

  const hint =
    tool === 'tap'
      ? status === 'busy'
        ? 'Изучаю фото… Через пару секунд касание выделит объект.'
        : 'Коснитесь объекта — он выделится. Ещё касание добавит соседний.'
      : tool === 'exclude'
        ? 'Коснитесь лишнего — оно уйдёт из выделения.'
        : tool === 'brush'
          ? 'Закрасьте, что удалить или вырезать. Двумя пальцами — приблизить.'
          : 'Сотрите лишнее из выделения.';

  return (
    <>
      <div className="photo-stage">
        <div className="photo-stage-inner brush-stage" ref={stageRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {!size && <div className="skeleton fill" />}
          {fitW > 0 && (
            <div className="brush-view" style={{ width: fitW, height: fitH, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
              <canvas ref={viewRef} style={{ width: '100%', height: '100%' }} />
            </div>
          )}
          {status === 'busy' && (
            <div className="obj-busy" aria-live="polite">
              <span className="spinner" aria-hidden="true" /> Изучаю фото…
            </div>
          )}
        </div>
      </div>
      <div className="photo-panel">
        <div className="chip-row chip-row-scroll" role="radiogroup" aria-label="Инструмент">
          {(
            [
              ['tap', 'target', 'Касание'],
              ['exclude', 'minus', 'Исключить'],
              ['brush', 'brush', 'Кисть'],
              ['eraser', 'eraser', 'Ластик'],
            ] as const
          ).map(([id, icon, label]) => (
            <button key={id} role="radio" aria-checked={tool === id} className={`pill ${tool === id ? 'is-active' : ''}`} onClick={() => setTool(id)}>
              <Icon name={icon} size={17} /> {label}
            </button>
          ))}
          <button className="icon-btn icon-btn-sm" onClick={undo} disabled={!canUndo} aria-label="Отменить шаг">
            <Icon name="undo" size={20} />
          </button>
        </div>

        {(tool === 'tap' || tool === 'exclude') && masks && shownLevel !== 0 ? (
          <div className="chip-row" role="radiogroup" aria-label="Что выделить">
            {LEVELS.map((l) => (
              <button key={l.id} role="radio" aria-checked={shownLevel === l.id} className={`pill pill-sm ${shownLevel === l.id ? 'is-active' : ''}`} onClick={() => chooseLevel(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        ) : tool === 'brush' || tool === 'eraser' ? (
          <div className="slider-row">
            <span className="muted small">Размер</span>
            <input className="slider" type="range" min={8} max={120} value={brush} onChange={(e) => setBrush(Number(e.target.value))} aria-label="Размер кисти" />
            <span className="brush-dot" style={{ width: Math.max(6, brush / 3), height: Math.max(6, brush / 3) }} aria-hidden="true" />
          </div>
        ) : null}

        <p className="muted small">
          {hint} <span className="obj-target">{targetLabel}</span>{' '}
          {(hasSel || points.length > 0) && (
            <button className="link-btn obj-reset" onClick={clear}>
              Сбросить выделение
            </button>
          )}
        </p>

        <div className="obj-actions">
          {canLayer && (
            <>
              <button className="btn btn-soft btn-sm" onClick={() => onApply('layer', sel.current!)} disabled={!hasSel}>
                В слой
              </button>
              <button className="btn btn-soft btn-sm" onClick={() => onApply('move', sel.current!)} disabled={!hasSel}>
                Перенести
              </button>
            </>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => onApply('remove', sel.current!)} disabled={!hasSel}>
            <Icon name="eraser" size={17} /> Удалить
          </button>
        </div>
      </div>
    </>
  );
}
