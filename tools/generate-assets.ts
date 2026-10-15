/**
 * Generates every bitmap and audio asset used by the game into public/assets/gen.
 * Run: npm run assets
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { PixelCanvas } from './art/raster';
import { buildAnims, drawPortrait, drawCharacter, FRAME_W, FRAME_H, type Expr } from './art/characters';
import { CAST, extraAnims } from './art/cast';
import * as E from './art/environment';
import * as I from './art/interior';
import * as X from './art/extra';
import { renderAudio } from './audio';

const OUT = 'public/assets/gen';
mkdirSync(`${OUT}/chars`, { recursive: true });
mkdirSync(`${OUT}/portraits`, { recursive: true });
mkdirSync(`${OUT}/audio`, { recursive: true });
mkdirSync('docs', { recursive: true });

interface AnimMeta { start: number; end: number; fps: number; loop: boolean }
const manifest: {
  version: number;
  frame: { w: number; h: number };
  sheetCols: number;
  chars: Record<string, Record<string, AnimMeta>>;
  dog: { w: number; h: number; anims: Record<string, AnimMeta> };
  portraits: string[];
  expressions: Expr[];
  images: Record<string, { w: number; h: number }>;
  audio: string[];
} = { version: 1, frame: { w: FRAME_W, h: FRAME_H }, sheetCols: 16, chars: {}, dog: { w: X.DOG_W, h: X.DOG_H, anims: {} }, portraits: [], expressions: ['neutral', 'happy', 'sad', 'angry', 'surprised'], images: {}, audio: [] };

function grid(frames: PixelCanvas[], cols: number): PixelCanvas {
  const fw = frames[0].w, fh = frames[0].h;
  const rows = Math.ceil(frames.length / cols);
  const c = new PixelCanvas(fw * Math.min(cols, frames.length), fh * rows);
  frames.forEach((f, i) => c.blit(f, (i % cols) * fw, Math.floor(i / cols) * fh));
  return c;
}

function img(name: string, c: PixelCanvas) {
  c.savePNG(`${OUT}/${name}.png`);
  manifest.images[name] = { w: c.w, h: c.h };
}

// characters
for (const spec of CAST) {
  const anims = buildAnims(spec, extraAnims(spec.id));
  const frames: PixelCanvas[] = [];
  const meta: Record<string, AnimMeta> = {};
  for (const a of anims) {
    meta[a.key] = { start: frames.length, end: frames.length + a.frames.length - 1, fps: a.fps, loop: a.loop };
    frames.push(...a.frames);
  }
  grid(frames, manifest.sheetCols).savePNG(`${OUT}/chars/${spec.id}.png`);
  manifest.chars[spec.id] = meta;
  const portraits = manifest.expressions.map((e) => drawPortrait(spec, e));
  grid(portraits, 5).savePNG(`${OUT}/portraits/${spec.id}.png`);
  manifest.portraits.push(spec.id);
}

// dog
{
  const anims = X.dogAnims();
  const frames: PixelCanvas[] = [];
  for (const [k, a] of Object.entries(anims)) {
    manifest.dog.anims[k] = { start: frames.length, end: frames.length + a.frames.length - 1, fps: a.fps, loop: a.loop };
    frames.push(...a.frames);
  }
  img('dog', grid(frames, 16));
}

// environment
img('sky', E.drawSky());
img('far', E.drawFarCity());
img('mid', E.drawMidCity());
img('courtyard', E.drawCourtyard());
img('apartment', I.drawApartment());
img('lamp', E.drawLamp());
img('bench', E.drawBench());
img('slide', E.drawSlide());
img('swings', E.drawSwings());
img('swingseat', E.drawSwingSeat());
img('climber', E.drawClimber());
img('car', E.drawCar());
img('trash', E.drawTrash());
img('drift_a', E.drawDrift(120, 22, 1));
img('drift_b', E.drawDrift(80, 16, 2));
img('post', E.drawPost());
img('boxes', I.drawBoxes());
img('bread', I.drawBread());
img('key', I.drawKey());
img('can', X.drawCan());
img('glow_warm', E.drawGlow(48, 0xffc070));
img('glow_small', E.drawGlow(16, 0xffd890));
img('glow_cold', E.drawGlow(40, 0xa0c0ff));
img('footprint', E.drawFootprint());
img('shadow', E.drawShadow(22));
img('shadow_big', E.drawShadow(34));
img('flake1', X.drawFlake(1));
img('flake2', X.drawFlake(2));
img('puff', X.drawPuff());
img('ui_frame', X.drawUiFrame());
img('items', grid(X.ITEM_ICONS.map((i) => X.drawItemIcon(i)), X.ITEM_ICONS.length));

// key art: Kolya and Olya at the playground at dusk (the "photo" in the reference style)
{
  const camX = 548;
  const W = 320, H = 180;
  const c = new PixelCanvas(W, H);
  const oy = -88; // crop vertical window to the lower part of the 270-high scene
  c.blit(E.drawSky(), 0, Math.round(oy * 0.4) - 10);
  c.blit(E.drawFarCity(), -Math.round(camX * 0.15) - 40, oy + 6);
  c.blit(E.drawMidCity(), -Math.round(camX * 0.45), oy + 2);
  c.blit(E.drawCourtyard(), -camX, oy);
  const place = (p: PixelCanvas, x: number, yBottom: number, flip = false) => c.blit(p, Math.round(x - camX - p.w / 2), yBottom + oy - p.h, flip);
  place(E.drawSlide(), 560, 214);
  place(E.drawSwings(), 760, 214);
  for (const sx of [720, 800]) place(E.drawSwingSeat(), sx, 182);
  const kolya = CAST.find((s) => s.id === 'kolya')!, olya = CAST.find((s) => s.id === 'olya')!;
  place(E.drawShadow(22), camX + 140, 241);
  place(drawCharacter(kolya, { mouth: 'closed' }, 'neutral'), camX + 140, 241);
  place(E.drawShadow(22), camX + 178, 241);
  place(drawCharacter(olya, { mouth: 'o', eyes: 'wide' }, 'surprised'), camX + 178, 241, true);
  // breath puff between them
  c.blit(X.drawPuff(), 157, 241 + oy - 37);
  // snowfall
  for (let i = 0; i < 160; i++) {
    const x = Math.floor(Math.abs(Math.sin(i * 12.9898) * 43758.5453) % W);
    const y = Math.floor(Math.abs(Math.sin(i * 78.233) * 12345.678) % H);
    c.set(x, y, 0xf4f7ff, i % 3 === 0 ? 0.9 : 0.55);
    if (i % 7 === 0) c.set(x + 1, y, 0xf4f7ff, 0.5);
  }
  // warm sunset glow from the right, like the reference
  c.tint((x, y, col) => {
    const d = Math.max(0, (x - W * 0.55) / (W * 0.45)) * Math.max(0, (y - H * 0.35) / (H * 0.65));
    const r = (col >> 16) & 255, g = (col >> 8) & 255, b = col & 255;
    const k = d * 0.25;
    return (Math.min(255, Math.round(r + (255 - r) * k * 0.9)) << 16) | (Math.min(255, Math.round(g + (190 - g) * k * 0.6)) << 8) | Math.round(b + (170 - b) * k * 0.3);
  });
  const big = c.scaled(6);
  big.savePNG('docs/keyart.png');
  c.savePNG(`${OUT}/keyart_small.png`);
  manifest.images['keyart_small'] = { w: W, h: H };
}

renderAudio(`${OUT}/audio`);
manifest.audio = ['music_yard', 'music_home', 'music_fight', 'music_mystery', 'amb_wind', 'sfx_step_snow', 'sfx_step_floor', 'sfx_blip', 'sfx_ui_move', 'sfx_ui_ok', 'sfx_pickup', 'sfx_clue', 'sfx_door', 'sfx_hit', 'sfx_block', 'sfx_whoosh', 'sfx_bark', 'sfx_whine', 'sfx_cans', 'sfx_engine', 'sfx_untie'];
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
writeFileSync('src/generated/manifest.json', JSON.stringify(manifest, null, 1));
console.log(`assets: ${Object.keys(manifest.images).length} images, ${CAST.length} characters, ${manifest.audio.length} sounds`);
