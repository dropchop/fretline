// Player preferences, remembered per device.
const KEY = 'fretline.settings';

export const DEFAULT_SETTINGS = {
  noteSpeed: 1, // multiplier on the base highway speed
  calibrationMs: 0, // positive = audio reaches the player later (e.g. Bluetooth headphones)
  hitWindowMs: 70, // +/- around each note
  leftHanded: false,
  inputMode: 'auto', // 'auto' | 'tap' | 'strum'
  volume: 0.9,
  muteOnMiss: true,
  instrument: 'guitar',
  difficulty: 'expert',
};

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
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
