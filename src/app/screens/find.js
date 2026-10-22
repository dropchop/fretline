// Find songs: search Chorus Encore and add a chart straight to the library.
// Requests go out only from a search submit, a typing pause or a Download tap (see library/encore.js).
import { $, show, registerActions } from '../router.js';
import { EncoreClient, AutoSearch, EncoreError } from '../../library/encore.js';
import { handleImport } from './library.js';

const formatLength = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function initFind() {
  const client = new EncoreClient();
  const status = $('#findStatus');
  const list = $('#findResults');
  const more = $('#findMore');
  const input = $('#findQuery');
  /** @type {import('../../library/encore.js').EncoreChart[]} */
  let charts = [];
  let total = 0;
  let query = '';
  let page = 1;
  let token = 0;
  let downloading = false;
  const added = new Set();

  const say = (msg, isError = false) => {
    status.textContent = msg;
    status.classList.toggle('error', isError);
  };
  const explain = (err) =>
    err instanceof EncoreError
      ? err.message
      : 'Something went wrong talking to Chorus Encore. Try again in a moment.';

  function render() {
    list.replaceChildren();
    for (const chart of charts) {
      const li = document.createElement('li');
      const info = document.createElement('div');
      info.className = 'find-info';
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = chart.name;
      const meta = document.createElement('span');
      meta.className = 'artist';
      meta.textContent = [
        chart.artist,
        chart.charter && `charted by ${chart.charter}`,
        chart.lengthMs && formatLength(chart.lengthMs),
      ]
        .filter(Boolean)
        .join(' · ');
      const parts = document.createElement('span');
      parts.className = 'parts';
      parts.textContent = chart.parts.length
        ? chart.parts.map((p) => `${p.label} ${p.level}`).join(' · ')
        : 'No parts this game can play';
      info.append(title, meta, parts);
      const btn = document.createElement('button');
      btn.className = 'btn find-add';
      btn.dataset.md5 = chart.md5;
      if (added.has(chart.md5)) {
        btn.textContent = 'Added ✓';
        btn.disabled = true;
      } else if (!chart.parts.length) {
        btn.textContent = 'Not playable';
        btn.disabled = true;
      } else {
        btn.textContent = 'Download & add';
        btn.addEventListener('click', () => addChart(chart, btn));
      }
      li.append(info, btn);
      list.append(li);
    }
    more.hidden = !(charts.length && charts.length < total);
  }

  async function runSearch(q, nextPage = 1) {
    const mine = ++token;
    query = q;
    page = nextPage;
    if (nextPage === 1) {
      charts = [];
      total = 0;
      render();
    }
    say('Searching…');
    try {
      const result = await client.search(q, nextPage);
      if (mine !== token) return;
      charts = nextPage === 1 ? result.charts : [...charts, ...result.charts];
      total = result.total;
      render();
      say(
        charts.length
          ? `Showing ${charts.length} of ${total} for “${q}”.`
          : `Nothing found for “${q}”. Try a different spelling or fewer words.`,
      );
    } catch (err) {
      if (mine !== token) return;
      say(explain(err), true);
      render();
    }
  }

  async function addChart(chart, btn) {
    if (downloading) return;
    downloading = true;
    btn.disabled = true;
    btn.textContent = 'Downloading…';
    try {
      const buffer = await client.download(chart.md5, (f) => {
        btn.textContent = `Downloading ${Math.round(f * 100)}%`;
      });
      const file = new File([buffer], `${chart.md5}.sng`, { type: 'application/octet-stream' });
      const saved = await handleImport([file]);
      if (saved) {
        added.add(chart.md5);
        btn.textContent = 'Added ✓';
        say(`Added “${chart.name}” to your library.`);
      } else {
        btn.disabled = false;
        btn.textContent = 'Download & add';
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Download & add';
      say(explain(err), true);
    } finally {
      downloading = false;
    }
  }

  const auto = new AutoSearch((q) => runSearch(q));
  input.addEventListener('input', () => auto.input(input.value));
  $('#findForm').addEventListener('submit', (e) => {
    e.preventDefault();
    auto.submit(input.value);
  });
  more.addEventListener('click', () => runSearch(query, page + 1));
  registerActions({ 'find-songs': () => show('find') });
}
