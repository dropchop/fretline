import { describe, expect, it } from 'vitest';
import { GameEngine, HIT, MISSED } from '../src/game/engine.js';
import { DEFAULT_SETTINGS, loadSettings } from '../src/settings.js';
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

describe('timing grades', () => {
  const bandsMs = { forgiving: [40, 80, 130, 200], normal: [20, 40, 65, 100], strict: [14, 28, 46, 70] };
  const grades = ['perfect', 'good', 'ok', 'bad'];
  const tapAt = (offset, timing) => {
    const e = new GameEngine(makeNotes([{ time: 1, lane: 2 }]), { tempoMap, timing });
    e.fretDown(2, 1 + offset);
    return e;
  };
  const lastGrade = (e) => e.takeEvents().find((ev) => ev.type === 'hit')?.grade;

  for (const [timing, bands] of Object.entries(bandsMs)) {
    describe(timing, () => {
      bands.forEach((edge, i) => {
        for (const sign of [-1, 1]) {
          it(`grades ${sign < 0 ? 'early' : 'late'} hits at the ${grades[i]} edge (${edge} ms) as ${grades[i]}`, () => {
            expect(lastGrade(tapAt((sign * edge) / 1000, timing))).toBe(grades[i]);
          });
          if (i < 3) {
            it(`grades ${sign < 0 ? 'early' : 'late'} hits 1 ms past the ${grades[i]} edge as ${grades[i + 1]}`, () => {
              expect(lastGrade(tapAt((sign * (edge + 1)) / 1000, timing))).toBe(grades[i + 1]);
            });
          }
        }
      });
      it('does not judge a tap 1 ms past the Bad edge, on either side', () => {
        const edge = bands[3];
        expect(tapAt((edge + 1) / 1000, timing).state[0]).not.toBe(HIT);
        expect(tapAt(-(edge + 1) / 1000, timing).state[0]).not.toBe(HIT);
      });
      it('keeps a note pending until its Bad edge has passed, then misses it', () => {
        const e = new GameEngine(makeNotes([{ time: 1, lane: 2 }]), { tempoMap, timing });
        e.update(1 + bands[3] / 1000);
        expect(e.state[0]).toBe(0);
        e.update(1 + (bands[3] + 1) / 1000);
        expect(e.state[0]).toBe(MISSED);
      });
    });
  }

  it('defaults to Forgiving, with the Bad edge at 200 ms', () => {
    const e = new GameEngine(makeNotes([{ time: 1, lane: 2 }]), { tempoMap });
    expect(e.hitWindow).toBeCloseTo(0.2);
    expect(DEFAULT_SETTINGS.timing).toBe('forgiving');
    expect(DEFAULT_SETTINGS.noteStyle).toBe('tiles');
  });

  it('falls back to Forgiving for an unknown timing', () => {
    expect(new GameEngine([], { tempoMap, timing: 'bogus' }).hitWindow).toBeCloseTo(0.2);
  });

  it('scores 100 / 75 / 50 / 25 % of the gem for Perfect / Good / OK / Bad', () => {
    expect(tapAt(0.03).score).toBe(50);
    expect(tapAt(0.07).score).toBe(37.5);
    expect(tapAt(0.12).score).toBe(25);
    expect(tapAt(0.19).score).toBe(12.5);
  });

  it('scales a chord by the grade of its completing tap', () => {
    const e = new GameEngine(makeNotes([{ time: 1, lanes: [0, 2] }]), { tempoMap });
    e.fretDown(0, 0.95);
    e.fretDown(2, 1.07);
    expect(e.score).toBe(75);
  });

  it('keeps the streak on every grade and counts grades and early / late', () => {
    const specs = [0, 0.07, 0.12, 0.19, -0.07].map((_, i) => ({ time: 1 + i, lane: 0 }));
    const e = new GameEngine(makeNotes(specs), { tempoMap });
    [0, 0.07, 0.12, 0.19, -0.07].forEach((o, i) => {
      e.fretDown(0, 1 + i + o);
      e.fretUp(0, 1 + i + o + 0.01);
    });
    expect(e.streak).toBe(5);
    const stats = e.stats();
    expect(stats.grades).toEqual({ perfect: 1, good: 2, ok: 1, bad: 1 });
    expect(stats.early).toBe(1);
    expect(stats.late).toBe(3);
    expect(stats.windowMs).toBeCloseTo(200);
    expect(stats.perfectMs).toBeCloseTo(40);
  });

  it('feeds the multiplier at full rate whatever the grade, but scores the grade share', () => {
    const specs = Array.from({ length: 11 }, (_, i) => ({ time: 1 + i, lane: 0 }));
    const e = new GameEngine(makeNotes(specs), { tempoMap });
    specs.forEach((s) => {
      e.fretDown(0, s.time + 0.19); // every hit Bad
      e.fretUp(0, s.time + 0.2);
    });
    expect(e.multiplier).toBe(2);
    expect(e.score).toBe(10 * 12.5 + 12.5 * 2);
  });

  it('gives gold stars only to a full combo that is mostly Perfect and Good', () => {
    const specs = Array.from({ length: 20 }, (_, i) => ({ time: 1 + i, lane: 0 }));
    const play = (offset) => {
      const e = new GameEngine(makeNotes(specs), { tempoMap });
      specs.forEach((s) => {
        e.fretDown(0, s.time + offset);
        e.fretUp(0, s.time + offset + 0.01);
      });
      return e.stats();
    };
    expect(play(0).stars).toBe(6);
    // All Good is 75% of a perfect run: a full combo, but four stars.
    expect(play(0.07)).toMatchObject({ fullCombo: true, stars: 4 });
    expect(play(0.12)).toMatchObject({ fullCombo: true, stars: 2 });
    expect(play(0.19)).toMatchObject({ fullCombo: true, stars: 1 });
  });
});

