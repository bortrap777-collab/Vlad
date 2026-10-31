/**
 * Общее для предпросмотра и экспорта: как звуковая дорожка встаёт на шкалу.
 * Одинаковый код → в готовом видео звучит ровно то, что слышно в редакторе.
 */
import { audioFadeGain, audioLen, audioSpeed, type AudioItem } from '../model';

export interface Scheduled {
  stop: () => void;
}

/** Точки огибающей [время шкалы, значение] → автоматизация параметра с момента fromT (= время контекста at) */
export function automate(param: AudioParam, points: [number, number][], fromT: number, at: number, valueAt: (T: number) => number): void {
  const toCtx = (T: number) => at + (T - fromT);
  param.cancelScheduledValues(0);
  param.setValueAtTime(valueAt(fromT), at);
  for (const [T, v] of points) if (T > fromT + 1e-4) param.linearRampToValueAtTime(v, toCtx(T));
}

/**
 * Поставить дорожку a в контекст: звучит с момента шкалы fromT, который наступает во время контекста at.
 * buf — звук всего файла уже с нужными скоростью и тоном.
 */
export function scheduleAudio(ctx: BaseAudioContext, out: AudioNode, a: AudioItem, buf: AudioBuffer, fromT: number, at: number, impulse: AudioBuffer | null): Scheduled | null {
  const len = audioLen(a);
  const end = a.start + len;
  if (fromT >= end - 0.01 || a.volume <= 0) return null;
  const s = audioSpeed(a);
  const startT = Math.max(fromT, a.start);
  const offset = a.in / s + (startT - a.start);
  if (offset >= buf.duration) return null;
  const dur = Math.min(end - startT, buf.duration - offset);
  const ctxStart = at + (startT - fromT);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const env = ctx.createGain();
  const fi = Math.min(a.fadeIn, len / 2);
  const fo = Math.min(a.fadeOut, len / 2);
  const pts: [number, number][] = [];
  if (fi > 0) pts.push([a.start + fi, a.volume]);
  if (fo > 0) pts.push([end - fo, a.volume], [end, 0]);
  automate(env.gain, pts, startT, ctxStart, (T) => a.volume * audioFadeGain(a, T));
  src.connect(env);

  const r = Math.min(1, Math.max(0, a.reverb ?? 0));
  const nodes: AudioNode[] = [src, env];
  if (r > 0 && impulse) {
    const dry = ctx.createGain();
    dry.gain.value = 1 - r * 0.35;
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = r * 0.8;
    env.connect(dry).connect(out);
    env.connect(conv).connect(wet).connect(out);
    nodes.push(dry, conv, wet);
  } else env.connect(out);

  src.start(Math.max(ctxStart, 'currentTime' in ctx ? ctx.currentTime : 0), offset, dur);
  return {
    stop: () => {
      try {
        src.stop();
      } catch {
        /* уже остановлен */
      }
      nodes.forEach((n) => n.disconnect());
    },
  };
}
