import { useEffect, useRef, useState } from 'react';
import { decodeSource } from './audio/process';

/** Пики громкости файла (кэш): 200 точек на секунду звука */
const peaksCache = new Map<string, Promise<{ peaks: Float32Array; perSec: number }>>();
const PER_SEC = 50;

function peaksFor(id: string, read: () => Promise<Blob>) {
  let p = peaksCache.get(id);
  if (!p) {
    p = decodeSource(id, read, 22050).then((buf) => {
      const n = Math.max(1, Math.ceil(buf.duration * PER_SEC));
      const peaks = new Float32Array(n);
      const step = buf.sampleRate / PER_SEC;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < n; i++) {
          let m = 0;
          const a = Math.floor(i * step);
          const b = Math.min(d.length, Math.floor((i + 1) * step));
          for (let j = a; j < b; j += 4) {
            const v = Math.abs(d[j]);
            if (v > m) m = v;
          }
          if (m > peaks[i]) peaks[i] = m;
        }
      }
      return { peaks, perSec: PER_SEC };
    });
    p.catch(() => peaksCache.delete(id));
    peaksCache.set(id, p);
  }
  return p;
}

/** Форма волны звука на полосе шкалы — по ней удобно резать музыку в такт */
export function Waveform({ srcId, read, from, to, width, height }: { srcId: string; read: (id: string) => Promise<Blob>; from: number; to: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<{ peaks: Float32Array; perSec: number } | null>(null);
  useEffect(() => {
    let alive = true;
    peaksFor(srcId, () => read(srcId))
      .then((d) => alive && setData(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [srcId, read]);
  const w = Math.min(4096, Math.max(1, Math.round(width)));
  useEffect(() => {
    const c = ref.current;
    if (!c || !data) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const mid = c.height / 2;
    const span = Math.max(0.01, to - from);
    for (let x = 0; x < c.width; x += 2) {
      const t0 = from + (x / c.width) * span;
      const t1 = from + ((x + 2) / c.width) * span;
      let m = 0;
      for (let i = Math.floor(t0 * data.perSec); i <= Math.floor(t1 * data.perSec) && i < data.peaks.length; i++) m = Math.max(m, data.peaks[i]);
      const h = Math.max(1, Math.min(1, m * 1.4) * (c.height - 6));
      ctx.fillRect(x, mid - h / 2, 1.5, h);
    }
  }, [data, from, to, w]);
  return <canvas ref={ref} className="tl-wave-canvas" width={w} height={height} style={{ width, height }} aria-hidden="true" />;
}
