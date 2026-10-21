/**
 * Сведение звука монтажа в один стерео-буфер (OfflineAudioContext — быстрее реального времени).
 * Клипы: звук исходника на своём месте шкалы с громкостью клипа. Музыка: с начала ролика.
 */
import type { Timeline } from '../model';
import { clipLen, clipStarts, totalDuration } from '../model';

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

function decode(ctx: BaseAudioContext, buf: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // Старый Safari понимает только вариант с колбэками
    const p = ctx.decodeAudioData(buf, resolve, reject);
    if (p && typeof (p as Promise<AudioBuffer>).then === 'function') (p as Promise<AudioBuffer>).then(resolve, reject);
  });
}

export async function mixAudio(
  timeline: Timeline,
  readSource: (id: string) => Promise<Blob>,
  signal: AbortSignal,
  onProgress: (v: number) => void,
): Promise<MixResult> {
  const total = totalDuration(timeline);
  const Offline = offlineCtor();
  if (!Offline || total <= 0) return { buffer: null, failed: [] };

  const needed = new Set<string>();
  timeline.clips.forEach((c) => c.volume > 0 && needed.add(c.src));
  if (timeline.music && timeline.music.volume > 0) needed.add(timeline.music.src);
  if (!needed.size) return { buffer: null, failed: [] };

  const frames = Math.ceil(total * MIX_RATE);
  const ctx = new Offline(2, frames, MIX_RATE);
  const decoded = new Map<string, AudioBuffer>();
  const failed: string[] = [];
  let n = 0;
  for (const id of needed) {
    if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
    try {
      const blob = await readSource(id);
      decoded.set(id, await decode(ctx, await blob.arrayBuffer()));
    } catch {
      failed.push(id);
    }
    onProgress((++n / needed.size) * 0.7);
  }
  if (!decoded.size) return { buffer: null, failed };

  const starts = clipStarts(timeline);
  timeline.clips.forEach((c, i) => {
    const buf = decoded.get(c.src);
    if (!buf || c.volume <= 0 || c.in >= buf.duration) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = c.volume;
    src.connect(g).connect(ctx.destination);
    src.start(starts[i], c.in, Math.min(clipLen(c), buf.duration - c.in));
  });
  const m = timeline.music;
  const mb = m ? decoded.get(m.src) : undefined;
  if (m && mb && m.volume > 0) {
    const src = ctx.createBufferSource();
    src.buffer = mb;
    const g = ctx.createGain();
    g.gain.value = m.volume;
    // Мягкое затухание в конце ролика, если музыка длиннее
    const end = Math.min(total, mb.duration);
    if (mb.duration > total && total > 1.5) {
      g.gain.setValueAtTime(m.volume, total - 1);
      g.gain.linearRampToValueAtTime(0, total);
    }
    src.connect(g).connect(ctx.destination);
    src.start(0, 0, end);
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
