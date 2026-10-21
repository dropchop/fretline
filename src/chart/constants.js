export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];

export const INSTRUMENTS = {
  guitar: 'Guitar',
  bass: 'Bass',
  rhythm: 'Rhythm',
  coop: 'Guitar Co-op',
  keys: 'Keys',
};

/** Lane index used for open notes (no fret). */
export const OPEN_LANE = 7;

/**
 * @typedef {object} RawNote
 * @property {number} tick
 * @property {number} lane 0-4 for frets, OPEN_LANE for open
 * @property {number} length sustain length in ticks (0 = none)
 * @property {'toggle'|'hopo'|'strum'|null} force
 *   'toggle' flips the natural HOPO state (.chart), 'hopo'/'strum' force it (.mid)
 * @property {boolean} tap
 *
 * @typedef {object} ParsedTrack
 * @property {RawNote[]} notes
 * @property {{tick: number, length: number}[]} starPower
 * @property {{tick: number, length: number}[]} solos
 *
 * @typedef {object} ParsedSong
 * @property {'chart'|'mid'|'demo'} format
 * @property {number} resolution
 * @property {import('./tempoMap.js').TempoMap} tempoMap
 * @property {Record<string, string|number|undefined>} meta
 * @property {{tick: number, name: string}[]} sections
 * @property {Record<string, ParsedTrack>} tracks keyed "instrument:difficulty"
 * @property {number} hopoThresholdTicks
 */
