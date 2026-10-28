import { useEffect, useMemo, useRef } from 'react';
import { toCssFilter } from '../photo/pipeline';
import { BlurHelper, drawClipFrame, drawTransition, type Drawable } from './compose';
import { clipStarts, hasLook, hasTransition, isDip, lookEdits, transitionAt, type Clip, type Timeline } from './model';
import type { LoadedSource } from './useVideoProject';

interface Props {
  timeline: Timeline;
  sources: Record<string, LoadedSource>;
  host: HTMLElement | null;
  width: number;
  height: number;
  subscribe: (f: (t: number) => void) => () => void;
  timeRef: { current: number };
}

const canFilter = (() => {
  try {
    return 'filter' in (document.createElement('canvas').getContext('2d') ?? {});
  } catch {
    return false;
  }
})();

function lookFilter(c: Clip): string {
  return hasLook(c) && canFilter ? toCssFilter(lookEdits(c.look)) : 'none';
}

/** Снимок кадра исходника в момент t — скрытым видеоэлементом */
function grab(url: string, t: number): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    const timer = setTimeout(() => reject(new Error('timeout')), 8000);
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(t, Math.max(0, (v.duration || t) - 0.05));
    };
    v.onseeked = () => {
      clearTimeout(timer);
      resolve(v);
    };
    v.onerror = () => {
      clearTimeout(timer);
      reject(new Error('video'));
    };
    v.src = url;
  });
}

/**
 * Предпросмотр переходов «картинка в картинку» (растворение, сдвиг, шторка, наезд, круг).
 * Холст поверх видео виден только в окне перехода; рисует то же, что экспорт:
 * живой кадр текущего клипа + неподвижный кадр соседнего.
 */
export function TransitionPreview({ timeline, sources, host, width, height, subscribe, timeRef }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tl = useRef(timeline);
  tl.current = timeline;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(2, Math.round(width * dpr));
  const H = Math.max(2, Math.round(height * dpr));
  const fill = (timeline.fit ?? 'fit') === 'fill';
  const blurBg = !fill && (timeline.background ?? 'blur') === 'blur';
  const snaps = useRef(new Map<string, HTMLCanvasElement>());
  const layer = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return { c, x: c.getContext('2d')!, blur: new BlurHelper(W, H) };
  }, [W, H]);

  // Какие неподвижные кадры нужны: ключ включает всё, от чего зависит картинка
  const needed = useMemo(() => {
    const list: { key: string; clip: Clip; t: number }[] = [];
    timeline.clips.forEach((c, i) => {
      if (i === 0 || !hasTransition(c) || isDip(c.transition)) return;
      const a = timeline.clips[i - 1];
      const base = `${fill}|${blurBg}|${W}x${H}`;
      list.push({ key: `${a.id}|last|${a.src}|${a.out}|${lookFilter(a)}|${base}`, clip: a, t: Math.max(a.in, a.out - 0.04) });
      list.push({ key: `${c.id}|first|${c.src}|${c.in}|${lookFilter(c)}|${base}`, clip: c, t: c.in });
    });
    return list;
  }, [timeline, fill, blurBg, W, H]);

  // Снимаем недостающие кадры по одному, в фоне
  useEffect(() => {
    let cancelled = false;
    const keys = new Set(needed.map((n) => n.key));
    for (const k of [...snaps.current.keys()]) if (!keys.has(k)) snaps.current.delete(k);
    (async () => {
      for (const n of needed) {
        if (cancelled) return;
        if (snaps.current.has(n.key)) continue;
        const src = sources[n.clip.src];
        if (!src) continue;
        try {
          const v = await grab(src.url, n.t);
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          const x = c.getContext('2d')!;
          x.filter = lookFilter(n.clip);
          drawClipFrame(x, v, W, H, { fill, blur: blurBg ? new BlurHelper(W, H) : null });
          snaps.current.set(n.key, c);
          v.removeAttribute('src');
          v.load();
        } catch {
          /* без снимка переход покажется обычной склейкой */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needed, sources, W, H, fill, blurBg]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    const draw = () => {
      const t = tl.current;
      const T = timeRef.current;
      const tr = transitionAt(t, T);
      const live = host?.querySelector<HTMLVideoElement>('video.is-active');
      if (!tr || !live || live.readyState < 2) {
        canvas.style.visibility = 'hidden';
        return false;
      }
      const starts = clipStarts(t);
      const incoming = T >= starts[tr.index];
      const liveClip = t.clips[incoming ? tr.index : tr.index - 1];
      const other = incoming ? t.clips[tr.index - 1] : t.clips[tr.index];
      const key = needed.find((n) => n.clip.id === other.id && n.key.includes(incoming ? '|last|' : '|first|'))?.key;
      const still = key ? snaps.current.get(key) : undefined;
      if (!still) {
        canvas.style.visibility = 'hidden';
        return true;
      }
      layer.x.filter = lookFilter(liveClip);
      drawClipFrame(layer.x, live as Drawable, W, H, { fill, blur: blurBg ? layer.blur : null });
      layer.x.filter = 'none';
      ctx.clearRect(0, 0, W, H);
      drawTransition(ctx, tr.type, tr.p, incoming ? still : layer.c, incoming ? layer.c : still, W, H);
      canvas.style.visibility = 'visible';
      // На паузе хватит одного кадра; при воспроизведении рисуем дальше
      return !live.paused;
    };
    // Внутри окна перехода рисуем на каждом кадре экрана, снаружи — только по событиям
    const loop = () => {
      if (draw()) raf = requestAnimationFrame(loop);
      else raf = 0;
    };
    const kick = () => {
      if (!raf) loop();
    };
    const unsub = subscribe(kick);
    // После перемотки кадр видео готов позже события времени — дорисовываем
    host?.addEventListener('seeked', kick, true);
    host?.addEventListener('play', kick, true);
    loop();
    return () => {
      unsub();
      host?.removeEventListener('seeked', kick, true);
      host?.removeEventListener('play', kick, true);
      cancelAnimationFrame(raf);
    };
  }, [subscribe, timeRef, host, layer, needed, W, H, fill, blurBg]);

  return <canvas ref={ref} className="trans-canvas" width={W} height={H} style={{ width, height, visibility: 'hidden' }} aria-hidden="true" />;
}
