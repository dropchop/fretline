// Per-song best results, kept in localStorage.
const KEY = 'fretline.scores';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

const key = (songId, instrument, difficulty) => `${songId}::${instrument}:${difficulty}`;

/** @returns {{score: number, stars: number, accuracy: number, fullCombo: boolean}|null} */
export function getHighScore(songId, instrument, difficulty) {
  return readAll()[key(songId, instrument, difficulty)] ?? null;
}

/** Best result for a song on any instrument/difficulty, for the library list. */
export function getBestForSong(songId) {
  let best = null;
  for (const [k, v] of Object.entries(readAll())) {
    if (k.startsWith(`${songId}::`) && (!best || v.score > best.score)) best = { ...v, track: k.split('::')[1] };
  }
  return best;
}

/** Saves the result if it beats the stored one. Returns true when it is a new record. */
export function submitScore(songId, instrument, difficulty, stats) {
  const all = readAll();
  const k = key(songId, instrument, difficulty);
  const prev = all[k];
  if (prev && prev.score >= stats.score) return false;
  all[k] = { score: stats.score, stars: stats.stars, accuracy: stats.accuracy, fullCombo: stats.fullCombo, at: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    return false;
  }
  return true;
}
