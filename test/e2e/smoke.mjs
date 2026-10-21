// Browser smoke test: builds the app, serves it, and plays it in a phone-sized headless Chromium.
// Run with `npm run test:e2e`. Exits non-zero on any failure.
import { spawn } from 'node:child_process';
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
    server.kill();
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
  await page.waitForSelector('#game.active', { timeout: 30000 });
  await page.evaluate(installBot);
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
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL);

  // Guitar at practice speed: headless Chromium is slow, so only slowed runs are deterministic enough.
  const guitar = await playDemo(page, { speed: 60 });
  console.log('guitar @60%:', guitar.hits, '/', guitar.total);
  assert(guitar.hits / guitar.total > 0.9, 'guitar bot should hit >90%');
  assert(guitar.text.includes('Practice run'), 'slowed run is a practice run');

  const drums = await playDemo(page, { instrument: 'Drums', speed: 60, section: 'Chords' });
  console.log('drums section @60%:', drums.hits, '/', drums.total);
  assert(drums.total < 100 && drums.hits / drums.total > 0.9, 'drum section bot should hit >90%');

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
  await page.waitForSelector('#game.active', { timeout: 30000 });
  await page.evaluate(installBot);
  await page.waitForSelector('#results.active', { timeout: 120000 });
  console.log('sng song results:', (await page.locator('#resultsStats').innerText()).replace(/\n/g, ' '));

  assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
  await browser.close();
  console.log('smoke test passed');
});
