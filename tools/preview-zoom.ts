// Close-up preview of a few sprites and portraits (for art review).
import { PixelCanvas } from './art/raster';
import { drawCharacter, drawPortrait, walkPose, DIMS } from './art/characters';
import { CAST } from './art/cast';
const out = process.argv[2];
const ids = ['kolya', 'olya', 'sveta', 'alexey'];
const c = new PixelCanvas(48 * ids.length * 2 + 64 * 2, 80);
c.rect(0, 0, c.w, c.h, 0x3a4670);
ids.forEach((id, i) => {
  const s = CAST.find((x) => x.id === id)!;
  c.blit(drawCharacter(s, {}), i * 96, 0);
  c.blit(drawCharacter(s, walkPose(2, 6, DIMS[s.build])), i * 96 + 48, 0);
});
c.blit(drawPortrait(CAST[0], 'neutral'), 48 * 8, 8);
c.blit(drawPortrait(CAST[1], 'happy'), 48 * 8 + 64, 8);
c.scaled(4).savePNG(out);
