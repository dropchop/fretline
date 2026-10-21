import './style.css';
import { HighwayRenderer } from './render/highway.js';
import { GameSession } from './game/session.js';
import { Hud } from './ui/hud.js';
import { getAudioContext } from './audio/player.js';
import { availableTracks } from './chart/playable.js';
import { DIFFICULTIES, INSTRUMENTS } from './chart/constants.js';
import { importFiles, readPackage, audioStems, albumArt } from './library/loader.js';
import { listSongs, saveSong, deleteSong, requestPersistentStorage } from './library/store.js';
import { buildDemoSong, renderDemoAudio } from './demo/demoSong.js';
import { loadSettings, saveSettings } from './settings.js';
import { getHighScore, getBestForSong, submitScore } from './library/highscores.js';
import { GamepadControls, DEFAULT_GAMEPAD_MAP } from './input/gamepad.js';

const DEMO_ID = 'demo::neon-highway';
const selectedId = () => (state.selected?.demo ? DEMO_ID : state.selected?.pkg?.id);

const $ = (sel) => document.querySelector(sel);
const settings = loadSettings();

const state = {
  library: [],
  /** @type {{pkg?: object, demo?: boolean, chart: object, meta: object}|null} */
  selected: null,
  instrument: null,
  difficulty: null,
  session: null,
  renderer: null,
  hud: null,
  demoStems: null,
  history: ['menu'],
  artUrls: [],
};

// ---- Navigation -------------------------------------------------------------------------

function show(id, { push = true } = {}) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (push && state.history[state.history.length - 1] !== id) state.history.push(id);
}

function back() {
  state.history.pop();
  show(state.history[state.history.length - 1] ?? 'menu', { push: false });
}

function loading(text) {
  $('#loading').hidden = !text;
  if (text) $('#loadingText').textContent = text;
}

let toastTimer;
function toast(text, ms = 4000) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---- Library ----------------------------------------------------------------------------

async function refreshLibrary() {
  try {
    state.library = await listSongs();
  } catch {
    state.library = [];
  }
  renderLibrary();
}

function renderLibrary() {
  state.artUrls.forEach((u) => URL.revokeObjectURL(u));
  state.artUrls = [];
  const q = $('#search').value.trim().toLowerCase();
  const list = $('#songList');
  list.replaceChildren();
  const songs = state.library.filter((s) => `${s.meta.name} ${s.meta.artist}`.toLowerCase().includes(q));
  for (const song of songs) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    const art = albumArt(song.files);
    if (art) {
      const url = URL.createObjectURL(art);
      state.artUrls.push(url);
      thumb.style.backgroundImage = `url("${url}")`;
    }
    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = song.meta.name;
    const artist = document.createElement('span');
    artist.className = 'artist';
    artist.textContent = song.meta.artist;
    text.append(title, artist);
    const best = getBestForSong(song.id);
    if (best) {
      const b = document.createElement('span');
      b.className = 'best';
      b.textContent = `${'★'.repeat(Math.min(5, best.stars))}${best.fullCombo ? ' FC' : ''} ${best.score.toLocaleString()}`;
      text.append(b);
    }
    btn.append(thumb, text);
    btn.addEventListener('click', () => openSong(song));
    li.append(btn);
    list.append(li);
  }
  $('#emptyLibrary').hidden = state.library.length > 0;
}

async function handleImport(fileList) {
  if (!fileList?.length) return;
  loading('Importing songs…');
  try {
    const { songs, errors } = await importFiles(fileList);
    let saved = 0;
    for (const pkg of songs) {
      try {
        await saveSong(pkg);
        saved++;
      } catch (err) {
        errors.push(`${pkg.meta.name}: couldn't save (${err?.message || 'storage error'})`);
      }
    }
    if (saved) requestPersistentStorage();
    await refreshLibrary();
    const lines = [];
    if (saved) lines.push(`Added ${saved} song${saved === 1 ? '' : 's'}.`);
    lines.push(...errors.slice(0, 4));
    if (errors.length > 4) lines.push(`…and ${errors.length - 4} more problems.`);
    toast(lines.join('\n'), errors.length ? 8000 : 3000);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  } finally {
    loading(null);
  }
}

