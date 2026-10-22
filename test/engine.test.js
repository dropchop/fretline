import { describe, expect, it } from 'vitest';
import { GameEngine, HIT, MISSED } from '../src/game/engine.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { TempoMap } from '../src/chart/tempoMap.js';

// 120 BPM: one beat = 0.5s.
const tempoMap = new TempoMap(192, [{ tick: 0, bpm: 120 }]);

function makeNotes(specs) {
  return specs.map((s, id) => {
    const lanes = s.open ? [] : (s.lanes ?? [s.lane]);
    const sustainSec = s.sustain ?? 0;
    return {
      id,
      tick: Math.round(s.time * 384),
      time: s.time,
      endTime: s.time + sustainSec,
      lanes,
      mask: lanes.reduce((m, l) => m | (1 << l), 0),
      open: !!s.open,
      hopo: !!s.hopo,
      tap: !!s.tap,
      sustain: sustainSec > 0,
      sustainBeats: sustainSec * 2,
      spPhrase: s.sp ?? -1,
      spEnd: !!s.spEnd,
      solo: false,
    };
  });
}

describe('default hit window', () => {
  it('is +/-100 ms', () => {
    const early = new GameEngine(makeNotes([{ time: 1, lane: 2 }]), { tempoMap });
    early.fretDown(2, 1 - 0.095);
    expect(early.state[0]).toBe(HIT);
    const late = new GameEngine(makeNotes([{ time: 1, lane: 2 }]), { tempoMap });
    late.fretDown(2, 1 + 0.11);
    expect(late.state[0]).not.toBe(HIT);
  });
  it('matches the default setting', () => {
    expect(DEFAULT_SETTINGS.hitWindowMs).toBe(100);
    expect(DEFAULT_SETTINGS.noteStyle).toBe('tiles');
  });
});

describe('tap mode', () => {
  it('hits a note pressed inside the window and scores it', () => {
    const e = new GameEngine(makeNotes([{ time: 1, lane: 2 }]), { tempoMap });
    e.fretDown(2, 1.03);
    expect(e.state[0]).toBe(HIT);
    expect(e.score).toBe(50);
    expect(e.streak).toBe(1);
  });

  it('misses notes that pass the window', () => {
    const e = new GameEngine(makeNotes([{ time: 1, lane: 0 }]), { tempoMap });
    e.update(1.2);
    expect(e.state[0]).toBe(MISSED);
    expect(e.misses).toBe(1);
  });

  it('ignores presses with no note nearby but breaks streak on a wrong lane', () => {
    const e = new GameEngine(
      makeNotes([
        { time: 1, lane: 0 },
        { time: 2, lane: 0 },
      ]),
      { tempoMap },
    );
    e.fretDown(0, 1);
    e.fretUp(0, 1.1);
    e.fretDown(3, 1.5); // nothing in window: no penalty
    e.fretUp(3, 1.55);
    expect(e.streak).toBe(1);
    e.fretDown(4, 2); // note in window, wrong lane
    expect(e.streak).toBe(0);
    expect(e.state[1]).toBe(0);
  });

  it('requires every lane of a chord, allowing fingers to land a few ms apart', () => {
    const e = new GameEngine(makeNotes([{ time: 1, lanes: [0, 2] }]), { tempoMap });
    e.fretDown(0, 0.99);
    expect(e.state[0]).toBe(0);
    e.fretDown(2, 1.01);
    expect(e.state[0]).toBe(HIT);
    expect(e.score).toBe(100);
  });

  it('hits open notes with a tap on the strum area', () => {
    const e = new GameEngine(makeNotes([{ time: 1, open: true }]), { tempoMap });
    e.openDown(1);
    expect(e.state[0]).toBe(HIT);
  });

  it('scores sustains while held and stops when released', () => {
    const e = new GameEngine(makeNotes([{ time: 1, lane: 1, sustain: 1 }]), { tempoMap });
    e.fretDown(1, 1);
    e.update(1.5); // 1 beat held
    expect(e.score).toBeCloseTo(75);
    e.fretUp(1, 1.5);
    e.update(2);
    expect(e.score).toBeCloseTo(75);
    expect(e.sustainDroppedAt[0]).toBeCloseTo(1.5);
  });

  it('raises the multiplier every 10 notes up to 4x', () => {
    const specs = Array.from({ length: 35 }, (_, i) => ({ time: 1 + i * 0.25, lane: i % 2 }));
    const e = new GameEngine(makeNotes(specs), { tempoMap });
    specs.forEach((s) => {
      e.fretDown(s.lane, s.time);
      e.fretUp(s.lane, s.time + 0.01);
    });
    expect(e.multiplier).toBe(4);
    // 10*50*1 + 10*50*2 + 10*50*3 + 5*50*4
    expect(e.score).toBe(500 + 1000 + 1500 + 1000);
    expect(e.stats().accuracy).toBe(1);
    expect(e.stats().stars).toBe(6); // full combo
  });

  it('rates stars against a perfect run', () => {
    const specs = Array.from({ length: 40 }, (_, i) => ({ time: 1 + i * 0.25, lane: 0 }));
    const e = new GameEngine(makeNotes(specs), { tempoMap });
    // Perfect: 10*50 + 10*100 + 10*150 + 10*200 = 5000. Miss the first note, hit the rest.
    expect(e.perfectScore).toBe(5000);
    specs.slice(1).forEach((s) => {
      e.fretDown(0, s.time);
      e.fretUp(0, s.time + 0.01);
    });
    expect(e.stats().fullCombo).toBe(false);
    expect(e.stats().stars).toBe(5);
  });
});

