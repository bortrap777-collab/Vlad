import Phaser from 'phaser';
import manifest from '../generated/manifest.json';
import { COLORS, FONT_TEXT, UI_W, UI_ZOOM } from '../config';

const BASE = 'assets/gen/';

/**
 * The single-file build (one .html for phones) embeds every asset as base64 in
 * window.__KOLYA_INLINE__; those are turned into blob: URLs so the loader works offline from file://.
 */
const INLINE = (globalThis as unknown as { __KOLYA_INLINE__?: Record<string, string> }).__KOLYA_INLINE__;
const blobUrls = new Map<string, string>();
function assetUrl(path: string): string | null {
  if (!INLINE) return path;
  const cached = blobUrls.get(path);
  if (cached) return cached;
  const data = INLINE[path];
  if (!data) return null;
  const [head, b64] = data.split(',');
  const mime = head.slice(5, head.indexOf(';'));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  blobUrls.set(path, url);
  return url;
}
const url = (p: string) => assetUrl(BASE + p)!;

export interface Manifest {
  frame: { w: number; h: number };
  sheetCols: number;
  chars: Record<string, Record<string, { start: number; end: number; fps: number; loop: boolean }>>;
  dog: { w: number; h: number; anims: Record<string, { start: number; end: number; fps: number; loop: boolean }> };
  portraits: string[];
  expressions: string[];
  images: Record<string, { w: number; h: number }>;
  audio: string[];
  audioFormats?: string[];
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
      this.load.spritesheet(`char_${id}`, url(`chars/${id}.png`), { frameWidth: MANIFEST.frame.w, frameHeight: MANIFEST.frame.h });
      this.load.spritesheet(`portrait_${id}`, url(`portraits/${id}.png`), { frameWidth: 64, frameHeight: 64 });
    }
    this.load.spritesheet('dog', url('dog.png'), { frameWidth: MANIFEST.dog.w, frameHeight: MANIFEST.dog.h });
    this.load.spritesheet('items', url('items.png'), { frameWidth: 16, frameHeight: 16 });
    for (const key of Object.keys(MANIFEST.images)) {
      if (key === 'dog' || key === 'items') continue;
      this.load.image(key, url(`${key}.png`));
    }
    const formats = MANIFEST.audioFormats ?? ['wav'];
    for (const a of MANIFEST.audio) {
      const urls = formats.map((f) => assetUrl(`${BASE}audio/${a}.${f}`)).filter((u): u is string => !!u);
      // blob: URLs carry no extension, so tell Phaser the format explicitly
      if (INLINE) this.load.audio(a, urls.map((u, i) => ({ url: u, type: formats.filter((f) => INLINE[`${BASE}audio/${a}.${f}`])[i] })) as unknown as string[]);
      else this.load.audio(a, urls);
    }
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
