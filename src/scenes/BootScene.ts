import Phaser from 'phaser';
import manifest from '../generated/manifest.json';
import { COLORS, FONT_TEXT, UI_W, UI_ZOOM } from '../config';

const BASE = 'assets/gen/';

export interface Manifest {
  frame: { w: number; h: number };
  sheetCols: number;
  chars: Record<string, Record<string, { start: number; end: number; fps: number; loop: boolean }>>;
  dog: { w: number; h: number; anims: Record<string, { start: number; end: number; fps: number; loop: boolean }> };
  portraits: string[];
  expressions: string[];
  images: Record<string, { w: number; h: number }>;
  audio: string[];
}
export const MANIFEST = manifest as Manifest;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    const cam = this.cameras.main;
    cam.setOrigin(0, 0).setZoom(UI_ZOOM);
    const barW = 360;
    const x = (UI_W - barW) / 2, y = 290;
    this.add.rectangle(x, y, barW, 10, 0x1a2140).setOrigin(0, 0.5);
    const bar = this.add.rectangle(x, y, 1, 10, COLORS.accent).setOrigin(0, 0.5);
    const label = this.add.text(UI_W / 2, y - 30, 'Загрузка двора…', { fontFamily: FONT_TEXT, fontSize: '18px', color: COLORS.textDim }).setOrigin(0.5).setResolution(UI_ZOOM);
    this.load.on('progress', (p: number) => bar.setSize(Math.max(1, barW * p), 10));
    this.load.on('loaderror', (f: Phaser.Loader.File) => {
      console.error('[kolya] missing asset', f.key, f.src);
      label.setText('Не удалось загрузить: ' + f.key).setColor(COLORS.textBad);
    });

    for (const id of Object.keys(MANIFEST.chars)) {
      this.load.spritesheet(`char_${id}`, `${BASE}chars/${id}.png`, { frameWidth: MANIFEST.frame.w, frameHeight: MANIFEST.frame.h });
      this.load.spritesheet(`portrait_${id}`, `${BASE}portraits/${id}.png`, { frameWidth: 64, frameHeight: 64 });
    }
    this.load.spritesheet('dog', `${BASE}dog.png`, { frameWidth: MANIFEST.dog.w, frameHeight: MANIFEST.dog.h });
    this.load.spritesheet('items', `${BASE}items.png`, { frameWidth: 16, frameHeight: 16 });
    for (const key of Object.keys(MANIFEST.images)) {
      if (key === 'dog' || key === 'items') continue;
      this.load.image(key, `${BASE}${key}.png`);
    }
    for (const a of MANIFEST.audio) this.load.audio(a, `${BASE}audio/${a}.wav`);
  }

  create() {
    for (const [id, anims] of Object.entries(MANIFEST.chars))
      for (const [k, a] of Object.entries(anims))
        this.anims.create({
          key: `${id}_${k}`,
          frames: this.anims.generateFrameNumbers(`char_${id}`, { start: a.start, end: a.end }),
          frameRate: a.fps,
          repeat: a.loop ? -1 : 0,
        });
    for (const [k, a] of Object.entries(MANIFEST.dog.anims))
      this.anims.create({ key: `dog_${k}`, frames: this.anims.generateFrameNumbers('dog', { start: a.start, end: a.end }), frameRate: a.fps, repeat: a.loop ? -1 : 0 });
    this.scene.start('Title');
  }
}
