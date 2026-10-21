import { describe, expect, it } from 'vitest';
import { writeMidi } from 'midi-file';
import { parseMid } from '../src/chart/midiFile.js';
import { buildPlayableNotes } from '../src/chart/playable.js';

// Builds a delta-timed track from absolute-tick events.
/** @returns {any[]} */
function track(name, events) {
  const sorted = [...events].sort((a, b) => a.tick - b.tick);
  let last = 0;
  /** @type {any[]} */
  const out = [{ deltaTime: 0, meta: true, type: 'trackName', text: name }];
  for (const { tick, ...ev } of sorted) {
    out.push({ deltaTime: tick - last, ...ev });
    last = tick;
  }
  out.push({ deltaTime: 0, meta: true, type: 'endOfTrack' });
  return out;
}

function note(noteNumber, tick, length) {
  return [
    { tick, type: 'noteOn', channel: 0, noteNumber, velocity: 100 },
    { tick: tick + length, type: 'noteOff', channel: 0, noteNumber, velocity: 0 },
  ];
}

function buildMidi() {
  const tempo = track('tempo', [
    { tick: 0, meta: true, type: 'setTempo', microsecondsPerBeat: 500000 },
    {
      tick: 0,
      meta: true,
      type: 'timeSignature',
      numerator: 4,
      denominator: 4,
      metronome: 24,
      thirtyseconds: 8,
    },
  ]);
  const events = track('EVENTS', [{ tick: 0, meta: true, type: 'text', text: '[section intro]' }]);
  const guitar = track('PART GUITAR', [
    ...note(96, 0, 60), // expert green, short -> not a sustain
    ...note(97, 120, 60), // expert red, close -> natural HOPO
    ...note(98, 960, 960), // expert yellow, sustain
    ...note(101, 960, 10), // expert force HOPO (base + 5) on the far-away yellow
    ...note(96, 2880, 60), // expert green
    ...note(97, 2940, 60), // expert red, close -> natural HOPO...
    ...note(102, 2940, 10), // ...but forced strum (base + 6)
    ...note(84, 0, 60), // hard green
    ...note(116, 0, 200), // star power
    ...note(104, 1920, 10), // tap marker
    ...note(99, 1920, 60), // expert blue (tapped)
  ]);
  const data = writeMidi({
    header: { format: 1, numTracks: 3, ticksPerBeat: 480 },
    tracks: [tempo, events, guitar],
  });
  return new Uint8Array(data);
}

describe('parseMid', () => {
  const song = parseMid(buildMidi());

  it('reads tracks per difficulty and sections', () => {
    expect(Object.keys(song.tracks).sort()).toEqual(['guitar:expert', 'guitar:hard']);
    expect(song.sections).toEqual([{ tick: 0, name: 'intro' }]);
    expect(song.tempoMap.tickToTime(480)).toBeCloseTo(0.5);
  });

  it('builds playable notes with HOPOs, sustains, taps and star power', () => {
    const notes = buildPlayableNotes(song, 'guitar:expert');
    expect(notes.map((n) => n.lanes[0])).toEqual([0, 1, 2, 3, 0, 1]);
    expect(notes[0].sustain).toBe(false);
    expect(notes[1].hopo).toBe(true);
    expect(notes[2].hopo).toBe(true);
    expect(notes[5].hopo).toBe(false);
    expect(notes[2].sustain).toBe(true);
    expect(notes[2].endTime).toBeCloseTo(2);
    expect(notes[3].tap).toBe(true);
    expect(notes[0].spPhrase).toBe(0);
    expect(notes[1].spPhrase).toBe(0);
    expect(notes[1].spEnd).toBe(true);
  });
});
