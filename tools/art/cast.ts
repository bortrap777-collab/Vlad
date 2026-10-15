/** Character designs. IDs match src/content/characters.ts. */
import { P } from './palette';
import type { CharSpec, Pose } from './characters';
import { DIMS } from './characters';

export const CAST: CharSpec[] = [
  {
    id: 'kolya', build: 'kid', skin: P.skin, hair: P.hairGinger, hairStyle: 'messy', eyes: 0x3f9a5a,
    hat: 'ushanka', hatRamp: P.furBrown, top: 'tracksuit', topRamp: P.trackBlack, bottom: 'trackpants', bottomRamp: P.trackBlack,
    shoes: P.shoeRed, hands: P.skin, backpack: P.backpack, freckles: true,
  },
  {
    id: 'olya', build: 'kid', skin: P.skin, hair: P.hairBlonde, hairStyle: 'long', eyes: 0x4a86c8,
    hat: 'pompom', hatRamp: P.pinkKnit, top: 'puffer', topRamp: P.pinkPuffer, bottom: 'puffer', bottomRamp: P.pinkPuffer,
    shoes: P.shoeRed, hands: P.pinkKnit,
  },
  {
    id: 'sveta', build: 'teen', skin: P.skin.map((c, i) => (i > 2 ? c - 0x080404 : c)), hair: P.hairBlack, hairStyle: 'punk', eyes: 0x5a4a7a,
    hat: 'none', top: 'leather', topRamp: P.leather, bottom: 'skirt', bottomRamp: P.trackBlack, shoes: P.boot, hands: P.trackBlack, earrings: true,
  },
  {
    id: 'lyokha', build: 'kid', skin: P.skin, hair: P.hairBrown, hairStyle: 'short', eyes: 0x6a4a2a,
    hat: 'petushok', hatRamp: P.yellowHat, hatRamp2: P.sweaterBlue, top: 'alaska', topRamp: P.green, bottom: 'pants', bottomRamp: P.denim,
    shoes: P.shoeDark, hands: P.redBand, glasses: true,
  },
  {
    id: 'seryoga', build: 'teen', skin: P.skin, hair: P.hairDarkBlond, hairStyle: 'cropped', eyes: 0x5a6a7a,
    hat: 'kepka', hatRamp: P.coatGrey, top: 'leather', topRamp: P.coatBrown, bottom: 'trackpants', bottomRamp: P.sweaterBlue, shoes: P.shoeDark,
  },
  {
    id: 'zheka', build: 'teen', skin: P.skin, hair: P.hairBrown, hairStyle: 'short', eyes: 0x4a4a5a,
    hat: 'beanie', hatRamp: P.sweaterBlue, top: 'vatnik', topRamp: P.coatGrey, bottom: 'trackpants', bottomRamp: P.trackBlack, shoes: P.shoeDark, hands: P.trackBlack,
  },
  {
    id: 'tolstyi', build: 'big', skin: P.skin, hair: P.hairDarkBlond, hairStyle: 'short', eyes: 0x4a5a4a,
    hat: 'beanie', hatRamp: P.trackBlack, top: 'sports', topRamp: P.plaidRed, bottom: 'trackpants', bottomRamp: P.trackBlack, shoes: P.shoeDark,
  },
  {
    id: 'zina', build: 'old', skin: P.skinOld, hair: P.hairGrey, hairStyle: 'short', eyes: 0x5a6a8a,
    hat: 'kerchief', hatRamp: P.kerchief, top: 'coat', topRamp: P.coatPlum, bottom: 'valenki', bottomRamp: P.coatPlum, shoes: P.boot, wrinkles: true,
  },
  {
    id: 'vitya', build: 'adult', skin: P.skinOld, hair: P.hairGrey, hairStyle: 'short', eyes: 0x5a5a6a,
    hat: 'ushanka', hatRamp: P.hairGrey, top: 'vatnik', topRamp: P.khaki, bottom: 'valenki', bottomRamp: P.coatGrey, shoes: P.boot, stubble: true, wrinkles: true, glasses: true,
  },
  {
    id: 'sasha', build: 'adult', skin: P.skinOld, hair: P.hairBrown, hairStyle: 'short', eyes: 0x4a4a52,
    hat: 'beanie', hatRamp: P.green, top: 'vatnik', topRamp: P.coatGrey, bottom: 'pants', bottomRamp: P.khaki, shoes: P.boot, hands: P.coatGrey, stubble: true,
  },
  {
    id: 'alexey', build: 'adult', skin: P.skin, hair: P.hairBrown, hairStyle: 'short', eyes: 0x6a5232,
    hat: 'militia', hatRamp: P.militia, top: 'greatcoat', topRamp: P.militia, bottom: 'pants', bottomRamp: P.militia, shoes: P.shoeDark, hands: P.leather, mustache: true,
  },
  {
    id: 'mama', build: 'adult', skin: P.skin, hair: P.hairBrown, hairStyle: 'perm', eyes: 0x4a7a5a,
    hat: 'none', top: 'robe', topRamp: P.coatPlum, bottom: 'pants', bottomRamp: P.coatPlum, shoes: P.shoeRed, earrings: true,
  },
  {
    id: 'papa', build: 'adult', skin: P.skin, hair: P.hairGinger.map((c, i) => (i < 4 ? c - 0x101008 : c)), hairStyle: 'short', eyes: 0x3f7a5a,
    hat: 'none', top: 'sweater', topRamp: P.sweaterBlue, bottom: 'sweatpants', bottomRamp: P.trackBlack, shoes: P.shoeDark, mustache: true, freckles: true,
  },
];

