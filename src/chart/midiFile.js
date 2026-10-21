// Parser for Rock Band-style notes.mid files as used by Clone Hero.
import { parseMidi } from 'midi-file';
import { TempoMap } from './tempoMap.js';
import { OPEN_LANE } from './constants.js';

const MIDI_INSTRUMENTS = {
  'PART GUITAR': 'guitar',
  'T1 GEMS': 'guitar', // very old GH1-era charts
  'PART GUITAR COOP': 'coop',
  'PART BASS': 'bass',
  'PART RHYTHM': 'rhythm',
  'PART KEYS': 'keys',
};

// Lowest note number (green fret) for each difficulty.
const DIFFICULTY_BASE = { easy: 60, medium: 72, hard: 84, expert: 96 };
const SOLO_NOTE = 103;
const TAP_NOTE = 104;
const STAR_POWER_NOTE = 116;

// Phase Shift sysex markers: 'P' 'S' 0 0 <difficulty|0xFF> <type> <on/off>
const PS_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];
const PS_TYPE_OPEN = 1;
const PS_TYPE_TAP = 4;

/**
 * Turn a track's delta-timed events into absolute-tick note spans, text events and sysex events.
 */
function collectTrack(events) {
  let tick = 0;
  let name = '';
  const open = new Map(); // noteNumber -> start tick
  const spans = [];
  const texts = [];
  const sysex = [];
  for (const ev of events) {
    tick += ev.deltaTime;
    if (ev.type === 'trackName') name = ev.text;
    else if (ev.type === 'text' || ev.type === 'lyrics' || ev.type === 'marker') {
      texts.push({ tick, text: ev.text });
    } else if (ev.type === 'noteOn' && ev.velocity > 0) {
      if (!open.has(ev.noteNumber)) open.set(ev.noteNumber, tick);
    } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) {
      const start = open.get(ev.noteNumber);
      if (start !== undefined) {
        spans.push({ note: ev.noteNumber, tick: start, length: tick - start });
        open.delete(ev.noteNumber);
      }
    } else if (ev.type === 'sysEx') {
      const d = ev.data;
      if (d.length >= 7 && d[0] === 0x50 && d[1] === 0x53 && d[2] === 0 && d[3] === 0) {
        sysex.push({ tick, difficulty: d[4], type: d[5], enabled: d[6] === 1 });
      }
    }
  }
  spans.sort((a, b) => a.tick - b.tick || a.note - b.note);
  return { name, spans, texts, sysex };
}

// Converts on/off sysex markers into [start, end) tick ranges for one difficulty.
function sysexRanges(sysex, type, difficulty) {
  const ranges = [];
  let start = null;
  for (const s of sysex) {
    if (s.type !== type) continue;
    if (s.difficulty !== 0xff && PS_DIFFICULTIES[s.difficulty] !== difficulty) continue;
    if (s.enabled && start === null) start = s.tick;
    if (!s.enabled && start !== null) {
      ranges.push([start, s.tick]);
      start = null;
    }
  }
  return ranges;
}

const inRanges = (tick, ranges) => ranges.some(([a, b]) => tick >= a && tick < b);
const inSpans = (tick, spans) => spans.some((s) => tick >= s.tick && tick < s.tick + s.length);

/**
 * @param {ArrayBuffer|Uint8Array} data contents of notes.mid
 * @returns {import('./constants.js').ParsedSong}
 */
export function parseMid(data) {
  const midi = parseMidi(data instanceof Uint8Array ? data : new Uint8Array(data));
  const resolution = midi.header.ticksPerBeat;
  if (!resolution) throw new Error('Unsupported MIDI timing (SMPTE time division)');

  const tempos = [];
  const timeSignatures = [];
  for (const events of midi.tracks) {
    let tick = 0;
    for (const ev of events) {
      tick += ev.deltaTime;
      if (ev.type === 'setTempo') tempos.push({ tick, bpm: 60_000_000 / ev.microsecondsPerBeat });
      if (ev.type === 'timeSignature') {
        timeSignatures.push({ tick, numerator: ev.numerator, denominator: ev.denominator });
      }
    }
  }

  const tracks = {};
  const sections = [];
  for (const events of midi.tracks) {
    const t = collectTrack(events);
    if (t.name === 'EVENTS') {
      for (const { tick, text } of t.texts) {
        const m = text.match(/^\[?(?:section |prc_)([^\]]+)\]?$/);
        if (m) sections.push({ tick, name: m[1].replace(/_/g, ' ') });
      }
      continue;
    }
    const instrument = MIDI_INSTRUMENTS[t.name];
    if (!instrument) continue;
    const enhancedOpens = t.texts.some((x) => /^\[?ENHANCED_OPENS\]?$/.test(x.text));
    const starPower = t.spans.filter((s) => s.note === STAR_POWER_NOTE);
    const solos = t.spans.filter((s) => s.note === SOLO_NOTE);
    const tapSpans = t.spans.filter((s) => s.note === TAP_NOTE);

    for (const [difficulty, base] of Object.entries(DIFFICULTY_BASE)) {
      const forceHopo = t.spans.filter((s) => s.note === base + 5);
      const forceStrum = t.spans.filter((s) => s.note === base + 6);
      const openRanges = sysexRanges(t.sysex, PS_TYPE_OPEN, difficulty);
      const tapRanges = sysexRanges(t.sysex, PS_TYPE_TAP, difficulty);
      const notes = [];
      for (const s of t.spans) {
        let lane = s.note - base;
        if (enhancedOpens && lane === -1) lane = OPEN_LANE;
        else if (lane < 0 || lane > 4) continue;
        // Phase Shift open-note sysex turns green gems in its range into opens.
        if (lane === 0 && inRanges(s.tick, openRanges)) lane = OPEN_LANE;
        let force = null;
        if (inSpans(s.tick, forceStrum)) force = 'strum';
        else if (inSpans(s.tick, forceHopo)) force = 'hopo';
        notes.push({
          tick: s.tick,
          lane,
          // Rock Band convention: very short MIDI notes are not sustains.
          length: s.length > resolution / 3 ? s.length : 0,
          force,
          tap: inSpans(s.tick, tapSpans) || inRanges(s.tick, tapRanges),
        });
      }
      if (notes.length) tracks[`${instrument}:${difficulty}`] = { notes, starPower, solos };
    }
  }

  return {
    format: 'mid',
    resolution,
    tempoMap: new TempoMap(resolution, tempos, timeSignatures),
    meta: {},
    sections: sections.sort((a, b) => a.tick - b.tick),
    tracks,
    // Community default for .mid files: 170 ticks at 480 resolution.
    hopoThresholdTicks: (resolution * 170) / 480,
  };
}
