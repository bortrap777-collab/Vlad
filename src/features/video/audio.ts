/**
 * Громкость через Web Audio. На iPhone свойство media.volume только для чтения,
 * поэтому каждый <video>/<audio> подключается к GainNode.
 * AudioContext создаётся и «размораживается» только по нажатию пользователя.
 */
type Ctx = AudioContext;

export class Mixer {
  private ctx: Ctx | null = null;
  private gains = new Map<HTMLMediaElement, GainNode>();
  private wanted = new Map<HTMLMediaElement, number>();
  failed = false;

  /** Вызывать синхронно внутри обработчика нажатия. */
  unlock(elements: HTMLMediaElement[]): void {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) {
          this.failed = true;
          return;
        }
        this.ctx = new AC();
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => undefined);
      elements.forEach((el) => this.attach(el));
    } catch {
      this.failed = true;
    }
  }

  private attach(el: HTMLMediaElement): void {
    if (!this.ctx || this.gains.has(el)) return;
    try {
      const src = this.ctx.createMediaElementSource(el);
      const g = this.ctx.createGain();
      g.gain.value = this.wanted.get(el) ?? 1;
      src.connect(g).connect(this.ctx.destination);
      this.gains.set(el, g);
    } catch {
      /* элемент уже подключён или браузер не дал — остаётся обычная громкость */
    }
  }

  setVolume(el: HTMLMediaElement | null | undefined, v: number): void {
    if (!el) return;
    this.wanted.set(el, v);
    const g = this.gains.get(el);
    if (g && this.ctx) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
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
