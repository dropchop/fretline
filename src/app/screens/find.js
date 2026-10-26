// Find songs: search Chorus Encore and add a chart straight to the library.
// Requests go out only from a search submit, a typing pause or a Download tap (see library/encore.js).
import { $, show, registerActions } from '../router.js';
import { EncoreClient, AutoSearch, EncoreError } from '../../library/encore.js';
import { ResultList } from '../../library/encoreResults.js';
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
  const results = new ResultList(client);
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
    for (const chart of results.charts) {
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
        ? chart.parts
            .map((p) =>
              p.level !== null
                ? `${p.label} ${p.level}`
                : p.notes
                  ? `${p.label} (${p.notes} notes)`
                  : p.label,
            )
            .join(' · ')
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
    more.hidden = !results.hasMore;
    more.disabled = results.busy;
  }

  async function runSearch(q) {
    say('Searching…');
    render();
    try {
      await results.search(q);
    } catch (err) {
      say(explain(err), true);
      render();
      return;
    }
    // A newer search can have replaced this one while it was in flight; it reports for itself.
    if (results.query !== q) return;
    render();
    say(
      results.charts.length
        ? `Showing ${results.charts.length} of ${results.total} for “${q}”.`
        : `Nothing found for “${q}”. Try a different spelling or fewer words.`,
    );
  }

  async function showMore() {
    if (results.busy || !results.hasMore) return;
    say('Loading more…');
    const loading = results.more();
    render();
    try {
      await loading;
    } catch (err) {
      say(explain(err), true);
      render();
      return;
    }
    render();
    say(`Showing ${results.charts.length} of ${results.total} for “${results.query}”.`);
  }

  async function addChart(chart, btn) {
    if (downloading) return;
    downloading = true;
    btn.disabled = true;
    btn.textContent = 'Downloading…';
    try {
      const blob = await client.download(chart.md5, (f) => {
        btn.textContent = `Downloading ${Math.round(f * 100)}%`;
      });
      const file = new File([blob], `${chart.md5}.sng`, { type: 'application/octet-stream' });
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
  more.addEventListener('click', showMore);
  registerActions({ 'find-songs': () => show('find') });
}
