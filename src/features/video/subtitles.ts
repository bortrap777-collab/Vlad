/**
 * Фразы распознанной речи → субтитры (обычные надписи монтажа с флагом subtitle).
 * Длинная фраза делится на карточки по 1–2 строки под ширину кадра,
 * время карточек — пропорционально длине текста.
 */
import { newId } from '../../lib/db';
import type { TimedWord, VideoText, WordMode } from './model';

export type SubtitleStyle = 'classic' | 'box' | 'yellow' | 'neon';

export const SUBTITLE_STYLES: { id: SubtitleStyle; label: string }[] = [
  { id: 'classic', label: 'Белые с тенью' },
  { id: 'yellow', label: 'Жёлтые с контуром' },
  { id: 'box', label: 'На плашке' },
  { id: 'neon', label: 'Неон' },
];

export interface SpeechSegment {
  start: number;
  end: number;
  text: string;
  words?: { text: string; start: number; end: number }[];
}

function styleProps(style: SubtitleStyle): Pick<VideoText, 'color' | 'style' | 'font'> {
  if (style === 'box') return { color: '#111111', style: 'box', font: 'accent' };
  if (style === 'yellow') return { color: '#FFD84D', style: 'outline', font: 'heavy' };
  if (style === 'neon') return { color: '#C77DFF', style: 'neon', font: 'wide' };
  return { color: '#FFFFFF', style: 'shadow', font: 'heavy' };
}

/** Размер шрифта (доля ширины кадра) и строк в карточке — от пропорций кадра */
export function subtitleMetrics(ratio: number): { size: number; maxChars: number } {
  const size = ratio < 0.8 ? 0.064 : ratio < 1.2 ? 0.052 : 0.04;
  // Ширина строки ~88 % кадра, средняя ширина буквы жирного шрифта ~0,58 кегля
  const maxChars = Math.max(14, Math.floor(0.88 / (0.58 * size)));
  return { size, maxChars };
}

/**
 * Фразы → карточки субтитров. Длинная фраза делится на карточки по 1–2 строки.
 * Если у фразы есть слова со временем, каждое слово карточки знает свой момент:
 * слово появляется, когда его произносят, а карточка исчезает, как только начинается следующая.
 */
export function segmentsToSubtitles(segments: SpeechSegment[], opts: { ratio: number; style: SubtitleStyle; total: number; mode: WordMode }): VideoText[] {
  const { size, maxChars } = subtitleMetrics(opts.ratio);
  const look = styleProps(opts.style);
  type Card = { text: string; start: number; end: number; words?: TimedWord[] };
  const cards: Card[] = [];
  const perCard = opts.mode === 'single' ? 1 : 2;
  for (const seg of segments) {
    const timed = seg.words?.filter((w) => w.text.trim()) ?? [];
    const words = timed.length ? timed.map((w) => w.text.trim()) : seg.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) continue;
    // Карточки: строки по ширине кадра, по две строки в карточке
    const lines: string[][] = [];
    let cur: string[] = [];
    for (const w of words) {
      const len = cur.join(' ').length;
      if (cur.length && len + 1 + w.length > maxChars) {
        lines.push(cur);
        cur = [w];
      } else cur.push(w);
    }
    if (cur.length) lines.push(cur);
    const segStart = Math.max(0, seg.start);
    const segEnd = Math.min(opts.total, Math.max(seg.end, segStart + 0.4));
    let wi = 0;
    const totalChars = words.join(' ').length || 1;
    let t = segStart;
    for (let i = 0; i < lines.length; i += perCard) {
      const group = lines.slice(i, i + perCard);
      const n = group.reduce((a, l) => a + l.length, 0);
      const text = group.map((l) => l.join(' ')).join('\n');
      if (timed.length) {
        const ws = timed.slice(wi, wi + n).map((w) => ({ w: w.text.trim(), s: Math.max(0, w.start), e: Math.min(opts.total, w.end) }));
        wi += n;
        if (!ws.length) continue;
        cards.push({ text, start: ws[0].s, end: Math.max(ws[ws.length - 1].e, ws[0].s + 0.3), words: ws });
      } else {
        const len = ((segEnd - segStart) * text.length) / totalChars;
        const end = i + perCard >= lines.length ? segEnd : Math.min(segEnd, t + Math.max(0.4, len));
        if (end - t >= 0.2) cards.push({ text, start: t, end });
        t = end;
      }
    }
  }
  cards.sort((a, b) => a.start - b.start);
  // Карточка держится чуть дольше последнего слова, но исчезает в тот же миг, когда начинается следующая
  return cards.map((c, i) => {
    const next = cards[i + 1];
    const hold = Math.min(opts.total, c.end + 0.5);
    const end = next ? Math.min(Math.max(c.end, Math.min(hold, next.start)), next.start) : hold;
    const start = Math.min(c.start, end - 0.1);
    return {
      id: newId(),
      text: c.text,
      x: 0.5,
      y: opts.mode === 'single' ? 0.72 : 0.84,
      size: opts.mode === 'single' ? size * 1.5 : size,
      rotation: 0,
      ...look,
      start,
      end: Math.max(start + 0.1, end),
      subtitle: true,
      words: c.words,
      wordMode: c.words ? opts.mode : undefined,
      animIn: c.words ? 'none' : 'fade',
      animOut: 'none',
      animDur: 0.15,
    };
  });
}
