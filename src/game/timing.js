// Timing grades: how far from the note's time a hit landed decides Perfect / Good / OK / Bad.

/** Best to worst. Every grade is a hit: it scores a share of the gem's points and keeps the streak. */
/** @type {('perfect'|'good'|'ok'|'bad')[]} */
export const GRADES = ['perfect', 'good', 'ok', 'bad'];

export const GRADE_LABELS = { perfect: 'Perfect', good: 'Good', ok: 'OK', bad: 'Bad' };

/** Share of a gem's points each grade scores. */
export const GRADE_POINTS = { perfect: 1, good: 0.75, ok: 0.5, bad: 0.25 };

/**
 * Half-width of each grade's band around the note, in ms (inclusive), for the Timing setting.
 * The Bad edge is the hit window: a tap further out than that does not judge the note at all.
 * Forgiving is the default and the widest; Normal is the window the game had before grades.
 */
export const TIMING_PRESETS = {
  forgiving: { label: 'Forgiving', bandsMs: [40, 80, 130, 200] },
  normal: { label: 'Normal', bandsMs: [20, 40, 65, 100] },
  strict: { label: 'Strict', bandsMs: [14, 28, 46, 70] },
};

export const DEFAULT_TIMING = 'forgiving';

// Offsets are differences of floats (1.04 - 1 is 0.04000000000000004), so edges get a hair of slack.
const EDGE_SLACK = 1e-9;

/** @param {string} timing a TIMING_PRESETS key; anything else gives the default */
export function timingBands(timing) {
  const preset = TIMING_PRESETS[timing] ?? TIMING_PRESETS[DEFAULT_TIMING];
  return preset.bandsMs.map((ms) => ms / 1000);
}

/**
 * @param {number} offset seconds from the note (negative = early)
 * @param {number[]} bands from timingBands()
 * @returns {'perfect'|'good'|'ok'|'bad'|null} null when outside the hit window
 */
export function gradeFor(offset, bands) {
  const d = Math.abs(offset);
  for (let i = 0; i < GRADES.length; i++) if (d <= bands[i] + EDGE_SLACK) return GRADES[i];
  return null;
}

/** True when a hit this far from the note is still inside the hit window. */
export const inWindow = (offset, bands) => Math.abs(offset) <= bands[bands.length - 1] + EDGE_SLACK;
