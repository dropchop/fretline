// Turns user-picked files (song folders, loose files or .zip archives) into playable songs.
import JSZip from 'jszip';
import { parseChart } from '../chart/chartFile.js';
import { parseMid } from '../chart/midiFile.js';
import { parseSongIni, stripTags } from '../chart/ini.js';

const AUDIO_EXT = /\.(ogg|opus|mp3|wav|m4a|aac|flac)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const CHART_FILES = ['notes.mid', 'notes.chart'];

/**
 * @typedef {object} SongPackage
 * @property {string} id
 * @property {Record<string, Blob>} files keyed by lowercase file name
 * @property {{name: string, artist: string, charter?: string, album?: string, year?: string,
 *   lengthMs?: number}} meta
 */

const baseName = (path) => path.split('/').pop();
const dirName = (path) => path.split('/').slice(0, -1).join('/');

async function expandFiles(fileList) {
  /** @type {{path: string, blob: Blob}[]} */
  const entries = [];
  const unsupported = [];
  for (const file of fileList) {
    const path = file.webkitRelativePath || file.name;
    if (/\.zip$/i.test(file.name)) {
      const zip = await JSZip.loadAsync(file);
      const jobs = [];
      zip.forEach((relPath, entry) => {
        if (entry.dir || relPath.startsWith('__MACOSX/')) return;
        jobs.push(entry.async('blob').then((blob) => entries.push({ path: `${file.name}/${relPath}`, blob })));
      });
      await Promise.all(jobs);
    } else if (/\.sng$/i.test(file.name)) {
      unsupported.push(file.name);
    } else {
      entries.push({ path, blob: file });
    }
  }
  return { entries, unsupported };
}

/**
 * Finds every song folder in the picked files. Loose files picked together (common on phones,
 * which can't pick folders) are treated as one song.
 * @returns {Promise<{songs: SongPackage[], errors: string[]}>}
 */
export async function importFiles(fileList) {
  const { entries, unsupported } = await expandFiles(fileList);
  const byDir = new Map();
  for (const e of entries) {
    const dir = dirName(e.path);
    if (!byDir.has(dir)) byDir.set(dir, {});
    byDir.get(dir)[baseName(e.path).toLowerCase()] = e.blob;
  }

  const songs = [];
  const errors = unsupported.map((n) => `${n}: .sng files aren't supported yet; use the song folder or a .zip`);
  for (const [dir, files] of byDir) {
    if (!CHART_FILES.some((f) => files[f])) continue;
    try {
      const { meta } = await readPackage(files);
      if (!Object.keys(files).some((f) => AUDIO_EXT.test(f))) throw new Error('no audio files found');
      songs.push({ id: songId(meta), files, meta });
    } catch (err) {
      errors.push(`${dir || 'Selected files'}: ${err.message}`);
    }
  }
  if (!songs.length && !errors.length) {
    errors.push('No songs found. A song needs notes.chart or notes.mid plus its audio (e.g. song.ogg).');
  }
  return { songs, errors };
}

function songId(meta) {
  return [meta.artist, meta.name, meta.charter].map((s) => (s || '').toLowerCase().trim()).join('|');
}

/**
 * Parses a song's chart and song.ini.
 * @param {Record<string, Blob>} files
 */
export async function readPackage(files) {
  const ini = files['song.ini'] ? parseSongIni(await files['song.ini'].text()) : {};
  let song;
  if (files['notes.mid']) song = parseMid(await files['notes.mid'].arrayBuffer());
  else song = parseChart(await files['notes.chart'].text());

  const pick = (...vals) => vals.find((v) => v !== undefined && v !== '');
  const meta = {
    name: stripTags(pick(ini.name, song.meta.name, 'Unknown Song')),
    artist: stripTags(pick(ini.artist, song.meta.artist, 'Unknown Artist')),
    charter: stripTags(pick(ini.charter, ini.frets, song.meta.charter)),
    album: stripTags(pick(ini.album, song.meta.album)),
    year: pick(ini.year, song.meta.year),
    lengthMs: ini.song_length ? Number(ini.song_length) : undefined,
  };
  // song.ini delay (ms) and the .chart Offset both shift the chart against the audio.
  // Assumption: positive values make notes come later; most charts leave both at 0.
  const offsetMs = (Number(ini.delay) || 0) + (song.meta.offsetMs || 0);
  const hopoThresholdTicks = ini.hopo_frequency ? Number(ini.hopo_frequency) : undefined;
  return { song, meta, offsetMs, hopoThresholdTicks };
}

/** Audio stems for playback, excluding the menu preview clip. */
export function audioStems(files) {
  return Object.entries(files)
    .filter(([name]) => AUDIO_EXT.test(name) && !name.startsWith('preview'))
    .map(([name, blob]) => ({ name: name.replace(AUDIO_EXT, ''), blob }));
}

export function albumArt(files) {
  const name = Object.keys(files).find((f) => /^album\./.test(f) && IMAGE_EXT.test(f));
  return name ? files[name] : null;
}
