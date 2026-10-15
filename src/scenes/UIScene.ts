/**
 * Overlay UI running on top of the world: HUD, dialogue, journal, pause menu,
 * mini-game, fight HUD, captions and cinematic bars.
 */
import Phaser from 'phaser';
import { COLORS, UI_H, UI_W, UI_ZOOM, ZOOM } from '../config';
import { services } from '../services';
import { DIALOGUES } from '../content/dialogues';
import { CHARACTERS, displayName } from '../content/characters';
import { ITEMS, CLUES } from '../content/items';
import { stageDef } from '../content/quests';
import { DialogueRunner } from '../core/dialogue';
import type { StateEvent, GameState } from '../core/state';
import { keyLabel } from '../core/settings';
import { Session } from '../core/session';
import { DialogueBox } from '../ui/DialogueBox';
import { Journal } from '../ui/Journal';
import { Menu, panel, txt } from '../ui/widgets';
import { ScreenStack, controlsScreen, settingsScreen, slotsScreen, type Screen } from '../ui/screens';
import { MANIFEST } from './BootScene';
import type { WorldScene } from './WorldScene';
import type { Fight } from '../world/Fight';
import type { TouchContext } from '../ui/TouchControls';

interface Toast {
  c: Phaser.GameObjects.Container;
}

export class UIScene extends Phaser.Scene {
  private dialogue!: DialogueBox;
  private journal!: Journal;
  private stack!: ScreenStack;
  private tracker!: Phaser.GameObjects.Container;
  private trackerText!: Phaser.GameObjects.Text;
  private trackerHint!: Phaser.GameObjects.Text;
  private promptBox!: Phaser.GameObjects.Container;
  private promptText!: Phaser.GameObjects.Text;
  private promptTarget: { label: string; x: number } | null = null;
  private toasts: Toast[] = [];
  private savingText!: Phaser.GameObjects.Text;
  private captionText!: Phaser.GameObjects.Text;
  private bars: Phaser.GameObjects.Rectangle[] = [];
  private skipHint!: Phaser.GameObjects.Text;
  private fader!: Phaser.GameObjects.Rectangle;
  private fightHud: Phaser.GameObjects.Container | null = null;
  private fight: Fight | null = null;
  private fightHelp: Phaser.GameObjects.Text | null = null;
  private history: Phaser.GameObjects.Container | null = null;
  private minigame: { update: (dt: number) => void; debug: () => unknown } | null = null;
  private overlayMenu: Menu | null = null;
  private dialogueActive = false;
  private cutsceneOn = false;
  private paused = false;

  constructor() {
    super('UI');
  }

  get world(): WorldScene {
    return this.scene.get('World') as WorldScene;
  }

  /** True when an overlay should block world input. */
  get modal(): boolean {
    return this.paused || this.journal?.open || !!this.history || !!this.minigame || !!this.overlayMenu;
  }

  create() {
    const sv = services();
    this.cameras.main.setOrigin(0, 0).setZoom(UI_ZOOM);
    this.toasts = [];
    this.bars = [];
    this.fightHud = null;
    this.history = null;
    this.minigame = null;
    this.overlayMenu = null;
    this.paused = false;

    // cinematic bars
    this.bars = [this.add.rectangle(0, -40, UI_W, 40, 0x000000).setOrigin(0).setDepth(5), this.add.rectangle(0, UI_H, UI_W, 40, 0x000000).setOrigin(0).setDepth(5)];
    this.skipHint = txt(this, UI_W - 14, UI_H - 12, 'Esc — пропустить сцену', 14, COLORS.textDim).setOrigin(1, 1).setDepth(6).setVisible(false);

    // quest tracker
    this.tracker = this.add.container(16, 14).setDepth(10);
    const tg = this.add.graphics();
    this.trackerText = txt(this, 14, 26, '', 18, COLORS.text, { wordWrap: { width: 330 } }, true);
    this.trackerHint = txt(this, 14, 6, 'Цель', 13, COLORS.accentText, {}, true);
    this.tracker.add([tg, this.trackerHint, this.trackerText]);
    this.tracker.setData('bg', tg);
    this.refreshTracker();

    // interaction prompt
    this.promptBox = this.add.container(0, 0).setDepth(12).setVisible(false);
    this.promptText = txt(this, 0, 0, '', 16, COLORS.text, {}, true).setOrigin(0.5);
    this.promptBox.add([this.add.graphics(), this.promptText]);

    this.savingText = txt(this, UI_W - 16, 16, '❄ Сохранение…', 14, COLORS.textDim).setOrigin(1, 0).setDepth(10).setAlpha(0);
    this.captionText = txt(this, UI_W / 2, 120, '', 17, '#dfe6ff', { backgroundColor: '#070913cc', padding: { x: 10, y: 4 } }).setOrigin(0.5).setDepth(40).setAlpha(0);

    this.dialogue = new DialogueBox(this);
    this.journal = new Journal(this, () => this.closeJournal());
    this.stack = new ScreenStack(this, () => this.resumeFromPause());
    this.fader = this.add.rectangle(0, 0, UI_W, UI_H, 0x070913).setOrigin(0).setDepth(100).setAlpha(0);

    sv.audio.onCaption = (t) => this.caption(t, 1800);
    this.events.once('shutdown', () => (sv.audio.onCaption = null));
  }

