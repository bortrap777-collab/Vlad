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

export type TextFont =
  | 'accent'
  | 'elegant'
  | 'hand'
  | 'heavy'
  | 'rubik'
  | 'wide'
  | 'narrow'
  | 'sport'
  | 'round'
  | 'serif'
  | 'lobster'
  | 'pacifico'
  | 'script'
  | 'marker'
  | 'block'
  | 'pixel';
export type TextStyle = 'plain' | 'shadow' | 'box' | 'outline' | 'neon';

export interface TextLayer {
  id: string;
  text: string;
  /** Центр текста, 0…1 от итогового (обрезанного) кадра */
  x: number;
  y: number;
  /** Размер шрифта в долях ширины кадра */
  size: number;
  /** Поворот вокруг центра, градусы по часовой (нет — 0) */
  rotation?: number;
  color: string;
  font: TextFont;
  style: TextStyle;
  /** Непрозрачность 0…1 (нет — 1) */
  opacity?: number;
}

/** Замена фона в версии 0.5.0 — теперь это слои; поле читается только для переноса старых проектов. */
interface LegacyBackground {
  mask: string;
  mode: 'transparent' | 'color' | 'blur' | 'image';
  color: string;
  blur: number;
  image: string | null;
}

import { setBackground, stackMediaIds, withCutout, type Adjust, type LayerStack } from './layers';

export const BG_COLORS = ['#FFFFFF', '#111111', '#8366FF', '#E9E4FF', '#FFD84D', '#FF6FA3', '#4C9BFF', '#2FCB8A'];

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
  /** Слои; null — обычное фото без слоёв */
  stack: LayerStack | null;
}

export type PresetId =
  | 'original'
  | 'vivid'
  | 'warm'
  | 'cool'
  | 'mono'
  | 'film'
  | 'bright'
  | 'pop'
  | 'sunset'
  | 'gold'
  | 'rose'
  | 'ice'
  | 'mint'
  | 'night'
  | 'cinema'
  | 'drama'
  | 'matte'
  | 'retro'
  | 'vintage'
  | 'sepia'
  | 'noir'
  | 'silver'
  | 'neon';

export interface Preset {
  id: PresetId;
  name: string;
  b: number;
  c: number;
  s: number;
  t: number;
  gray?: number;
  sepia?: number;
  /** Поворот оттенка, градусы (как CSS hue-rotate) */
  hue?: number;
  /** Группа в ленте фильтров */
  group?: 'color' | 'warm' | 'cool' | 'mood' | 'retro' | 'bw';
}

export const PRESETS: Preset[] = [
  { id: 'original', name: 'Оригинал', b: 1, c: 1, s: 1, t: 0 },
  { id: 'vivid', name: 'Яркий', b: 1.04, c: 1.1, s: 1.38, t: 0, group: 'color' },
  { id: 'pop', name: 'Сочный', b: 1.03, c: 1.18, s: 1.62, t: 0, group: 'color' },
  { id: 'bright', name: 'Светлый', b: 1.13, c: 0.94, s: 1.06, t: 4, group: 'color' },
  { id: 'warm', name: 'Тёплый', b: 1.03, c: 1.02, s: 1.1, t: 38, group: 'warm' },
  { id: 'sunset', name: 'Закат', b: 1.02, c: 1.08, s: 1.22, t: 58, group: 'warm' },
  { id: 'gold', name: 'Золото', b: 1.04, c: 1.06, s: 1.15, t: 42, sepia: 0.12, group: 'warm' },
  { id: 'rose', name: 'Роза', b: 1.05, c: 0.98, s: 1.1, t: 18, hue: -12, group: 'warm' },
  { id: 'cool', name: 'Холодный', b: 1, c: 1.04, s: 0.92, t: -38, group: 'cool' },
  { id: 'ice', name: 'Лёд', b: 1.06, c: 1.05, s: 0.78, t: -58, group: 'cool' },
  { id: 'mint', name: 'Мята', b: 1.04, c: 1.02, s: 1.05, t: -14, hue: -14, group: 'cool' },
  { id: 'night', name: 'Ночь', b: 0.88, c: 1.14, s: 0.74, t: -42, group: 'cool' },
  { id: 'cinema', name: 'Кино', b: 0.97, c: 1.16, s: 0.9, t: -12, hue: 4, group: 'mood' },
  { id: 'drama', name: 'Драма', b: 0.95, c: 1.32, s: 0.82, t: 0, group: 'mood' },
  { id: 'matte', name: 'Матовый', b: 1.08, c: 0.78, s: 0.84, t: 6, group: 'mood' },
  { id: 'neon', name: 'Неон', b: 1.02, c: 1.16, s: 1.32, t: -22, hue: -28, group: 'mood' },
  { id: 'film', name: 'Плёнка', b: 1.02, c: 0.9, s: 0.82, t: 12, sepia: 0.18, group: 'retro' },
  { id: 'retro', name: 'Ретро', b: 1.03, c: 0.92, s: 0.9, t: 26, sepia: 0.34, group: 'retro' },
  { id: 'vintage', name: 'Винтаж', b: 1.07, c: 0.84, s: 0.7, t: 18, sepia: 0.26, group: 'retro' },
  { id: 'sepia', name: 'Сепия', b: 1.02, c: 1.05, s: 1, t: 0, sepia: 0.9, group: 'retro' },
  { id: 'mono', name: 'Ч/Б', b: 1.02, c: 1.12, s: 1, t: 0, gray: 1, group: 'bw' },
  { id: 'noir', name: 'Нуар', b: 0.94, c: 1.48, s: 1, t: 0, gray: 1, group: 'bw' },
  { id: 'silver', name: 'Серебро', b: 1.09, c: 0.88, s: 1, t: 0, gray: 1, group: 'bw' },
];

