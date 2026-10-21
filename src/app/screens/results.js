// Results screen shown when a song ends.
import { $, reset } from '../router.js';
import { state, selectedId } from '../state.js';
import { submitScore } from '../../library/highscores.js';
import { renderStats, renderStars } from '../../ui/dom.js';
import { isPracticeRun } from './setup.js';

export function showResults(stats) {
  document.body.classList.remove('sp-active');
  const { meta } = state.selected;
  $('#resultsName').textContent =
    `${meta.name} — ${state.difficulty[0].toUpperCase()}${state.difficulty.slice(1)}`;
  renderStars($('#resultsStars'), stats.stars);
  $('#resultsScore').textContent = stats.score.toLocaleString();
  const practice = isPracticeRun();
  const record = !practice && submitScore(selectedId(), state.instrument, state.difficulty, stats);
  $('#resultsBest').textContent = practice ? 'Practice run (not recorded)' : record ? 'New record!' : '';
  renderStats($('#resultsStats'), [
    ['Notes hit', `${stats.hits} / ${stats.total}`],
    ['Accuracy', `${Math.round(stats.accuracy * 100)}%`],
    ['Best streak', stats.maxStreak],
    ['Missed', stats.misses],
  ]);
  reset(['menu', 'setup', 'results']);
}
