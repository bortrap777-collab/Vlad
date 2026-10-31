/**
 * Анимация надписей и пословные субтитры: одна функция состояния для предпросмотра (DOM)
 * и экспорта (canvas), поэтому в готовом видео текст ведёт себя так же, как на экране.
 */
import { TEXT_FONTS, type TextLayer } from '../photo/pipeline';
import type { TextAnim, VideoText } from './model';

export interface TextState {
  opacity: number;
  /** Размытие, доли кегля */
  blur: number;
  scale: number;
  /** Сдвиг, доли кегля */
  dx: number;
  dy: number;
  /** Доля видимых букв (печать), null — все */
  chars: number | null;
  /** Свечение 0…1 */
  glow: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const backOut = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const bounceOut = (x: number) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

function applyAnim(s: TextState, anim: TextAnim | undefined, p: number, dir: 1 | -1): void {
  if (!anim || anim === 'none' || p >= 1) return;
  const e = easeOut(clamp01(p));
  const r = 1 - e;
  switch (anim) {
    case 'fade':
      s.opacity *= e;
      break;
    case 'blur':
      s.blur += r * 0.5;
      s.opacity *= clamp01(e * 1.6);
      s.scale *= 1 + r * 0.06;
      break;
    case 'zoom':
      s.scale *= dir === 1 ? 1 + r * 0.7 : 1 - r * 0.45;
      s.opacity *= e;
      break;
    case 'pop':
      s.scale *= Math.max(0, backOut(clamp01(p)));
      s.opacity *= clamp01(p * 3);
      break;
    case 'up':
      s.dy += r * 1.1 * dir;
      s.opacity *= e;
      break;
    case 'down':
      s.dy -= r * 1.1 * dir;
      s.opacity *= e;
      break;
    case 'left':
      s.dx -= r * 2.5 * dir;
      s.opacity *= e;
      break;
    case 'type':
      s.chars = Math.min(s.chars ?? 1, clamp01(p));
      break;
    case 'bounce':
      s.dy -= (1 - bounceOut(clamp01(p))) * 2.2;
      s.opacity *= clamp01(p * 5);
      break;
    case 'glow':
      s.glow = Math.max(s.glow, r);
      s.opacity *= clamp01(e * 1.4);
      s.scale *= 1 + r * 0.08;
      break;
  }
}

/** Состояние надписи в момент T (null — не видна) */
export function textState(t: VideoText, T: number): TextState | null {
  if (T < t.start || T >= t.end) return null;
  const s: TextState = { opacity: t.opacity ?? 1, blur: 0, scale: 1, dx: 0, dy: 0, chars: null, glow: 0 };
  const d = Math.max(0.05, Math.min(t.animDur ?? 0.5, (t.end - t.start) / 2));
  applyAnim(s, t.animIn, (T - t.start) / d, 1);
  applyAnim(s, t.animOut, (t.end - T) / d, -1);
  return s;
}

/** Пословный режим: какие слова видны и какое звучит сейчас */
export function wordsState(t: VideoText, T: number): { visible: boolean[]; current: number } | null {
  const ws = t.words;
  if (!ws?.length || (t.wordMode ?? 'build') === 'phrase') return null;
  let current = -1;
  for (let i = 0; i < ws.length; i++) if (T >= ws[i].s) current = i;
  const mode = t.wordMode ?? 'build';
  const visible = ws.map((_, i) => (mode === 'karaoke' ? true : mode === 'single' ? i === current : i <= current));
  return { visible, current };
}

/** Строки и слова надписи (порядок слов совпадает с words) */
export function splitWords(text: string): string[][] {
  return text.split('\n').map((l) => l.split(/\s+/).filter(Boolean));
}

/* ---------------- Рисование на холсте (экспорт) ---------------- */
let canFilter: boolean | null = null;
function filterSupported(ctx: CanvasRenderingContext2D): boolean {
  if (canFilter === null) {
    try {
      ctx.filter = 'blur(1px)';
      canFilter = ctx.filter === 'blur(1px)';
      ctx.filter = 'none';
    } catch {
      canFilter = false;
    }
  }
  return canFilter;
}

export function inkFor(t: TextLayer): string {
  if (t.style === 'box') return boxInk(t.color);
  if (t.style === 'neon') return mixWhite(t.color, 0.55);
  return t.color;
}

export function boxInk(bg: string): string {
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111111' : '#FFFFFF';
}

function mixWhite(hex: string, k: number): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return '#' + c.map((v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0')).join('');
}

/** Контур — тёмный для светлого текста и наоборот */
export function outlineColor(color: string): string {
  return boxInk(color) === '#111111' ? '#111111' : '#FFFFFF';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Надпись целиком (стиль, слова, печать) в начале координат ctx.
 * visible — какие слова видны; current — подсвеченное слово (караоке).
 */
function drawBlock(ctx: CanvasRenderingContext2D, t: VideoText, fs: number, words: { visible: boolean[]; current: number } | null, chars: number | null, glow: number) {
  const def = TEXT_FONTS[t.font] ?? TEXT_FONTS.accent;
  ctx.font = `${def.weight} ${fs}px ${def.family}`;
  ctx.textBaseline = 'middle';
  const lh = fs * 1.2;
  const single = words && (t.wordMode ?? 'build') === 'single';
  let lines = splitWords(t.text);
  // Режим «одно слово» — рисуем только текущее слово
  let visible = words?.visible;
  if (single && words) {
    const all = lines.flat();
    const w = words.current >= 0 ? all[words.current] : '';
    lines = [w ? [w] : []];
    visible = [true];
  }
  // Печать: обрезаем по числу букв
  if (chars !== null && !words) {
    const full = t.text;
    const n = Math.round(full.length * chars);
    lines = splitWords(full.slice(0, n));
  }
  const space = ctx.measureText(' ').width;
  const lineW = lines.map((ws) => ws.reduce((a, w) => a + ctx.measureText(w).width, 0) + space * Math.max(0, ws.length - 1));
  const blockH = lines.length * lh;
  const maxW = Math.max(0, ...lineW);

  if (t.style === 'box' && maxW > 0) {
    const padX = fs * 0.5;
    const padY = fs * 0.25;
    roundRect(ctx, -maxW / 2 - padX, -blockH / 2 - padY, maxW + padX * 2, blockH + padY * 2, fs * 0.3);
    ctx.fillStyle = t.color;
    ctx.fill();
  }
  const ink = inkFor(t);
  const hl = t.highlight ?? '#FFD84D';
  let wi = 0;
  lines.forEach((ws, li) => {
    let x = -lineW[li] / 2;
    const y = -blockH / 2 + lh * (li + 0.5);
    ws.forEach((w) => {
      const idx = wi++;
      const ww = ctx.measureText(w).width;
      const show = !visible || visible[idx] !== false;
      if (show) {
        const color = words && !single && (t.wordMode === 'karaoke' ? idx === words.current : false) ? hl : ink;
        ctx.save();
        ctx.textAlign = 'left';
        if (t.style === 'shadow') {
          ctx.shadowColor = 'rgba(0,0,0,0.55)';
          ctx.shadowBlur = fs * 0.25;
          ctx.shadowOffsetY = fs * 0.05;
        }
        if (t.style === 'outline') {
          ctx.lineJoin = 'round';
          ctx.lineWidth = fs * 0.14;
          ctx.strokeStyle = outlineColor(t.color);
          ctx.strokeText(w, x, y);
        }
        if (t.style === 'neon' || glow > 0) {
          ctx.shadowColor = t.style === 'neon' ? t.color : '#FFFFFF';
          ctx.shadowBlur = fs * (0.35 + glow * 0.6);
          ctx.fillStyle = color;
          ctx.fillText(w, x, y);
          ctx.shadowBlur = fs * (0.12 + glow * 0.3);
        }
        ctx.fillStyle = color;
        ctx.fillText(w, x, y);
        ctx.restore();
      }
      x += ww + space;
    });
  });
}

/** Нарисовать надпись монтажа в момент T на кадре W×H */
export function drawVideoText(ctx: CanvasRenderingContext2D, t: VideoText, T: number, W: number, H: number): void {
  if (!t.text.trim()) return;
  const st = textState(t, T);
  if (!st || st.opacity <= 0.003) return;
  const words = wordsState(t, T);
  if (words && !words.visible.some(Boolean)) return;
  const fs = t.size * W;
  const blurPx = st.blur * fs;
  const draw = (c: CanvasRenderingContext2D) => {
    c.translate(t.x * W, t.y * H);
    if (t.rotation) c.rotate((t.rotation * Math.PI) / 180);
    c.translate(st.dx * fs, st.dy * fs);
    if (st.scale !== 1) c.scale(st.scale, st.scale);
    drawBlock(c, t, fs, words, st.chars, st.glow);
  };
  ctx.save();
  ctx.globalAlpha = Math.min(1, st.opacity);
  if (blurPx > 0.5 && filterSupported(ctx)) {
    ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
    draw(ctx);
  } else if (blurPx > 0.5) {
    // Без canvas.filter (старый Safari): рисуем уменьшенную копию и растягиваем — получается размытие
    const k = Math.max(0.08, Math.min(1, 1 / (1 + blurPx / 3)));
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.round(W * k));
    tmp.height = Math.max(1, Math.round(H * k));
    const x = tmp.getContext('2d')!;
    x.scale(k, k);
    draw(x);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 0, 0, W, H);
  } else draw(ctx);
  ctx.restore();
}
