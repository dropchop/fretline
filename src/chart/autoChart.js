// Generates a playable chart from raw audio: onset detection by spectral flux, tempo by
// autocorrelation of the onset curve, and notes placed on the detected beat grid with
// lanes chosen by how bright (high-frequency) each hit sounds.
const FRAME = 1024;
const HOP = 512;
const RESOLUTION = 192;
const MIN_BPM = 60;
const MAX_BPM = 200;

/** In-place iterative radix-2 FFT on interleaved real/imag arrays. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Onset strength per frame (spectral flux) and the spectral centroid per frame.
 * @param {Float32Array} samples mono audio
 */
export function analyse(samples, sampleRate) {
  const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  const flux = new Float32Array(frames);
  const centroid = new Float32Array(frames);
  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  let prev = new Float32Array(FRAME / 2);
  let cur = new Float32Array(FRAME / 2);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = samples[off + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    let weighted = 0;
    let fl = 0;
    for (let k = 1; k < FRAME / 2; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      cur[k] = mag;
      const d = mag - prev[k];
      if (d > 0) fl += d; // only energy increases count as onsets
      sum += mag;
      weighted += mag * k;
    }
    flux[f] = fl;
    centroid[f] = sum > 0 ? ((weighted / sum) * sampleRate) / FRAME : 0;
    [prev, cur] = [cur, prev];
  }
  return { flux, centroid, frameTime: HOP / sampleRate };
}

/** Picks peaks of the flux curve above a local adaptive threshold. Returns frame indices. */
export function pickOnsets(flux, { windowFrames = 16, minGapFrames = 3, sensitivity = 1.5 } = {}) {
  const onsets = [];
  let last = -Infinity;
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;
    const a = Math.max(0, i - windowFrames);
    const b = Math.min(flux.length, i + windowFrames);
    let mean = 0;
    for (let j = a; j < b; j++) mean += flux[j];
    mean /= b - a;
    if (flux[i] > mean * sensitivity && flux[i] > 1e-6 && i - last >= minGapFrames) {
      onsets.push(i);
      last = i;
    }
  }
  return onsets;
}

/** Time of an onset frame: the frame's centre. */
const onsetTime = (frame, frameTime) => (frame + 1) * frameTime;

/**
 * Estimates tempo and the time of the first beat: a coarse period from the autocorrelation of
 * the onset curve, refined by fitting a beat grid to the detected onsets by least squares.
 * @returns {{bpm: number, firstBeat: number}}
 */
export function estimateTempo(flux, frameTime, onsets = pickOnsets(flux)) {
  const n = flux.length;
  const minLag = Math.floor(60 / MAX_BPM / frameTime);
  const maxLag = Math.min(n - 1, Math.ceil(60 / MIN_BPM / frameTime));
  const ac = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += flux[i] * flux[i + lag];
    ac[lag] = s / (n - lag);
  }
  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    // Mild preference for tempos near 120 BPM, as beat trackers commonly do.
    const bpm = 60 / (lag * frameTime);
    const weight = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const s = ac[lag] * (0.6 + 0.4 * weight);
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  // Octave check: a strong half-period means the beat is twice as fast.
  const half = Math.round(bestLag / 2);
  if (half >= minLag && ac[half] >= 0.6 * ac[bestLag]) bestLag = half;

  let period = bestLag * frameTime;
  let phase = 0;
  const times = onsets.map((f) => onsetTime(f, frameTime));
  if (times.length >= 4) {
    // Initial phase: the grid offset with the most onset energy.
    let bestEnergy = -Infinity;
    for (let p = 0; p < bestLag; p++) {
      let e = 0;
      for (let i = p; i < n; i += bestLag) e += flux[i];
      if (e > bestEnergy) {
        bestEnergy = e;
        phase = onsetTime(p, frameTime);
      }
    }
    // Refine: assign each onset to its nearest beat index and fit time = phase + period * k.
    for (let iter = 0; iter < 4; iter++) {
      let sk = 0;
      let st = 0;
      let skk = 0;
      let skt = 0;
      let m = 0;
      for (const t of times) {
        const k = Math.round((t - phase) / period);
        if (Math.abs(t - (phase + k * period)) > period * 0.2) continue;
        sk += k;
        st += t;
        skk += k * k;
        skt += k * t;
        m++;
      }
      const det = m * skk - sk * sk;
      if (m < 4 || det === 0) break;
      period = (m * skt - sk * st) / det;
      phase = (st - period * sk) / m;
    }
  }
  const firstBeat = ((phase % period) + period) % period;
  return { bpm: Math.round((60 / period) * 10) / 10, firstBeat };
}