describe('strum mode', () => {
  it('needs a strum with the right fret held; lower frets may be anchored', () => {
    const e = new GameEngine(
      makeNotes([
        { time: 1, lane: 3 },
        { time: 2, lane: 1 },
      ]),
      { tempoMap, mode: 'strum' },
    );
    e.fretDown(0, 0.9);
    e.fretDown(3, 0.95);
    e.strum(1);
    expect(e.state[0]).toBe(HIT);
    e.fretUp(3, 1.5);
    e.fretDown(2, 1.9); // highest held is 2, note is 1
    e.strum(2);
    expect(e.streak).toBe(0);
  });

  it('counts a strum with nothing to hit as an overstrum', () => {
    const e = new GameEngine(
      makeNotes([
        { time: 1, lane: 0 },
        { time: 3, lane: 0 },
      ]),
      { tempoMap, mode: 'strum' },
    );
    e.fretDown(0, 0.9);
    e.strum(1);
    expect(e.streak).toBe(1);
    e.strum(2);
    expect(e.streak).toBe(0);
  });

  it('allows HOPOs by fretting after a hit and forgives the strum that follows', () => {
    const e = new GameEngine(
      makeNotes([
        { time: 1, lane: 0 },
        { time: 1.1, lane: 1, hopo: true },
      ]),
      {
        tempoMap,
        mode: 'strum',
      },
    );
    e.fretDown(0, 0.98);
    e.strum(1);
    e.fretDown(1, 1.1);
    expect(e.state[1]).toBe(HIT);
    e.strum(1.12);
    expect(e.streak).toBe(2);
  });

  it('does not let a HOPO be fretted without a previous hit, but taps always can', () => {
    const e = new GameEngine(
      makeNotes([
        { time: 1, lane: 1, hopo: true },
        { time: 2, lane: 2, tap: true },
      ]),
      {
        tempoMap,
        mode: 'strum',
      },
    );
    e.fretDown(1, 1);
    expect(e.state[0]).toBe(0);
    e.fretUp(1, 1.5);
    e.fretDown(2, 2);
    expect(e.state[1]).toBe(HIT);
  });
});

describe('star power', () => {
  const phrase = () =>
    makeNotes([
      { time: 1, lane: 0, sp: 0 },
      { time: 2, lane: 0, sp: 0, spEnd: true },
      { time: 3, lane: 0, sp: 1 },
      { time: 4, lane: 0, sp: 1, spEnd: true },
      { time: 20, lane: 0 },
    ]);

  it('fills on completed phrases, activates at half and doubles the multiplier', () => {
    const e = new GameEngine(phrase(), { tempoMap });
    for (const t of [1, 2, 3, 4]) {
      e.fretDown(0, t);
      e.fretUp(0, t + 0.01);
    }
    expect(e.spMeter).toBeCloseTo(0.5);
    expect(e.activateStarPower(4.5)).toBe(true);
    expect(e.multiplier).toBe(2);
    // Drains 1/32 of the meter per beat: 0.5 lasts 16 beats = 8s.
    e.update(8.5);
    expect(e.spMeter).toBeCloseTo(0.25);
    e.update(12.6);
    expect(e.spActive).toBe(false);
  });

  it('does not award a phrase with a missed note', () => {
    const e = new GameEngine(phrase(), { tempoMap });
    e.update(1.5); // miss first note
    e.fretDown(0, 2);
    expect(e.spMeter).toBe(0);
    expect(e.activateStarPower(2.5)).toBe(false);
  });
});
