import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet, TopBar, useFilePicker, useUi } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useEditorProject } from '../../app/useEditorProject';
import { deleteMedia, getMedia, newId, putMedia } from '../../lib/db';
import { loadImage } from '../../lib/media';
import { formatBytes } from '../../lib/format';
import { aiAssetsReady, aiManifest, downloadAiAssets, totalSize } from '../../ai/assets';
import { computeMask } from '../../ai/providers/backgroundRemoval';
import type { AiProgress } from '../../ai/types';
import { prepareDelivery } from '../../lib/deliver';
import { ImportEmpty } from '../shared/ImportEmpty';
import { PhotoView, type BackgroundLayers } from './PhotoView';
import { BackgroundPanel } from './BackgroundPanel';
import { TextSheet } from './TextSheet';
import { ExportSheet } from './ExportSheet';
import { ASPECTS, FULL, fitAspect, isFull, rotateCropCW, type AspectId } from './geometry';
import { blobToDataUrl, needsAlpha, renderPhoto, type PhotoAssets, type RenderResult } from './render';
import {
  DEFAULT_EDITS,
  PRESETS,
  blurredBackdrop,
  editMediaIds,
  isEdited,
  normalizeEdits,
  temperatureLayer,
  toCssFilter,
  type BackgroundEdit,
  type CropRect,
  type PhotoEdits,
  type TextLayer,
} from './pipeline';

type Panel = 'filters' | 'adjust' | 'text' | 'background';

const ADJUST: { key: 'brightness' | 'contrast' | 'saturation' | 'temperature'; label: string }[] = [
  { key: 'brightness', label: 'Яркость' },
  { key: 'contrast', label: 'Контраст' },
  { key: 'saturation', label: 'Насыщенность' },
  { key: 'temperature', label: 'Температура' },
];

