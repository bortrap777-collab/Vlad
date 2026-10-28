import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TopBar, useFilePicker, useUi } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useEditorProject } from '../../app/useEditorProject';
import { deleteMedia, getMedia, newId, putMedia } from '../../lib/db';
import { loadImage } from '../../lib/media';
import { useHistory } from '../../lib/useHistory';
import { ensureAiAssets } from '../../ai/assets';
import { computeMask } from '../../ai/providers/backgroundRemoval';
import { eraseObject } from '../../ai/providers/objects';
import type { AiProgress } from '../../ai/types';
import { prepareDelivery } from '../../lib/deliver';
import { ImportEmpty } from '../shared/ImportEmpty';
import { PhotoView } from './PhotoView';
import { BackgroundPanel } from './BackgroundPanel';
import { LayersPanel } from './LayersPanel';
import { MaskBrush } from './MaskBrush';
import { ObjectTool, type ObjectAction } from './ObjectTool';
import { TextSheet } from './TextSheet';
import { TextSizeControl } from './TextSizeControl';
import { ExportSheet } from './ExportSheet';
import { ASPECTS, FULL, fitAspect, isFull, rotateCropCW, type AspectId } from './geometry';
import { blobToDataUrl, canvasPixelLimit, composeStack, makeCanvas, renderPhoto, stackHasAlpha, type RenderResult } from './render';
import {
  DEFAULT_EDITS,
  PRESETS,
  PRESET_GROUPS,
  blurredBackdrop,
  editMediaIds,
  isEdited,
  normalizeEdits,
  temperatureLayer,
  toCssFilter,
  type CropRect,
  type PhotoEdits,
  type TextLayer,
} from './pipeline';
import {
  NEUTRAL_ADJUST,
  addPhoto,
  backgroundLayer,
  bgModeOf,
  duplicateLayer,
  extractLayer,
  moveLayer,
  objectTargetLayer,
  removeLayer,
  setBackground,
  sourceLayer,
  updateLayer,
  withCutout,
  type Adjust,
  type BgMode,
  type LayerStack,
  type PhotoLayer,
} from './layers';

