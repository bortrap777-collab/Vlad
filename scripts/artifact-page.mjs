/**
 * Превращает dist-single/index.html в страницу для просмотрщика артефактов Claude:
 * без собственных <html>/<head>/<body>, без manifest и иконок (офлайн-режим там недоступен).
 *   node scripts/artifact-page.mjs <выходной файл>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(root, 'dist-single/artifact.html');
const html = readFileSync(join(root, 'dist-single/index.html'), 'utf8');

let head = html.match(/<head>([\s\S]*)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
head = head
  .replace(/\s*<meta charset[^>]*>/, '')
  .replace(/\s*<meta name="viewport"[^>]*>/, '')
  .replace(/\s*<title>[^<]*<\/title>/, '')
  .replace(/\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*>/g, '')
  .replace(/\s*<meta name="(apple-mobile[^"]*|mobile-web-app-capable)"[^>]*>/g, '');

const viewerFix = `<style>/* В просмотрщике отступы безопасной зоны сверху/снизу уже заданы на :root */
.screen{padding-top:0}.topbar{top:0}.screen-scroll{padding-bottom:28px}
.toolbar{padding-bottom:10px}.photo-panel{padding-bottom:12px}.import-empty{padding-bottom:40px}</style>`;

writeFileSync(
  out,
  `<title>Ws</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${head.trim()}\n${viewerFix}\n${body.trim()}\n`,
);
console.log('artifact page →', out);
