/**
 * Pure game-state model: flags, inventory, clues, quest stage.
 * No Phaser imports — fully unit-testable.
 */
import type { ClueId, Cond, Effect, FlagValue, ItemId } from './types';
import { STAGES, stageIndex } from '../content/quests';
import { COMBINE_RULES } from '../content/items';
import { SAVE_VERSION } from '../config';

export type LevelId = 'apartment' | 'courtyard';

export interface GameState {
  version: number;
  level: LevelId;
  x: number;
  facing: 1 | -1;
  stage: string;
  flags: Record<string, FlagValue>;
  inventory: ItemId[];
  clues: ClueId[];
  /** Choice tags for the end-of-chapter summary. */
  choices: string[];
  /** Recent dialogue lines for the history panel. */
  history: { speaker: string; text: string }[];
  playTime: number;
}

export function newGame(): GameState {
  return {
    version: SAVE_VERSION,
    level: 'apartment',
    x: 520,
    facing: -1,
    stage: STAGES[0].id,
    flags: {},
    inventory: [],
    clues: [],
    choices: [],
    history: [],
    playTime: 0,
  };
}

export function cloneState(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}

export function flag(s: GameState, key: string): FlagValue | undefined {
  return s.flags[key];
}

export function evalCond(s: GameState, c: Cond | undefined): boolean {
  if (!c) return true;
  if ('flag' in c) return c.eq === undefined ? !!s.flags[c.flag] : s.flags[c.flag] === c.eq;
  if ('notFlag' in c) return !s.flags[c.notFlag];
  if ('flagGte' in c) return (Number(s.flags[c.flagGte]) || 0) >= c.value;
  if ('has' in c) return s.inventory.includes(c.has);
  if ('hasClue' in c) return s.clues.includes(c.hasClue);
  if ('stage' in c) return s.stage === c.stage;
  if ('stageAtLeast' in c) return stageIndex(s.stage) >= stageIndex(c.stageAtLeast);
  if ('not' in c) return !evalCond(s, c.not);
  if ('all' in c) return c.all.every((x) => evalCond(s, x));
  if ('any' in c) return c.any.some((x) => evalCond(s, x));
  return true;
}

export type StateEvent =
  | { type: 'item'; id: ItemId; gained: boolean }
  | { type: 'clue'; id: ClueId }
  | { type: 'stage'; id: string }
  | { type: 'flag'; key: string }
  | { type: 'custom'; name: string };

/** Apply an effect, returning UI-facing events (toasts, sounds). */
export function applyEffect(s: GameState, e: Effect): StateEvent[] {
  const ev: StateEvent[] = [];
  if ('set' in e) {
    s.flags[e.set] = e.value === undefined ? true : e.value;
    ev.push({ type: 'flag', key: e.set });
  } else if ('inc' in e) {
    s.flags[e.inc] = (Number(s.flags[e.inc]) || 0) + (e.by ?? 1);
    ev.push({ type: 'flag', key: e.inc });
  } else if ('give' in e) {
    if (!s.inventory.includes(e.give)) {
      s.inventory.push(e.give);
      ev.push({ type: 'item', id: e.give, gained: true });
    }
  } else if ('take' in e) {
    const i = s.inventory.indexOf(e.take);
    if (i >= 0) {
      s.inventory.splice(i, 1);
      ev.push({ type: 'item', id: e.take, gained: false });
    }
  } else if ('clue' in e) {
    if (!s.clues.includes(e.clue)) {
      s.clues.push(e.clue);
      ev.push({ type: 'clue', id: e.clue });
    }
  } else if ('stage' in e) {
    // stages only move forward — protects against replayed dialogue regressing progress
    if (stageIndex(e.stage) > stageIndex(s.stage)) {
      s.stage = e.stage;
      ev.push({ type: 'stage', id: e.stage });
    }
  } else if ('event' in e) {
    ev.push({ type: 'custom', name: e.event });
  }
  return ev;
}

export function applyEffects(s: GameState, effects: Effect[] | undefined): StateEvent[] {
  return (effects ?? []).flatMap((e) => applyEffect(s, e));
}

/** Try to combine two clues. Returns the rule on success. */
export function combineClues(s: GameState, a: ClueId, b: ClueId) {
  if (!s.clues.includes(a) || !s.clues.includes(b) || a === b) return null;
  const rule = COMBINE_RULES.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
  if (!rule) return null;
  return rule;
}

export function pushHistory(s: GameState, speaker: string, text: string) {
  s.history.push({ speaker, text });
  if (s.history.length > 80) s.history.splice(0, s.history.length - 80);
}
