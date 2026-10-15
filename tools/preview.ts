import { PixelCanvas } from './art/raster';
import { drawCharacter, drawPortrait, walkPose, DIMS } from './art/characters';
import { CAST } from './art/cast';
const out = process.argv[2];
const sheet = new PixelCanvas(48 * CAST.length, 80 * 3 + 64);
sheet.rect(0, 0, sheet.w, sheet.h, 0x5a6a9a);
CAST.forEach((s, i) => {
  sheet.blit(drawCharacter(s, {}), i * 48, 0);
  sheet.blit(drawCharacter(s, walkPose(1, 6, DIMS[s.build])), i * 48, 80);
  sheet.blit(drawCharacter(s, { front: true }), i * 48, 160);
  const p = drawPortrait(s, (['neutral','happy','sad','angry','surprised'] as const)[i % 5]);
  sheet.blit(p, i * 48 - 8, 240);
});
sheet.scaled(3).savePNG(out);
