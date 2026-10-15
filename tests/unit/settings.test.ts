import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, keyLabel, rebind, type Settings } from '../../src/core/settings';

const base = (): Settings => ({ master: 1, music: 1, sfx: 1, muted: false, textSpeed: 'normal', captions: true, reducedMotion: false, keys: JSON.parse(JSON.stringify(DEFAULT_KEYS)) });

describe('key rebinding', () => {
  it('replaces the primary key and keeps the secondary', () => {
    const s = base();
    rebind(s, 'interact', 'KeyF');
    expect(s.keys.interact).toEqual(['KeyF', 'Enter']);
  });
  it('steals a key from another action without leaving it unbound', () => {
    const s = base();
    rebind(s, 'interact', 'KeyH');
    expect(s.keys.interact[0]).toBe('KeyH');
    expect(s.keys.history.length).toBeGreaterThan(0);
    expect(s.keys.history).not.toContain('KeyH');
  });
  it('labels keys in Russian', () => {
    expect(keyLabel('Space')).toBe('Пробел');
    expect(keyLabel('KeyJ')).toBe('J');
    expect(keyLabel('ArrowLeft')).toBe('Стрелка влево');
  });
});
