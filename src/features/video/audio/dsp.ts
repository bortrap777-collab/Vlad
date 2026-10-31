/**
 * Обработка звука без зависимостей (работает в Web Worker и в Node для проверки):
 *  - timeStretch — WSOLA: меняет темп, не меняя тон;
 *  - resample    — меняет тон и темп вместе (как скорость плёнки);
 *  - changeSpeedPitch — скорость и тон независимо: растяжение + передискретизация.
 * Один и тот же код готовит звук и для предпросмотра, и для экспорта — звучат одинаково.
 */

/** Передискретизация: ratio > 1 — выше и быстрее. Кубическая интерполяция (Catmull–Rom). */
export function resample(input: Float32Array, ratio: number): Float32Array {
  const n = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(n);
  const last = input.length - 1;
  // При повышении (ratio > 1) срезаем верх простым сглаживанием, чтобы не было «звона»
  const src = ratio > 1.05 ? lowpass(input, 0.5 / ratio) : input;
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const k = Math.floor(x);
    const t = x - k;
    const p0 = src[Math.max(0, k - 1)];
    const p1 = src[Math.min(last, k)];
    const p2 = src[Math.min(last, k + 1)];
    const p3 = src[Math.min(last, k + 2)];
    out[i] = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  }
  return out;
}

/** Двухполюсный фильтр нижних частот (Баттерворт), cutoff — доля частоты дискретизации (0…0.5) */
function lowpass(x: Float32Array, cutoff: number): Float32Array {
  const fc = Math.min(0.49, Math.max(0.01, cutoff));
  const k = Math.tan(Math.PI * fc);
  const q = Math.SQRT1_2;
  const norm = 1 / (1 + k / q + k * k);
  const a0 = k * k * norm;
  const a1 = 2 * a0;
  const a2 = a0;
  const b1 = 2 * (k * k - 1) * norm;
  const b2 = (1 - k / q + k * k) * norm;
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = a0 * x[i] + a1 * x1 + a2 * x2 - b1 * y1 - b2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * WSOLA (Waveform Similarity Overlap-Add): длительность × stretch, тон тот же.
 * Окно ~43 мс, перекрытие 50 %, поиск лучшего совпадения ±11 мс по прореженному моно-сигналу.
 */
export function timeStretch(channels: Float32Array[], stretch: number, sampleRate: number, onProgress?: (v: number) => void): Float32Array[] {
  if (Math.abs(stretch - 1) < 1e-3) return channels.map((c) => c.slice());
  const len = channels[0].length;
  const N = pow2(Math.round(sampleRate * 0.043));
  const Hs = N / 2;
  const Ha = Hs / stretch;
  const tol = pow2(Math.round(sampleRate * 0.011));
  const outLen = Math.max(1, Math.round(len * stretch));
  const out = channels.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  // Моно-сигнал, прореженный в 4 раза, — для поиска совпадения
  const D = 4;
  const mono = new Float32Array(Math.ceil(len / D) + 1);
  for (let i = 0, j = 0; i < len; i += D, j++) {
    let s = 0;
    for (const c of channels) s += c[i];
    mono[j] = s;
  }

  let prev = 0; // откуда взяли предыдущее окно
  const frames = Math.ceil(outLen / Hs) + 1;
  for (let f = 0; f < frames; f++) {
    const outPos = f * Hs;
    const ideal = Math.round(f * Ha);
    let best = ideal;
    if (f > 0) {
      // Естественное продолжение предыдущего окна — образец для поиска
      const nat = prev + Hs;
      const lo = Math.max(0, ideal - tol);
      const hi = Math.min(len - N, ideal + tol);
      if (hi > lo) {
        let bestScore = -Infinity;
        const L = Hs / D;
        const n0 = Math.floor(nat / D);
        for (let cand = lo; cand <= hi; cand += D) {
          const c0 = Math.floor(cand / D);
          let s = 0;
          let e = 1e-9;
          for (let k = 0; k < L; k += 2) {
            const a = mono[c0 + k] ?? 0;
            s += a * (mono[n0 + k] ?? 0);
            e += a * a;
          }
          const score = s / Math.sqrt(e);
          if (score > bestScore) {
            bestScore = score;
            best = cand;
          }
        }
      }
    }
    best = Math.max(0, Math.min(len - 1, best));
    for (let ch = 0; ch < channels.length; ch++) {
      const src = channels[ch];
      const dst = out[ch];
      for (let i = 0; i < N; i++) {
        const si = best + i;
        if (si >= len) break;
        dst[outPos + i] += src[si] * win[i];
      }
    }
    for (let i = 0; i < N; i++) norm[outPos + i] += win[i];
    prev = best;
    if (onProgress && f % 200 === 0) onProgress(f / frames);
  }
  for (let ch = 0; ch < out.length; ch++) {
    const d = out[ch];
    for (let i = 0; i < outLen; i++) d[i] = norm[i] > 1e-3 ? d[i] / norm[i] : d[i];
  }
  return out.map((d) => d.subarray(0, outLen).slice());
}

function pow2(n: number): number {
  return 2 ** Math.round(Math.log2(Math.max(2, n)));
}

/**
 * Скорость и тон независимо. speed 0.5…2 (темп), semitones −12…+12 (тон).
 * Длина результата = длина / speed.
 */
export function changeSpeedPitch(channels: Float32Array[], speed: number, semitones: number, sampleRate: number, onProgress?: (v: number) => void): Float32Array[] {
  const r = Math.pow(2, semitones / 12);
  const stretch = r / speed;
  const stretched = Math.abs(stretch - 1) < 1e-3 ? channels : timeStretch(channels, stretch, sampleRate, onProgress);
  if (Math.abs(r - 1) < 1e-4) return stretched === channels ? channels.map((c) => c.slice()) : stretched;
  return stretched.map((c) => resample(c, r));
}

/** Импульсная характеристика «зала» для эха: затухающий шум, стерео */
export function reverbImpulse(sampleRate: number, seconds = 2.4, decay = 3): Float32Array[] {
  const n = Math.round(sampleRate * seconds);
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return [0, 1].map(() => {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / n, decay);
    return d;
  });
}
