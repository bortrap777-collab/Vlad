/**
 * Модель видеомонтажа. Неизменяемые операции: каждая возвращает новый Timeline,
 * поэтому история отмены — просто список состояний.
 *
 * Дорожки:
 *  - clips    — основная видеодорожка, клипы встык (длина ролика = сумма клипов);
 *  - overlays — наложения (видео или картинка поверх, с хромакеем);
 *  - texts    — надписи и субтитры (у субтитров могут быть слова со временем);
 *  - audios   — музыка и звуки: обрезка, затухания, скорость, тон, эхо;
 *  - markers  — ключи: отмеченные промежутки времени.
 */
import { DEFAULT_EDITS, type PhotoEdits, type TextLayer } from '../photo/pipeline';

export interface SourceMeta {
  id: string;
  kind: 'video' | 'audio' | 'image';
  name: string;
  mime: string;
  size: number;
  duration: number;
  width?: number;
  height?: number;
  /** Кадры по всей длине исходника (для полосы на шкале) */
  frames?: string[];
}

/** Цвет клипа — те же параметры, что в фоторедакторе */
export type ClipLook = Pick<PhotoEdits, 'preset' | 'brightness' | 'contrast' | 'saturation' | 'temperature'>;

export interface Clip {
  id: string;
  src: string;
  /** Начало и конец фрагмента в секундах исходника */
  in: number;
  out: number;
  /** 0…2 (1 = 100 %) */
  volume: number;
  /** Скорость: 0.1…4 (по умолчанию 1) */
  speed?: number;
  /**
   * «Плавнее»: скорость разгоняется и тормозит на краях клипа (без рывка),
   * а при замедлении соседние кадры смешиваются — движение без подёргиваний.
   */
  smooth?: boolean;
  look?: ClipLook;
  /** Переход от предыдущего клипа к этому */
  transition?: TransitionType;
  /** Длительность перехода, секунды (по умолчанию 0,6) */
  transitionDuration?: number;
}

export type TransitionType =
  | 'none'
  | 'fade'
  | 'white'
  | 'dissolve'
  | 'slideleft'
  | 'slideup'
  | 'wipe'
  | 'zoom'
  | 'circle'
  | 'whipleft'
  | 'whipright'
  | 'whipup'
  | 'whipdown'
  | 'zoomin'
  | 'zoomout'
  | 'spin'
  | 'glitch'
  | 'flash'
  | 'blur'
  | 'shake'
  | 'pixel'
  | 'rgb'
  | 'swirl';

export const TRANSITIONS: { id: TransitionType; label: string; group: 'trend' | 'classic' }[] = [
  { id: 'none', label: 'Без перехода', group: 'trend' },
  { id: 'whipleft', label: 'Рывок ←', group: 'trend' },
  { id: 'whipright', label: 'Рывок →', group: 'trend' },
  { id: 'whipup', label: 'Рывок ↑', group: 'trend' },
  { id: 'whipdown', label: 'Рывок ↓', group: 'trend' },
  { id: 'zoomin', label: 'Зум-удар', group: 'trend' },
  { id: 'zoomout', label: 'Отдаление', group: 'trend' },
  { id: 'spin', label: 'Вращение', group: 'trend' },
  { id: 'glitch', label: 'Глитч', group: 'trend' },
  { id: 'flash', label: 'Вспышка-зум', group: 'trend' },
  { id: 'blur', label: 'Размытие', group: 'trend' },
  { id: 'shake', label: 'Тряска', group: 'trend' },
  { id: 'rgb', label: 'RGB-сдвиг', group: 'trend' },
  { id: 'swirl', label: 'Вихрь', group: 'trend' },
  { id: 'pixel', label: 'Пиксели', group: 'trend' },
  { id: 'dissolve', label: 'Растворение', group: 'classic' },
  { id: 'fade', label: 'Через чёрный', group: 'classic' },
  { id: 'white', label: 'Через белый', group: 'classic' },
  { id: 'slideleft', label: 'Сдвиг', group: 'classic' },
  { id: 'slideup', label: 'Вверх', group: 'classic' },
  { id: 'wipe', label: 'Шторка', group: 'classic' },
  { id: 'zoom', label: 'Наезд', group: 'classic' },
  { id: 'circle', label: 'Круг', group: 'classic' },
];

