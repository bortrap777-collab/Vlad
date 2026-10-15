/** Menu screens shared by the title screen and the pause menu. */
import Phaser from 'phaser';
import { COLORS, UI_H, UI_W } from '../config';
import { services } from '../services';
import { ACTIONS, DEFAULT_KEYS, keyLabel, rebind, type Action, type TextSpeed } from '../core/settings';
import { SLOT_IDS, type SlotId } from '../core/save';
import { stageDef } from '../content/quests';
import { LEVELS } from '../content/levels';
import type { GameState } from '../core/state';
import { Menu, bar, formatDate, formatTime, panel, txt, type MenuItem } from './widgets';

export interface Screen {
  container: Phaser.GameObjects.Container;
  menu?: Menu;
  update?: () => void;
  /** Return false to block Esc-back (e.g. while capturing a key). */
  canBack?: () => boolean;
  destroy?: () => void;
}

export class ScreenStack {
  private stack: Screen[] = [];
  constructor(private scene: Phaser.Scene, private onEmpty?: () => void) {}

  get top(): Screen | undefined {
    return this.stack[this.stack.length - 1];
  }
  get size() {
    return this.stack.length;
  }

  push(s: Screen) {
    const prev = this.top;
    if (prev) {
      prev.container.setVisible(false);
      if (prev.menu) prev.menu.active = false;
    }
    this.stack.push(s);
  }

  pop() {
    const s = this.stack.pop();
    if (s) {
      s.destroy?.();
      s.menu?.destroy();
      s.container.destroy();
    }
    const t = this.top;
    if (t) {
      t.container.setVisible(true);
      if (t.menu) {
        t.menu.active = true;
        t.menu.refresh();
      }
    } else this.onEmpty?.();
  }

  clear() {
    while (this.stack.length) {
      const s = this.stack.pop()!;
      s.destroy?.();
      s.menu?.destroy();
      s.container.destroy();
    }
  }

  update() {
    const t = this.top;
    if (!t) return;
    t.update?.();
    const inp = services().input;
    if ((inp.codePressed('Escape') || inp.codePressed('Backspace')) && (t.canBack?.() ?? true)) {
      services().audio.sfx('sfx_ui_move', { volume: 0.5 });
      this.pop();
      return;
    }
    t.menu?.handleInput();
  }

  get scenes() {
    return this.scene;
  }
}

function frame(scene: Phaser.Scene, title: string, w = 620, h = 420, depth = 0): Phaser.GameObjects.Container {
  const c = scene.add.container(0, 0).setDepth(depth);
  const x = (UI_W - w) / 2, y = (UI_H - h) / 2;
  c.add(scene.add.rectangle(0, 0, UI_W, UI_H, 0x05060d, 0.55).setOrigin(0).setInteractive());
  c.add(panel(scene, x, y, w, h));
  c.add(txt(scene, UI_W / 2, y + 26, title, 26, COLORS.accentText, {}, true).setOrigin(0.5));
  return c;
}

const SPEED_LABEL: Record<TextSpeed, string> = { slow: 'медленно', normal: 'обычно', fast: 'быстро', instant: 'сразу' };
const SPEEDS: TextSpeed[] = ['slow', 'normal', 'fast', 'instant'];

