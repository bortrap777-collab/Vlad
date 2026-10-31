/**
 * Музыка и звуки при воспроизведении: буферы Web Audio, а не <audio>.
 * Звук начинается точно в нужный момент шкалы, без задержек перемотки и без «плавания»;
 * обрезка, затухания, скорость, тон и эхо — те же, что в экспорте.
 */
import { audioEnd, projectFadeGain, totalDuration, FADE, type AudioItem, type Timeline } from '../model';
import { audioCtx } from './ctx';
import { reverbImpulse } from './dsp';
import { automate, scheduleAudio, type Scheduled } from './graph';
import { impulseBuffer, processKey, processedSource, retainProcessed } from './process';

type Status = { busy: number; error: string | null };

export class AudioEngine {
  private timeline: Timeline | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private wanted = new Map<string, string>();
  private live: Scheduled[] = [];
  private master: GainNode | null = null;
  private impulse: AudioBuffer | null = null;
  private anchor: { T: number; at: number } | null = null;
  private busy = new Set<string>();
  private error: string | null = null;
  onStatus: ((s: Status) => void) | null = null;

  constructor(private read: (id: string) => Promise<Blob>) {}

  private emit() {
    this.onStatus?.({ busy: this.busy.size, error: this.error });
  }

  private rate(): number {
    return audioCtx()?.sampleRate ?? 48000;
  }

  /** Монтаж изменился: готовим звук новых/изменённых дорожек; при воспроизведении — перезапуск */
  setTimeline(t: Timeline): void {
    const prev = this.timeline;
    this.timeline = t;
    const rate = this.rate();
    const keys = new Set<string>();
    for (const a of t.audios) {
      const key = processKey(a.src, rate, a.speed ?? 1, a.pitch ?? 0);
      keys.add(key);
      this.wanted.set(a.id, key);
      if (this.buffers.has(key) || this.busy.has(key)) continue;
      this.busy.add(key);
      this.emit();
      processedSource(a.src, () => this.read(a.src), rate, a.speed ?? 1, a.pitch ?? 0)
        .then((buf) => {
          this.buffers.set(key, buf);
          this.error = null;
          // Пока считали, уже играем — подключаем дорожку с текущего места
          if (this.anchor) this.restart();
        })
        .catch(() => {
          this.error = 'Не удалось прочитать звук файла. Возможно, формат не поддерживается.';
        })
        .finally(() => {
          this.busy.delete(key);
          this.emit();
        });
    }
    for (const k of [...this.buffers.keys()]) if (!keys.has(k)) this.buffers.delete(k);
    retainProcessed(keys);
    if (this.anchor && prev && audioChanged(prev, t)) this.restart();
  }

  private bufferFor(a: AudioItem): AudioBuffer | undefined {
    const k = this.wanted.get(a.id);
    return k ? this.buffers.get(k) : undefined;
  }

  /** Текущее время шкалы по часам звука */
  now(): number | null {
    const ctx = audioCtx();
    if (!this.anchor || !ctx) return null;
    return this.anchor.T + (ctx.currentTime - this.anchor.at);
  }

  start(T: number): void {
    const ctx = audioCtx();
    const t = this.timeline;
    this.stopNodes();
    if (!ctx || !t) return;
    const at = ctx.currentTime + 0.005;
    this.anchor = { T, at };
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
    }
    // Плавные начало/конец всего ролика
    const total = totalDuration(t);
    const pts: [number, number][] = [];
    if (t.fadeIn) pts.push([FADE, 1]);
    if (t.fadeOut) pts.push([total - FADE, 1], [total, 0]);
    automate(this.master.gain, pts.sort((a, b) => a[0] - b[0]), T, at, (x) => projectFadeGain(t, x));

    if (t.audios.some((a) => (a.reverb ?? 0) > 0) && (!this.impulse || this.impulse.sampleRate !== ctx.sampleRate)) {
      this.impulse = impulseBuffer(ctx, reverbImpulse(ctx.sampleRate));
    }
    for (const a of t.audios) {
      if (audioEnd(a) <= T) continue;
      const buf = this.bufferFor(a);
      if (!buf) continue;
      const s = scheduleAudio(ctx, this.master, a, buf, T, at, this.impulse);
      if (s) this.live.push(s);
    }
  }

  private restart() {
    const T = this.now();
    if (T !== null) this.start(T);
  }

  /** Сверка с часами плеера: звук разошёлся больше чем на 60 мс — перезапуск с нужного места */
  check(T: number): void {
    const n = this.now();
    if (n !== null && Math.abs(n - T) > 0.06) this.start(T);
  }

  private stopNodes() {
    this.live.forEach((s) => s.stop());
    this.live = [];
  }

  stop(): void {
    this.stopNodes();
    this.anchor = null;
  }

  get playing(): boolean {
    return !!this.anchor;
  }
}

/** Изменилось ли что-то, что влияет на звук дорожек */
function audioChanged(a: Timeline, b: Timeline): boolean {
  if (a.audios !== b.audios) return true;
  if (a.fadeIn !== b.fadeIn || a.fadeOut !== b.fadeOut) return true;
  return !!b.fadeOut && Math.abs(totalDuration(a) - totalDuration(b)) > 1e-3;
}
