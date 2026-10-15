/**
 * Builds release/kolya-game.html — the whole game in one file (opens offline in a phone browser).
 * Images and MP3 audio are embedded as base64 and turned into blob: URLs at start-up.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

execFileSync('npx', ['vite', 'build', '-c', 'vite.single.config.ts', '--logLevel', 'warn'], { stdio: 'inherit' });
const root = 'public';
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(png|mp3|json)$/.test(f)) files.push(p);
  }
};
walk(join(root, 'assets/gen'));
const MIME = { png: 'image/png', mp3: 'audio/mpeg', json: 'application/json' };
const inline = {};
for (const f of files) {
  const ext = f.split('.').pop();
  inline[relative(root, f).replaceAll('\\', '/')] = `data:${MIME[ext]};base64,${readFileSync(f).toString('base64')}`;
}
let html = readFileSync('dist-single/index.html', 'utf8');
const tag = `<script>window.__KOLYA_INLINE__=${JSON.stringify(inline)};</script>`;
html = html.replace('<script type="module"', `${tag}\n<script type="module"`);
mkdirSync('release', { recursive: true });
writeFileSync('release/kolya-game.html', html);
console.log(`release/kolya-game.html: ${(html.length / 1024 / 1024).toFixed(1)} MB, ${files.length} embedded assets`);
