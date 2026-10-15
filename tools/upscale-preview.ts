import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [,, src, dst, k] = process.argv;
const p = PNG.sync.read(readFileSync(src));
const K = Number(k);
const o = new PNG({ width: p.width * K, height: p.height * K });
for (let y = 0; y < o.height; y++) for (let x = 0; x < o.width; x++) {
  const si = ((Math.floor(y / K)) * p.width + Math.floor(x / K)) * 4, di = (y * o.width + x) * 4;
  const a = p.data[si + 3] / 255;
  o.data[di] = p.data[si] * a + 90 * (1 - a); o.data[di + 1] = p.data[si + 1] * a + 100 * (1 - a); o.data[di + 2] = p.data[si + 2] * a + 140 * (1 - a); o.data[di + 3] = 255;
}
writeFileSync(dst, PNG.sync.write(o));
