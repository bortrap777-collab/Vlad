import { useCallback, useEffect, useRef, useState } from 'react';
import { Mixer } from './audio';
import { clipStarts, locate, totalDuration, type Timeline } from './model';

/**
 * Воспроизведение монтажа без перекодирования: по одному <video> на исходный файл,
 * клипы играются по очереди (переход — перемотка нужного элемента), музыка — отдельный <audio>.
 * Время монтажа T вычисляется из currentTime активного элемента на каждом кадре.
 */
export function usePlayer(timeline: Timeline, onError: (msg: string) => void) {
  const tl = useRef(timeline);
  tl.current = timeline;
  const els = useRef(new Map<string, HTMLVideoElement>());
  const musicEl = useRef<HTMLAudioElement | null>(null);
  const mixer = useRef(new Mixer()).current;
  const playingRef = useRef(false);
  const idx = useRef(0);
  const tRef = useRef(0);
  const raf = useRef(0);
  const lastUi = useRef(0);
  const frameN = useRef(0);
  const listeners = useRef(new Set<(t: number) => void>());
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [activeSrc, setActiveSrc] = useState<string | null>(null);

  const report = useCallback((t: number, force = false) => {
    tRef.current = t;
    listeners.current.forEach((f) => f(t));
    const now = performance.now();
    if (force || now - lastUi.current > 66) {
      lastUi.current = now;
      setTime(t);
    }
  }, []);

  const syncMusic = useCallback(
    (T: number, play: boolean) => {
      const m = musicEl.current;
      const mt = tl.current.music;
      if (!m || !mt) return;
      mixer.setVolume(m, mt.volume);
      if (Number.isFinite(m.duration) && T < m.duration - 0.05) {
        if (Math.abs(m.currentTime - T) > 0.25) m.currentTime = T;
        if (play && m.paused) m.play().catch(() => undefined);
        if (!play && !m.paused) m.pause();
      } else if (!m.paused) m.pause();
    },
    [mixer],
  );

  const showAt = useCallback(
    (T: number) => {
      const t = tl.current;
      const d = totalDuration(t);
      const target = Math.min(Math.max(0, T), d);
      const loc = locate(t, target);
      if (!loc) {
        report(0, true);
        setActiveSrc(null);
        return null;
      }
      idx.current = loc.index;
      const c = t.clips[loc.index];
      const el = els.current.get(c.src);
      els.current.forEach((v, k) => k !== c.src && !v.paused && v.pause());
      if (el) {
        if (Math.abs(el.currentTime - loc.local) > 0.04) el.currentTime = loc.local;
        mixer.setVolume(el, c.volume);
      }
      setActiveSrc(c.src);
      report(target, true);
      return el ?? null;
    },
    [mixer, report],
  );

  const stopLoop = () => cancelAnimationFrame(raf.current);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    stopLoop();
    els.current.forEach((v) => v.pause());
    musicEl.current?.pause();
    setTime(tRef.current);
  }, []);

  const loop = useCallback(() => {
    if (!playingRef.current) return;
    const t = tl.current;
    const i = idx.current;
    const c = t.clips[i];
    if (!c) {
      pause();
      return;
    }
    const el = els.current.get(c.src);
    const starts = clipStarts(t);
    if (el) {
      const local = el.currentTime;
      if (local >= c.out - 0.03 || el.ended) {
        const ni = i + 1;
        if (ni >= t.clips.length) {
          report(totalDuration(t), true);
          pause();
          return;
        }
        idx.current = ni;
        const n = t.clips[ni];
        const nel = els.current.get(n.src);
        if (nel !== el) el.pause();
        if (nel) {
          if (Math.abs(nel.currentTime - n.in) > 0.05) nel.currentTime = n.in;
          mixer.setVolume(nel, n.volume);
          nel.play().catch(() => undefined);
        }
        setActiveSrc(n.src);
        report(starts[ni]);
      } else {
        report(starts[i] + Math.max(0, local - c.in));
      }
    }
    if (++frameN.current % 30 === 0) syncMusic(tRef.current, true);
    raf.current = requestAnimationFrame(loop);
  }, [mixer, pause, report, syncMusic]);

  const play = useCallback(() => {
    const t = tl.current;
    if (!t.clips.length) return;
    const d = totalDuration(t);
    let T = tRef.current;
    if (T >= d - 0.05) T = 0;

    // Всё ниже — синхронно в обработчике нажатия (требование iOS).
    const all: HTMLMediaElement[] = [...els.current.values()];
    if (musicEl.current) all.push(musicEl.current);
    mixer.unlock(all);
    const loc = locate(t, T);
    const activeId = loc ? t.clips[loc.index].src : null;
    // «Разблокируем» остальные элементы, чтобы потом они могли играть без нового нажатия
    all.forEach((m) => {
      if (m === musicEl.current || els.current.get(activeId ?? '') === m) return;
      m.muted = true;
      m.play()
        .then(() => {
          m.pause();
          m.muted = false;
        })
        .catch(() => (m.muted = false));
    });

    const el = showAt(T);
    if (!el) return;
    playingRef.current = true;
    setPlaying(true);
    el.play().catch((e: DOMException) => {
      pause();
      onError(e?.name === 'NotAllowedError' ? 'Браузер не дал включить звук. Нажмите ▶ ещё раз.' : 'Видео не воспроизводится в этом браузере.');
    });
    syncMusic(T, true);
    stopLoop();
    raf.current = requestAnimationFrame(loop);
  }, [mixer, showAt, pause, syncMusic, loop, onError]);

  const seek = useCallback(
    (T: number) => {
      const el = showAt(T);
      syncMusic(tRef.current, playingRef.current);
      if (playingRef.current && el) el.play().catch(() => undefined);
    },
    [showAt, syncMusic],
  );

  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);

  // Монтаж изменился (обрезка, перестановка) — показываем правильный кадр.
  useEffect(() => {
    const d = totalDuration(timeline);
    if (tRef.current > d) tRef.current = d;
    showAt(tRef.current);
    if (!timeline.clips.length && playingRef.current) pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  // Громкость музыки меняется без перемотки
  useEffect(() => {
    if (musicEl.current && timeline.music) mixer.setVolume(musicEl.current, timeline.music.volume);
  }, [timeline.music, mixer]);

  useEffect(() => () => stopLoop(), []);

  // Один и тот же callback-ref на файл, иначе React переподключал бы элемент на каждом рендере.
  const refCache = useRef(new Map<string, (el: HTMLVideoElement | null) => void>());
  const makeRef = useCallback(
    (id: string) => (el: HTMLVideoElement | null) => {
      if (el) {
        if (els.current.get(id) === el) return;
        els.current.set(id, el);
        const onReady = () => {
          const loc = locate(tl.current, tRef.current);
          if (loc && tl.current.clips[loc.index].src === id && !playingRef.current) showAt(tRef.current);
        };
        el.addEventListener('loadeddata', onReady, { once: true });
      } else {
        const old = els.current.get(id);
        if (old) mixer.forget(old);
        els.current.delete(id);
      }
    },
    [mixer, showAt],
  );
  const registerVideo = useCallback(
    (id: string) => {
      let f = refCache.current.get(id);
      if (!f) {
        f = makeRef(id);
        refCache.current.set(id, f);
      }
      return f;
    },
    [makeRef],
  );

  const subscribe = useCallback((f: (t: number) => void) => {
    listeners.current.add(f);
    return () => {
      listeners.current.delete(f);
    };
  }, []);

  return { playing, time, activeSrc, play, pause, toggle, seek, registerVideo, musicEl, subscribe, timeRef: tRef };
}