export function settingsScreen(scene: Phaser.Scene, stack: ScreenStack, depth = 0): Screen {
  const sv = services();
  const c = frame(scene, 'Настройки', 640, 460, depth);
  const step = (k: 'master' | 'music' | 'sfx') => (d: -1 | 1) => sv.updateSettings((s) => (s[k] = Math.round(Math.max(0, Math.min(1, s[k] + d * 0.1)) * 10) / 10));
  const onOff = (v: boolean) => (v ? 'вкл.' : 'выкл.');
  const items: MenuItem[] = [
    { label: () => `Общая громкость   ${bar(sv.settings.master)}`, onAdjust: step('master'), hint: 'Стрелки влево/вправо — изменить' },
    { label: () => `Музыка                ${bar(sv.settings.music)}`, onAdjust: step('music'), hint: 'Стрелки влево/вправо — изменить' },
    { label: () => `Звуки                   ${bar(sv.settings.sfx)}`, onAdjust: step('sfx'), hint: 'Стрелки влево/вправо — изменить' },
    { label: () => `Звук: ${sv.settings.muted ? 'выключен' : 'включён'}`, onSelect: () => sv.updateSettings((s) => (s.muted = !s.muted)) },
    {
      label: () => `Скорость текста: ${SPEED_LABEL[sv.settings.textSpeed]}`,
      onAdjust: (d) => sv.updateSettings((s) => (s.textSpeed = SPEEDS[(SPEEDS.indexOf(s.textSpeed) + d + 4) % 4])),
      hint: 'Как быстро печатаются реплики.',
    },
    { label: () => `Субтитры звуков: ${onOff(sv.settings.captions)}`, onSelect: () => sv.updateSettings((s) => (s.captions = !s.captions)), hint: 'Подписи вроде «[Скулит собака]».' },
    { label: () => `Меньше движения: ${onOff(sv.settings.reducedMotion)}`, onSelect: () => sv.updateSettings((s) => (s.reducedMotion = !s.reducedMotion)), hint: 'Без тряски камеры, меньше снегопада и вспышек.' },
    { label: () => `Полный экран: ${onOff(scene.scale.isFullscreen)}`, onSelect: () => (scene.scale.isFullscreen ? scene.scale.stopFullscreen() : scene.scale.startFullscreen()) },
    { label: 'Назад', onSelect: () => stack.pop() },
  ];
  const menu = new Menu(scene, UI_W / 2 - 250, 128, items, { size: 20, gap: 36, hintY: 450 });
  c.add(menu.container);
  return { container: c, menu };
}

const ACTION_LABEL: Record<Action, string> = {
  left: 'Влево',
  right: 'Вправо',
  interact: 'Действие / толчок',
  sprint: 'Бег / уклонение',
  block: 'Блок',
  journal: 'Дневник',
  history: 'История реплик',
  pause: 'Пауза',
};

export function controlsScreen(scene: Phaser.Scene, stack: ScreenStack, depth = 0): Screen {
  const sv = services();
  const c = frame(scene, 'Управление', 680, 500, depth);
  let capturing: Action | null = null;
  const status = txt(scene, UI_W / 2, 488, 'Выберите действие и нажмите Enter, чтобы переназначить клавишу.', 15, COLORS.textDim).setOrigin(0.5);
  c.add(status);
  const items: MenuItem[] = ACTIONS.map((a) => ({
    label: () => `${ACTION_LABEL[a].padEnd(20, ' ')}${sv.settings.keys[a].map(keyLabel).join(' / ')}${capturing === a ? '   …' : ''}`,
    onSelect: () => {
      capturing = a;
      status.setText(`Нажмите новую клавишу для «${ACTION_LABEL[a]}».`).setColor(COLORS.accentText);
      menu.active = false;
      menu.refresh();
      sv.input.captureNext = (code) => {
        if (code !== 'Escape') sv.updateSettings((s) => rebind(s, a, code));
        capturing = null;
        status.setText(code === 'Escape' ? 'Отменено.' : 'Готово.').setColor(COLORS.textDim);
        // swallow this frame's input so the same press doesn't re-trigger the menu
        scene.time.delayedCall(80, () => {
          menu.active = true;
          menu.refresh();
        });
      };
    },
  }));
  items.push({
    label: 'Сбросить по умолчанию',
    onSelect: () => {
      sv.updateSettings((s) => (s.keys = JSON.parse(JSON.stringify(DEFAULT_KEYS))));
      status.setText('Клавиши сброшены.');
    },
  });
  items.push({ label: 'Назад', onSelect: () => stack.pop() });
  const menu = new Menu(scene, UI_W / 2 - 290, 96, items, { size: 18, gap: 34 });
  c.add(menu.container);
  const help = txt(scene, UI_W / 2 - 290, 96 + items.length * 34, 'Мышью можно нажимать на пункты меню и варианты ответов.', 14, COLORS.textDim);
  c.add(help);
  return {
    container: c,
    menu,
    canBack: () => capturing === null,
    destroy: () => {
      sv.input.captureNext = null;
    },
  };
}

