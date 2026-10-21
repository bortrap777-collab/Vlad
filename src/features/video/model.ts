/**
 * Модель видеомонтажа. Неизменяемые операции: каждая возвращает новый Timeline,
 * поэтому история отмены — просто список состояний.
 */
import type { TextLayer } from '../photo/pipeline';

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

export interface Clip {
  id: string;
  src: string;
  /** Начало и конец фрагмента в секундах исходника */
  in: number;
  out: number;
  /** 0…2 (1 = 100 %) */
  volume: number;
}

export interface MusicTrack {
  id: string;
  src: string;
  volume: number;
}

export interface VideoText extends TextLayer {
  /** Время на шкале, секунды */
  start: number;
  end: number;
}

export interface Timeline {
  clips: Clip[];
  music: MusicTrack | null;
  texts: VideoText[];
}

export const MIN_CLIP = 0.3;
export const EMPTY_TIMELINE: Timeline = { clips: [], music: null, texts: [] };

export const clipLen = (c: Clip) => c.out - c.in;

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
      return { index: i, start: acc, local: t.clips[i].in + within };
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
  if (loc.local - c.in < MIN_CLIP || c.out - loc.local < MIN_CLIP) return null;
  const a: Clip = { ...c, out: loc.local };
  const b: Clip = { ...c, id: newId(), in: loc.local };
  return mapClips(t, (cl) => [...cl.slice(0, loc.index), a, b, ...cl.slice(loc.index + 1)]);
}

export function trimClip(t: Timeline, id: string, edge: 'in' | 'out', value: number, srcDuration: number): Timeline {
  return mapClips(t, (cl) =>
    cl.map((c) => {
      if (c.id !== id) return c;
      if (edge === 'in') return { ...c, in: Math.min(Math.max(0, value), c.out - MIN_CLIP) };
      return { ...c, out: Math.max(Math.min(srcDuration, value), c.in + MIN_CLIP) };
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
  return !!a && !!b && a.src === b.src && Math.abs(a.out - b.in) < 0.02;
}

export function mergeNext(t: Timeline, index: number): Timeline {
  if (!canMergeNext(t, index)) return t;
  const a = t.clips[index];
  const b = t.clips[index + 1];
  return mapClips(t, (cl) => [...cl.slice(0, index), { ...a, out: b.out }, ...cl.slice(index + 2)]);
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
