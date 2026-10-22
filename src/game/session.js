// One play-through of a song: wires the audio clock, rules engine, renderer, HUD and controls.
import { buildPlayableNotes } from '../chart/playable.js';
import { GameEngine } from './engine.js';
import { AudioPlayer } from '../audio/player.js';
import { TouchControls, KeyboardControls } from '../input/controls.js';
import { GamepadControls, anyGamepadConnected } from '../input/gamepad.js';
import { resolveInputMode } from '../settings.js';
import { NOTE_STYLES } from '../render/highway.js';
import { isDrums } from '../chart/constants.js';
import { TiltControls } from '../input/tilt.js';

const BASE_SPEED = 9; // world units per second at note speed 1.0
const INSTRUMENT_STEM = {
  guitar: 'guitar',
  coop: 'guitar',
  bass: 'bass',
  rhythm: 'rhythm',
  keys: 'keys',
  drums: 'drums',
};

export class GameSession {
  /**
   * @param {object} opts
   * @param {{song: import('../chart/constants.js').ParsedSong, offsetMs: number, hopoThresholdTicks?: number}} opts.chart
   * @param {{name: string, data: ArrayBuffer|AudioBuffer}[]} opts.stems
   * @param {string} opts.instrument
   * @param {string} opts.difficulty
   * @param {import('../settings.js').DEFAULT_SETTINGS} opts.settings
   * @param {import('../render/highway.js').HighwayRenderer} opts.renderer
   * @param {import('../ui/hud.js').Hud} opts.hud
   * @param {HTMLElement} opts.surface element receiving touches
   * @param {number} [opts.speed] playback rate, 1 = normal
   * @param {{start: number, end: number}|null} [opts.range] section practice bounds in seconds
   * @param {(stats: object) => void} opts.onFinish
   * @param {() => void} opts.onPauseRequest
   */
  constructor(opts) {
    this.chart = opts.chart;
    this.stems = opts.stems;
    this.settings = opts.settings;
    this.renderer = opts.renderer;
    this.hud = opts.hud;
    this.surface = opts.surface;
    this.onFinish = opts.onFinish;
    this.onPauseRequest = opts.onPauseRequest;
    this.trackKey = `${opts.instrument}:${opts.difficulty}`;
    this.drums = isDrums(opts.instrument);
    this.notes = buildPlayableNotes(opts.chart.song, this.trackKey, {
      offsetMs: opts.chart.offsetMs,
      hopoThresholdTicks: opts.chart.hopoThresholdTicks,
    });
    // Section practice: keep only the notes inside the range and renumber them.
    this.range = opts.range ?? null;
    if (this.range) {
      this.notes = this.notes
        .filter((n) => n.time >= this.range.start && n.time < this.range.end)
        .map((n, id) => ({ ...n, id }));
    }
    // A connected controller plays by strum rules even on a touch device.
    this.mode =
      anyGamepadConnected() && opts.settings.inputMode === 'auto'
        ? 'strum'
        : resolveInputMode(opts.settings.inputMode);
    this.speed = opts.speed ?? 1; // practice speed, 1 = normal
    this.audio = new AudioPlayer();
    this.audio.rate = this.speed;
    this.audio.calibrationSec = opts.settings.calibrationMs / 1000;
    this.audio.setVolume(opts.settings.volume);
    this.stemName = INSTRUMENT_STEM[opts.instrument];
    this.running = false;
    this.paused = false;
    this.frame = this.frame.bind(this);
    this.onVisibility = () => document.hidden && this.running && !this.paused && this.onPauseRequest();
  }

  /** Decodes audio. Returns the names of stems the browser couldn't decode. */
  async load() {
    const failed = await this.audio.load(this.stems);
    if (!this.audio.stems.length) {
      throw new Error(`This browser couldn't decode the song audio (${failed.join(', ')}).`);
    }
    return failed;
  }

  start() {
    const { renderer, settings } = this;
    renderer.leftHanded = settings.leftHanded;
    renderer.noteStyle = settings.noteStyle in NOTE_STYLES ? settings.noteStyle : 'tiles';
    renderer.configureLanes(this.drums ? 'drums' : 'guitar', settings.theme);
    renderer.setNoteSpeed(BASE_SPEED * settings.noteSpeed);
    renderer.reset();
    this.engine = new GameEngine(this.notes, {
      tempoMap: this.chart.song.tempoMap,
      mode: this.mode,
      hitWindow: settings.hitWindowMs / 1000,
      drums: this.drums,
    });
    this.lastNoteEnd = this.notes.reduce((m, n) => Math.max(m, n.endTime), this.range?.start ?? 0);
    this.hud.reset(this.engine, this.drums ? 'drums' : this.mode, renderer.noteStyle === 'tiles');
    this.#attachControls();
    const firstNote = this.notes[0]?.time ?? this.range?.start ?? 0;
    const leadIn = this.range ? Math.max(0, this.range.start - 2) : Math.min(0, firstNote - 3);
    this.audio.play(leadIn);
    this.running = true;
    this.paused = false;
    this.lastFrame = performance.now();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.#requestWakeLock();
    requestAnimationFrame(this.frame);
  }

