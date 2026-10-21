// "Tilt to activate Star Power": a quick flick of the phone (a sharp change in its
// front-to-back angle) fires the callback. Uses the DeviceOrientation API.

const FLICK_DEGREES = 30;
const FLICK_WINDOW_MS = 400;
const COOLDOWN_MS = 1500;

/** iOS requires asking inside a user gesture; call this from a tap handler. */
export function requestTiltPermission() {
  const D = /** @type {any} */ (window.DeviceOrientationEvent);
  if (D && typeof D.requestPermission === 'function') D.requestPermission().catch(() => {});
}

export class TiltControls {
  /** @param {() => void} onFlick */
  constructor(onFlick) {
    this.onFlick = onFlick;
    this.samples = [];
    this.lastFired = -Infinity;
    this.onOrientation = this.onOrientation.bind(this);
    window.addEventListener('deviceorientation', this.onOrientation);
  }

  onOrientation(e) {
    if (e.beta === null || e.beta === undefined) return;
    const now = performance.now();
    this.samples.push({ t: now, beta: e.beta });
    while (this.samples.length && this.samples[0].t < now - FLICK_WINDOW_MS) this.samples.shift();
    if (now - this.lastFired < COOLDOWN_MS || this.samples.length < 2) return;
    const oldest = this.samples[0];
    if (Math.abs(e.beta - oldest.beta) >= FLICK_DEGREES) {
      this.lastFired = now;
      this.samples = [];
      this.onFlick();
    }
  }

  dispose() {
    window.removeEventListener('deviceorientation', this.onOrientation);
  }
}
