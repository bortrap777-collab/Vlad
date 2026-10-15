import Phaser from 'phaser';
import { COLORS, UI_H, UI_W, UI_ZOOM } from '../config';
import { services } from '../services';
import { Session } from '../core/session';
import { newGame, type GameState } from '../core/state';
import { Menu, txt } from '../ui/widgets';
import { ScreenStack, controlsScreen, creditsScreen, settingsScreen, slotsScreen } from '../ui/screens';

export class TitleScene extends Phaser.Scene {
  private stack!: ScreenStack;
  private menu!: Menu;
  private ready = false;
  private exitNote?: Phaser.GameObjects.Text;

  constructor() {
    super('Title');
  }

  create() {
    const sv = services();
    sv.audio.attach(this);
    this.cameras.main.setOrigin(0, 0).setZoom(UI_ZOOM);
    this.ready = false;
    // key art (320×180 → 960×540 UI units)
    this.add.image(0, 0, 'keyart_small').setOrigin(0).setScale(3);
    this.add.rectangle(0, 0, 460, UI_H, 0x070913, 0.55).setOrigin(0);
    const grad = this.add.graphics();
    for (let i = 0; i < 40; i++) grad.fillStyle(0x070913, 0.55 * (1 - i / 40)).fillRect(460 + i * 4, 0, 4, UI_H);
    // snow
    const flakes = this.add.particles(0, 0, 'flake2', {
      x: { min: 0, max: UI_W },
      y: -10,
      lifespan: 9000,
      speedY: { min: 18, max: 40 },
      speedX: { min: -12, max: 6 },
      scale: { min: 1, max: 2 },
      alpha: { min: 0.4, max: 0.9 },
      frequency: sv.settings.reducedMotion ? 400 : 90,
    });
    flakes.setDepth(5);

    txt(this, 48, 64, 'КОЛЯ', 72, '#f6c36a', { stroke: '#2a1408', strokeThickness: 8 }, true).setDepth(10);
    txt(this, 52, 138, 'Маленький хулиган', 36, COLORS.text, { stroke: '#070913', strokeThickness: 6 }, true).setDepth(10);
    txt(this, 54, 186, 'Глава 1. Новый двор', 18, COLORS.textDim, {}, true).setDepth(10);

    const hasSave = () => sv.saves.latest() !== null;
    this.stack = new ScreenStack(this);
    this.menu = new Menu(
      this,
      78,
      262,
      [
        { label: 'Новая игра', onSelect: () => this.startGame(newGame(), true) },
        {
          label: 'Продолжить',
          disabled: () => !hasSave(),
          onSelect: () => {
            const m = sv.saves.latest();
            if (!m) return;
            const r = sv.saves.load(m.slot);
            if (r.ok) this.startGame(r.state, false);
          },
        },
        { label: 'Загрузить', disabled: () => !hasSave(), onSelect: () => this.openScreen(slotsScreen(this, this.stack, 'load', (st) => st && this.startGame(st, false), 20)) },
        { label: 'Настройки', onSelect: () => this.openScreen(settingsScreen(this, this.stack, 20)) },
        { label: 'Управление', onSelect: () => this.openScreen(controlsScreen(this, this.stack, 20)) },
        { label: 'Авторы', onSelect: () => this.openScreen(creditsScreen(this, this.stack, 20)) },
        {
          label: 'Выход',
          onSelect: () => {
            this.exitNote?.destroy();
            this.exitNote = txt(this, 78, 512, 'Чтобы выйти, просто закройте вкладку браузера. До встречи во дворе!', 15, COLORS.textDim).setDepth(10);
          },
        },
      ],
      { size: 24, gap: 36 },
    );
    this.menu.container.setDepth(10);
    this.menu.container.setVisible(false);
    this.menu.active = false;
    txt(this, UI_W - 16, UI_H - 12, 'Зима, 1996', 14, COLORS.textDim, {}, true).setOrigin(1, 1).setDepth(10);

    // First interaction unlocks browser audio, then shows the menu.
    const press = txt(this, 78, 300, 'Нажмите любую клавишу', 22, COLORS.accentText, {}, true).setDepth(10);
    this.tweens.add({ targets: press, alpha: 0.35, duration: 900, yoyo: true, repeat: -1 });
    const go = () => {
      if (this.ready) return;
      this.ready = true;
      press.destroy();
      off();
      this.input.off('pointerdown', go);
      sv.input.reset();
      const unlock = () => sv.audio.playMusic('music_yard', 1500);
      if (this.sound.locked) this.sound.once(Phaser.Sound.Events.UNLOCKED, unlock);
      else unlock();
      sv.audio.setAmbience(null);
      this.menu.container.setVisible(true);
      this.menu.active = true;
      this.menu.refresh();
    };
    const off = sv.input.onAnyKey(go);
    this.input.on('pointerdown', go);
    this.events.once('shutdown', () => {
      off();
      this.stack.clear();
    });
  }

  private openScreen(s: ReturnType<typeof settingsScreen>) {
    this.menu.active = false;
    this.stack.push(s);
  }

  update() {
    if (this.stack.size) {
      this.stack.update();
      if (!this.stack.size) {
        this.menu.active = true;
        this.menu.refresh();
      }
    } else if (this.ready) this.menu.handleInput();
  }

  private startGame(state: GameState, fresh: boolean) {
    const sv = services();
    sv.session = new Session(state, sv.saves);
    sv.input.reset();
    this.cameras.main.fadeOut(500, 7, 9, 19);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('World', { fresh });
    });
  }
}
