/** Versioned localStorage saves with validation and graceful failure. */
import { SAVE_VERSION } from '../config';
import { STAGES } from '../content/quests';
import { ITEMS, CLUES } from '../content/items';
import type { GameState } from './state';

export const SLOT_IDS = ['auto', 'slot1', 'slot2', 'slot3'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

const KEY = (slot: SlotId) => `kolya.save.${slot}`;

export interface SaveMeta {
  slot: SlotId;
  savedAt: number;
  stage: string;
  level: string;
  playTime: number;
}

interface SaveFile {
  format: 'kolya-save';
  version: number;
  savedAt: number;
  state: GameState;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    const s = globalThis.localStorage;
    const probe = '__kolya_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Upgrade older save formats. Add a case for each future version bump. */
export function migrate(raw: SaveFile): SaveFile {
  let f = raw;
  if (f.version < 1) throw new Error('unsupported save version');
  if (f.version > SAVE_VERSION) throw new Error('save is from a newer game version');
  // v1 is current
  f = { ...f, version: SAVE_VERSION };
  return f;
}

export function validateState(s: unknown): s is GameState {
  if (!s || typeof s !== 'object') return false;
  const g = s as GameState;
  if (g.level !== 'apartment' && g.level !== 'courtyard') return false;
  if (typeof g.x !== 'number' || !Number.isFinite(g.x)) return false;
  if (g.facing !== 1 && g.facing !== -1) return false;
  if (!STAGES.some((st) => st.id === g.stage)) return false;
  if (!g.flags || typeof g.flags !== 'object' || Array.isArray(g.flags)) return false;
  if (!Array.isArray(g.inventory) || !g.inventory.every((i) => typeof i === 'string' && i in ITEMS)) return false;
  if (!Array.isArray(g.clues) || !g.clues.every((c) => typeof c === 'string' && c in CLUES)) return false;
  if (!Array.isArray(g.choices) || !Array.isArray(g.history)) return false;
  if (typeof g.playTime !== 'number') return false;
  return true;
}

export function serialize(state: GameState, now = Date.now()): string {
  const file: SaveFile = { format: 'kolya-save', version: SAVE_VERSION, savedAt: now, state };
  return JSON.stringify(file);
}

export type LoadResult = { ok: true; state: GameState; savedAt: number } | { ok: false; reason: 'empty' | 'corrupt' | 'version' };

export function deserialize(text: string | null): LoadResult {
  if (text === null || text === '') return { ok: false, reason: 'empty' };
  let parsed: SaveFile;
  try {
    parsed = JSON.parse(text) as SaveFile;
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (!parsed || parsed.format !== 'kolya-save' || typeof parsed.version !== 'number') return { ok: false, reason: 'corrupt' };
  try {
    parsed = migrate(parsed);
  } catch {
    return { ok: false, reason: 'version' };
  }
  if (!validateState(parsed.state)) return { ok: false, reason: 'corrupt' };
  return { ok: true, state: parsed.state, savedAt: parsed.savedAt };
}

export class SaveManager {
  constructor(private readonly storage: StorageLike | null = defaultStorage()) {}

  get available(): boolean {
    return this.storage !== null;
  }

  save(slot: SlotId, state: GameState): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(KEY(slot), serialize(state));
      return true;
    } catch {
      return false; // quota exceeded / private mode
    }
  }

  load(slot: SlotId): LoadResult {
    if (!this.storage) return { ok: false, reason: 'empty' };
    let text: string | null = null;
    try {
      text = this.storage.getItem(KEY(slot));
    } catch {
      return { ok: false, reason: 'empty' };
    }
    return deserialize(text);
  }

  meta(slot: SlotId): SaveMeta | null {
    const r = this.load(slot);
    if (!r.ok) return null;
    return { slot, savedAt: r.savedAt, stage: r.state.stage, level: r.state.level, playTime: r.state.playTime };
  }

  /** Slot status including corruption, for the UI. */
  status(slot: SlotId): 'empty' | 'corrupt' | 'version' | 'ok' {
    const r = this.load(slot);
    return r.ok ? 'ok' : r.reason;
  }

  latest(): SaveMeta | null {
    return SLOT_IDS.map((s) => this.meta(s))
      .filter((m): m is SaveMeta => m !== null)
      .sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
  }

  remove(slot: SlotId) {
    try {
      this.storage?.removeItem(KEY(slot));
    } catch {
      /* ignore */
    }
  }
}
