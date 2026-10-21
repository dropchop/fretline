import { describe, expect, it } from 'vitest';
import { parseChart } from '../src/chart/chartFile.js';
import { buildPlayableNotes } from '../src/chart/playable.js';
import { GameEngine, HIT, MISSED } from '../src/game/engine.js';
import { TempoMap } from '../src/chart/tempoMap.js';

const CHART = `[Song]
{
  Resolution = 192
}
[SyncTrack]
{
  0 = B 120000
}
[ExpertDrums]
{
  0 = N 0 0
  0 = N 2 0
  0 = N 66 0
  192 = N 1 0
  192 = N 32 0
  384 = N 4 0
  384 = N 0 0
}
`;

describe('drum charts', () => {
  const song = parseChart(CHART);
  const notes = buildPlayableNotes(song, 'drums:expert');

  it('keeps simultaneous gems as separate notes and reads cymbals', () => {
    // Within a tick, pads sort before the kick (open lane).
    expect(notes.map((n) => (n.open ? 'K' : n.lanes[0]))).toEqual([1, 'K', 0, 3, 'K']);
    expect(notes[0].cymbal).toBe(true);
    expect(notes[2].cymbal).toBe(false);
    expect(notes.every((n) => !n.hopo && !n.sustain)).toBe(true);
  });

  it('lets drum gems at the same tick be hit in any order', () => {
    const tempoMap = new TempoMap(192, [{ tick: 0, bpm: 120 }]);
    const e = new GameEngine(notes, { tempoMap, drums: true });
    e.openDown(0.01); // kick first, although the yellow pad sorts before it
    expect(e.state[1]).toBe(HIT);
    expect(e.state[0]).toBe(0);
    e.fretDown(1, 0.02); // pad while the kick is still "held"
    expect(e.state[0]).toBe(HIT);
    expect(e.streak).toBe(2);
    e.update(1.2); // red at 0.5s missed
    expect(e.state[2]).toBe(MISSED);
    expect(e.streak).toBe(0);
  });
});
