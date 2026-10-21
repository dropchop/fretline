// Parser for the text-based .chart format used by Clone Hero / Moonscraper.
import { TempoMap } from './tempoMap.js';
import { OPEN_LANE } from './constants.js';

const CHART_INSTRUMENTS = {
  Single: 'guitar',
  DoubleGuitar: 'coop',
  DoubleBass: 'bass',
  DoubleRhythm: 'rhythm',
  Keyboard: 'keys',
  Drums: 'drums',
};

const DIFFICULTY_PREFIX = { Easy: 'easy', Medium: 'medium', Hard: 'hard', Expert: 'expert' };

// Splits the file into { sectionName: string[] } of the raw lines inside each {...} block.
function splitSections(text) {
  const sections = {};
  let current = null;
  let lines = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      current = line.slice(1, -1);
      lines = [];
      continue;
    }
    if (line === '{') continue;
    if (line === '}') {
      if (current !== null) sections[current] = lines;
      current = null;
      continue;
    }
    if (current !== null) lines.push(line);
  }
  return sections;
}

function unquote(value) {
  const v = value.trim();
  return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

// "tick = TYPE a b" -> { tick, type, args: [a, b], rest }
function parseEventLine(line) {
  const eq = line.indexOf('=');
  if (eq < 0) return null;
  const tick = Number(line.slice(0, eq).trim());
  if (!Number.isFinite(tick)) return null;
  const rhs = line.slice(eq + 1).trim();
  const space = rhs.indexOf(' ');
  const type = space < 0 ? rhs : rhs.slice(0, space);
  const rest = space < 0 ? '' : rhs.slice(space + 1).trim();
  return { tick, type, rest, args: rest.split(/\s+/) };
}

/**
 * @param {string} text contents of notes.chart
 * @returns {import('./constants.js').ParsedSong}
 */
export function parseChart(text) {
  const sections = splitSections(text.replace(/^\uFEFF/, ''));
  if (!sections.Song) throw new Error('Not a valid .chart file: missing [Song] section');

  const meta = {};
  for (const line of sections.Song) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    meta[line.slice(0, eq).trim()] = unquote(line.slice(eq + 1));
  }
  const resolution = Number(meta.Resolution) || 192;

  const tempos = [];
  const timeSignatures = [];
  for (const line of sections.SyncTrack ?? []) {
    const ev = parseEventLine(line);
    if (!ev) continue;
    if (ev.type === 'B') tempos.push({ tick: ev.tick, bpm: Number(ev.args[0]) / 1000 });
    if (ev.type === 'TS') {
      const exp = ev.args[1] !== undefined ? Number(ev.args[1]) : 2;
      timeSignatures.push({ tick: ev.tick, numerator: Number(ev.args[0]), denominator: 2 ** exp });
    }
  }

  const sectionMarkers = [];
  for (const line of sections.Events ?? []) {
    const ev = parseEventLine(line);
    if (!ev || ev.type !== 'E') continue;
    const m = unquote(ev.rest).match(/^section (.+)$/);
    if (m) sectionMarkers.push({ tick: ev.tick, name: m[1].replace(/_/g, ' ') });
  }

  /** @type {Record<string, import('./constants.js').ParsedTrack>} */
  const tracks = {};
  for (const [name, lines] of Object.entries(sections)) {
    const m = name.match(/^(Easy|Medium|Hard|Expert)(\w+)$/);
    if (!m || !CHART_INSTRUMENTS[m[2]]) continue;
    const track = CHART_INSTRUMENTS[m[2]] === 'drums' ? parseDrumTrack(lines) : parseTrack(lines);
    if (track.notes.length) {
      tracks[`${CHART_INSTRUMENTS[m[2]]}:${DIFFICULTY_PREFIX[m[1]]}`] = track;
    }
  }

  return {
    format: 'chart',
    resolution,
    tempoMap: new TempoMap(resolution, tempos, timeSignatures),
    meta: {
      name: meta.Name,
      artist: meta.Artist,
      charter: meta.Charter,
      album: meta.Album,
      year: meta.Year?.replace(/^,\s*/, ''),
      // [Song] Offset is in seconds.
      offsetMs: Number(meta.Offset || 0) * 1000,
      previewStartMs: meta.PreviewStart ? Number(meta.PreviewStart) * 1000 : undefined,
      musicStream: meta.MusicStream,
    },
    sections: sectionMarkers,
    tracks,
    // Community default for .chart files: 65/192 of a beat.
    hopoThresholdTicks: (resolution * 65) / 192,
  };
}

// Drums: N 0 = kick, N 1-4 = red/yellow/blue/green pads, N 66-68 mark yellow/blue/green as
// cymbals. 2x kick (32), accents (34-38) and ghosts (40-44) are ignored.
function parseDrumTrack(lines) {
  const gems = [];
  const cymbals = new Set(); // "tick:lane"
  const starPower = [];
  for (const line of lines) {
    const ev = parseEventLine(line);
    if (!ev) continue;
    if (ev.type === 'N') {
      const fret = Number(ev.args[0]);
      if (fret === 0) gems.push({ tick: ev.tick, lane: OPEN_LANE, length: 0, force: null, tap: false });
      else if (fret >= 1 && fret <= 4)
        gems.push({ tick: ev.tick, lane: fret - 1, length: 0, force: null, tap: false });
      else if (fret >= 66 && fret <= 68) cymbals.add(`${ev.tick}:${fret - 65}`);
    } else if (ev.type === 'S' && Number(ev.args[0]) === 2) {
      starPower.push({ tick: ev.tick, length: Number(ev.args[1]) || 0 });
    }
  }
  const notes = gems.map((g) => ({ ...g, cymbal: cymbals.has(`${g.tick}:${g.lane}`) }));
  notes.sort((a, b) => a.tick - b.tick || a.lane - b.lane);
  return { notes, starPower, solos: [] };
}

function parseTrack(lines) {
  // Gather modifiers per tick first; they apply to every gem at that tick.
  const gems = [];
  const forced = new Set();
  const tap = new Set();
  const starPower = [];
  const solos = [];
  let soloStart = null;
  for (const line of lines) {
    const ev = parseEventLine(line);
    if (!ev) continue;
    if (ev.type === 'N') {
      const fret = Number(ev.args[0]);
      const length = Number(ev.args[1]) || 0;
      if (fret >= 0 && fret <= 4) gems.push({ tick: ev.tick, lane: fret, length });
      else if (fret === 7) gems.push({ tick: ev.tick, lane: 7, length });
      else if (fret === 5) forced.add(ev.tick);
      else if (fret === 6) tap.add(ev.tick);
    } else if (ev.type === 'S' && Number(ev.args[0]) === 2) {
      starPower.push({ tick: ev.tick, length: Number(ev.args[1]) || 0 });
    } else if (ev.type === 'E') {
      if (ev.rest === 'solo') soloStart = ev.tick;
      if (ev.rest === 'soloend' && soloStart !== null) {
        solos.push({ tick: soloStart, length: ev.tick - soloStart });
        soloStart = null;
      }
    }
  }
  const notes = gems.map((g) => ({
    ...g,
    force: /** @type {'toggle'|null} */ (forced.has(g.tick) ? 'toggle' : null),
    tap: tap.has(g.tick),
  }));
  notes.sort((a, b) => a.tick - b.tick || a.lane - b.lane);
  return { notes, starPower, solos };
}