export const PRESET_GROUPS: { id: NonNullable<Preset['group']> | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'color', label: 'Яркие' },
  { id: 'warm', label: 'Тёплые' },
  { id: 'cool', label: 'Холодные' },
  { id: 'mood', label: 'Настроение' },
  { id: 'retro', label: 'Ретро' },
  { id: 'bw', label: 'Ч/Б' },
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
  stack: null,
};

/** Шрифты Google Fonts с кириллицей (подключены в index.html, офлайн — из кэша service worker) */
export const TEXT_FONTS: Record<TextFont, { name: string; family: string; weight: number }> = {
  accent: { name: 'Акцент', family: "'Manrope', -apple-system, 'Helvetica Neue', Arial, sans-serif", weight: 800 },
  heavy: { name: 'Жирный', family: "'Montserrat', 'Arial Black', sans-serif", weight: 900 },
  rubik: { name: 'Рубик', family: "'Rubik', 'Arial Black', sans-serif", weight: 900 },
  wide: { name: 'Широкий', family: "'Unbounded', 'Arial Black', sans-serif", weight: 800 },
  narrow: { name: 'Узкий', family: "'Oswald', 'Arial Narrow', sans-serif", weight: 700 },
  sport: { name: 'Спорт', family: "'Russo One', 'Arial Black', sans-serif", weight: 400 },
  round: { name: 'Мягкий', family: "'Comfortaa', 'Arial Rounded MT Bold', sans-serif", weight: 700 },
  block: { name: 'Блок', family: "'Rubik Mono One', 'Arial Black', sans-serif", weight: 400 },
  elegant: { name: 'Элегант', family: "'Playfair Display', Georgia, 'Times New Roman', serif", weight: 700 },
  serif: { name: 'Классика', family: "'PT Serif', Georgia, 'Times New Roman', serif", weight: 700 },
  lobster: { name: 'Лобстер', family: "'Lobster', 'Brush Script MT', cursive", weight: 400 },
  pacifico: { name: 'Пасифико', family: "'Pacifico', 'Brush Script MT', cursive", weight: 400 },
  hand: { name: 'Рукопись', family: "'Caveat', 'Segoe Print', 'Bradley Hand', cursive", weight: 700 },
  script: { name: 'Письмо', family: "'Marck Script', 'Segoe Script', cursive", weight: 400 },
  marker: { name: 'Маркер', family: "'Amatic SC', 'Segoe Print', cursive", weight: 700 },
  pixel: { name: 'Пиксель', family: "'Press Start 2P', 'Courier New', monospace", weight: 400 },
};

export const TEXT_COLORS = ['#FFFFFF', '#111111', '#8366FF', '#FFD84D', '#FF6FA3', '#4C9BFF', '#2FCB8A', '#FF3B30', '#FF8A3D', '#B4FF39', '#00E5FF', '#C77DFF', '#F5E6C8', '#8E8E93'];

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
  /** Поворот оттенка, градусы */
  hue: number;
  /** Цвет слоя температуры (0…1) и непрозрачность, или null */
  temp: { r: number; g: number; b: number; o: number } | null;
}

const WARM = '#FF9A2E';
const COOL = '#2E8BFF';

export function pixelParams(e: Adjust, presetOverride?: PresetId): PixelParams {
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
    hue: p.hue ?? 0,
    temp,
  };
}

export function toCssFilter(e: Adjust, presetOverride?: PresetId): string {
  const p = pixelParams(e, presetOverride);
  const parts = [`brightness(${p.b.toFixed(3)})`, `contrast(${p.c.toFixed(3)})`, `saturate(${p.s.toFixed(3)})`];
  if (p.gray) parts.push(`grayscale(${p.gray})`);
  if (p.sepia) parts.push(`sepia(${p.sepia})`);
  if (p.hue) parts.push(`hue-rotate(${p.hue}deg)`);
  return parts.join(' ');
}

export function temperatureLayer(e: Adjust, presetOverride?: PresetId): { color: string; opacity: number } | null {
  const p = pixelParams(e, presetOverride);
  if (!p.temp) return null;
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return { color: `#${hex(p.temp.r)}${hex(p.temp.g)}${hex(p.temp.b)}`, opacity: p.temp.o };
}

