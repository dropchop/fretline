// Results screen shown when a song ends.
import { $, reset } from '../router.js';
import { state, selectedId } from '../state.js';
import { submitScore } from '../../library/highscores.js';
import { addPlay } from '../../library/history.js';
import { renderStats, renderStars } from '../../ui/dom.js';
import { timingHistogram } from '../../ui/charts.js';
import { isPracticeRun } from './setup.js';

function timingNote(stats) {
  if (!stats.offsets.length) return '';
  const mean = Math.round(stats.meanOffsetMs);
  if (Math.abs(mean) < 10) return 'Your timing is centred. Nice.';
  const dir = mean < 0 ? 'early' : 'late';
  const fix = mean < 0 ? 'lower' : 'raise';
  return `You hit ${Math.abs(mean)} ms ${dir} on average. If it feels off, ${fix} the audio calibration in Settings.`;
}

export function showResults(stats) {
  document.body.classList.remove('sp-active');
  const { meta } = state.selected;
  const trackLabel = `${state.difficulty[0].toUpperCase()}${state.difficulty.slice(1)}`;
  $('#resultsName').textContent = `${meta.name} — ${trackLabel}`;
  renderStars($('#resultsStars'), stats.stars);
  $('#resultsScore').textContent = stats.score.toLocaleString();

  const versus = state.versus;
  const practice = isPracticeRun();
  let note;
  if (versus) {
    if (versus.round === 1) {
      versus.first = stats;
      $('#resultsPlayer').textContent = 'Player 1';
      note = 'Hand the phone over for player 2.';
    } else {
      const p1 = versus.first;
      const winner =
        p1.score === stats.score ? 'A tie!' : p1.score > stats.score ? 'Player 1 wins!' : 'Player 2 wins!';
      $('#resultsPlayer').textContent = `Player 2 · ${winner}`;
      note = `Player 1: ${p1.score.toLocaleString()} (${Math.round(p1.accuracy * 100)}%) · Player 2: ${stats.score.toLocaleString()} (${Math.round(stats.accuracy * 100)}%)`;
    }
  } else {
    $('#resultsPlayer').textContent = '';
    const record = !practice && submitScore(selectedId(), state.instrument, state.difficulty, stats);
    note = practice ? 'Practice run (not recorded)' : record ? 'New record!' : '';
    if (!practice) {
      addPlay({
        at: Date.now(),
        songId: selectedId(),
        name: meta.name,
        track: `${state.instrument}:${state.difficulty}`,
        score: stats.score,
        stars: stats.stars,
        accuracy: stats.accuracy,
        maxStreak: stats.maxStreak,
        meanOffsetMs: stats.meanOffsetMs,
        notes: stats.total,
      });
    }
  }
  $('#resultsBest').textContent = note;

  renderStats($('#resultsStats'), [
    ['Notes hit', `${stats.hits} / ${stats.total}`],
    ['Accuracy', `${Math.round(stats.accuracy * 100)}%`],
    ['Best streak', stats.maxStreak],
    ['Missed', stats.misses],
    ['Early / late', `${stats.early} / ${stats.late}`],
    ['Avg timing', `${stats.meanOffsetMs > 0 ? '+' : ''}${Math.round(stats.meanOffsetMs)} ms`],
  ]);
  $('#resultsTiming').replaceChildren(timingHistogram(stats.offsets));
  $('#resultsTimingNote').textContent = timingNote(stats);

  const nextTurn = !!versus && versus.round === 1;
  $('#nextPlayer').hidden = !nextTurn;
  $('#retryButton').hidden = nextTurn;
  if (versus) versus.round = 2;
  if (versus && !nextTurn) state.versus = null;
  reset(['menu', 'setup', 'results']);
}
