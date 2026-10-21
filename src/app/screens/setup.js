// Song screen: instrument, difficulty, practice options and best score.
import { $, loading, toast, show } from '../router.js';
import { state, settings, selectedId } from '../state.js';
import { availableTracks } from '../../chart/playable.js';
import { DIFFICULTIES, INSTRUMENTS } from '../../chart/constants.js';
import { readPackage, albumArt } from '../../library/loader.js';
import { getHighScore } from '../../library/highscores.js';
import { buildDemoSong } from '../../demo/demoSong.js';
import { renderChips } from '../../ui/dom.js';

export async function openSong(pkg) {
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

export function openDemo() {
  const demo = buildDemoSong();
  selectSong({ demo: true, chart: demo, meta: demo.meta, art: null });
}

export function selectSong(selection) {
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
    toast('This chart has no 5-fret guitar, bass, rhythm, keys or drum parts.');
    return;
  }
  state.instrument = instruments.includes(settings.instrument) ? settings.instrument : instruments[0];
  renderChips(
    $('#instrumentChips'),
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

export function selectedRange() {
  const v = $('#section').value;
  return v ? JSON.parse(v) : null;
}

export function selectedSpeed() {
  return Number($('#speed').value) / 100;
}

export function isPracticeRun() {
  return selectedSpeed() < 1 || !!selectedRange();
}

export function renderBest() {
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
    $('#difficultyChips'),
    diffs.map((d) => [d, d[0].toUpperCase() + d.slice(1)]),
    () => state.difficulty,
    (v) => {
      state.difficulty = v;
      renderBest();
    },
  );
  renderBest();
}

export function initSetup() {
  $('#speed').addEventListener('input', () => ($('#speedOut').textContent = `${$('#speed').value}%`));
}
