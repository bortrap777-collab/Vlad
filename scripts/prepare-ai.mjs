/**
 * Готовит файлы ИИ для публикации вместе с приложением (папка public/ai, в git не хранится).
 * Приложение скачивает их с того же адреса, что и само приложение, только когда пользователь
 * впервые включает инструмент, и проверяет каждый файл по SHA-256 из manifest.json.
 *
 * Наборы (packs):
 *   segment — удаление фона: ISNet (DIS) квантованная, 44 МБ;
 *   select  — выделение касанием: MobileSAM (энкодер 28 МБ) + декодер масок SAM (16,5 МБ);
 *   erase   — удаление объектов с заполнением фона: MI-GAN (Picsart AI Research), 28 МБ;
 *   speech    — субтитры: Whisper base (OpenAI, MIT), квантованный ONNX (onnx-community), 77 МБ;
 *   speech-hq — субтитры точнее: Whisper small, 249 МБ (файлы больше 90 МБ хранятся частями);
 *   общий движок ONNX Runtime Web (WASM) из node_modules.
 *
 * Источники моделей (файл принимается, только если SHA-256 совпадает с указанным ниже):
 *   ISNet — npm-пакет @imgly/background-removal-node (части по 4 МБ, каждая проверяется по SHA-256);
 *   MobileSAM и декодер SAM — npm-пакет @geti-ui/smart-tools (Intel Geti, Apache-2.0);
 *   MI-GAN — Hugging Face (andraniksargsyan/migan), при недоступности — копия в npm-пакете migan-onnx.
 *   Whisper — Hugging Face (onnx-community/whisper-base, onnx-community/whisper-small).
 *
 *   node scripts/prepare-ai.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/ai');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const valid = (name, sha) => existsSync(join(out, name)) && sha256(readFileSync(join(out, name))) === sha;
mkdirSync(out, { recursive: true });

/** Скачать npm-пакет во временную папку и распаковать нужные файлы */
function fromNpm(pkg, files) {
  const tmp = mkdtempSync(join(tmpdir(), 'wstudio-ai-'));
  const tgz = execFileSync(npm, ['pack', pkg, '--pack-destination', tmp, '--silent'], { encoding: 'utf8' }).trim().split('\n').pop();
  execFileSync('tar', ['xzf', join(tmp, tgz), '-C', tmp, ...files.map((f) => `package/${f}`)]);
  return { dir: join(tmp, 'package'), done: () => rmSync(tmp, { recursive: true, force: true }) };
}

/** Взять файлы из npm-пакета, проверив SHA-256 */
function copyFromNpm(pkg, list) {
  const need = list.filter((f) => !valid(f.name, f.sha256));
  if (!need.length) return;
  console.log(`Скачиваю ${need.map((f) => f.name).join(', ')} из ${pkg}…`);
  const p = fromNpm(pkg, need.map((f) => f.path));
  try {
    for (const f of need) {
      const buf = readFileSync(join(p.dir, f.path));
      if (sha256(buf) !== f.sha256) throw new Error(`${f.name}: контрольная сумма не совпала`);
      writeFileSync(join(out, f.name), buf);
    }
  } finally {
    p.done();
  }
}

/* ---------- ISNet ---------- */
const ISNET = { name: 'isnet-quint8.onnx', sha256: '7001d60734fdc112dd9c062635fb59cd401fb82a9d4213134bce4dbd655c803a' };
if (!valid(ISNET.name, ISNET.sha256)) {
  console.log('Скачиваю ISNet из @imgly/background-removal-node…');
  const meta = fromNpm('@imgly/background-removal-node@1.4.5', ['dist/resources.json']);
  const res = JSON.parse(readFileSync(join(meta.dir, 'dist/resources.json'), 'utf8'))['/models/small'];
  meta.done();
  const pkg = fromNpm('@imgly/background-removal-node@1.4.5', res.chunks.map((c) => `dist/${c.hash}`));
  try {
    const parts = res.chunks.map((c) => {
      const buf = readFileSync(join(pkg.dir, 'dist', c.hash));
      if (sha256(buf) !== c.hash) throw new Error(`Часть модели ${c.hash} повреждена`);
      return buf;
    });
    const model = Buffer.concat(parts);
    if (sha256(model) !== ISNET.sha256) throw new Error('ISNet: контрольная сумма не совпала');
    writeFileSync(join(out, ISNET.name), model);
  } finally {
    pkg.done();
  }
}

/* ---------- MobileSAM: выделение касанием ---------- */
const SAM = [
  { name: 'sam-encoder-mobile.onnx', path: 'dist/esm/mobile_sam.encoder.onnx', sha256: '37326714456ecfae9dada1c9ca4aaf314e7190da7b2e0f18763666c3b8db6ed8' },
  { name: 'sam-decoder.onnx', path: 'dist/esm/sam_vit_h_4b8939.decoder.onnx', sha256: '4f76a687fe128badbce801c68f0f1775da829f46f80b5357cbf134dae8ae1b68' },
];
copyFromNpm('@geti-ui/smart-tools@1.7.0', SAM);

