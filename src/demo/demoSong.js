// A built-in, procedurally generated song (chart + synthesized audio) so the game is playable
// before any Clone Hero charts are loaded.
import { TempoMap } from '../chart/tempoMap.js';
import { OPEN_LANE } from '../chart/constants.js';

const RES = 192;
const BPM = 128;
const Q = RES; // quarter
const E = RES / 2; // eighth
const S = RES / 4; // sixteenth

// Lane -> pitch (E minor pentatonic), used for the guitar stem.
const LANE_MIDI = [52, 55, 57, 59, 62];
const OPEN_MIDI = 40;

/** Builds the expert chart as a list of raw notes plus star power phrases. */
function composeExpert() {
  const notes = [];
  const sp = [];
  let tick = 4 * Q; // one bar count-in
  const add = (lanes, len = 0, extra = {}) => {
    for (const lane of [].concat(lanes)) notes.push({ tick, lane, length: len, force: null, tap: false, ...extra });
  };

  // A: quarter-note melody.
  const melodyA = [0, 1, 2, 1, 0, 2, 3, 2, 1, 2, 3, 4, 3, 2, 1, 0];
  sp.push({ tick, length: 8 * Q });
  for (const lane of melodyA) {
    add(lane);
    tick += Q;
  }
  // B: eighths with sixteenth-note hammer-on runs.
  for (let bar = 0; bar < 4; bar++) {
    for (const lane of [0, 2, 1, 3]) {
      add(lane);
      tick += E;
    }
    for (const lane of [2, 3, 4, 3, 2, 1, 2, 3]) {
      add(lane);
      tick += S;
    }
  }
  // C: power chords and sustains.
  sp.push({ tick, length: 8 * Q });
  const chords = [[0, 1], [1, 2], [2, 3], [1, 3], [0, 2], [2, 4], [1, 3], [0, 1, 2]];
  for (const chord of chords) {
    add(chord, Q + E);
    tick += 2 * Q;
  }
  // D: open notes and a tap section.
  for (let bar = 0; bar < 2; bar++) {
    for (const lane of [OPEN_LANE, 0, OPEN_LANE, 1, OPEN_LANE, 2, OPEN_LANE, 3]) {
      add(lane);
      tick += E;
    }
  }
  sp.push({ tick, length: 8 * Q });
  for (let bar = 0; bar < 2; bar++) {
    for (const lane of [4, 3, 2, 3, 4, 3, 2, 1, 2, 1, 0, 1, 2, 3, 4, 3]) {
      add(lane, 0, { tap: true });
      tick += S;
    }
    for (const lane of [0, 2, 4, 2]) {
      add(lane);
      tick += Q / 2;
    }
    tick += 2 * Q;
  }
  // E: melody reprise with sustains, then a final chord.
  for (const lane of [0, 1, 2, 3, 4, 3, 2, 1]) {
    add(lane, E);
    tick += Q;
  }
  add([0, 2, 4], 4 * Q);
  tick += 6 * Q;
  return { notes, sp, endTick: tick };
}

/** Simpler versions of the expert chart for lower difficulties. */
function reduce(notes, difficulty) {
  const out = [];
  const byTick = new Map();
  for (const n of notes) {
    if (!byTick.has(n.tick)) byTick.set(n.tick, []);
    byTick.get(n.tick).push(n);
  }
  const grid = { easy: Q, medium: E, hard: E }[difficulty];
  const maxLane = { easy: 2, medium: 3, hard: 4 }[difficulty];
  const maxChord = { easy: 1, medium: 1, hard: 2 }[difficulty];
  for (const [tick, group] of byTick) {
    if (tick % grid !== 0) continue;
    const kept = group.slice(0, maxChord);
    for (const n of kept) {
      const lane = n.lane === OPEN_LANE ? (difficulty === 'easy' ? 0 : OPEN_LANE) : Math.min(n.lane, maxLane);
      if (out.some((o) => o.tick === tick && o.lane === lane)) continue;
      out.push({ ...n, lane, tap: difficulty === 'hard' ? n.tap : false });
    }
  }
  return out;
}