function slotLabel(slot: SlotId): string {
  const sv = services();
  const name = slot === 'auto' ? 'Автосохранение' : `Слот ${slot.slice(-1)}`;
  const st = sv.saves.status(slot);
  if (st === 'empty') return `${name} — пусто`;
  if (st === 'corrupt') return `${name} — файл повреждён`;
  if (st === 'version') return `${name} — несовместимая версия`;
  const m = sv.saves.meta(slot)!;
  return `${name} — ${LEVELS[m.level as GameState['level']].name}, ${formatDate(m.savedAt)}, ${formatTime(m.playTime)}`;
}

export function slotsScreen(scene: Phaser.Scene, stack: ScreenStack, mode: 'save' | 'load', onDone: (state?: GameState) => void, depth = 0): Screen {
  const sv = services();
  const c = frame(scene, mode === 'save' ? 'Сохранить игру' : 'Загрузить игру', 760, 380, depth);
  const status = txt(scene, UI_W / 2, 412, sv.saves.available ? '' : 'Хранилище браузера недоступно — сохранения не будут работать.', 15, COLORS.textBad).setOrigin(0.5);
  c.add(status);
  const slots = mode === 'save' ? SLOT_IDS.filter((s) => s !== 'auto') : SLOT_IDS;
  const items: MenuItem[] = slots.map((slot) => ({
    label: () => slotLabel(slot),
    disabled: () => mode === 'load' && sv.saves.status(slot) !== 'ok',
    onSelect: () => {
      if (mode === 'save') {
        const ok = sv.session?.save(slot) ?? false;
        status.setText(ok ? 'Игра сохранена.' : 'Не удалось сохранить.').setColor(ok ? COLORS.textGood : COLORS.textBad);
        menu.refresh();
        onDone();
      } else {
        const r = sv.saves.load(slot);
        if (r.ok) onDone(r.state);
        else status.setText('Сохранение повреждено и не может быть загружено.').setColor(COLORS.textBad);
      }
    },
  })) as MenuItem[];
  items.push({ label: 'Назад', onSelect: () => stack.pop() });
  const menu = new Menu(scene, UI_W / 2 - 340, 120, items, { size: 18, gap: 40 });
  c.add(menu.container);
  if (slots.every((s) => sv.saves.status(s) !== 'ok') && mode === 'load') status.setText('Сохранений пока нет.').setColor(COLORS.textDim);
  return { container: c, menu };
}

export function creditsScreen(scene: Phaser.Scene, stack: ScreenStack, depth = 0): Screen {
  const c = frame(scene, 'Авторы', 700, 470, depth);
  const lines = [
    '«Коля: Маленький хулиган» — глава 1 «Новый двор»',
    '',
    'Сценарий, код, пиксельная графика, музыка и звуки —',
    'оригинальные, созданы специально для этой игры.',
    'Графика и звук генерируются скриптами из папки tools/.',
    '',
    'Движок: Phaser 3 (лицензия MIT).',
    'Шрифты: PT Sans (ParaType, SIL OFL 1.1),',
    'Tiny5 (The Tiny5 Project Authors, SIL OFL 1.1).',
    '',
    'Все персонажи и события вымышлены.',
    'Любые совпадения случайны.',
  ];
  c.add(txt(scene, UI_W / 2, 100, lines.join('\n'), 17, COLORS.text, { align: 'center', lineSpacing: 6 }).setOrigin(0.5, 0));
  const menu = new Menu(scene, UI_W / 2, 470, [{ label: 'Назад', onSelect: () => stack.pop() }], { size: 20, align: 'center' });
  c.add(menu.container);
  return { container: c, menu };
}

export function objectiveText(stage: string): string {
  return stageDef(stage).objective;
}