/**
 * Builds Clone Hero .chart text from audio samples.
 * @param {Float32Array} samples mono audio
 * @param {number} sampleRate
 * @param {{name?: string, artist?: string}} meta
 * @returns {{chart: string, bpm: number, noteCount: number}}
 */
export function autoChart(samples, sampleRate, meta = {}) {
  const { flux, centroid, frameTime } = analyse(samples, sampleRate);
  const onsets = pickOnsets(flux);
  const { bpm, firstBeat } = estimateTempo(flux, frameTime, onsets);
  const beatSec = 60 / bpm;
  const sixteenth = RESOLUTION / 4;

  // Quantise onsets to the 16th-note grid anchored on the first beat.
  const expert = new Map(); // tick -> lane
  let strongest = 0;
  for (const f of onsets) strongest = Math.max(strongest, flux[f]);
  const centroids = onsets.map((f) => centroid[f]).sort((a, b) => a - b);
  const laneFor = (c) => {
    // Rank the hit's brightness among all hits so every lane gets used.
    let lo = 0;
    let hi = centroids.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (centroids[mid] < c) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(4, Math.floor((lo / centroids.length) * 5));
  };
  for (const f of onsets) {
    const t = onsetTime(f, frameTime) - firstBeat;
    if (t < 0) continue;
    const tick = Math.round(((t / beatSec) * RESOLUTION) / sixteenth) * sixteenth;
    if (!expert.has(tick)) expert.set(tick, laneFor(centroid[f]));
  }
  // Avoid long same-lane repeats: alternate to a neighbour when a lane repeats 3+ times.
  const ticks = [...expert.keys()].sort((a, b) => a - b);
  for (let i = 2; i < ticks.length; i++) {
    const l = expert.get(ticks[i]);
    if (l === expert.get(ticks[i - 1]) && l === expert.get(ticks[i - 2]))
      expert.set(ticks[i], l < 4 ? l + 1 : l - 1);
  }
  // Loud hits on the beat become chords on expert.
  const chords = new Set();
  for (const f of onsets) {
    const t = onsetTime(f, frameTime) - firstBeat;
    const tick = Math.round(((t / beatSec) * RESOLUTION) / sixteenth) * sixteenth;
    if (tick % RESOLUTION === 0 && flux[f] > strongest * 0.6 && expert.has(tick)) chords.add(tick);
  }

  const gridFor = { easy: RESOLUTION, medium: RESOLUTION / 2, hard: RESOLUTION / 2, expert: sixteenth };
  const maxLane = { easy: 2, medium: 3, hard: 4, expert: 4 };
  const lines = {};
  for (const [diff, grid] of Object.entries(gridFor)) {
    const out = [];
    for (const tick of ticks) {
      if (tick % grid !== 0) continue;
      const lane = Math.min(expert.get(tick), maxLane[diff]);
      out.push(`  ${tick} = N ${lane} 0`);
      if (diff === 'expert' && chords.has(tick)) out.push(`  ${tick} = N ${lane === 4 ? 2 : lane + 2} 0`);
    }
    lines[diff] = out;
  }
  // Star power: every 8th bar on expert/hard for 2 bars.
  const lastTick = ticks[ticks.length - 1] ?? 0;
  const sp = [];
  for (let bar = 4; bar * 4 * RESOLUTION < lastTick; bar += 8)
    sp.push(`  ${bar * 4 * RESOLUTION} = S 2 ${8 * RESOLUTION}`);

  const q = (s) => `"${String(s ?? '').replace(/"/g, "'")}"`;
  const chart = [
    '[Song]',
    '{',
    `  Name = ${q(meta.name || 'Auto-charted song')}`,
    `  Artist = ${q(meta.artist || 'Unknown Artist')}`,
    '  Charter = "Fretline auto-chart"',
    `  Offset = ${firstBeat.toFixed(3)}`,
    `  Resolution = ${RESOLUTION}`,
    '}',
    '[SyncTrack]',
    '{',
    '  0 = TS 4',
    `  0 = B ${Math.round(bpm * 1000)}`,
    '}',
    '[Events]',
    '{',
    '}',
    ...['Easy', 'Medium', 'Hard', 'Expert'].flatMap((d) => [
      `[${d}Single]`,
      '{',
      ...lines[d.toLowerCase()],
      ...(d === 'Easy' || d === 'Medium' ? [] : sp),
      '}',
    ]),
    '',
  ].join('\n');
  return { chart, bpm, noteCount: lines.expert.length };
}

/** Mixes an AudioBuffer down to mono. */
export function toMono(buffer) {
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  }
  return out;
}
