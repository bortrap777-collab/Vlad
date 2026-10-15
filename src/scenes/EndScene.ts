import Phaser from 'phaser';
import { COLORS, UI_H, UI_W, UI_ZOOM } from '../config';
import { services } from '../services';
import { chapterSummary, NEXT_CHAPTERS } from '../content/summary';
import { Menu, txt, formatTime } from '../ui/widgets';

export class EndScene extends Phaser.Scene {
  private menu!: Menu;
  constructor() {
    super('End');
  }

  create() {
    const sv = services();
    sv.audio.attach(this);
    sv.touch?.setContext('hidden');
    this.cameras.main.setOrigin(0, 0).setZoom(UI_ZOOM);
    this.cameras.main.fadeIn(1200, 7, 9, 19);
    sv.audio.playMusic('music_mystery', 1500);
    sv.audio.setAmbience(null);
    this.add.image(0, 0, 'keyart_small').setOrigin(0).setScale(3).setAlpha(0.25);
    this.add.rectangle(0, 0, UI_W, UI_H, 0x070913, 0.6).setOrigin(0);
    const st = sv.session!.state;
    txt(this, UI_W / 2, 44, 'Глава 1 завершена', 34, COLORS.accentText, {}, true).setOrigin(0.5);
    txt(this, UI_W / 2, 84, `«Новый двор» · время в игре: ${formatTime(st.playTime)} · улик найдено: ${st.clues.length}`, 16, COLORS.textDim).setOrigin(0.5);
    const lines = chapterSummary(st);
    txt(this, 90, 118, lines.map((l) => '•  ' + l).join('\n'), 17, COLORS.text, { lineSpacing: 7, wordWrap: { width: UI_W - 180 } });
    txt(this, 90, 418, 'Продолжение следует…', 20, COLORS.accentText, {}, true);
    txt(this, 90, 446, NEXT_CHAPTERS.join('\n'), 13, COLORS.textDim, { lineSpacing: 2, wordWrap: { width: 600 } });
    this.menu = new Menu(this, UI_W - 90, UI_H - 40, [{ label: 'В главное меню', onSelect: () => this.scene.start('Title') }], { size: 22 });
    this.menu.container.x -= 200;
    this.menu.refresh();
  }

  update() {
    this.menu.handleInput();
  }
}
