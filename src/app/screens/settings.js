// Settings screen: binds the form controls to the persisted settings.
import { $, show, registerActions } from '../router.js';
import { settings } from '../state.js';
import { saveSettings } from '../../settings.js';
import { TIMING_PRESETS, DEFAULT_TIMING } from '../../game/timing.js';
import { THEMES, NOTE_STYLES } from '../../render/highway.js';

export function initSettings() {
  const range = (id, key, format) => {
    const input = $(`#${id}`);
    const out = $(`#${id}Out`);
    input.value = settings[key];
    out.textContent = format(settings[key]);
    input.addEventListener('input', () => {
      settings[key] = Number(input.value);
      out.textContent = format(settings[key]);
      saveSettings(settings);
    });
  };
  range('noteSpeed', 'noteSpeed', (v) => `${Number(v).toFixed(2)}x`);
  range('calibration', 'calibrationMs', (v) => `${v} ms`);
  range('volume', 'volume', (v) => `${Math.round(v * 100)}%`);
  const timing = $('#timing');
  const timingHelp = $('#timingHelp');
  const describeTiming = () => {
    const [p, g, o, b] = TIMING_PRESETS[timing.value].bandsMs;
    timingHelp.textContent = `Perfect ±${p} ms, Good ±${g}, OK ±${o}, Bad ±${b}. Anything further out misses.`;
  };
  for (const [key, t] of Object.entries(TIMING_PRESETS)) timing.append(new Option(t.label, key));
  timing.value = settings.timing in TIMING_PRESETS ? settings.timing : DEFAULT_TIMING;
  describeTiming();
  timing.addEventListener('change', () => {
    settings.timing = timing.value;
    describeTiming();
    saveSettings(settings);
  });
  const theme = $('#theme');
  for (const [key, t] of Object.entries(THEMES)) theme.append(new Option(t.label, key));
  theme.value = settings.theme in THEMES ? settings.theme : 'classic';
  theme.addEventListener('change', () => {
    settings.theme = theme.value;
    saveSettings(settings);
  });
  const noteStyle = $('#noteStyle');
  for (const [key, label] of Object.entries(NOTE_STYLES)) noteStyle.append(new Option(label, key));
  noteStyle.value = settings.noteStyle in NOTE_STYLES ? settings.noteStyle : 'tiles';
  noteStyle.addEventListener('change', () => {
    settings.noteStyle = noteStyle.value;
    saveSettings(settings);
  });
  for (const key of ['leftHanded', 'muteOnMiss', 'tiltStarPower']) {
    const input = $(`#${key}`);
    input.checked = settings[key];
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      saveSettings(settings);
    });
  }
  const mode = $('#inputMode');
  mode.value = settings.inputMode;
  mode.addEventListener('change', () => {
    settings.inputMode = mode.value;
    saveSettings(settings);
  });
  registerActions({ settings: () => show('settings') });
}

/** Re-reads values that other screens can change (calibration). */
export function syncSettingsForm() {
  $('#calibration').value = settings.calibrationMs;
  $('#calibrationOut').textContent = `${settings.calibrationMs} ms`;
}
