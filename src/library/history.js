// Play history for the profile screen, kept in localStorage (most recent last, capped).
const KEY = 'fretline.history';
const MAX = 200;

/** @typedef {{at: number, songId: string, name: string, track: string, score: number, stars: number,
 *   accuracy: number, maxStreak: number, meanOffsetMs: number, notes: number}} PlayEntry */

/** @returns {PlayEntry[]} */
export function listPlays() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

/** @param {PlayEntry} entry */
export function addPlay(entry) {
  const all = listPlays();
  all.push(entry);
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(-MAX)));
  } catch {
    /* storage unavailable */
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Totals for the profile screen. */
export function summarise(plays = listPlays()) {
  const n = plays.length;
  const sum = (f) => plays.reduce((a, p) => a + f(p), 0);
  return {
    plays: n,
    notesHit: sum((p) => Math.round(p.accuracy * p.notes)),
    avgAccuracy: n ? sum((p) => p.accuracy) / n : 0,
    bestStreak: plays.reduce((m, p) => Math.max(m, p.maxStreak), 0),
    fullCombos: plays.filter((p) => p.stars >= 6).length,
    avgOffsetMs: n ? sum((p) => p.meanOffsetMs) / n : 0,
  };
}
