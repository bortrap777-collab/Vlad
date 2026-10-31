import { useCallback, useEffect, useRef, useState } from 'react';
import { TextItem, textStyle, type TextGeometry } from '../photo/PhotoView';
import { splitWords, textState, wordsState } from './textFx';
import type { VideoText } from './model';

interface Props {
  texts: VideoText[];
  dw: number;
  dh: number;
  selectedId: string | null;
  subscribe: (f: (t: number) => void) => () => void;
  timeRef: { current: number };
  onChange: (id: string, g: TextGeometry) => void;
  onEnd: () => void;
  onTap: (id: string) => void;
  /** Пауза: выбранную надпись показываем целиком, без анимации — чтобы было видно, что правишь */
  still: boolean;
}

interface Parts {
  root: HTMLSpanElement | null;
  words: (HTMLSpanElement | null)[];
  shown: HTMLSpanElement | null;
  rest: HTMLSpanElement | null;
}

/**
 * Надписи и субтитры поверх видео. Какие видны и как анимированы — обновляется на каждом кадре
 * прямо в DOM (без перерисовки React), поэтому слова субтитров появляются точно в свой момент.
 */
export function VideoTexts({ texts, dw, dh, selectedId, subscribe, timeRef, onChange, onEnd, onTap, still }: Props) {
  const list = useRef(texts);
  list.current = texts;
  const [ids, setIds] = useState<string[]>([]);
  const idsRef = useRef<string[]>([]);
  const parts = useRef(new Map<string, Parts>());
  const editing = useRef<string | null>(null);
  editing.current = still ? selectedId : null;

  const apply = useCallback((T: number) => {
    // Набор видимых надписей меняется — перерисовка React; анимация — напрямую
    const vis = list.current.filter((t) => T >= t.start && T < t.end).map((t) => t.id);
    if (vis.join() !== idsRef.current.join()) {
      idsRef.current = vis;
      setIds(vis);
    }
    for (const t of list.current) {
      const p = parts.current.get(t.id);
      if (!p?.root) continue;
      const frozen = editing.current === t.id && T >= t.start && T < t.end;
      const st = frozen ? { opacity: t.opacity ?? 1, blur: 0, scale: 1, dx: 0, dy: 0, chars: null, glow: 0 } : textState(t, T);
      const ws0 = wordsState(t, T);
      const ws = ws0 && frozen ? { visible: ws0.visible.map(() => true), current: -1 } : ws0;
      const r = p.root;
      if (!st) {
        r.style.opacity = '0';
        continue;
      }
      r.style.opacity = String(st.opacity * (ws && !ws.visible.some(Boolean) ? 0 : 1));
      r.style.filter = st.blur > 0.005 ? `blur(${(st.blur * t.size * dw).toFixed(1)}px)` : '';
      const tr = `translate(${st.dx.toFixed(3)}em, ${st.dy.toFixed(3)}em) scale(${st.scale.toFixed(3)})`;
      r.style.transform = tr === 'translate(0.000em, 0.000em) scale(1.000)' ? '' : tr;
      if (st.glow > 0.01) r.style.textShadow = `0 0 ${(0.2 + st.glow * 0.6).toFixed(2)}em rgba(255,255,255,${st.glow.toFixed(2)})`;
      else if (r.dataset.glow) r.style.textShadow = '';
      r.dataset.glow = st.glow > 0.01 ? '1' : '';
      if (ws) {
        const single = (t.wordMode ?? 'build') === 'single';
        p.words.forEach((w, i) => {
          if (!w) return;
          const v = ws.visible[i] !== false;
          if (single) w.style.display = v ? '' : 'none';
          else w.style.visibility = v ? 'visible' : 'hidden';
          w.style.color = t.wordMode === 'karaoke' && i === ws.current ? t.highlight ?? '#FFD84D' : '';
        });
      } else if (p.shown && p.rest) {
        const n = st.chars === null ? t.text.length : Math.round(t.text.length * st.chars);
        if (p.shown.textContent !== t.text.slice(0, n)) {
          p.shown.textContent = t.text.slice(0, n);
          p.rest.textContent = t.text.slice(n);
        }
      }
    }
  }, [dw]);

  useEffect(() => subscribe(apply), [subscribe, apply]);
  useEffect(() => apply(timeRef.current), [texts, apply, timeRef, ids, still, selectedId]);

  const reg = (id: string) => {
    let p = parts.current.get(id);
    if (!p) {
      p = { root: null, words: [], shown: null, rest: null };
      parts.current.set(id, p);
    }
    return p;
  };

  return (
    <>
      {ids.map((id) => {
        const t = texts.find((x) => x.id === id);
        if (!t) return null;
        const p = reg(t.id);
        const style = textStyle(t, dw);
        const wordMode = t.words?.length && (t.wordMode ?? 'build') !== 'phrase';
        let k = 0;
        const inner = (
          <span className="vt-anim" ref={(el) => {
            p.root = el;
          }} style={{ ...style, opacity: undefined }}>
            <span className="vt-op">
              {wordMode ? (
                splitWords(t.text).map((line, li, arr) => (
                  <span key={li} className="vt-line">
                    {line.map((w, wi) => {
                      const idx = k++;
                      return (
                        <span key={wi}>
                          <span className="vt-word" ref={(el) => {
            p.words[idx] = el;
          }}>
                            {w}
                          </span>
                          {wi < line.length - 1 ? ' ' : ''}
                        </span>
                      );
                    })}
                    {li < arr.length - 1 ? '\n' : ''}
                  </span>
                ))
              ) : (
                <>
                  <span className="vt-word" ref={(el) => {
            p.shown = el;
          }}>
                    {t.text || ' '}
                  </span>
                  <span className="vt-word vt-rest" ref={(el) => {
            p.rest = el;
          }} />
                </>
              )}
            </span>
          </span>
        );
        return (
          <TextItem key={t.id} t={t} dw={dw} dh={dh} selected={selectedId === t.id} onChange={onChange} onEnd={onEnd} onTap={onTap} inner={inner} />
        );
      })}
    </>
  );
}
