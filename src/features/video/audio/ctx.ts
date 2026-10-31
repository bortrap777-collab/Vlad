/**
 * Один AudioContext на всё приложение: звук клипов (через <video>), музыка и звуки (буферы).
 * Создаётся и «размораживается» только по нажатию пользователя (требование iOS).
 */
let ctx: AudioContext | null = null;
let failed = false;

export function audioCtx(): AudioContext | null {
  return ctx;
}

/** Вызывать синхронно внутри обработчика нажатия */
export function unlockAudio(): AudioContext | null {
  if (failed) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) {
        failed = true;
        return null;
      }
      ctx = new AC({ latencyHint: 'interactive' });
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => undefined);
    // iOS: короткий беззвучный буфер окончательно включает вывод звука
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
    return ctx;
  } catch {
    failed = true;
    return null;
  }
}

export function decodeAudio(c: BaseAudioContext, buf: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // Старый Safari понимает только вариант с колбэками
    const p = c.decodeAudioData(buf, resolve, reject);
    if (p && typeof (p as Promise<AudioBuffer>).then === 'function') (p as Promise<AudioBuffer>).then(resolve, reject);
  });
}
