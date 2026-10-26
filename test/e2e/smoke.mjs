// Browser smoke test: builds the app, serves it, and plays it in a phone-sized headless Chromium.
// Run with `npm run test:e2e`. Exits non-zero on any failure.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, devices } from 'playwright';
import { installBot } from './bot.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, '..', 'fixtures');
const PORT = 4190;
const URL = `http://localhost:${PORT}/?debug&nosw`;

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function withServer(fn) {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    detached: true, // own process group, so the vite child under npx is stopped too
  });
  try {
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(URL);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    await fn();
  } finally {
    try {
      process.kill(-server.pid);
    } catch (err) {
      // The server is already gone; don't let that hide the failure that made the test stop.
      console.error('preview server was not running at the end:', err.code);
    }
  }
}

async function playDemo(page, { instrument = 'Guitar', speed = 100, section = null } = {}) {
  await page.tap('[data-action=play-demo]');
  await page.waitForSelector('#setup.active');
  await page.locator('#instrumentChips .chip', { hasText: instrument }).tap();
  await page.evaluate((v) => {
    const s = document.querySelector('#speed');
    s.value = v;
    s.dispatchEvent(new Event('input'));
  }, speed);
  if (section) await page.locator('#section').selectOption({ label: section });
  await page.tap('[data-action=start]');
  await page.waitForSelector('#game.active', { timeout: 120000 });
  await page.evaluate(installBot);
  // A grade word shows under the score after the first hit.
  await page.waitForFunction(
    () => /^(Perfect|Good|OK|Bad)/.test(document.querySelector('[data-hud=judge]')?.textContent ?? ''),
    null,
    { timeout: 60000 },
  );
  await page.waitForSelector('#results.active', { timeout: 240000 });
  const text = await page.locator('#results').innerText();
  const hit = text.match(/Notes hit\s+(\d+) \/ (\d+)/);
  await page.tap('[data-action=to-library]');
  return { text, hits: Number(hit[1]), total: Number(hit[2]) };
}

