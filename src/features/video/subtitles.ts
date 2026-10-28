/**
 * Фразы распознанной речи → субтитры (обычные надписи монтажа с флагом subtitle).
 * Длинная фраза делится на карточки по 1–2 строки под ширину кадра,
 * время карточек — пропорционально длине текста.
 */
import { newId } from '../../lib/db';
import type { VideoText } from './model';

export type SubtitleStyle = 'classic' | 'box' | 'yellow';

export const SUBTITLE_STYLES: { id: SubtitleStyle; label: string }[] = [
  { id: 'classic', label: 'Белые с тенью' },
  { id: 'box', label: 'На плашке' },
  { id: 'yellow', label: 'Жёлтые' },
];

export interface SpeechSegment {
  start: number;
  end: number;
  text: string;
}

function styleProps(style: SubtitleStyle): Pick<VideoText, 'color' | 'style' | 'font'> {
  if (style === 'box') return { color: '#111111', style: 'box', font: 'accent' };
  if (style === 'yellow') return { color: '#FFD84D', style: 'shadow', font: 'accent' };
  return { color: '#FFFFFF', style: 'shadow', font: 'accent' };
}

/** Размер шрифта (доля ширины кадра) и строк в карточке — от пропорций кадра */
export function subtitleMetrics(ratio: number): { size: number; maxChars: number } {
  const size = ratio < 0.8 ? 0.064 : ratio < 1.2 ? 0.052 : 0.04;
  // Ширина строки ~88 % кадра, средняя ширина буквы жирного шрифта ~0,56 кегля
  const maxChars = Math.max(14, Math.floor(0.88 / (0.56 * size)));
  return { size, maxChars };
}

/** Разбить текст на строки не длиннее maxChars, не разрывая слов */
function wrap(words: string[], maxChars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function segmentsToSubtitles(segments: SpeechSegment[], opts: { ratio: number; style: SubtitleStyle; total: number }): VideoText[] {
  const { size, maxChars } = subtitleMetrics(opts.ratio);
  const look = styleProps(opts.style);
  const out: VideoText[] = [];
  for (const seg of segments) {
    const words = seg.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) continue;
    const lines = wrap(words, maxChars);
    // Карточки по две строки
    const cards: string[] = [];
    for (let i = 0; i < lines.length; i += 2) cards.push(lines.slice(i, i + 2).join('\n'));
    const start = Math.max(0, seg.start);
    const end = Math.min(opts.total, Math.max(seg.end, start + 0.4));
    const totalChars = cards.reduce((a, c) => a + c.length, 0) || 1;
    let t = start;
    cards.forEach((text, k) => {
      const len = k === cards.length - 1 ? end - t : ((end - start) * text.length) / totalChars;
      const cardEnd = Math.min(end, t + Math.max(0.4, len));
      if (cardEnd - t >= 0.2) out.push({ id: newId(), text, x: 0.5, y: 0.84, size, rotation: 0, ...look, start: t, end: cardEnd, subtitle: true });
      t = cardEnd;
    });
  }
  return out;
}
