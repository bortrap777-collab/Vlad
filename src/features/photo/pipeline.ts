/**
 * Параметры фоторедактора — единый источник правды для предпросмотра и рендера.
 *
 * Предпросмотр: CSS filter + слой температуры (mix-blend-mode: soft-light).
 * Рендер в файл: та же математика попиксельно (applyAdjustments) — формулы
 * совпадают со спецификацией CSS Filter Effects, поэтому результат совпадает
 * с тем, что пользователь видел на экране. ctx.filter не используется:
 * в старых версиях Safari его нет.
 */

export interface CropRect {
  /** Нормированные координаты 0…1 в повёрнутом изображении */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TextFont = 'accent' | 'elegant' | 'hand';
export type TextStyle = 'plain' | 'shadow' | 'box';

export interface TextLayer {
  id: string;
  text: string;
  /** Центр текста, 0…1 от итогового (обрезанного) кадра */
  x: number;
  y: number;
  /** Размер шрифта в долях ширины кадра */
  size: number;
  color: string;
  font: TextFont;
  style: TextStyle;
}

export interface PhotoEdits {
  preset: PresetId;
  /** -100…100 */
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  /** 0, 90, 180, 270 — по часовой стрелке */
  rotation: number;
  crop: CropRect | null;
  texts: TextLayer[];
}

export type PresetId = 'original' | 'vivid' | 'warm' | 'cool' | 'mono' | 'film';

export interface Preset {
  id: PresetId;
  name: string;
  b: number;
  c: number;
  s: number;
  t: number;
  gray?: number;
  sepia?: number;
}

export const PRESETS: Preset[] = [
  { id: 'original', name: 'Оригинал', b: 1, c: 1, s: 1, t: 0 },
  { id: 'vivid', name: 'Яркий', b: 1.04, c: 1.1, s: 1.38, t: 0 },
  { id: 'warm', name: 'Тёплый', b: 1.03, c: 1.02, s: 1.1, t: 38 },
  { id: 'cool', name: 'Холодный', b: 1, c: 1.04, s: 0.92, t: -38 },
  { id: 'mono', name: 'Ч/Б', b: 1.02, c: 1.12, s: 1, t: 0, gray: 1 },
  { id: 'film', name: 'Плёнка', b: 1.02, c: 0.9, s: 0.82, t: 12, sepia: 0.18 },
];

export const DEFAULT_EDITS: PhotoEdits = {
  preset: 'original',
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  rotation: 0,
  crop: null,
  texts: [],
};

export const TEXT_FONTS: Record<TextFont, { name: string; family: string; weight: number }> = {
  accent: { name: 'Акцент', family: "'Manrope', -apple-system, 'Helvetica Neue', Arial, sans-serif", weight: 800 },
  elegant: { name: 'Элегант', family: "'Playfair Display', Georgia, 'Times New Roman', serif", weight: 700 },
  hand: { name: 'Рукопись', family: "'Caveat', 'Segoe Print', 'Bradley Hand', cursive", weight: 700 },
};

export const TEXT_COLORS = ['#FFFFFF', '#111111', '#8366FF', '#FFD84D', '#FF6FA3', '#4C9BFF'];

export function presetOf(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/** Значения после смешения пресета и ручных настроек */
export interface PixelParams {
  b: number;
  c: number;
  s: number;
  gray: number;
  sepia: number;
  /** Цвет слоя температуры (0…1) и непрозрачность, или null */
  temp: { r: number; g: number; b: number; o: number } | null;
}

const WARM = '#FF9A2E';
const COOL = '#2E8BFF';

export function pixelParams(e: PhotoEdits, presetOverride?: PresetId): PixelParams {
  const p = presetOf(presetOverride ?? e.preset);
  const t = Math.max(-100, Math.min(100, p.t + e.temperature));
  let temp: PixelParams['temp'] = null;
  if (Math.abs(t) >= 1) {
    const hex = t > 0 ? WARM : COOL;
    temp = {
      r: parseInt(hex.slice(1, 3), 16) / 255,
      g: parseInt(hex.slice(3, 5), 16) / 255,
      b: parseInt(hex.slice(5, 7), 16) / 255,
      o: (Math.abs(t) / 100) * 0.55,
    };
  }
  return {
    b: p.b * (1 + e.brightness / 200),
    c: p.c * (1 + e.contrast / 200),
    s: Math.max(0, p.s * (1 + e.saturation / 100)),
    gray: p.gray ?? 0,
    sepia: p.sepia ?? 0,
    temp,
  };
}

export function toCssFilter(e: PhotoEdits, presetOverride?: PresetId): string {
  const p = pixelParams(e, presetOverride);
  const parts = [`brightness(${p.b.toFixed(3)})`, `contrast(${p.c.toFixed(3)})`, `saturate(${p.s.toFixed(3)})`];
  if (p.gray) parts.push(`grayscale(${p.gray})`);
  if (p.sepia) parts.push(`sepia(${p.sepia})`);
  return parts.join(' ');
}

export function temperatureLayer(e: PhotoEdits, presetOverride?: PresetId): { color: string; opacity: number } | null {
  const p = pixelParams(e, presetOverride);
  if (!p.temp) return null;
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return { color: `#${hex(p.temp.r)}${hex(p.temp.g)}${hex(p.temp.b)}`, opacity: p.temp.o };
}

export function isEdited(e: PhotoEdits): boolean {
  return JSON.stringify(normalizeEdits(e)) !== JSON.stringify(DEFAULT_EDITS);
}

/** Старые проекты (этап 1) не знают про crop и texts — дополняем. */
export function normalizeEdits(e: Partial<PhotoEdits> | undefined): PhotoEdits {
  return { ...DEFAULT_EDITS, ...e, crop: e?.crop ?? null, texts: e?.texts ?? [] };
}

/**
 * Попиксельная обработка RGBA. Функция самодостаточна (без внешних ссылок):
 * её исходный код передаётся в Web Worker как строка.
 * Порядок как в CSS: brightness → contrast → saturate → grayscale → sepia → soft-light.
 */
export function applyAdjustments(d: Uint8ClampedArray, p: PixelParams, onProgress?: (v: number) => void): void {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = (((i / 255) * p.b - 0.5) * p.c + 0.5);

  const mul = (a: number[], b: number[]) => {
    const r: number[] = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return r;
  };
  const sat = (s: number) => [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
  let m = sat(p.s);
  if (p.gray) m = mul(sat(1 - p.gray), m);
  if (p.sepia) {
    const a = 1 - p.sepia;
    m = mul([
      0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a,
      0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a,
      0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a,
    ], m);
  }

  // soft-light по спецификации Compositing and Blending, с непрозрачностью слоя
  const N = 1024;
  let sl: Float32Array[] | null = null;
  if (p.temp) {
    const t = p.temp;
    sl = [t.r, t.g, t.b].map((cs) => {
      const arr = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const bb = i / (N - 1);
        let r: number;
        if (cs <= 0.5) r = bb - (1 - 2 * cs) * bb * (1 - bb);
        else {
          const dd = bb <= 0.25 ? ((16 * bb - 12) * bb + 4) * bb : Math.sqrt(bb);
          r = bb + (2 * cs - 1) * (dd - bb);
        }
        arr[i] = bb + (r - bb) * t.o;
      }
      return arr;
    });
  }

  const total = d.length;
  const step = 4 * 262144;
  for (let start = 0; start < total; start += step) {
    const end = Math.min(total, start + step);
    for (let i = start; i < end; i += 4) {
      const r0 = lut[d[i]], g0 = lut[d[i + 1]], b0 = lut[d[i + 2]];
      let r = m[0] * r0 + m[1] * g0 + m[2] * b0;
      let g = m[3] * r0 + m[4] * g0 + m[5] * b0;
      let b = m[6] * r0 + m[7] * g0 + m[8] * b0;
      r = r < 0 ? 0 : r > 1 ? 1 : r;
      g = g < 0 ? 0 : g > 1 ? 1 : g;
      b = b < 0 ? 0 : b > 1 ? 1 : b;
      if (sl) {
        r = sl[0][(r * (N - 1) + 0.5) | 0];
        g = sl[1][(g * (N - 1) + 0.5) | 0];
        b = sl[2][(b * (N - 1) + 0.5) | 0];
      }
      d[i] = r * 255 + 0.5;
      d[i + 1] = g * 255 + 0.5;
      d[i + 2] = b * 255 + 0.5;
    }
    if (onProgress) onProgress(end / total);
  }
}
