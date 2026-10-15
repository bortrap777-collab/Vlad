# Ассеты и лицензии

## Собственные материалы проекта

Всё перечисленное ниже создано для «Коля: Маленький хулиган». Сторонние изображения и записи не использовались.

| Что | Где лежит | Как сделано |
|---|---|---|
| Спрайты персонажей (13 листов, 30–50 кадров каждый) | `public/assets/gen/chars/*.png` | `tools/art/characters.ts`, `tools/art/cast.ts` |
| Портреты (5 эмоций × 13 персонажей) | `public/assets/gen/portraits/*.png` | `tools/art/characters.ts` → `drawPortrait` |
| Пёс Рыжий, консервные банки, иконки предметов | `dog.png`, `can.png`, `items.png` | `tools/art/extra.ts` |
| Небо, дальний и средний город, двор | `sky.png`, `far.png`, `mid.png`, `courtyard.png` | `tools/art/environment.ts` |
| Объекты двора (фонарь, лавочка, горка, качели, рукоход, машина, баки, сугробы, столбик) | `*.png` в `public/assets/gen/` | `tools/art/environment.ts` |
| Квартира и предметы в ней (коробки, хлеб, ключ) | `apartment.png`, `boxes.png`, `bread.png`, `key.png` | `tools/art/interior.ts` |
| Ключевой арт | `docs/keyart.png`, `public/assets/gen/keyart_small.png` | `tools/generate-assets.ts` |
| Музыка: двор, дом, драка, тайна; ветер | `public/assets/gen/audio/music_*`, `amb_wind.*` | `tools/audio.ts` (синтез) |
| Звуковые эффекты (шаги, двери, лай, банки, удары, интерфейс) | `public/assets/gen/audio/sfx_*` | `tools/audio.ts` (синтез) |

Все ассеты можно пересоздать командой `npm run assets`: генерация детерминирована, без случайных сидов.

## Сторонние компоненты

| Компонент | Автор | Лицензия | Как используется |
|---|---|---|---|
| Phaser 3.90 | Phaser Studio Inc. | MIT | игровой движок (npm-пакет `phaser`) |
| PT Sans | ParaType | SIL Open Font License 1.1 | основной шрифт, пакет `@fontsource/pt-sans` |
| Tiny5 | The Tiny5 Project Authors | SIL Open Font License 1.1 | пиксельный шрифт заголовков, пакет `@fontsource/tiny5` |

Тексты лицензий шрифтов лежат в `node_modules/@fontsource/*/LICENSE`. При сборке файлы шрифтов (`.woff2`) копируются в `dist/assets/`.

Инструменты разработки (Vite, TypeScript, Vitest, ESLint, Playwright, pngjs, tsx) в сборку игры не входят.