/** Переход «через цвет»: картинка уходит в чёрный/белый и звук тоже */
export const isDip = (t: TransitionType | undefined) => t === 'fade' || t === 'white';
export const hasTransition = (c: Clip) => !!c.transition && c.transition !== 'none';
/** Переход, при котором оба клипа видны одновременно (рисуется на холсте) */
export const isBlend = (c: Clip) => hasTransition(c) && !isDip(c.transition);
export const transitionLen = (c: Clip) => c.transitionDuration ?? FADE;

/* ---------------- Звук ---------------- */
export interface AudioItem {
  id: string;
  src: string;
  /** Где на шкале начинается, секунды */
  start: number;
  /** Обрезка — в секундах исходного трека */
  in: number;
  out: number;
  volume: number;
  /** Плавное появление и затухание, секунды (0 — нет) */
  fadeIn: number;
  fadeOut: number;
  /** Скорость 0.5…2 (тон не меняется) */
  speed?: number;
  /** Тон, полутоны −12…+12 (скорость не меняется) */
  pitch?: number;
  /** Эхо (реверберация) 0…1 */
  reverb?: number;
}

/** Старый формат (до 0.9): одна музыка с начала ролика */
interface LegacyMusic {
  id: string;
  src: string;
  volume: number;
  offset?: number;
  fadeIn?: boolean;
  fadeOut?: boolean;
}

/* ---------------- Наложения ---------------- */
export interface ChromaKey {
  /** Цвет фона, который убираем (#rrggbb) */
  color: string;
  /** Насколько похожие оттенки убирать, 0…1 */
  similarity: number;
  /** Мягкость края, 0…1 */
  smoothness: number;
  /** Убрать цветную кайму от фона, 0…1 */
  spill: number;
}

export interface Overlay {
  id: string;
  src: string;
  /** Время на шкале */
  start: number;
  end: number;
  /** С какой секунды исходника (для видео) */
  in: number;
  /** Центр, 0…1 от кадра */
  x: number;
  y: number;
  /** Ширина, доля ширины кадра */
  w: number;
  rotation: number;
  opacity: number;
  /** Звук наложения (видео), 0…2 */
  volume: number;
  key: ChromaKey | null;
}

/* ---------------- Ключи ---------------- */
export interface Marker {
  id: string;
  start: number;
  end: number;
  label: string;
  color: string;
}
export const MARKER_COLORS = ['#FFD84D', '#FF6FA3', '#4C9BFF', '#2FCB8A', '#8366FF', '#FF8A3D'];

/* ---------------- Текст ---------------- */
export type TextAnim = 'none' | 'fade' | 'blur' | 'zoom' | 'pop' | 'up' | 'down' | 'left' | 'type' | 'bounce' | 'glow';
export const TEXT_ANIMS_IN: { id: TextAnim; label: string }[] = [
  { id: 'none', label: 'Нет' },
  { id: 'fade', label: 'Проявление' },
  { id: 'blur', label: 'Из размытия' },
  { id: 'zoom', label: 'Наезд' },
  { id: 'pop', label: 'Пружина' },
  { id: 'up', label: 'Снизу' },
  { id: 'down', label: 'Сверху' },
  { id: 'left', label: 'Сбоку' },
  { id: 'type', label: 'Печать' },
  { id: 'bounce', label: 'Прыжок' },
  { id: 'glow', label: 'Сияние' },
];
export const TEXT_ANIMS_OUT: { id: TextAnim; label: string }[] = [
  { id: 'none', label: 'Нет' },
  { id: 'fade', label: 'Затухание' },
  { id: 'blur', label: 'В размытие' },
  { id: 'zoom', label: 'Отдаление' },
  { id: 'pop', label: 'Сжатие' },
  { id: 'up', label: 'Вверх' },
  { id: 'down', label: 'Вниз' },
  { id: 'left', label: 'В сторону' },
  { id: 'type', label: 'Стирание' },
  { id: 'glow', label: 'Вспышка' },
];

