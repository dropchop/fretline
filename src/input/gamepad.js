// Gamepad / guitar-controller input via the Gamepad API, polled once per frame.
// Default layout follows the common guitar-controller mapping (frets on the face buttons,
// strum on the d-pad). Standard pads work too: A B X Y LB = frets, d-pad up/down = strum.
const FRET_BUTTONS = [0, 1, 2, 3, 4];
const STRUM_BUTTONS = [12, 13];
const SP_BUTTONS = [8, 6, 7];
const PAUSE_BUTTONS = [9];

export function anyGamepadConnected() {
  return !!navigator.getGamepads?.().some((g) => g && g.connected);
}

export class GamepadControls {
  /** @param {import('./controls.js').ControlHandlers} handlers */
  constructor(handlers) {
    this.h = handlers;
    this.prev = new Map(); // gamepad index -> previous pressed[] array
  }

  /** Call once per frame. Emits edge events with the current timestamp. */
  poll() {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    const ts = performance.now();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const prev = this.prev.get(pad.index) ?? [];
      const now = pad.buttons.map((b) => b.pressed);
      // Analogue stick up/down also strums, for pads without a d-pad.
      const stickY = pad.axes[1] ?? 0;
      now.push(stickY < -0.6, stickY > 0.6);
      for (let i = 0; i < now.length; i++) {
        if (now[i] === !!prev[i]) continue;
        const lane = FRET_BUTTONS.indexOf(i);
        if (lane >= 0) now[i] ? this.h.fretDown(lane, ts) : this.h.fretUp(lane, ts);
        else if (!now[i]) continue;
        else if (STRUM_BUTTONS.includes(i) || i >= pad.buttons.length) this.h.strum(ts);
        else if (SP_BUTTONS.includes(i)) this.h.starPower(ts);
        else if (PAUSE_BUTTONS.includes(i)) this.h.pause();
      }
      this.prev.set(pad.index, now);
    }
  }

  dispose() {
    this.prev.clear();
  }
}
