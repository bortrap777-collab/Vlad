import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mixer } from './audio';
import { AudioEngine } from './audio/engine';
import {
  clipEdgeGain,
  clipLanes,
  clipStarts,
  isBlend,
  laneKey,
  locate,
  projectFadeGain,
  rateAt,
  srcAt,
  totalDuration,
  transitionAt,
  type Timeline,
} from './model';

/** Скорость без сохранения тона — так же, как звучит экспорт */
function setRate(el: HTMLMediaElement, rate: number) {
  const r = Math.min(16, Math.max(0.0625, Math.round(rate * 1000) / 1000));
  if (Math.abs(el.playbackRate - r) > 1e-4) el.playbackRate = r;
  const e = el as HTMLMediaElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
  if (e.preservesPitch !== false) e.preservesPitch = false;
  if ('webkitPreservesPitch' in e && e.webkitPreservesPitch !== false) e.webkitPreservesPitch = false;
}

export const overlayKey = (id: string) => `ov:${id}`;

/** Видеоэлементы, которые нужны монтажу: по 1–2 на файл (соседние клипы из одного файла — на разных) */
export function playerKeys(t: Timeline, isVideo: (src: string) => boolean): { key: string; src: string }[] {
  const lanes = clipLanes(t);
  const seen = new Map<string, string>();
  t.clips.forEach((c, i) => seen.set(laneKey(c.src, lanes[i]), c.src));
  t.overlays.forEach((o) => isVideo(o.src) && seen.set(overlayKey(o.id), o.src));
  return [...seen.entries()].map(([key, src]) => ({ key, src }));
}

export interface FrameState {
  /** Ключ видеоэлемента текущего клипа и индекс клипа */
  primary: { key: string; index: number } | null;
  /** Второй клип во время перехода */
  secondary: { key: string; index: number } | null;
  transition: ReturnType<typeof transitionAt>;
}

/**
 * Воспроизведение монтажа без перекодирования.
 *
 * Часы — монотонное время устройства (а не currentTime видео), поэтому музыка и звуки
 * (Web Audio) идут ровно, а видео подстраивается под часы:
 *  - небольшое отставание выбирается плавно (скорость ±10 %), большое — перемоткой;
 *  - следующий клип заранее стоит на своём первом кадре в отдельном элементе, стык — без перемотки;
 *  - во время перехода оба клипа живые (уходящий продолжается, входящий начинается раньше);
 *  - если файл действительно не успевает (буферизация), часы и звук ждут его, а не «убегают».
 */
