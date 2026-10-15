/**
 * Builds release/kolya-game.html — the whole game in one file (opens offline in a phone browser).
 * Images and MP3 audio are embedded as base64 and turned into blob: URLs at start-up.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

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
// re-encode sound smaller for the phone file (music 64 kbps, effects 48 kbps, mono)
const tmp = join(tmpdir(), 'kolya-single-audio');
mkdirSync(tmp, { recursive: true });
const inline = {};
for (const f of files) {
  const ext = f.split('.').pop();
  let bytes = readFileSync(f);
  if (ext === 'mp3') {
    const out = join(tmp, f.split('/').pop());
    const rate = /music_|amb_/.test(f) ? '64k' : '48k';
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', rate, out]);
      bytes = readFileSync(out);
    } catch {
      /* keep the original */
    }
  }
  inline[relative(root, f).replaceAll('\\', '/')] = `data:${MIME[ext]};base64,${bytes.toString('base64')}`;
}
let html = readFileSync('dist-single/index.html', 'utf8');
// move the game code out of <head> into a classic script at the end of <body>
const m = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/);
if (!m) throw new Error('game script not found in dist-single/index.html');
html = html.replace(m[0], () => '');
const code = m[1].replace(/<\/script/gi, '<\\/script');
// fonts: keep only WOFF2 (every current browser supports it)
html = html.replace(/,\s*url\(data:font\/woff;base64,[^)]*\)\s*format\(["']woff["']\)/g, '');
const assets = `<script>window.__KOLYA_INLINE__=${JSON.stringify(inline)};</script>`;
// (function replacements: the code contains `$` sequences that string replacement would mangle)
html = html.replace('</body>', () => `${assets}\n<script>${code}</script>\n</body>`);
mkdirSync('release', { recursive: true });
writeFileSync('release/kolya-game.html', html);
// committed copy for a public link that opens in any phone browser
mkdirSync('play', { recursive: true });
writeFileSync('play/index.html', html);
console.log(`release/kolya-game.html: ${(html.length / 1024 / 1024).toFixed(1)} MB, ${files.length} embedded assets`);