await withServer(async () => {
  const browser = await chromium.launch({
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    userAgent: devices['Pixel 7'].userAgent,
    deviceScaleFactor: 1,
  });
  // CI runners render slowly, so taps can land a frame late. The default Forgiving timing is the
  // widest the game offers: the test checks that input, judging and scoring work, not frame timing.
  // Chorus Encore is never contacted for real: both of its hosts are answered here, and counted.
  const enchor = { searches: [], downloads: [], other: [] };
  let holdPageTwo = false;
  let pageTwoRequested;
  const pageTwoSeen = new Promise((resolve) => {
    pageTwoRequested = resolve;
  });
  let releasePageTwo;
  const cors = { 'access-control-allow-origin': '*' };
  const searchReply = readFileSync(path.join(fixtures, 'enchor-search.json'));
  const songFile = readFileSync(path.join(fixtures, 'packed.sng'));
  await ctx.route(/^https?:\/\/[^/]*enchor\.us\//, async (route) => {
    const req = route.request();
    const url = new globalThis.URL(req.url());
    if (req.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-headers': 'content-type',
          'access-control-allow-methods': 'GET,POST',
        },
      });
    if (url.hostname === 'api.enchor.us' && url.pathname === '/search') {
      const body = req.postDataJSON();
      enchor.searches.push(body);
      if (holdPageTwo && body.page === 2) {
        holdPageTwo = false;
        pageTwoRequested(body);
        await new Promise((resolve) => {
          releasePageTwo = resolve;
        });
      }
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: cors,
        body: searchReply,
      });
    }
    if (url.hostname === 'files.enchor.us' && url.pathname.endsWith('.sng')) {
      enchor.downloads.push(url.pathname);
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: cors,
        body: songFile,
      });
    }
    enchor.other.push(req.url());
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL);

  // Guitar at practice speed: headless Chromium is slow, so only slowed runs are deterministic enough.
  const guitar = await playDemo(page, { speed: 60 });
  console.log('guitar @60%:', guitar.hits, '/', guitar.total);
  assert(guitar.hits / guitar.total > 0.85, 'guitar bot should hit >85%');
  assert(guitar.text.includes('Practice run'), 'slowed run is a practice run');
  // The results screen counts hits per grade, and the counts add up to the notes hit.
  const gradeCounts = ['Perfect', 'Good', 'OK', 'Bad'].map((g) => {
    const m = guitar.text.match(new RegExp(`${g}\\s+(\\d+)`));
    assert(m, `results show a ${g} count`);
    return Number(m[1]);
  });
  assert(
    gradeCounts.reduce((a, b) => a + b, 0) === guitar.hits,
    `grade counts ${gradeCounts} add up to the ${guitar.hits} hits`,
  );
  assert(/Early \/ late\s+\d+ \/ \d+/.test(guitar.text), 'results show early / late');

  const drums = await playDemo(page, { instrument: 'Drums', speed: 60, section: 'Chords' });
  console.log('drums section @60%:', drums.hits, '/', drums.total);
  assert(drums.total < 100 && drums.hits / drums.total > 0.85, 'drum section bot should hit >85%');

  // Find songs: search, download and add, against the mocked Chorus Encore. Nothing is sent until the player acts.
  await page.tap('[data-action=find-songs]');
  await page.waitForSelector('#find.active');
  await page.fill('#findQuery', 'te'); // too short for a typing search
  await page.waitForTimeout(1500);
  assert(enchor.searches.length === 0, 'opening Find songs and typing a short query sends no request');
  // Typing "test" and pausing searches once, with no submit.
  await page.fill('#findQuery', 'test');
  await page.waitForFunction(() => document.querySelectorAll('#findResults li').length === 3);
  assert(enchor.searches.length === 1, `one search sent by the typing pause, got ${enchor.searches.length}`);
  assert(
    JSON.stringify(enchor.searches[0]) === JSON.stringify({ search: 'test', per_page: 8, page: 1 }),
    `search body, got ${JSON.stringify(enchor.searches[0])}`,
  );
  const found = await page.locator('#find').innerText();
  assert(found.includes('Test Flight') && found.includes('Showing 3 of 143'), 'search results are listed');
  await page.tap('#findForm button[type=submit]'); // the same query again comes from the session cache
  await page.waitForTimeout(300);
  assert(enchor.searches.length === 1, 'a repeated search is answered from the cache');
  await page.waitForTimeout(1100); // the client keeps one second between requests
  await page.fill('#findQuery', 'ab'); // too short to search by typing; a submit searches at once
  await page.tap('#findForm button[type=submit]');
  await page.waitForFunction(() => /for “ab”/.test(document.querySelector('#findStatus').textContent));
  assert(enchor.searches.length === 2, `a submit sends a search, got ${enchor.searches.length}`);
  await page.waitForTimeout(1100); // the client keeps one second between requests
  const findMore = page.locator('#findMore');
  const enabledOpacity = await findMore.evaluate((button) => getComputedStyle(button).opacity);
  assert(Number(enabledOpacity) === 1, `Show more starts at full opacity, got ${enabledOpacity}`);
  const beforePageTwo = await page.locator('#findResults li').count();
  holdPageTwo = true;
  try {
    await findMore.tap();
    const requestedBody = await Promise.race([
      pageTwoSeen,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timed out waiting for page 2 request')), 5000),
      ),
    ]);
    assert(
      JSON.stringify(requestedBody) === JSON.stringify({ search: 'ab', per_page: 8, page: 2 }),
      `page 2 request body, got ${JSON.stringify(requestedBody)}`,
    );
    await page.waitForFunction(() => document.querySelector('#findMore')?.disabled === true);
    const loadingOpacity = await findMore.evaluate((button) => getComputedStyle(button).opacity);
    assert(Number(loadingOpacity) < 1, `Show more is dimmed while page 2 is held, got ${loadingOpacity}`);
    await page.screenshot({ path: path.join(here, 'last-find-loading.png') });
  } finally {
    releasePageTwo?.();
  }
  await page.waitForFunction(
    (count) => document.querySelectorAll('#findResults li').length > count,
    beforePageTwo,
  );
  assert(
    (await page.locator('#findStatus').textContent()).includes('Showing 6 of 143'),
    'page 2 updates the status',
  );
  assert(!(await findMore.isDisabled()), 'Show more is enabled again after page 2');
  assert(enchor.searches.length === 3, `page 2 adds one search request, got ${enchor.searches.length}`);
  assert(enchor.searches[2].page === 2, `third search is page 2, got ${JSON.stringify(enchor.searches[2])}`);
  await page.waitForTimeout(1100); // the client keeps one second between requests
  await page.locator('#findResults .find-add').first().tap();
  await page.waitForFunction(
    () => document.querySelector('#findResults .find-add')?.textContent === 'Added ✓',
  );
  assert(enchor.downloads.length === 1, 'one download after one tap');
  assert(/^\/[0-9a-f]{32}\.sng$/.test(enchor.downloads[0]), `download path, got ${enchor.downloads[0]}`);
  await page.tap('#find [data-action=back]');
  await page.waitForSelector('#menu.active');
  assert(
    (await page.locator('#songList').innerText()).includes('Packed Song'),
    'the downloaded song is in the library',
  );
  assert(enchor.other.length === 0, `no other requests to Chorus Encore, got ${enchor.other}`);

  await page.setInputFiles('#fileInput', [
    path.join(fixtures, 'pack.zip'),
    path.join(fixtures, 'packed.sng'),
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#songList li').length === 3, null, {
    timeout: 30000,
  });
  const library = await page.locator('#songList').innerText();
  console.log('library:', library.replace(/\n/g, ' | '));
  assert(library.includes('Packed Song') && library.includes('Midi Fixture'), 'zip and sng songs imported');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#songList li').length === 3, null, {
    timeout: 10000,
  });

  await page.locator('#songList button', { hasText: 'Packed Song' }).tap();
  await page.waitForSelector('#setup.active');
  await page.tap('[data-action=start]');
  await page.waitForSelector('#game.active', { timeout: 120000 });
  await page.evaluate(installBot);
  await page.waitForSelector('#results.active', { timeout: 120000 });
  console.log('sng song results:', (await page.locator('#resultsStats').innerText()).replace(/\n/g, ' '));

  await page.tap('[data-action=to-library]');

  // Auto-chart: the fixture is a 120 BPM tone loop.
  await page.setInputFiles('#audioInput', path.join(fixtures, 'Fixture Band - Beat Loop.ogg'));
  await page.waitForFunction(() => document.querySelectorAll('#songList li').length === 4, null, {
    timeout: 60000,
  });
  const toast = await page.locator('#toast').innerText();
  console.log('auto-chart:', toast);
  const bpm = Number(toast.match(/(\d+) BPM/)?.[1]);
  assert(Math.abs(bpm - 120) <= 2, `auto-chart tempo should be ~120 BPM, got ${bpm}`);

  // Versus (pass & play): two rounds on the demo, then a winner.
  await page.tap('[data-action=play-demo]');
  await page.waitForSelector('#setup.active');
  await page.locator('#instrumentChips .chip', { hasText: 'Guitar' }).tap();
  await page.locator('#section').selectOption({ label: 'Melody' });
  await page.check('#versus');
  await page.tap('[data-action=start]');
  await page.waitForSelector('#game.active', { timeout: 120000 });
  await page.evaluate(installBot);
  await page.waitForSelector('#results.active', { timeout: 120000 });
  assert((await page.locator('#resultsPlayer').textContent()) === 'Player 1', 'round 1 is player 1');
  await page.tap('#nextPlayer');
  await page.waitForSelector('#game.active', { timeout: 120000 });
  await page.evaluate(installBot, { skipEvery: 2 });
  await page.waitForSelector('#results.active', { timeout: 120000 });
  const versus = await page.locator('#resultsPlayer').textContent();
  console.log('versus:', versus, '|', await page.locator('#resultsBest').innerText());
  assert(versus.includes('Player 1 wins'), 'player 1 (full bot) beats player 2 (half the notes)');
  assert((await page.locator('#resultsTiming svg').count()) === 1, 'timing histogram rendered');
  await page.tap('[data-action=to-library]');

  // Profile shows the recorded plays.
  await page.tap('[data-action=profile]');
  await page.waitForSelector('#profile.active');
  const profile = await page.locator('#profileStats').innerText();
  console.log('profile:', profile.replace(/\n/g, ' '));
  assert(/Songs played\s+[1-9]/.test(profile), 'profile counts recorded plays');
  await page.screenshot({ path: 'test/e2e/last-profile.png' });
  await page.tap('#profile [data-action=back]');

  // Tiles touch zones, with real pointer events: no bot, a spy on the engine records what each tap means.
  await page.tap('[data-action=play-demo]');
  await page.waitForSelector('#setup.active');
  await page.locator('#instrumentChips .chip', { hasText: 'Guitar' }).tap();
  await page.tap('[data-action=start]');
  await page.waitForSelector('#game.active', { timeout: 120000 });
  const taps = await page.evaluate(async () => {
    const state = window.fretline;
    const layout = state.renderer.laneScreenPositions();
    const log = [];
    const engine = state.session.engine;
    engine.fretDown = (lane) => log.push(`fret${lane}`);
    engine.openDown = () => log.push('open');
    const surface = document.querySelector('#touchSurface');
    let id = 5000;
    const box = surface.getBoundingClientRect();
    const tap = (x, y) => {
      const pid = id++;
      for (const type of ['pointerdown', 'pointerup'])
        surface.dispatchEvent(
          new PointerEvent(type, {
            pointerId: pid,
            clientX: x + box.left,
            clientY: y + box.top,
            bubbles: true,
            pointerType: 'touch',
          }),
        );
    };
    // Lane 3, high up the highway (where it is drawn at the far row), well above the strikeline.
    tap(layout.far.lanes[3], layout.far.y);
    // Lane 0 halfway between the far row and the strikeline.
    tap((layout.lanes[0] + layout.far.lanes[0]) / 2, (layout.strikeY + layout.far.y) / 2);
    // The open bar, in the corner where no lane column is drawn.
    tap(4, layout.openY + 6);
    // Lane 4 at the very top of the highway: nothing from the HUD may sit over it and take the touch.
    const topY = 4;
    const k = (topY - layout.strikeY) / (layout.far.y - layout.strikeY);
    const topX = layout.lanes[4] + (layout.far.lanes[4] - layout.lanes[4]) * k;
    const topHit = document.elementFromPoint(topX + box.left, topY + box.top);
    tap(topX, topY);
    const controls = [...document.querySelectorAll('.pause-button, .sp-button')];
    const hudClear = controls.every((b) => b.getBoundingClientRect().bottom <= box.top + 0.5);
    // Left-handed: the far row has to be mirrored with the strikeline row, or the columns would cross.
    state.renderer.leftHanded = true;
    const left = state.renderer.laneScreenPositions();
    state.renderer.leftHanded = false;
    const mid = left.lanes[2];
    const leftMirrored =
      left.lanes[0] > left.lanes[4] &&
      left.lanes.every((x, i) => Math.sign(x - mid) === Math.sign(left.far.lanes[i] - mid));
    return {
      log,
      topHitIsSurface: topHit === surface,
      hudClear,
      leftMirrored,
      tiles: layout.tiles,
      farY: layout.far.y,
      strikeY: layout.strikeY,
    };
  });
  console.log('tile taps:', JSON.stringify(taps));
  assert(
    taps.tiles && taps.strikeY - taps.farY > 200 && taps.farY > 0,
    'tiles layout with a far row well above the strikeline, on screen',
  );
  assert(
    taps.log.join() === 'fret3,fret0,open,fret4',
    `lane-column taps and the open bar register, got ${taps.log}`,
  );
  assert(taps.topHitIsSurface, 'the top of lane 4 is the touch surface, not a HUD button');
  assert(taps.hudClear, 'the pause and star power buttons sit above the touch surface');
  assert(taps.leftMirrored, 'left-handed mode mirrors the far lane row with the strikeline row');
  await page.reload();

  assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
  await browser.close();
  console.log('smoke test passed');
});