  /** Called when the world scene restarts (level change / load). */
  resetForWorld() {
    this.setPrompt(null);
    this.setCutscene(false);
    this.fightEnd();
    this.refreshTracker();
    this.fader.setAlpha(0);
    this.setVisible(true);
  }

  setVisible(v: boolean) {
    this.cameras.main.setVisible(v);
  }

  // ------------------------------------------------------------------ HUD
  refreshTracker() {
    const st = services().session?.state;
    if (!st || !this.trackerText) return;
    const obj = stageDef(st.stage).objective;
    this.trackerText.setText(obj);
    const g = this.tracker.getData('bg') as Phaser.GameObjects.Graphics;
    const w = Math.max(200, this.trackerText.width + 28), h = this.trackerText.height + 36;
    g.clear().fillStyle(0x070913, 0.72).fillRect(0, 0, w, h).fillStyle(COLORS.accent, 1).fillRect(0, 0, 3, h);
    const k = services().settings.keys;
    this.trackerHint.setText(services().isTouch ? 'Цель' : `Цель · ${keyLabel(k.journal[0])} — дневник`);
  }

  setPrompt(p: { label: string; x: number } | null) {
    this.promptTarget = p;
    if (!this.promptBox) return;
    if (!p) {
      this.promptBox.setVisible(false);
      return;
    }
    const sv = services();
    const key = keyLabel(sv.settings.keys.interact[0]);
    this.promptText.setText(sv.isTouch ? `${p.label}` : `[${key}]  ${p.label}`);
    const g = this.promptBox.getAt(0) as Phaser.GameObjects.Graphics;
    const w = this.promptText.width + (sv.isTouch ? 34 : 22), h = sv.isTouch ? 38 : 30;
    g.clear().fillStyle(0x070913, 0.85).fillRect(-w / 2, -h / 2, w, h).lineStyle(2, COLORS.accent, 1).strokeRect(-w / 2, -h / 2, w, h);
    // on touch screens the prompt itself is a button
    this.promptBox.setSize(w, h);
    if (!this.promptBox.input) {
      this.promptBox.setInteractive({ useHandCursor: true });
      this.promptBox.on('pointerdown', () => services().input.tap('interact'));
    }
    this.promptBox.setVisible(true);
  }

  movePrompt(x: number) {
    if (this.promptTarget) this.promptTarget.x = x;
  }

  private positionPrompt() {
    if (!this.promptTarget || !this.world?.cameras) return;
    const cam = this.world.cameras.main;
    const k = ZOOM / UI_ZOOM;
    const x = Phaser.Math.Clamp((this.promptTarget.x - cam.worldView.x) * k, 80, UI_W - 80);
    const y = (150 - cam.worldView.y) * k;
    this.promptBox.setPosition(Math.round(x), Math.round(y));
  }

