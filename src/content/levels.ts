/**
 * Level definitions: every placed object has a semantic id, texture, logical anchor
 * (bottom-centre), depth layer, collision rule and interaction range.
 */
import type { CharId, Cond } from '../core/types';
import type { LevelId } from '../core/state';
import type { MusicKey } from '../systems/audio';

export type Layer = 'back' | 'front';

export interface PropDef {
  id: string;
  texture: string;
  x: number;
  /** Y of the bottom edge (anchor 0.5,1). */
  y: number;
  layer: Layer;
  /** Solid props block walking; all others are scenery behind/in front of the walk line. */
  solid?: { x0: number; x1: number };
  cond?: Cond;
  flipX?: boolean;
}

export type InteractAction =
  | { dialogue: string }
  | { door: LevelId; spawnX: number; requires?: { cond: Cond; elseDialogue: string }[] }
  | { event: string };

export interface InteractableDef {
  id: string;
  x: number;
  range: number;
  /** Prompt verb, e.g. «Осмотреть». */
  label: string;
  priority?: number;
  cond?: Cond;
  action: InteractAction;
  /** Optional y for the prompt marker (defaults above the player). */
  markerY?: number;
}

export interface NpcDef {
  id: CharId;
  x: number;
  facing: 1 | -1;
  anim?: string;
  cond?: Cond;
  dialogue: string;
  range?: number;
  /** Faces the player while talking (default true). */
  turn?: boolean;
}

export interface TriggerDef {
  id: string;
  x0: number;
  x1: number;
  cond?: Cond;
  event: string;
}

export interface LightDef {
  x: number;
  y: number;
  texture: 'glow_warm' | 'glow_small' | 'glow_cold';
  scale?: number;
  alpha?: number;
  /** Only shown at night (finale). */
  nightOnly?: boolean;
}

export interface LevelDef {
  id: LevelId;
  name: string;
  width: number;
  outdoor: boolean;
  music: MusicKey;
  ambience?: string;
  parallax: { key: string; factor: number }[];
  backdrop: string;
  bounds: [number, number];
  props: PropDef[];
  npcs: NpcDef[];
  interactables: InteractableDef[];
  triggers: TriggerDef[];
  lights: LightDef[];
  stepSound: string;
}

const notNight: Cond = { notFlag: 'night' };
const beforeFinale: Cond = { notFlag: 'finale_started' };