// ---- Song setup -------------------------------------------------------------------------

async function openSong(pkg) {
  loading('Reading chart…');
  try {
    const chart = await readPackage(pkg.files);
    selectSong({ pkg, chart, meta: pkg.meta, art: albumArt(pkg.files) });
  } catch (err) {
    toast(`Couldn't read this chart: ${err.message}`);
  } finally {
    loading(null);
  }
}

function openDemo() {
  const demo = buildDemoSong();
  selectSong({ demo: true, chart: demo, meta: demo.meta, art: null });
}

function selectSong(selection) {
  state.selected = selection;
  const { meta } = selection;
  $('#setupName').textContent = meta.name;
  $('#setupArtist').textContent = [meta.artist, meta.album, meta.year].filter(Boolean).join(' · ');
  $('#setupCharter').textContent = meta.charter ? `Charted by ${meta.charter}` : '';
  const art = $('#setupArt');
  if (state.setupArtUrl) URL.revokeObjectURL(state.setupArtUrl);
  state.setupArtUrl = selection.art ? URL.createObjectURL(selection.art) : null;
  art.style.backgroundImage = state.setupArtUrl ? `url("${state.setupArtUrl}")` : '';
  $('#deleteSong').hidden = !!selection.demo;

  renderSections(selection.chart);
  const tracks = availableTracks(selection.chart.song);
  const instruments = Object.keys(INSTRUMENTS).filter((i) => tracks[i]);
  if (!instruments.length) {
    toast('This chart has no 5-fret guitar, bass, rhythm or keys parts.');
    return;
  }
  state.instrument = instruments.includes(settings.instrument) ? settings.instrument : instruments[0];
  renderChips(
    '#instrumentChips',
    instruments.map((i) => [i, INSTRUMENTS[i]]),
    () => state.instrument,
    (v) => {
      state.instrument = v;
      renderDifficulties(tracks);
    },
  );
  renderDifficulties(tracks);
  show('setup');
}

// Section practice options come from the chart's section markers.
function renderSections(chart) {
  const select = $('#section');
  select.replaceChildren(new Option('Whole song', ''));
  const { sections, tempoMap } = chart.song;
  const offset = (chart.offsetMs || 0) / 1000;
  sections.forEach((s, i) => {
    const start = tempoMap.tickToTime(s.tick) + offset;
    const end = i + 1 < sections.length ? tempoMap.tickToTime(sections[i + 1].tick) + offset : Infinity;
    select.append(new Option(s.name, JSON.stringify({ start, end })));
  });
  $('#sectionField').hidden = sections.length === 0;
}

function selectedRange() {
  const v = $('#section').value;
  return v ? JSON.parse(v) : null;
}

function isPracticeRun() {
  return Number($('#speed').value) < 100 || !!selectedRange();
}

function renderBest() {
  const best = getHighScore(selectedId(), state.instrument, state.difficulty);
  $('#setupBest').textContent = best
    ? `Best: ${best.score.toLocaleString()} · ${'★'.repeat(Math.min(5, best.stars))}${best.fullCombo ? ' Full combo' : ''} · ${Math.round(best.accuracy * 100)}%`
    : 'Not played yet';
}

function renderDifficulties(tracks) {
  const diffs = DIFFICULTIES.filter((d) => tracks[state.instrument].includes(d));
  if (!diffs.includes(state.difficulty)) {
    state.difficulty = diffs.includes(settings.difficulty) ? settings.difficulty : diffs[diffs.length - 1];
  }
  renderChips(
    '#difficultyChips',
    diffs.map((d) => [d, d[0].toUpperCase() + d.slice(1)]),
    () => state.difficulty,
    (v) => {
      state.difficulty = v;
      renderBest();
    },
  );
  renderBest();
}

