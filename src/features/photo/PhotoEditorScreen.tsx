import { useEffect, useMemo, useRef, useState } from 'react';
import { TopBar, useFilePicker, useUi } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useEditorProject } from '../../app/useEditorProject';
import { useNav } from '../../app/nav';
import { newId } from '../../lib/db';
import { prepareDelivery } from '../../lib/deliver';
import { ImportEmpty } from '../shared/ImportEmpty';
import { PhotoView } from './PhotoView';
import { TextSheet } from './TextSheet';
import { ExportSheet } from './ExportSheet';
import { ASPECTS, FULL, fitAspect, isFull, rotateCropCW, type AspectId } from './geometry';
import { blobToDataUrl, renderPhoto, type RenderResult } from './render';
import {
  DEFAULT_EDITS,
  PRESETS,
  isEdited,
  normalizeEdits,
  temperatureLayer,
  toCssFilter,
  type CropRect,
  type PhotoEdits,
  type TextLayer,
} from './pipeline';

type Panel = 'filters' | 'adjust' | 'text';

const ADJUST: { key: 'brightness' | 'contrast' | 'saturation' | 'temperature'; label: string }[] = [
  { key: 'brightness', label: 'Яркость' },
  { key: 'contrast', label: 'Контраст' },
  { key: 'saturation', label: 'Насыщенность' },
  { key: 'temperature', label: 'Температура' },
];