export function buildDemoSong() {
  const { notes, sp, endTick } = composeExpert();
  const tempoMap = new TempoMap(RES, [{ tick: 0, bpm: BPM }], [{ tick: 0, numerator: 4, denominator: 4 }]);
  const tracks = { 'guitar:expert': { notes, starPower: sp, solos: [] } };
  for (const d of ['easy', 'medium', 'hard']) tracks[`guitar:${d}`] = { notes: reduce(notes, d), starPower: sp, solos: [] };
  return {
    song: {
      format: 'demo',
      resolution: RES,
      tempoMap,
      meta: {},
      sections: [],
      tracks,
      hopoThresholdTicks: (RES * 65) / 192,
    },
    meta: { name: 'Neon Highway (Demo)', artist: 'Fretline', charter: 'Generated', lengthMs: tempoMap.tickToTime(endTick) * 1000 },
    offsetMs: 0,
    endTime: tempoMap.tickToTime(endTick),
    expertNotes: notes,
  };
}

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

/**
 * Renders the demo's audio offline into two stems: "guitar" (the charted part) and "song"
 * (drums and bass), so missing notes can mute the guitar like in Clone Hero.
 * @returns {Promise<{name: string, data: AudioBuffer}[]>}
 */
export async function renderDemoAudio(demo, sampleRate = 44100) {
  const { tempoMap } = demo.song;
  const length = Math.ceil((demo.endTime + 1) * sampleRate);
  const beatSec = 60 / BPM;

  const guitarCtx = new OfflineAudioContext(2, length, sampleRate);
  const guitarOut = guitarCtx.createGain();
  guitarOut.gain.value = 0.32;
  guitarOut.connect(guitarCtx.destination);
  for (const n of demo.expertNotes) {
    const start = tempoMap.tickToTime(n.tick);
    const dur = Math.max(0.18, n.length ? tempoMap.tickToTime(n.tick + n.length) - start : 0.2);
    const freq = midiToHz(n.lane === OPEN_LANE ? OPEN_MIDI : LANE_MIDI[n.lane]);
    for (const detune of [-7, 7]) {
      const osc = guitarCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const filter = guitarCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3200, start);
      filter.frequency.exponentialRampToValueAtTime(900, start + dur);
      const env = guitarCtx.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(0.5, start + 0.008);
      env.gain.exponentialRampToValueAtTime(0.18, start + Math.min(0.15, dur));
      env.gain.setValueAtTime(0.18, start + dur);
      env.gain.exponentialRampToValueAtTime(0.001, start + dur + 0.12);
      osc.connect(filter).connect(env).connect(guitarOut);
      osc.start(start);
      osc.stop(start + dur + 0.15);
    }
  }

  const bandCtx = new OfflineAudioContext(2, length, sampleRate);
  const bandOut = bandCtx.createGain();
  bandOut.gain.value = 0.5;
  bandOut.connect(bandCtx.destination);
  const noise = bandCtx.createBuffer(1, sampleRate, sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const hit = (time, { freq, decay, type = 'noise', gain = 1, hp = 0 }) => {
    const env = bandCtx.createGain();
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + decay);
    let src;
    if (type === 'noise') {
      src = bandCtx.createBufferSource();
      src.buffer = noise;
    } else {
      src = bandCtx.createOscillator();
      src.frequency.setValueAtTime(freq, time);
      src.frequency.exponentialRampToValueAtTime(40, time + decay);
    }
    let node = src;
    if (hp) {
      const f = bandCtx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = hp;
      node = node.connect(f);
    }
    node.connect(env).connect(bandOut);
    src.start(time);
    src.stop(time + decay + 0.05);
  };

  const totalBeats = Math.floor(demo.endTime / beatSec) - 2;
  const bassRoots = [40, 40, 43, 45];
  for (let beat = 0; beat < totalBeats; beat++) {
    const t = beat * beatSec;
    if (beat < 4) {
      hit(t, { decay: 0.05, gain: 0.5, hp: 7000 }); // count-in sticks
      continue;
    }
    hit(t, { type: 'osc', freq: 150, decay: 0.25, gain: 0.9 });
    if (beat % 2 === 1) hit(t, { decay: 0.18, gain: 0.45, hp: 1500 });
    hit(t, { decay: 0.04, gain: 0.18, hp: 8000 });
    hit(t + beatSec / 2, { decay: 0.04, gain: 0.12, hp: 8000 });
    // Bass: root note of the bar on each beat.
    const root = bassRoots[Math.floor(beat / 4) % 4];
    const osc = bandCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToHz(root);
    const env = bandCtx.createGain();
    env.gain.setValueAtTime(0.35, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + beatSec * 0.9);
    osc.connect(env).connect(bandOut);
    osc.start(t);
    osc.stop(t + beatSec);
  }

  const [guitar, band] = await Promise.all([guitarCtx.startRendering(), bandCtx.startRendering()]);
  return [
    { name: 'guitar', data: guitar },
    { name: 'song', data: band },
  ];
}
