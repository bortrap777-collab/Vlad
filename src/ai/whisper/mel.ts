/**
 * Лог-мел спектрограмма Whisper — точное повторение WhisperFeatureExtractor (Hugging Face):
 * 16 кГц, окно Ханна 400, шаг 160, 80 мел-фильтров (шкала и нормировка Slaney),
 * 30 секунд → 3000 кадров, log10, отсечение на 8 дБ ниже максимума, (x + 4) / 4.
 * Без зависимостей от DOM — работает в Web Worker и в Node (для проверки).
 */
export const SAMPLE_RATE = 16000;
export const N_FFT = 400;
export const HOP = 160;
export const N_MELS = 80;
export const CHUNK_SAMPLES = 30 * SAMPLE_RATE;
export const N_FRAMES = CHUNK_SAMPLES / HOP; // 3000
const N_BINS = N_FFT / 2 + 1; // 201

function hzToMel(f: number): number {
  const minLogHz = 1000;
  const minLogMel = 15;
  const logstep = 27 / Math.log(6.4);
  return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) * logstep : (3 * f) / 200;
}

function melToHz(m: number): number {
  const minLogHz = 1000;
  const minLogMel = 15;
  const logstep = Math.log(6.4) / 27;
  return m >= minLogMel ? minLogHz * Math.exp(logstep * (m - minLogMel)) : (200 * m) / 3;
}

let filters: Float32Array | null = null;
/** Мел-фильтры [80 × 201] */
export function melFilters(): Float32Array {
  if (filters) return filters;
  const fftFreqs = new Float64Array(N_BINS);
  for (let i = 0; i < N_BINS; i++) fftFreqs[i] = (i * (SAMPLE_RATE / 2)) / (N_BINS - 1);
  const mMin = hzToMel(0);
  const mMax = hzToMel(SAMPLE_RATE / 2);
  const pts = new Float64Array(N_MELS + 2);
  for (let i = 0; i < N_MELS + 2; i++) pts[i] = melToHz(mMin + ((mMax - mMin) * i) / (N_MELS + 1));
  const out = new Float32Array(N_MELS * N_BINS);
  for (let m = 0; m < N_MELS; m++) {
    const lo = pts[m];
    const mid = pts[m + 1];
    const hi = pts[m + 2];
    const enorm = 2 / (hi - lo);
    for (let k = 0; k < N_BINS; k++) {
      const f = fftFreqs[k];
      const down = (f - lo) / (mid - lo);
      const up = (hi - f) / (hi - mid);
      out[m * N_BINS + k] = Math.max(0, Math.min(down, up)) * enorm;
    }
  }
  filters = out;
  return out;
}

let tables: { cos: Float64Array; sin: Float64Array; win: Float64Array } | null = null;
function dftTables() {
  if (tables) return tables;
  const cos = new Float64Array(N_BINS * N_FFT);
  const sin = new Float64Array(N_BINS * N_FFT);
  for (let k = 0; k < N_BINS; k++)
    for (let n = 0; n < N_FFT; n++) {
      const a = (2 * Math.PI * k * n) / N_FFT;
      cos[k * N_FFT + n] = Math.cos(a);
      sin[k * N_FFT + n] = Math.sin(a);
    }
  // Периодическое окно Ханна (как numpy/HF для БПФ)
  const win = new Float64Array(N_FFT);
  for (let n = 0; n < N_FFT; n++) win[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT);
  tables = { cos, sin, win };
  return tables;
}

/**
 * Окно 30 с (короче — дополняется тишиной) → Float32Array [80 × 3000], построчно по мел-полосам.
 */
export function logMel(audio: Float32Array): Float32Array {
  const x = new Float32Array(CHUNK_SAMPLES);
  x.set(audio.subarray(0, CHUNK_SAMPLES));
  const { cos, sin, win } = dftTables();
  const fb = melFilters();
  const pad = N_FFT / 2;
  // Отражение по краям (center=True, reflect)
  const at = (i: number) => {
    if (i < 0) return x[-i];
    if (i >= CHUNK_SAMPLES) return x[2 * (CHUNK_SAMPLES - 1) - i];
    return x[i];
  };
  const out = new Float32Array(N_MELS * N_FRAMES);
  const frame = new Float64Array(N_FFT);
  const power = new Float64Array(N_BINS);
  let maxVal = -Infinity;
  for (let t = 0; t < N_FRAMES; t++) {
    const start = t * HOP - pad;
    for (let n = 0; n < N_FFT; n++) frame[n] = at(start + n) * win[n];
    for (let k = 0; k < N_BINS; k++) {
      let re = 0;
      let im = 0;
      const base = k * N_FFT;
      for (let n = 0; n < N_FFT; n++) {
        const v = frame[n];
        re += v * cos[base + n];
        im -= v * sin[base + n];
      }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < N_MELS; m++) {
      let s = 0;
      const base = m * N_BINS;
      for (let k = 0; k < N_BINS; k++) s += fb[base + k] * power[k];
      const v = Math.log10(Math.max(s, 1e-10));
      out[m * N_FRAMES + t] = v;
      if (v > maxVal) maxVal = v;
    }
  }
  const floor = maxVal - 8;
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], floor) + 4) / 4;
  return out;
}
