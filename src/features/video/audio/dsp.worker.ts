/// <reference lib="webworker" />
/** Обработка звука в фоне: интерфейс не подвисает, пока считается скорость и тон. */
import { changeSpeedPitch } from './dsp';

self.onmessage = (e: MessageEvent<{ id: number; channels: Float32Array[]; speed: number; pitch: number; rate: number }>) => {
  const { id, channels, speed, pitch, rate } = e.data;
  try {
    const out = changeSpeedPitch(channels, speed, pitch, rate, (v) => (self as unknown as Worker).postMessage({ id, progress: v }));
    (self as unknown as Worker).postMessage({ id, done: out }, out.map((c) => c.buffer));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
