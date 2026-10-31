/**
 * Громкость <video>/<audio> через Web Audio. На iPhone свойство media.volume только для чтения,
 * поэтому каждый элемент подключается к GainNode общего AudioContext.
 */
import { audioCtx, unlockAudio } from './audio/ctx';

export class Mixer {
  private gains = new Map<HTMLMediaElement, GainNode>();
  private wanted = new Map<HTMLMediaElement, number>();

  /** Вызывать синхронно внутри обработчика нажатия. */
  unlock(elements: HTMLMediaElement[]): void {
    const ctx = unlockAudio();
    if (!ctx) return;
    elements.forEach((el) => this.attach(ctx, el));
  }

  private attach(ctx: AudioContext, el: HTMLMediaElement): void {
    if (this.gains.has(el)) return;
    try {
      const src = ctx.createMediaElementSource(el);
      const g = ctx.createGain();
      g.gain.value = this.wanted.get(el) ?? 1;
      src.connect(g).connect(ctx.destination);
      this.gains.set(el, g);
    } catch {
      /* элемент уже подключён или браузер не дал — остаётся обычная громкость */
    }
  }

  setVolume(el: HTMLMediaElement | null | undefined, v: number): void {
    if (!el) return;
    if (Math.abs((this.wanted.get(el) ?? -1) - v) < 1e-3) return;
    this.wanted.set(el, v);
    const g = this.gains.get(el);
    const ctx = audioCtx();
    if (g && ctx) g.gain.setTargetAtTime(v, ctx.currentTime, 0.015);
    else {
      try {
        el.volume = Math.max(0, Math.min(1, v));
      } catch {
        /* iOS: только для чтения */
      }
    }
  }

  forget(el: HTMLMediaElement): void {
    this.gains.delete(el);
    this.wanted.delete(el);
  }
}