function renderChips(sel, options, get, set) {
  const box = $(sel);
  box.replaceChildren();
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(get() === value));
    b.addEventListener('click', () => {
      set(value);
      box.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
    });
    box.append(b);
  }
}

// ---- Playing ----------------------------------------------------------------------------

function ensureRenderer() {
  if (!state.renderer) {
    state.renderer = new HighwayRenderer($('#stage'));
    state.hud = new Hud($('#game'));
  }
  return state.renderer;
}

function resizeStage() {
  if (!state.renderer) return;
  const canvas = $('#stage');
  state.renderer.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
}

async function startGame() {
  const sel = state.selected;
  if (!sel) return;
  // Create/resume audio inside the tap that started the game (required on mobile).
  getAudioContext();
  settings.instrument = state.instrument;
  settings.difficulty = state.difficulty;
  saveSettings(settings);

  loading('Loading audio…');
  state.session?.dispose();
  state.session = null;
  try {
    let stems;
    if (sel.demo) {
      state.demoStems ??= await renderDemoAudio(sel.chart);
      stems = state.demoStems;
    } else {
      stems = await Promise.all(
        audioStems(sel.pkg.files).map(async ({ name, blob }) => ({ name, data: await blob.arrayBuffer() })),
      );
    }
    const renderer = ensureRenderer();
    const session = new GameSession({
      chart: sel.chart,
      stems,
      instrument: state.instrument,
      difficulty: state.difficulty,
      settings,
      renderer,
      hud: state.hud,
      speed: Number($('#speed').value) / 100,
      range: selectedRange(),
      surface: $('#touchSurface'),
      onFinish: showResults,
      onPauseRequest: pauseGame,
    });
    const failed = await session.load();
    if (failed.length) toast(`Couldn't decode: ${failed.join(', ')}. Playing without them.`);
    state.session = session;
    $('#pauseMenu').hidden = true;
    show('game');
    resizeStage();
    session.start();
  } catch (err) {
    toast(err.message || String(err), 7000);
  } finally {
    loading(null);
  }
}

async function pauseGame() {
  if (!state.session) return;
  await state.session.pause();
  $('#pauseMenu').hidden = false;
}

async function resumeGame() {
  $('#pauseMenu').hidden = true;
  await state.session?.resume();
}

function restartGame() {
  $('#pauseMenu').hidden = true;
  getAudioContext();
  state.session?.restart();
}

function quitGame() {
  state.session?.dispose();
  state.session = null;
  $('#pauseMenu').hidden = true;
  document.body.classList.remove('sp-active');
  show('setup', { push: false });
  state.history = ['menu', 'setup'];
}

function showResults(stats) {
  document.body.classList.remove('sp-active');
  const { meta } = state.selected;
  $('#resultsName').textContent = `${meta.name} — ${state.difficulty[0].toUpperCase()}${state.difficulty.slice(1)}`;
  const stars = $('#resultsStars');
  stars.replaceChildren();
  const gold = stats.stars >= 6;
  for (let i = 0; i < 5; i++) {
    const s = document.createElement('span');
    s.textContent = '★';
    if (gold) s.className = 'gold';
    else if (i >= stats.stars) s.className = 'off';
    stars.append(s);
  }
  $('#resultsScore').textContent = stats.score.toLocaleString();
  const practice = isPracticeRun();
  const record = !practice && submitScore(selectedId(), state.instrument, state.difficulty, stats);
  $('#resultsBest').textContent = practice ? 'Practice run (not recorded)' : record ? 'New record!' : '';
  const rows = [
    ['Notes hit', `${stats.hits} / ${stats.total}`],
    ['Accuracy', `${Math.round(stats.accuracy * 100)}%`],
    ['Best streak', stats.maxStreak],
    ['Missed', stats.misses],
  ];
  const dl = $('#resultsStats');
  dl.replaceChildren();
  for (const [k, v] of rows) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    div.append(dt, dd);
    dl.append(div);
  }
  show('results', { push: false });
  state.history = ['menu', 'setup', 'results'];
}

