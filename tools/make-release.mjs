/** Packs release/kolya-source.zip (tracked files) and release/kolya-dist.zip (built game). */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';

mkdirSync('release', { recursive: true });
rmSync('release/kolya-source.zip', { force: true });
rmSync('release/kolya-dist.zip', { force: true });
execFileSync('git', ['archive', '--format=zip', '--prefix=kolya-malenkiy-khuligan/', '-o', 'release/kolya-source.zip', 'HEAD'], { stdio: 'inherit' });
if (!existsSync('dist/index.html')) throw new Error('Run npm run build first');
execFileSync('zip', ['-qr', '../release/kolya-dist.zip', '.'], { cwd: 'dist', stdio: 'inherit' });
console.log('release/kolya-source.zip and release/kolya-dist.zip are ready');