  toast(text: string, icon?: number) {
    const c = this.add.container(UI_W / 2, 236 + this.toasts.length * 44).setDepth(30);
    const t = txt(this, icon !== undefined ? 16 : 0, 0, text, 17, COLORS.text, { wordWrap: { width: 600 } }).setOrigin(0.5);
    const w = t.width + (icon !== undefined ? 64 : 32), h = Math.max(36, t.height + 14);
    const g = this.add.graphics().fillStyle(0x070913, 0.88).fillRect(-w / 2, -h / 2, w, h).fillStyle(COLORS.accent, 1).fillRect(-w / 2, -h / 2, w, 2);
    c.add([g, t]);
    if (icon !== undefined) c.add(this.add.image(-w / 2 + 22, 0, 'items', icon).setScale(2));
    c.setAlpha(0);
    const item = { c };
    this.toasts.push(item);
    this.tweens.add({ targets: c, alpha: 1, y: c.y + 6, duration: 250 });
    this.time.delayedCall(3600, () =>
      this.tweens.add({
        targets: c,
        alpha: 0,
        duration: 400,
        onComplete: () => {
          c.destroy();
          this.toasts = this.toasts.filter((x) => x !== item);
          this.toasts.forEach((x, i) => this.tweens.add({ targets: x.c, y: 242 + i * 44, duration: 200 }));
        },
      }),
    );
  }

  showSaving() {
    this.tweens.killTweensOf(this.savingText);
    this.savingText.setAlpha(1);
    this.tweens.add({ targets: this.savingText, alpha: 0, delay: 1200, duration: 600 });
  }

  caption(text: string, ms = 2000): Promise<void> {
    this.tweens.killTweensOf(this.captionText);
    this.captionText.setText(text).setAlpha(1);
    this.captionText.setY(this.dialogueActive ? 236 : 120);
    return new Promise((res) => {
      this.tweens.add({ targets: this.captionText, alpha: 0, delay: ms, duration: 400, onComplete: () => res() });
    });
  }

  onStateEvent(e: StateEvent) {
    const sv = services();
    if (e.type === 'item') {
      const it = ITEMS[e.id];
      this.toast(e.gained ? `Получено: ${it.name}` : `Больше нет: ${it.name}`, it.icon);
      if (e.gained) sv.audio.sfx('sfx_pickup', { volume: 0.6 });
    } else if (e.type === 'clue') {
      const c = CLUES[e.id];
      this.toast(c.insight ? `Догадка: ${c.title.replace('Догадка: ', '')}` : `Новая улика: ${c.title}`);
      sv.audio.sfx('sfx_clue', { volume: 0.7 });
    } else if (e.type === 'stage') {
      this.refreshTracker();
      if (e.id !== 'done') {
        this.toast(`Новая цель: ${stageDef(e.id).objective}`);
        this.tweens.add({ targets: this.tracker, alpha: 0.3, duration: 120, yoyo: true, repeat: 2 });
      }
      if (e.id === 'deduce') this.time.delayedCall(800, () => this.toast(`Открой дневник (${keyLabel(sv.settings.keys.journal[0])}) и сопоставь улики.`));
    }
  }

  setCutscene(on: boolean) {
    this.cutsceneOn = on;
    const reduce = services().settings.reducedMotion;
    this.tweens.add({ targets: this.bars[0], y: on ? 0 : -40, duration: reduce ? 0 : 400 });
    this.tweens.add({ targets: this.bars[1], y: on ? UI_H - 40 : UI_H, duration: reduce ? 0 : 400 });
    this.skipHint.setVisible(on && !services().isTouch);
    this.tracker.setVisible(!on);
  }

  tutorial() {
    if (services().isTouch) {
      this.toast('Стрелки внизу слева — идти. «Действие» — говорить и осматривать.');
      this.time.delayedCall(1200, () => this.toast('Можно нажимать прямо на подсказки и на окно с репликами.'));
      return;
    }
    const k = services().settings.keys;
    this.toast(`${keyLabel(k.left[0])}/${keyLabel(k.right[0])} или стрелки — идти · ${keyLabel(k.interact[0])} — действие`);
    this.time.delayedCall(1200, () => this.toast(`${keyLabel(k.journal[0])} — дневник · ${keyLabel(k.pause[0])} — пауза`));
  }