// ---- Settings ---------------------------------------------------------------------------

function bindSettings() {
  const range = (id, key, format) => {
    const input = $(`#${id}`);
    const out = $(`#${id}Out`);
    input.value = settings[key];
    out.textContent = format(settings[key]);
    input.addEventListener('input', () => {
      settings[key] = Number(input.value);
      out.textContent = format(settings[key]);
      saveSettings(settings);
    });
  };
  range('noteSpeed', 'noteSpeed', (v) => `${Number(v).toFixed(2)}x`);
  range('calibration', 'calibrationMs', (v) => `${v} ms`);
  range('hitWindow', 'hitWindowMs', (v) => `±${v} ms`);
  range('volume', 'volume', (v) => `${Math.round(v * 100)}%`);
  for (const key of ['leftHanded', 'muteOnMiss']) {
    const input = $(`#${key}`);
    input.checked = settings[key];
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      saveSettings(settings);
    });
  }
  const mode = $('#inputMode');
  mode.value = settings.inputMode;
  mode.addEventListener('change', () => {
    settings.inputMode = mode.value;
    saveSettings(settings);
  });
}

function syncSettingsForm() {
  $('#calibration').value = settings.calibrationMs;
  $('#calibrationOut').textContent = `${settings.calibrationMs} ms`;
}

// ---- Calibration ------------------------------------------------------------------------

const calibration = { clicks: [], taps: [], timer: null };

function startCalibration() {
  const ctx = getAudioContext();
  const interval = 0.5;
  const start = ctx.currentTime + 0.6;
  calibration.clicks = [];
  calibration.taps = [];
  for (let i = 0; i < 24; i++) {
    const t = start + i * interval;
    calibration.clicks.push(t);
    const osc = ctx.createOscillator();
    osc.frequency.value = i % 4 === 0 ? 1500 : 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }
  $('#calibrateResult').textContent = 'Listen for the clicks and tap along…';
  clearTimeout(calibration.timer);
  calibration.timer = setTimeout(finishCalibration, (0.6 + 24 * interval + 0.5) * 1000);
  show('calibrate');
}

function calibrationTap(e) {
  const ctx = getAudioContext();
  calibration.taps.push(ctx.currentTime - Math.max(0, performance.now() - e.timeStamp) / 1000);
  const pad = $('#tapPad');
  pad.classList.add('pulse');
  setTimeout(() => pad.classList.remove('pulse'), 80);
}

function finishCalibration() {
  const ctx = getAudioContext();
  const { clicks, taps } = calibration;
  // Ignore the first few clicks while the player locks in.
  const diffs = taps
    .map((tap) => {
      const nearest = clicks.reduce((best, c) => (Math.abs(c - tap) < Math.abs(best - tap) ? c : best));
      return { tap, d: tap - nearest, i: clicks.indexOf(nearest) };
    })
    .filter((x) => x.i >= 4 && Math.abs(x.d) < 0.25)
    .map((x) => x.d)
    .sort((a, b) => a - b);
  if (diffs.length < 8) {
    $('#calibrateResult').textContent = 'Not enough taps in time with the clicks. Try again from Settings.';
    return;
  }
  const median = diffs[Math.floor(diffs.length / 2)];
  const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  const ms = Math.round(((median - latency) * 1000) / 5) * 5;
  settings.calibrationMs = Math.max(-200, Math.min(400, ms));
  saveSettings(settings);
  syncSettingsForm();
  $('#calibrateResult').textContent = `Calibration set to ${settings.calibrationMs} ms.`;
}

// ---- Controller mapping -----------------------------------------------------------------

