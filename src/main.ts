import Phaser from 'phaser';
// only the Cyrillic + Latin subsets are needed
import '@fontsource/pt-sans/cyrillic-400.css';
import '@fontsource/pt-sans/latin-400.css';
import '@fontsource/pt-sans/cyrillic-700.css';
import '@fontsource/pt-sans/latin-700.css';
import '@fontsource/pt-sans/cyrillic-400-italic.css';
import '@fontsource/pt-sans/latin-400-italic.css';
import '@fontsource/tiny5/cyrillic-400.css';
import '@fontsource/tiny5/latin-400.css';
import { GAME_W, GAME_H } from './config';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { WorldScene } from './scenes/WorldScene';
import { UIScene } from './scenes/UIScene';
import { EndScene } from './scenes/EndScene';
import { services } from './services';

const bootEl = document.getElementById('boot')!;

function fail(msg: string) {
  bootEl.classList.remove('hidden');
  bootEl.innerHTML = `<div class="err">Не удалось запустить игру.<br>${msg}<br>Попробуйте обновить страницу или открыть игру в другом браузере.</div>`;
}

async function start() {
  // Make sure Cyrillic glyphs are ready before any canvas text is rendered.
  const fonts = ['400 20px "PT Sans"', '700 20px "PT Sans"', 'italic 400 20px "PT Sans"', '400 20px "Tiny5"'];
  try {
    await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f, 'Ёё Коля'))), new Promise((r) => setTimeout(r, 4000))]);
  } catch {
    /* fall back to system fonts */
  }
  services().initTouch();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: GAME_W,
    height: GAME_H,
    backgroundColor: '#070913',
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    audio: { disableWebAudio: false },
    fps: { target: 60, smoothStep: true },
    scene: [BootScene, TitleScene, WorldScene, UIScene, EndScene],
  });
  // Clear one-shot key presses after *all* scenes have updated (Phaser updates scenes top-down).
  game.events.on(Phaser.Core.Events.POST_STEP, () => services().input.endFrame());
  started = true;
  bootEl.classList.add('hidden');
  (window as unknown as { __KOLYA_GAME__: Phaser.Game }).__KOLYA_GAME__ = game;
  if (import.meta.env.DEV) (window as unknown as { __KOLYA_SV__: unknown }).__KOLYA_SV__ = services();
}

let started = false;
window.addEventListener('error', (e) => {
  console.error('[kolya] uncaught', e.message);
  if (!started) fail(String(e.message));
});
start().catch((e) => fail(String(e?.message ?? e)));
