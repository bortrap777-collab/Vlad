/**
 * Сведение звука монтажа в один буфер (OfflineAudioContext — быстрее реального времени).
 * Клипы: звук исходника на своём месте шкалы (скорость, плавный разгон, переходы).
 * Музыка и звуки: те же обрезка, затухания, скорость, тон и эхо, что в предпросмотре.
 */
import type { Timeline } from '../model';
import { FADE, clipLen, clipStarts, hasTransition, isDip, rateCurve, transitionLen } from '../model';
import { totalDuration } from '../model';
import { decodeAudio } from '../audio/ctx';
import { reverbImpulse } from '../audio/dsp';
import { scheduleAudio } from '../audio/graph';
import { impulseBuffer, processedSource } from '../audio/process';

export const MIX_RATE = 48000;

export interface MixResult {
  buffer: AudioBuffer | null;
  /** Исходники, звук которых не удалось извлечь (нет звуковой дорожки или формат) */
  failed: string[];
}

type OfflineCtor = typeof OfflineAudioContext;

function offlineCtor(): OfflineCtor | null {
  const w = window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null;
}

export interface MixOptions {
  /** Частота дискретизации (по умолчанию 48 кГц) */
  rate?: number;
  /** 1 — моно (для распознавания речи), 2 — стерео */
  channels?: number;
  /** Включать музыку и звуки (для распознавания речи — нет) */
  music?: boolean;
}

export async function mixAudio(
  timeline: Timeline,
  readSource: (id: string) => Promise<Blob>,
  signal: AbortSignal,
  onProgress: (v: number) => void,
  opts: MixOptions = {},
): Promise<MixResult> {
  const rate = opts.rate ?? MIX_RATE;
  const withMusic = opts.music ?? true;
  const total = totalDuration(timeline);
  const Offline = offlineCtor();
  if (!Offline || total <= 0) return { buffer: null, failed: [] };

  const needed = new Set<string>();
  timeline.clips.forEach((c) => c.volume > 0 && needed.add(c.src));
  timeline.overlays.forEach((o) => o.volume > 0 && needed.add(o.src));
  const audios = withMusic ? timeline.audios.filter((a) => a.volume > 0) : [];
  if (!needed.size && !audios.length) return { buffer: null, failed: [] };

  const frames = Math.ceil(total * rate);
  const ctx = new Offline(opts.channels ?? 2, frames, rate);
  const decoded = new Map<string, AudioBuffer>();
  const failed: string[] = [];
  const jobs = needed.size + audios.length;
  let n = 0;
  for (const id of needed) {
    if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
    try {
      const blob = await readSource(id);
      decoded.set(id, await decodeAudio(ctx, await blob.arrayBuffer()));
    } catch {
      failed.push(id);
    }
    onProgress((++n / jobs) * 0.7);
  }
  // Музыка и звуки: та же обработка (скорость, тон), что слышна в редакторе
  const processed = new Map<string, AudioBuffer>();
  for (const a of audios) {
    if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
    try {
      processed.set(a.id, await processedSource(a.src, () => readSource(a.src), rate, a.speed ?? 1, a.pitch ?? 0));
    } catch {
      failed.push(a.src);
    }
    onProgress((++n / jobs) * 0.7);
  }
  if (!decoded.size && !processed.size) return { buffer: null, failed };

  // Общая шина: плавные начало и конец ролика действуют на весь звук
  const master = ctx.createGain();
  master.connect(ctx.destination);
  if (timeline.fadeIn) {
    master.gain.setValueAtTime(0, 0);
    master.gain.linearRampToValueAtTime(1, Math.min(FADE, total));
  }
  if (timeline.fadeOut && total > FADE) {
    master.gain.setValueAtTime(1, total - FADE);
    master.gain.linearRampToValueAtTime(0, total);
  }

  const starts = clipStarts(timeline);
  timeline.clips.forEach((c, i) => {
    const buf = decoded.get(c.src);
    if (!buf || c.volume <= 0 || c.in >= buf.duration) return;
    const start = starts[i];
    const len = clipLen(c);
    const end = start + len;
    const next = timeline.clips[i + 1];
    // «Картинка в картинку»: звук клипа заходит раньше / длится дольше на половину перехода — плавная смена
    const pre = i > 0 && hasTransition(c) && !isDip(c.transition) ? Math.min(transitionLen(c) / 2, c.in) : 0;
    const post = next && hasTransition(next) && !isDip(next.transition) ? Math.min(transitionLen(next) / 2, Math.max(0, buf.duration - c.out)) : 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Скорость: постоянная или плавный разгон/торможение — как в предпросмотре
    const curve = rateCurve(c);
    src.playbackRate.setValueAtTime(curve[0].rate, Math.max(0, start - pre));
    for (const p of curve.slice(1)) src.playbackRate.linearRampToValueAtTime(p.rate, start + p.tau);
    const g = ctx.createGain();
    g.gain.setValueAtTime(c.volume, Math.max(0, start - pre));
    if (i > 0 && hasTransition(c)) {
      const half = transitionLen(c) / 2;
      if (isDip(c.transition)) {
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(c.volume, start + half);
      } else {
        g.gain.setValueAtTime(0, Math.max(0, start - pre));
        g.gain.linearRampToValueAtTime(c.volume, start + half);
      }
    }
    if (next && hasTransition(next)) {
      const half = transitionLen(next) / 2;
      if (isDip(next.transition)) {
        g.gain.setValueAtTime(c.volume, Math.max(start, end - half));
        g.gain.linearRampToValueAtTime(0, end);
      } else {
        g.gain.setValueAtTime(c.volume, Math.max(start, end - half));
        g.gain.linearRampToValueAtTime(0, end + post);
      }
    }
    src.connect(g).connect(master);
    // Длительность — в секундах исходника, поэтому скорость учитывается сама
    src.start(Math.max(0, start - pre), c.in - pre * (curve[0].rate || 1), Math.min(c.out, buf.duration) - c.in + pre * (curve[0].rate || 1) + post * (curve[curve.length - 1].rate || 1));
  });

  // Звук наложений-видео
  for (const o of timeline.overlays) {
    const buf = decoded.get(o.src);
    if (!buf || o.volume <= 0) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = o.volume;
    src.connect(g).connect(master);
    if (o.in < buf.duration) src.start(o.start, o.in, Math.min(o.end - o.start, buf.duration - o.in));
  }

  if (audios.length) {
    const impulse = audios.some((a) => (a.reverb ?? 0) > 0) ? impulseBuffer(ctx, reverbImpulse(rate)) : null;
    for (const a of audios) {
      const buf = processed.get(a.id);
      if (buf) scheduleAudio(ctx, master, a, buf, 0, 0, impulse);
    }
  }

  const buffer = await ctx.startRendering();
  onProgress(1);
  // Ограничитель: при громкости >100 % не даём сигналу «рваться»
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      if (x > 1) d[i] = 1;
      else if (x < -1) d[i] = -1;
    }
  }
  return { buffer, failed };
}