  #attachControls() {
    const songTimeAt = (ts) => {
      // Convert a DOM event timestamp into song time.
      const now = this.audio.songTime();
      return now - Math.max(0, performance.now() - ts) / 1000;
    };
    const active = () => this.running && !this.paused;
    const handlers = {
      fretDown: (lane, ts) => {
        if (lane >= this.renderer.laneCount) return;
        this.renderer.setFretPressed(lane, true);
        if (active()) this.engine.fretDown(lane, songTimeAt(ts));
      },
      fretUp: (lane, ts) => {
        if (lane >= this.renderer.laneCount) return;
        this.renderer.setFretPressed(lane, false);
        if (active()) this.engine.fretUp(lane, songTimeAt(ts));
      },
      openDown: (ts) => active() && this.engine.openDown(songTimeAt(ts)),
      openUp: (ts) => active() && this.engine.openUp(songTimeAt(ts)),
      strum: (ts) => {
        if (!active()) return;
        // On drums the strum / kick inputs (Space, d-pad, gamepad strum bar) play the kick.
        if (this.drums) {
          this.engine.openDown(songTimeAt(ts));
          this.engine.openUp(songTimeAt(ts));
        } else if (this.mode === 'strum') this.engine.strum(songTimeAt(ts));
      },
      starPower: (ts) => active() && this.engine.activateStarPower(songTimeAt(ts)),
      pause: () => this.onPauseRequest(),
    };
    this.touch = new TouchControls(this.surface, () => this.renderer.laneScreenPositions(), handlers);
    this.keyboard = new KeyboardControls(handlers);
    this.gamepad = new GamepadControls(handlers, this.settings.gamepadMap ?? undefined);
    if (this.settings.tiltStarPower)
      this.tilt = new TiltControls(() => handlers.starPower(performance.now()));
    this.hud.onStarPower = () => handlers.starPower(performance.now());
  }

  frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.paused) return;

    this.gamepad.poll();
    const t = this.audio.songTime();
    this.engine.update(t);
    for (const ev of this.engine.takeEvents()) this.#handleEvent(ev);
    this.renderer.render(t, this.engine, dt);
    this.hud.update(this.engine, t, this.audio.duration);

    const outroDone = this.engine.isFinished(t) && t > this.lastNoteEnd + (this.range ? 1.5 : 4);
    if (t > this.audio.duration + 0.5 || outroDone || (this.range && t > this.range.end + 1.5))
      this.#finish();
  }

  #handleEvent(ev) {
    switch (ev.type) {
      case 'hit':
        if (ev.note.open) this.renderer.flash(null);
        else for (const lane of ev.note.lanes) this.renderer.flash(lane);
        if (this.settings.muteOnMiss) this.audio.setStemMuted(this.stemName, false);
        break;
      case 'miss':
      case 'overhit':
        if (this.settings.muteOnMiss) this.audio.setStemMuted(this.stemName, true);
        break;
    }
    this.hud.event(ev, this.engine);
  }

  async pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.touch?.releaseAll(performance.now());
    for (let lane = 0; lane < this.renderer.laneCount; lane++) this.renderer.setFretPressed(lane, false);
    await this.audio.pause();
  }

  async resume() {
    if (!this.running || !this.paused) return;
    await this.audio.resume();
    this.lastFrame = performance.now();
    this.paused = false;
  }

  restart() {
    this.stop();
    this.start();
  }

  #finish() {
    const stats = this.engine.stats();
    this.stop();
    this.onFinish(stats);
  }

  stop() {
    this.running = false;
    this.touch?.dispose();
    this.keyboard?.dispose();
    this.gamepad?.dispose();
    this.tilt?.dispose();
    this.tilt = null;
    this.audio.stopSources();
    if (this.audio.ctx.state === 'suspended') this.audio.ctx.resume();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.wakeLock?.release?.().catch(() => {});
    this.wakeLock = null;
  }

  dispose() {
    this.stop();
    this.audio.dispose();
  }

  async #requestWakeLock() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      /* not supported or denied; the screen may dim during long songs */
    }
  }
}
