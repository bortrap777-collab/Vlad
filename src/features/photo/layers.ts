/**
 * Слои фоторедактора. Документ — исходное фото (без поворота и обрезки):
 * слои рисуются в его координатах снизу вверх, а поворот, обрезка, общие фильтры
 * и надписи применяются потом ко всей композиции.
 *
 * Положение слоя: центр (x, y) в долях документа, scale — ширина слоя в долях ширины
 * документа, rotation — градусы по часовой. Слои «цвет» и «размытие» занимают весь документ.
 * Все изменения — неизменяемые операции, как в монтаже видео.
 */
import { newId } from '../../lib/db';

export type LayerKind = 'photo' | 'color' | 'blur';

export interface Adjust {
  preset: import('./pipeline').PresetId;
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
}

export const NEUTRAL_ADJUST: Adjust = { preset: 'original', brightness: 0, contrast: 0, saturation: 0, temperature: 0 };

export interface PhotoLayer {
  id: string;
  name: string;
  kind: LayerKind;
  /** Фон, которым управляет панель «Фон» (нижний слой после удаления фона) */
  role?: 'background' | 'subject';
  /** id файла изображения; null — исходное фото проекта */
  media: string | null;
  /** id маски (PNG, прозрачность = вырезано) */
  mask: string | null;
  /** Натуральный размер изображения слоя */
  w: number;
  h: number;
  color: string;
  /** Размытие 0…1 (слой «размытие») */
  blur: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flip: boolean;
  opacity: number;
  visible: boolean;
  adjust: Adjust;
}

export interface LayerStack {
  layers: PhotoLayer[];
  /** Объединённое изображение (id файла); слои сохраняются, чтобы можно было разъединить */
  merged: { media: string; w: number; h: number; alpha: boolean } | null;
  /**
   * Исходное фото после удаления объектов (id файла, те же пропорции). Слои с media = null
   * и размытый фон берут его вместо оригинала — так удалённый объект не возвращается
   * ни в вырезанном объекте, ни в фоне.
   */
  photo?: { media: string; w: number; h: number } | null;
}

export type BgMode = 'original' | 'none' | 'color' | 'blur' | 'image';

export const isFullFrame = (l: PhotoLayer) => l.kind !== 'photo';

function base(p: Partial<PhotoLayer> & Pick<PhotoLayer, 'name' | 'kind'>): PhotoLayer {
  return {
    id: newId(),
    media: null,
    mask: null,
    w: 1,
    h: 1,
    color: '#FFFFFF',
    blur: 0.5,
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    flip: false,
    opacity: 1,
    visible: true,
    adjust: { ...NEUTRAL_ADJUST },
    ...p,
  };
}

/** Исходное фото как слой во весь документ */
export function sourceLayer(docW: number, docH: number, p: Partial<PhotoLayer> = {}): PhotoLayer {
  return base({ name: 'Фото', kind: 'photo', w: docW, h: docH, ...p });
}

/** Слои после удаления фона: фон (исходное фото) + объект (то же фото по маске) */
export function withCutout(stack: LayerStack | null, docW: number, docH: number, mask: string): LayerStack {
  const layers = stack ? [...stack.layers] : [sourceLayer(docW, docH, { name: 'Фон', role: 'background' })];
  let bgIndex = layers.findIndex((l) => l.role === 'background');
  if (bgIndex < 0) {
    // Слои уже были (например, добавленные фото): нижний слой становится фоном
    layers[0] = { ...layers[0], role: 'background', name: 'Фон' };
    bgIndex = 0;
  }
  const old = layers.findIndex((l) => l.role === 'subject');
  const subject = sourceLayer(docW, docH, { name: 'Объект', role: 'subject', mask });
  if (old >= 0) layers[old] = { ...subject, id: layers[old].id };
  else layers.splice(bgIndex + 1, 0, subject);
  return { layers, merged: null, photo: stack?.photo ?? null };
}

export function backgroundLayer(stack: LayerStack | null): PhotoLayer | null {
  return stack?.layers.find((l) => l.role === 'background') ?? null;
}

export function bgModeOf(l: PhotoLayer | null): BgMode {
  if (!l) return 'original';
  if (!l.visible) return 'none';
  if (l.kind === 'color') return 'color';
  if (l.kind === 'blur') return 'blur';
  return l.media ? 'image' : 'original';
}

/** Масштаб, при котором изображение w×h закрывает весь документ */
export function coverScale(w: number, h: number, docW: number, docH: number): number {
  return Math.max(1, (docH * w) / (docW * h));
}

