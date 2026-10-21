// Controller button-mapping screen.
import { $, show, registerActions } from '../router.js';
import { settings } from '../state.js';
import { saveSettings } from '../../settings.js';
import { GamepadControls, DEFAULT_GAMEPAD_MAP } from '../../input/gamepad.js';

const MAP_STEPS = [
  ['frets', 'Green fret'],
  ['frets', 'Red fret'],
  ['frets', 'Yellow fret'],
  ['frets', 'Blue fret'],
  ['frets', 'Orange fret'],
  ['strum', 'Strum down'],
  ['strum', 'Strum up'],
  ['starPower', 'Star Power'],
  ['pause', 'Pause'],
];
let mapAbort = null;

function describeMap(map) {
  return `Frets: ${map.frets.join(', ')} · Strum: ${map.strum.join(', ')} · Star Power: ${map.starPower.join(', ')} · Pause: ${map.pause.join(', ')} (button numbers)`;
}

async function startControllerMapping() {
  show('controller');
  mapAbort?.abort();
  mapAbort = new AbortController();
  const { signal } = mapAbort;
  $('#controllerMap').textContent = describeMap(settings.gamepadMap ?? DEFAULT_GAMEPAD_MAP);
  $('#controllerStatus').textContent = 'Connect a gamepad or guitar controller and press any button.';
  $('#controllerPrompt').textContent = '';
  if ((await GamepadControls.nextPress(signal)) === null) return;
  $('#controllerStatus').textContent = 'Controller found. Press each button as asked.';
  const map = { frets: [], strum: [], starPower: [], pause: [] };
  for (const [group, label] of MAP_STEPS) {
    $('#controllerPrompt').textContent = `Press: ${label}`;
    const button = await GamepadControls.nextPress(signal);
    if (button === null) return;
    map[group].push(button);
    await new Promise((r) => setTimeout(r, 250)); // let the button release
  }
  settings.gamepadMap = map;
  saveSettings(settings);
  $('#controllerPrompt').textContent = 'Saved!';
  $('#controllerMap').textContent = describeMap(map);
}

/** Stops a mapping in progress (when leaving the screen). */
export function cancelControllerMapping() {
  mapAbort?.abort();
}

export function initController() {
  registerActions({
    'map-controller': startControllerMapping,
    'reset-controller': () => {
      cancelControllerMapping();
      settings.gamepadMap = null;
      saveSettings(settings);
      $('#controllerMap').textContent = describeMap(DEFAULT_GAMEPAD_MAP);
      $('#controllerPrompt').textContent = 'Default layout restored.';
    },
  });
}