/**
 * Как субтитр показывает слова:
 *  build   — слова появляются по одному в момент произнесения, фраза целиком исчезает, когда начинается следующая;
 *  single  — только текущее слово (крупно, как в Reels);
 *  karaoke — фраза целиком, произносимое слово подсвечено;
 *  phrase  — фраза целиком без пословной синхронизации.
 */
export type WordMode = 'build' | 'single' | 'karaoke' | 'phrase';

export interface TimedWord {
  w: string;
  /** Время на шкале, секунды */
  s: number;
  e: number;
}

export interface VideoText extends TextLayer {
  /** Время на шкале, секунды */
  start: number;
  end: number;
  /** Создан автоматически из речи (субтитры) */
  subtitle?: boolean;
  animIn?: TextAnim;
  animOut?: TextAnim;
  /** Длительность появления/исчезновения, секунды */
  animDur?: number;
  words?: TimedWord[];
  wordMode?: WordMode;
  /** Цвет подсветки слова (караоке) */
  highlight?: string;
}

export type FrameFormat = 'original' | '9:16' | '1:1' | '4:5' | '16:9';

export interface Timeline {
  clips: Clip[];
  audios: AudioItem[];
  texts: VideoText[];
  overlays: Overlay[];
  markers: Marker[];
  format?: FrameFormat;
  /** Вписать видео в кадр (с фоном) или заполнить кадр (обрезая края) */
  fit?: 'fit' | 'fill';
  background?: 'blur' | 'black';
  /** Плавное появление в начале и затемнение в конце ролика */
  fadeIn?: boolean;
  fadeOut?: boolean;
  /** Частота кадров экспорта */
  fps?: 30 | 60;
}

