// Gamepad / guitar-controller input via the Gamepad API, polled once per frame.
// Default layout follows the common guitar-controller mapping (frets on the face buttons,
// strum on the d-pad). Standard pads work too: A B X Y LB = frets, d-pad up/down = strum.
/** Default button layout; the settings screen can replace it. */
export const DEFAULT_GAMEPAD_MAP = { frets: [0, 1, 2, 3, 4], strum: [12, 13], starPower: [8, 6, 7], pause: [9] };

export function anyGamepadConnected() {
  return !!navigator.getGamepads?.().some((g) => g && g.connected);
}

export class GamepadControls {
  /** @param {import('./controls.js').ControlHandlers} handlers */
  constructor(handlers, map = DEFAULT_GAMEPAD_MAP) {
    this.h = handlers;
    this.map = map;
    this.prev = new Map(); // gamepad index -> previous pressed[] array
  }

  /**
   * Waits for the next button press on any pad and resolves with its index.
   * Used by the mapping screen. Resolves null when `signal` aborts.
   */
  static nextPress(signal) {
    return new Promise((resolve) => {
      const baseline = new Map();
      const tick = () => {
        if (signal?.aborted) return resolve(null);
        for (const pad of navigator.getGamepads?.() ?? []) {
          if (!pad) continue;
          const prev = baseline.get(pad.index);
          const now = pad.buttons.map((b) => b.pressed);
          if (prev) {
            const i = now.findIndex((p, j) => p && !prev[j]);
            if (i >= 0) return resolve(i);
          }
          baseline.set(pad.index, now);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
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
        const lane = this.map.frets.indexOf(i);
        if (lane >= 0) now[i] ? this.h.fretDown(lane, ts) : this.h.fretUp(lane, ts);
        else if (!now[i]) continue;
        else if (this.map.strum.includes(i) || i >= pad.buttons.length) this.h.strum(ts);
        else if (this.map.starPower.includes(i)) this.h.starPower(ts);
        else if (this.map.pause.includes(i)) this.h.pause();
      }
      this.prev.set(pad.index, now);
    }
  }

  dispose() {
    this.prev.clear();
  }
}
