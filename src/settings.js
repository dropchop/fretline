// Player preferences, remembered per device.
import { DEFAULT_TIMING, TIMING_PRESETS } from './game/timing.js';

const KEY = 'fretline.settings';

export const DEFAULT_SETTINGS = {
  noteSpeed: 1, // multiplier on the base highway speed
  calibrationMs: 0, // positive = audio reaches the player later (e.g. Bluetooth headphones)
  timing: DEFAULT_TIMING, // key of TIMING_PRESETS: how wide the Perfect/Good/OK/Bad bands are
  noteStyle: 'tiles', // 'tiles' | 'classic'; see render/highway.js NOTE_STYLES
  leftHanded: false,
  inputMode: 'auto', // 'auto' | 'tap' | 'strum'
  volume: 0.9,
  muteOnMiss: true,
  instrument: 'guitar',
  difficulty: 'expert',
  gamepadMap: null, // null = default layout; see input/gamepad.js
  theme: 'classic', // see render/highway.js THEMES
  tiltStarPower: true, // flick the phone to activate Star Power
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // The old Hit window slider is gone; its value must not carry over, so every device starts on the new default.
    delete saved.hitWindowMs;
    const settings = { ...DEFAULT_SETTINGS, ...saved };
    if (!Object.hasOwn(TIMING_PRESETS, settings.timing)) settings.timing = DEFAULT_TIMING;
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable (private mode); settings last for this visit only */
  }
}

/** Touch-first devices default to tap mode; devices with a keyboard default to strumming. */
export function resolveInputMode(mode) {
  if (mode !== 'auto') return mode;
  return window.matchMedia('(pointer: coarse)').matches ? 'tap' : 'strum';
}