export function PhotoEditorScreen({ projectId }: { projectId?: string }) {
  const ui = useUi();
  const nav = useNav();
  const { meta, blob, url, loading, error, persisted, importFile, patch } = useEditorProject('photo', projectId);
  const picker = useFilePicker('image/*', importFile);
  const [panel, setPanel] = useState<Panel>('filters');
  const [edits, setEdits] = useState<PhotoEdits>(DEFAULT_EDITS);
  const [activeAdjust, setActiveAdjust] = useState<(typeof ADJUST)[number]['key']>('brightness');
  const [cropping, setCropping] = useState<{ rect: CropRect; aspect: AspectId } | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => prepareDelivery(), []);

  // Подхватываем сохранённые правки при открытии проекта
  useEffect(() => {
    if (meta && loadedFor.current !== meta.id) {
      loadedFor.current = meta.id;
      setMediaFailed(false);
      setEdits(normalizeEdits(meta.photoEdits));
    }
  }, [meta]);

  // Автосохранение правок
  const patchRef = useRef(patch);
  patchRef.current = patch;
  useEffect(() => {
    if (!meta || loadedFor.current !== meta.id) return;
    const t = setTimeout(() => patchRef.current({ photoEdits: edits }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits]);

  const set = (p: Partial<PhotoEdits>) => setEdits((e) => ({ ...e, ...p }));
  const srcW = meta?.width ?? 0;
  const srcH = meta?.height ?? 0;
  const quarter = edits.rotation % 180 !== 0;
  const rw = quarter ? srcH : srcW;
  const rh = quarter ? srcW : srcH;

  const aspectRn = useMemo(() => {
    if (!cropping) return null;
    const a = ASPECTS.find((x) => x.id === cropping.aspect)!;
    if (a.ratio === null) return null;
    const pr = a.ratio === -1 ? rw / rh : a.ratio;
    return (pr * rh) / rw;
  }, [cropping, rw, rh]);

  if (!meta && !loading) {
    return (
      <div className="screen screen-fixed">
        <TopBar title="Редактор фото" />
        <ImportEmpty kind="photo" error={error} onPick={picker.open} hint="JPEG, PNG, HEIC, WebP. Фото с iPhone в HEIC открываются в Safari." />
        {picker.input}
      </div>
    );
  }

  /* ---------- Действия ---------- */
  const rotate = () => setEdits((e) => ({ ...e, rotation: (e.rotation + 90) % 360, crop: rotateCropCW(e.crop) }));

  const startCrop = () => {
    setEditingText(null);
    setCropping({ rect: edits.crop ?? FULL, aspect: 'free' });
  };
  const chooseAspect = (id: AspectId) => {
    const a = ASPECTS.find((x) => x.id === id)!;
    const rect = a.ratio === null ? cropping?.rect ?? FULL : fitAspect(a.ratio === -1 ? rw / rh : a.ratio, rw, rh);
    setCropping({ rect, aspect: id });
  };
  const applyCrop = () => {
    if (!cropping) return;
    set({ crop: isFull(cropping.rect) ? null : cropping.rect });
    setCropping(null);
  };

  const addText = () => {
    const layer: TextLayer = { id: newId(), text: 'Ваш текст', x: 0.5, y: 0.5, size: 0.09, color: '#FFFFFF', font: 'accent', style: 'shadow' };
    set({ texts: [...edits.texts, layer] });
    setEditingText(layer.id);
  };
  const updateText = (id: string, p: Partial<TextLayer>) =>
    setEdits((e) => ({ ...e, texts: e.texts.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
  const deleteText = (id: string) => {
    setEdits((e) => ({ ...e, texts: e.texts.filter((t) => t.id !== id) }));
    setEditingText(null);
  };
  const closeTextEditor = () => {
    // Пустой текст не оставляем
    setEdits((e) => ({ ...e, texts: e.texts.filter((t) => t.id !== editingText || t.text.trim()) }));
    setEditingText(null);
  };

  const save = async () => {
    if (!blob || !meta) return;
    ui.setProgress({ label: 'Готовлю фото…', value: 0 });
    try {
      const type = meta.mime === 'image/png' ? 'image/png' : 'image/jpeg';
      const r = await renderPhoto(blob, edits, { type, quality: 0.95, onProgress: (value, label) => ui.setProgress({ value, label }) });
      // Превью проекта с правками — для «Недавних»
      try {
        const thumb = await renderPhoto(blob, edits, { maxSide: 320, quality: 0.8, useWorker: false });
        await patch({ photoEdits: edits, thumb: await blobToDataUrl(thumb.blob) });
      } catch {
        await patch({ photoEdits: edits });
      }
      setResult(r);
    } catch (e) {
      ui.toast((e as Error).message || 'Не удалось подготовить фото', 'error');
    } finally {
      ui.setProgress(null);
    }
  };

  const filename = `${(meta?.name ?? 'photo').replace(/[\\/:*?"<>|]+/g, '_')}-wstudio.${meta?.mime === 'image/png' ? 'png' : 'jpg'}`;
  const current = ADJUST.find((a) => a.key === activeAdjust)!;
  const editingLayer = edits.texts.find((t) => t.id === editingText) ?? null;

  return (
    <div className="screen screen-fixed editor">
      <TopBar
        title={cropping ? 'Обрезка' : 'Редактор фото'}
        onBack={cropping ? () => setCropping(null) : undefined}
        action={
          cropping ? (
            <button className="btn btn-primary btn-sm" onClick={applyCrop}>
              Готово
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={save} disabled={!blob}>
              Сохранить
            </button>
          )
        }
      />

      <div className="photo-stage">
        <PhotoView
          url={url}
          srcW={srcW}
          srcH={srcH}
          edits={edits}
          loading={loading}
          crop={cropping ? { rect: cropping.rect, rn: aspectRn, onChange: (rect) => setCropping((c) => (c ? { ...c, rect } : c)) } : null}
          selectedText={editingText}
          onTextMove={(id, x, y) => updateText(id, { x, y })}
          onTextTap={(id) => {
            setPanel('text');
            setEditingText(id);
          }}
          onMediaError={() => setMediaFailed(true)}
        />
        {(mediaFailed || (error && !loading)) && (
          <div className="stage-error" role="alert">
            <Icon name="info" size={22} />
            <p>{error ?? 'Фото не удалось показать. Браузер не открыл сохранённый файл.'}</p>
            <button className="btn btn-primary btn-sm" onClick={picker.open}>
              Выбрать фото заново
            </button>
          </div>
        )}
        {picker.input}
      </div>

      {cropping ? (
        <div className="photo-panel">
          <div className="chip-row chip-row-scroll" role="radiogroup" aria-label="Пропорции">
            {ASPECTS.map((a) => (
              <button key={a.id} role="radio" aria-checked={cropping.aspect === a.id} className={`pill ${cropping.aspect === a.id ? 'is-active' : ''}`} onClick={() => chooseAspect(a.id)}>
                {a.label}
              </button>
            ))}
          </div>
          <div className="panel-foot">
            <button className="link-btn" onClick={() => setCropping({ rect: FULL, aspect: 'free' })}>
              <Icon name="reset" size={16} /> Сбросить
            </button>
            <button
              className="link-btn"
              onClick={() => {
                rotate();
                setCropping((c) => (c ? { rect: rotateCropCW(c.rect) ?? FULL, aspect: 'free' } : c));
              }}
            >
              <Icon name="rotate" size={16} /> Повернуть
            </button>
          </div>
          <p className="muted small">Тяните за углы или двигайте рамку пальцем.</p>
        </div>
      ) : (
        <>
          <nav className="toolbar toolbar-top" aria-label="Инструменты фото">
            <button className="tool" onClick={startCrop}>
              <Icon name="crop" size={24} />
              <span>Обрезать</span>
            </button>
            <button className={`tool ${panel === 'filters' ? 'is-active' : ''}`} onClick={() => setPanel('filters')}>
              <Icon name="filters" size={24} />
              <span>Фильтры</span>
            </button>
            <button className={`tool ${panel === 'adjust' ? 'is-active' : ''}`} onClick={() => setPanel('adjust')}>
              <Icon name="sliders" size={24} />
              <span>Настройки</span>
            </button>
            <button className="tool" onClick={rotate}>
              <Icon name="rotate" size={24} />
              <span>Поворот</span>
            </button>
            <button className="tool" onClick={() => nav.push({ name: 'ai' })}>
              <Icon name="cutout" size={24} />
              <span>ИИ-фон</span>
              <i className="tool-dot tool-dot-ai" aria-hidden="true" />
            </button>
            <button className={`tool ${panel === 'text' ? 'is-active' : ''}`} onClick={() => setPanel('text')}>
              <Icon name="text" size={24} />
              <span>Текст</span>
            </button>
          </nav>

          <div className="photo-panel">
            {panel === 'filters' && (
              <div className="preset-row" role="listbox" aria-label="Фильтры">
                {PRESETS.map((p) => {
                  const t = temperatureLayer({ ...edits, temperature: 0 }, p.id);
                  return (
                    <button
                      key={p.id}
                      role="option"
                      aria-selected={edits.preset === p.id}
                      className={`preset ${edits.preset === p.id ? 'is-active' : ''}`}
                      onClick={() => set({ preset: p.id })}
                    >
                      <span className="preset-img">
                        {url && <img src={url} alt="" style={{ filter: toCssFilter(DEFAULT_EDITS, p.id) }} draggable={false} />}
                        {t && <span className="temp-layer" style={{ background: t.color, opacity: t.opacity }} />}
                      </span>
                      <span className="preset-name">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {panel === 'adjust' && (
              <div className="adjust">
                <div className="adjust-tabs" role="tablist">
                  {ADJUST.map((a) => (
                    <button
                      key={a.key}
                      role="tab"
                      aria-selected={activeAdjust === a.key}
                      className={`adjust-tab ${activeAdjust === a.key ? 'is-active' : ''} ${edits[a.key] !== 0 ? 'is-changed' : ''}`}
                      onClick={() => setActiveAdjust(a.key)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <div className="slider-row">
                  <input
                    id={`adj-${current.key}`}
                    className={`slider ${current.key === 'temperature' ? 'slider-temp' : ''}`}
                    type="range"
                    min={-100}
                    max={100}
                    step={1}
                    value={edits[current.key]}
                    onChange={(e) => set({ [current.key]: Number(e.target.value) } as Partial<PhotoEdits>)}
                    onDoubleClick={() => set({ [current.key]: 0 } as Partial<PhotoEdits>)}
                    aria-label={current.label}
                  />
                  <output className="slider-value" htmlFor={`adj-${current.key}`}>
                    {edits[current.key] > 0 ? `+${edits[current.key]}` : edits[current.key]}
                  </output>
                </div>
              </div>
            )}

            {panel === 'text' && (
              <div className="text-panel">
                <div className="chip-row chip-row-scroll">
                  <button className="pill pill-add" onClick={addText}>
                    <Icon name="plus" size={16} stroke={2.6} /> Добавить текст
                  </button>
                  {edits.texts.map((t) => (
                    <button key={t.id} className="pill" onClick={() => setEditingText(t.id)}>
                      {t.text.split('\n')[0].slice(0, 18) || 'Текст'}
                    </button>
                  ))}
                </div>
                <p className="muted small">{edits.texts.length ? 'Перетаскивайте текст пальцем, нажмите — чтобы изменить.' : 'Надпись появится в центре фото.'}</p>
              </div>
            )}

            <div className="panel-foot">
              <span className="muted small">{persisted ? 'Правки сохраняются автоматически' : 'Хранилище недоступно — правки не сохранятся'}</span>
              {isEdited(edits) && (
                <button className="link-btn" onClick={() => setEdits({ ...DEFAULT_EDITS })}>
                  <Icon name="reset" size={16} /> Сбросить всё
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <TextSheet
        layer={editingLayer}
        onChange={(p) => editingLayer && updateText(editingLayer.id, p)}
        onDelete={() => editingLayer && deleteText(editingLayer.id)}
        onClose={closeTextEditor}
      />
      <ExportSheet result={result} filename={filename} onClose={() => setResult(null)} />
    </div>
  );
}
