// Touch and keyboard controls. Both report actions with the DOM event timestamp so judging
// uses when the player actually pressed, not when the next frame ran.

/**
 * @typedef {object} ControlHandlers
 * @property {(lane: number, ts: number) => void} fretDown
 * @property {(lane: number, ts: number) => void} fretUp
 * @property {(ts: number) => void} openDown finger on the highway above the frets (open notes)
 * @property {(ts: number) => void} openUp
 * @property {(ts: number) => void} strum
 * @property {(ts: number) => void} starPower
 * @property {() => void} pause
 */

/**
 * Multi-touch controls over the play area. The bottom band (around the strikeline) is split into
 * five fret columns aligned with the 3D frets; touching higher up on the highway is an open strum.
 */
export class TouchControls {
  /**
   * @param {HTMLElement} surface
   * @param {() => {lanes: number[], strikeY: number, laneWidth: number}} layout
   * @param {ControlHandlers} handlers
   */
  constructor(surface, layout, handlers) {
    this.surface = surface;
    this.layout = layout;
    this.h = handlers;
    /** pointerId -> lane (0-4) or 'open' */
    this.pointers = new Map();
    this.laneCounts = [0, 0, 0, 0, 0];
    this.openCount = 0;
    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onUp);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  #target(e) {
    const rect = this.surface.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { lanes, strikeY, laneWidth } = this.layout();
    if (y < strikeY - laneWidth * 1.1) return 'open';
    // lanes[i] is where lane i is drawn (already mirrored in left-handed mode).
    let best = 0;
    for (let i = 1; i < 5; i++) if (Math.abs(lanes[i] - x) < Math.abs(lanes[best] - x)) best = i;
    return best;
  }

  #press(target, ts) {
    if (target === 'open') {
      if (this.openCount++ === 0) this.h.openDown(ts);
    } else if (this.laneCounts[target]++ === 0) {
      this.h.fretDown(target, ts);
    }
  }

  #release(target, ts) {
    if (target === 'open') {
      if (--this.openCount === 0) this.h.openUp(ts);
    } else if (--this.laneCounts[target] === 0) {
      this.h.fretUp(target, ts);
    }
  }

  onDown(e) {
    e.preventDefault();
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    const target = this.#target(e);
    this.pointers.set(e.pointerId, target);
    this.#press(target, e.timeStamp);
  }

  onMove(e) {
    const current = this.pointers.get(e.pointerId);
    if (current === undefined) return;
    const target = this.#target(e);
    // Sliding between fret columns moves the press; sliding up to the highway doesn't.
    if (target === current || target === 'open' || current === 'open') return;
    this.pointers.set(e.pointerId, target);
    this.#press(target, e.timeStamp);
    this.#release(current, e.timeStamp);
  }

  onUp(e) {
    const target = this.pointers.get(e.pointerId);
    if (target === undefined) return;
    this.pointers.delete(e.pointerId);
    this.#release(target, e.timeStamp);
  }

  releaseAll(ts) {
    for (const target of this.pointers.values()) this.#release(target, ts);
    this.pointers.clear();
  }

  dispose() {
    this.surface.removeEventListener('pointerdown', this.onDown);
    this.surface.removeEventListener('pointermove', this.onMove);
    this.surface.removeEventListener('pointerup', this.onUp);
    this.surface.removeEventListener('pointercancel', this.onUp);
  }
}

const FRET_KEYS = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4,
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyG: 4,
};
const STRUM_KEYS = new Set(['Enter', 'Space', 'ArrowUp', 'ArrowDown']);
const SP_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'KeyQ']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);

/** Keyboard: 1-5 or A-G frets, Enter/Space/Up/Down strum, Shift/Q star power, Esc pause. */
export class KeyboardControls {
  /** @param {ControlHandlers} handlers */
  constructor(handlers) {
    this.h = handlers;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  onKeyDown(e) {
    if (e.repeat) {
      if (e.code in FRET_KEYS || STRUM_KEYS.has(e.code)) e.preventDefault();
      return;
    }
    if (e.code in FRET_KEYS) this.h.fretDown(FRET_KEYS[e.code], e.timeStamp);
    else if (STRUM_KEYS.has(e.code)) this.h.strum(e.timeStamp);
    else if (SP_KEYS.has(e.code)) this.h.starPower(e.timeStamp);
    else if (PAUSE_KEYS.has(e.code)) this.h.pause();
    else return;
    e.preventDefault();
  }

  onKeyUp(e) {
    if (e.code in FRET_KEYS) {
      this.h.fretUp(FRET_KEYS[e.code], e.timeStamp);
      e.preventDefault();
    }
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
