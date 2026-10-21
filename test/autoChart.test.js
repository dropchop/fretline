import { describe, expect, it } from 'vitest';
import { analyse, estimateTempo, pickOnsets, autoChart } from '../src/chart/autoChart.js';
import { parseChart } from '../src/chart/chartFile.js';
import { buildPlayableNotes } from '../src/chart/playable.js';

const SR = 22050;

/** Synthetic track: decaying tone bursts on every beat at `bpm`, brighter on beats 2 and 4. */
function makeSignal(bpm, seconds, startOffset = 0.25) {
  const out = new Float32Array(Math.floor(SR * seconds));
  const beat = 60 / bpm;
  for (let b = 0; startOffset + b * beat < seconds; b++) {
    const t0 = startOffset + b * beat;
    const freq = b % 2 ? 1800 : 220;
    const start = Math.floor(t0 * SR);
    for (let i = 0; i < SR * 0.12 && start + i < out.length; i++) {
      const t = i / SR;
      out[start + i] += 0.8 * Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 25);
    }
  }
  return out;
}

describe('autoChart', () => {
  it('finds the tempo and first beat of a click track', () => {
    const { flux, frameTime } = analyse(makeSignal(128, 20), SR);
    const { bpm, firstBeat } = estimateTempo(flux, frameTime);
    expect(Math.abs(bpm - 128)).toBeLessThan(2);
    expect(Math.abs(firstBeat - 0.25)).toBeLessThan(0.05);
  });

  it('detects one onset per hit', () => {
    const { flux } = analyse(makeSignal(100, 12), SR);
    const onsets = pickOnsets(flux);
    // 12 s at 100 BPM starting at 0.25 s: 20 hits.
    expect(onsets.length).toBeGreaterThanOrEqual(18);
    expect(onsets.length).toBeLessThanOrEqual(21);
  });

  it('produces a parseable chart whose notes line up with the hits', () => {
    const { chart, bpm, noteCount } = autoChart(makeSignal(120, 16), SR, { name: 'Synth', artist: 'Test' });
    expect(Math.abs(bpm - 120)).toBeLessThan(2);
    expect(noteCount).toBeGreaterThan(20);
    const song = parseChart(chart);
    expect(song.meta.name).toBe('Synth');
    expect(Object.keys(song.tracks).sort()).toEqual([
      'guitar:easy',
      'guitar:expert',
      'guitar:hard',
      'guitar:medium',
    ]);
    const notes = buildPlayableNotes(song, 'guitar:expert', { offsetMs: Number(song.meta.offsetMs) });
    // Every note should sit within 40 ms of a real hit.
    const beat = 60 / 120;
    for (const n of notes) {
      const nearest = Math.round((n.time - 0.25) / beat) * beat + 0.25;
      expect(Math.abs(n.time - nearest)).toBeLessThan(0.04);
    }
    // Bright and dark hits should land on different lanes.
    const lanes = new Set(notes.map((n) => n.lanes[0]));
    expect(lanes.size).toBeGreaterThanOrEqual(2);
    expect(song.tracks['guitar:easy'].notes.length).toBeLessThanOrEqual(notes.length);
  });
});
