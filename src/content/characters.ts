import type { CharId } from '../core/types';
import type { GameState } from '../core/state';

export interface CharacterInfo {
  name: string;
  /** Name shown before the player learns it. */
  unknownName?: string;
  knownFlag?: string;
  /** Typewriter blip detune in cents — each voice has its own pitch. */
  voice: number;
  hasPortrait: boolean;
}

export const CHARACTERS: Record<CharId, CharacterInfo> = {
  kolya: { name: 'Коля', voice: 0, hasPortrait: true },
  olya: { name: 'Оля', unknownName: 'Девочка в розовом', knownFlag: 'met_olya', voice: 500, hasPortrait: true },
  sveta: { name: 'Света', unknownName: 'Девчонка на качелях', knownFlag: 'met_sveta', voice: 200, hasPortrait: true },
  lyokha: { name: 'Лёха', unknownName: 'Пацан в гараже', knownFlag: 'met_lyokha', voice: 300, hasPortrait: true },
  seryoga: { name: 'Серёга', unknownName: 'Старший парень', knownFlag: 'met_seryoga', voice: -300, hasPortrait: true },
  zheka: { name: 'Жека', voice: -100, hasPortrait: true },
  tolstyi: { name: 'Толстый', voice: -400, hasPortrait: true },
  zina: { name: 'Баба Зина', unknownName: 'Бабушка на лавочке', knownFlag: 'met_zina', voice: 350, hasPortrait: true },
  vitya: { name: 'Дядя Витя', unknownName: 'Дед на лавочке', knownFlag: 'met_zina', voice: -600, hasPortrait: true },
  sasha: { name: 'Дядя Саша', unknownName: 'Мужчина у гаража', knownFlag: 'met_sasha', voice: -700, hasPortrait: true },
  alexey: { name: 'Алексей Викторович', unknownName: 'Милиционер', knownFlag: 'met_alexey', voice: -500, hasPortrait: true },
  mama: { name: 'Мама', voice: 400, hasPortrait: true },
  papa: { name: 'Папа', voice: -450, hasPortrait: true },
  dog: { name: 'Пёс', voice: 0, hasPortrait: false },
  narrator: { name: '', voice: 0, hasPortrait: false },
};

export function displayName(id: CharId, s: GameState): string {
  const c = CHARACTERS[id];
  if (id === 'dog' && s.flags.dog_named) return 'Рыжий';
  if (c.unknownName && c.knownFlag && !s.flags[c.knownFlag]) return c.unknownName;
  return c.name;
}