export function usePlayer(timeline: Timeline, readSource: (id: string) => Promise<Blob>, onError: (msg: string) => void) {
  const tl = useRef(timeline);
  tl.current = timeline;
  const els = useRef(new Map<string, HTMLVideoElement>());
  const mixer = useRef(new Mixer()).current;
  const engine = useMemo(() => new AudioEngine(readSource), [readSource]);
  const [audioStatus, setAudioStatus] = useState<{ busy: number; error: string | null }>({ busy: 0, error: null });
  const playingRef = useRef(false);
  const tRef = useRef(0);
  const clock = useRef({ T: 0, perf: 0 });
  const raf = useRef(0);
  const lastUi = useRef(0);
  const frameN = useRef(0);
  const stall = useRef({ ct: -1, since: 0, holding: false });
  const listeners = useRef(new Set<(t: number) => void>());
  const prerolled = useRef(new Map<HTMLVideoElement, number>());
  /** Элементы, которые сейчас должны играть */
  const wantPlay = useRef(new Set<HTMLVideoElement>());
  const shownRef = useRef<string[]>([]);
  const frameState = useRef<FrameState>({ primary: null, secondary: null, transition: null });
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [time, setTime] = useState(0);
  const [shown, setShown] = useState<string[]>([]);

  useEffect(() => {
    engine.onStatus = setAudioStatus;
    return () => {
      engine.onStatus = null;
      engine.stop();
    };
  }, [engine]);
  useEffect(() => engine.setTimeline(timeline), [engine, timeline]);

  const report = useCallback((t: number, force = false) => {
    tRef.current = t;
    listeners.current.forEach((f) => f(t));
    const now = performance.now();
    if (force || now - lastUi.current > 66) {
      lastUi.current = now;
      setTime(t);
    }
  }, []);

  /** Элемент стоит на нужном кадре (на паузе) */
  const holdAt = (el: HTMLVideoElement, want: number, tol = 0.02) => {
    wantPlay.current.delete(el);
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - want) > tol && prerolled.current.get(el) !== want) {
      prerolled.current.set(el, want);
      try {
        el.currentTime = want;
      } catch {
        /* метаданные ещё не загружены */
      }
    }
  };

  /** Элемент играет и держится рядом с часами */
  const follow = (el: HTMLVideoElement, want: number, rate: number) => {
    prerolled.current.delete(el);
    wantPlay.current.add(el);
    if (el.paused) {
      if (Math.abs(el.currentTime - want) > 0.06) el.currentTime = want;
      setRate(el, rate);
      el.play().catch(() => undefined);
      return;
    }
    const drift = el.currentTime - want;
    if (Math.abs(drift) > 0.35 && !el.seeking) {
      // Сильно отстал (или ушёл вперёд) — перемотка с небольшим упреждением
      el.currentTime = want + 0.08 * rate;
      setRate(el, rate);
      return;
    }
    // Мёртвая зона ±40 мс: в ней скорость точная, звук клипа не «плавает»
    const corr = Math.abs(drift) < 0.04 ? 0 : Math.max(-0.1, Math.min(0.1, -drift * 1.5));
    setRate(el, rate * (1 + corr));
  };

  const durOf = (el: HTMLVideoElement | undefined, fallback: number) => (el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : fallback);

  /** Привести все элементы в состояние момента T */
  const sync = useCallback(
    (T: number, play: boolean) => {
      const t = tl.current;
      const used = new Set<HTMLVideoElement>();
      if (!t.clips.length) {
        els.current.forEach((v) => !v.paused && v.pause());
        frameState.current = { primary: null, secondary: null, transition: null };
        return;
      }
      const starts = clipStarts(t);
      const lanes = clipLanes(t);
      const loc = locate(t, T)!;
      const tr = transitionAt(t, T);
      const active: number[] = [loc.index];
      if (tr) active.push(tr.index === loc.index ? tr.index - 1 : tr.index);
      const pf = projectFadeGain(t, T);
      let primaryEl: HTMLVideoElement | undefined;

      active.forEach((k, n) => {
        const c = t.clips[k];
        const el = els.current.get(laneKey(c.src, lanes[k]));
        if (!el) return;
        used.add(el);
        if (n === 0) primaryEl = el;
        const tau = T - starts[k];
        let want = srcAt(c, tau);
        const dur = durOf(el, c.out);
        let frozen = false;
        if (want < 0) {
          want = 0;
          frozen = true;
        } else if (want > dur - 0.04) {
          want = Math.max(0, dur - 0.04);
          frozen = true;
        }
        if (play && !frozen) follow(el, want, rateAt(c, tau));
        else holdAt(el, want, play ? 0.05 : 1 / 90);
        mixer.setVolume(el, play && !frozen ? c.volume * clipEdgeGain(t, k, T) * pf : 0);
      });

      // Следующий клип заранее на своём первом кадре
      const ni = loc.index + 1;
      if (ni < t.clips.length && !active.includes(ni)) {
        const n = t.clips[ni];
        const el = els.current.get(laneKey(n.src, lanes[ni]));
        if (el && !used.has(el)) {
          used.add(el);
          const lead = isBlend(n) ? Math.min(0.5, (n.transitionDuration ?? 0.6) / 2) : 0;
          holdAt(el, Math.max(0, srcAt(n, -lead)), 0.03);
          mixer.setVolume(el, 0);
        }
      }

      // Наложения-видео
      for (const o of t.overlays) {
        const el = els.current.get(overlayKey(o.id));
        if (!el) continue;
        used.add(el);
        const inside = T >= o.start && T < o.end;
        const want = Math.min(durOf(el, 1e9) - 0.04, o.in + Math.max(0, T - o.start));
        if (inside && play) follow(el, want, 1);
        else if (inside || o.start - T < 1.5) holdAt(el, inside ? want : o.in, play ? 0.05 : 1 / 90);
        else {
          wantPlay.current.delete(el);
          if (!el.paused) el.pause();
        }
        mixer.setVolume(el, inside && play ? o.volume * pf : 0);
      }

      els.current.forEach((v) => {
        if (used.has(v)) return;
        wantPlay.current.delete(v);
        if (!v.paused) v.pause();
      });

      // Какие элементы видны: новый клип — когда его кадр готов, до этого держим прежний
      const keys = active.map((k) => laneKey(t.clips[k].src, lanes[k]));
      const ready = primaryEl && primaryEl.readyState >= 2 && !primaryEl.seeking;
      const nextShown = ready || !shownRef.current.length ? keys : [...shownRef.current.filter((k) => !keys.includes(k)).slice(0, 1), ...keys];
      if (nextShown.join() !== shownRef.current.join()) {
        shownRef.current = nextShown;
        setShown(nextShown);
      }
      frameState.current = {
        primary: { key: keys[0], index: loc.index },
        secondary: keys[1] ? { key: keys[1], index: active[1] } : null,
        transition: tr,
      };

      // Буферизация: текущий файл не двигается — часы и звук ждут
      if (play && primaryEl) {
        const st = stall.current;
        const now = performance.now();
        if (primaryEl.currentTime !== st.ct) {
          st.ct = primaryEl.currentTime;
          st.since = now;
        }
        const stuck = primaryEl.readyState < 3 && now - st.since > 350;
        if (stuck && !st.holding) {
          st.holding = true;
          engine.stop();
          setBuffering(true);
        } else if (st.holding && primaryEl.readyState >= 3 && !primaryEl.seeking) {
          st.holding = false;
          clock.current = { T, perf: now };
          engine.start(T);
          setBuffering(false);
        }
      }
    },
    [mixer, engine],
  );

  const now = () => {
    const c = clock.current;
    if (stall.current.holding) {
      clock.current = { T: c.T, perf: performance.now() };
      return c.T;
    }
    return c.T + (performance.now() - c.perf) / 1000;
  };

  const stopLoop = () => cancelAnimationFrame(raf.current);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    setBuffering(false);
    stall.current.holding = false;
    stopLoop();
    engine.stop();
    wantPlay.current.clear();
    els.current.forEach((v) => v.pause());
    sync(tRef.current, false);
    report(tRef.current, true);
  }, [engine, sync, report]);

  const loop = useCallback(() => {
    if (!playingRef.current) return;
    const t = tl.current;
    const total = totalDuration(t);
    let T = now();
    if (T >= total) {
      T = total;
      report(T, true);
      pause();
      return;
    }
    sync(T, true);
    report(T);
    if (++frameN.current % 20 === 0 && !stall.current.holding) engine.check(T);
    raf.current = requestAnimationFrame(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, pause, report, sync]);

  const play = useCallback(() => {
    const t = tl.current;
    if (!t.clips.length) return;
    const d = totalDuration(t);
    let T = tRef.current;
    if (T >= d - 0.05) T = 0;

    // Всё ниже — синхронно в обработчике нажатия (требование iOS)
    const all: HTMLMediaElement[] = [...els.current.values()];
    mixer.unlock(all);
    const loc = locate(t, T);
    const primaryKey = loc ? laneKey(t.clips[loc.index].src, clipLanes(t)[loc.index]) : '';
    // «Разблокируем» остальные элементы, чтобы потом они могли играть без нового нажатия
    els.current.forEach((m, key) => {
      if (key === primaryKey || !m.paused) return;
      m.muted = true;
      m.play()
        .then(() => {
          // Элемент мог понадобиться за это время — тогда не трогаем
          if (!wantPlay.current.has(m as HTMLVideoElement)) m.pause();
          m.muted = false;
        })
        .catch(() => (m.muted = false));
    });
    playingRef.current = true;
    setPlaying(true);
    stall.current = { ct: -1, since: performance.now(), holding: false };
    clock.current = { T, perf: performance.now() };
    sync(T, true);
    const el = els.current.get(primaryKey);
    el?.play().catch((e: DOMException) => {
      if (!playingRef.current) return;
      pause();
      onError(e?.name === 'NotAllowedError' ? 'Браузер не дал включить звук. Нажмите ▶ ещё раз.' : 'Видео не воспроизводится в этом браузере.');
    });
    engine.start(T);
    report(T, true);
    stopLoop();
    raf.current = requestAnimationFrame(loop);
  }, [mixer, sync, pause, loop, onError, engine, report]);

  const seek = useCallback(
    (T: number) => {
      const d = totalDuration(tl.current);
      const target = Math.min(Math.max(0, T), d);
      if (playingRef.current) {
        clock.current = { T: target, perf: performance.now() };
        engine.start(target);
      }
      sync(target, playingRef.current);
      report(target, true);
    },
    [engine, sync, report],
  );

  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);

  // Монтаж изменился (обрезка, перестановка) — показываем правильный кадр
  useEffect(() => {
    const d = totalDuration(timeline);
    if (tRef.current > d) tRef.current = d;
    if (!timeline.clips.length && playingRef.current) pause();
    else if (!playingRef.current) sync(tRef.current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  useEffect(() => () => stopLoop(), []);

  // Один и тот же callback-ref на элемент, иначе React переподключал бы его на каждом рендере
  const refCache = useRef(new Map<string, (el: HTMLVideoElement | null) => void>());
  const registerVideo = useCallback(
    (key: string) => {
      let f = refCache.current.get(key);
      if (!f) {
        f = (el: HTMLVideoElement | null) => {
          if (el) {
            if (els.current.get(key) === el) return;
            els.current.set(key, el);
            const onReady = () => {
              // Safari на iPhone не рисует кадр, пока видео не играло и не перематывалось
              if (el.currentTime === 0 && el.paused) el.currentTime = 0.001;
              if (!playingRef.current) sync(tRef.current, false);
            };
            el.addEventListener('loadeddata', onReady, { once: true });
            el.addEventListener('seeked', () => {
              if (!playingRef.current) sync(tRef.current, false);
              listeners.current.forEach((fn) => fn(tRef.current));
            });
          } else {
            const old = els.current.get(key);
            if (old) {
              mixer.forget(old);
              prerolled.current.delete(old);
            }
            els.current.delete(key);
          }
        };
        refCache.current.set(key, f);
      }
      return f;
    },
    [mixer, sync],
  );

  const subscribe = useCallback((f: (t: number) => void) => {
    listeners.current.add(f);
    return () => {
      listeners.current.delete(f);
    };
  }, []);

  return {
    playing,
    buffering,
    time,
    shown,
    audioStatus,
    play,
    pause,
    toggle,
    seek,
    registerVideo,
    subscribe,
    timeRef: tRef,
    elements: els,
    frameState,
    playingRef,
  };
}
