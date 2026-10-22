import { describe, it, expect } from 'vitest';
import { touchTarget } from '../src/input/controls.js';

// A 5-lane highway 400px wide: lanes are 80px apart at the strikeline (y=500) and narrow along
// straight lines toward the horizon (40px apart at y=100).
const lanesAt500 = [40, 120, 200, 280, 360];
const lanesAt100 = [120, 160, 200, 240, 280];
const classic = { lanes: lanesAt500, strikeY: 500, laneWidth: 80, tiles: false };
const tiles = {
  lanes: lanesAt500,
  strikeY: 500,
  laneWidth: 80,
  tiles: true,
  openY: 560,
  far: { y: 100, lanes: lanesAt100 },
};
const mirror = (l) => ({
  ...l,
  lanes: l.lanes.map((x) => 400 - x),
  far: l.far && { ...l.far, lanes: l.far.lanes.map((x) => 400 - x) },
});

describe('touchTarget, classic', () => {
  it('picks the nearest fret near the strikeline', () => {
    expect(touchTarget(125, 500, classic)).toBe(1);
    expect(touchTarget(300, 480, classic)).toBe(3);
  });
  it('treats a touch well above the frets as open', () => {
    expect(touchTarget(125, 300, classic)).toBe('open');
  });
});

describe('touchTarget, tiles', () => {
  it('counts a tap anywhere up a lane column as that fret', () => {
    expect(touchTarget(40, 500, tiles)).toBe(0);
    expect(touchTarget(200, 5, tiles)).toBe(2);
  });
  it('follows the lanes as they narrow toward the horizon', () => {
    // At y=100 lane 3 is at x=240 and lane 4 at x=280. x=265 is lane 4 up there, but lane 3 at the strikeline.
    expect(touchTarget(265, 100, tiles)).toBe(4);
    expect(touchTarget(265, 500, tiles)).toBe(3);
    // Halfway up (y=300) lane 1 is at x=(120+160)/2=140.
    expect(touchTarget(150, 300, tiles)).toBe(1);
  });
  it('treats the bar under the frets as open, edge to edge', () => {
    expect(touchTarget(10, 560, tiles)).toBe('open');
    expect(touchTarget(390, 600, tiles)).toBe('open');
    expect(touchTarget(125, 559, tiles)).toBe(1);
  });
  it('does not call the area just above the frets open', () => {
    expect(touchTarget(125, 440, tiles)).toBe(1);
  });
  it('mirrors in left-handed mode (lane 0 on the right)', () => {
    const left = mirror(tiles);
    expect(touchTarget(360, 500, left)).toBe(0);
    expect(touchTarget(120, 100, left)).toBe(4);
    expect(touchTarget(200, 580, left)).toBe('open');
  });
});