/** Situational animations beyond the shared set. */
export function extraAnims(id: string): Record<string, { poses: Pose[]; fps: number; loop: boolean; expr?: 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' }> {
  const spec = CAST.find((c) => c.id === id)!;
  const d = DIMS[spec.build];
  if (id === 'kolya')
    return {
      block: { poses: [{ armF: [5, 2], armB: [4, 3], lean: -1, brows: 'angry', mouth: 'grit', legF: [3, 0], legB: [-3, 0] }, { armF: [5, 1], armB: [4, 2], lean: -1, bob: 1, brows: 'angry', mouth: 'grit', legF: [3, 0], legB: [-3, 0] }], fps: 6, loop: true },
      dodge: { poses: [{ lean: -6, bob: 3, armF: [-2, 8], armB: [-5, 8], legF: [4, 0], legB: [-4, 0], eyes: 'squint' }, { lean: -8, bob: 4, armF: [-3, 7], armB: [-6, 7], legF: [5, 0], legB: [-5, 0], eyes: 'squint' }, { lean: -4, bob: 2, armF: [-1, 9], armB: [-4, 9], legF: [4, 0], legB: [-4, 0] }], fps: 14, loop: false },
      push: { poses: [{ lean: -2, armF: [-2, 6], armB: [-3, 7], legF: [3, 0], legB: [-4, 0], brows: 'angry' }, { lean: 5, armF: [10, 2], armB: [9, 3], legF: [5, 0], legB: [-5, 0], brows: 'angry', mouth: 'open' }, { lean: 6, armF: [11, 2], armB: [10, 3], legF: [5, 0], legB: [-6, 0], brows: 'angry', mouth: 'grit' }, { lean: 2, armF: [5, 8], armB: [3, 9], legF: [3, 0], legB: [-3, 0] }], fps: 12, loop: false },
      hurt: { poses: [{ lean: -5, eyes: 'closed', mouth: 'open', armF: [-3, 9], armB: [-5, 8], legF: [2, 0], legB: [-3, 0] }, { lean: -3, eyes: 'squint', mouth: 'frown', armF: [-1, 10], armB: [-3, 10] }], fps: 8, loop: false },
      down: { poses: [{ sit: true, bob: 0, armF: [-2, 8], armB: [-6, 7], eyes: 'closed', mouth: 'frown' }], fps: 1, loop: false },
      kneel: { poses: [{ kneel: true, armF: [7, 7], armB: [6, 8] }, { kneel: true, armF: [8, 8], armB: [5, 7] }], fps: 4, loop: true },
      wave: { poses: [{ armF: [5, -7], mouth: 'smile' }, { armF: [7, -6], mouth: 'smile' }], fps: 5, loop: true },
    };
  if (id === 'zheka' || id === 'tolstyi' || id === 'seryoga')
    return {
      windup: { poses: [{ lean: -3, armF: [-6, d.arm - 6], legF: [3, 0], legB: [-3, 0], brows: 'angry', mouth: 'grit' }, { lean: -4, armF: [-7, d.arm - 7], legF: [3, 0], legB: [-4, 0], brows: 'angry', mouth: 'grit' }], fps: 6, loop: true },
      attack: { poses: [{ lean: 5, armF: [d.arm - 2, 2], armB: [3, d.arm - 2], legF: [5, 0], legB: [-5, 0], brows: 'angry', mouth: 'open' }, { lean: 6, armF: [d.arm - 1, 2], armB: [3, d.arm - 2], legF: [5, 0], legB: [-5, 0], brows: 'angry', mouth: 'open' }], fps: 10, loop: false },
      hurt: { poses: [{ lean: -5, eyes: 'closed', mouth: 'open', armF: [-3, d.arm - 2], legF: [2, 0], legB: [-3, 0] }, { lean: -3, eyes: 'squint', mouth: 'frown' }], fps: 8, loop: false },
      stagger: { poses: [{ lean: -6, bob: 2, eyes: 'squint', mouth: 'o', armF: [-4, d.arm - 3], armB: [-6, d.arm - 4] }, { lean: -5, bob: 1, eyes: 'squint', mouth: 'o', armF: [-3, d.arm - 2], armB: [-5, d.arm - 3] }], fps: 5, loop: true },
      laugh: { poses: [{ mouth: 'smile', eyes: 'squint', bob: 0 }, { mouth: 'open', eyes: 'squint', bob: 1 }], fps: 5, loop: true },
    };
  if (id === 'olya')
    return {
      sad: { poses: [{ eyes: 'open', mouth: 'frown', brows: 'worried', headTilt: 1, armF: [3, d.arm - 3] }, { eyes: 'closed', mouth: 'frown', brows: 'worried', headTilt: 1, armF: [3, d.arm - 3] }], fps: 2, loop: true },
      wave: { poses: [{ armF: [5, -6], mouth: 'smile' }, { armF: [7, -5], mouth: 'smile' }], fps: 5, loop: true },
    };
  if (id === 'mama' || id === 'papa')
    return {
      argue: { poses: [{ mouth: 'open', brows: 'angry', armF: [8, 4] }, { mouth: 'grit', brows: 'angry', armF: [7, 6] }, { mouth: 'open', brows: 'angry', armF: [9, 2] }], fps: 5, loop: true },
    };
  if (id === 'sveta')
    return {
      draw: { poses: [{ armF: [6, 8], armB: [5, 9], eyes: 'squint' }, { armF: [7, 7], armB: [5, 9], eyes: 'squint' }, { armF: [6, 9], armB: [5, 9], eyes: 'open' }], fps: 3, loop: true },
    };
  if (id === 'lyokha')
    return {
      tinker: { poses: [{ armF: [6, 8], armB: [5, 9], mouth: 'smile' }, { armF: [7, 6], armB: [5, 9], mouth: 'open' }], fps: 4, loop: true },
    };
  if (id === 'alexey')
    return {
      salute: { poses: [{ armF: [3, -2], mouth: 'smile' }], fps: 1, loop: false },
    };
  return {};
}
