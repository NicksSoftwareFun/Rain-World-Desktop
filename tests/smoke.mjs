// Smoke test: loads the prototype and the wallpaper build headlessly,
// simulates a few minutes (including a rain downpour) and fails on page
// errors, non-finite creature positions or an empty ecosystem.
//
//   cd tests && npm install && npm test
//   (CHROMIUM_PATH=/path/to/chrome to use a preinstalled browser)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL ' + msg);
};

async function simulate(page, label, minutes) {
  const r = await page.evaluate((mins) => {
    const e = window.RW_APP.engine;
    e.cfg.rain.cycleMinutes = Math.max(1, mins - 0.5);
    let maxN = 0;
    let bad = 0;
    for (let i = 0; i < mins * 3600; i++) {
      e.tick(1 / 60);
      if (i % 600 === 0) {
        maxN = Math.max(maxN, e.eco.creatures.length);
        for (const c of e.eco.creatures) if (!isFinite(c.x) || !isFinite(c.y)) bad++;
      }
    }
    e.render();
    return { maxN, bad, stats: e.eco.stats, species: [...new Set(e.eco.creatures.map((c) => c.species))] };
  }, minutes);
  console.log(`${label}: peak ${r.maxN} creatures, born ${r.stats.born}, eaten ${r.stats.eaten}, sheltered/left ${r.stats.left}`);
  if (r.bad) fail(`${label}: ${r.bad} non-finite creature positions`);
  if (r.maxN < 5) fail(`${label}: ecosystem never populated`);
}

const browser = await chromium.launch(launchOpts);
try {
  // 1. Browser prototype with the mock desktop
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href + '?paused=1&seed=7&desktop=1');
    await page.waitForFunction(() => window.RW_APP);
    await simulate(page, 'prototype', 4);
    // drag a window and make sure the world follows
    const before = await page.evaluate(() => window.RW_APP.engine.world.version);
    const bar = page.locator('.win-bar').first();
    const box = await bar.boundingBox();
    await page.mouse.move(box.x + 80, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 120, { steps: 5 });
    await page.mouse.up();
    await page.evaluate(() => window.RW_APP.step(5));
    const after = await page.evaluate(() => window.RW_APP.engine.world.version);
    if (after === before) fail('prototype: dragging a window did not update the world');
    if (errors.length) fail('prototype page errors:\n  ' + errors.join('\n  '));
    await page.close();
  }

  // 1b. Touch: a tap on a creature opens its menu, a second tap closes it,
  // and a finger drag picks it up without opening it
  {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href + '?paused=1&seed=5');
    await page.waitForFunction(() => window.RW_APP);
    const at = () =>
      page.evaluate(() => {
        const e = window.RW_APP.engine;
        e.cfg.rain.enabled = false;
        // (one that's out and about, not still coming out of a pipe)
        const ok = (c) => !c.corpse && !c.leaving && !c.piping && !c.unpiping && !c.grabbedBy && c.alpha > 0.9 && c.pather;
        let c = null;
        for (let i = 0; i < 40 && !c; i++) {
          window.RW_APP.step(30);
          c = e.eco.creatures.find(ok);
        }
        window.T = c;
        const m = c.mainPoint();
        return { x: m.x * e.zoom, y: m.y * e.zoom };
      });
    const state = () =>
      page.evaluate(() => {
        window.RW_APP.step(2);
        return { open: window.RW_APP.panel.creatureMenu.c === window.T, held: window.T.grabbedBy === window.RW_APP.engine.hand };
      });
    let p = await at();
    await page.touchscreen.tap(p.x, p.y);
    if (!(await state()).open) fail('touch: tapping a creature did not open its menu');
    const m = await page.evaluate(() => {
      const c = window.T.mainPoint();
      return { x: c.x * window.RW_APP.engine.zoom, y: c.y * window.RW_APP.engine.zoom };
    });
    await page.touchscreen.tap(m.x, m.y);
    if ((await state()).open) fail('touch: a second tap did not close the menu');
    p = await at();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    for (let i = 1; i <= 6; i++) {
      await page.evaluate(() => window.RW_APP.step(1));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + i * 10, y: p.y - i * 5 }] });
    }
    const s = await state();
    if (!s.held) fail('touch: dragging a creature did not pick it up');
    if (s.open) fail('touch: dragging a creature opened its menu');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (errors.length) fail('touch page errors:\n  ' + errors.join('\n  '));
    console.log('touch: tap opens and closes the creature menu, a drag picks it up');
    await ctx.close();
  }

  // 2. Wallpaper build against the fake helper
  {
    const port = 47399;
    const helper = spawn(process.execPath, [path.join(here, 'fake-helper.mjs'), String(port)], { stdio: 'pipe' });
    await new Promise((res) => helper.stdout.once('data', res));
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // Wallpaper builds look for the helper on the page's own origin.
      await page.goto(`http://localhost:${port}/`);
      await page.waitForFunction(() => window.RW_APP && window.RW_APP.provider.connected, null, { timeout: 10000 });
      const solids = await page.evaluate(() => window.RW_APP.engine.world.dynamicSolids.length);
      if (solids < 3) fail(`wallpaper: expected helper geometry, got ${solids} rects`);
      await page.evaluate(() => window.RW_APP.engine.stop());
      await simulate(page, 'wallpaper', 2);
      if (errors.length) fail('wallpaper page errors:\n  ' + errors.join('\n  '));
    } finally {
      helper.kill();
    }
  }
} finally {
  await browser.close();
}

if (failed) process.exit(1);
console.log('smoke OK');
