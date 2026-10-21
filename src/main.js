import './style.css';
import { back, registerActions } from './app/router.js';
import { state } from './app/state.js';
import { initLibrary } from './app/screens/library.js';
import { initSetup } from './app/screens/setup.js';
import { initPlay } from './app/screens/play.js';
import { initSettings } from './app/screens/settings.js';
import { initCalibration, cancelCalibration } from './app/screens/calibration.js';
import { initController, cancelControllerMapping } from './app/screens/controller.js';

initSettings();
initCalibration();
initController();
initSetup();
initPlay();
initLibrary();

registerActions({
  back: () => {
    cancelCalibration();
    cancelControllerMapping();
    back();
  },
});

const params = new URLSearchParams(location.search);
// Offline support: cache the app shell after the first visit.
if ('serviceWorker' in navigator && !params.has('nosw')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
// Test hook: ?debug exposes app state for automated browser tests.
if (params.has('debug')) window.fretline = state;
