/** Journal: objectives, clues (with combining) and inventory. Spoiler-free by design. */
import Phaser from 'phaser';
import { COLORS, UI_H, UI_W } from '../config';
import { services } from '../services';
import { STAGES, stageDef, stageIndex } from '../content/quests';
import { CLUES, ITEMS } from '../content/items';
import { keyLabel } from '../core/settings';
import type { ClueId, ItemId } from '../core/types';
import { panel, txt } from './widgets';

const X = 50, Y = 36, W = UI_W - 100, H = UI_H - 72;
const TABS = ['Задания', 'Улики', 'Вещи'];

export class Journal {
  readonly container: Phaser.GameObjects.Container;
  private content: Phaser.GameObjects.Container;
  private tabTexts: Phaser.GameObjects.Text[] = [];
  tab = 0;
  private sel = 0;
  private marked: ClueId[] = [];
  private message = '';
  private messageColor: string = COLORS.textDim;

  constructor(private scene: Phaser.Scene, private onClose: () => void) {
    this.container = scene.add.container(0, 0).setDepth(80).setVisible(false);
    this.container.add(scene.add.rectangle(0, 0, UI_W, UI_H, 0x05060d, 0.6).setOrigin(0).setInteractive());
    this.container.add(panel(scene, X, Y, W, H, 0.97));
    this.container.add(txt(scene, X + 26, Y + 18, 'Дневник Коли', 24, COLORS.accentText, {}, true));
    TABS.forEach((t, i) => {
      const tt = txt(scene, X + 300 + i * 150, Y + 22, t, 20, COLORS.text, {}, true).setInteractive({ useHandCursor: true });
      tt.on('pointerdown', () => this.setTab(i));
      this.tabTexts.push(tt);
      this.container.add(tt);
    });
    const close = txt(scene, X + W - 20, Y + 22, '✕', 20, COLORS.textDim, {}, true).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => this.onClose());
    this.container.add(close);
    this.content = scene.add.container(0, 0);
    this.container.add(this.content);
  }

  get open() {
    return this.container.visible;
  }

  show(tab?: number) {
    this.container.setVisible(true);
    if (tab !== undefined) this.tab = tab;
    this.sel = 0;
    this.marked = [];
    this.message = '';
    this.render();
    services().audio.sfx('sfx_ui_ok', { volume: 0.5, detune: -300 });
  }

  hide() {
    this.container.setVisible(false);
  }

  private setTab(i: number) {
    this.tab = (i + TABS.length) % TABS.length;
    this.sel = 0;
    this.message = '';
    services().audio.sfx('sfx_ui_move', { volume: 0.5 });
    this.render();
  }

  private clues(): ClueId[] {
    return services().session!.state.clues;
  }
  private items(): ItemId[] {
    return services().session!.state.inventory;
  }

  private render() {
    const s = this.scene;
    this.content.removeAll(true);
    this.tabTexts.forEach((t, i) => t.setColor(i === this.tab ? COLORS.accentText : COLORS.textDim));
    const line = s.add.graphics().fillStyle(COLORS.panelEdge, 1).fillRect(X + 20, Y + 58, W - 40, 2);
    this.content.add(line);
    const st = services().session!.state;
    const keys = services().settings.keys;
    const footer = (t: string) => this.content.add(txt(s, X + 26, Y + H - 30, t, 14, COLORS.textDim));

    if (this.tab === 0) {
      const cur = stageDef(st.stage);
      this.content.add(txt(s, X + 30, Y + 80, 'Сейчас', 16, COLORS.textDim, {}, true));
      this.content.add(txt(s, X + 30, Y + 104, cur.objective, 24, COLORS.text, { wordWrap: { width: W - 60 } }, true));
      if (cur.hint) this.content.add(txt(s, X + 30, Y + 142, cur.hint, 17, COLORS.textDim, { wordWrap: { width: W - 60 } }));
      this.content.add(txt(s, X + 30, Y + 196, 'Выполнено', 16, COLORS.textDim, {}, true));
      const done = STAGES.slice(1, stageIndex(st.stage));
      const list = done.length ? done.map((d) => `✓  ${d.objective}`).join('\n') : 'Пока ничего. Всё впереди.';
      this.content.add(txt(s, X + 30, Y + 220, list, 17, '#8f9ac0', { lineSpacing: 6, wordWrap: { width: W - 60 } }));
      footer(`A/D — вкладки · ${keyLabel(keys.journal[0])} или Esc — закрыть`);
      return;
    }

    if (this.tab === 1) {
      const clues = this.clues();
      if (!clues.length) {
        this.content.add(txt(s, X + 30, Y + 90, 'Улик пока нет. Смотри по сторонам и расспрашивай людей.', 18, COLORS.textDim));
        footer('A/D — вкладки · Esc — закрыть');
        return;
      }
      this.sel = Math.min(this.sel, clues.length - 1);
      clues.forEach((id, i) => {
        const c = CLUES[id];
        const mark = this.marked.includes(id) ? '● ' : c.insight ? '★ ' : '   ';
        const color = i === this.sel ? COLORS.accentText : c.insight ? '#ffd27a' : COLORS.text;
        const t = txt(s, X + 30, Y + 78 + i * 30, mark + c.title, 18, color).setInteractive({ useHandCursor: true });
        t.on('pointerdown', () => {
          if (this.sel === i) this.toggleMark();
          else {
            this.sel = i;
            this.render();
          }
        });
        this.content.add(t);
      });
      const c = CLUES[clues[this.sel]];
      const px = X + 360;
      this.content.add(s.add.graphics().fillStyle(0x0b1022, 1).fillRect(px - 14, Y + 72, W - (px - X) - 16, 250));
      this.content.add(txt(s, px, Y + 84, c.title, 21, c.insight ? '#ffd27a' : COLORS.accentText, { wordWrap: { width: W - (px - X) - 50 } }, true));
      this.content.add(txt(s, px, Y + 120, c.text, 18, COLORS.text, { wordWrap: { width: W - (px - X) - 50 }, lineSpacing: 4 }));
      const can = this.marked.length === 2;
      const btn = txt(s, px, Y + 340, `[ Сопоставить (${this.marked.length}/2) ]`, 19, can ? COLORS.accentText : '#58617e', {}, true).setInteractive({ useHandCursor: can });
      btn.on('pointerdown', () => this.combine());
      this.content.add(btn);
      if (this.message) this.content.add(txt(s, px, Y + 372, this.message, 17, this.messageColor, { wordWrap: { width: W - (px - X) - 50 } }));
      footer(`W/S — выбрать · Enter — отметить улику · C — сопоставить две отмеченные · Esc — закрыть`);
      return;
    }

    const items = this.items();
    if (!items.length) {
      this.content.add(txt(s, X + 30, Y + 90, 'Карманы пусты.', 18, COLORS.textDim));
      footer('A/D — вкладки · Esc — закрыть');
      return;
    }
    this.sel = Math.min(this.sel, items.length - 1);
    items.forEach((id, i) => {
      const it = ITEMS[id];
      const icon = s.add.image(X + 44, Y + 92 + i * 40, 'items', it.icon).setScale(2);
      const t = txt(s, X + 70, Y + 92 + i * 40, it.name, 18, i === this.sel ? COLORS.accentText : COLORS.text).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => {
        this.sel = i;
        this.render();
      });
      this.content.add([icon, t]);
    });
    const it = ITEMS[items[this.sel]];
    const px = X + 380;
    this.content.add(s.add.graphics().fillStyle(0x0b1022, 1).fillRect(px - 14, Y + 72, W - (px - X) - 16, 250));
    this.content.add(s.add.image(px + 24, Y + 110, 'items', it.icon).setScale(4));
    this.content.add(txt(s, px + 64, Y + 96, it.name, 21, COLORS.accentText, {}, true));
    this.content.add(txt(s, px, Y + 150, it.description, 18, COLORS.text, { wordWrap: { width: W - (px - X) - 50 }, lineSpacing: 4 }));
    footer('W/S — выбрать · A/D — вкладки · Esc — закрыть');
  }

  private toggleMark() {
    const clues = this.clues();
    const id = clues[this.sel];
    if (!id) return;
    if (this.marked.includes(id)) this.marked = this.marked.filter((m) => m !== id);
    else {
      this.marked.push(id);
      if (this.marked.length > 2) this.marked.shift();
    }
    services().audio.sfx('sfx_ui_move', { volume: 0.6 });
    this.message = '';
    this.render();
  }

  private combine() {
    if (this.marked.length !== 2) {
      this.message = 'Отметь две улики, которые, как тебе кажется, связаны.';
      this.messageColor = COLORS.textDim;
      this.render();
      return;
    }
    const r = services().session!.combine(this.marked[0], this.marked[1]);
    if (r.ok) {
      this.message = r.already ? 'Это ты уже понял. ' + r.text : r.text!;
      this.messageColor = '#ffd27a';
      if (!r.already) services().audio.sfx('sfx_clue');
    } else {
      this.message = 'Хм… Нет, эти две вещи никак не связаны.';
      this.messageColor = COLORS.textBad;
      services().audio.sfx('sfx_block', { volume: 0.4 });
    }
    this.marked = [];
    this.render();
  }

  update() {
    const inp = services().input;
    if (inp.justPressed('journal') || inp.codePressed('Escape')) {
      this.onClose();
      return;
    }
    if (inp.codePressed('ArrowLeft') || inp.codePressed('KeyA') || inp.codePressed('KeyQ')) this.setTab(this.tab - 1);
    if (inp.codePressed('ArrowRight') || inp.codePressed('KeyD')) this.setTab(this.tab + 1);
    const n = this.tab === 1 ? this.clues().length : this.tab === 2 ? this.items().length : 0;
    if (n) {
      if (inp.codePressed('ArrowUp') || inp.codePressed('KeyW')) {
        this.sel = (this.sel - 1 + n) % n;
        services().audio.sfx('sfx_ui_move', { volume: 0.4 });
        this.render();
      }
      if (inp.codePressed('ArrowDown') || inp.codePressed('KeyS')) {
        this.sel = (this.sel + 1) % n;
        services().audio.sfx('sfx_ui_move', { volume: 0.4 });
        this.render();
      }
    }
    if (this.tab === 1) {
      if (inp.codePressed('Enter') || inp.justPressed('interact') || inp.codePressed('Space')) this.toggleMark();
      if (inp.codePressed('KeyC')) this.combine();
    }
  }

  /** Test/debug view. */
  get debug() {
    return { tab: this.tab, sel: this.sel, marked: this.marked.slice(), message: this.message };
  }
}
