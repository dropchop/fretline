// Gameplay rules: judging hits and misses, scoring, streaks and star power.
// Pure logic driven by song time in seconds, so it can be unit tested without audio or rendering.

export const PENDING = 0;
export const HIT = 1;
export const MISSED = 2;

const POINTS_PER_GEM = 50;
const SUSTAIN_POINTS_PER_BEAT = 25;
const NOTES_PER_MULTIPLIER = 10;
const MAX_MULTIPLIER = 4;
const SP_PER_PHRASE = 0.25;
const SP_MIN_TO_ACTIVATE = 0.5;
const SP_BEATS_FOR_FULL_METER = 32;
// Fraction of a perfect run's score (without star power) needed for 1-5 stars.
// This game's own thresholds, not Clone Hero's. A full combo earns gold stars.
const STAR_THRESHOLDS = [0.15, 0.35, 0.55, 0.75, 0.9];

const highestBit = (mask) => (mask ? 31 - Math.clz32(mask) : -1);

/**
 * @typedef {'tap'|'strum'} InputMode
 *   tap: pressing a fret at the right time hits the note (touch screens).
 *   strum: frets are held and a separate strum input hits the note (keyboard, controllers);
 *          HOPOs and taps can be hit by fretting alone.
 */

export class GameEngine {
  /**
   * @param {import('../chart/playable.js').PlayNote[]} notes
   * @param {{tempoMap: import('../chart/tempoMap.js').TempoMap, mode?: InputMode, hitWindow?: number, drums?: boolean}} options
   */
  constructor(notes, { tempoMap, mode = 'tap', hitWindow = 0.07, drums = false }) {
    this.notes = notes;
    this.tempoMap = tempoMap;
    // Drums always use tap rules: each pad hit judges its own lane, the kick is an open note.
    this.mode = drums ? 'tap' : mode;
    this.drums = drums;
    this.hitWindow = hitWindow;
    this.state = new Uint8Array(notes.length);
    // Time at which a sustain stopped being held (Infinity while still holding / not started).
    this.sustainDroppedAt = new Float64Array(notes.length).fill(Infinity);
    this.activeSustains = [];
    this.brokenPhrases = new Set();
    this.held = 0; // bitmask of frets currently down
    this.openHeld = false; // touch: finger on the strum area (for open notes)
    this.nextIndex = 0; // every note before this has been judged
    this.lastTime = -Infinity;
    this.lastNoteHit = false;
    this.strumLeniencyUntil = -Infinity;

    this.score = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.hits = 0;
    this.misses = 0;
    this.spMeter = 0;
    this.spActive = false;
    /** Events for the presentation layer; drain with takeEvents(). */
    this.events = [];

    // Score for hitting every note and holding every sustain, without star power.
    this.perfectScore = notes.reduce((sum, n, i) => {
      const mult = Math.min(MAX_MULTIPLIER, 1 + Math.floor(i / NOTES_PER_MULTIPLIER));
      const sustainMult = Math.min(MAX_MULTIPLIER, 1 + Math.floor((i + 1) / NOTES_PER_MULTIPLIER));
      return (
        sum +
        POINTS_PER_GEM * Math.max(1, n.lanes.length) * mult +
        SUSTAIN_POINTS_PER_BEAT * n.sustainBeats * sustainMult
      );
    }, 0);
  }