type Panel = 'filters' | 'adjust' | 'text' | 'background' | 'layers';

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
  const [presetGroup, setPresetGroup] = useState<(typeof PRESET_GROUPS)[number]['id']>('all');
  const [panel, setPanel] = useState<Panel>(tool === 'background' ? 'background' : 'filters');
  const hist = useHistory<PhotoEdits>(DEFAULT_EDITS);
  const edits = hist.state;
  const [activeAdjust, setActiveAdjust] = useState<(typeof ADJUST)[number]['key']>('brightness');
  const [cropping, setCropping] = useState<{ rect: CropRect; aspect: AspectId } | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  /** Выбранная надпись: рамка и ручка размера/поворота; повторное касание открывает редактор */
  const [pickedText, setPickedText] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [adjustAll, setAdjustAll] = useState(false);
  const [brushing, setBrushing] = useState<string | null>(null);
  const [objects, setObjects] = useState(tool === 'objects');
  const loadedFor = useRef<string | null>(null);

  useEffect(() => prepareDelivery(), []);

  const srcW = meta?.width ?? 0;
  const srcH = meta?.height ?? 0;

  // Подхватываем сохранённые правки при открытии проекта
  useEffect(() => {
    if (meta && loadedFor.current !== meta.id) {
      loadedFor.current = meta.id;
      setMediaFailed(false);
      const e = normalizeEdits(meta.photoEdits, meta.width ?? 1, meta.height ?? 1);
      known.current = new Set(editMediaIds(meta.photoEdits));
      hist.reset(e);
      const top = e.stack?.layers.find((l) => l.role === 'subject') ?? null;
      setSelectedLayer(top?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const set = (p: Partial<PhotoEdits>) => hist.apply((e) => ({ ...e, ...p }));
  const setLive = (p: Partial<PhotoEdits>, end: boolean) => {
    hist.live((e) => ({ ...e, ...p }));
    if (end) hist.endGesture();
  };
  const stack = edits.stack;
  const setStack = (fn: (s: LayerStack | null) => LayerStack | null) => hist.apply((e) => ({ ...e, stack: fn(e.stack) }));
  const setStackLive = (fn: (s: LayerStack) => LayerStack, end: boolean) => {
    hist.live((e) => (e.stack ? { ...e, stack: fn(e.stack) } : e));
    if (end) hist.endGesture();
  };

  /* ---------- Файлы слоёв: изображения, маски, объединённое фото ---------- */
  const blobs = useRef(new Map<string, Blob>());
  const [files, setFiles] = useState<Record<string, string>>({});
  /** Все файлы, появлявшиеся в правках: ненужные удаляются при выходе (отмена должна работать) */
  const known = useRef(new Set<string>());
  const mediaIds = editMediaIds(edits);
  const idsKey = mediaIds.join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const id of mediaIds) {
        if (blobs.current.has(id) && files[id]) continue;
        try {
          const b = blobs.current.get(id) ?? (await getMedia(id));
          if (cancelled) return;
          blobs.current.set(id, b);
          const u = URL.createObjectURL(b);
          setFiles((f) => ({ ...f, [id]: u }));
        } catch (e) {
          if (!cancelled) ui.toast(`Файл слоя не открылся: ${(e as Error).message}`, 'error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const filesRef = useRef(files);
  filesRef.current = files;
  const editsRef = useRef(edits);
  editsRef.current = edits;
  useEffect(
    () => () => {
      Object.values(filesRef.current).forEach((u) => URL.revokeObjectURL(u));
      const used = new Set(editMediaIds(editsRef.current));
      if (persistedRef.current) known.current.forEach((id) => !used.has(id) && deleteMedia(id).catch(() => undefined));
    },
    [],
  );
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;

  const storeFile = async (b: Blob): Promise<string> => {
    const id = newId();
    blobs.current.set(id, b);
    known.current.add(id);
    if (persisted) await putMedia(id, b);
    setFiles((f) => ({ ...f, [id]: URL.createObjectURL(b) }));
    return id;
  };

  // Фото-основа: оригинал или он же после удаления объектов
  const docMedia = stack?.photo?.media ?? null;
  const docUrl = docMedia ? files[docMedia] ?? null : url;
  const docBlob = docMedia ? blobs.current.get(docMedia) ?? null : blob;

  const blobFiles = (): Record<string, Blob> => {
    const out: Record<string, Blob> = {};
    for (const id of editMediaIds(edits)) {
      const b = blobs.current.get(id);
      if (!b) throw new Error('Файлы слоёв ещё загружаются. Повторите через секунду.');
      out[id] = b;
    }
    return out;
  };

  // Размытое фото для слоя «размытие» — той же функцией, что и при сохранении
  const blurLayer = stack?.layers.find((l) => l.kind === 'blur' && l.visible);
  const blurAmount = blurLayer?.blur ?? null;
  const [blurUrl, setBlurUrl] = useState<string | null>(null);
  useEffect(() => {
    if (blurAmount == null || !docUrl || !srcW) return;
    let cancelled = false;
    let made: string | null = null;
    const t = setTimeout(async () => {
      try {
        const img = await loadImage(docUrl);
        if (cancelled) return;
        const c = blurredBackdrop(img, srcW, srcH, blurAmount);
        const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
        c.width = c.height = 1;
        if (cancelled || !b) return;
        made = URL.createObjectURL(b);
        setBlurUrl(made);
      } catch {
        /* предпросмотр размытия не обязателен */
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (made) URL.revokeObjectURL(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurAmount, docUrl, srcW]);

  /* ---------- Удалить фон: одна кнопка ---------- */
  const removeBackground = async () => {
    if (!docBlob || !srcW) return;
    const ctrl = new AbortController();
    const show = (p: AiProgress) => ui.setProgress({ ...p, onCancel: () => ctrl.abort() });
    try {
      await ensureAiAssets('segment', show, ctrl.signal);
      const r = await computeMask(docBlob, show, ctrl.signal);
      const id = await storeFile(r.mask);
      const next = withCutout(stack ? { ...stack, merged: null } : null, srcW, srcH, id);
      hist.apply((e) => ({ ...e, stack: next }));
      setSelectedLayer(next.layers.find((l) => l.role === 'subject')?.id ?? null);
      ui.toast(`Фон удалён за ${(r.ms / 1000).toFixed(1)} с. Объект — отдельный слой`, 'ok');
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') ui.toast((e as Error).message || 'Не удалось удалить фон', 'error');
    } finally {
      ui.setProgress(null);
    }
  };

  /** Выбор фото с устройства: для фона или новым слоем */
  const pickFor = useRef<'background' | 'layer'>('layer');
  const photoPicker = useFilePicker('image/*', async (file) => {
    ui.setProgress({ label: 'Добавляю фото…', value: null });
    try {
      const u = URL.createObjectURL(file);
      const img = await loadImage(u).finally(() => URL.revokeObjectURL(u));
      const id = await storeFile(file);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (pickFor.current === 'background') setStack((s) => (s ? setBackground(s, srcW, srcH, 'image', { media: id, w, h }) : s));
      else {
        const r = addPhoto(stack, srcW, srcH, id, w, h, 'Фото');
        hist.apply((e) => ({ ...e, stack: r.stack }));
        setSelectedLayer(r.id);
        setPanel('layers');
      }
    } catch (e) {
      ui.toast((e as Error).message || 'Не удалось открыть фото', 'error');
    } finally {
      ui.setProgress(null);
    }
  });
  const pickPhoto = (target: 'background' | 'layer') => {
    pickFor.current = target;
    photoPicker.open();
  };

  /* ---------- Объединить / разъединить ---------- */
  const merge = async () => {
    if (!stack || !url) return;
    ui.setProgress({ label: 'Объединяю слои…', value: null });
    try {
      const img = await loadImage(url);
      const k = Math.min(1, Math.sqrt(canvasPixelLimit() / (srcW * srcH)));
      const c = await composeStack(img, { ...stack, merged: null }, blobFiles(), Math.round(srcW * k), Math.round(srcH * k));
      const alpha = stackHasAlpha({ ...stack, merged: null }, srcW, srcH);
      const b = await new Promise<Blob | null>((r) => c.toBlob(r, alpha ? 'image/png' : 'image/jpeg', 0.95));
      const w = c.width;
      const h = c.height;
      c.width = c.height = 1;
      if (!b) throw new Error('Не удалось объединить слои.');
      const id = await storeFile(b);
      setStack((s) => (s ? { ...s, merged: { media: id, w, h, alpha } } : s));
      setAdjustAll(true);
      ui.toast('Слои объединены. «Разъединить» вернёт их', 'ok');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    } finally {
      ui.setProgress(null);
    }
  };

  /* ---------- Объекты: удалить, в слой, перенести ---------- */
  // С чем работает инструмент: объединённое фото, слой или фото-основа
  const objLayer = stack && !stack.merged ? objectTargetLayer(stack, selectedLayer) : null;
  const objTarget = stack?.merged
    ? { key: stack.merged.media, url: files[stack.merged.media] ?? null, label: 'Меняется: объединённое фото.' }
    : objLayer?.media
      ? { key: objLayer.media, url: files[objLayer.media] ?? null, label: `Меняется: слой «${objLayer.name}».` }
      : { key: `doc:${docMedia ?? meta?.id}`, url: docUrl, label: stack ? `Меняется: слой «${objLayer?.name ?? 'Фото'}».` : 'Меняется: всё фото.' };

  const openObjects = () => {
    if (stack && !stack.merged && !objLayer) {
      ui.toast('Нет слоя с фото: сделайте видимым фон или добавьте фото.', 'error');
      return;
    }
    setObjects(true);
  };

  const applyObject = async (action: ObjectAction, selection: HTMLCanvasElement) => {
    if (!objTarget.url || !srcW) return;
    const ctrl = new AbortController();
    const show = (p: AiProgress) => ui.setProgress({ ...p, onCancel: () => ctrl.abort() });
    show({ value: null, label: 'Готовлю фото…' });
    try {
      const img = await loadImage(objTarget.url);
      const k = Math.min(1, Math.sqrt(canvasPixelLimit() / (img.naturalWidth * img.naturalHeight)));
      const W = Math.max(1, Math.round(img.naturalWidth * k));
      const H = Math.max(1, Math.round(img.naturalHeight * k));

      // Маска нового слоя — выделение в размере изображения (не больше 2048)
      let maskId: string | null = null;
      if (action !== 'remove') {
        const mk = Math.min(1, 2048 / Math.max(W, H));
        const [mc, mctx] = makeCanvas(Math.round(W * mk), Math.round(H * mk), true);
        mctx.drawImage(selection, 0, 0, mc.width, mc.height);
        const mb = await new Promise<Blob | null>((r) => mc.toBlob(r, 'image/png'));
        mc.width = mc.height = 1;
        if (!mb) throw new Error('Не удалось сохранить выделение.');
        maskId = await storeFile(mb);
      }

      // Удаление: новое изображение с дорисованным фоном
      let erased: { id: string; w: number; h: number; ms: number } | null = null;
      if (action !== 'layer') {
        const r = await eraseObject(img, W, H, selection, show, ctrl.signal);
        const png = (blobs.current.get(objTarget.key) ?? docBlob)?.type === 'image/png';
        const b = await new Promise<Blob | null>((res) => r.canvas.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.95));
        r.canvas.width = r.canvas.height = 1;
        if (!b) throw new Error('Не удалось сохранить фото.');
        erased = { id: await storeFile(b), w: W, h: H, ms: r.ms };
      }

      // «Перенести» с фото-основы: объект должен остаться из фото до удаления, а слой без
      // своего файла показывал бы уже новое фото — поэтому оригинал сохраняем отдельным файлом
      let docBefore: { media: string; w: number; h: number } | null = editsRef.current.stack?.photo ?? null;
      if (action === 'move' && !docBefore && !objLayer?.media && !stack?.merged && blob) docBefore = { media: await storeFile(blob), w: srcW, h: srcH };

      // Новое состояние считаем от текущих правок (после await) и применяем одним шагом отмены
      const e = editsRef.current;
      let newLayer: string | null = null;
      let s = e.stack;
      if (s?.merged) {
        if (erased) s = { ...s, merged: { ...s.merged, media: erased.id, w: erased.w, h: erased.h } };
      } else {
        if (!s) s = { layers: [sourceLayer(srcW, srcH)], merged: null, photo: null };
        const target = objectTargetLayer(s, selectedLayer)!;
        const before = target.media;
        if (maskId) {
          // Вынесенный объект — из изображения до удаления
          const r = extractLayer(s, target.id, maskId, before);
          s = r.stack;
          newLayer = r.id;
          if (!before && erased && docBefore) s = updateLayer(s, r.id, { media: docBefore.media, w: docBefore.w, h: docBefore.h });
        }
        if (erased) {
          // Фото-основу меняем целиком (через stack.photo), отдельное изображение — в самом слое
          s = before ? updateLayer(s, target.id, { media: erased.id, w: erased.w, h: erased.h }) : { ...s, photo: { media: erased.id, w: erased.w, h: erased.h } };
        }
      }
      const next = s;
      hist.apply((cur) => ({ ...cur, stack: next }));
      if (newLayer) {
        setSelectedLayer(newLayer);
        setObjects(false);
        setPanel('layers');
        ui.toast(action === 'move' ? 'Объект перенесён в слой — двигайте его пальцем' : 'Объект скопирован в отдельный слой', 'ok');
      } else if (erased) {
        ui.toast(`Объект удалён за ${(erased.ms / 1000).toFixed(1)} с`, 'ok');
      }
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') ui.toast((e as Error).message || 'Не получилось', 'error');
    } finally {
      ui.setProgress(null);
    }
  };

  /* ---------- Цветокоррекция: выбранного слоя или всего фото ---------- */
  const layerMode = !!stack && !stack.merged;
  const selLayer = layerMode ? stack!.layers.find((l) => l.id === selectedLayer) ?? null : null;
  const adjTarget: 'layer' | 'all' = selLayer && !adjustAll ? 'layer' : 'all';
  const adj: Adjust = adjTarget === 'layer' ? selLayer!.adjust : edits;
  const setAdj = (p: Partial<Adjust>, end = true) => {
    if (adjTarget === 'layer' && selLayer) setStackLive((s) => updateLayer(s, selLayer.id, { adjust: { ...selLayer.adjust, ...p } }), end);
    else setLive(p, end);
  };

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

  const onTransform = useCallback(
    (id: string, p: Pick<PhotoLayer, 'x' | 'y' | 'scale' | 'rotation'>, end: boolean) => {
      hist.live((e) => (e.stack ? { ...e, stack: updateLayer(e.stack, id, p) } : e));
      if (end) hist.endGesture();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
  const rotate = () => hist.apply((e) => ({ ...e, rotation: (e.rotation + 90) % 360, crop: rotateCropCW(e.crop) }));

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
    setPickedText(layer.id);
  };
  const pickedLayer = edits.texts.find((t) => t.id === pickedText) ?? null;
  const updateText = (id: string, p: Partial<TextLayer>, end = true) => {
    hist.live((e) => ({ ...e, texts: e.texts.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
    if (end) hist.endGesture();
  };
  const deleteText = (id: string) => {
    hist.apply((e) => ({ ...e, texts: e.texts.filter((t) => t.id !== id) }));
    setEditingText(null);
  };
  const closeTextEditor = () => {
    // Пустой текст не оставляем
    hist.apply((e) => {
      const texts = e.texts.filter((t) => t.id !== editingText || t.text.trim());
      return texts.length === e.texts.length ? e : { ...e, texts };
    });
    hist.endGesture();
    setEditingText(null);
  };

  const save = async () => {
    if (!blob || !meta) return;
    ui.setProgress({ label: 'Готовлю фото…', value: 0 });
    try {
      const type = meta.mime === 'image/png' ? 'image/png' : 'image/jpeg';
      const f = blobFiles();
      const r = await renderPhoto(blob, edits, { type, quality: 0.95, files: f, onProgress: (value, label) => ui.setProgress({ value, label }) });
      // Превью проекта с правками — для «Недавних»
      try {
        const thumb = await renderPhoto(blob, edits, { maxSide: 320, quality: 0.8, useWorker: false, files: f });
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
  const bgLayer = backgroundLayer(stack);
  const cut = !!stack?.layers.some((l) => l.role === 'subject');
  const brushLayer = brushing && stack ? stack.layers.find((l) => l.id === brushing) ?? null : null;

  const adjustTargetRow = layerMode && (panel === 'filters' || panel === 'adjust') && (
    <div className="chip-row chip-row-scroll" role="radiogroup" aria-label="Что менять">
      <button role="radio" aria-checked={adjTarget === 'layer'} disabled={!selLayer} className={`pill ${adjTarget === 'layer' ? 'is-active' : ''}`} onClick={() => setAdjustAll(false)}>
        {selLayer ? `Слой «${selLayer.name}»` : 'Слой не выбран'}
      </button>
      <button role="radio" aria-checked={adjTarget === 'all'} className={`pill ${adjTarget === 'all' ? 'is-active' : ''}`} onClick={() => setAdjustAll(true)}>
        Всё фото
      </button>
    </div>
  );

  return (
    <div className="screen screen-fixed editor">
      <TopBar
        title={cropping ? 'Обрезка' : brushLayer ? 'Кисть и ластик' : objects ? 'Объекты' : 'Редактор фото'}
        onBack={cropping ? () => setCropping(null) : brushLayer ? () => setBrushing(null) : objects ? () => setObjects(false) : undefined}
        action={
          cropping ? (
            <button className="btn btn-primary btn-sm" onClick={applyCrop}>
              Готово
            </button>
          ) : brushLayer ? null : objects ? (
            <div className="topbar-group">
              <button className="icon-btn icon-btn-sm" onClick={hist.undo} disabled={!hist.canUndo} aria-label="Отменить">
                <Icon name="undo" size={20} />
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setObjects(false)}>
                Готово
              </button>
            </div>
          ) : (
            <div className="topbar-group">
              <button className="icon-btn icon-btn-sm" onClick={hist.undo} disabled={!hist.canUndo} aria-label="Отменить">
                <Icon name="undo" size={20} />
              </button>
              <button className="icon-btn icon-btn-sm" onClick={hist.redo} disabled={!hist.canRedo} aria-label="Повторить">
                <Icon name="redo" size={20} />
              </button>
              <button className="btn btn-primary btn-sm" onClick={save} disabled={!blob}>
                Сохранить
              </button>
            </div>
          )
        }
      />

      {objects ? (
        objTarget.url ? (
          <ObjectTool
            key={objTarget.url}
            url={objTarget.url}
            imageKey={objTarget.key}
            targetLabel={objTarget.label}
            canLayer={!stack?.merged}
            onApply={applyObject}
          />
        ) : (
          <div className="photo-stage">
            <div className="skeleton fill" />
          </div>
        )
      ) : brushLayer && docUrl ? (
        <MaskBrush
          layer={brushLayer}
          srcUrl={docUrl}
          files={files}
          blobs={blobs.current}
          docW={srcW}
          docH={srcH}
          onDone={async (maskBlob) => {
            if (maskBlob) {
              const id = await storeFile(maskBlob);
              setStack((s) => (s ? updateLayer(s, brushLayer.id, { mask: id }) : s));
            }
            setBrushing(null);
          }}
        />
      ) : (
        <>
          <div className="photo-stage">
            <PhotoView
              url={docUrl}
              srcW={srcW}
              srcH={srcH}
              edits={edits}
              loading={loading}
              crop={cropping ? { rect: cropping.rect, rn: aspectRn, onChange: (rect) => setCropping((c) => (c ? { ...c, rect } : c)) } : null}
              selectedText={editingText ?? (panel === 'text' && edits.texts.some((t) => t.id === pickedText) ? pickedText : null)}
              onTextChange={(id, g) => updateText(id, g, false)}
              onTextEnd={() => hist.endGesture()}
              onTextTap={(id) => {
                setPanel('text');
                if (pickedText === id) setEditingText(id);
                else setPickedText(id);
              }}
              onMediaError={() => setMediaFailed(true)}
              files={files}
              blurUrl={blurUrl}
              layerEdit={panel === 'layers' && layerMode ? { selected: selectedLayer, onSelect: setSelectedLayer, onTransform } : null}
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
            {photoPicker.input}
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
              <nav className="toolbar toolbar-top toolbar-scroll" aria-label="Инструменты фото">
                <button className={`tool ${panel === 'background' ? 'is-active' : ''}`} onClick={() => setPanel('background')}>
                  <Icon name="cutout" size={24} />
                  <span>Фон</span>
                  <i className="tool-dot tool-dot-ai" aria-hidden="true" />
                </button>
                <button className="tool" onClick={openObjects}>
                  <Icon name="target" size={24} />
                  <span>Объекты</span>
                  <i className="tool-dot tool-dot-ai" aria-hidden="true" />
                </button>
                <button className={`tool ${panel === 'layers' ? 'is-active' : ''}`} onClick={() => setPanel('layers')}>
                  <Icon name="layers" size={24} />
                  <span>Слои</span>
                </button>
                <button className={`tool ${panel === 'filters' ? 'is-active' : ''}`} onClick={() => setPanel('filters')}>
                  <Icon name="filters" size={24} />
                  <span>Фильтры</span>
                </button>
                <button className={`tool ${panel === 'adjust' ? 'is-active' : ''}`} onClick={() => setPanel('adjust')}>
                  <Icon name="sliders" size={24} />
                  <span>Настройки</span>
                </button>
                <button className="tool" onClick={startCrop}>
                  <Icon name="crop" size={24} />
                  <span>Обрезать</span>
                </button>
                <button className="tool" onClick={rotate}>
                  <Icon name="rotate" size={24} />
                  <span>Поворот</span>
                </button>
                <button className={`tool ${panel === 'text' ? 'is-active' : ''}`} onClick={() => setPanel('text')}>
                  <Icon name="text" size={24} />
                  <span>Текст</span>
                </button>
              </nav>

              <div className="photo-panel">
                {adjustTargetRow}

                {panel === 'filters' && (
                  <div className="chip-row chip-row-scroll preset-groups" role="tablist" aria-label="Группы фильтров">
                    {PRESET_GROUPS.map((g) => (
                      <button key={g.id} role="tab" aria-selected={presetGroup === g.id} className={`pill pill-sm ${presetGroup === g.id ? 'is-active' : ''}`} onClick={() => setPresetGroup(g.id)}>
                        {g.label}
                      </button>
                    ))}
                  </div>
                )}
                {panel === 'filters' && (
                  <div className="preset-row" role="listbox" aria-label="Фильтры">
                    {PRESETS.filter((p) => presetGroup === 'all' || p.id === 'original' || p.group === presetGroup).map((p) => {
                      const t = temperatureLayer(NEUTRAL_ADJUST, p.id);
                      return (
                        <button
                          key={p.id}
                          role="option"
                          aria-selected={adj.preset === p.id}
                          className={`preset ${adj.preset === p.id ? 'is-active' : ''}`}
                          onClick={() => setAdj({ preset: p.id })}
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
                          className={`adjust-tab ${activeAdjust === a.key ? 'is-active' : ''} ${adj[a.key] !== 0 ? 'is-changed' : ''}`}
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
                        value={adj[current.key]}
                        onChange={(e) => setAdj({ [current.key]: Number(e.target.value) }, false)}
                        onPointerUp={() => hist.endGesture()}
                        onKeyUp={() => hist.endGesture()}
                        onDoubleClick={() => setAdj({ [current.key]: 0 })}
                        aria-label={current.label}
                      />
                      <output className="slider-value" htmlFor={`adj-${current.key}`}>
                        {adj[current.key] > 0 ? `+${adj[current.key]}` : adj[current.key]}
                      </output>
                    </div>
                  </div>
                )}

                {panel === 'background' && (
                  <BackgroundPanel
                    cut={cut}
                    merged={!!stack?.merged}
                    mode={bgModeOf(bgLayer)}
                    bg={bgLayer}
                    onRemove={removeBackground}
                    onMode={(m: BgMode) => setStack((s) => (s ? setBackground(s, srcW, srcH, m) : s))}
                    onColor={(c) => setStack((s) => (s ? setBackground(s, srcW, srcH, 'color', { color: c }) : s))}
                    onBlur={(v, end) => bgLayer && setStackLive((s) => updateLayer(s, bgLayer.id, { blur: v }), end)}
                    onPickImage={() => pickPhoto('background')}
                    onRestore={() =>
                      setStack((s) => {
                        if (!s) return s;
                        const rest = s.layers.filter((l) => l.role !== 'subject' && l.role !== 'background');
                        const base = { ...backgroundLayer(setBackground(s, srcW, srcH, 'original'))!, role: undefined, name: 'Фото' };
                        return rest.length || s.photo ? { layers: [base, ...rest], merged: null, photo: s.photo ?? null } : null;
                      })
                    }
                  />
                )}

                {panel === 'layers' && (
                  <LayersPanel
                    stack={stack}
                    selected={selectedLayer}
                    files={files}
                    srcUrl={docUrl}
                    blurUrl={blurUrl}
                    onSelect={setSelectedLayer}
                    onUpdate={(id, p, end) => setStackLive((s) => updateLayer(s, id, p), end)}
                    onMove={(id, dir) => setStack((s) => (s ? moveLayer(s, id, dir) : s))}
                    onDuplicate={(id) => {
                      if (!stack) return;
                      const r = duplicateLayer(stack, id);
                      hist.apply((e) => ({ ...e, stack: r.stack }));
                      setSelectedLayer(r.id);
                    }}
                    onRemove={(id) => {
                      setStack((s) => (s ? removeLayer(s, id) : s));
                      setSelectedLayer(null);
                    }}
                    onAddPhoto={() => pickPhoto('layer')}
                    onMerge={merge}
                    onUnmerge={() => {
                      setStack((s) => (s ? { ...s, merged: null } : s));
                      setAdjustAll(false);
                    }}
                    onBrush={setBrushing}
                  />
                )}

                {panel === 'text' && (
                  <div className="text-panel">
                    <div className="chip-row chip-row-scroll">
                      <button className="pill pill-add" onClick={addText}>
                        <Icon name="plus" size={16} stroke={2.6} /> Добавить текст
                      </button>
                      {edits.texts.map((t) => (
                        <button
                          key={t.id}
                          className={`pill ${pickedText === t.id ? 'is-active' : ''}`}
                          onClick={() => {
                            setPickedText(t.id);
                            setEditingText(t.id);
                          }}
                        >
                          {t.text.split('\n')[0].slice(0, 18) || 'Текст'}
                        </button>
                      ))}
                    </div>
                    {pickedLayer ? (
                      <TextSizeControl
                        size={pickedLayer.size}
                        rotation={pickedLayer.rotation}
                        onChange={(size) => updateText(pickedLayer.id, { size }, false)}
                        onEnd={() => hist.endGesture()}
                        onResetRotation={() => updateText(pickedLayer.id, { rotation: 0 })}
                      />
                    ) : null}
                    <p className="muted small">{edits.texts.length ? (pickedLayer ? 'Размер — ползунком или двумя пальцами. Двигайте текст пальцем; нажмите ещё раз — изменить слова.' : 'Выберите надпись, чтобы изменить размер.') : 'Надпись появится в центре фото.'}</p>
                  </div>
                )}

                <div className="panel-foot">
                  <span className="muted small">{persisted ? 'Правки сохраняются автоматически' : 'Хранилище недоступно — правки не сохранятся'}</span>
                  {isEdited(edits) && (
                    <button className="link-btn" onClick={() => hist.apply(() => ({ ...DEFAULT_EDITS }))}>
                      <Icon name="reset" size={16} /> Сбросить всё
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      <TextSheet
        layer={editingLayer}
        onChange={(p) => editingLayer && updateText(editingLayer.id, p, false)}
        onDelete={() => editingLayer && deleteText(editingLayer.id)}
        onClose={closeTextEditor}
      />
      <ExportSheet result={result} filename={filename} onClose={() => setResult(null)} />
    </div>
  );
}