export const LEVELS: Record<LevelId, LevelDef> = {
  apartment: {
    id: 'apartment',
    name: 'Квартира',
    width: 640,
    outdoor: false,
    music: 'music_home',
    parallax: [],
    backdrop: 'apartment',
    bounds: [36, 620],
    stepSound: 'sfx_step_floor',
    props: [
      { id: 'prop.boxes', texture: 'boxes', x: 150, y: 232, layer: 'back' },
      { id: 'prop.bread', texture: 'bread', x: 304, y: 184, layer: 'back', cond: { all: [{ notFlag: 'bread_taken' }, { not: { has: 'bread' } }] } },
      { id: 'prop.key', texture: 'key', x: 106, y: 116, layer: 'back', cond: { not: { has: 'key' } } },
    ],
    npcs: [
      { id: 'mama', x: 236, facing: 1, cond: { notFlag: 'night' }, dialogue: 'mama_talk' },
      { id: 'papa', x: 340, facing: -1, cond: { notFlag: 'night' }, dialogue: 'papa_talk' },
      { id: 'mama', x: 262, facing: 1, cond: { flag: 'night' }, dialogue: 'mama_talk' },
      { id: 'papa', x: 330, facing: -1, cond: { flag: 'night' }, dialogue: 'papa_talk' },
    ],
    interactables: [
      {
        id: 'door', x: 56, range: 22, label: 'Выйти во двор', priority: 2,
        action: {
          door: 'courtyard', spawnX: 200,
          requires: [
            { cond: { flag: 'intro_done' }, elseDialogue: 'door_not_yet' },
            { cond: { has: 'key' }, elseDialogue: 'door_locked' },
            { cond: { notFlag: 'night' }, elseDialogue: 'door_night' },
          ],
        },
      },
      { id: 'hooks', x: 108, range: 18, label: 'Взять ключ', priority: 3, cond: { not: { has: 'key' } }, action: { dialogue: 'pick_key' } },
      { id: 'boxes', x: 150, range: 18, label: 'Осмотреть', action: { dialogue: 'ins_boxes' } },
      { id: 'stove', x: 194, range: 14, label: 'Осмотреть', action: { dialogue: 'ins_stove' } },
      { id: 'radio', x: 222, range: 10, label: 'Послушать', action: { dialogue: 'ins_radio' } },
      { id: 'calendar', x: 240, range: 10, label: 'Осмотреть', action: { dialogue: 'ins_calendar' } },
      { id: 'window', x: 284, range: 16, label: 'Посмотреть в окно', action: { dialogue: 'ins_window' } },
      { id: 'bread', x: 304, range: 14, label: 'Взять хлеб', priority: 3, cond: { all: [{ notFlag: 'bread_taken' }, { not: { has: 'bread' } }, { notFlag: 'night' }] }, action: { dialogue: 'pick_bread' } },
      { id: 'fridge', x: 372, range: 16, label: 'Осмотреть', action: { dialogue: 'ins_fridge' } },
      { id: 'carpet', x: 470, range: 30, label: 'Осмотреть', action: { dialogue: 'ins_carpet' } },
      { id: 'tv', x: 578, range: 12, label: 'Осмотреть', action: { dialogue: 'ins_tv' } },
      { id: 'photo', x: 602, range: 12, label: 'Осмотреть', action: { dialogue: 'ins_photo' } },
    ],
    triggers: [],
    lights: [
      { x: 100, y: 44, texture: 'glow_warm', scale: 1.4, alpha: 0.5 },
      { x: 290, y: 44, texture: 'glow_warm', scale: 1.6, alpha: 0.55 },
      { x: 520, y: 44, texture: 'glow_warm', scale: 1.5, alpha: 0.5 },
      { x: 427, y: 142, texture: 'glow_small', scale: 1.4, alpha: 0.9 },
      { x: 578, y: 176, texture: 'glow_cold', scale: 0.5, alpha: 0.35, nightOnly: true },
    ],
  },

  courtyard: {
    id: 'courtyard',
    name: 'Двор',
    width: 1920,
    outdoor: true,
    music: 'music_yard',
    ambience: 'amb_wind',
    parallax: [
      { key: 'sky', factor: 0 },
      { key: 'far', factor: 0.15 },
      { key: 'mid', factor: 0.45 },
    ],
    backdrop: 'courtyard',
    bounds: [26, 1876],
    stepSound: 'sfx_step_snow',
    props: [
      { id: 'prop.lamp.entrance', texture: 'lamp', x: 140, y: 226, layer: 'back' },
      { id: 'prop.bench', texture: 'bench', x: 300, y: 228, layer: 'back' },
      { id: 'prop.drift.west', texture: 'drift_a', x: 400, y: 270, layer: 'front' },
      { id: 'prop.slide', texture: 'slide', x: 520, y: 216, layer: 'back' },
      { id: 'prop.lamp.playground', texture: 'lamp', x: 600, y: 270, layer: 'front' },
      { id: 'prop.swings', texture: 'swings', x: 760, y: 216, layer: 'back' },
      { id: 'prop.climber', texture: 'climber', x: 920, y: 212, layer: 'back' },
      { id: 'prop.car', texture: 'car', x: 1052, y: 226, layer: 'back' },
      { id: 'prop.lamp.car', texture: 'lamp', x: 1100, y: 226, layer: 'back' },
      { id: 'prop.trash', texture: 'trash', x: 1140, y: 224, layer: 'back' },
      { id: 'prop.drift.garages', texture: 'drift_b', x: 1250, y: 270, layer: 'front' },
      { id: 'prop.post', texture: 'post', x: 1508, y: 234, layer: 'back' },
      { id: 'prop.lamp.garages', texture: 'lamp', x: 1470, y: 270, layer: 'front' },
      { id: 'prop.drift.east', texture: 'drift_a', x: 1680, y: 270, layer: 'front' },
      { id: 'prop.lamp.arch', texture: 'lamp', x: 1770, y: 226, layer: 'back' },
    ],
    npcs: [
      { id: 'zina', x: 286, facing: 1, cond: notNight, dialogue: 'zina' },
      { id: 'vitya', x: 318, facing: -1, cond: notNight, dialogue: 'vitya' },
      { id: 'lyokha', x: 1298, facing: -1, anim: 'tinker', cond: beforeFinale, dialogue: 'lyokha' },
      { id: 'seryoga', x: 548, facing: 1, cond: { all: [{ stage: 'defend' }, { notFlag: 'fight_won' }] }, dialogue: 'seryoga_wait' },
      { id: 'sveta', x: 800, facing: -1, anim: 'draw', cond: { all: [{ stageAtLeast: 'talk_olya' }, beforeFinale] }, dialogue: 'sveta' },
      { id: 'olya', x: 700, facing: -1, cond: { all: [{ stageAtLeast: 'talk_olya' }, beforeFinale] }, dialogue: 'olya' },
      { id: 'sasha', x: 1420, facing: 1, cond: { all: [{ stageAtLeast: 'investigate' }, notNight] }, dialogue: 'sasha' },
    ],
    interactables: [
      { id: 'entrance', x: 196, range: 18, label: 'Войти в подъезд', priority: 2, action: { door: 'apartment', spawnX: 72 } },
      { id: 'board', x: 222, range: 8, label: 'Читать объявление', action: { dialogue: 'ins_board' } },
      { id: 'slide', x: 548, range: 22, label: 'Осмотреть', cond: { not: { stage: 'defend' } }, action: { dialogue: 'ins_slide' } },
      { id: 'swings', x: 750, range: 16, label: 'Осмотреть', action: { dialogue: 'ins_swings' } },
      { id: 'climber', x: 920, range: 26, label: 'Осмотреть', action: { dialogue: 'ins_climber' } },
      { id: 'car', x: 1052, range: 26, label: 'Осмотреть', action: { dialogue: 'ins_car' } },
      { id: 'trash_cans', x: 1140, range: 24, label: 'Выбросить банки', priority: 3, cond: { has: 'cans' }, action: { dialogue: 'throw_cans' } },
      { id: 'trash', x: 1140, range: 24, label: 'Осмотреть', action: { dialogue: 'ins_trash' } },
      { id: 'garage', x: 1220, range: 30, label: 'Осмотреть', action: { dialogue: 'ins_garage' } },
      { id: 'garage12', x: 1446, range: 14, label: 'Осмотреть гараж', priority: 1, cond: { stageAtLeast: 'investigate' }, action: { dialogue: 'ins_garage12' } },
      { id: 'mitten', x: 1600, range: 16, label: 'Раскопать', priority: 3, cond: { all: [{ flag: 'dog_digging' }, { notFlag: 'dog_dug' }] }, action: { dialogue: 'mitten_found' } },
      { id: 'garage17', x: 1590, range: 20, label: 'Осмотреть', action: { dialogue: 'ins_garage17' } },
      { id: 'arch', x: 1850, range: 26, label: 'Осмотреть', action: { dialogue: 'ins_arch' } },
    ],
    triggers: [
      { id: 'bullies', x0: 600, x1: 900, cond: { all: [{ stage: 'defend' }, { notFlag: 'bullies_started' }] }, event: 'bullies_scene' },
    ],
    lights: [
      // lamp-post glows are generated from the lamp props in WorldScene
      { x: 196, y: 159, texture: 'glow_small', scale: 1.3, alpha: 0.9 },
      { x: 1298, y: 190, texture: 'glow_small', scale: 1.6, alpha: 0.8 },
    ],
  },
};
