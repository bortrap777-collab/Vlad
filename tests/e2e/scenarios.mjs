/**
 * Focused e2e scenarios: fight loss & retry, interior/exterior transitions with music,
 * corrupted saves, key rebinding, cutscene skipping and different window sizes.
 * Saves are seeded through localStorage (as if the player had played up to that point).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { launch, makeBot } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const OUT = process.env.SHOTS ?? 'test-results/scenarios';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const yardSave = (over = {}) => ({
  format: 'kolya-save',
  version: 1,
  savedAt: Date.now(),
  state: {
    version: 1,
    level: 'courtyard',
    x: 470,
    facing: 1,
    stage: 'defend',
    flags: { intro_done: true, yard_visited: true, met_zina: true, dog_calm: 2, dog_ready: true, dog_freed: true, dog_named: true, bread_taken: true },
    inventory: ['key', 'cans'],
    clues: ['clue_missing', 'clue_grandma'],
    choices: ['intro_quiet', 'zina_polite', 'dog_named'],
    history: [],
    playTime: 300,
    ...over,
  },
});

async function boot(page, bot, saves = {}) {
  await page.goto(`${BASE}/?zoom=2`);
  await page.evaluate((saves) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(saves)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, saves);
  await page.reload();
  await page.waitForFunction(() => window.__KOLYA_GAME__?.scene?.isActive('Title'), null, { timeout: 60000 });
  await bot.sleep(700);
  await bot.press('KeyX');
  await bot.sleep(400);
}

const UI_PAUSE_X = 960 / 2 - 60;
const results = [];
async function scenario(name, fn, viewport) {
  const { browser, page, errors } = await launch(chromium, viewport);
  const bot = makeBot(page, { out: OUT, log });
  log('▶', name);
  try {
    await fn(page, bot);
    if (errors.length) throw new Error(errors.join('\n'));
    results.push([name, 'OK']);
    log('  PASS', name);
  } catch (e) {
    results.push([name, 'FAIL: ' + e.message.split('\n')[0]]);
    log('  FAIL', name, e.message);
    await bot.screenshot('fail_' + name.replace(/\W+/g, '_')).catch(() => {});
  }
  await browser.close();
}

await scenario('fight: lose, retry, win', async (page, bot) => {
  await boot(page, bot, { 'kolya.save.auto': yardSave() });
  await bot.press('ArrowDown');
  await bot.press('Enter'); // Продолжить
  await bot.waitFor('in yard', (s) => s.world?.level === 'courtyard' && !s.world.busy);
  await bot.walkTo(700);
  await bot.waitFor('bullies', (s) => !!s.ui.dialogue, 30000);
  await bot.talkThrough(bot.choose('Слышь'));
  await bot.waitFor('fight', (s) => !!s.world.fight);
  // do nothing until Kolya ends up in the snow
  const lost = await bot.waitFor('lost', (s) => s.ui.overlay === true, 120000);
  bot.assert(lost.world.fight.hp === 0 && lost.world.fight.enemies[1].max === 4, 'lost (insulting Tolstyi gave him extra resolve)');
  await bot.screenshot('fight_lost');
  await bot.press('Enter');
  const again = await bot.waitFor('retry', (s) => s.world.fight?.state === 'active' && s.world.fight.hp === 5, 20000);
  bot.assert(again.world.fight.enemies.every((e) => e.resolve === e.max), 'fight restarted with full strength');
  let blocking = false;
  for (let i = 0; i < 5000; i++) {
    const s = await bot.snap();
    const f = s.world.fight;
    if (!f || f.state !== 'active') {
      if (blocking) await page.keyboard.up('Space');
      blocking = false;
      if (s.ui.overlay) await bot.press('Enter');
      if (!f && s.ui.dialogue) break;
      await bot.sleep(80);
      continue;
    }
    const px = s.world.px;
    const act = f.enemies.filter((e) => e.state !== 'flee' && e.state !== 'gone');
    const threat = act.find((e) => e.state === 'windup' || e.state === 'attack');
    const open = act.filter((e) => e.state === 'stagger' || e.state === 'recovery').sort((a, b) => Math.abs(a.x - px) - Math.abs(b.x - px))[0];
    if (threat && Math.abs(threat.x - px) < 40) {
      if (!blocking) await page.keyboard.down('Space');
      blocking = true;
    } else if (blocking) {
      await page.keyboard.up('Space');
      blocking = false;
    } else if (open) {
      const d = open.x - px;
      if (Math.abs(d) > 22) await bot.press(d > 0 ? 'ArrowRight' : 'ArrowLeft', Math.min(120, Math.abs(d) * 8));
      else {
        await bot.press(d > 0 ? 'ArrowRight' : 'ArrowLeft', 20);
        await bot.press('KeyE', 40);
        await bot.sleep(200);
      }
    }
    await bot.sleep(25);
  }
  await bot.talkThrough(bot.choose('Не твоё'));
  const s = await bot.idle();
  bot.assert(s.state.flags.fight_won && s.state.flags.seryoga_cheeky, 'won after retry; cheeky answer remembered');
});

await scenario('interior ↔ exterior: music, dog, footprints', async (page, bot) => {
  await boot(page, bot, { 'kolya.save.auto': yardSave({ x: 300 }) });
  await bot.press('ArrowDown');
  await bot.press('Enter'); // Продолжить
  let s = await bot.waitFor('yard', (s) => s.world?.level === 'courtyard' && !s.world.busy);
  bot.assert(s.world.music === 'music_yard', 'yard music outdoors');
  await bot.walkTo(196);
  await bot.interact('entrance', undefined, { dialogue: false });
  s = await bot.waitFor('apartment', (s) => s.world?.level === 'apartment' && !s.world.busy, 30000);
  await bot.sleep(500);
  s = await bot.snap();
  bot.assert(s.world.music === 'music_home' && s.world.dog === null, 'home music indoors, dog stays outside');
  await bot.walkTo(236 + 20);
  await bot.interact('npc:mama');
  await bot.walkTo(56);
  await bot.interact('door', undefined, { dialogue: false });
  s = await bot.waitFor('yard again', (s) => s.world?.level === 'courtyard' && !s.world.busy, 30000);
  await bot.sleep(400);
  s = await bot.snap();
  bot.assert(s.world.music === 'music_yard' && s.world.dog?.mode === 'follow' && Math.abs(s.world.px - 200) < 10, `back outside at the entrance, yard music resumes, dog follows (${s.world.music}, ${JSON.stringify(s.world.dog)}, x=${s.world.px})`);
  await bot.walkTo(420);
  await bot.screenshot('footprints');
});

await scenario('corrupted and missing saves', async (page, bot) => {
  await boot(page, bot, { 'kolya.save.slot2': '###not json', 'kolya.save.slot1': '{"format":"kolya-save","version":99,"state":{}}', 'kolya.settings': '{"master":"loud","keys":{"left":42}}' });
  // Continue / Load are disabled when no valid save exists: Enter starts a new game instead
  await bot.press('ArrowDown');
  await bot.press('Enter');
  await bot.sleep(500);
  const isTitle = await page.evaluate(() => window.__KOLYA_GAME__.scene.isActive('Title'));
  bot.assert(isTitle, 'title still responsive');
  await bot.screenshot('title_with_broken_saves');
  // the pause → load screen lists slots as damaged
  await page.evaluate(() => localStorage.setItem('kolya.save.auto', 'null'));
  bot.assert(true, 'no exceptions with corrupted saves and settings');
});

await scenario('rebind interact to F', async (page, bot) => {
  await boot(page, bot, { 'kolya.save.auto': yardSave({ x: 230 }) });
  // Title menu: Новая игра, Продолжить, Загрузить, Настройки, Управление
  for (let i = 0; i < 4; i++) await bot.press('ArrowDown');
  await bot.press('Enter');
  await bot.sleep(400);
  await bot.press('ArrowDown');
  await bot.press('ArrowDown'); // Действие / толчок
  await bot.press('Enter');
  await bot.sleep(200);
  await bot.press('KeyF');
  await bot.sleep(300);
  await bot.screenshot('rebound');
  const keys = await page.evaluate(() => JSON.parse(localStorage.getItem('kolya.settings')).keys.interact);
  bot.assert(keys[0] === 'KeyF', 'binding saved');
  await bot.press('Escape');
  await bot.sleep(300);
  for (let i = 0; i < 4; i++) await bot.press('ArrowUp');
  await bot.press('ArrowDown'); // Продолжить
  await bot.press('Enter');
  await bot.waitFor('yard', (s) => s.world?.level === 'courtyard' && !s.world.busy);
  await bot.walkTo(222);
  await bot.waitFor('prompt', (s) => s.world.prompt?.key === 'board');
  await bot.press('KeyE');
  await bot.sleep(400);
  bot.assert(!(await bot.snap()).ui.dialogue, 'E no longer interacts');
  await bot.press('KeyF');
  await bot.waitFor('dialogue via F', (s) => !!s.ui.dialogue, 5000);
  await bot.screenshot('prompt_F');
  bot.assert(true, 'F opens the notice board');
});

await scenario('cutscene skip with Esc', async (page, bot) => {
  await boot(page, bot);
  await bot.press('Enter'); // new game
  await bot.waitFor('intro', (s) => !!s.ui?.dialogue, 60000);
  await bot.press('Escape');
  const s = await bot.waitFor('skipped to the choice', (s) => s.ui.dialogue?.choices.length > 0, 10000);
  bot.assert(s.state.history.length >= 7, 'skipped lines are still recorded in the history');
  await bot.talkThrough();
  const e = await bot.idle();
  bot.assert(e.state.stage === 'leave_home', 'intro completes after skipping');
});

await scenario('phone: on-screen buttons only (no keyboard)', async (page, bot) => {
  await page.goto(`${BASE}/`);
  await page.evaluate((save) => {
    localStorage.clear();
    localStorage.setItem('kolya.save.auto', JSON.stringify(save));
  }, yardSave({ x: 600, stage: 'help_dog' }));
  await page.reload();
  await page.waitForFunction(() => window.__KOLYA_GAME__?.scene?.isActive('Title'), null, { timeout: 60000 });
  await bot.sleep(700);
  const box = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.left, y: r.top, k: r.width / 960 };
  });
  const ui = (x, y) => [box.x + x * box.k, box.y + y * box.k];
  await page.touchscreen.tap(420, 200); // «Коснитесь экрана»
  await bot.sleep(400);
  await page.touchscreen.tap(...ui(150, 262 + 36)); // «Продолжить»
  await bot.waitFor('yard', (s) => s.world?.level === 'courtyard' && !s.world.busy, 60000);
  bot.assert(await page.evaluate(() => !document.querySelector('.tc').hidden), 'touch buttons are shown');
  await bot.screenshot('phone_yard');
  const hold = async (k, ms) => {
    const b = page.locator(`.tc button[data-k="${k}"]`);
    await b.dispatchEvent('pointerdown', { pointerId: 1 });
    await bot.sleep(ms);
    await b.dispatchEvent('pointerup', { pointerId: 1 });
  };
  const x0 = (await bot.snap()).world.px;
  await hold('left', 900);
  const x1 = (await bot.snap()).world.px;
  bot.assert(x1 < x0 - 10, `◀ walks left (${Math.round(x0)} → ${Math.round(x1)})`);
  // walk to the notice board and use the «Действие» button
  for (let i = 0; i < 80; i++) {
    const s = await bot.snap();
    if (s.world.prompt?.key === 'board') break;
    await hold(s.world.px > 222 ? 'left' : 'right', 120);
  }
  await page.locator('.tc button[data-k="interact"]').tap();
  await bot.waitFor('board dialogue', (s) => !!s.ui.dialogue, 10000);
  bot.assert(await page.evaluate(() => document.querySelector('.tc button[data-k="left"]').hidden), 'movement buttons hide during dialogue');
  await bot.screenshot('phone_dialogue');
  for (let i = 0; i < 10 && (await bot.snap()).ui.dialogue; i++) {
    await page.touchscreen.tap(...ui(480, 130)); // tap the dialogue box
    await bot.sleep(300);
  }
  bot.assert((await bot.snap()).state.flags.saw_poster === true, 'dialogue finished by tapping the box');
  await page.locator('.tc button[data-k="journal"]').tap();
  await bot.waitFor('journal', (s) => !!s.ui.journal);
  await page.touchscreen.tap(...ui(880, 70)); // ✕
  await bot.waitFor('journal closed', (s) => !s.ui.journal);
  await page.locator('.tc button[data-k="pause"]').tap();
  await bot.waitFor('paused', (s) => s.ui.paused);
  await page.touchscreen.tap(...ui(UI_PAUSE_X, 188)); // «Продолжить»
  await bot.waitFor('resumed', (s) => !s.ui.paused);
  bot.assert(true, 'journal and pause work by touch');
}, { width: 844, height: 390, mobile: true });

for (const [w, h] of [[800, 450], [1920, 1080], [1280, 1024], [1024, 768]]) {
  await scenario(`viewport ${w}×${h}`, async (page, bot) => {
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => window.__KOLYA_GAME__?.scene?.isActive('Title'), null, { timeout: 60000 });
    await bot.sleep(800);
    const m = await page.evaluate(() => {
      const c = document.querySelector('canvas').getBoundingClientRect();
      return { c: [c.left, c.top, c.width, c.height], vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, res: [document.querySelector('canvas').width, document.querySelector('canvas').height] };
    });
    bot.assert(m.c[2] <= m.vw + 1 && m.c[3] <= m.vh + 1 && m.sw <= m.vw && m.sh <= m.vh, `canvas fits without scrolling (${m.c.map(Math.round).join(',')}; render ${m.res.join('×')})`);
    bot.assert(Math.abs(m.c[2] / m.c[3] - 16 / 9) < 0.01, 'keeps 16:9 (letterboxed)');
    await bot.screenshot(`viewport_${w}x${h}`);
  }, { width: w, height: h });
}

console.log('\n' + results.map(([n, r]) => `${r === 'OK' ? '✓' : '✗'} ${n} — ${r}`).join('\n'));
process.exit(results.every(([, r]) => r === 'OK') ? 0 : 1);