export function isEdited(e: PhotoEdits): boolean {
  return JSON.stringify(normalizeEdits(e)) !== JSON.stringify(DEFAULT_EDITS);
}

/** Старые проекты не знают про crop, texts и слои — дополняем. */
export function normalizeEdits(e: (Partial<PhotoEdits> & { background?: LegacyBackground | null }) | undefined, docW = 1, docH = 1): PhotoEdits {
  const { background, ...rest } = e ?? {};
  let stack = rest.stack ?? null;
  if (!stack && background) {
    // 0.5.0: маска + режим фона → слои «Фон» и «Объект»
    stack = withCutout(null, docW, docH, background.mask);
    const mode = background.mode === 'transparent' ? 'none' : background.mode === 'image' && !background.image ? 'none' : background.mode;
    stack = setBackground(stack, docW, docH, mode, { color: background.color, media: background.image ?? undefined });
    if (mode === 'blur') stack = { ...stack, layers: stack.layers.map((l) => (l.role === 'background' ? { ...l, blur: background.blur } : l)) };
  }
  return { ...DEFAULT_EDITS, ...rest, crop: rest.crop ?? null, texts: rest.texts ?? [], stack };
}

/** Файлы проекта, на которые ссылаются правки (кроме исходника). */
export function editMediaIds(e: (Partial<PhotoEdits> & { background?: LegacyBackground | null }) | undefined): string[] {
  const legacy = e?.background ? [e.background.mask, ...(e.background.image ? [e.background.image] : [])] : [];
  return [...new Set([...legacy, ...stackMediaIds(e?.stack)])];
}

/** Замена id файлов (перенос проекта на другое устройство) */
export function remapEditIds<T extends Partial<PhotoEdits> & { background?: LegacyBackground | null }>(e: T, idFor: (id: string) => string): T {
  const m = (id: string | null) => (id ? idFor(id) : null);
  return {
    ...e,
    background: e.background ? { ...e.background, mask: idFor(e.background.mask), image: m(e.background.image) } : e.background,
    stack: e.stack
      ? {
          layers: e.stack.layers.map((l) => ({ ...l, media: m(l.media), mask: m(l.mask) })),
          merged: e.stack.merged ? { ...e.stack.merged, media: idFor(e.stack.merged.media) } : null,
          photo: e.stack.photo ? { ...e.stack.photo, media: idFor(e.stack.photo.media) } : null,
        }
      : e.stack,
  };
}

export function isNeutralAdjust(a: Adjust): boolean {
  return a.preset === 'original' && !a.brightness && !a.contrast && !a.saturation && !a.temperature;
}

/**
 * Размытый фон: исходник уменьшается до 512 px и размывается тремя проходами
 * box-blur (≈ гаусс). Одна и та же функция готовит предпросмотр и итоговый файл,
 * поэтому они совпадают; ctx.filter не используется (его нет в старых Safari).
 */
export function blurredBackdrop(img: CanvasImageSource, w: number, h: number, amount: number): HTMLCanvasElement {
  const k = Math.min(1, 512 / Math.max(w, h));
  const bw = Math.max(1, Math.round(w * k));
  const bh = Math.max(1, Math.round(h * k));
  const c = document.createElement('canvas');
  c.width = bw;
  c.height = bh;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, bw, bh);
  const r = Math.round(1 + Math.max(0, Math.min(1, amount)) * Math.max(bw, bh) * 0.035);
  const data = ctx.getImageData(0, 0, bw, bh);
  for (let pass = 0; pass < 3; pass++) {
    boxBlur(data.data, bw, bh, r, true);
    boxBlur(data.data, bw, bh, r, false);
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

function boxBlur(d: Uint8ClampedArray, w: number, h: number, r: number, horizontal: boolean): void {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4;
  const buf = new Float32Array(len * 3);
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w * 4 : l * 4;
    for (let i = 0; i < len; i++) {
      const o = base + i * step;
      buf[i * 3] = d[o];
      buf[i * 3 + 1] = d[o + 1];
      buf[i * 3 + 2] = d[o + 2];
    }
    // Края продолжаются крайним пикселем
    const at = (i: number, ch: number) => buf[(i < 0 ? 0 : i >= len ? len - 1 : i) * 3 + ch];
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += at(i, ch);
      for (let i = 0; i < len; i++) {
        d[base + i * step + ch] = sum / (2 * r + 1);
        sum += at(i + r + 1, ch) - at(i - r, ch);
      }
    }
  }
}

/**
 * Попиксельная обработка RGBA. Функция самодостаточна (без внешних ссылок):
 * её исходный код передаётся в Web Worker как строка.
 * Порядок как в CSS: brightness → contrast → saturate → grayscale → sepia → hue-rotate → soft-light.
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
  if (p.hue) {
    // Матрица hue-rotate из спецификации Filter Effects
    const rad = (p.hue * Math.PI) / 180;
    const cs = Math.cos(rad);
    const sn = Math.sin(rad);
    m = mul([
      0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928,
      0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.14, 0.072 - cs * 0.072 - sn * 0.283,
      0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072,
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
