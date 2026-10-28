import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet, TopBar, useFilePicker, useUi } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { formatTime } from '../../lib/format';
import { newId } from '../../lib/db';
import { useHistory } from '../../lib/useHistory';
import { useElementSize } from '../../lib/useElementSize';
import { ImportEmpty } from '../shared/ImportEmpty';
import { TextItem } from '../photo/PhotoView';
import { TextSheet } from '../photo/TextSheet';
import { TextSizeControl } from '../photo/TextSizeControl';
import { useVideoProject } from './useVideoProject';
import { VideoExportSheet } from './export/VideoExportSheet';
import { usePlayer } from './usePlayer';
import { Timeline, clampPps, type Selection } from './Timeline';
import { FormatSheet, LookSheet, MusicSettings, SpeedSheet, TransitionSheet } from './VideoSheets';
import { TransitionPreview } from './TransitionPreview';
import { SubtitlesSheet } from './SubtitlesSheet';
import { BlurBackdrop, videoRect } from './FramePreview';
import { temperatureLayer, toCssFilter } from '../photo/pipeline';
import {
  EMPTY_TIMELINE,
  dipAt,
  transitionLen,
  canMergeNext,
  clampTexts,
  duplicateClip,
  frameRatio,
  hasLook,
  locate,
  lookEdits,
  mergeNext,
  moveClip,
  removeClip,
  speedOf,
  splitAt,
  totalDuration,
  updateClip,
  updateText,
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
  const [sheet, setSheet] = useState<'speed' | 'look' | 'format' | null>(null);
  const [transitionFor, setTransitionFor] = useState<string | null>(null);
  const [subtitlesOpen, setSubtitlesOpen] = useState(false);
  const [musicChoice, setMusicChoice] = useState(false);
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);
  const onPlayError = useCallback((m: string) => ui.toast(m, 'error'), [ui]);
  const player = usePlayer(timeline, onPlayError);
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
    if (selection?.kind === 'clip' && !timeline.clips.some((c) => c.id === selection.id)) setSelection(null);
    if (selection?.kind === 'text' && !timeline.texts.some((t) => t.id === selection.id)) setSelection(null);
    if (selection?.kind === 'music' && !timeline.music) setSelection(null);
  }, [timeline, selection]);

  const videoPicker = useFilePicker('video/*', (f) => importFirst(f));
  const clipPicker = useFilePicker('video/*', async (f) => {
    try {
      const s = await addSource(f, 'video');
      if (!s) return;
      const clip = { id: newId(), src: s.id, in: 0, out: s.duration, volume: 1 };
      hist.apply((t) => ({ ...t, clips: [...t.clips, clip] }));
      setSelection({ kind: 'clip', id: clip.id });
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
      hist.apply((t) => ({ ...t, music: { id: newId(), src: s.id, volume: t.music?.volume ?? 0.8 } }));
      setSelection({ kind: 'music' });
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  };
  const musicPicker = useFilePicker('audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac', addMusic);
  const musicFromVideoPicker = useFilePicker('video/*', addMusic);
  const chooseMusic = () => setMusicChoice(true);

  // Пропорции кадра — формат проекта или первое видео
  const aspect = useMemo(() => {
    const first = timeline.clips[0] ? sources[timeline.clips[0].src] : Object.values(sources).find((s) => s.kind === 'video');
    return frameRatio(timeline, first?.width, first?.height);
  }, [timeline, sources]);

  // Затемнение кадра (переходы, начало, конец) — прямо в DOM, на каждом кадре
  const tlRef = useRef(timeline);
  tlRef.current = timeline;
  useEffect(
    () =>
      player.subscribe((t) => {
        paintDip(fadeRef.current, tlRef.current, t);
      }),
    [player.subscribe],
  );
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
  const selClipIndex = selection?.kind === 'clip' ? timeline.clips.findIndex((c) => c.id === selection.id) : -1;
  const selClip = selClipIndex >= 0 ? timeline.clips[selClipIndex] : null;
  const selText = selection?.kind === 'text' ? timeline.texts.find((t) => t.id === selection.id) ?? null : null;
  const transitionClip = transitionFor ? timeline.clips.find((c) => c.id === transitionFor) ?? null : null;

  const split = () => {
    const next = splitAt(timeline, player.timeRef.current, newId);
    if (!next) {
      ui.toast('Поставьте плейхед внутрь клипа — не ближе 0,3 с к краю', 'info');
      return;
    }
    hist.apply(() => next);
  };
  const addText = () => {
    const start = Math.min(player.timeRef.current, Math.max(0, total - 0.5));
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
    };
    hist.apply((tl) => ({ ...tl, texts: [...tl.texts, t] }));
    setSelection({ kind: 'text', id: t.id });
    setEditingText(t.id);
  };
  const editingLayer = timeline.texts.find((t) => t.id === editingText) ?? null;
  const openTextEditor = (id: string) => setEditingText(id);

  const volumeValue = selClip ? selClip.volume : timeline.music?.volume ?? 1;
  const setVolume = (v: number) => {
    if (selClip) hist.live((t) => updateClip(t, selClip.id, { volume: v }));
    else if (timeline.music) hist.live((t) => ({ ...t, music: t.music ? { ...t.music, volume: v } : null }));
  };

  const visibleTexts = timeline.texts.filter((t) => T >= t.start && T < t.end);
  const dw = frame.width;
  const dh = frame.height;

  /* ---------- Панель инструментов по выбору ---------- */
  let tools: { icon: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }[];
  if (selClip) {
    tools = [
      { icon: 'scissors', label: 'Разделить', onClick: split },
      { icon: 'speed', label: `Скорость${speedOf(selClip) !== 1 ? ' ' + String(speedOf(selClip)).replace('.', ',') + '×' : ''}`, onClick: () => setSheet('speed') },
      { icon: 'filters', label: 'Фильтр', onClick: () => setSheet('look') },
      ...(selClipIndex > 0 ? [{ icon: 'transition', label: 'Переход', onClick: () => setTransitionFor(selClip.id) }] : []),
      { icon: 'music', label: 'Звук', onClick: () => setVolumeOpen(true) },
      {
        icon: 'layers',
        label: 'Копия',
        onClick: () => {
          const r = duplicateClip(timeline, selClip.id, newId);
          hist.apply(() => r.timeline);
          setSelection({ kind: 'clip', id: r.id });
        },
      },
      { icon: 'chevronLeft', label: 'Влево', onClick: () => hist.apply((t) => moveClip(t, selClipIndex, selClipIndex - 1)), disabled: selClipIndex === 0 },
      { icon: 'chevronRight', label: 'Вправо', onClick: () => hist.apply((t) => moveClip(t, selClipIndex, selClipIndex + 1)), disabled: selClipIndex === timeline.clips.length - 1 },
      ...(canMergeNext(timeline, selClipIndex) ? [{ icon: 'check', label: 'Склеить', onClick: () => hist.apply((t) => mergeNext(t, selClipIndex)) }] : []),
      {
        icon: 'trash',
        label: 'Удалить',
        danger: true,
        onClick: () => {
          hist.apply((t) => clampTexts(removeClip(t, selClip.id)));
          setSelection(null);
        },
      },
    ];
  } else if (selText) {
    tools = [
      { icon: 'text', label: 'Изменить', onClick: () => openTextEditor(selText.id) },
      {
        icon: 'scissors',
        label: 'До плейхеда',
        onClick: () => {
          const now = player.timeRef.current;
          if (now <= selText.start + 0.3) return ui.toast('Плейхед должен быть правее начала текста', 'info');
          hist.apply((t) => updateText(t, selText.id, { end: now }));
        },
      },
      {
        icon: 'trash',
        label: 'Удалить',
        danger: true,
        onClick: () => {
          hist.apply((t) => ({ ...t, texts: t.texts.filter((x) => x.id !== selText.id) }));
          setSelection(null);
        },
      },
    ];
  } else if (selection?.kind === 'music') {
    tools = [
      { icon: 'music', label: 'Звук', onClick: () => setVolumeOpen(true) },
      { icon: 'reset', label: 'Заменить', onClick: chooseMusic },
      {
        icon: 'trash',
        label: 'Удалить',
        danger: true,
        onClick: () => {
          hist.apply((t) => ({ ...t, music: null }));
          setSelection(null);
        },
      },
    ];
  } else {
    tools = [
      { icon: 'plus', label: 'Клип', onClick: clipPicker.open },
      { icon: 'scissors', label: 'Разделить', onClick: split, disabled: !timeline.clips.length },
      { icon: 'music', label: 'Музыка', onClick: timeline.music ? () => setSelection({ kind: 'music' }) : chooseMusic },
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
      { icon: 'crop', label: 'Формат', onClick: () => setSheet('format'), disabled: !timeline.clips.length },
    ];
  }

  const videoSources = Object.values(sources).filter((s) => s.kind === 'video');
  // Кадр вписываем сами: и ширина, и высота ограничены, пропорция сохраняется точно
  const maxH = Math.max(160, window.innerHeight * 0.44);
  const fw = Math.min(stageBox.width || 358, maxH * aspect);
  const frameSize = { width: fw, height: fw / aspect };
  const musicSrc = timeline.music ? sources[timeline.music.src] : null;

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
              setSelection(null);
              setExportOpen(true);
            }}
          >
            Экспорт
          </button>
        }
      />

      <div className="editor-stage" ref={stageRef}>
        <div
          className="video-frame"
          style={frameSize}
          ref={setFrame}
          onClick={() => (selection ? setSelection(null) : player.toggle())}
        >
          {showBlur && timeline.clips.length > 0 && <BlurBackdrop host={frameEl} />}
          {videoSources.map((s) => (
            <video
              key={s.id}
              ref={player.registerVideo(s.id)}
              src={s.url}
              playsInline
              preload="auto"
              style={{ objectFit: fill ? 'cover' : 'contain', filter: player.activeSrc === s.id ? curFilter : undefined }}
              className={player.activeSrc === s.id ? 'is-active' : ''}
              onError={() => s.id === player.activeSrc && ui.toast('Видео не открылось. Откройте файл заново из галереи.', 'error')}
            />
          ))}
          {timeline.clips.some((c, i) => i > 0 && c.transition && c.transition !== 'none' && c.transition !== 'fade' && c.transition !== 'white') && (
            <TransitionPreview
              timeline={timeline}
              sources={sources}
              host={frameEl}
              width={frameSize.width}
              height={frameSize.height}
              subscribe={player.subscribe}
              timeRef={player.timeRef}
            />
          )}
          {curTemp && <div className="temp-layer clip-temp" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, background: curTemp.color, opacity: curTemp.opacity }} />}
          {musicSrc && <audio ref={player.musicEl} src={musicSrc.url} preload="auto" />}
          {(loading || !timeline.clips.length) && (
            <div className="frame-empty">{loading ? <div className="skeleton fill" /> : <span>Добавьте клип, чтобы начать</span>}</div>
          )}
          {dw > 0 &&
            visibleTexts.map((t) => (
              <TextItem
                key={t.id}
                t={t}
                dw={dw}
                dh={dh}
                selected={selText?.id === t.id}
                onChange={(id, g) => hist.live((tl) => updateText(tl, id, g))}
                onEnd={hist.endGesture}
                onTap={(id) => {
                  hist.endGesture();
                  if (selText?.id === id) openTextEditor(id);
                  else setSelection({ kind: 'text', id });
                }}
              />
            ))}
          <div className="fade-black" ref={fadeRef} aria-hidden="true" />
          <button
            className={`play-btn ${player.playing ? 'is-playing' : ''}`}
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

      <Timeline
        timeline={timeline}
        sources={sources}
        pps={pps}
        setPps={setPps}
        selection={selection}
        onSelect={setSelection}
        subscribe={player.subscribe}
        timeRef={player.timeRef}
        onScrub={player.seek}
        onUserInteract={() => player.playing && player.pause()}
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
          <button className="tool tool-done" onClick={() => setSelection(null)}>
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

      {clipPicker.input}
      {musicPicker.input}
      {musicFromVideoPicker.input}

      <Sheet open={musicChoice} onClose={() => setMusicChoice(false)} title="Музыка">
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
          <p className="muted small">Музыку из «Apple Музыки» браузер не видит: сохраните трек в «Файлы» или возьмите звук из видео.</p>
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
          ui.toast(`Готово: ${texts.length} субтитров за ${Math.round(info.seconds)} с. Нажмите на текст в кадре, чтобы исправить слово.`, 'ok');
        }}
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
        title={selClip ? 'Громкость клипа' : 'Музыка'}
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
          {!selClip && timeline.music && (
            <MusicSettings
              timeline={timeline}
              trackDuration={musicSrc?.duration ?? 0}
              onChange={(p) => hist.live((t) => ({ ...t, music: t.music ? { ...t.music, ...p } : null }))}
            />
          )}
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

      <SpeedSheet
        open={sheet === 'speed' && !!selClip}
        value={selClip ? speedOf(selClip) : 1}
        onChange={(v) => selClip && hist.apply((t) => clampTexts(updateClip(t, selClip.id, { speed: v })))}
        onClose={() => setSheet(null)}
      />
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
          // Показываем переход сразу: ставим плейхед чуть раньше стыка
          const idx = timeline.clips.findIndex((c) => c.id === transitionClip.id);
          const startOf = timeline.clips.slice(0, idx).reduce((a, c) => a + (c.out - c.in) / speedOf(c), 0);
          player.seek(Math.max(0, startOf - 0.15));
        }}
        onApplyAll={() => {
          if (!transitionClip) return;
          const { transition, transitionDuration } = transitionClip;
          hist.apply((t) => ({ ...t, clips: t.clips.map((c, i) => (i === 0 ? c : { ...c, transition, transitionDuration })) }));
          ui.toast('Переход применён ко всем стыкам', 'ok');
        }}
        onClose={() => setTransitionFor(null)}
      />
      <FormatSheet open={sheet === 'format'} timeline={timeline} onChange={(p) => hist.apply((t) => ({ ...t, ...p }))} onClose={() => setSheet(null)} />

      <VideoExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        timeline={timeline}
        sources={sources}
        readSource={getBlob}
        name={meta?.name ?? 'video'}
        beforeStart={player.pause}
      />

      <TextSheet
        layer={editingLayer}
        onChange={(p) => editingLayer && hist.live((t) => updateText(t, editingLayer.id, p))}
        onDelete={() => {
          if (!editingLayer) return;
          hist.endGesture();
          hist.apply((t) => ({ ...t, texts: t.texts.filter((x) => x.id !== editingLayer.id) }));
          setEditingText(null);
          setSelection(null);
        }}
        onClose={() => {
          hist.endGesture();
          if (editingLayer && !editingLayer.text.trim()) {
            hist.apply((t) => ({ ...t, texts: t.texts.filter((x) => x.id !== editingLayer.id) }));
            setSelection(null);
          }
          setEditingText(null);
        }}
      />
    </div>
  );
}
