/**
 * The running game session: owns GameState, applies effects, auto-advances quest stages
 * and broadcasts events to scenes. Created per new game / load.
 */
import { Emitter } from './events';
import { applyEffects, combineClues, newGame, pushHistory, type GameState, type StateEvent } from './state';
import type { ClueId, Effect } from './types';
import { REQUIRED_CLUES } from '../content/quests';
import { SaveManager, type SlotId } from './save';

export interface SessionEvents extends Record<string, unknown> {
  state: StateEvent;
  saved: SlotId;
}

export class Session {
  readonly bus = new Emitter<SessionEvents>();
  constructor(public state: GameState = newGame(), public readonly saves = new SaveManager()) {}

  apply(effects: Effect[] | undefined) {
    this.dispatch(applyEffects(this.state, effects));
  }

  /** Forward events and run automatic quest rules. */
  dispatch(events: StateEvent[]) {
    for (const e of events) this.bus.emit('state', e);
    this.autoProgress();
  }

  autoProgress() {
    const s = this.state;
    if (s.stage === 'investigate' && REQUIRED_CLUES.every((c) => s.clues.includes(c))) {
      this.dispatch(applyEffects(s, [{ stage: 'deduce' }]));
    }
    if (s.stage === 'deduce' && s.clues.includes('insight_lie')) {
      this.dispatch(applyEffects(s, [{ stage: 'tell_olya' }]));
    }
  }

  combine(a: ClueId, b: ClueId): { ok: boolean; text?: string; already?: boolean } {
    const rule = combineClues(this.state, a, b);
    if (!rule) return { ok: false };
    if (this.state.clues.includes(rule.result)) return { ok: true, text: rule.text, already: true };
    this.apply([{ clue: rule.result }]);
    return { ok: true, text: rule.text };
  }

  history(speaker: string, text: string) {
    pushHistory(this.state, speaker, text);
  }

  save(slot: SlotId): boolean {
    const ok = this.saves.save(slot, this.state);
    if (ok) this.bus.emit('saved', slot);
    return ok;
  }
}
