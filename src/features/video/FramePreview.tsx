import { useEffect, useRef } from 'react';

/**
 * Размытый фон по краям кадра: активное видео рисуется в крошечный canvas,
 * который растягивается и размывается. Дёшево даже на старых телефонах.
 */
export function BlurBackdrop({ host }: { host: HTMLElement | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !host) return;
    let raf = 0;
    let n = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (n++ % 3) return;
      const v = host.querySelector<HTMLVideoElement>('video.is-active');
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      const w = 32;
      const h = Math.max(1, Math.round((w * c.clientHeight) / Math.max(1, c.clientWidth)));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      // «Заполнить»: видео покрывает маленький холст целиком
      const s = Math.max(w / v.videoWidth, h / v.videoHeight);
      const dw = v.videoWidth * s;
      const dh = v.videoHeight * s;
      try {
        ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
      } catch {
        /* кадр ещё не готов */
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [host]);
  return <canvas ref={ref} className="blur-backdrop" aria-hidden="true" />;
}

/** Прямоугольник, который займёт видео внутри кадра */
export function videoRect(frameW: number, frameH: number, vw: number, vh: number, fill: boolean) {
  if (!vw || !vh) return { x: 0, y: 0, w: frameW, h: frameH };
  const s = fill ? Math.max(frameW / vw, frameH / vh) : Math.min(frameW / vw, frameH / vh);
  const w = vw * s;
  const h = vh * s;
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h };
}