/* ---------- MI-GAN: удаление объектов ---------- */
const MIGAN = { name: 'migan-pipeline-v2.onnx', path: 'models/migan_pipeline_v2.onnx', sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b' };
if (!valid(MIGAN.name, MIGAN.sha256)) {
  try {
    const res = await fetch('https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx', { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(String(res.status));
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== MIGAN.sha256) throw new Error('контрольная сумма не совпала');
    writeFileSync(join(out, MIGAN.name), buf);
    console.log('MI-GAN — с Hugging Face');
  } catch (e) {
    console.log(`MI-GAN с Hugging Face не получен (${e.message}), беру копию из npm`);
    copyFromNpm('migan-onnx@1.0.0', [MIGAN]);
  }
}

/* ---------- Whisper: субтитры ---------- */
const HF = 'https://huggingface.co/onnx-community';
const WHISPER = [
  { name: 'whisper-base-encoder-q8.onnx', url: `${HF}/whisper-base/resolve/main/onnx/encoder_model_quantized.onnx`, sha256: '5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46' },
  { name: 'whisper-base-decoder-q8.onnx', url: `${HF}/whisper-base/resolve/main/onnx/decoder_model_merged_quantized.onnx`, sha256: 'fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b' },
  { name: 'whisper-base-generation.json', url: `${HF}/whisper-base/resolve/main/generation_config.json`, sha256: '61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0' },
  { name: 'whisper-vocab.json', url: `${HF}/whisper-base/resolve/main/vocab.json`, sha256: '50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a' },
  { name: 'whisper-small-encoder-q8.onnx', url: `${HF}/whisper-small/resolve/main/onnx/encoder_model_quantized.onnx`, sha256: 'a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92' },
  { name: 'whisper-small-decoder-q8.onnx', url: `${HF}/whisper-small/resolve/main/onnx/decoder_model_merged_quantized.onnx`, sha256: 'ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9' },
  { name: 'whisper-small-generation.json', url: `${HF}/whisper-small/resolve/main/generation_config.json`, sha256: 'f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0' },
];
/** Файл уже нарезан на части прошлой сборкой и части целы */
function partsValid(f) {
  const parts = [];
  for (let k = 0; existsSync(join(out, `${f.name}.part${k}`)); k++) parts.push(readFileSync(join(out, `${f.name}.part${k}`)));
  return parts.length > 0 && sha256(Buffer.concat(parts)) === f.sha256;
}
for (const f of WHISPER) {
  if (valid(f.name, f.sha256) || partsValid(f)) continue;
  let buf = null;
  for (let attempt = 1; attempt <= 3 && !buf; attempt++) {
    try {
      const res = await fetch(f.url, { signal: AbortSignal.timeout(600_000) });
      if (!res.ok) throw new Error(String(res.status));
      const b = Buffer.from(await res.arrayBuffer());
      if (sha256(b) !== f.sha256) throw new Error('контрольная сумма не совпала');
      buf = b;
    } catch (e) {
      console.log(`${f.name}: попытка ${attempt} — ${e.message}`);
    }
  }
  if (!buf) throw new Error(`Не удалось скачать ${f.name}`);
  writeFileSync(join(out, f.name), buf);
  console.log(`${f.name} — с Hugging Face`);
}
/** Файлы больше 90 МБ публикуем частями: так их надёжно отдаёт любой хостинг и кэш браузера */
const PART = 90 * 1024 * 1024;
function partsOf(name) {
  if (!existsSync(join(out, name))) {
    const names = [];
    for (let k = 0; existsSync(join(out, `${name}.part${k}`)); k++) names.push(`${name}.part${k}`);
    return names;
  }
  const buf = readFileSync(join(out, name));
  if (buf.length <= PART) return [name];
  const names = [];
  for (let i = 0, k = 0; i < buf.length; i += PART, k++) {
    const part = `${name}.part${k}`;
    writeFileSync(join(out, part), buf.subarray(i, Math.min(buf.length, i + PART)));
    names.push(part);
  }
  rmSync(join(out, name));
  return names;
}
const smallEnc = partsOf('whisper-small-encoder-q8.onnx');
const smallDec = partsOf('whisper-small-decoder-q8.onnx');

/* ---------- Движок ---------- */
const WASM = 'ort-wasm-simd-threaded.wasm';
copyFileSync(join(root, 'node_modules/onnxruntime-web/dist', WASM), join(out, WASM));

const speechBase = ['whisper-base-encoder-q8.onnx', 'whisper-base-decoder-q8.onnx', 'whisper-base-generation.json', 'whisper-vocab.json'];
const speechSmall = [...smallEnc, ...smallDec, 'whisper-small-generation.json', 'whisper-vocab.json'];
const packs = {
  segment: [ISNET.name, WASM],
  select: [...SAM.map((f) => f.name), WASM],
  erase: [MIGAN.name, WASM],
  speech: [...speechBase, WASM],
  'speech-hq': [...speechSmall, WASM],
};
const names = [...new Set([ISNET.name, ...SAM.map((f) => f.name), MIGAN.name, ...speechBase, ...speechSmall, WASM])];
const files = names.map((name) => {
  const buf = readFileSync(join(out, name));
  return { name, size: buf.length, sha256: sha256(buf), packs: Object.keys(packs).filter((p) => packs[p].includes(name)) };
});
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ files }, null, 2));
console.log(`ИИ-файлы готовы: ${files.map((f) => `${f.name} ${(f.size / 1e6).toFixed(1)} МБ`).join(', ')}`);
