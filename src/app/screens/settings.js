// Settings screen: binds the form controls to the persisted settings.
import { $, show, registerActions } from '../router.js';
import { settings } from '../state.js';
import { saveSettings } from '../../settings.js';

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
  range('hitWindow', 'hitWindowMs', (v) => `±${v} ms`);
  range('volume', 'volume', (v) => `${Math.round(v * 100)}%`);
  for (const key of ['leftHanded', 'muteOnMiss']) {
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
