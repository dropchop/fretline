// Plays a song's audio stems in sync and provides the master song clock.

let sharedContext = null;

/** Must first be called from a user gesture (tap/click) so mobile browsers allow audio. */
export function getAudioContext() {
  if (!sharedContext) {
    // Ask iOS to treat this as media playback so the ringer switch doesn't mute it.
    // Audio Session API: Safari only; feature-detected.
    if (navigator.audioSession) {
      try {
        navigator.audioSession.type = 'playback';
      } catch {
        /* not supported */
      }
    }
    sharedContext = new AudioContext({ latencyHint: 'interactive' });
  }
  if (sharedContext.state === 'suspended') sharedContext.resume();
  return sharedContext;
}

export class AudioPlayer {
  constructor() {
    this.ctx = getAudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    /** @type {{name: string, buffer: AudioBuffer, gain: GainNode, source?: AudioBufferSourceNode}[]} */
    this.stems = [];
    this.startCtxTime = 0; // context time at which song time 0 plays
    this.playing = false;
    this.calibrationSec = 0;
    this.anchor = null;
  }

  /**
   * @param {{name: string, data: ArrayBuffer|AudioBuffer}[]} stems
   * @returns {Promise<string[]>} names of stems that failed to decode
   */
  async load(stems) {
    const failed = [];
    await Promise.all(
      stems.map(async ({ name, data }) => {
        try {
          const buffer = data instanceof AudioBuffer ? data : await this.ctx.decodeAudioData(data.slice(0));
          const gain = this.ctx.createGain();
          gain.connect(this.master);
          this.stems.push({ name, buffer, gain });
        } catch {
          failed.push(name);
        }
      }),
    );
    return failed;
  }

  get duration() {
    return this.stems.reduce((d, s) => Math.max(d, s.buffer.duration), 0);
  }

  setVolume(v) {
    this.master.gain.value = v;
  }

  /** Mute a stem (e.g. the guitar track after a miss). Ramps to avoid clicks. */
  setStemMuted(name, muted) {
    const stem = this.stems.find((s) => s.name === name);
    if (!stem) return;
    const now = this.ctx.currentTime;
    stem.gain.gain.cancelScheduledValues(now);
    stem.gain.gain.setTargetAtTime(muted ? 0.08 : 1, now, 0.02);
  }

  hasStem(name) {
    return this.stems.some((s) => s.name === name);
  }

  /** Start playback so that song time `from` (may be negative for a lead-in) is now. */
  play(from = 0) {
    this.stopSources();
    const now = this.ctx.currentTime + 0.05;
    this.startCtxTime = now - from;
    for (const stem of this.stems) {
      const src = this.ctx.createBufferSource();
      src.buffer = stem.buffer;
      src.connect(stem.gain);
      if (from >= 0) src.start(now, from);
      else src.start(now - from, 0);
      stem.source = src;
    }
    this.playing = true;
    this.anchor = null;
  }

  pause() {
    return this.ctx.suspend();
  }

  resume() {
    this.anchor = null;
    return this.ctx.resume();
  }

  stopSources() {
    for (const stem of this.stems) {
      try {
        stem.source?.stop();
      } catch {
        /* already stopped */
      }
      stem.source = undefined;
    }
    this.playing = false;
  }

  dispose() {
    this.stopSources();
    this.master.disconnect();
  }

  /**
   * Song time currently being heard, in seconds. Corrects for output latency and the user's
   * calibration, and smooths the coarse AudioContext clock with performance.now().
   */
  songTime() {
    const raw = this.ctx.currentTime;
    const now = performance.now();
    if (this.ctx.state !== 'running') {
      this.anchor = null;
    } else if (!this.anchor || raw !== this.anchor.raw) {
      this.anchor = { raw, now };
    }
    let ctxTime = raw;
    if (this.anchor) {
      // Extrapolate between clock updates, but never drift far from the real clock.
      ctxTime = Math.min(this.anchor.raw + (now - this.anchor.now) / 1000, raw + 0.05);
    }
    const latency = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return ctxTime - this.startCtxTime - latency - this.calibrationSec;
  }
}
