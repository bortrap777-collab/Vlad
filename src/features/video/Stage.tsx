import { useEffect, useRef } from 'react';
import { GLRenderer, type Rect } from './gl';
import { videoRect } from './FramePreview';
import { clipLanes, clipStarts, laneKey, rateAt, type Timeline } from './model';
import type { LoadedSource } from './useVideoProject';
import type { FrameState } from './usePlayer';
import { overlayKey } from './usePlayer';

interface Props {
  timeline: Timeline;
  sources: Record<string, LoadedSource>;
  width: number;
  height: number;
  elements: { current: Map<string, HTMLVideoElement> };
  frameState: { current: FrameState };
  playingRef: { current: boolean };
  subscribe: (f: (t: number) => void) => () => void;
  timeRef: { current: number };
  /** CSS-фильтр клипа под плейхедом (цвет) — на холст тоже */
  filter?: string;
}

type RVFC = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number; cancelVideoFrameCallback?: (h: number) => void };

const imageCache = new Map<string, HTMLImageElement>();
function imageFor(url: string): HTMLImageElement {
  let img = imageCache.get(url);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = url;
    imageCache.set(url, img);
  }
  return img;
}

/**
 * Холсты поверх видео в предпросмотре (WebGL):
 *  - основной — только во время перехода (оба клипа живые) и при плавном замедлении (смешивание кадров);
 *  - наложения — видео и картинки поверх, с хромакеем.
 * В остальное время виден сам <video> — это дешевле всего и не греет телефон.
 */
export function Stage({ timeline, sources, width, height, elements, frameState, playingRef, subscribe, timeRef, filter }: Props) {
  const mainRef = useRef<HTMLCanvasElement>(null);
  const kickRef = useRef<(() => void) | null>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const tl = useRef(timeline);
  tl.current = timeline;
  const src = useRef(sources);
  src.current = sources;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(2, Math.round(width * dpr));
  const H = Math.max(2, Math.round(height * dpr));

  useEffect(() => {
    const mc = mainRef.current;
    const oc = ovRef.current;
    if (!mc || !oc) return;
    const main = GLRenderer.create(mc);
    const ov = GLRenderer.create(oc);
    main?.resize(W, H);
    ov?.resize(W, H);

    // Плавное замедление: два последних кадра и время их появления
    const blend = { el: null as RVFC | null, handle: 0, prevAt: 0, curAt: 0, frames: 0 };
    const stopBlend = () => {
      if (blend.el && blend.handle) blend.el.cancelVideoFrameCallback?.(blend.handle);
      blend.el = null;
      blend.handle = 0;
      blend.frames = 0;
    };
    const onFrame = () => {
      const el = blend.el;
      if (!el || !main) return;
      main.swap(0, 1);
      main.upload(1, el);
      blend.prevAt = blend.curAt;
      blend.curAt = performance.now();
      blend.frames++;
      blend.handle = el.requestVideoFrameCallback!(onFrame);
    };

    const rectFor = (srcId: string, fill: boolean): Rect => {
      const s = src.current[srcId];
      const r = videoRect(width, height, s?.width ?? 0, s?.height ?? 0, fill);
      return [r.x / width, r.y / height, r.w / width, r.h / height];
    };

    let raf = 0;
    const draw = () => {
      raf = 0;
      const t = tl.current;
      const fs = frameState.current;
      const fill = (t.fit ?? 'fit') === 'fill';
      let mainOn = false;

      if (main && !main.lost && fs.primary) {
        const tr = fs.transition;
        if (tr && fs.secondary) {
          stopBlend();
          const lanes = clipLanes(t);
          const a = t.clips[tr.index - 1];
          const b = t.clips[tr.index];
          const ea = elements.current.get(laneKey(a.src, lanes[tr.index - 1]));
          const eb = elements.current.get(laneKey(b.src, lanes[tr.index]));
          if (ea && eb && ea.readyState >= 2 && eb.readyState >= 2) {
            main.upload(0, ea);
            main.upload(1, eb);
            main.clear();
            mainOn = main.drawTransition(tr.type, tr.p, rectFor(a.src, fill), rectFor(b.src, fill), tr.index * 3.7);
          }
        } else {
          // Плавное замедление при воспроизведении: показываем смесь двух последних кадров
          const c = t.clips[fs.primary.index];
          const tau = timeRef.current - clipStarts(t)[fs.primary.index];
          const el = elements.current.get(fs.primary.key) as RVFC | undefined;
          const slow = !!c?.smooth && rateAt(c, tau) < 0.97 && playingRef.current && !!el?.requestVideoFrameCallback;
          if (slow && el) {
            if (blend.el !== el) {
              stopBlend();
              blend.el = el;
              blend.handle = el.requestVideoFrameCallback!(onFrame);
            }
            if (blend.frames >= 2) {
              const gap = Math.max(1, blend.curAt - blend.prevAt);
              main.clear();
              main.drawBlend((performance.now() - blend.curAt) / gap, rectFor(c.src, fill));
              mainOn = true;
            }
          } else stopBlend();
        }
      }
      mc.style.visibility = mainOn ? 'visible' : 'hidden';

      // Наложения
      let ovOn = false;
      if (ov && !ov.lost) {
        const T = timeRef.current;
        const vis = t.overlays.filter((o) => T >= o.start && T < o.end);
        ov.clear();
        for (const o of vis) {
          const s = src.current[o.src];
          if (!s) continue;
          let img: TexImageSource | null = null;
          let iw = s.width ?? 0;
          let ih = s.height ?? 0;
          if (s.kind === 'image') {
            const im = imageFor(s.url);
            if (!im.complete || !im.naturalWidth) {
              im.onload = () => kick();
              continue;
            }
            img = im;
            iw = im.naturalWidth;
            ih = im.naturalHeight;
          } else {
            const el = elements.current.get(overlayKey(o.id));
            if (!el || el.readyState < 2) continue;
            img = el;
            iw = el.videoWidth;
            ih = el.videoHeight;
          }
          if (!img || !iw || !ih) continue;
          if (!ov.upload(2, img)) continue;
          const w = o.w * W;
          const h = (w * ih) / iw;
          ov.drawOverlay(o.x * W, o.y * H, w, h, o.rotation, o.opacity, o.key);
          ovOn = true;
        }
      }
      oc.style.visibility = ovOn ? 'visible' : 'hidden';

      // Пока играем или идёт переход/смешивание — рисуем на каждом кадре экрана
      if (playingRef.current || (mainOn && fs.transition)) raf = requestAnimationFrame(draw);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const unsub = subscribe(kick);
    kickRef.current = kick;
    kick();
    return () => {
      unsub();
      cancelAnimationFrame(raf);
      stopBlend();
    };
  }, [W, H, width, height, elements, frameState, playingRef, subscribe, timeRef]);

  // Монтаж изменился (переход, наложение) — перерисовать
  useEffect(() => kickRef.current?.(), [timeline, sources]);

  return (
    <>
      <canvas ref={mainRef} className="stage-canvas" width={W} height={H} style={{ width, height, visibility: 'hidden', filter }} aria-hidden="true" />
      <canvas ref={ovRef} className="stage-canvas stage-overlays" width={W} height={H} style={{ width, height, visibility: 'hidden' }} aria-hidden="true" />
    </>
  );
}
