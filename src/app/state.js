// App-wide mutable state shared by the screens, plus the player's settings.
import { loadSettings } from '../settings.js';

export const settings = loadSettings();

export const DEMO_ID = 'demo::neon-highway';

export const state = {
  library: [],
  /** @type {{pkg?: object, demo?: boolean, chart: object, meta: object, art: Blob|null}|null} */
  selected: null,
  instrument: null,
  difficulty: null,
  session: null,
  renderer: null,
  hud: null,
  demoStems: null,
  history: ['menu'],
  artUrls: [],
  setupArtUrl: null,
};

/** Library id of the selected song, used as the high-score key. */
export const selectedId = () => (state.selected?.demo ? DEMO_ID : state.selected?.pkg?.id);
