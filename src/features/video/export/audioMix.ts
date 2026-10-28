/**
 * Сведение звука монтажа в один стерео-буфер (OfflineAudioContext — быстрее реального времени).
 * Клипы: звук исходника на своём месте шкалы с громкостью клипа. Музыка: с начала ролика.
 */
import type { Timeline } from '../model';
import { FADE, MUSIC_FADE, clipLen, clipStarts, isDip, speedOf, totalDuration, transitionLen } from '../model';

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

export interface MixOptions {
  /** Частота дискретизации (по умолчанию 48 кГц) */
  rate?: number;
  /** 1 — моно (для распознавания речи), 2 — стерео */
  channels?: number;
  /** Включать музыку (для распознавания речи — нет) */
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
  if (withMusic && timeline.music && timeline.music.volume > 0) needed.add(timeline.music.src);
  if (!needed.size) return { buffer: null, failed: [] };

  const frames = Math.ceil(total * rate);
  const ctx = new Offline(opts.channels ?? 2, frames, rate);
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
    const sp = speedOf(c);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = sp;
    const g = ctx.createGain();
    const start = starts[i];
    const end = start + clipLen(c);
    g.gain.setValueAtTime(c.volume, start);
    // Переход «через цвет»: звук клипа уходит в тишину и возвращается вместе с картинкой
    const next = timeline.clips[i + 1];
    if (isDip(c.transition) && i > 0) {
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(c.volume, start + transitionLen(c) / 2);
    }
    if (next && isDip(next.transition)) {
      g.gain.setValueAtTime(c.volume, Math.max(start, end - transitionLen(next) / 2));
      g.gain.linearRampToValueAtTime(0, end);
    }
    src.connect(g).connect(master);
    // duration — в секундах исходника, поэтому скорость учитывается сама
    src.start(start, c.in, Math.min(c.out, buf.duration) - c.in);
  });
  const m = withMusic ? timeline.music : null;
  const mb = m ? decoded.get(m.src) : undefined;
  if (m && mb && m.volume > 0) {
    const off = Math.min(m.offset ?? 0, Math.max(0, mb.duration - 0.1));
    const end = Math.min(total, mb.duration - off);
    const src = ctx.createBufferSource();
    src.buffer = mb;
    const g = ctx.createGain();
    g.gain.setValueAtTime(m.fadeIn ? 0 : m.volume, 0);
    if (m.fadeIn) g.gain.linearRampToValueAtTime(m.volume, Math.min(MUSIC_FADE, end));
    // Затухание: по выбору — 1,5 с; если трек длиннее ролика — последняя секунда
    const outLen = m.fadeOut ? MUSIC_FADE : mb.duration - off > total ? 1 : 0;
    if (outLen > 0 && end > outLen) {
      g.gain.setValueAtTime(m.volume, end - outLen);
      g.gain.linearRampToValueAtTime(0, end);
    }
    src.connect(g).connect(master);
    src.start(0, off, end);
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
