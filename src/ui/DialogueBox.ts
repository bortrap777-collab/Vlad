/** Bottom dialogue box: portrait, name plate, typewriter text, branching choices. */
import Phaser from 'phaser';
import { COLORS, UI_W } from '../config';
import { services } from '../services';
import { TEXT_CPS, keyLabel } from '../core/settings';
import { panel, txt } from './widgets';

export interface ShowArgs {
  name: string;
  text: string;
  portrait: { key: string; frame: number } | null;
  voice: number;
  narrator: boolean;
  choices: string[];
  /** Auto-resolve without waiting (cutscene skip). */
  skip: boolean;
}

/** The box sits at the top of the screen so characters standing on the ground stay visible. */
const BOX_X = 20, BOX_Y = 64, BOX_W = UI_W - 40, BOX_H = 140;

export class DialogueBox {
  readonly container: Phaser.GameObjects.Container;
  private portraitBg: Phaser.GameObjects.Graphics;
  private portrait: Phaser.GameObjects.Image;
  private namePlate: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  private body: Phaser.GameObjects.Text;
  private arrow: Phaser.GameObjects.Text;
  private hint: Phaser.GameObjects.Text;
  private choiceBox: Phaser.GameObjects.Container;
  private choiceTexts: Phaser.GameObjects.Text[] = [];
  private full = '';
  private shown = 0;
  private acc = 0;
  private blipCount = 0;
  private voice = 0;
  private choices: string[] = [];
  private sel = 0;
  private resolve: ((v: number) => void) | null = null;
  onTyping: ((typing: boolean) => void) | null = null;