const MAP_STEPS = [
  ['frets', 0, 'Green fret'], ['frets', 1, 'Red fret'], ['frets', 2, 'Yellow fret'],
  ['frets', 3, 'Blue fret'], ['frets', 4, 'Orange fret'],
  ['strum', 0, 'Strum down'], ['strum', 1, 'Strum up'], ['starPower', 0, 'Star Power'], ['pause', 0, 'Pause'],
];
let mapAbort = null;

function describeMap(map) {
  return `Frets: ${map.frets.join(', ')} · Strum: ${map.strum.join(', ')} · Star Power: ${map.starPower.join(', ')} · Pause: ${map.pause.join(', ')} (button numbers)`;
}

async function startControllerMapping() {
  show('controller');
  mapAbort?.abort();
  mapAbort = new AbortController();
  const { signal } = mapAbort;
  $('#controllerMap').textContent = describeMap(settings.gamepadMap ?? DEFAULT_GAMEPAD_MAP);
  $('#controllerStatus').textContent = 'Connect a gamepad or guitar controller and press any button.';
  $('#controllerPrompt').textContent = '';
  if ((await GamepadControls.nextPress(signal)) === null) return;
  $('#controllerStatus').textContent = 'Controller found. Press each button as asked.';
  const map = { frets: [], strum: [], starPower: [], pause: [] };
  for (const [group, , label] of MAP_STEPS) {
    $('#controllerPrompt').textContent = `Press: ${label}`;
    const button = await GamepadControls.nextPress(signal);
    if (button === null) return;
    map[group].push(button);
    await new Promise((r) => setTimeout(r, 250)); // let the button release
  }
  settings.gamepadMap = map;
  saveSettings(settings);
  $('#controllerPrompt').textContent = 'Saved!';
  $('#controllerMap').textContent = describeMap(map);
}

// ---- Wiring -----------------------------------------------------------------------------

const actions = {
  'play-demo': openDemo,
  settings: () => show('settings'),
  back: () => {
    clearTimeout(calibration.timer);
    mapAbort?.abort();
    back();
  },
  start: startGame,
  'delete-song': async () => {
    const pkg = state.selected?.pkg;
    if (!pkg || !confirm(`Remove "${pkg.meta.name}" from this device?`)) return;
    await deleteSong(pkg.id);
    await refreshLibrary();
    state.history = ['menu'];
    show('menu', { push: false });
  },
  pause: pauseGame,
  resume: resumeGame,
  restart: restartGame,
  quit: quitGame,
  retry: () => {
    show('setup', { push: false });
    startGame();
  },
  'to-library': () => {
    state.history = ['menu'];
    show('menu', { push: false });
  },
  calibrate: startCalibration,
  'map-controller': startControllerMapping,
  'reset-controller': () => {
    mapAbort?.abort();
    settings.gamepadMap = null;
    saveSettings(settings);
    $('#controllerMap').textContent = describeMap(DEFAULT_GAMEPAD_MAP);
    $('#controllerPrompt').textContent = 'Default layout restored.';
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action]();
});

$('#fileInput').addEventListener('change', (e) => {
  handleImport([...e.target.files]);
  e.target.value = '';
});
$('#folderInput').addEventListener('change', (e) => {
  handleImport([...e.target.files]);
  e.target.value = '';
});
// iOS can't pick folders; hide the option there.
if (/iPad|iPhone|iPod/.test(navigator.userAgent)) $('#folderButton').hidden = true;
$('#search').addEventListener('input', renderLibrary);
$('#tapPad').addEventListener('pointerdown', calibrationTap);

window.addEventListener('resize', resizeStage);
window.addEventListener('orientationchange', () => setTimeout(resizeStage, 200));

bindSettings();
refreshLibrary();
$('#speed').addEventListener('input', () => ($('#speedOut').textContent = `${$('#speed').value}%`));
// Offline support: cache the app shell after the first visit.
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Test hook: ?debug exposes app state for automated browser tests.
if (new URLSearchParams(location.search).has('debug')) window.fretline = state;