  get multiplier() {
    const base = Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.streak / NOTES_PER_MULTIPLIER));
    return this.spActive ? base * 2 : base;
  }

  /** Lanes currently held for an active sustain; ignored when matching new notes in tap mode. */
  get sustainingMask() {
    return this.activeSustains.reduce((m, s) => m | s.note.mask, 0);
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---- Inputs ---------------------------------------------------------------------------

  fretDown(lane, t) {
    this.update(t);
    this.held |= 1 << lane;
    if (this.mode === 'tap') this.#tapPress(t, lane);
    else this.#tryHammerOn(t);
  }

  fretUp(lane, t) {
    this.update(t);
    this.held &= ~(1 << lane);
    // Releasing a fret can complete a pull-off.
    if (this.mode === 'strum') this.#tryHammerOn(t);
  }

  /** Touch: finger down on the highway / strum area. Hits open notes in tap mode. */
  openDown(t) {
    this.update(t);
    this.openHeld = true;
    if (this.mode !== 'tap') return;
    const effective = this.held & ~this.sustainingMask;
    const note = this.#findInWindow(t, (n) => n.open && (this.drums || effective === 0));
    if (note) this.#hit(note, t);
    else if (this.drums && this.#anyPendingInWindow(t)) this.#overhit(t);
  }

  openUp(t) {
    this.update(t);
    this.openHeld = false;
  }

  strum(t) {
    this.update(t);
    if (t <= this.strumLeniencyUntil) {
      // Strumming right after a hammer-on is forgiven once.
      this.strumLeniencyUntil = -Infinity;
      return;
    }
    const note = this.#findInWindow(t, (n) => this.#strumMatches(n));
    if (note) this.#hit(note, t);
    else this.#overhit(t);
  }

  activateStarPower(t) {
    this.update(t);
    if (this.spActive || this.spMeter < SP_MIN_TO_ACTIVATE) return false;
    this.spActive = true;
    this.events.push({ type: 'spActivate', time: t });
    return true;
  }

  // ---- Time -----------------------------------------------------------------------------

  /** Advance to song time t: judges missed notes, scores sustains and drains star power. */
  update(t) {
    if (t < this.lastTime) return;
    const prev = this.lastTime === -Infinity ? t : this.lastTime;
    this.lastTime = t;

    while (this.nextIndex < this.notes.length) {
      const n = this.notes[this.nextIndex];
      if (this.state[n.id] === PENDING) {
        if (n.time + this.hitWindow >= t) break;
        this.#miss(n, t);
      }
      this.nextIndex++;
    }

    this.#updateSustains(prev, t);

    if (this.spActive) {
      const beats = this.tempoMap.timeToBeat(t) - this.tempoMap.timeToBeat(prev);
      this.spMeter = Math.max(0, this.spMeter - beats / SP_BEATS_FOR_FULL_METER);
      if (this.spMeter === 0) {
        this.spActive = false;
        this.events.push({ type: 'spEnd', time: t });
      }
    }
  }

  isFinished(t) {
    const last = this.notes[this.notes.length - 1];
    return !last || t > last.endTime + 1.5;
  }

  stats() {
    const total = this.notes.length;
    const ratio = this.perfectScore ? this.score / this.perfectScore : 0;
    const fullCombo = total > 0 && this.hits === total;
    return {
      score: Math.round(this.score),
      hits: this.hits,
      misses: this.misses,
      total,
      accuracy: total ? this.hits / total : 0,
      maxStreak: this.maxStreak,
      stars: fullCombo ? 6 : STAR_THRESHOLDS.filter((s) => ratio >= s).length,
      fullCombo,
    };
  }

  // ---- Internals ------------------------------------------------------------------------

  #updateSustains(from, to) {
    if (!this.activeSustains.length) return;
    const still = [];
    for (const s of this.activeSustains) {
      const n = s.note;
      let holding;
      if (!n.open) holding = (this.held & n.mask) === n.mask;
      else holding = this.mode === 'tap' ? this.openHeld : this.held === 0;
      // Inputs call update() before changing what is held, so a release is seen here at the
      // start of the next interval and nothing after it is scored.
      if (!holding) {
        if (s.scoredUntil < n.endTime) this.sustainDroppedAt[n.id] = s.scoredUntil;
        continue;
      }
      const end = Math.min(to, n.endTime);
      if (end > s.scoredUntil) {
        const beats = this.tempoMap.timeToBeat(end) - this.tempoMap.timeToBeat(s.scoredUntil);
        this.score += beats * SUSTAIN_POINTS_PER_BEAT * this.multiplier;
        s.scoredUntil = end;
      }
      if (to < n.endTime) still.push(s);
    }
    this.activeSustains = still;
  }

  /** First pending note in the hit window (in time order) that satisfies `accept`. */
  #findInWindow(t, accept) {
    for (let i = this.nextIndex; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time - this.hitWindow > t) break;
      if (this.state[n.id] !== PENDING || n.time + this.hitWindow < t) continue;
      if (accept(n)) return n;
    }
    return null;
  }

  #anyPendingInWindow(t) {
    return this.#findInWindow(t, () => true);
  }

  #tapPress(t, lane) {
    if (this.drums) {
      const pad = this.#findInWindow(t, (n) => !n.open && n.lanes[0] === lane);
      if (pad) this.#hit(pad, t);
      else if (this.#anyPendingInWindow(t)) this.#overhit(t);
      return;
    }
    const effective = this.held & ~this.sustainingMask;
    const target = this.#findInWindow(t, (n) => !n.open && (n.mask & (1 << lane)) !== 0);
    if (target) {
      // Chords complete once every lane is down. Extra fingers resting on other lanes are
      // forgiven: on a touch screen they can't be "lifted" as precisely as real frets.
      if ((effective & target.mask) === target.mask) this.#hit(target, t);
      return;
    }
    if (this.#anyPendingInWindow(t)) this.#overhit(t);
  }

  #strumMatches(n) {
    if (n.open) return this.held === 0;
    if (n.lanes.length > 1) return this.held === n.mask;
    // Single notes may be "anchored": lower frets can stay down.
    return highestBit(this.held) === n.lanes[0];
  }

  #tryHammerOn(t) {
    const note = this.#findInWindow(t, (n) => n.tap || (n.hopo && this.lastNoteHit));
    if (note && this.#strumMatches(note) && this.held !== 0) {
      this.#hit(note, t);
      this.strumLeniencyUntil = t + this.hitWindow;
    }
  }

  #hit(note, t) {
    // Any earlier pending notes were skipped over. Drum gems at the same instant are
    // separate notes and may be hit in any order, so only earlier ticks count as skipped.
    for (let i = this.nextIndex; i < note.id; i++) {
      if (this.state[i] === PENDING && !(this.drums && this.notes[i].tick === note.tick))
        this.#miss(this.notes[i], t);
    }
    this.state[note.id] = HIT;
    this.hits++;
    // The multiplier goes up after the 10th note, so score with the current one first.
    this.score += POINTS_PER_GEM * Math.max(1, note.lanes.length) * this.multiplier;
    this.streak++;
    this.maxStreak = Math.max(this.maxStreak, this.streak);
    this.lastNoteHit = true;
    if (note.sustain) this.activeSustains.push({ note, scoredUntil: Math.max(t, note.time) });
    this.events.push({ type: 'hit', note, time: t, offset: t - note.time });
    if (note.spEnd && !this.brokenPhrases.has(note.spPhrase)) {
      this.spMeter = Math.min(1, this.spMeter + SP_PER_PHRASE);
      this.events.push({ type: 'spGain', time: t });
    }
    if (
      this.streak % NOTES_PER_MULTIPLIER === 0 &&
      this.streak <= NOTES_PER_MULTIPLIER * (MAX_MULTIPLIER - 1)
    ) {
      this.events.push({ type: 'multiplier', time: t, value: this.multiplier });
    }
  }

  #miss(note, t) {
    this.state[note.id] = MISSED;
    this.misses++;
    if (note.spPhrase >= 0) this.brokenPhrases.add(note.spPhrase);
    this.#breakStreak();
    this.events.push({ type: 'miss', note, time: t });
  }

  #overhit(t) {
    this.#breakStreak();
    this.events.push({ type: 'overhit', time: t });
  }

  #breakStreak() {
    this.streak = 0;
    this.lastNoteHit = false;
  }
}
