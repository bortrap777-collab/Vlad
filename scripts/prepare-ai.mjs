/**
 * Готовит файлы ИИ для публикации вместе с приложением (папка public/ai, в git не хранится):
 *   isnet-quint8.onnx            — модель отделения объекта от фона (ISNet / DIS, 44 МБ, квантованная);
 *   ort-wasm-simd-threaded.wasm  — движок ONNX Runtime Web (из node_modules);
 *   manifest.json                — список файлов с размерами и SHA-256 для проверки после скачивания.
 *
 * Модель берётся из npm-пакета @imgly/background-removal-node, где она лежит частями по 4 МБ;
 * каждая часть проверяется по SHA-256. Приложение скачивает эти файлы с того же адреса,
 * что и само приложение, только когда пользователь впервые включает ИИ-инструмент.
 *
 *   node scripts/prepare-ai.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/ai');
const MODEL_PKG = '@imgly/background-removal-node@1.4.5';
const MODEL_KEY = '/models/small';
const MODEL_FILE = 'isnet-quint8.onnx';
const MODEL_SIZE = 44342436;
const WASM_FILE = 'ort-wasm-simd-threaded.wasm';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
mkdirSync(out, { recursive: true });

const modelPath = join(out, MODEL_FILE);
if (!existsSync(modelPath) || statSync(modelPath).size !== MODEL_SIZE) {
  const tmp = mkdtempSync(join(tmpdir(), 'wstudio-model-'));
  try {
    console.log(`Скачиваю модель из ${MODEL_PKG}…`);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const tgz = execFileSync(npm, ['pack', MODEL_PKG, '--pack-destination', tmp, '--silent'], { encoding: 'utf8' }).trim().split('\n').pop();
    execFileSync('tar', ['xzf', join(tmp, tgz), '-C', tmp, 'package/dist/resources.json']);
    const res = JSON.parse(readFileSync(join(tmp, 'package/dist/resources.json'), 'utf8'))[MODEL_KEY];
    if (!res || res.size !== MODEL_SIZE) throw new Error('В пакете нет ожидаемой модели');
    execFileSync('tar', ['xzf', join(tmp, tgz), '-C', tmp, ...res.chunks.map((c) => `package/dist/${c.hash}`)]);
    const parts = res.chunks.map((c) => {
      const buf = readFileSync(join(tmp, 'package/dist', c.hash));
      if (sha256(buf) !== c.hash || buf.length !== c.offsets[1] - c.offsets[0]) throw new Error(`Часть модели ${c.hash} повреждена`);
      return buf;
    });
    writeFileSync(modelPath, Buffer.concat(parts));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

copyFileSync(join(root, 'node_modules/onnxruntime-web/dist', WASM_FILE), join(out, WASM_FILE));
const ortVersion = JSON.parse(readFileSync(join(root, 'node_modules/onnxruntime-web/package.json'), 'utf8')).version;

const files = [MODEL_FILE, WASM_FILE].map((name) => {
  const buf = readFileSync(join(out, name));
  return { name, size: buf.length, sha256: sha256(buf) };
});
const manifest = { version: `isnet-quint8+ort-${ortVersion}`, files };
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`ИИ-файлы готовы: ${files.map((f) => `${f.name} ${(f.size / 1e6).toFixed(1)} МБ`).join(', ')}`);
