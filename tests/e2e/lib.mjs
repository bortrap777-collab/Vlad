/** Shared keyboard-driving helpers for the e2e scripts (read-only access to the game). */
export function makeBot(page, { out = 'test-results', log = console.log } = {}) {
  const snap = () => page.evaluate(() => {
    const k = window.__KOLYA__;
    if (!k) return null;
    try {
      return { state: k.state, world: k.world, ui: k.ui };
    } catch {
      return null;
    }
  });
  const sleep = (ms) => page.waitForTimeout(ms);
  async function waitFor(desc, pred, timeout = 60000) {
    const t0 = Date.now();
    for (;;) {
      const s = await snap();
      if (s && pred(s)) return s;
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${desc}\n${JSON.stringify(s?.world)}\n${JSON.stringify(s?.ui)}`);
      await sleep(120);
    }
  }
  async function press(key, hold = 60) {
    await page.keyboard.down(key);
    await sleep(hold);
    await page.keyboard.up(key);
  }
  let shot = 0;
  async function screenshot(name) {
    await page.screenshot({ path: `${out}/${String(++shot).padStart(2, '0')}_${name}.png` });
  }

  /** Walk (holding an arrow key) until Kolya is within `tol` px of x. */
  async function walkTo(x, { run = false, tol = 4, timeout = 90000 } = {}) {
    const t0 = Date.now();
    let held = null;
    if (run) await page.keyboard.down('ShiftLeft');
    try {
      for (;;) {
        const s = await snap();
        if (!s.world.busy && Math.abs(s.world.px - x) <= tol) break;
        if (s.world.busy) {
          if (held) await page.keyboard.up(held);
          held = null;
          return s; // a cutscene / trigger took over
        }
        const want = s.world.px < x ? 'ArrowRight' : 'ArrowLeft';
        if (held !== want) {
          if (held) await page.keyboard.up(held);
          await page.keyboard.down(want);
          held = want;
        }
        if (Date.now() - t0 > timeout) throw new Error(`walkTo(${x}) timed out at ${s.world.px}`);
        await sleep(Math.abs(s.world.px - x) > 30 ? 60 : 16);
      }
    } finally {
      if (held) await page.keyboard.up(held);
      if (run) await page.keyboard.up('ShiftLeft');
    }
    return snap();
  }

  /** Advance the current dialogue. `pick(choices)` returns the index to choose. */
  async function talkThrough(pick = () => 0, timeout = 120000) {
    const t0 = Date.now();
    let seen = 0;
    for (;;) {
      const s = await snap();
      if (Date.now() - t0 > timeout) throw new Error('dialogue timeout ' + JSON.stringify(s.ui));
      const d = s.ui?.dialogue;
      if (!d) {
        if (seen > 0) {
          // wait briefly in case another dialogue follows immediately
          await sleep(250);
          const s2 = await snap();
          if (!s2.ui?.dialogue) return s2;
          continue;
        }
        await sleep(100);
        continue;
      }
      seen++;
      if (d.typing) {
        await press('KeyE');
      } else if (d.choices.length) {
        const i = pick(d.choices);
        log('  choice:', d.choices[i]);
        await press(`Digit${i + 1}`);
      } else {
        await press('KeyE');
      }
      await sleep(90);
    }
  }
  const choose = (...needles) => (choices) => {
    for (const n of needles) {
      const i = choices.findIndex((c) => c.includes(n));
      if (i >= 0) return i;
    }
    return 0;
  };

  async function interact(key, pick, { dialogue = true } = {}) {
    const s = await waitFor(`prompt ${key}`, (s) => s.world.prompt?.key === key, 15000);
    await press('KeyE');
    if (dialogue) await talkThrough(pick);
    return s;
  }

  async function idle() {
    return waitFor('player free', (s) => !s.world.busy && !s.ui.dialogue && !s.ui.cutscene && !s.ui.paused, 120000);
  }

  function assert(cond, msg) {
    if (!cond) throw new Error('ASSERT: ' + msg);
    log('  ✓', msg);
  }


  return { snap, sleep, waitFor, press, screenshot, walkTo, talkThrough, choose, interact, idle, assert };
}

export async function launch(chromium, { width = 1280, height = 720 } = {}) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
  });
  return { browser, page, errors };
}
