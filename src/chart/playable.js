// Turns parsed chart data into the list of timed, gameplay-ready notes for one track.
import { OPEN_LANE } from './constants.js';

/**
 * @typedef {object} PlayNote
 * @property {number} id index in the note list
 * @property {number} tick
 * @property {number} time seconds from audio start
 * @property {number} endTime end of sustain in seconds (== time when not a sustain)
 * @property {number[]} lanes fret lanes 0-4; empty for an open note
 * @property {number} mask bitmask of lanes
 * @property {boolean} open
 * @property {boolean} hopo can be hit by fretting alone (after a hit note)
 * @property {boolean} tap can be hit by fretting alone at any time
 * @property {boolean} sustain
 * @property {number} sustainBeats sustain length in beats, for scoring
 * @property {number} spPhrase index of the star power phrase containing it, or -1
 * @property {boolean} spEnd last note of its star power phrase
 * @property {boolean} solo
 */

/**
 * @param {import('./constants.js').ParsedSong} song
 * @param {string} trackKey "instrument:difficulty"
 * @param {{offsetMs?: number, hopoThresholdTicks?: number}} [options]
 *   offsetMs shifts every note later by that many milliseconds.
 * @returns {PlayNote[]}
 */
export function buildPlayableNotes(song, trackKey, options = {}) {
  const track = song.tracks[trackKey];
  if (!track) throw new Error(`Chart has no ${trackKey} track`);
  const offset = (options.offsetMs ?? 0) / 1000;
  const threshold = options.hopoThresholdTicks ?? song.hopoThresholdTicks;
  const { tempoMap, resolution } = song;

  // Group gems that share a tick into chords.
  const groups = [];
  for (const raw of track.notes) {
    let g = groups[groups.length - 1];
    if (!g || g.tick !== raw.tick) {
      g = { tick: raw.tick, lanes: new Set(), open: false, length: 0, force: null, tap: false };
      groups.push(g);
    }
    if (raw.lane === OPEN_LANE) g.open = true;
    else g.lanes.add(raw.lane);
    // Chords are treated as one unit: the longest gem sets the sustain.
    g.length = Math.max(g.length, raw.length);
    g.force = g.force ?? raw.force;
    g.tap = g.tap || raw.tap;
  }

  const notes = [];
  let prev = null;
  for (const g of groups) {
    const lanes = [...g.lanes].sort((a, b) => a - b);
    const open = lanes.length === 0 && g.open;
    const mask = lanes.reduce((m, l) => m | (1 << l), 0);

    let natural = false;
    if (prev && lanes.length <= 1 && g.tick - prev.tick <= threshold) {
      const sameAsPrev = mask === prev.mask && open === prev.open;
      // A single gem that was part of the previous chord is not a natural HOPO.
      const insidePrevChord = prev.lanes.length > 1 && (mask & prev.mask) === mask && !open;
      natural = !sameAsPrev && !insidePrevChord;
    }
    let hopo = natural;
    if (g.force === 'toggle') hopo = !natural;
    else if (g.force === 'hopo') hopo = true;
    else if (g.force === 'strum') hopo = false;
    if (!prev && g.force !== 'hopo' && g.force !== 'toggle') hopo = false;

    const time = tempoMap.tickToTime(g.tick) + offset;
    const sustain = g.length > 0;
    const note = {
      id: notes.length,
      tick: g.tick,
      time,
      endTime: sustain ? tempoMap.tickToTime(g.tick + g.length) + offset : time,
      lanes,
      mask,
      open,
      hopo: hopo && !g.tap,
      tap: g.tap,
      sustain,
      sustainBeats: g.length / resolution,
      spPhrase: -1,
      spEnd: false,
      solo: false,
    };
    notes.push(note);
    prev = note;
  }

  track.starPower.forEach((phrase, index) => {
    let last = null;
    for (const n of notes) {
      if (n.tick >= phrase.tick && n.tick < phrase.tick + phrase.length) {
        n.spPhrase = index;
        last = n;
      }
    }
    if (last) last.spEnd = true;
  });
  for (const solo of track.solos) {
    for (const n of notes) {
      if (n.tick >= solo.tick && n.tick < solo.tick + solo.length) n.solo = true;
    }
  }
  return notes;
}

/** Lists available "instrument:difficulty" keys grouped by instrument. */
export function availableTracks(song) {
  const byInstrument = {};
  for (const key of Object.keys(song.tracks)) {
    const [instrument, difficulty] = key.split(':');
    (byInstrument[instrument] ??= []).push(difficulty);
  }
  return byInstrument;
}
