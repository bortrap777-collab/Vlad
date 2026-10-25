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
import { useVideoProject } from './useVideoProject';
import { VideoExportSheet } from './export/VideoExportSheet';
import { usePlayer } from './usePlayer';
import { Timeline, clampPps, type Selection } from './Timeline';
import {
  EMPTY_TIMELINE,
  canMergeNext,
  clampTexts,
  mergeNext,
  moveClip,
  removeClip,
  splitAt,
  totalDuration,
  updateClip,
  updateText,
  type Timeline as TL,
  type VideoText,
} from './model';

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
  const [editingText, setEditingText] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);
  const onPlayError = useCallback((m: string) => ui.toast(m, 'error'), [ui]);
  const player = usePlayer(timeline, onPlayError);
  const [frameRef, frame] = useElementSize<HTMLDivElement>();
  const [stageRef, stageBox] = useElementSize<HTMLDivElement>();

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
  const musicPicker = useFilePicker('audio/*', async (f) => {
    try {
      const s = await addSource(f, 'audio');
      if (!s) return;
      hist.apply((t) => ({ ...t, music: { id: newId(), src: s.id, volume: t.music?.volume ?? 0.8 } }));
      setSelection({ kind: 'music' });
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  });

  // Пропорции кадра — по первому видео
  const aspect = useMemo(() => {
    const first = timeline.clips[0] ? sources[timeline.clips[0].src] : Object.values(sources).find((s) => s.kind === 'video');
    return first?.width && first?.height ? first.width / first.height : 16 / 9;
  }, [timeline.clips, sources]);

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
      { icon: 'music', label: 'Звук', onClick: () => setVolumeOpen(true) },
      { icon: 'chevronLeft', label: 'Влево', onClick: () => hist.apply((t) => moveClip(t, selClipIndex, selClipIndex - 1)), disabled: selClipIndex === 0 },
      { icon: 'chevronRight', label: 'Вправо', onClick: () => hist.apply((t) => moveClip(t, selClipIndex, selClipIndex + 1)), disabled: selClipIndex === timeline.clips.length - 1 },
      ...(canMergeNext(timeline, selClipIndex) ? [{ icon: 'layers', label: 'Склеить', onClick: () => hist.apply((t) => mergeNext(t, selClipIndex)) }] : []),
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
      { icon: 'reset', label: 'Заменить', onClick: musicPicker.open },
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
      { icon: 'music', label: 'Музыка', onClick: timeline.music ? () => setSelection({ kind: 'music' }) : musicPicker.open },
      { icon: 'text', label: 'Текст', onClick: addText, disabled: !timeline.clips.length },
    ];
  }

  const videoSources = Object.values(sources).filter((s) => s.kind === 'video');
  // Кадр вписываем сами: и ширина, и высота ограничены, пропорция сохраняется точно
  const maxH = Math.max(160, window.innerHeight * 0.44);
  const fw = Math.min(stageBox.width || 358, maxH * aspect);
  const frameSize = { width: fw, height: fw / aspect };
  const musicSrc = timeline.music ? sources[timeline.music.src] : null;

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
        <div className="video-frame" style={frameSize} ref={frameRef} onClick={() => (selection ? setSelection(null) : player.toggle())}>
          {videoSources.map((s) => (
            <video
              key={s.id}
              ref={player.registerVideo(s.id)}
              src={s.url}
              playsInline
              preload="auto"
              className={player.activeSrc === s.id ? 'is-active' : ''}
              onError={() => s.id === player.activeSrc && ui.toast('Видео не открылось. Откройте файл заново из галереи.', 'error')}
            />
          ))}
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
        onAddMusic={musicPicker.open}
        onAddText={addText}
      />

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

      <Sheet
        open={volumeOpen}
        onClose={() => {
          hist.endGesture();
          setVolumeOpen(false);
        }}
        title={selClip ? 'Громкость клипа' : 'Громкость музыки'}
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
          <p className="muted small">Изменение слышно сразу при воспроизведении.</p>
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
