import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readPref, writePref } from '../lib/storage';

/**
 * Тема: 'auto' следует настройкам устройства (prefers-color-scheme),
 * 'light' / 'dark' — ручной выбор. Применяется классом на <html>,
 * чтобы не конфликтовать с атрибутами хоста (например, просмотрщика артефактов).
 */
export type ThemePref = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeCtx {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (p: ThemePref) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const KEY = 'ws.theme';
const query = () => window.matchMedia?.('(prefers-color-scheme: dark)');

function systemTheme(): ResolvedTheme {
  return query()?.matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => readPref<ThemePref>(KEY, 'auto'));
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const resolved: ResolvedTheme = pref === 'auto' ? system : pref;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('ws-light', 'ws-dark');
    root.classList.add(resolved === 'dark' ? 'ws-dark' : 'ws-light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0C0B12' : '#F6F5FB');
  }, [resolved]);

  const value = useMemo<ThemeCtx>(
    () => ({
      pref,
      resolved,
      setPref: (p) => {
        setPrefState(p);
        writePref(KEY, p);
      },
    }),
    [pref, resolved],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme вне ThemeProvider');
  return v;
}
