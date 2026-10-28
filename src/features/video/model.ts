/**
 * Модель видеомонтажа. Неизменяемые операции: каждая возвращает новый Timeline,
 * поэтому история отмены — просто список состояний.
 */
import { DEFAULT_EDITS, type PhotoEdits, type TextLayer } from '../photo/pipeline';

export interface SourceMeta {
  id: string;
  kind: 'video' | 'audio';
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
  /** Скорость: 0.25…4 (по умолчанию 1) */
  speed?: number;
  look?: ClipLook;
  /** Переход от предыдущего клипа к этому */
  transition?: TransitionType;
  /** Длительность перехода, секунды (по умолчанию 0,6) */
  transitionDuration?: number;
}

export type TransitionType = 'none' | 'fade' | 'white' | 'dissolve' | 'slideleft' | 'slideup' | 'wipe' | 'zoom' | 'circle';

export const TRANSITIONS: { id: TransitionType; label: string }[] = [
  { id: 'none', label: 'Без перехода' },
  { id: 'dissolve', label: 'Растворение' },
  { id: 'fade', label: 'Через чёрный' },
  { id: 'white', label: 'Вспышка' },
  { id: 'slideleft', label: 'Сдвиг' },
  { id: 'slideup', label: 'Вверх' },
  { id: 'wipe', label: 'Шторка' },
  { id: 'zoom', label: 'Наезд' },
  { id: 'circle', label: 'Круг' },
];

/** Переход «через цвет»: картинка уходит в чёрный/белый и звук тоже */
export const isDip = (t: TransitionType | undefined) => t === 'fade' || t === 'white';
export const hasTransition = (c: Clip) => !!c.transition && c.transition !== 'none';
export const transitionLen = (c: Clip) => c.transitionDuration ?? FADE;

export interface MusicTrack {
  id: string;
  src: string;
  volume: number;
  /** С какой секунды трека начинать */
  offset?: number;
  fadeIn?: boolean;
  fadeOut?: boolean;
}

export type FrameFormat = 'original' | '9:16' | '1:1' | '4:5' | '16:9';

export interface VideoText extends TextLayer {
  /** Время на шкале, секунды */
  start: number;
  end: number;
  /** Создан автоматически из речи (субтитры) */
  subtitle?: boolean;
}

export interface Timeline {
  clips: Clip[];
  music: MusicTrack | null;
  texts: VideoText[];
  format?: FrameFormat;
  /** Вписать видео в кадр (с фоном) или заполнить кадр (обрезая края) */
  fit?: 'fit' | 'fill';
  background?: 'blur' | 'black';
  /** Плавное появление в начале и затемнение в конце ролика */
  fadeIn?: boolean;
  fadeOut?: boolean;
}

/** Длительность затемнения (переходы, начало, конец), секунды */
export const FADE = 0.6;
export const MUSIC_FADE = 1.5;
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
export const FORMATS: { id: FrameFormat; label: string; ratio: number | null }[] = [
  { id: 'original', label: 'Оригинал', ratio: null },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

export const speedOf = (c: Clip) => c.speed || 1;

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

/**
 * Насколько кадр затемнён в момент T (0 — нет, 1 — чёрный):
 * переходы «затемнение» между клипами и плавные начало/конец ролика.
 */
export function blackoutAt(t: Timeline, T: number): number {
  const d = dipAt(t, T);
  return d.color === 'black' ? d.alpha : 0;
}

/** Заливка кадра цветом в момент T: плавные начало/конец (чёрный) и переходы «через цвет» */
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
 * Переход «картинка в картинку» в момент T (растворение, сдвиг, шторка…):
 * index — входящий клип, p — ход перехода 0…1, cut — время стыка.
 * Вокруг стыка уходящий клип держит последний кадр, входящий — первый,
 * поэтому длина ролика не меняется.
 */
export function transitionAt(t: Timeline, T: number): { index: number; type: TransitionType; p: number; cut: number } | null {
  const starts = clipStarts(t);
  for (let i = 1; i < t.clips.length; i++) {
    const c = t.clips[i];
    if (!hasTransition(c) || isDip(c.transition)) continue;
    const half = transitionLen(c) / 2;
    const cut = starts[i];
    if (T >= cut - half && T < cut + half) return { index: i, type: c.transition!, p: (T - (cut - half)) / (2 * half), cut };
  }
  return null;
}

/** Громкость звука клипа i в момент T с учётом затемнений на его краях */
export function clipEdgeGain(t: Timeline, i: number, T: number): number {
  const starts = clipStarts(t);
  const start = starts[i];
  const end = start + clipLen(t.clips[i]);
  let g = 1;
  const c = t.clips[i];
  const next = t.clips[i + 1];
  if (isDip(c.transition) && i > 0 && T < start + transitionLen(c) / 2) g = Math.min(g, (T - start) / (transitionLen(c) / 2));
  if (next && isDip(next.transition) && T > end - transitionLen(next) / 2) g = Math.min(g, (end - T) / (transitionLen(next) / 2));
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

/**
 * Множитель громкости музыки в момент T: её плавное появление и затухание.
 * Если трек длиннее ролика, в последнюю секунду он затихает сам — без обрыва.
 */
export function musicFadeGain(t: Timeline, T: number, trackDuration: number): number {
  const m = t.music;
  if (!m) return 0;
  const off = m.offset ?? 0;
  const end = Math.min(totalDuration(t), trackDuration - off);
  let g = 1;
  if (m.fadeIn && T < MUSIC_FADE) g = Math.min(g, T / MUSIC_FADE);
  const outLen = m.fadeOut ? MUSIC_FADE : trackDuration - off > totalDuration(t) ? 1 : 0;
  if (outLen > 0 && T > end - outLen) g = Math.min(g, (end - T) / outLen);
  return Math.max(0, Math.min(1, g));
}

export const MIN_CLIP = 0.3;
export const EMPTY_TIMELINE: Timeline = { clips: [], music: null, texts: [] };

/** Длительность клипа на шкале (с учётом скорости) */
export const clipLen = (c: Clip) => (c.out - c.in) / speedOf(c);

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

/** Какой клип звучит в момент T и где это в исходнике */
export function locate(t: Timeline, T: number): { index: number; start: number; local: number } | null {
  if (!t.clips.length) return null;
  let acc = 0;
  for (let i = 0; i < t.clips.length; i++) {
    const len = clipLen(t.clips[i]);
    if (T < acc + len || i === t.clips.length - 1) {
      const within = Math.min(Math.max(0, T - acc), len);
      return { index: i, start: acc, local: t.clips[i].in + within * speedOf(t.clips[i]) };
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
  const m = MIN_CLIP * speedOf(c);
  if (loc.local - c.in < m || c.out - loc.local < m) return null;
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

/** Тексты не должны выходить за конец ролика после обрезки клипов */
export function clampTexts(t: Timeline): Timeline {
  const d = totalDuration(t);
  if (!t.texts.length) return t;
  let changed = false;
  const texts = t.texts.map((x) => {
    if (x.end <= d) return x;
    changed = true;
    const len = Math.min(x.end - x.start, d);
    const end = d;
    return { ...x, start: Math.max(0, end - len), end };
  });
  return changed ? { ...t, texts } : t;
}
