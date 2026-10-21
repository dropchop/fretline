// Game screen: starting, pausing, restarting and quitting a play-through.
import { $, loading, toast, show, reset, registerActions } from '../router.js';
import { state, settings } from '../state.js';
import { HighwayRenderer } from '../../render/highway.js';
import { GameSession } from '../../game/session.js';
import { Hud } from '../../ui/hud.js';
import { getAudioContext } from '../../audio/player.js';
import { audioStems } from '../../library/loader.js';
import { renderDemoAudio } from '../../demo/demoSong.js';
import { saveSettings } from '../../settings.js';
import { selectedRange, selectedSpeed } from './setup.js';
import { showResults } from './results.js';

function ensureRenderer() {
  if (!state.renderer) {
    state.renderer = new HighwayRenderer($('#stage'));
    state.hud = new Hud($('#game'));
  }
  return state.renderer;
}

export function resizeStage() {
  if (!state.renderer) return;
  const canvas = $('#stage');
  state.renderer.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
}

export async function startGame() {
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
      speed: selectedSpeed(),
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
  reset(['menu', 'setup']);
}

export function initPlay() {
  window.addEventListener('resize', resizeStage);
  window.addEventListener('orientationchange', () => setTimeout(resizeStage, 200));
  registerActions({
    start: startGame,
    pause: pauseGame,
    resume: resumeGame,
    restart: restartGame,
    quit: quitGame,
    retry: () => {
      show('setup', { push: false });
      startGame();
    },
  });
}