/** Длительность затемнения (переходы, начало, конец), секунды */
export const FADE = 0.6;
export const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
export const FORMATS: { id: FrameFormat; label: string; ratio: number | null }[] = [
  { id: 'original', label: 'Оригинал', ratio: null },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

export const MIN_CLIP = 0.3;
export const EMPTY_TIMELINE: Timeline = { clips: [], audios: [], texts: [], overlays: [], markers: [] };

/** Старые проекты → текущий формат (music → audios, пустые дорожки) */
export function normalizeTimeline(raw: Partial<Timeline> & { music?: LegacyMusic | null }, sources?: Record<string, { duration: number }>): Timeline {
  const { music, ...rest } = raw;
  const t: Timeline = { ...EMPTY_TIMELINE, ...rest, clips: rest.clips ?? [], texts: rest.texts ?? [], audios: rest.audios ?? [], overlays: rest.overlays ?? [], markers: rest.markers ?? [] };
  if (music && !rest.audios) {
    const dur = sources?.[music.src]?.duration ?? 600;
    const off = music.offset ?? 0;
    const total = totalDuration(t);
    t.audios = [
      {
        id: music.id,
        src: music.src,
        start: 0,
        in: off,
        out: Math.min(dur, off + Math.max(total, 1)),
        volume: music.volume,
        fadeIn: music.fadeIn ? 1.5 : 0,
        fadeOut: music.fadeOut ? 1.5 : dur - off > total ? 1 : 0,
      },
    ];
  }
  return t;
}

/* ---------------- Скорость и время клипа ---------------- */
export const speedOf = (c: Clip) => c.speed || 1;
const isSmooth = (c: Clip) => !!c.smooth && Math.abs(speedOf(c) - 1) > 1e-3;
const RAMP_MAX = 0.6;

/** Длительность разгона/торможения на краю «плавного» клипа (секунды шкалы) */
function rampOf(c: Clip): number {
  if (!isSmooth(c)) return 0;
  const S = speedOf(c);
  const L = c.out - c.in;
  return Math.max(0, Math.min(RAMP_MAX, (0.4 * L) / (1 + S)));
}

/** Длительность клипа на шкале (с учётом скорости и плавного разгона) */
export function clipLen(c: Clip): number {
  const S = speedOf(c);
  const L = c.out - c.in;
  const R = rampOf(c);
  if (!R) return L / S;
  return 2 * R + (L - R * (1 + S)) / S;
}

/** Скорость на краю клипа (для «ручек» перехода за пределами клипа) */
const edgeRate = (c: Clip) => (isSmooth(c) ? 1 : speedOf(c));

/** Время исходника по времени внутри клипа τ (0…clipLen); за краями — продолжение с краевой скоростью */
export function srcAt(c: Clip, tau: number): number {
  const S = speedOf(c);
  const R = rampOf(c);
  const len = clipLen(c);
  if (tau <= 0) return c.in + tau * edgeRate(c);
  if (tau >= len) return c.out + (tau - len) * edgeRate(c);
  if (!R) return c.in + tau * S;
  if (tau <= R) return c.in + tau + ((S - 1) * tau * tau) / (2 * R);
  if (tau >= len - R) {
    const u = len - tau;
    return c.out - (u + ((S - 1) * u * u) / (2 * R));
  }
  return c.in + (R * (1 + S)) / 2 + S * (tau - R);
}

/** Мгновенная скорость воспроизведения исходника в момент τ клипа */
export function rateAt(c: Clip, tau: number): number {
  const S = speedOf(c);
  const R = rampOf(c);
  if (!R) return S;
  const len = clipLen(c);
  if (tau <= 0 || tau >= len) return 1;
  if (tau < R) return 1 + ((S - 1) * tau) / R;
  if (tau > len - R) return 1 + ((S - 1) * (len - tau)) / R;
  return S;
}

/** Обратная к srcAt: время внутри клипа, когда показывается секунда исходника src */
export function tauAt(c: Clip, src: number): number {
  const S = speedOf(c);
  const R = rampOf(c);
  const len = clipLen(c);
  const d = src - c.in;
  if (d <= 0) return d / edgeRate(c);
  if (src >= c.out) return len + (src - c.out) / edgeRate(c);
  if (!R) return d / S;
  const k = (S - 1) / R;
  const r1 = (R * (1 + S)) / 2;
  if (d <= r1) return Math.abs(k) < 1e-9 ? d : (-1 + Math.sqrt(Math.max(0, 1 + 2 * k * d))) / k;
  const e = c.out - src;
  if (e <= r1) {
    const u = Math.abs(k) < 1e-9 ? e : (-1 + Math.sqrt(Math.max(0, 1 + 2 * k * e))) / k;
    return len - u;
  }
  return R + (d - r1) / S;
}

/** Опорные точки скорости клипа (для автоматизации playbackRate в сведении звука) */
export function rateCurve(c: Clip): { tau: number; rate: number }[] {
  const R = rampOf(c);
  const S = speedOf(c);
  if (!R) return [{ tau: 0, rate: S }];
  const len = clipLen(c);
  return [
    { tau: 0, rate: 1 },
    { tau: R, rate: S },
    { tau: len - R, rate: S },
    { tau: len, rate: 1 },
  ];
}

export function lookEdits(look: ClipLook | undefined): PhotoEdits {
  return { ...DEFAULT_EDITS, ...(look ?? {}) };
}

export function hasLook(c: Clip): boolean {
  const l = c.look;
  return !!l && (l.preset !== 'original' || !!l.brightness || !!l.contrast || !!l.saturation || !!l.temperature);
}

/** Пропорция кадра проекта (ширина / высота) */
export function frameRatio(t: Timeline, firstW?: number, firstH?: number): number {
  const f = FORMATS.find((x) => x.id === (t.format ?? 'original'));
  if (f?.ratio) return f.ratio;
  return firstW && firstH ? firstW / firstH : 16 / 9;
}

export function totalDuration(t: Timeline): number {
  return t.clips.reduce((s, c) => s + clipLen(c), 0);
}

export function clipStarts(t: Timeline): number[] {
  const starts: number[] = [];
  let acc = 0;
  for (const c of t.clips) {
    starts.push(acc);
    acc += clipLen(c);
  }
  return starts;
}

/**
 * Какой видеоэлемент играет клип: у соседних клипов из одного файла — разные элементы,
 * поэтому следующий клип заранее стоит на своём первом кадре и стык без паузы.
 */
export function clipLanes(t: Timeline): number[] {
  const lanes: number[] = [];
  t.clips.forEach((c, i) => {
    const prev = t.clips[i - 1];
    lanes.push(prev && prev.src === c.src ? 1 - lanes[i - 1] : 0);
  });
  return lanes;
}

export const laneKey = (src: string, lane: number) => `${src}#${lane}`;

/**
 * Насколько кадр затемнён в момент T (0 — нет, 1 — чёрный):
 * переходы «затемнение» между клипами и плавные начало/конец ролика.
 */
export function dipAt(t: Timeline, T: number): { color: 'black' | 'white'; alpha: number } {
  const total = totalDuration(t);
  let a = 0;
  let color: 'black' | 'white' = 'black';
  if (t.fadeIn && T < FADE) a = Math.max(a, 1 - T / FADE);
  if (t.fadeOut && T > total - FADE) a = Math.max(a, (T - (total - FADE)) / FADE);
  const starts = clipStarts(t);
  for (let i = 1; i < t.clips.length; i++) {
    const c = t.clips[i];
    if (!isDip(c.transition)) continue;
    const half = transitionLen(c) / 2;
    const d = Math.abs(T - starts[i]);
    if (d < half) {
      const v = 1 - d / half;
      if (v > a) {
        a = v;
        color = c.transition === 'white' ? 'white' : 'black';
      }
    }
  }
  return { color, alpha: Math.min(1, Math.max(0, a)) };
}

/**
 * Переход «картинка в картинку» в момент T: index — входящий клип, p — ход перехода 0…1, cut — время стыка.
 * Оба клипа живые: уходящий продолжает идти за свой конец, входящий начинается раньше своего начала
 * (если в файле есть кадры), поэтому длина ролика не меняется.
 */
export function transitionAt(t: Timeline, T: number): { index: number; type: TransitionType; p: number; cut: number; half: number } | null {
  const starts = clipStarts(t);
  for (let i = 1; i < t.clips.length; i++) {
    const c = t.clips[i];
    if (!isBlend(c)) continue;
    const half = Math.min(transitionLen(c) / 2, clipLen(c) / 2, clipLen(t.clips[i - 1]) / 2);
    const cut = starts[i];
    if (T >= cut - half && T < cut + half) return { index: i, type: c.transition!, p: (T - (cut - half)) / (2 * half), cut, half };
  }
  return null;
}

/** Громкость звука клипа i в момент T с учётом переходов на его краях */
export function clipEdgeGain(t: Timeline, i: number, T: number): number {
  const starts = clipStarts(t);
  const start = starts[i];
  const end = start + clipLen(t.clips[i]);
  let g = 1;
  const c = t.clips[i];
  const next = t.clips[i + 1];
  if (i > 0 && hasTransition(c)) {
    const half = transitionLen(c) / 2;
    // Через цвет: звук уходит в тишину; «картинка в картинку» — плавная смена звука
    if (isDip(c.transition)) {
      if (T < start + half) g = Math.min(g, (T - start) / half);
    } else g = Math.min(g, (T - (start - half)) / (2 * half));
  }
  if (next && hasTransition(next)) {
    const half = transitionLen(next) / 2;
    if (isDip(next.transition)) {
      if (T > end - half) g = Math.min(g, (end - T) / half);
    } else g = Math.min(g, (end + half - T) / (2 * half));
  }
  return Math.max(0, Math.min(1, g));
}

/** Громкость фонограммы проекта в момент T (только плавные начало и конец) */
export function projectFadeGain(t: Timeline, T: number): number {
  const total = totalDuration(t);
  let g = 1;
  if (t.fadeIn && T < FADE) g = Math.min(g, T / FADE);
  if (t.fadeOut && T > total - FADE) g = Math.min(g, (total - T) / FADE);
  return Math.max(0, g);
}

/* ---------------- Звуковые дорожки ---------------- */
export const audioSpeed = (a: AudioItem) => a.speed || 1;
/** Длительность звука на шкале */
export const audioLen = (a: AudioItem) => Math.max(0, (a.out - a.in) / audioSpeed(a));
export const audioEnd = (a: AudioItem) => a.start + audioLen(a);

/** Огибающая громкости (без общей громкости) в момент T: появление и затухание */
export function audioFadeGain(a: AudioItem, T: number): number {
  const len = audioLen(a);
  const x = T - a.start;
  if (x < 0 || x > len) return 0;
  let g = 1;
  const fi = Math.min(a.fadeIn, len / 2);
  const fo = Math.min(a.fadeOut, len / 2);
  if (fi > 0 && x < fi) g = Math.min(g, x / fi);
  if (fo > 0 && x > len - fo) g = Math.min(g, (len - x) / fo);
  return Math.max(0, Math.min(1, g));
}

/** Раскладка по строкам, чтобы перекрывающиеся элементы не налезали друг на друга */
export function packLanes<T extends { id: string }>(items: T[], span: (x: T) => [number, number]): Map<string, number> {
  const sorted = items.slice().sort((a, b) => span(a)[0] - span(b)[0]);
  const ends: number[] = [];
  const out = new Map<string, number>();
  for (const it of sorted) {
    const [s, e] = span(it);
    let lane = ends.findIndex((end) => end <= s + 1e-3);
    if (lane < 0) {
      lane = ends.length;
      ends.push(e);
    } else ends[lane] = e;
    out.set(it.id, lane);
  }
  return out;
}

/* ---------------- Операции ---------------- */
/** Какой клип звучит в момент T и где это в исходнике */
export function locate(t: Timeline, T: number): { index: number; start: number; local: number } | null {
  if (!t.clips.length) return null;
  let acc = 0;
  for (let i = 0; i < t.clips.length; i++) {
    const len = clipLen(t.clips[i]);
    if (T < acc + len || i === t.clips.length - 1) {
      const within = Math.min(Math.max(0, T - acc), len);
      return { index: i, start: acc, local: srcAt(t.clips[i], within) };
    }
    acc += len;
  }
  return null;
}

const mapClips = (t: Timeline, fn: (c: Clip[]) => Clip[]): Timeline => ({ ...t, clips: fn(t.clips) });

/** Разрезать клип в точке T. Возвращает null, если резать слишком близко к краю. */
export function splitAt(t: Timeline, T: number, newId: () => string): Timeline | null {
  const loc = locate(t, T);
  if (!loc) return null;
  const c = t.clips[loc.index];
  const tau = T - loc.start;
  if (tau < MIN_CLIP || clipLen(c) - tau < MIN_CLIP) return null;
  const a: Clip = { ...c, out: loc.local };
  const b: Clip = { ...c, id: newId(), in: loc.local, transition: 'none' };
  return mapClips(t, (cl) => [...cl.slice(0, loc.index), a, b, ...cl.slice(loc.index + 1)]);
}

export function trimClip(t: Timeline, id: string, edge: 'in' | 'out', value: number, srcDuration: number): Timeline {
  return mapClips(t, (cl) =>
    cl.map((c) => {
      if (c.id !== id) return c;
      const m = MIN_CLIP * speedOf(c);
      if (edge === 'in') return { ...c, in: Math.min(Math.max(0, value), c.out - m) };
      return { ...c, out: Math.max(Math.min(srcDuration, value), c.in + m) };
    }),
  );
}

export function moveClip(t: Timeline, from: number, to: number): Timeline {
  if (from === to || to < 0 || to >= t.clips.length) return t;
  return mapClips(t, (cl) => {
    const next = cl.slice();
    const [c] = next.splice(from, 1);
    next.splice(to, 0, c);
    // У первого клипа перехода нет
    if (next[0]?.transition && next[0].transition !== 'none') next[0] = { ...next[0], transition: 'none' };
    return next;
  });
}

export function removeClip(t: Timeline, id: string): Timeline {
  return mapClips(t, (cl) => cl.filter((c) => c.id !== id));
}

/** Можно ли склеить клип со следующим обратно в один (после разрезания) */
export function canMergeNext(t: Timeline, index: number): boolean {
  const a = t.clips[index];
  const b = t.clips[index + 1];
  return !!a && !!b && a.src === b.src && Math.abs(a.out - b.in) < 0.02 && speedOf(a) === speedOf(b) && !hasTransition(b);
}

export function mergeNext(t: Timeline, index: number): Timeline {
  if (!canMergeNext(t, index)) return t;
  const a = t.clips[index];
  const b = t.clips[index + 1];
  return mapClips(t, (cl) => [...cl.slice(0, index), { ...a, out: b.out }, ...cl.slice(index + 2)]);
}

export function duplicateClip(t: Timeline, id: string, newId: () => string): { timeline: Timeline; id: string } {
  const i = t.clips.findIndex((c) => c.id === id);
  if (i < 0) return { timeline: t, id };
  const copy: Clip = { ...t.clips[i], id: newId() };
  return { timeline: mapClips(t, (cl) => [...cl.slice(0, i + 1), copy, ...cl.slice(i + 1)]), id: copy.id };
}

export function updateClip(t: Timeline, id: string, patch: Partial<Clip>): Timeline {
  return mapClips(t, (cl) => cl.map((c) => (c.id === id ? { ...c, ...patch } : c)));
}

export function updateText(t: Timeline, id: string, patch: Partial<VideoText>): Timeline {
  return { ...t, texts: t.texts.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}

export function updateAudio(t: Timeline, id: string, patch: Partial<AudioItem>): Timeline {
  return { ...t, audios: t.audios.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}

export function updateOverlay(t: Timeline, id: string, patch: Partial<Overlay>): Timeline {
  return { ...t, overlays: t.overlays.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}

export function updateMarker(t: Timeline, id: string, patch: Partial<Marker>): Timeline {
  return { ...t, markers: t.markers.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}

/** Сдвинуть надпись по времени (слова субтитра едут вместе с ней) */
export function shiftText(x: VideoText, start: number): VideoText {
  const d = start - x.start;
  return { ...x, start, end: x.end + d, words: x.words?.map((w) => ({ ...w, s: w.s + d, e: w.e + d })) };
}

/** Растянуть/сжать надпись: слова субтитра сохраняют свои доли внутри фразы */
export function retimeText(x: VideoText, start: number, end: number): VideoText {
  const k = (end - start) / Math.max(1e-3, x.end - x.start);
  const map = (v: number) => start + (v - x.start) * k;
  return { ...x, start, end, words: x.words?.map((w) => ({ ...w, s: map(w.s), e: map(w.e) })) };
}

/** Текст изменили вручную — слова получают время пропорционально длине, если их число поменялось */
export function rewordText(x: VideoText, text: string): VideoText {
  if (!x.words?.length) return { ...x, text };
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === x.words.length) return { ...x, text, words: x.words.map((w, i) => ({ ...w, w: words[i] })) };
  if (!words.length) return { ...x, text, words: [] };
  const s0 = x.words[0].s;
  const e0 = x.words[x.words.length - 1].e;
  const chars = words.reduce((a, w) => a + w.length + 1, 0);
  let acc = s0;
  const timed = words.map((w) => {
    const d = ((e0 - s0) * (w.length + 1)) / chars;
    const r = { w, s: acc, e: acc + d };
    acc += d;
    return r;
  });
  return { ...x, text, words: timed };
}

/** Надписи, наложения и ключи не должны выходить за конец ролика после обрезки клипов */
export function clampToDuration(t: Timeline): Timeline {
  const d = totalDuration(t);
  let changed = false;
  const texts = t.texts.map((x) => {
    if (x.end <= d + 1e-6) return x;
    changed = true;
    const len = Math.min(x.end - x.start, d);
    const moved = shiftText(x, Math.max(0, d - len));
    return moved.end > d ? retimeText(moved, moved.start, d) : moved;
  });
  const overlays = t.overlays.map((o) => {
    if (o.end <= d + 1e-6) return o;
    changed = true;
    const len = Math.min(o.end - o.start, d);
    return { ...o, start: Math.max(0, d - len), end: d };
  });
  const markers = t.markers.map((m) => {
    if (m.end <= d + 1e-6) return m;
    changed = true;
    return { ...m, start: Math.min(m.start, Math.max(0, d - 0.1)), end: d };
  });
  return changed ? { ...t, texts, overlays, markers } : t;
}
/** Совместимость со старым кодом */
export const clampTexts = clampToDuration;

/** Все исходники, на которые ссылается монтаж */
export function usedSources(t: Timeline): Set<string> {
  const s = new Set<string>();
  t.clips.forEach((c) => s.add(c.src));
  t.audios.forEach((a) => s.add(a.src));
  t.overlays.forEach((o) => s.add(o.src));
  return s;
}
