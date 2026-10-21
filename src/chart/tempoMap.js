// Converts between chart ticks, seconds and beats using a list of tempo changes.

export class TempoMap {
  /**
   * @param {number} resolution ticks per quarter note
   * @param {{tick: number, bpm: number}[]} tempos
   * @param {{tick: number, numerator: number, denominator: number}[]} timeSignatures
   */
  constructor(resolution, tempos, timeSignatures = []) {
    this.resolution = resolution;
    const sorted = [...tempos].sort((a, b) => a.tick - b.tick);
    if (!sorted.length || sorted[0].tick > 0) sorted.unshift({ tick: 0, bpm: 120 });
    // Precompute the absolute time at which each tempo segment starts.
    this.segments = [];
    let time = 0;
    for (let i = 0; i < sorted.length; i++) {
      const { tick, bpm } = sorted[i];
      if (i > 0) {
        const prev = this.segments[i - 1];
        time = prev.time + this.#ticksToSec(tick - prev.tick, prev.bpm);
      }
      this.segments.push({ tick, bpm, time });
    }
    this.timeSignatures = [...timeSignatures].sort((a, b) => a.tick - b.tick);
    if (!this.timeSignatures.length || this.timeSignatures[0].tick > 0) {
      this.timeSignatures.unshift({ tick: 0, numerator: 4, denominator: 4 });
    }
  }

  #ticksToSec(ticks, bpm) {
    return (ticks / this.resolution) * (60 / bpm);
  }

  #segmentForTick(tick) {
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segments[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return this.segments[lo];
  }

  #segmentForTime(time) {
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segments[mid].time <= time) lo = mid;
      else hi = mid - 1;
    }
    return this.segments[lo];
  }

  tickToTime(tick) {
    const seg = this.#segmentForTick(tick);
    return seg.time + this.#ticksToSec(tick - seg.tick, seg.bpm);
  }

  timeToTick(time) {
    const seg = this.#segmentForTime(time);
    return seg.tick + ((time - seg.time) * seg.bpm * this.resolution) / 60;
  }

  /** Fractional beat number (quarter notes) at a given time. */
  timeToBeat(time) {
    return this.timeToTick(time) / this.resolution;
  }

  bpmAtTime(time) {
    return this.#segmentForTime(time).bpm;
  }

  /**
   * Beat lines between two times, for drawing the highway grid.
   * @returns {{time: number, measure: boolean}[]}
   */
  beatLines(fromTime, toTime) {
    const lines = [];
    const startBeat = Math.max(0, Math.ceil(this.timeToBeat(Math.max(0, fromTime))));
    for (let beat = startBeat; ; beat++) {
      const tick = beat * this.resolution;
      const time = this.tickToTime(tick);
      if (time > toTime) break;
      lines.push({ time, measure: this.#isMeasureStart(tick) });
    }
    return lines;
  }

  #isMeasureStart(tick) {
    let ts = this.timeSignatures[0];
    for (const t of this.timeSignatures) {
      if (t.tick <= tick) ts = t;
      else break;
    }
    const beatTicks = (this.resolution * 4) / ts.denominator;
    const measureTicks = beatTicks * ts.numerator;
    return Math.abs(((tick - ts.tick) % measureTicks)) < 1e-6;
  }
}