describe('judging inside a wide window', () => {
  it('moves a Bad-late tap on to the next note of a run when that one is closer', () => {
    const e = new GameEngine(
      makeNotes([
        { time: 1, lane: 0 },
        { time: 1.12, lane: 0 },
        { time: 1.24, lane: 0 },
      ]),
      { tempoMap },
    );
    e.fretDown(0, 1.18); // 180 ms after note 0 (Bad), 60 ms after note 1 (Good)
    expect(e.state[1]).toBe(HIT);
    expect(e.takeEvents().find((ev) => ev.type === 'hit')).toMatchObject({ grade: 'good' });
    // The first note of the run was skipped over, and the rest are still graded against their own notes.
    expect(e.state[0]).toBe(MISSED);
    expect(e.state[2]).toBe(0);
    e.fretUp(0, 1.19);
    e.fretDown(0, 1.25);
    expect(e.takeEvents().find((ev) => ev.type === 'hit')).toMatchObject({ grade: 'perfect' });
  });

  it('judges the earlier note when a tap is exactly between two', () => {
    const e = new GameEngine(
      makeNotes([
        { time: 1, lane: 0 },
        { time: 1.1, lane: 0 },
      ]),
      { tempoMap },
    );
    e.fretDown(0, 1.05);
    expect(e.state[0]).toBe(HIT);
    expect(e.state[1]).toBe(0);
  });

  it('lets a run be tapped steadily late without skipping any note', () => {
    const specs = Array.from({ length: 8 }, (_, i) => ({ time: 1 + i * 0.12, lane: 0 }));
    const e = new GameEngine(makeNotes(specs), { tempoMap });
    specs.forEach((s) => {
      e.fretDown(0, s.time + 0.05);
      e.fretUp(0, s.time + 0.06);
    });
    expect(e.hits).toBe(8);
    expect(e.misses).toBe(0);
  });

  it('keeps an earlier note in another lane tappable when a later one is hit first', () => {
    const e = new GameEngine(
      makeNotes([
        { time: 1, lane: 0 },
        { time: 1.1, lane: 3 },
      ]),
      { tempoMap },
    );
    e.fretDown(3, 1.1);
    expect(e.state[1]).toBe(HIT);
    expect(e.state[0]).toBe(0);
    e.fretDown(0, 1.12);
    expect(e.state[0]).toBe(HIT);
    expect(e.misses).toBe(0);
  });

  it('still skips an earlier open note when a later open note is hit', () => {
    const e = new GameEngine(
      makeNotes([
        { time: 1, open: true },
        { time: 1.15, open: true },
      ]),
      { tempoMap },
    );
    e.openDown(1.16);
    expect(e.state[1]).toBe(HIT);
    expect(e.state[0]).toBe(MISSED);
  });

  it('strumming still skips every earlier note', () => {
    const e = new GameEngine(
      makeNotes([
        { time: 1, lane: 0 },
        { time: 1.1, lane: 1 },
      ]),
      { tempoMap, mode: 'strum' },
    );
    e.fretDown(1, 1.09);
    e.strum(1.1);
    expect(e.state[1]).toBe(HIT);
    expect(e.state[0]).toBe(MISSED);
  });

  it('forgives a strum after a hammer-on for 100 ms at most, not the whole wide window', () => {
    const e = new GameEngine(
      makeNotes([
        { time: 1, lane: 0 },
        { time: 1.1, lane: 1, hopo: true },
        { time: 1.25, lane: 1 },
      ]),
      { tempoMap, mode: 'strum' },
    );
    e.fretDown(0, 1);
    e.strum(1);
    e.fretDown(1, 1.1); // hammer-on
    e.strum(1.25); // 150 ms later: a real strum for the third note
    expect(e.state[2]).toBe(HIT);
  });
});

