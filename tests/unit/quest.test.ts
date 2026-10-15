import { describe, expect, it } from 'vitest';
import { newGame, applyEffects, evalCond, combineClues } from '../../src/core/state';
import { Session } from '../../src/core/session';
import { SaveManager } from '../../src/core/save';
import { STAGES, stageIndex } from '../../src/content/quests';

describe('quest stages', () => {
  it('only move forward', () => {
    const s = newGame();
    applyEffects(s, [{ stage: 'defend' }]);
    expect(s.stage).toBe('defend');
    const ev = applyEffects(s, [{ stage: 'help_dog' }]);
    expect(s.stage).toBe('defend');
    expect(ev).toEqual([]);
  });

  it('stage ids are unique and ordered', () => {
    const ids = STAGES.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(stageIndex('intro')).toBe(0);
    expect(stageIndex('done')).toBe(STAGES.length - 1);
  });

  it('collecting the four required clues unlocks deduction, the insight unlocks the finale', () => {
    const session = new Session(newGame(), new SaveManager(null));
    session.apply([{ stage: 'investigate' }, { clue: 'clue_grandma' }, { clue: 'clue_officer' }, { clue: 'clue_drawing' }]);
    expect(session.state.stage).toBe('investigate');
    session.apply([{ clue: 'clue_mitten' }]);
    expect(session.state.stage).toBe('deduce');
    expect(session.combine('clue_mitten', 'clue_grandma').ok).toBe(false);
    const r = session.combine('clue_grandma', 'clue_officer');
    expect(r.ok).toBe(true);
    expect(session.state.clues).toContain('insight_lie');
    expect(session.state.stage).toBe('tell_olya');
    // repeating a combination doesn't duplicate the insight
    expect(session.combine('clue_officer', 'clue_grandma').already).toBe(true);
    expect(session.state.clues.filter((c) => c === 'insight_lie').length).toBe(1);
  });

  it('an early insight still progresses once the clues are complete', () => {
    const session = new Session(newGame(), new SaveManager(null));
    session.apply([{ clue: 'clue_grandma' }, { clue: 'clue_officer' }]);
    session.combine('clue_grandma', 'clue_officer');
    expect(session.state.stage).toBe('intro');
    session.apply([{ stage: 'investigate' }, { clue: 'clue_drawing' }, { clue: 'clue_mitten' }]);
    expect(session.state.stage).toBe('tell_olya');
  });

  it('combining needs both clues to be known', () => {
    const s = newGame();
    s.clues.push('clue_grandma');
    expect(combineClues(s, 'clue_grandma', 'clue_officer')).toBeNull();
  });

  it('conditions evaluate', () => {
    const s = newGame();
    s.flags.dog_calm = 2;
    s.inventory.push('bread');
    expect(evalCond(s, { flagGte: 'dog_calm', value: 2 })).toBe(true);
    expect(evalCond(s, { all: [{ has: 'bread' }, { not: { flag: 'night' } }] })).toBe(true);
    expect(evalCond(s, { any: [{ hasClue: 'clue_mitten' }, { stageAtLeast: 'defend' }] })).toBe(false);
  });
});
