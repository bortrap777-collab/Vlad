import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet, TopBar, useFilePicker, useUi } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { formatTime } from '../../lib/format';
import { newId } from '../../lib/db';
import { useHistory } from '../../lib/useHistory';
import { useElementSize } from '../../lib/useElementSize';
import { ImportEmpty } from '../shared/ImportEmpty';
import { TextSizeControl } from '../photo/TextSizeControl';
import { useVideoProject } from './useVideoProject';
import { VideoExportSheet } from './export/VideoExportSheet';
import { playerKeys, usePlayer } from './usePlayer';
import { Timeline, clampPps, type Selection } from './Timeline';
import { FormatSheet, LookSheet, TransitionSheet } from './VideoSheets';
import { SubtitlesSheet } from './SubtitlesSheet';
import { BlurBackdrop, videoRect } from './FramePreview';
import { Stage } from './Stage';
import { VideoTexts } from './VideoTexts';
import { OverlayBox } from './OverlayBox';
import { AudioPanel, DEFAULT_KEY, MarkerPanel, OverlayPanel, SpeedPanel, TextPanel } from './Panels';
import { detectKeyColor } from './gl';
import { temperatureLayer, toCssFilter } from '../photo/pipeline';
import {
  EMPTY_TIMELINE,
  MARKER_COLORS,
  audioEnd,
  clipStarts,
  audioSpeed,
  canMergeNext,
  clampToDuration,
  clipLanes,
  dipAt,
  duplicateClip,
  frameRatio,
  hasLook,
  laneKey,
  locate,
  lookEdits,
  mergeNext,
  moveClip,
  removeClip,
  rewordText,
  shiftText,
  speedOf,
  splitAt,
  totalDuration,
  transitionLen,
  updateAudio,
  updateClip,
  updateMarker,
  updateOverlay,
  updateText,
  type AudioItem,
  type Timeline as TL,
  type VideoText,
} from './model';

/** Затемнение/вспышка поверх кадра — прямо в DOM, на каждом кадре */
function paintDip(el: HTMLDivElement | null, t: TL, T: number) {
  if (!el) return;
  const d = dipAt(t, T);
  el.style.opacity = String(d.alpha);
  el.style.background = d.color === 'white' ? '#fff' : '#000';
}

type Dock = 'text' | 'audio' | 'overlay' | 'speed' | 'marker' | null;

