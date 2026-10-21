import { describe, expect, it } from 'vitest';
import { parseChart } from '../src/chart/chartFile.js';
import { buildPlayableNotes, availableTracks } from '../src/chart/playable.js';
import { parseSongIni, stripTags } from '../src/chart/ini.js';

const CHART = `[Song]
{
  Name = "Test Song"
  Artist = "Test Artist"
  Charter = "Me"
  Offset = 0
  Resolution = 192
}
[SyncTrack]
{
  0 = TS 4
  0 = B 120000
  768 = B 60000
}
[Events]
{
  0 = E "section Intro"
  384 = E "section Verse_1"
}
[ExpertSingle]
{
  0 = N 0 0
  48 = N 1 0
  96 = N 1 0
  192 = N 0 0
  192 = N 2 96
  240 = N 2 0
  384 = N 3 0
  384 = N 5 0
  576 = N 7 0
  768 = N 4 0
  768 = N 6 0
  960 = N 0 0
  0 = S 2 200
}
[HardDoubleBass]
{
  0 = N 0 0
}
`;

describe('parseChart', () => {
  const song = parseChart(CHART);

  it('reads metadata and resolution', () => {
    expect(song.meta.name).toBe('Test Song');
    expect(song.meta.artist).toBe('Test Artist');
    expect(song.resolution).toBe(192);
  });

  it('reads sections and tracks', () => {
    expect(song.sections).toEqual([
      { tick: 0, name: 'Intro' },
      { tick: 384, name: 'Verse 1' },
    ]);
    expect(availableTracks(song)).toEqual({ guitar: ['expert'], bass: ['hard'] });
  });

  it('converts ticks to time across tempo changes', () => {
    // 120 BPM: 192 ticks = 0.5s. 768 ticks = 2s, then 60 BPM: +192 ticks = +1s.
    expect(song.tempoMap.tickToTime(192)).toBeCloseTo(0.5);
    expect(song.tempoMap.tickToTime(768)).toBeCloseTo(2);
    expect(song.tempoMap.tickToTime(960)).toBeCloseTo(3);
    expect(song.tempoMap.timeToTick(3)).toBeCloseTo(960);
  });

  it('marks measure lines', () => {
    const lines = song.tempoMap.beatLines(0, 2);
    expect(lines.map((l) => l.measure)).toEqual([true, false, false, false, true]);
  });
});

describe('buildPlayableNotes', () => {
  const song = parseChart(CHART);
  const notes = buildPlayableNotes(song, 'guitar:expert');

  it('groups chords and computes sustains', () => {
    const chord = notes.find((n) => n.tick === 192);
    expect(chord.lanes).toEqual([0, 2]);
    expect(chord.sustain).toBe(true);
    expect(chord.endTime).toBeCloseTo(0.75);
  });

  it('applies natural HOPO rules', () => {
    const byTick = Object.fromEntries(notes.map((n) => [n.tick, n]));
    expect(byTick[0].hopo).toBe(false); // first note
    expect(byTick[48].hopo).toBe(true); // close, different fret
    expect(byTick[96].hopo).toBe(false); // same fret as previous
    expect(byTick[192].hopo).toBe(false); // chord
    expect(byTick[240].hopo).toBe(false); // single gem from previous chord
  });

  it('applies forced and tap flags', () => {
    const byTick = Object.fromEntries(notes.map((n) => [n.tick, n]));
    expect(byTick[384].hopo).toBe(true); // far apart, forced flips to HOPO
    expect(byTick[768].tap).toBe(true);
    expect(byTick[768].hopo).toBe(false);
  });

  it('reads open notes', () => {
    const open = notes.find((n) => n.tick === 576);
    expect(open.open).toBe(true);
    expect(open.lanes).toEqual([]);
  });

  it('assigns star power phrases', () => {
    const inPhrase = notes.filter((n) => n.spPhrase === 0).map((n) => n.tick);
    expect(inPhrase).toEqual([0, 48, 96, 192]);
    expect(notes.find((n) => n.tick === 192).spEnd).toBe(true);
  });

  it('shifts notes by the offset', () => {
    const shifted = buildPlayableNotes(song, 'guitar:expert', { offsetMs: 100 });
    expect(shifted[0].time).toBeCloseTo(0.1);
  });
});

describe('song.ini', () => {
  it('parses the [song] section case-insensitively', () => {
    const ini = parseSongIni('﻿[Song]\nname = Foo\nArtist=Bar\ndelay = -50\n[other]\nname=x\n');
    expect(ini).toEqual({ name: 'Foo', artist: 'Bar', delay: '-50' });
  });

  it('strips formatting tags', () => {
    expect(stripTags('<color=#ff0000>Red</color> <b>Song</b>')).toBe('Red Song');
  });
});
