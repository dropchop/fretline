// Turns a plain audio file into a song package by generating a chart from the audio.
import { autoChart, toMono } from '../chart/autoChart.js';
import { getAudioContext } from '../audio/player.js';

/** Guesses "Artist - Title" from a file name. */
export function metaFromFileName(fileName) {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m
    ? { artist: m[1].trim(), name: m[2].trim() }
    : { artist: 'Unknown Artist', name: base || 'Untitled' };
}

/**
 * @param {File} file
 * @returns {Promise<{files: Record<string, Blob>, meta: object, bpm: number, noteCount: number}>}
 */
export async function autoChartFile(file) {
  const ctx = getAudioContext();
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  const meta = metaFromFileName(file.name);
  const { chart, bpm, noteCount } = autoChart(toMono(buffer), buffer.sampleRate, meta);
  if (noteCount < 8) throw new Error('not enough clear beats found in this audio');
  const ext = (file.name.match(/\.([^.]+)$/)?.[1] || 'mp3').toLowerCase();
  const ini = `[song]\nname = ${meta.name}\nartist = ${meta.artist}\ncharter = Fretline auto-chart\nsong_length = ${Math.round(buffer.duration * 1000)}\n`;
  return {
    files: {
      'notes.chart': new Blob([chart], { type: 'text/plain' }),
      'song.ini': new Blob([ini], { type: 'text/plain' }),
      [`song.${ext}`]: file,
    },
    meta: { ...meta, charter: 'Fretline auto-chart', lengthMs: Math.round(buffer.duration * 1000) },
    bpm,
    noteCount,
  };
}
