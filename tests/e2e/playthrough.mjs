/**
 * End-to-end playthrough of Chapter 1, driven only by keyboard input like a player.
 * The game exposes a read-only snapshot (window.__KOLYA__) that the bot uses to see
 * where things are; it never calls game functions or changes state directly.
 *
 * Usage: npm run build && npx vite preview --port 4173 &  then  npm run test:e2e
 *        BASE_URL=http://localhost:5173 npm run test:e2e   (against the dev server)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { launch, makeBot } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const OUT = process.env.SHOTS ?? 'test-results';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const { browser, page, errors } = await launch(chromium);
const { snap, sleep, waitFor, press, screenshot, walkTo, talkThrough, choose, interact, idle, assert } = makeBot(page, { out: OUT, log });

// ------------------------------------------------------------------ run
try {
  log('open', BASE);
  await page.goto(`${BASE}/?zoom=2`);
  await page.waitForFunction(() => window.__KOLYA_GAME__?.scene?.isActive('Title'), null, { timeout: 60000 });
  await sleep(800);
  await screenshot('title');
  await press('KeyX');
  await sleep(500);
  await press('Enter'); // Новая игра
  log('new game → intro');
  await waitFor('intro dialogue', (s) => !!s.ui?.dialogue, 60000);
  await screenshot('intro_dialogue');
  await talkThrough(choose('опять ругаетесь'));
  let s = await idle();
  assert(s.state.stage === 'leave_home', 'intro finished, stage leave_home');

  log('pick up key and bread');
  await walkTo(108);
  await interact('hooks');
  await walkTo(304);
  await interact('bread');
  s = await snap();
  assert(s.state.inventory.includes('key') && s.state.inventory.includes('bread'), 'has key and bread');
  await walkTo(56);
  await screenshot('apartment');
  await interact('door', undefined, { dialogue: false });
  s = await waitFor('courtyard', (s) => s.world.level === 'courtyard' && !s.world.busy && s.state.stage === 'meet_yard', 30000);
  assert(s.state.stage === 'meet_yard', 'entered courtyard');
  await screenshot('courtyard');

  log('neighbours');
  await walkTo(276);
  await interact('npc:zina', choose('Здравствуйте', 'что случилось'));
  s = await snap();
  assert(s.state.clues.includes('clue_grandma') && s.state.stage === 'help_dog', 'learned about Dimka and the dog');

  log('manual save to slot 1');
  await press('Escape');
  await waitFor('pause', (s) => s.ui.paused);
  await screenshot('pause');
  await press('ArrowDown');
  await press('Enter'); // Сохранить
  await sleep(300);
  await press('Enter'); // Слот 1
  await sleep(300);
  await press('Escape');
  await sleep(200);
  await press('Escape');
  await waitFor('unpaused', (s) => !s.ui.paused);
  const saved = await page.evaluate(() => localStorage.getItem('kolya.save.slot1'));
  assert(saved && JSON.parse(saved).state.stage === 'help_dog', 'slot 1 saved');

  log('the dog');
  await walkTo(1400, { run: true });
  s = await snap();
  await walkTo(s.world.dog.x - 16); // approach slowly — running scares it
  await interact('dog', choose('горбушку', 'Тихо позвать', 'Развязать'));
  for (let k = 0; k < 4; k++) {
    s = await snap();
    if (s.ui.minigame) break;
    await interact('dog', choose('горбушку', 'Позвать', 'Развязать'));
  }
  // knot mini-game
  s = await waitFor('minigame', (s) => !!s.ui.minigame, 15000);
  await screenshot('minigame');
  for (let tries = 0; tries < 400; tries++) {
    s = await snap();
    const m = s.ui.minigame;
    if (!m) break;
    const px = m.pos * m.W;
    if (px > m.zoneX + 8 && px < m.zoneX + m.zoneW - 8) {
      await press('KeyE', 20);
      await sleep(250);
    } else await sleep(15);
  }
  await talkThrough(choose('Рыжим'));
  s = await idle();
  assert(s.state.flags.dog_freed && s.state.stage === 'defend', 'dog freed');

  log('reload page → continue from autosave');
  await page.reload();
  await page.waitForFunction(() => window.__KOLYA_GAME__?.scene?.isActive('Title'), null, { timeout: 60000 });
  await sleep(800);
  await press('KeyX');
  await sleep(400);
  await press('ArrowDown');
  await press('Enter'); // Продолжить
  s = await waitFor('resumed', (s) => s.world?.level === 'courtyard' && !s.world.busy, 60000);
  assert(s.state.flags.dog_freed && s.state.inventory.includes('cans') && s.state.stage === 'defend', 'state restored after reload');

  log('throw away the cans');
  await walkTo(1140);
  await interact('trash_cans');

  log('bullies');
  await walkTo(700, { run: true }); // trigger fires at x≥600
  await waitFor('bullies dialogue', (s) => !!s.ui.dialogue, 30000);
  await screenshot('bullies');
  await talkThrough(choose('Отстаньте'));
  await waitFor('fight', (s) => !!s.world.fight, 30000);
  await screenshot('fight');
  let blocking = false;
  for (let i = 0; i < 4000; i++) {
    s = await snap();
    const f = s.world.fight;
    if (!f || f.state !== 'active') {
      if (blocking) await page.keyboard.up('Space');
      if (s.ui.overlay) {
        log('  lost the fight — retrying');
        await press('Enter');
        await sleep(300);
        continue;
      }
      if (!f && !s.ui.overlay && s.ui.dialogue) break;
      if (!f) {
        await sleep(100);
        continue;
      }
      await sleep(100);
      continue;
    }
    const px = s.world.px;
    const active = f.enemies.filter((e) => e.state !== 'flee' && e.state !== 'gone');
    const threat = active.find((e) => e.state === 'windup' || e.state === 'attack');
    const open = active.filter((e) => e.state === 'stagger' || e.state === 'recovery').sort((a, b) => Math.abs(a.x - px) - Math.abs(b.x - px))[0];
    if (threat && Math.abs(threat.x - px) < 40) {
      if (!blocking) {
        await page.keyboard.down('Space');
        blocking = true;
      }
    } else if (blocking) {
      await page.keyboard.up('Space');
      blocking = false;
    } else if (open) {
      const d = open.x - px;
      if (Math.abs(d) > 22) {
        await press(d > 0 ? 'ArrowRight' : 'ArrowLeft', Math.min(120, Math.abs(d) * 8));
      } else {
        // face the target, then shove
        await press(d > 0 ? 'ArrowRight' : 'ArrowLeft', 20);
        await press('KeyE', 40);
        await sleep(200);
      }
    }
    await sleep(25);
  }
  await screenshot('after_fight');
  await talkThrough(choose('В секции'));
  s = await idle();
  assert(s.state.flags.fight_won && s.state.stage === 'talk_olya', 'fight won');

  log('Olya');
  const olya = s.world.npcs.find((n) => n.id === 'olya');
  await walkTo(olya.x - 16);
  await interact('npc:olya', choose('Ты как', 'Вместе'));
  s = await snap();
  assert(s.state.stage === 'investigate' && s.state.clues.includes('clue_officer'), 'investigation started');

  log('Sveta');
  await walkTo(784);
  await interact('npc:sveta', choose('Извини', 'никто его не ищет'));
  s = await snap();
  assert(s.state.clues.includes('clue_drawing'), 'got Sveta’s drawing');

  log('Lyokha');
  await walkTo(1280, { run: true });
  await interact('npc:lyokha', choose('Димку'));
  s = await snap();
  assert(s.state.inventory.includes('flashlight'), 'got flashlight');

  log('Sasha (false lead)');
  await walkTo(1404);
  await interact('npc:sasha', choose('не видели'));
  await walkTo(1446);
  await interact('garage12');

  log('dog digs (runs off by itself after Lyokha’s hint)');
  await waitFor('dog digging', (s) => s.state.flags.dog_digging, 20000);
  await walkTo(1600, { run: true });
  await interact('mitten');
  s = await snap();
  assert(s.state.stage === 'deduce' && s.state.clues.includes('clue_mitten'), 'all clues → deduce');

  log('journal: combine clues');
  await press('KeyJ');
  await waitFor('journal', (s) => !!s.ui.journal);
  await press('ArrowRight'); // Улики
  await sleep(200);
  s = await snap();
  const clues = s.state.clues;
  for (const target of ['clue_officer', 'clue_grandma']) {
    let cur = (await snap()).ui.journal.sel;
    const idx = clues.indexOf(target);
    while (cur !== idx) {
      await press(cur < idx ? 'ArrowDown' : 'ArrowUp');
      cur = (await snap()).ui.journal.sel;
    }
    await press('Enter');
  }
  await screenshot('journal');
  await press('KeyC');
  await sleep(400);
  await screenshot('journal_insight');
  s = await snap();
  assert(s.state.clues.includes('insight_lie') && s.state.stage === 'tell_olya', 'deduction made');
  await press('Escape');
  await waitFor('journal closed', (s) => !s.ui.journal);

  log('finale');
  s = await snap();
  const olya2 = s.world.npcs.find((n) => n.id === 'olya');
  await walkTo(olya2.x - 16, { run: true });
  await interact('npc:olya', choose('проверить'));
  // the finale cutscene chains several dialogues
  for (let k = 0; k < 4; k++) {
    await waitFor('finale dialogue', (s) => !!s.ui.dialogue || s.state.stage === 'go_home', 90000);
    if ((await snap()).state.stage === 'go_home') break;
    if (k === 1) await screenshot('finale_officer');
    await talkThrough(choose('Промолчать'));
  }
  s = await idle();
  assert(s.state.stage === 'go_home' && s.state.flags.night, 'finale done, night falls');
  await screenshot('night');

  log('home');
  await walkTo(196, { run: true });
  await interact('entrance', undefined, { dialogue: false });
  await waitFor('apartment night', (s) => s.world.level === 'apartment' && !!s.ui?.dialogue, 60000);
  await talkThrough(choose('не будете ругаться', 'Обещаю'));
  for (let k = 0; k < 400; k++) {
    if (await page.evaluate(() => window.__KOLYA_GAME__.scene.isActive('End'))) break;
    const r = await snap();
    if (r?.ui?.dialogue) await press('KeyE');
    await sleep(150);
  }
  await page.waitForFunction(() => window.__KOLYA_GAME__.scene.isActive('End'), null, { timeout: 60000 });
  await sleep(1500);
  await screenshot('end');
  const final = await snap();
  assert(final.state.stage === 'done', 'chapter complete — end screen shown');

  log('load slot 1 from title still works');
  await press('Enter'); // В главное меню
  await page.waitForFunction(() => window.__KOLYA_GAME__.scene.isActive('Title'), null, { timeout: 30000 });
  await sleep(500);
  await press('KeyX');
  await sleep(300);
  await press('ArrowDown');
  await press('ArrowDown');
  await press('Enter'); // Загрузить
  await sleep(300);
  await press('ArrowDown'); // auto → slot1
  await press('Enter');
  s = await waitFor('slot1 loaded', (s) => s.world?.level === 'courtyard' && s.state.stage === 'help_dog', 60000);
  assert(true, 'slot 1 loads into the courtyard at the saved stage');

  if (errors.length) throw new Error('console errors:\n' + errors.join('\n'));
  log('PLAYTHROUGH PASSED');
  await browser.close();
  process.exit(0);
} catch (e) {
  console.error(e);
  await screenshot('failure').catch(() => {});
  console.error('errors:', errors.join('\n'));
  await browser.close();
  process.exit(1);
}