describe('saved settings', () => {
  const store = {};
  const withStorage = (saved) => {
    globalThis.localStorage = /** @type {Storage} */ (
      /** @type {unknown} */ ({
        getItem: () => (saved === undefined ? null : JSON.stringify(saved)),
        setItem: (k, v) => (store[k] = v),
      })
    );
  };
  it('drops a saved hitWindowMs and keeps other values', () => {
    withStorage({ hitWindowMs: 140, noteSpeed: 1.5 });
    const loaded = loadSettings();
    expect(loaded).not.toHaveProperty('hitWindowMs');
    expect(loaded.timing).toBe('forgiving');
    expect(loaded.noteSpeed).toBe(1.5);
  });
  it('keeps a saved timing choice and repairs an unknown one', () => {
    withStorage({ timing: 'strict' });
    expect(loadSettings().timing).toBe('strict');
    withStorage({ timing: 'nonsense' });
    expect(loadSettings().timing).toBe('forgiving');
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
    e.update(1.3);
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

describe('runs played late, as they were judged with a fixed window', () => {
  const states = (e) => [...e.state].map((x) => (x === HIT ? 'H' : x === MISSED ? 'M' : '.')).join('');
  for (const timing of ['normal', 'forgiving']) {
    it(`P3: a same-lane run 100 ms apart, every tap 60 ms late, keeps every note (${timing})`, () => {
      const specs = Array.from({ length: 8 }, (_, i) => ({ time: 1 + i * 0.1, lane: 2 }));
      const e = new GameEngine(makeNotes(specs), { tempoMap, timing });
      specs.forEach((s) => {
        e.fretDown(2, s.time + 0.06);
        e.fretUp(2, s.time + 0.07);
      });
      e.update(10);
      expect(states(e)).toBe('HHHHHHHH');
      expect(e.stats().offsets.every((o) => Math.abs(o - 0.06) < 1e-9)).toBe(true);
    });

    it(`P1: a chord repeated 100 ms later, fingers 40 and 60 ms late, keeps both (${timing})`, () => {
      const e = new GameEngine(
        makeNotes([
          { time: 1, lanes: [0, 1] },
          { time: 1.1, lanes: [0, 1] },
        ]),
        { tempoMap, timing },
      );
      e.fretDown(0, 1.04);
      e.fretDown(1, 1.06);
      e.fretUp(0, 1.08);
      e.fretUp(1, 1.08);
      e.fretDown(0, 1.14);
      e.fretDown(1, 1.16);
      e.update(10);
      expect(states(e)).toBe('HH');
    });

    it(`P2: a chord and then a shared-lane single 80 ms later keep both (${timing})`, () => {
      const e = new GameEngine(
        makeNotes([
          { time: 1, lanes: [0, 1] },
          { time: 1.08, lane: 1 },
        ]),
        { tempoMap, timing },
      );
      e.fretDown(0, 1.03);
      e.fretDown(1, 1.045);
      e.fretUp(0, 1.07);
      e.fretUp(1, 1.07);
      e.fretDown(1, 1.1);
      e.update(10);
      expect(states(e)).toBe('HH');
    });

    it(`P7: strumming a chord three times, 100 ms apart and 60 ms late, keeps all three (${timing})`, () => {
      const specs = [1, 1.1, 1.2].map((time) => ({ time, lanes: [0, 1] }));
      const e = new GameEngine(makeNotes(specs), { tempoMap, mode: 'strum', timing });
      e.fretDown(0, 0.9);
      e.fretDown(1, 0.9);
      for (const s of specs) e.strum(s.time + 0.06);
      e.update(10);
      expect(states(e)).toBe('HHH');
    });
  }
});

describe('star power phrases with notes in several lanes', () => {
  const phrase = () =>
    makeNotes([
      { time: 1, lane: 0, sp: 0 },
      { time: 1.05, lane: 3, sp: 0, spEnd: true },
    ]);

  it('does not pay a phrase whose earlier note in another lane is never hit', () => {
    const e = new GameEngine(phrase(), { tempoMap });
    e.fretDown(3, 1.05);
    expect(e.spMeter).toBe(0); // still waiting on the lane 0 note
    e.update(5);
    expect(e.state[0]).toBe(MISSED);
    expect(e.spMeter).toBe(0);
    expect(e.takeEvents().map((ev) => ev.type)).not.toContain('spGain');
  });

  it('pays the phrase once the earlier note is hit too, even after the last one', () => {
    const e = new GameEngine(phrase(), { tempoMap });
    e.fretDown(3, 1.05);
    e.fretDown(0, 1.1);
    expect(e.spMeter).toBeCloseTo(0.25);
    expect(e.takeEvents().filter((ev) => ev.type === 'spGain')).toHaveLength(1);
  });

  it('pays a phrase hit in order exactly once', () => {
    const e = new GameEngine(phrase(), { tempoMap });
    e.fretDown(0, 1);
    e.fretDown(3, 1.05);
    expect(e.spMeter).toBeCloseTo(0.25);
  });
});

describe('stray presses', () => {
  const run = (offsetOfStray) => {
    const e = new GameEngine(
      makeNotes([
        { time: 1, lane: 0 },
        { time: 2, lane: 0 },
      ]),
      { tempoMap },
    );
    e.fretDown(0, 1);
    e.fretUp(0, 1.01);
    e.fretDown(4, 2 + offsetOfStray);
    return e;
  };
  it('only break the streak with a note within 100 ms, as before the window grew', () => {
    expect(run(-0.15).streak).toBe(1);
    expect(run(-0.09).streak).toBe(0);
  });
});

describe('saved timing names', () => {
  it('rejects names that are only inherited from Object', () => {
    expect(new GameEngine([], { tempoMap, timing: 'toString' }).hitWindow).toBeCloseTo(0.2);
    globalThis.localStorage = /** @type {Storage} */ (
      /** @type {unknown} */ ({ getItem: () => JSON.stringify({ timing: 'toString' }), setItem: () => {} })
    );
    expect(loadSettings().timing).toBe('forgiving');
  });
});
