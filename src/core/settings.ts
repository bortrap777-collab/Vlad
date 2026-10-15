/** Player settings & key bindings, persisted separately from saves. */

export type Action = 'left' | 'right' | 'interact' | 'sprint' | 'block' | 'journal' | 'pause' | 'history';
export const ACTIONS: Action[] = ['left', 'right', 'interact', 'sprint', 'block', 'journal', 'history', 'pause'];

export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  textSpeed: TextSpeed;
  captions: boolean;
  reducedMotion: boolean;
  keys: Record<Action, string[]>;
}

export const DEFAULT_KEYS: Record<Action, string[]> = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  interact: ['KeyE', 'Enter'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  block: ['Space'],
  journal: ['KeyJ', 'Tab'],
  history: ['KeyH'],
  pause: ['Escape', 'KeyP'],
};

export function defaultSettings(): Settings {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    master: 0.8,
    music: 0.6,
    sfx: 0.8,
    muted: false,
    textSpeed: 'normal',
    captions: true,
    reducedMotion: reduce,
    keys: JSON.parse(JSON.stringify(DEFAULT_KEYS)),
  };
}

export const TEXT_CPS: Record<TextSpeed, number> = { slow: 22, normal: 45, fast: 95, instant: 100000 };

const KEY = 'kolya.settings';

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<Settings>;
    const clamp = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : def);
    const keys = { ...d.keys };
    if (p.keys && typeof p.keys === 'object')
      for (const a of ACTIONS) {
        const k = (p.keys as Record<string, unknown>)[a];
        if (Array.isArray(k) && k.length && k.every((x) => typeof x === 'string')) keys[a] = k as string[];
      }
    return {
      master: clamp(p.master, d.master),
      music: clamp(p.music, d.music),
      sfx: clamp(p.sfx, d.sfx),
      muted: typeof p.muted === 'boolean' ? p.muted : d.muted,
      textSpeed: p.textSpeed && p.textSpeed in TEXT_CPS ? p.textSpeed : d.textSpeed,
      captions: typeof p.captions === 'boolean' ? p.captions : d.captions,
      reducedMotion: typeof p.reducedMotion === 'boolean' ? p.reducedMotion : d.reducedMotion,
      keys,
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — settings stay for this session */
  }
}

/** Human-readable (Russian) key names. */
export function keyLabel(code: string): string {
  const map: Record<string, string> = {
    Space: 'Пробел', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', ShiftLeft: 'Shift', ShiftRight: 'Правый Shift',
    ControlLeft: 'Ctrl', ControlRight: 'Правый Ctrl', AltLeft: 'Alt', AltRight: 'Правый Alt',
    ArrowLeft: 'Стрелка влево', ArrowRight: 'Стрелка вправо', ArrowUp: 'Стрелка вверх', ArrowDown: 'Стрелка вниз', Backspace: 'Backspace',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

/** Assign a key to an action, removing it from any other action. */
export function rebind(s: Settings, action: Action, code: string): void {
  for (const a of ACTIONS) s.keys[a] = s.keys[a].filter((k) => k !== code);
  s.keys[action] = [code, ...s.keys[action].filter((k) => k !== code)].slice(0, 2);
  // never leave an action unbound
  for (const a of ACTIONS) if (!s.keys[a].length) s.keys[a] = [DEFAULT_KEYS[a].find((k) => !Object.values(s.keys).flat().includes(k)) ?? DEFAULT_KEYS[a][0]];
}
