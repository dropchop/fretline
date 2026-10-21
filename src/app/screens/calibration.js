// Tap-along audio latency calibration.
import { $, show, registerActions } from '../router.js';
import { settings } from '../state.js';
import { saveSettings } from '../../settings.js';
import { getAudioContext } from '../../audio/player.js';
import { syncSettingsForm } from './settings.js';

const CLICKS = 24;
const INTERVAL = 0.5;
const calibration = { clicks: [], taps: [], timer: null };

function startCalibration() {
  const ctx = getAudioContext();
  const start = ctx.currentTime + 0.6;
  calibration.clicks = [];
  calibration.taps = [];
  for (let i = 0; i < CLICKS; i++) {
    const t = start + i * INTERVAL;
    calibration.clicks.push(t);
    const osc = ctx.createOscillator();
    osc.frequency.value = i % 4 === 0 ? 1500 : 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }
  $('#calibrateResult').textContent = 'Listen for the clicks and tap along…';
  clearTimeout(calibration.timer);
  calibration.timer = setTimeout(finishCalibration, (0.6 + CLICKS * INTERVAL + 0.5) * 1000);
  show('calibrate');
}

function calibrationTap(e) {
  const ctx = getAudioContext();
  calibration.taps.push(ctx.currentTime - Math.max(0, performance.now() - e.timeStamp) / 1000);
  const pad = $('#tapPad');
  pad.classList.add('pulse');
  setTimeout(() => pad.classList.remove('pulse'), 80);
}

function finishCalibration() {
  const ctx = getAudioContext();
  const { clicks, taps } = calibration;
  // Ignore the first few clicks while the player locks in.
  const diffs = taps
    .map((tap) => {
      const nearest = clicks.reduce((best, c) => (Math.abs(c - tap) < Math.abs(best - tap) ? c : best));
      return { tap, d: tap - nearest, i: clicks.indexOf(nearest) };
    })
    .filter((x) => x.i >= 4 && Math.abs(x.d) < 0.25)
    .map((x) => x.d)
    .sort((a, b) => a - b);
  if (diffs.length < 8) {
    $('#calibrateResult').textContent = 'Not enough taps in time with the clicks. Try again from Settings.';
    return;
  }
  const median = diffs[Math.floor(diffs.length / 2)];
  const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  const ms = Math.round(((median - latency) * 1000) / 5) * 5;
  settings.calibrationMs = Math.max(-200, Math.min(400, ms));
  saveSettings(settings);
  syncSettingsForm();
  $('#calibrateResult').textContent = `Calibration set to ${settings.calibrationMs} ms.`;
}

/** Stops a calibration in progress (when leaving the screen). */
export function cancelCalibration() {
  clearTimeout(calibration.timer);
}

export function initCalibration() {
  $('#tapPad').addEventListener('pointerdown', calibrationTap);
  registerActions({ calibrate: startCalibration });
}