export function PhotoEditorScreen({ projectId, tool }: { projectId?: string; tool?: string }) {
  const ui = useUi();
  const { meta, blob, url, loading, error, persisted, importFile, patch, retry } = useEditorProject('photo', projectId);
  const picker = useFilePicker('image/*', importFile);
  const [panel, setPanel] = useState<Panel>(tool === 'background' ? 'background' : 'filters');
  const [edits, setEdits] = useState<PhotoEdits>(DEFAULT_EDITS);
  const [activeAdjust, setActiveAdjust] = useState<(typeof ADJUST)[number]['key']>('brightness');
  const [cropping, setCropping] = useState<{ rect: CropRect; aspect: AspectId } | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  const loadedFor = useRef<string | null>(null);
  /** Файлы фона, которые есть в правках сейчас (чтобы удалять ненужные) */
  const liveMedia = useRef<string[]>([]);

  useEffect(() => prepareDelivery(), []);

  // Подхватываем сохранённые правки при открытии проекта
  useEffect(() => {
    if (meta && loadedFor.current !== meta.id) {
      loadedFor.current = meta.id;
      setMediaFailed(false);
      const e = normalizeEdits(meta.photoEdits);
      liveMedia.current = editMediaIds(e);
      setEdits(e);
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

  /* ---------- Фон: маска и картинка фона — отдельные файлы проекта ---------- */
  const [bgBlobs, setBgBlobs] = useState<PhotoAssets>({});
  const [layers, setLayers] = useState<BackgroundLayers>({ mask: null, bgImage: null, blur: null });
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const [modelSize, setModelSize] = useState<number | null>(null);
  const [askDownload, setAskDownload] = useState(false);
  /** Файлы, ещё не записанные в хранилище (или если хранилище недоступно) */
  const memBlobs = useRef(new Map<string, Blob>());
  const bg = edits.background;

  useEffect(() => {
    aiAssetsReady().then(setModelReady);
    aiManifest().then((m) => setModelSize(totalSize(m)), () => undefined);
  }, []);

  const readFile = (id: string) => memBlobs.current.get(id) ?? getMedia(id);

  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    (async () => {
      try {
        const mask = bg ? await readFile(bg.mask) : null;
        const bgImage = bg?.image ? await readFile(bg.image) : null;
        if (cancelled) return;
        const toUrl = (b: Blob | null) => {
          if (!b) return null;
          const u = URL.createObjectURL(b);
          made.push(u);
          return u;
        };
        setBgBlobs({ mask, bgImage });
        setLayers((l) => ({ ...l, mask: toUrl(mask), bgImage: toUrl(bgImage) }));
      } catch (e) {
        if (!cancelled) ui.toast(`Файл фона не открылся: ${(e as Error).message}`, 'error');
      }
    })();
    return () => {
      cancelled = true;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bg?.mask, bg?.image]);

  // Размытый фон для предпросмотра — той же функцией, что и при сохранении
  const blurOn = bg?.mode === 'blur';
  const blurAmount = bg?.blur ?? 0;
  useEffect(() => {
    if (!blurOn || !url || !srcW) return;
    let cancelled = false;
    let made: string | null = null;
    const t = setTimeout(async () => {
      try {
        const img = await loadImage(url);
        if (cancelled) return;
        const c = blurredBackdrop(img, srcW, srcH, blurAmount);
        const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
        c.width = c.height = 1;
        if (cancelled || !b) return;
        made = URL.createObjectURL(b);
        setLayers((l) => ({ ...l, blur: made }));
      } catch {
        /* без предпросмотра размытия — фон останется прозрачным до сохранения */
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (made) URL.revokeObjectURL(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurOn, blurAmount, url]);

  // Файлы фона, на которые правки больше не ссылаются, удаляем из хранилища
  useEffect(() => {
    if (!meta || loadedFor.current !== meta.id) return;
    const now = editMediaIds(edits);
    const gone = liveMedia.current.filter((id) => !now.includes(id));
    liveMedia.current = now;
    if (!gone.length) return;
    gone.forEach((id) => memBlobs.current.delete(id));
    if (persisted) setTimeout(() => gone.forEach((id) => deleteMedia(id).catch(() => undefined)), 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits]);

  const storeFile = async (b: Blob): Promise<string> => {
    const id = newId();
    memBlobs.current.set(id, b);
    if (persisted) {
      await putMedia(id, b);
      memBlobs.current.delete(id);
    }
    return id;
  };

  const removeBackground = async (confirmed = false) => {
    if (!blob) return;
    const ready = await aiAssetsReady();
    if (!ready && !confirmed) {
      setAskDownload(true);
      return;
    }
    setAskDownload(false);
    const ctrl = new AbortController();
    const show = (p: AiProgress) => ui.setProgress({ ...p, onCancel: () => ctrl.abort() });
    try {
      if (!ready) {
        show({ value: 0, label: 'Скачиваю модель…' });
        await downloadAiAssets(show, ctrl.signal);
        setModelReady(true);
      }
      const r = await computeMask(blob, show, ctrl.signal);
      const id = await storeFile(r.mask);
      const next: BackgroundEdit = bg ? { ...bg, mask: id } : { mask: id, mode: 'transparent', color: '#FFFFFF', blur: 0.5, image: null };
      set({ background: next });
      ui.toast(`Фон отделён за ${(r.ms / 1000).toFixed(1)} с`, 'ok');
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') ui.toast((e as Error).message || 'Не удалось удалить фон', 'error');
    } finally {
      ui.setProgress(null);
    }
  };

  const bgPicker = useFilePicker('image/*', async (file) => {
    if (!bg) return;
    ui.setProgress({ label: 'Добавляю фон…', value: null });
    try {
      await loadImage(URL.createObjectURL(file)).then((img) => URL.revokeObjectURL(img.src));
      const id = await storeFile(file);
      setEdits((e) => (e.background ? { ...e, background: { ...e.background, mode: 'image', image: id } } : e));
    } catch (e) {
      ui.toast((e as Error).message || 'Не удалось открыть фото для фона', 'error');
    } finally {
      ui.setProgress(null);
    }
  });

  const set = (p: Partial<PhotoEdits>) => setEdits((e) => ({ ...e, ...p }));
  const setBg = (p: Partial<BackgroundEdit>) => setEdits((e) => (e.background ? { ...e, background: { ...e.background, ...p } } : e));
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
        <ImportEmpty kind="photo" error={error} onRetry={projectId ? retry : undefined} onPick={picker.open} hint="JPEG, PNG, HEIC, WebP. Фото с iPhone в HEIC открываются в Safari." />
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
      const assets = bgBlobs;
      if (edits.background && !assets.mask) throw new Error('Маска фона ещё загружается. Повторите через секунду.');
      const r = await renderPhoto(blob, edits, { type, quality: 0.95, assets, onProgress: (value, label) => ui.setProgress({ value, label }) });
      // Превью проекта с правками — для «Недавних»
      try {
        const thumb = await renderPhoto(blob, edits, { maxSide: 320, quality: 0.8, useWorker: false, assets, type: needsAlpha(edits) ? 'image/png' : 'image/jpeg' });
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

  const outPng = result ? result.type === 'image/png' : meta?.mime === 'image/png';
  const filename = `${(meta?.name ?? 'photo').replace(/[\\/:*?"<>|]+/g, '_')}-wstudio.${outPng ? 'png' : 'jpg'}`;
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
          layers={layers}
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
        {bgPicker.input}
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
            <button className={`tool ${panel === 'background' ? 'is-active' : ''}`} onClick={() => setPanel('background')}>
              <Icon name="cutout" size={24} />
              <span>Фон</span>
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

            {panel === 'background' && (
              <BackgroundPanel
                bg={bg}
                modelReady={modelReady}
                modelSize={modelSize}
                onRemove={() => removeBackground()}
                onChange={setBg}
                onPickImage={bgPicker.open}
                onRestore={() => set({ background: null })}
              />
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
      <Sheet open={askDownload} onClose={() => setAskDownload(false)} title="Скачать модель?">
        <div className="feature-sheet">
          <p className="feature-note">
            Для удаления фона нужна модель ИИ{modelSize ? ` (${formatBytes(modelSize)})` : ''}. Она скачивается один раз, сохраняется на этом устройстве и дальше
            работает без интернета. Фото никуда не отправляются.
          </p>
          <p className="muted small">Лучше скачивать по Wi-Fi. Удалить модель можно в разделе «ИИ-инструменты».</p>
          <button className="btn btn-primary btn-block" onClick={() => removeBackground(true)}>
            Скачать и удалить фон
          </button>
          <button className="btn btn-soft btn-block" onClick={() => setAskDownload(false)}>
            Не сейчас
          </button>
        </div>
      </Sheet>
    </div>
  );
}