  constructor(private scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0).setDepth(50).setVisible(false);
    this.container.add(panel(scene, BOX_X, BOX_Y, BOX_W, BOX_H, 0.95));
    this.portraitBg = scene.add.graphics();
    this.portraitBg.fillStyle(0x070913, 1).fillRect(BOX_X + 14, BOX_Y + 6, 132, 128);
    this.portraitBg.fillStyle(0x1b2340, 1).fillRect(BOX_X + 16, BOX_Y + 8, 128, 124);
    this.portrait = scene.add.image(BOX_X + 80, BOX_Y + 70, 'portrait_kolya', 0).setScale(2);
    this.namePlate = scene.add.graphics();
    this.nameText = txt(scene, BOX_X + 30, BOX_Y - 14, '', 19, COLORS.accentText, {}, true).setOrigin(0, 0.5);
    this.body = txt(scene, BOX_X + 164, BOX_Y + 16, '', 21, COLORS.text, { lineSpacing: 5 });
    this.arrow = txt(scene, BOX_X + BOX_W - 24, BOX_Y + BOX_H - 18, '▼', 16, COLORS.accentText).setOrigin(0.5);
    this.hint = txt(scene, BOX_X + BOX_W - 44, BOX_Y + BOX_H - 18, '', 13, COLORS.textDim).setOrigin(1, 0.5);
    this.choiceBox = scene.add.container(0, 0).setVisible(false);
    this.container.add([this.portraitBg, this.portrait, this.namePlate, this.nameText, this.body, this.arrow, this.hint, this.choiceBox]);
    scene.tweens.add({ targets: this.arrow, y: this.arrow.y + 3, duration: 450, yoyo: true, repeat: -1 });
    // click anywhere on the box to continue
    const hit = scene.add.rectangle(BOX_X, BOX_Y, BOX_W, BOX_H, 0, 0).setOrigin(0).setInteractive();
    hit.on('pointerdown', () => this.onConfirm());
    this.container.addAt(hit, 1);
  }

  get open() {
    return this.container.visible;
  }

  get debug() {
    return { text: this.full, typing: this.typing, choices: this.choices.slice(), sel: this.sel };
  }

  private get typing() {
    return this.shown < this.full.length;
  }

  show(a: ShowArgs): Promise<number> {
    this.container.setVisible(true);
    this.choices = a.choices;
    this.sel = 0;
    this.voice = a.voice;
    this.choiceBox.setVisible(false).removeAll(true);
    this.choiceTexts = [];
    const hasPortrait = !!a.portrait;
    this.portraitBg.setVisible(hasPortrait);
    this.portrait.setVisible(hasPortrait);
    if (a.portrait) this.portrait.setTexture(a.portrait.key, a.portrait.frame);
    const textX = hasPortrait ? BOX_X + 164 : BOX_X + 30;
    const wrapW = BOX_X + BOX_W - 40 - textX;
    this.body.setPosition(textX, BOX_Y + 18);
    this.body.setColor(a.narrator ? '#c9d2ee' : COLORS.text);
    this.body.setFontStyle(a.narrator ? 'italic' : 'normal');
    // pre-wrap so words never jump between lines while typing
    this.body.setWordWrapWidth(wrapW, false);
    const lines = this.body.getWrappedText(a.text);
    this.body.setWordWrapWidth(null);
    this.full = lines.join('\n');
    this.shown = 0;
    this.acc = 0;
    this.namePlate.clear();
    if (a.name) {
      this.nameText.setText(a.name).setVisible(true);
      const w = this.nameText.width + 30;
      this.namePlate.fillStyle(0x070913, 1).fillRect(BOX_X + 14, BOX_Y - 30, w + 4, 32);
      this.namePlate.fillStyle(COLORS.panelEdge, 1).fillRect(BOX_X + 16, BOX_Y - 28, w, 28);
      this.namePlate.fillStyle(0x1b2340, 1).fillRect(BOX_X + 18, BOX_Y - 26, w - 4, 24);
    } else this.nameText.setVisible(false);
    const k = services().settings.keys;
    this.hint.setText(services().isTouch ? 'Нажмите на окно — дальше' : `${keyLabel(k.interact[0])} — дальше · ${keyLabel(k.history[0])} — история`);
    if (a.skip && !a.choices.length) {
      this.shown = this.full.length;
      this.body.setText(this.full);
      return Promise.resolve(-1);
    }
    if (a.skip) this.shown = this.full.length;
    this.body.setText(this.full.slice(0, this.shown));
    this.arrow.setVisible(false);
    this.onTyping?.(true);
    if (!this.typing) this.finishTyping();
    return new Promise((res) => (this.resolve = res));
  }

  hide() {
    this.container.setVisible(false);
    this.onTyping?.(false);
  }

  private finishTyping() {
    this.shown = this.full.length;
    this.body.setText(this.full);
    this.onTyping?.(false);
    if (this.choices.length) {
      this.arrow.setVisible(false);
      this.buildChoices();
    } else this.arrow.setVisible(true);
  }

  private buildChoices() {
    const n = this.choices.length;
    const lineH = 34;
    const h = n * lineH + 20;
    const w = 640;
    const x = UI_W - w - 30, y = BOX_Y + BOX_H + 14;
    this.choiceBox.add(panel(this.scene, x, y, w, h, 0.96));
    this.choices.forEach((c, i) => {
      const t = txt(this.scene, x + 22, y + 14 + i * lineH, `${i + 1}. ${c}`, 19, COLORS.text, { wordWrap: { width: w - 44 } });
      t.setInteractive({ useHandCursor: true });
      t.on('pointerover', () => {
        this.sel = i;
        this.refreshChoices();
      });
      t.on('pointerdown', () => {
        this.sel = i;
        this.pick();
      });
      this.choiceTexts.push(t);
      this.choiceBox.add(t);
    });
    this.choiceBox.setVisible(true);
    this.refreshChoices();
  }

  private refreshChoices() {
    this.choiceTexts.forEach((t, i) => t.setColor(i === this.sel ? COLORS.accentText : COLORS.text));
  }

  private pick() {
    const r = this.resolve;
    if (!r) return;
    services().audio.sfx('sfx_ui_ok', { volume: 0.6 });
    this.resolve = null;
    this.choiceBox.setVisible(false);
    r(this.sel);
  }

  /** Cutscene skip: complete the current line; lines without choices resolve at once. */
  skipNow() {
    if (!this.resolve) return;
    if (this.typing) this.finishTyping();
    if (!this.choices.length) {
      const r = this.resolve;
      this.resolve = null;
      r(-1);
    }
  }

  private onConfirm() {
    if (!this.resolve) return;
    if (this.typing) {
      this.finishTyping();
      return;
    }
    if (this.choices.length) return;
    const r = this.resolve;
    this.resolve = null;
    r(-1);
  }

  update(dt: number) {
    if (!this.open) return;
    const sv = services();
    const inp = sv.input;
    if (this.typing && this.resolve) {
      this.acc += dt * TEXT_CPS[sv.settings.textSpeed];
      const before = this.shown;
      this.shown = Math.min(this.full.length, this.shown + Math.floor(this.acc));
      this.acc -= Math.floor(this.acc);
      if (this.shown !== before) {
        this.body.setText(this.full.slice(0, this.shown));
        const ch = this.full[this.shown - 1];
        if (ch && /[А-Яа-яЁёA-Za-z0-9]/.test(ch) && this.blipCount++ % 3 === 0) sv.audio.sfx('sfx_blip', { detune: this.voice + Phaser.Math.Between(-60, 60), volume: 0.35 });
        if (!this.typing) this.finishTyping();
      }
    }
    if (this.choices.length && !this.typing && this.resolve) {
      if (inp.codePressed('ArrowUp') || inp.codePressed('KeyW')) {
        this.sel = (this.sel - 1 + this.choices.length) % this.choices.length;
        sv.audio.sfx('sfx_ui_move', { volume: 0.5 });
        this.refreshChoices();
      }
      if (inp.codePressed('ArrowDown') || inp.codePressed('KeyS')) {
        this.sel = (this.sel + 1) % this.choices.length;
        sv.audio.sfx('sfx_ui_move', { volume: 0.5 });
        this.refreshChoices();
      }
      for (let i = 0; i < this.choices.length; i++)
        if (inp.codePressed(`Digit${i + 1}`) || inp.codePressed(`Numpad${i + 1}`)) {
          this.sel = i;
          this.pick();
          return;
        }
      if (inp.justPressed('interact') || inp.codePressed('Space')) this.pick();
      return;
    }
    if (inp.justPressed('interact') || inp.codePressed('Space')) this.onConfirm();
  }
}

