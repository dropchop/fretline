// Minimal parser for song.ini files. Returns the [song] section with lowercased keys.
export function parseSongIni(text) {
  const out = {};
  let inSong = false;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      inSong = header[1].trim().toLowerCase() === 'song';
      continue;
    }
    if (!inSong) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Strips Clone Hero color/formatting tags such as <color=#FF0000>...</color> and <b>. */
export function stripTags(text) {
  return text ? String(text).replace(/<[^>]+>/g, '') : text;
}