export function VideoEditorScreen({ projectId }: { projectId?: string }) {
  const ui = useUi();
  const project = useVideoProject(projectId);
  const { meta, sources, initialTimeline, loading, error, importFirst, addSource, saveTimeline, getBlob } = project;
  const hist = useHistory<TL>(EMPTY_TIMELINE);
  const timeline = hist.state;
  const total = totalDuration(timeline);
  const [selection, setSelection] = useState<Selection>(null);
  const [pps, setPps] = useState(30);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sheet, setSheet] = useState<'look' | 'format' | null>(null);
  const [dock, setDock] = useState<Dock>(null);
  const [transitionFor, setTransitionFor] = useState<string | null>(null);
  const [subtitlesOpen, setSubtitlesOpen] = useState(false);
  const [musicChoice, setMusicChoice] = useState(false);
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const loadedFor = useRef<string | null>(null);
  const onPlayError = useCallback((m: string) => ui.toast(m, 'error'), [ui]);
  const player = usePlayer(timeline, getBlob, onPlayError);
  const resumeAfterScrub = useRef(false);
  const [scrubResume, setScrubResume] = useState(false);
  const [frameRef, frame] = useElementSize<HTMLDivElement>();
  const [stageRef, stageBox] = useElementSize<HTMLDivElement>();
  const setFrame = useCallback(
    (el: HTMLDivElement | null) => {
      frameRef(el);
      setFrameEl(el);
    },
    [frameRef],
  );

  // Загрузили проект — кладём монтаж в историю и подбираем масштаб
  useEffect(() => {
    if (!meta || !initialTimeline || loadedFor.current === meta.id) return;
    loadedFor.current = meta.id;
    hist.reset(initialTimeline);
    const d = totalDuration(initialTimeline) || 10;
    setPps(clampPps((window.innerWidth * 0.85) / d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, initialTimeline]);

  // Автосохранение монтажа
  useEffect(() => {
    if (!meta || loadedFor.current !== meta.id) return;
    const t = setTimeout(() => saveTimeline(timeline, totalDuration(timeline)), 500);
    return () => clearTimeout(t);
  }, [timeline, meta, saveTimeline]);

  // Выбранный объект мог исчезнуть после отмены
  useEffect(() => {
    const gone =
      (selection?.kind === 'clip' && !timeline.clips.some((c) => c.id === selection.id)) ||
      (selection?.kind === 'text' && !timeline.texts.some((t) => t.id === selection.id)) ||
      (selection?.kind === 'audio' && !timeline.audios.some((t) => t.id === selection.id)) ||
      (selection?.kind === 'overlay' && !timeline.overlays.some((t) => t.id === selection.id)) ||
      (selection?.kind === 'marker' && !timeline.markers.some((t) => t.id === selection.id));
    if (gone) {
      setSelection(null);
      setDock(null);
    }
  }, [timeline, selection]);

  const select = (s: Selection) => {
    setSelection(s);
    if (!s) setDock(null);
    else if (dock && dock !== s.kind && !(dock === 'speed' && s.kind === 'clip')) setDock(null);
  };

  const videoPicker = useFilePicker('video/*', (f) => importFirst(f));
  const clipPicker = useFilePicker('video/*', async (f) => {
    try {
      const s = await addSource(f, 'video');
      if (!s) return;
      const clip = { id: newId(), src: s.id, in: 0, out: s.duration, volume: 1 };
      hist.apply((t) => ({ ...t, clips: [...t.clips, clip] }));
      select({ kind: 'clip', id: clip.id });
      ui.toast('Клип добавлен в конец', 'ok');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  });
  const addMusic = async (f: File) => {
    setMusicChoice(false);
    try {
      const s = await addSource(f, 'audio');
      if (!s) return;
      // Первая музыка — с начала ролика, следующие звуки — от плейхеда
      const start = timeline.audios.length ? Math.min(player.timeRef.current, Math.max(0, total - 0.5)) : 0;
      const len = Math.min(s.duration, Math.max(1, total - start));
      const a: AudioItem = { id: newId(), src: s.id, start, in: 0, out: len, volume: timeline.audios.length ? 1 : 0.8, fadeIn: 0, fadeOut: s.duration > len ? 1 : 0 };
      hist.apply((t) => ({ ...t, audios: [...t.audios, a] }));
      select({ kind: 'audio', id: a.id });
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  };
  const musicPicker = useFilePicker('audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac', addMusic);
  const musicFromVideoPicker = useFilePicker('video/*', addMusic);
  const overlayPicker = useFilePicker('video/*,image/*', async (f) => {
    try {
      const s = await addSource(f, 'overlay');
      if (!s) return;
      const start = Math.min(player.timeRef.current, Math.max(0, total - 0.5));
      const len = s.kind === 'image' ? 3 : s.duration;
      const o = { id: newId(), src: s.id, start, end: Math.min(total, start + len), in: 0, x: 0.5, y: 0.5, w: 0.6, rotation: 0, opacity: 1, volume: 0, key: null };
      hist.apply((t) => ({ ...t, overlays: [...t.overlays, o] }));
      select({ kind: 'overlay', id: o.id });
      setDock('overlay');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  });
  const chooseMusic = () => setMusicChoice(true);

  // Пропорции кадра — формат проекта или первое видео
  const aspect = useMemo(() => {
    const first = timeline.clips[0] ? sources[timeline.clips[0].src] : Object.values(sources).find((s) => s.kind === 'video');
    return frameRatio(timeline, first?.width, first?.height);
  }, [timeline, sources]);

  // Затемнение кадра (переходы, начало, конец) — прямо в DOM, на каждом кадре
  const tlRef = useRef(timeline);
  tlRef.current = timeline;
  useEffect(() => player.subscribe((t) => paintDip(fadeRef.current, tlRef.current, t)), [player.subscribe]);
  useEffect(() => {
    paintDip(fadeRef.current, timeline, player.timeRef.current);
  }, [timeline, player.timeRef]);

  if (!meta && !loading) {
    return (
      <div className="screen screen-fixed">
        <TopBar title="Редактор видео" />
        <ImportEmpty
          kind="video"
          error={error}
          onRetry={projectId ? project.retry : undefined}
          onPick={videoPicker.open}
          hint="MP4 и MOV. Видео с iPhone (HEVC) открываются в Safari; в Chrome на Android надёжнее MP4 H.264."
        />
        {videoPicker.input}
      </div>
    );
  }

  /* ---------- Действия ---------- */
  const T = player.time;
  const now = () => player.timeRef.current;
  const sel = <K extends NonNullable<Selection>['kind']>(k: K) => (selection?.kind === k ? selection.id : null);
  const selClipIndex = sel('clip') ? timeline.clips.findIndex((c) => c.id === sel('clip')) : -1;
  const selClip = selClipIndex >= 0 ? timeline.clips[selClipIndex] : null;
  const selText = timeline.texts.find((t) => t.id === sel('text')) ?? null;
  const selAudio = timeline.audios.find((t) => t.id === sel('audio')) ?? null;
  const selOverlay = timeline.overlays.find((t) => t.id === sel('overlay')) ?? null;
  const selMarker = timeline.markers.find((t) => t.id === sel('marker')) ?? null;
  const transitionClip = transitionFor ? timeline.clips.find((c) => c.id === transitionFor) ?? null : null;

  const split = () => {
    const next = splitAt(timeline, now(), newId);
    if (!next) {
      ui.toast('Поставьте плейхед внутрь клипа — не ближе 0,3 с к краю', 'info');
      return;
    }
    hist.apply(() => next);
  };
  const addText = () => {
    const start = Math.min(now(), Math.max(0, total - 0.5));
    const t: VideoText = {
      id: newId(),
      text: 'Ваш текст',
      x: 0.5,
      y: 0.78,
      size: 0.08,
      color: '#FFFFFF',
      font: 'accent',
      style: 'shadow',
      start,
      end: Math.min(total, start + 3),
      animIn: 'blur',
      animOut: 'fade',
      animDur: 0.5,
    };
    hist.apply((tl) => ({ ...tl, texts: [...tl.texts, t] }));
    setSelection({ kind: 'text', id: t.id });
    setDock('text');
  };
  const addMarker = () => {
    const s = now();
    const m = { id: newId(), start: s, end: Math.min(total, s + 1), label: '', color: MARKER_COLORS[timeline.markers.length % MARKER_COLORS.length] };
    hist.apply((t) => ({ ...t, markers: [...t.markers, m] }));
    setSelection({ kind: 'marker', id: m.id });
    setDock('marker');
    ui.toast('Ключ поставлен. Тяните его края на шкале, чтобы отметить промежуток.', 'ok');
  };
  const copyText = (x: VideoText) => {
    // Копия встаёт сразу после оригинала (или от плейхеда, если он правее)
    const len = x.end - x.start;
    const start = Math.min(Math.max(x.end, now() > x.end ? now() : x.end), Math.max(0, total - Math.min(len, total)));
    const copy = shiftText({ ...x, id: newId() }, start);
    hist.apply((t) => ({ ...t, texts: [...t.texts, copy.end > total ? { ...copy, end: total } : copy] }));
    setSelection({ kind: 'text', id: copy.id });
    ui.toast('Копия добавлена — двигайте её по шкале', 'ok');
  };
  const splitAudio = (a: AudioItem) => {
    const T0 = now();
    if (T0 <= a.start + 0.2 || T0 >= audioEnd(a) - 0.2) return ui.toast('Поставьте плейхед внутрь звука', 'info');
    const cut = a.in + (T0 - a.start) * audioSpeed(a);
    const b: AudioItem = { ...a, id: newId(), start: T0, in: cut, fadeIn: 0 };
    hist.apply((t) => ({ ...t, audios: t.audios.flatMap((x) => (x.id === a.id ? [{ ...x, out: cut, fadeOut: 0 }, b] : [x])) }));
  };
  const autoKey = () => {
    const o = selOverlay;
    if (!o) return;
    const s = sources[o.src];
    let color = DEFAULT_KEY.color;
    try {
      const el = s?.kind === 'image' ? (() => {
        const im = new Image();
        im.src = s.url;
        return im.complete ? im : null;
      })() : player.elements.current.get(`ov:${o.id}`) ?? null;
      if (el && s?.width && s.height) color = detectKeyColor(el, s.width, s.height);
    } catch {
      /* без определения — зелёный */
    }
    hist.apply((t) => updateOverlay(t, o.id, { key: { ...(o.key ?? DEFAULT_KEY), color } }));
  };

  const volumeValue = selClip ? selClip.volume : 1;
  const setVolume = (v: number) => selClip && hist.live((t) => updateClip(t, selClip.id, { volume: v }));

  const dw = frame.width;
  const dh = frame.height;

  /* ---------- Панель инструментов по выбору ---------- */
  type Tool = { icon: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean };
  let tools: Tool[];
  if (selClip) {
    tools = [
      { icon: 'scissors', label: 'Разделить', onClick: split },
      { icon: 'speed', label: `Скорость${speedOf(selClip) !== 1 ? ' ' + String(speedOf(selClip)).replace('.', ',') + '×' : ''}`, onClick: () => setDock('speed') },
      { icon: 'filters', label: 'Фильтр', onClick: () => setSheet('look') },
      ...(selClipIndex > 0 ? [{ icon: 'transition', label: 'Переход', onClick: () => setTransitionFor(selClip.id) }] : []),
      { icon: 'music', label: 'Звук', onClick: () => setVolumeOpen(true) },
      {
        icon: 'copy',
        label: 'Копия',
        onClick: () => {
          const r = duplicateClip(timeline, selClip.id, newId);
          hist.apply(() => r.timeline);
          setSelection({ kind: 'clip', id: r.id });
        },
      },
      ...(canMergeNext(timeline, selClipIndex) ? [{ icon: 'merge', label: 'Склеить', onClick: () => hist.apply((t) => mergeNext(t, selClipIndex)) }] : []),
      { icon: 'chevronLeft', label: 'Левее', onClick: () => hist.apply((t) => moveClip(t, selClipIndex, selClipIndex - 1)), disabled: selClipIndex === 0 },
      { icon: 'chevronRight', label: 'Правее', onClick: () => hist.apply((t) => moveClip(t, selClipIndex, selClipIndex + 1)), disabled: selClipIndex === timeline.clips.length - 1 },
      {
        icon: 'trash',
        label: 'Удалить',
        danger: true,
        onClick: () => {
          hist.apply((t) => clampToDuration(removeClip(t, selClip.id)));
          select(null);
        },
      },
    ];
  } else if (selText) {
    tools = [
      { icon: 'text', label: 'Изменить', onClick: () => setDock('text') },
      { icon: 'copy', label: 'Копия', onClick: () => copyText(selText) },
      {
        icon: 'scissors',
        label: 'До плейхеда',
        onClick: () => {
          const n = now();
          if (n <= selText.start + 0.2) return ui.toast('Плейхед должен быть правее начала текста', 'info');
          hist.apply((t) => updateText(t, selText.id, { end: n, words: selText.words?.filter((w) => w.s < n) }));
        },
      },
      ...(selText.subtitle ? [{ icon: 'captions', label: 'Все субтитры', onClick: () => setSubtitlesOpen(true) }] : []),
      {
        icon: 'trash',
        label: 'Удалить',
        danger: true,
        onClick: () => {
          hist.apply((t) => ({ ...t, texts: t.texts.filter((x) => x.id !== selText.id) }));
          select(null);
        },
      },
    ];
  } else if (selAudio) {
    tools = [
      { icon: 'music', label: 'Звук', onClick: () => setDock('audio') },
      { icon: 'scissors', label: 'Разделить', onClick: () => splitAudio(selAudio) },
      {
        icon: 'copy',
        label: 'Копия',
        onClick: () => {
          const c = { ...selAudio, id: newId(), start: audioEnd(selAudio) };
          hist.apply((t) => ({ ...t, audios: [...t.audios, c] }));
          setSelection({ kind: 'audio', id: c.id });
        },
      },
      { icon: 'reset', label: 'Заменить', onClick: chooseMusic },
      {
        icon: 'trash',
        label: 'Удалить',
        danger: true,
        onClick: () => {
          hist.apply((t) => ({ ...t, audios: t.audios.filter((x) => x.id !== selAudio.id) }));
          select(null);
        },
      },
    ];
  } else if (selOverlay) {
    tools = [
      { icon: 'cutout', label: 'Хромакей', onClick: () => setDock('overlay') },
      {
        icon: 'copy',
        label: 'Копия',
        onClick: () => {
          const c = { ...selOverlay, id: newId(), x: Math.min(0.9, selOverlay.x + 0.05), y: Math.min(0.9, selOverlay.y + 0.05) };
          hist.apply((t) => ({ ...t, overlays: [...t.overlays, c] }));
          setSelection({ kind: 'overlay', id: c.id });
        },
      },
      {
        icon: 'scissors',
        label: 'До плейхеда',
        onClick: () => {
          const n = now();
          if (n <= selOverlay.start + 0.2) return ui.toast('Плейхед должен быть правее начала', 'info');
          hist.apply((t) => updateOverlay(t, selOverlay.id, { end: n }));
        },
      },
      {
        icon: 'trash',
        label: 'Удалить',
        danger: true,
        onClick: () => {
          hist.apply((t) => ({ ...t, overlays: t.overlays.filter((x) => x.id !== selOverlay.id) }));
          select(null);
        },
      },
    ];
  } else if (selMarker) {
    tools = [
      { icon: 'text', label: 'Изменить', onClick: () => setDock('marker') },
      { icon: 'play', label: 'Перейти', onClick: () => player.seek(selMarker.start) },
      {
        icon: 'trash',
        label: 'Удалить',
        danger: true,
        onClick: () => {
          hist.apply((t) => ({ ...t, markers: t.markers.filter((x) => x.id !== selMarker.id) }));
          select(null);
        },
      },
    ];
  } else {
    tools = [
      { icon: 'plus', label: 'Клип', onClick: clipPicker.open },
      { icon: 'scissors', label: 'Разделить', onClick: split, disabled: !timeline.clips.length },
      { icon: 'music', label: 'Музыка', onClick: chooseMusic, disabled: !timeline.clips.length },
      { icon: 'text', label: 'Текст', onClick: addText, disabled: !timeline.clips.length },
      {
        icon: 'captions',
        label: 'Субтитры',
        onClick: () => {
          player.pause();
          setSubtitlesOpen(true);
        },
        disabled: !timeline.clips.length,
      },
      { icon: 'layers', label: 'Наложение', onClick: overlayPicker.open, disabled: !timeline.clips.length },
      { icon: 'target', label: 'Ключ', onClick: addMarker, disabled: !timeline.clips.length },
      { icon: 'crop', label: 'Формат', onClick: () => setSheet('format'), disabled: !timeline.clips.length },
    ];
  }

  const keys = playerKeys(timeline, (id) => sources[id]?.kind === 'video');
  // Кадр вписываем сами: и ширина, и высота ограничены, пропорция сохраняется точно
  const maxH = Math.max(160, window.innerHeight * (dock ? 0.38 : 0.44));
  const fw = Math.min(stageBox.width || 358, maxH * aspect);
  const frameSize = { width: fw, height: fw / aspect };

  // Текущий клип под плейхедом: его фильтр и положение в кадре
  const fill = (timeline.fit ?? 'fit') === 'fill';
  const showBlur = !fill && (timeline.background ?? 'blur') === 'blur';
  const curLoc = locate(timeline, T);
  const curClip = curLoc ? timeline.clips[curLoc.index] : null;
  const curSrc = curClip ? sources[curClip.src] : null;
  const curEdits = curClip && hasLook(curClip) ? lookEdits(curClip.look) : null;
  const curFilter = curEdits ? toCssFilter(curEdits) : undefined;
  const curTemp = curEdits ? temperatureLayer(curEdits) : null;
  const rect = videoRect(frameSize.width, frameSize.height, curSrc?.width ?? 0, curSrc?.height ?? 0, fill);
  const lanes = clipLanes(timeline);
  const curKey = curLoc ? laneKey(curClip!.src, lanes[curLoc.index]) : '';
  const visibleOverlays = timeline.overlays.filter((o) => T >= o.start && T < o.end);

  return (
    <div className="screen screen-fixed editor">
      <TopBar
        title="Редактор видео"
        action={
          <button
            className="btn btn-primary btn-sm"
            disabled={!timeline.clips.length}
            onClick={() => {
              player.pause();
              select(null);
              setExportOpen(true);
            }}
          >
            Экспорт
          </button>
        }
      />

      <div className="editor-stage" ref={stageRef}>
        <div className="video-frame" style={frameSize} ref={setFrame} onClick={() => (selection ? select(null) : player.toggle())}>
          {showBlur && timeline.clips.length > 0 && <BlurBackdrop host={frameEl} />}
          {keys.map(({ key, src }) => {
            const s = sources[src];
            if (!s) return null;
            const isOverlay = key.startsWith('ov:');
            const on = !isOverlay && player.shown.includes(key);
            return (
              <video
                key={key}
                ref={player.registerVideo(key)}
                src={s.url}
                playsInline
                preload="auto"
                data-key={key}
                style={{ objectFit: fill ? 'cover' : 'contain', filter: on && key === curKey ? curFilter : undefined, zIndex: key === player.shown[player.shown.length - 1] ? 2 : 1 }}
                className={isOverlay ? 'ov-video' : on ? 'is-active' : ''}
                onError={() => key === curKey && ui.toast('Видео не открылось. Откройте файл заново из галереи.', 'error')}
              />
            );
          })}
          <Stage
            timeline={timeline}
            sources={sources}
            width={frameSize.width}
            height={frameSize.height}
            elements={player.elements}
            frameState={player.frameState}
            playingRef={player.playingRef}
            subscribe={player.subscribe}
            timeRef={player.timeRef}
            filter={curFilter}
          />
          {curTemp && <div className="temp-layer clip-temp" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, background: curTemp.color, opacity: curTemp.opacity }} />}
          {(loading || !timeline.clips.length) && (
            <div className="frame-empty">{loading ? <div className="skeleton fill" /> : <span>Добавьте клип, чтобы начать</span>}</div>
          )}
          {dw > 0 &&
            visibleOverlays.map((o) => {
              const s = sources[o.src];
              const aspectO = s?.width && s.height ? s.height / s.width : 9 / 16;
              return (
                <OverlayBox
                  key={o.id}
                  g={{ x: o.x, y: o.y, w: o.w, rotation: o.rotation }}
                  aspect={aspectO}
                  dw={dw}
                  dh={dh}
                  selected={selOverlay?.id === o.id}
                  onChange={(g) => hist.live((t) => updateOverlay(t, o.id, g))}
                  onEnd={hist.endGesture}
                  onTap={() => {
                    hist.endGesture();
                    if (selOverlay?.id === o.id) setDock('overlay');
                    else select({ kind: 'overlay', id: o.id });
                  }}
                />
              );
            })}
          {dw > 0 && (
            <VideoTexts
              texts={timeline.texts}
              dw={dw}
              dh={dh}
              selectedId={selText?.id ?? null}
              still={!player.playing}
              subscribe={player.subscribe}
              timeRef={player.timeRef}
              onChange={(id, g) => hist.live((tl) => updateText(tl, id, g))}
              onEnd={hist.endGesture}
              onTap={(id) => {
                hist.endGesture();
                if (selText?.id === id) setDock('text');
                else select({ kind: 'text', id });
              }}
            />
          )}
          <div className="fade-black" ref={fadeRef} aria-hidden="true" />
          {player.buffering && <div className="frame-buffering" aria-label="Загрузка" />}
          <button
            className={`play-btn ${player.playing || scrubResume ? 'is-playing' : ''}`}
            aria-label={player.playing ? 'Пауза' : 'Воспроизвести'}
            onClick={(e) => {
              e.stopPropagation();
              player.toggle();
            }}
          >
            <Icon name={player.playing ? 'pause' : 'play'} size={30} stroke={player.playing ? 3 : 0} fill={!player.playing} />
          </button>
        </div>

        <div className="time-row">
          <span className="timecode">
            {formatTime(T)} <span className="muted">/ {formatTime(total)}</span>
            {player.audioStatus.busy > 0 && <span className="audio-busy"> · готовлю звук…</span>}
          </span>
          <div className="undo-redo">
            <button className="icon-btn icon-btn-sm" aria-label="Уменьшить масштаб" onClick={() => setPps(clampPps(pps / 1.6))}>
              <Icon name="minus" size={20} />
            </button>
            <button className="icon-btn icon-btn-sm" aria-label="Увеличить масштаб" onClick={() => setPps(clampPps(pps * 1.6))}>
              <Icon name="plus" size={20} />
            </button>
            <span className="tb-sep" />
            <button className={`icon-btn icon-btn-sm ${hist.canUndo ? '' : 'is-off'}`} aria-label="Отменить" disabled={!hist.canUndo} onClick={hist.undo}>
              <Icon name="undo" size={20} />
            </button>
            <button className={`icon-btn icon-btn-sm ${hist.canRedo ? '' : 'is-off'}`} aria-label="Повторить" disabled={!hist.canRedo} onClick={hist.redo}>
              <Icon name="redo" size={20} />
            </button>
          </div>
        </div>
      </div>

      {dock === 'text' && selText ? (
        <TextPanel
          t={selText}
          onChange={(p) =>
            hist.live((t) => {
              if (p.text === undefined) return updateText(t, selText.id, p);
              const { text, ...rest } = p;
              return { ...t, texts: t.texts.map((x) => (x.id === selText.id ? { ...rewordText(x, text), ...rest } : x)) };
            })
          }
          onCommit={hist.endGesture}
          onDone={() => {
            hist.endGesture();
            if (!selText.text.trim()) {
              hist.apply((t) => ({ ...t, texts: t.texts.filter((x) => x.id !== selText.id) }));
              select(null);
            }
            setDock(null);
          }}
          onApplyStyleAll={
            selText.subtitle
              ? () => {
                  const { font, color, style, size, y, opacity, animIn, animOut, animDur, wordMode, highlight } = selText;
                  hist.apply((t) => ({ ...t, texts: t.texts.map((x) => (x.subtitle ? { ...x, font, color, style, size, y, opacity, animIn, animOut, animDur, wordMode, highlight } : x)) }));
                  ui.toast('Оформление применено ко всем субтитрам', 'ok');
                }
              : undefined
          }
        />
      ) : dock === 'audio' && selAudio ? (
        <AudioPanel
          a={selAudio}
          trackDuration={sources[selAudio.src]?.duration ?? selAudio.out}
          busy={player.audioStatus.busy > 0}
          onChange={(p) => hist.live((t) => updateAudio(t, selAudio.id, p))}
          onCommit={hist.endGesture}
          onDone={() => {
            hist.endGesture();
            setDock(null);
          }}
        />
      ) : dock === 'overlay' && selOverlay ? (
        <OverlayPanel
          o={selOverlay}
          isVideo={sources[selOverlay.src]?.kind === 'video'}
          onChange={(p) => hist.live((t) => updateOverlay(t, selOverlay.id, p))}
          onCommit={hist.endGesture}
          onAutoKey={autoKey}
          onDone={() => {
            hist.endGesture();
            setDock(null);
          }}
        />
      ) : dock === 'speed' && selClip ? (
        <SpeedPanel
          speed={speedOf(selClip)}
          smooth={!!selClip.smooth}
          onChange={(p) => hist.apply((t) => clampToDuration(updateClip(t, selClip.id, p)))}
          onDone={() => setDock(null)}
        />
      ) : dock === 'marker' && selMarker ? (
        <MarkerPanel
          m={selMarker}
          onChange={(p) => hist.live((t) => updateMarker(t, selMarker.id, p))}
          onCommit={hist.endGesture}
          onDone={() => {
            hist.endGesture();
            setDock(null);
          }}
          onToPlayhead={() => {
            const n = now();
            if (n <= selMarker.start + 0.05) return ui.toast('Плейхед должен быть правее начала ключа', 'info');
            hist.apply((t) => updateMarker(t, selMarker.id, { end: n }));
          }}
          onDelete={() => {
            hist.apply((t) => ({ ...t, markers: t.markers.filter((x) => x.id !== selMarker.id) }));
            select(null);
          }}
        />
      ) : (
        <>
          <Timeline
            timeline={timeline}
            sources={sources}
            pps={pps}
            setPps={setPps}
            selection={selection}
            onSelect={select}
            subscribe={player.subscribe}
            timeRef={player.timeRef}
            onScrub={player.seek}
            onUserInteract={() => {
              resumeAfterScrub.current = false;
              if (player.playing) player.pause();
            }}
            onScrubStart={() => {
              // Играло — на время перемотки ставим на паузу (кнопку не показываем), потом продолжаем с нового места
              if (player.playingRef.current) {
                resumeAfterScrub.current = true;
                setScrubResume(true);
                player.pause();
              }
            }}
            onScrubEnd={() => {
              setScrubResume(false);
              if (resumeAfterScrub.current) {
                resumeAfterScrub.current = false;
                player.play();
              }
            }}
            live={hist.live}
            apply={hist.apply}
            endGesture={hist.endGesture}
            onAddClip={clipPicker.open}
            onAddMusic={chooseMusic}
            onAddText={addText}
            onTransition={(id) => {
              player.pause();
              setTransitionFor(id);
            }}
            readSource={getBlob}
          />

          {selText && (
            <div className="quick-row">
              <TextSizeControl
                size={selText.size}
                rotation={selText.rotation}
                onChange={(size) => hist.live((t) => updateText(t, selText.id, { size }))}
                onEnd={hist.endGesture}
                onResetRotation={() => hist.apply((t) => updateText(t, selText.id, { rotation: 0 }))}
              />
            </div>
          )}
          <nav className="toolbar" aria-label="Инструменты видео">
            {selection && (
              <button className="tool tool-done" onClick={() => select(null)}>
                <Icon name="check" size={24} stroke={2.4} />
                <span>Готово</span>
              </button>
            )}
            {tools.map((t) => (
              <button key={t.label} className={`tool ${t.danger ? 'tool-danger' : ''}`} onClick={t.onClick} disabled={t.disabled}>
                <Icon name={t.icon} size={24} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      {clipPicker.input}
      {musicPicker.input}
      {musicFromVideoPicker.input}
      {overlayPicker.input}

      <Sheet open={musicChoice} onClose={() => setMusicChoice(false)} title={selAudio ? 'Заменить звук' : 'Музыка и звуки'}>
        <div className="feature-sheet">
          <div className="source-choice">
            <button className="source-btn" onClick={musicPicker.open}>
              <span className="source-icon">
                <Icon name="music" size={24} />
              </span>
              <span className="row-body">
                <span className="row-title">Аудиофайл</span>
                <span className="row-sub">MP3, M4A, WAV из «Файлов»</span>
              </span>
            </button>
            <button className="source-btn" onClick={musicFromVideoPicker.open}>
              <span className="source-icon is-video">
                <Icon name="video" size={24} />
              </span>
              <span className="row-body">
                <span className="row-title">Звук из видео</span>
                <span className="row-sub">Любое видео из галереи — возьмём только звук</span>
              </span>
            </button>
          </div>
          <p className="muted small">
            {timeline.audios.length ? 'Новый звук встанет от плейхеда отдельной дорожкой. ' : ''}Музыку из «Apple Музыки» браузер не видит: сохраните трек в «Файлы» или возьмите звук из видео.
          </p>
        </div>
      </Sheet>

      <SubtitlesSheet
        open={subtitlesOpen}
        onClose={() => setSubtitlesOpen(false)}
        timeline={timeline}
        ratio={aspect}
        readSource={getBlob}
        onDone={(texts, info) => {
          hist.apply((t) => ({ ...t, texts: [...t.texts.filter((x) => !x.subtitle), ...texts] }));
          setSubtitlesOpen(false);
          ui.toast(`Готово: ${texts.length} субтитров за ${Math.round(info.seconds)} с. Слова появляются в момент произнесения.`, 'ok');
        }}
        onShiftAll={(d) => hist.apply((t) => ({ ...t, texts: t.texts.map((x) => (x.subtitle ? shiftText(x, Math.max(0, x.start + d)) : x)) }))}
        onRemoveAll={() => {
          hist.apply((t) => ({ ...t, texts: t.texts.filter((x) => !x.subtitle) }));
          setSubtitlesOpen(false);
          ui.toast('Субтитры удалены', 'ok');
        }}
      />

      <Sheet
        open={volumeOpen}
        onClose={() => {
          hist.endGesture();
          setVolumeOpen(false);
        }}
        title="Громкость клипа"
      >
        <div className="feature-sheet">
          <div className="slider-row" style={{ width: '100%' }}>
            <input
              id="volume"
              className="slider"
              type="range"
              min={0}
              max={200}
              step={5}
              value={Math.round(volumeValue * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              aria-label="Громкость"
            />
            <output className="slider-value" htmlFor="volume">
              {Math.round(volumeValue * 100)}%
            </output>
          </div>
          <div className="chip-row">
            {[0, 50, 100, 150].map((v) => (
              <button key={v} className={`pill ${Math.round(volumeValue * 100) === v ? 'is-active' : ''}`} onClick={() => setVolume(v / 100)}>
                {v === 0 ? 'Без звука' : `${v}%`}
              </button>
            ))}
          </div>
          <p className="muted small">Изменения слышно сразу при воспроизведении.</p>
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              hist.endGesture();
              setVolumeOpen(false);
            }}
          >
            Готово
          </button>
        </div>
      </Sheet>

      <LookSheet
        open={sheet === 'look' && !!selClip}
        look={selClip?.look}
        thumb={selClip ? sources[selClip.src]?.frames?.[0] : undefined}
        onChange={(look) => selClip && hist.live((t) => updateClip(t, selClip.id, { look }))}
        onApplyAll={() => {
          if (!selClip) return;
          const look = selClip.look;
          hist.endGesture();
          hist.apply((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, look })) }));
          ui.toast('Фильтр применён ко всем клипам', 'ok');
        }}
        onClose={() => {
          hist.endGesture();
          setSheet(null);
        }}
      />
      <TransitionSheet
        open={!!transitionClip}
        value={transitionClip?.transition ?? 'none'}
        duration={transitionClip ? transitionLen(transitionClip) : 0.6}
        onChange={(p) => {
          if (!transitionClip) return;
          hist.apply((t) => updateClip(t, transitionClip.id, p));
          // Показываем переход сразу: ставим плейхед чуть раньше стыка и проигрываем
          const idx = timeline.clips.findIndex((c) => c.id === transitionClip.id);
          const startOf = clipStarts(timeline)[idx] ?? 0;
          player.seek(Math.max(0, startOf - transitionLen({ ...transitionClip, ...p }) / 2 - 0.4));
        }}
        onPreview={() => player.toggle()}
        onApplyAll={() => {
          if (!transitionClip) return;
          const { transition, transitionDuration } = transitionClip;
          hist.apply((t) => ({ ...t, clips: t.clips.map((c, i) => (i === 0 ? c : { ...c, transition, transitionDuration })) }));
          ui.toast('Переход применён ко всем стыкам', 'ok');
        }}
        onClose={() => {
          player.pause();
          setTransitionFor(null);
        }}
      />
      <FormatSheet open={sheet === 'format'} timeline={timeline} onChange={(p) => hist.apply((t) => ({ ...t, ...p }))} onClose={() => setSheet(null)} />

      <VideoExportSheet open={exportOpen} onClose={() => setExportOpen(false)} timeline={timeline} sources={sources} readSource={getBlob} name={meta?.name ?? 'video'} beforeStart={player.pause} />
    </div>
  );
}
