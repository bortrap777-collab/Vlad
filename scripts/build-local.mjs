/**
 * Резервная сборка через esbuild — для сред без доступа к npm (например, облачная
 * песочница Claude). Обычная сборка проекта — `npm run build` (Vite).
 *
 *   node scripts/build-local.mjs           → dist/ (PWA: index.html + assets + sw.js)
 *   node scripts/build-local.mjs --single  → dist-single/index.html (всё в одном файле, для превью)
 *   node scripts/build-local.mjs --with-ai → dist/ вместе с воркерами ИИ (нужен node_modules/onnxruntime-web
 *                                            и файлы моделей в public/ai — их готовит scripts/prepare-ai.mjs)
 *
 * Переменная NODE_PATH может указывать на папку с react/react-dom, если их нет в node_modules.
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const single = process.argv.includes('--single');
const withAi = process.argv.includes('--with-ai');
const outdir = join(root, single ? 'dist-single' : 'dist');
const nodePaths = (process.env.NODE_PATH ?? '').split(':').filter(Boolean);

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src/main.tsx')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['safari15', 'chrome100'],
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths,
  write: false,
  outdir: join(outdir, 'assets'),
  entryNames: 'app',
  legalComments: 'none',
});

let js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
let html = readFileSync(join(root, 'index.html'), 'utf8');

if (single) {
  html = html
    .replace('<script type="module" src="/src/main.tsx"></script>', () => `<script type="module">${js.replace(/<\/script/g, '<\\/script')}</script>`)
    .replace('</head>', () => `<style>${css}</style>\n  </head>`);
  writeFileSync(join(outdir, 'index.html'), html);
} else {
  mkdirSync(join(outdir, 'assets'), { recursive: true });
  if (withAi) {
    // Воркеры ИИ: отдельные файлы рядом с app.js; ссылки на .ts заменяем на собранные .js
    const ortDir = join(root, 'node_modules/onnxruntime-web/dist');
    const workers = readdirSync(join(root, 'src/ai')).filter((f) => f.endsWith('.worker.ts'));
    for (const w of workers) {
      await build({
        entryPoints: [join(root, 'src/ai', w)],
        bundle: true,
        minify: true,
        format: 'esm',
        target: ['safari15', 'chrome100'],
        alias: { 'onnxruntime-web/wasm': join(ortDir, 'ort.wasm.min.mjs') },
        outfile: join(outdir, 'assets', w.replace(/\.ts$/, '.js')),
        legalComments: 'none',
        logLevel: 'warning',
      });
    }
    for (const f of readdirSync(ortDir).filter((f) => f.startsWith('ort-wasm') && f.endsWith('.mjs'))) cpSync(join(ortDir, f), join(outdir, 'assets', f));
    js = js.replace(/new URL\((["'])\.\.\/([\w-]+)\.worker\.ts\1/g, 'new URL($1./$2.worker.js$1');
  }
  writeFileSync(join(outdir, 'assets/app.js'), js);
  writeFileSync(join(outdir, 'assets/app.css'), css);
  html = html
    .replace('<script type="module" src="/src/main.tsx"></script>', '<script type="module" src="./assets/app.js"></script>')
    .replace('</head>', '<link rel="stylesheet" href="./assets/app.css" />\n  </head>');
  writeFileSync(join(outdir, 'index.html'), html);
  cpSync(join(root, 'public'), outdir, { recursive: true });
}

console.log(`OK → ${outdir}  (js ${(js.length / 1024).toFixed(0)} KB, css ${(css.length / 1024).toFixed(0)} KB)`);