  fade(out: boolean, ms = 700): Promise<void> {
    const skip = this.world?.skipping;
    return new Promise((res) => {
      this.tweens.add({ targets: this.fader, alpha: out ? 1 : 0, duration: skip ? 50 : ms, onComplete: () => res() });
    });
  }

  chapterCard(title: string, subtitle: string, line: string): Promise<void> {
    const c = this.add.container(0, 0).setDepth(99);
    c.add(this.add.rectangle(0, 0, UI_W, UI_H, 0x070913).setOrigin(0));
    const a = txt(this, UI_W / 2, 210, title, 26, COLORS.textDim, {}, true).setOrigin(0.5);
    const b = txt(this, UI_W / 2, 256, subtitle, 52, COLORS.accentText, {}, true).setOrigin(0.5);
    const d = txt(this, UI_W / 2, 320, line, 18, COLORS.text).setOrigin(0.5);
    c.add([a, b, d]);
    [a, b, d].forEach((o, i) => {
      o.setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, delay: 300 + i * 500, duration: 800 });
    });
    return new Promise((res) => {
      const finish = () => {
        this.tweens.add({ targets: c, alpha: 0, duration: 900, onComplete: () => (c.destroy(), res()) });
      };
      const t = this.time.delayedCall(4200, finish);
      const skip = () => {
        t.remove();
        finish();
      };
      this.input.once('pointerdown', skip);
      const off = services().input.onAnyKey(() => {
        off();
        if (t.getProgress() < 1) skip();
      });
    });
  }

  // ------------------------------------------------------------------ dialogue
  async runDialogue(id: string): Promise<void> {
    const sv = services();
    const session = sv.session!;
    const d = DIALOGUES[id];
    if (!d) {
      console.error('[kolya] missing dialogue', id);
      return;
    }
    const runner = new DialogueRunner(d, session.state);
    session.dispatch(runner.takeEvents());
    this.dialogueActive = true;
    this.setPrompt(null);
    this.tracker.setVisible(false);
    this.dialogue.onTyping = (typing) => this.world?.onSpeaker(runner.current?.node.speaker ?? null, typing);
    try {
      while (!runner.done) {
        const v = runner.current!;
        const speaker = v.node.speaker;
        const info = CHARACTERS[speaker];
        const name = speaker === 'narrator' ? '' : displayName(speaker, session.state);
        const exprIdx = Math.max(0, MANIFEST.expressions.indexOf(v.node.expr ?? 'neutral'));
        if (v.node.sfx && sv.settings.captions) void this.caption(v.node.sfx, 2200);
        session.history(name || '—', v.node.text);
        const choice = await this.dialogue.show({
          name,
          text: v.node.text,
          portrait: info.hasPortrait ? { key: `portrait_${speaker}`, frame: exprIdx } : null,
          voice: info.voice,
          narrator: speaker === 'narrator',
          choices: v.choices.map((c) => c.choice.text),
          skip: !!this.world?.skipping,
        });
        if (choice >= 0) {
          session.history('Коля (выбор)', v.choices[choice].choice.text);
          runner.choose(choice);
        } else runner.advance();
        session.dispatch(runner.takeEvents());
      }
    } finally {
      this.dialogue.hide();
      this.dialogueActive = false;
      this.tracker.setVisible(!this.cutsceneOn && !this.fight);
      this.world?.onSpeaker(null, false);
    }
  }

  // ------------------------------------------------------------------ journal / history / pause
  private openJournal() {
    this.journal.show();
    this.setPrompt(null);
  }

  private closeJournal() {
    this.journal.hide();
    services().audio.sfx('sfx_ui_move', { volume: 0.5 });
  }

  private toggleHistory() {
    if (this.history) {
      this.history.destroy();
      this.history = null;
      return;
    }
    const st = services().session!.state;
    const c = this.add.container(0, 0).setDepth(85);
    c.add(this.add.rectangle(0, 0, UI_W, UI_H, 0x05060d, 0.7).setOrigin(0).setInteractive());
    c.add(panel(this, 60, 40, UI_W - 120, UI_H - 80, 0.97));
    c.add(txt(this, 86, 58, 'История реплик', 22, COLORS.accentText, {}, true));
    const lines = st.history.slice(-14);
    const body = lines.length ? lines.map((h) => `${h.speaker}: ${h.text}`).join('\n') : 'Пока никто ничего не сказал.';
    c.add(txt(this, 86, 96, body, 15, COLORS.text, { wordWrap: { width: UI_W - 180 }, lineSpacing: 3 }));
    c.add(txt(this, 86, UI_H - 66, 'H или Esc — закрыть', 14, COLORS.textDim));
    this.history = c;
  }

  private openPause() {
    if (this.paused) return;
    const sv = services();
    this.paused = true;
    this.setPrompt(null);
    if (this.scene.isActive('World')) this.scene.pause('World');
    sv.audio.sfx('sfx_ui_ok', { volume: 0.5, detune: -500 });
    const w = this.world;
    const canSave = () => !(w.busy || w.fight || this.dialogueActive || this.cutsceneOn);
    const c = this.add.container(0, 0).setDepth(90);
    c.add(this.add.rectangle(0, 0, UI_W, UI_H, 0x05060d, 0.65).setOrigin(0).setInteractive());
    c.add(panel(this, UI_W / 2 - 180, 100, 360, 340));
    c.add(txt(this, UI_W / 2, 132, 'Пауза', 30, COLORS.accentText, {}, true).setOrigin(0.5));
    const menu = new Menu(
      this,
      UI_W / 2 - 110,
      188,
      [
        { label: 'Продолжить', onSelect: () => this.stack.pop() },
        {
          label: 'Сохранить',
          disabled: () => !canSave(),
          hint: 'Сохранять можно, когда Коля свободно гуляет.',
          onSelect: () => this.stack.push(slotsScreen(this, this.stack, 'save', () => this.showSaving(), 95)),
        },
        { label: 'Загрузить', onSelect: () => this.stack.push(slotsScreen(this, this.stack, 'load', (st) => st && this.loadState(st), 95)) },
        { label: 'Настройки', onSelect: () => this.stack.push(settingsScreen(this, this.stack, 95)) },
        { label: 'Управление', onSelect: () => this.stack.push(controlsScreen(this, this.stack, 95)) },
        { label: 'Выйти в меню', onSelect: () => this.quitToTitle() },
      ],
      { size: 22, gap: 38 },
    );
    c.add(menu.container);
    const screen: Screen = { container: c, menu };
    this.stack.push(screen);
  }

  private resumeFromPause() {
    this.paused = false;
    if (this.scene.isPaused('World')) this.scene.resume('World');
    services().input.reset();
  }

  private loadState(st: GameState) {
    const sv = services();
    sv.session = new Session(st, sv.saves);
    this.stack.clear();
    this.paused = false;
    this.dialogue.hide();
    this.journal.hide();
    this.scene.stop('World');
    this.scene.stop();
    this.scene.start('World', { entry: true });
  }

  private quitToTitle() {
    this.stack.clear();
    this.paused = false;
    this.scene.stop('World');
    this.scene.start('Title');
  }

  // ------------------------------------------------------------------ mini-game: untie the knot
  untieMinigame(): Promise<boolean> {
    const sv = services();
    return new Promise((resolve) => {
      const c = this.add.container(0, 0).setDepth(60);
      const X = UI_W / 2 - 220, Y = 300 - 130, W = 440;
      c.add(panel(this, X - 20, Y - 70, W + 40, 150, 0.95));
      const key = keyLabel(sv.settings.keys.interact[0]);
      const title = txt(this, UI_W / 2, Y - 48, sv.isTouch ? 'Развязать узел: жми «Тянуть», когда метка в зелёной зоне' : `Развязать узел: жми ${key}, когда метка в зелёной зоне`, 17, COLORS.text).setOrigin(0.5);
      const progress = txt(this, UI_W / 2, Y + 50, '', 16, COLORS.accentText, {}, true).setOrigin(0.5);
      const g = this.add.graphics();
      c.add([title, progress, g]);
      let need = 3, got = 0, misses = 0;
      let zoneW = 70, zoneX = 0, pos = 0, dir = 1, speed = 0.55;
      let cooldown = 0;
      const newZone = () => {
        zoneX = Phaser.Math.Between(20, W - 20 - zoneW);
      };
      newZone();
      const draw = () => {
        g.clear();
        g.fillStyle(0x0b1022, 1).fillRect(X, Y - 12, W, 24);
        g.fillStyle(0x3e8a52, 1).fillRect(X + zoneX, Y - 12, zoneW, 24);
        g.fillStyle(0x9be0a8, 1).fillRect(X + zoneX, Y - 12, zoneW, 3);
        g.fillStyle(0xffd27a, 1).fillRect(X + pos * W - 2, Y - 18, 4, 36);
        g.lineStyle(2, COLORS.panelEdge, 1).strokeRect(X, Y - 12, W, 24);
        progress.setText(`Узел: ${'●'.repeat(got)}${'○'.repeat(need - got)}   ·   ${sv.isTouch ? 'отложить' : 'Esc — отложить'}`);
      };
      progress.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.minigame && finish(false));
      const finish = (ok: boolean) => {
        this.minigame = null;
        c.destroy();
        resolve(ok);
      };
      this.minigame = {
        update: (dt) => {
          const inp = sv.input;
          if (inp.codePressed('Escape')) return finish(false);
          cooldown = Math.max(0, cooldown - dt);
          pos += dir * speed * dt;
          if (pos > 1) {
            pos = 1;
            dir = -1;
          }
          if (pos < 0) {
            pos = 0;
            dir = 1;
          }
          if ((inp.justPressed('interact') || inp.codePressed('Space')) && cooldown <= 0) {
            cooldown = 0.2;
            const px = pos * W;
            if (px >= zoneX - 4 && px <= zoneX + zoneW + 4) {
              got++;
              sv.audio.sfx('sfx_untie', { volume: 0.8 });
              speed += 0.12;
              if (got >= need) return finish(true);
              newZone();
            } else {
              misses++;
              got = Math.max(0, got - 1);
              sv.audio.sfx('sfx_cans', { volume: 0.5 });
              sv.audio.sfx('sfx_whine', { volume: 0.3 });
              if (misses % 3 === 0) zoneW = Math.min(150, zoneW + 25); // gets easier after misses
              this.tweens.add({ targets: c, x: 6, duration: 40, yoyo: true, repeat: 2 });
            }
          }
          draw();
        },
        debug: () => ({ pos, zoneX, zoneW, W, got, need }),
      };
      need = 3;
      draw();
    });
  }

  // ------------------------------------------------------------------ fight HUD
  fightStart(f: Fight) {
    this.fight = f;
    this.fightHud?.destroy();
    this.fightHud = this.add.container(0, 0).setDepth(20);
    this.tracker.setVisible(false);
    const k = services().settings.keys;
    const help = services().isTouch
      ? '«Блок» — защита   ·   «Уворот» — отскок   ·   «Толкнуть» — когда противник раскрылся'
      : `${keyLabel(k.block[0])} — блок   ·   ${keyLabel(k.sprint[0])} — увернуться   ·   ${keyLabel(k.interact[0])} — толкнуть, когда противник раскрылся`;
    this.fightHelp = txt(this, UI_W / 2, services().isTouch ? 104 : UI_H - 26, help, 16, COLORS.text, { backgroundColor: '#070913cc', padding: { x: 10, y: 5 } }).setOrigin(0.5).setDepth(21);
    this.toast('Не нападай первым. Блокируй удар — и толкай, пока противник открыт.');
  }

  fightEnd() {
    this.fight = null;
    this.fightHud?.destroy();
    this.fightHud = null;
    this.fightHelp?.destroy();
    this.fightHelp = null;
    if (this.tracker && !this.cutsceneOn) this.tracker.setVisible(true);
  }

  private fightHudKey = '';

  private drawFightHud() {
    if (!this.fight || !this.fightHud) return;
    const v = this.fight.view();
    // redraw only when a number changes
    const key = `${v.hp}|${v.enemies.map((e) => e.resolve).join(',')}`;
    if (key === this.fightHudKey && this.fightHud.length) return;
    this.fightHudKey = key;
    this.fightHud.removeAll(true);
    const g = this.add.graphics();
    this.fightHud.add(g);
    g.fillStyle(0x070913, 0.8).fillRect(16, 14, 220, 52);
    this.fightHud.add(txt(this, 26, 20, 'Коля — силы', 14, COLORS.accentText, {}, true));
    for (let i = 0; i < v.maxHp; i++) {
      g.fillStyle(i < v.hp ? 0xe05a5a : 0x3a2a3a, 1).fillRect(28 + i * 34, 42, 26, 14);
    }
    v.enemies.forEach((e, i) => {
      const x = UI_W - 236, y = 14 + i * 58;
      g.fillStyle(0x070913, 0.8).fillRect(x, y, 220, 52);
      this.fightHud!.add(txt(this, x + 10, y + 6, `${e.name} — напор`, 14, e.resolve > 0 ? COLORS.text : COLORS.textGood, {}, true));
      for (let k = 0; k < e.max; k++) g.fillStyle(k < e.resolve ? 0xf0a848 : 0x2a2f48, 1).fillRect(x + 12 + k * 36, y + 28, 28, 14);
    });
  }

  fightLost(): Promise<void> {
    return new Promise((res) => {
      const c = this.add.container(0, 0).setDepth(70);
      c.add(this.add.rectangle(0, 0, UI_W, UI_H, 0x070913, 0.6).setOrigin(0));
      c.add(panel(this, UI_W / 2 - 230, 170, 460, 190));
      c.add(txt(this, UI_W / 2, 210, 'Коля оказался в сугробе', 24, COLORS.accentText, {}, true).setOrigin(0.5));
      c.add(txt(this, UI_W / 2, 250, 'Ничего страшного — отряхнулся и снова на ногах.', 16, COLORS.text).setOrigin(0.5));
      const menu = new Menu(this, UI_W / 2, 310, [{ label: 'Попробовать снова', onSelect: () => done() }], { size: 22, align: 'center' });
      c.add(menu.container);
      this.overlayMenu = menu;
      const done = () => {
        this.overlayMenu = null;
        c.destroy();
        res();
      };
    });
  }

  // ------------------------------------------------------------------ loop
  update(_t: number, deltaMs: number) {
    const sv = services();
    const inp = sv.input;
    const dt = Math.min(0.05, deltaMs / 1000);
    this.positionPrompt();
    if (this.fight) this.drawFightHud();
    sv.touch?.setContext(this.touchContext(), this.cutsceneOn);

    if (this.stack.size) {
      this.stack.update();
    } else if (this.history) {
      if (inp.justPressed('history') || inp.codePressed('Escape') || inp.justPressed('interact')) this.toggleHistory();
    } else if (this.journal.open) {
      this.journal.update();
    } else if (this.overlayMenu) {
      this.overlayMenu.handleInput();
    } else if (this.minigame) {
      this.minigame.update(dt);
    } else {
      const w = this.world;
      if (inp.justPressed('pause')) {
        if (w?.cutscene) {
          w.skipCutscene();
          this.dialogue.skipNow();
        } else this.openPause();
      } else if (inp.justPressed('history')) {
        this.toggleHistory();
      } else if (inp.justPressed('journal') && !w?.fight && !this.cutsceneOn) {
        this.openJournal();
      } else if (this.dialogueActive) {
        this.dialogue.update(dt);
      }
    }
  }

  private touchContext(): TouchContext {
    if (this.stack.size || this.history || this.journal.open || this.overlayMenu || !this.cameras.main.visible) return 'menu';
    if (this.minigame) return 'minigame';
    if (this.dialogueActive) return 'dialogue';
    if (this.fight) return 'fight';
    if (this.cutsceneOn || this.world?.busy) return 'cutscene';
    return 'world';
  }

  /** Read-only snapshot for automated tests. */
  debugView() {
    return {
      dialogue: this.dialogueActive ? this.dialogue.debug : null,
      journal: this.journal.open ? this.journal.debug : null,
      paused: this.paused,
      menus: this.stack.size,
      minigame: this.minigame ? this.minigame.debug() : null,
      overlay: !!this.overlayMenu,
      cutscene: this.cutsceneOn,
      tracker: this.trackerText.text,
    };
  }
}
