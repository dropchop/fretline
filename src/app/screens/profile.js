// Profile: lifetime totals and recent play history.
import { $, show, registerActions } from '../router.js';
import { listPlays, summarise, clearHistory } from '../../library/history.js';
import { renderStats } from '../../ui/dom.js';
import { sparkline } from '../../ui/charts.js';

const TRACK_LABEL = (track) => {
  const [inst, diff] = track.split(':');
  return `${inst[0].toUpperCase()}${inst.slice(1)} · ${diff[0].toUpperCase()}${diff.slice(1)}`;
};

function formatWhen(at) {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
}

export function renderProfile() {
  const plays = listPlays();
  const s = summarise(plays);
  renderStats($('#profileStats'), [
    ['Songs played', s.plays],
    ['Notes hit', s.notesHit.toLocaleString()],
    ['Avg accuracy', `${Math.round(s.avgAccuracy * 100)}%`],
    ['Best streak', s.bestStreak],
    ['Full combos', s.fullCombos],
    ['Avg timing', `${s.avgOffsetMs > 0 ? '+' : ''}${Math.round(s.avgOffsetMs)} ms`],
  ]);
  $('#profileSpark').replaceChildren(sparkline(plays.slice(-30).map((p) => p.accuracy)));
  const list = $('#profileHistory');
  list.replaceChildren();
  for (const p of plays.slice(-10).reverse()) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = `${p.name} · ${TRACK_LABEL(p.track)} · ${p.score.toLocaleString()} (${Math.round(p.accuracy * 100)}%)`;
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = formatWhen(p.at);
    li.append(left, when);
    list.append(li);
  }
  $('#profileEmpty').hidden = plays.length > 0;
}

export function initProfile() {
  registerActions({
    profile: () => {
      renderProfile();
      show('profile');
    },
    'clear-history': () => {
      if (!confirm('Clear your play history on this device?')) return;
      clearHistory();
      renderProfile();
    },
  });
}
