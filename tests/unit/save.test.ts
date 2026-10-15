import { describe, expect, it } from 'vitest';
import { SaveManager, deserialize, serialize, type StorageLike } from '../../src/core/save';
import { newGame, applyEffects } from '../../src/core/state';

class MemStorage implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('save serialization', () => {
  it('round-trips a full game state', () => {
    const s = newGame();
    applyEffects(s, [{ give: 'key' }, { clue: 'clue_grandma' }, { stage: 'help_dog' }, { set: 'dog_named' }, { inc: 'dog_calm', by: 2 }]);
    s.level = 'courtyard';
    s.x = 1234;
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state).toEqual(s);
  });

  it('reports empty, corrupt and future-version saves without throwing', () => {
    expect(deserialize(null)).toEqual({ ok: false, reason: 'empty' });
    expect(deserialize('{not json')).toEqual({ ok: false, reason: 'corrupt' });
    expect(deserialize(JSON.stringify({ format: 'other' }))).toEqual({ ok: false, reason: 'corrupt' });
    const future = JSON.parse(serialize(newGame()));
    future.version = 999;
    expect(deserialize(JSON.stringify(future))).toEqual({ ok: false, reason: 'version' });
  });

  it('rejects structurally invalid states (unknown stage, item, NaN position)', () => {
    for (const mutate of [
      (s: any) => (s.stage = 'nope'),
      (s: any) => (s.inventory = ['laptop']),
      (s: any) => (s.x = 'abc'),
      (s: any) => (s.level = 'moon'),
      (s: any) => (s.flags = null),
    ]) {
      const f = JSON.parse(serialize(newGame()));
      mutate(f.state);
      expect(deserialize(JSON.stringify(f)).ok).toBe(false);
    }
  });

  it('SaveManager picks the latest slot and survives broken storage', () => {
    const mem = new MemStorage();
    const sm = new SaveManager(mem);
    const a = newGame();
    sm.save('slot1', a);
    const b = newGame();
    b.stage = 'defend';
    // make the autosave strictly newer
    mem.setItem('kolya.save.auto', serialize(b, Date.now() + 1000));
    expect(sm.latest()?.slot).toBe('auto');
    mem.setItem('kolya.save.slot2', '###');
    expect(sm.status('slot2')).toBe('corrupt');
    expect(sm.latest()?.slot).toBe('auto');

    const broken: StorageLike = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('quota');
      },
      removeItem() {},
    };
    const sm2 = new SaveManager(broken);
    expect(sm2.save('slot1', a)).toBe(false);
    expect(sm2.load('slot1').ok).toBe(false);
    expect(new SaveManager(null).available).toBe(false);
  });
});
