import { describe, expect, it } from 'vitest';
import { DIALOGUES } from '../../src/content/dialogues';
import { DialogueRunner, validateDialogue } from '../../src/core/dialogue';
import { newGame } from '../../src/core/state';

function runAll(id: string, pick: (texts: string[]) => number, setup?: (s: ReturnType<typeof newGame>) => void) {
  const s = newGame();
  setup?.(s);
  const r = new DialogueRunner(DIALOGUES[id], s);
  const lines: string[] = [];
  let guard = 0;
  while (!r.done && guard++ < 200) {
    const v = r.current!;
    lines.push(v.node.text);
    if (v.choices.length) r.choose(pick(v.choices.map((c) => c.choice.text)));
    else r.advance();
  }
  expect(guard).toBeLessThan(200);
  return { s, lines, events: r.takeEvents() };
}

describe('dialogue graphs', () => {
  it('every dialogue is well-formed (no dangling or unreachable nodes)', () => {
    const errs = Object.values(DIALOGUES).flatMap(validateDialogue);
    expect(errs).toEqual([]);
  });

  it('intro branches all end in the same stage', () => {
    for (const i of [0, 1, 2]) {
      const { s } = runAll('intro_argue', () => i);
      expect(s.stage).toBe('leave_home');
      expect(s.flags.intro_done).toBe(true);
      expect(s.choices.length).toBe(1);
    }
  });

  it('feeding the dog makes it ready; grabbing panics it', () => {
    const fed = runAll('dog', (t) => Math.max(0, t.findIndex((x) => x.includes('горбушку'))), (s) => s.inventory.push('bread'));
    expect(fed.s.flags.dog_ready).toBe(true);
    expect(fed.s.inventory).not.toContain('bread');
    const grab = runAll('dog', (t) => t.findIndex((x) => x.includes('Резко')));
    expect(grab.s.flags.dog_ready).toBeUndefined();
    expect(grab.events.some((e) => e.type === 'custom' && e.name === 'dog_panic')).toBe(true);
  });

  it('the bread choice is hidden without bread', () => {
    const s = newGame();
    const r = new DialogueRunner(DIALOGUES.dog, s);
    r.advance();
    expect(r.current!.choices.map((c) => c.choice.text).some((t) => t.includes('горбушку'))).toBe(false);
  });

  it('calling twice also calms the dog', () => {
    const s = newGame();
    let r = new DialogueRunner(DIALOGUES.dog, s);
    r.advance();
    r.choose(0); // call
    r.advance();
    expect(r.current!.id).toBe('notyet');
    r.choose(0); // call again
    r.advance();
    expect(r.current!.id).toBe('calm');
    expect(s.flags.dog_ready).toBe(true);
    r = new DialogueRunner(DIALOGUES.dog, s);
    expect(r.current!.id).toBe('ready');
  });

  it('Olya dialogue starts the investigation and gives the officer clue', () => {
    const { s } = runAll('olya', () => 0, (s) => (s.stage = 'talk_olya'));
    expect(s.stage).toBe('investigate');
    expect(s.clues).toContain('clue_officer');
    expect(s.flags.met_olya).toBe(true);
  });

  it('officer scene: showing the mitten loses it, hiding keeps it', () => {
    const show = runAll('finale_officer', (t) => t.findIndex((x) => x.includes('Показать')), (s) => s.inventory.push('mitten'));
    expect(show.s.inventory).not.toContain('mitten');
    expect(show.s.flags.gave_mitten).toBe(true);
    const hide = runAll('finale_officer', (t) => t.findIndex((x) => x.includes('Промолчать')), (s) => s.inventory.push('mitten'));
    expect(hide.s.inventory).toContain('mitten');
    // without the mitten the "show" option is not offered
    const none = runAll('finale_officer', () => 0);
    expect(none.s.flags.gave_mitten).toBeUndefined();
  });

  it('Sveta can be convinced after a wrong answer', () => {
    const { s } = runAll('sveta', (t) => Math.max(0, t.findIndex((x) => x.includes('Интересно'))));
    expect(s.clues).toContain('clue_drawing');
  });
});
