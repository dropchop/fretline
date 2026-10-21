// Main menu: the song library and importing songs.
import { $, loading, toast, reset, registerActions } from '../router.js';
import { state } from '../state.js';
import { importFiles, albumArt } from '../../library/loader.js';
import { listSongs, saveSong, deleteSong, requestPersistentStorage } from '../../library/store.js';
import { getBestForSong } from '../../library/highscores.js';
import { openSong, openDemo } from './setup.js';
import { autoChartFile } from '../../library/autoImport.js';

export async function refreshLibrary() {
  try {
    state.library = await listSongs();
  } catch {
    state.library = [];
  }
  renderLibrary();
}

export function renderLibrary() {
  state.artUrls.forEach((u) => URL.revokeObjectURL(u));
  state.artUrls = [];
  const q = $('#search').value.trim().toLowerCase();
  const list = $('#songList');
  list.replaceChildren();
  const songs = state.library.filter((s) => `${s.meta.name} ${s.meta.artist}`.toLowerCase().includes(q));
  for (const song of songs) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    const art = albumArt(song.files);
    if (art) {
      const url = URL.createObjectURL(art);
      state.artUrls.push(url);
      thumb.style.backgroundImage = `url("${url}")`;
    }
    const text = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = song.meta.name;
    const artist = document.createElement('span');
    artist.className = 'artist';
    artist.textContent = song.meta.artist;
    text.append(title, artist);
    const best = getBestForSong(song.id);
    if (best) {
      const b = document.createElement('span');
      b.className = 'best';
      b.textContent = `${'★'.repeat(Math.min(5, best.stars))}${best.fullCombo ? ' FC' : ''} ${best.score.toLocaleString()}`;
      text.append(b);
    }
    btn.append(thumb, text);
    btn.addEventListener('click', () => openSong(song));
    li.append(btn);
    list.append(li);
  }
  $('#emptyLibrary').hidden = state.library.length > 0;
}

export async function handleImport(fileList) {
  if (!fileList?.length) return;
  loading('Importing songs…');
  try {
    const { songs, errors } = await importFiles(fileList);
    let saved = 0;
    for (const pkg of songs) {
      try {
        await saveSong(pkg);
        saved++;
      } catch (err) {
        errors.push(`${pkg.meta.name}: couldn't save (${err?.message || 'storage error'})`);
      }
    }
    if (saved) requestPersistentStorage();
    await refreshLibrary();
    const lines = [];
    if (saved) lines.push(`Added ${saved} song${saved === 1 ? '' : 's'}.`);
    lines.push(...errors.slice(0, 4));
    if (errors.length > 4) lines.push(`…and ${errors.length - 4} more problems.`);
    toast(lines.join('\n'), errors.length ? 8000 : 3000);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  } finally {
    loading(null);
  }
}

async function handleAutoChart(file) {
  if (!file) return;
  loading('Listening for beats…');
  try {
    const { files, meta, bpm, noteCount } = await autoChartFile(file);
    const id = `auto|${meta.artist}|${meta.name}`.toLowerCase();
    await saveSong({ id, files, meta });
    requestPersistentStorage();
    await refreshLibrary();
    toast(`Charted "${meta.name}": ${Math.round(bpm)} BPM, ${noteCount} notes on expert.`);
  } catch (err) {
    toast(`Couldn't auto-chart ${file.name}: ${err.message}`, 7000);
  } finally {
    loading(null);
  }
}

export function initLibrary() {
  $('#audioInput').addEventListener('change', (e) => {
    handleAutoChart(e.target.files[0]);
    e.target.value = '';
  });
  for (const id of ['#fileInput', '#folderInput']) {
    $(id).addEventListener('change', (e) => {
      handleImport([...e.target.files]);
      e.target.value = '';
    });
  }
  // iOS can't pick folders; hide the option there.
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) $('#folderButton').hidden = true;
  $('#search').addEventListener('input', renderLibrary);
  registerActions({
    'play-demo': openDemo,
    'to-library': () => reset(['menu']),
    'delete-song': async () => {
      const pkg = state.selected?.pkg;
      if (!pkg || !confirm(`Remove "${pkg.meta.name}" from this device?`)) return;
      await deleteSong(pkg.id);
      await refreshLibrary();
      reset(['menu']);
    },
  });
  refreshLibrary();
}