export function setBackground(stack: LayerStack, docW: number, docH: number, mode: BgMode, p: { color?: string; media?: string; w?: number; h?: number } = {}): LayerStack {
  return {
    ...stack,
    layers: stack.layers.map((l) => {
      if (l.role !== 'background') return l;
      const keep = { id: l.id, role: l.role, name: 'Фон', adjust: l.adjust, opacity: l.opacity };
      switch (mode) {
        case 'none':
          return { ...l, visible: false };
        case 'color':
          return base({ ...keep, kind: 'color', color: p.color ?? (l.kind === 'color' ? l.color : '#FFFFFF') });
        case 'blur':
          return base({ ...keep, kind: 'blur', blur: l.kind === 'blur' ? l.blur : 0.5 });
        case 'image': {
          const w = p.w ?? l.w;
          const h = p.h ?? l.h;
          return base({ ...keep, kind: 'photo', media: p.media ?? l.media, w, h, scale: coverScale(w, h, docW, docH) });
        }
        default:
          return sourceLayer(docW, docH, keep);
      }
    }),
  };
}

/** Новое фото поверх остальных, по центру, ~60 % ширины документа */
export function addPhoto(stack: LayerStack | null, docW: number, docH: number, media: string, w: number, h: number, name = 'Фото'): { stack: LayerStack; id: string } {
  const layers = stack ? [...stack.layers] : [sourceLayer(docW, docH, { name: 'Фото' })];
  const fit = Math.min(0.6, (0.6 * docH * w) / (docW * h));
  const layer = base({ name, kind: 'photo', media, w, h, scale: fit });
  layers.push(layer);
  return { stack: { layers, merged: null, photo: stack?.photo ?? null }, id: layer.id };
}

export function updateLayer(stack: LayerStack, id: string, p: Partial<PhotoLayer>): LayerStack {
  return { ...stack, layers: stack.layers.map((l) => (l.id === id ? { ...l, ...p } : l)) };
}

export function moveLayer(stack: LayerStack, id: string, dir: 1 | -1): LayerStack {
  const i = stack.layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= stack.layers.length) return stack;
  const layers = [...stack.layers];
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...stack, layers };
}

export function duplicateLayer(stack: LayerStack, id: string): { stack: LayerStack; id: string } {
  const i = stack.layers.findIndex((l) => l.id === id);
  if (i < 0) return { stack, id };
  const src = stack.layers[i];
  const copy: PhotoLayer = { ...src, id: newId(), role: undefined, name: `${src.name} (копия)`, x: Math.min(0.95, src.x + 0.04), y: Math.min(0.95, src.y + 0.04) };
  const layers = [...stack.layers];
  layers.splice(i + 1, 0, copy);
  return { stack: { ...stack, layers }, id: copy.id };
}

export function removeLayer(stack: LayerStack, id: string): LayerStack | null {
  const layers = stack.layers.filter((l) => l.id !== id);
  if (layers.length) return { ...stack, layers };
  // Фото после удаления объектов не теряем: остаётся слой с ним
  return stack.photo ? { ...stack, layers: [sourceLayer(stack.photo.w, stack.photo.h)] } : null;
}

/** Файлы, на которые ссылаются слои */
export function stackMediaIds(stack: LayerStack | null | undefined): string[] {
  if (!stack) return [];
  const ids = new Set<string>();
  for (const l of stack.layers) {
    if (l.media) ids.add(l.media);
    if (l.mask) ids.add(l.mask);
  }
  if (stack.merged) ids.add(stack.merged.media);
  if (stack.photo) ids.add(stack.photo.media);
  return [...ids];
}

/** Размер слоя в долях документа (ширина, высота) */
export function layerBox(l: PhotoLayer, docW: number, docH: number): { w: number; h: number } {
  if (isFullFrame(l)) return { w: 1, h: 1 };
  return { w: l.scale, h: (l.scale * docW * l.h) / (l.w * docH) };
}

/** Новый слой из части слоя: то же изображение и положение, маска — выделение */
export function extractLayer(stack: LayerStack, fromId: string, mask: string, media: string | null, name = 'Объект'): { stack: LayerStack; id: string } {
  const i = stack.layers.findIndex((l) => l.id === fromId);
  const src = stack.layers[i];
  const layer: PhotoLayer = { ...src, id: newId(), role: undefined, name, media, mask, opacity: 1, visible: true };
  const layers = [...stack.layers];
  layers.splice(i + 1, 0, layer);
  return { stack: { ...stack, layers, merged: null }, id: layer.id };
}

/**
 * Слой, с которым работает инструмент «Объекты»: выбранное добавленное фото (целое, без маски)
 * или фото-основа. Вырезанные объекты (слои с маской) не берём: в них видна только часть
 * изображения, и удаление в невидимой части выглядело бы как «ничего не произошло».
 */
export function objectTargetLayer(stack: LayerStack, selected: string | null): PhotoLayer | null {
  const photos = stack.layers.filter((l) => l.kind === 'photo' && l.visible);
  const sel = photos.find((l) => l.id === selected && l.media && !l.mask);
  return sel ?? photos.find((l) => l.role === 'background') ?? photos.find((l) => !l.media && !l.mask) ?? photos.find((l) => !l.media) ?? photos[0] ?? null;
}
