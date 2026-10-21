import { useCallback, useRef, useState } from 'react';

/**
 * История для отмены/повтора.
 *  - apply(fn)        — обычное действие, попадает в историю;
 *  - live(fn)         — промежуточный шаг жеста (перетаскивание), в историю не пишется;
 *  - endGesture()     — завершить жест: в историю попадает состояние до его начала.
 */
const LIMIT = 80;

export function useHistory<T>(initial: T) {
  const [h, setH] = useState<{ past: T[]; present: T; future: T[] }>({ past: [], present: initial, future: [] });
  const gestureStart = useRef<T | null>(null);

  const apply = useCallback((fn: (s: T) => T) => {
    setH((cur) => {
      const next = fn(cur.present);
      if (next === cur.present) return cur;
      const base = gestureStart.current ?? cur.present;
      gestureStart.current = null;
      return { past: [...cur.past, base].slice(-LIMIT), present: next, future: [] };
    });
  }, []);

  const live = useCallback((fn: (s: T) => T) => {
    setH((cur) => {
      if (gestureStart.current === null) gestureStart.current = cur.present;
      const next = fn(cur.present);
      return next === cur.present ? cur : { ...cur, present: next };
    });
  }, []);

  const endGesture = useCallback(() => {
    setH((cur) => {
      const start = gestureStart.current;
      gestureStart.current = null;
      if (start === null || start === cur.present) return cur;
      return { past: [...cur.past, start].slice(-LIMIT), present: cur.present, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    gestureStart.current = null;
    setH((cur) => (cur.past.length ? { past: cur.past.slice(0, -1), present: cur.past[cur.past.length - 1], future: [cur.present, ...cur.future] } : cur));
  }, []);

  const redo = useCallback(() => {
    gestureStart.current = null;
    setH((cur) => (cur.future.length ? { past: [...cur.past, cur.present], present: cur.future[0], future: cur.future.slice(1) } : cur));
  }, []);

  const reset = useCallback((v: T) => {
    gestureStart.current = null;
    setH({ past: [], present: v, future: [] });
  }, []);

  return {
    state: h.present,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    apply,
    live,
    endGesture,
    undo,
    redo,
    reset,
  };
}
