import { describe, expect, it, vi } from 'vitest';
import {
  AutoSearch,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  EncoreClient,
  EncoreError,
  MAX_DOWNLOAD_BYTES,
  MIN_GAP_MS,
  PER_PAGE,
  REQUEST_LIMIT,
  SEARCH_URL,
  TYPING_DELAY_MS,
  WINDOW_MS,
  fileUrl,
  parseChart,
} from '../src/library/encore.js';
import { ResultList } from '../src/library/encoreResults.js';
import recorded from './fixtures/enchor-search.json';

// A real search reply (three hits for "test"), trimmed to the fields the client reads.
const fixture = recorded;
const MD5 = fixture.data[0].md5;

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

/** A client on a fake clock whose fetch is a mock. */
function setup(respond = () => json(fixture)) {
  const clock = { t: 1_000_000 };
  const fetch = vi.fn(async (/** @type {string} */ _url, /** @type {RequestInit} */ _init = {}) => respond());
  const client = new EncoreClient({ fetch, now: () => clock.t });
  return { client, fetch, clock };
}

describe('search', () => {
  it('posts the query as JSON and reads the recorded reply', async () => {
    const { client, fetch } = setup();
    const result = await client.search('  test ');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(SEARCH_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ search: 'test', per_page: PER_PAGE, page: 1 });
    expect(result.total).toBe(143);
    expect(result.cached).toBe(false);
    expect(result.charts.map((c) => c.name)).toEqual(['Test Flight', 'Speed Test', 'Insanisanity (Test)']);
    expect(result.charts[0]).toMatchObject({
      md5: MD5,
      artist: 'Chroma',
      charter: 'Xeratek',
      lengthMs: 136574,
      parts: [{ label: 'Guitar', level: 4, notes: 895 }],
    });
  });

  it('answers a repeated query from the session cache without a request', async () => {
    const { client, fetch, clock } = setup();
    await client.search('Test');
    clock.t += 5000;
    const again = await client.search('test ');
    expect(again.cached).toBe(true);
    expect(again.charts).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(1);
    // Another page of the same query is a different request.
    await client.search('test', 2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1][1].body)).page).toBe(2);
  });

  it('handles empty results', async () => {
    const { client } = setup(() => json({ found: 0, out_of: 0, page: 1, data: [] }));
    expect(await client.search('zzzz')).toMatchObject({ charts: [], total: 0 });
  });

  it('skips hits without an id or title and keeps the rest', async () => {
    const { client } = setup(() => json({ found: 3, data: [{ name: 'No id' }, null, fixture.data[1]] }));
    const { charts } = await client.search('x');
    expect(charts.map((c) => c.name)).toEqual(['Speed Test']);
  });

  it('reports a changed API shape instead of showing nonsense', async () => {
    for (const body of [{ results: [] }, { data: 'nope' }, null, 'text']) {
      const { client } = setup(() => json(body));
      await expect(client.search('x')).rejects.toMatchObject({ kind: 'shape' });
    }
    const { client } = setup(() => new Response('<html>', { status: 200 }));
    await expect(client.search('x')).rejects.toMatchObject({ kind: 'shape' });
  });

  it('turns a failed connection into a plain error and does not cache it', async () => {
    const { client, fetch, clock } = setup();
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(client.search('x')).rejects.toMatchObject({ kind: 'network' });
    clock.t += MIN_GAP_MS;
    await expect(client.search('x')).resolves.toMatchObject({ cached: false });
  });

  it('shows a chart the rating skipped but whose notes are there, from notesData', () => {
    // "Insanisanity (Test)" in the recorded reply has diff_guitar -1 and 805 expert guitar notes.
    const chart = parseChart(fixture.data[2]);
    expect(chart.parts).toEqual([{ label: 'Guitar', level: null, notes: 805 }]);
    // A rated part keeps its level and also gets the note count.
    expect(parseChart(fixture.data[0]).parts).toEqual([{ label: 'Guitar', level: 4, notes: 895 }]);
    // Parts this game can't play (6-fret, vocals) never show, even when listed.
    const odd = parseChart({
      md5: MD5,
      name: 'x',
      notesData: { instruments: ['guitarghl', 'vocals', 'drums'], noteCounts: [] },
    });
    expect(odd.parts).toEqual([{ label: 'Drums', level: null, notes: 0 }]);
  });

  it('parses a chart with several parts and skips 6-fret parts', () => {
    const chart = parseChart({
      md5: MD5.toUpperCase(),
      name: ' Song ',
      diff_guitar: 3,
      diff_drums: 0,
      diff_bass: -1,
      diff_guitarghl: 5,
    });
    expect(chart.md5).toBe(MD5);
    expect(chart.name).toBe('Song');
    expect(chart.artist).toBe('Unknown Artist');
    expect(chart.parts).toEqual([
      { label: 'Guitar', level: 3, notes: 0 },
      { label: 'Drums', level: 0, notes: 0 },
    ]);
    expect(parseChart({ md5: 'short', name: 'x' })).toBeNull();
  });
});

describe('throttle', () => {
  it('keeps at least MIN_GAP_MS between requests, without sending the held-back one', async () => {
    const { client, fetch, clock } = setup();
    await client.search('one');
    clock.t += MIN_GAP_MS - 1;
    await expect(client.search('two')).rejects.toMatchObject({ kind: 'throttled' });
    expect(fetch).toHaveBeenCalledTimes(1);
    clock.t += 1;
    await client.search('two');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it(`sends at most ${REQUEST_LIMIT} requests per ${WINDOW_MS / 1000} s, then frees up`, async () => {
    const { client, fetch, clock } = setup();
    for (let i = 0; i < REQUEST_LIMIT; i++) {
      await client.search(`query ${i}`);
      clock.t += MIN_GAP_MS;
    }
    expect(fetch).toHaveBeenCalledTimes(REQUEST_LIMIT);
    const err = await client.search('one too many').catch((e) => e);
    expect(err).toBeInstanceOf(EncoreError);
    expect(err.kind).toBe('throttled');
    expect(err.waitMs).toBeGreaterThan(0);
    expect(err.waitMs).toBeLessThanOrEqual(WINDOW_MS);
    expect(fetch).toHaveBeenCalledTimes(REQUEST_LIMIT);
    // Cached answers cost nothing, even while throttled.
    await expect(client.search('query 3')).resolves.toMatchObject({ cached: true });
    clock.t += WINDOW_MS;
    await client.search('one too many');
    expect(fetch).toHaveBeenCalledTimes(REQUEST_LIMIT + 1);
  });

  it('stays far below the 50 per window the site allows', () => {
    expect(REQUEST_LIMIT).toBeLessThanOrEqual(10);
    expect(WINDOW_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('counts downloads in the same budget', async () => {
    const { client, fetch, clock } = setup(() => new Response(new Uint8Array(4)));
    await client.download(MD5);
    clock.t += MIN_GAP_MS - 1;
    await expect(client.search('x')).rejects.toMatchObject({ kind: 'throttled' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('back-off', () => {
  it('stops all requests after a 429 until the back-off has passed, with no retry of its own', async () => {
    let status = 429;
    const { client, fetch, clock } = setup(() =>
      status === 429 ? new Response('', { status }) : json(fixture),
    );
    const first = await client.search('a').catch((e) => e);
    expect(first.kind).toBe('backoff');
    expect(first.status).toBe(429);
    expect(first.waitMs).toBe(BACKOFF_BASE_MS);
    expect(first.message).toMatch(/Pausing for 5 s/);
    clock.t += BACKOFF_BASE_MS - 1;
    await expect(client.search('b')).rejects.toMatchObject({ kind: 'backoff' });
    await expect(client.download(MD5)).rejects.toMatchObject({ kind: 'backoff' });
    expect(fetch).toHaveBeenCalledTimes(1);
    status = 200;
    clock.t += 1;
    await expect(client.search('b')).resolves.toMatchObject({ cached: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('says "slow down" only for a 429; a server error is described as an error', async () => {
    const { client: c429, clock: k429 } = setup(() => new Response('', { status: 429 }));
    await c429.search('a').catch(() => {});
    k429.t += 1000;
    expect((await c429.search('b').catch((e) => e)).message).toMatch(/asked us to slow down/);
    const { client: c503, clock: k503 } = setup(() => new Response('', { status: 503 }));
    const first = await c503.search('a').catch((e) => e);
    expect(first.message).toMatch(/had a problem \(error 503\)/);
    k503.t += 1000;
    const during = await c503.search('b').catch((e) => e);
    expect(during.message).toMatch(/error a moment ago/);
    expect(during.message).not.toMatch(/slow down/);
    expect(during.status).toBe(503);
  });

  it('doubles the pause for each failure in a row, up to a cap, and resets after a success', async () => {
    let fail = true;
    const { client, clock } = setup(() => (fail ? new Response('', { status: 503 }) : json(fixture)));
    const waits = [];
    for (let i = 0; i < 8; i++) {
      const err = await client.search('a').catch((e) => e);
      expect(err.kind).toBe('backoff');
      waits.push(err.waitMs);
      clock.t += err.waitMs;
    }
    expect(waits.slice(0, 4)).toEqual([5000, 10000, 20000, 40000]);
    expect(Math.max(...waits)).toBe(BACKOFF_MAX_MS);
    fail = false;
    clock.t += MIN_GAP_MS;
    await client.search('a');
    fail = true;
    clock.t += MIN_GAP_MS;
    const again = await client.search('fresh').catch((e) => e);
    expect(again.waitMs).toBe(BACKOFF_BASE_MS);
  });

  it('honours a longer Retry-After, within the cap', async () => {
    const { client } = setup(() => new Response('', { status: 429, headers: { 'retry-after': '30' } }));
    const err = await client.search('a').catch((e) => e);
    expect(err.waitMs).toBe(30_000);
    const { client: c2 } = setup(
      () => new Response('', { status: 429, headers: { 'retry-after': '99999' } }),
    );
    expect((await c2.search('a').catch((e) => e)).waitMs).toBe(BACKOFF_MAX_MS);
  });

  it('does not back off for a 404 on a download, and says the file is gone', async () => {
    const { client, clock } = setup(() => new Response('', { status: 404 }));
    const err = await client.download(MD5).catch((e) => e);
    expect(err).toMatchObject({ kind: 'http', status: 404 });
    expect(err.message).toMatch(/no longer has/);
    clock.t += MIN_GAP_MS;
    await expect(client.download(MD5)).rejects.toMatchObject({ kind: 'http' });
  });
});

describe('download', () => {
  it('gets the .sng from the file host and returns its bytes', async () => {
    const { client, fetch } = setup(() => new Response(new Uint8Array([83, 78, 71, 80, 75, 71])));
    const buf = await client.download(MD5);
    expect(fetch.mock.calls[0][0]).toBe(fileUrl(MD5));
    expect(fetch.mock.calls[0][0]).toBe(`https://files.enchor.us/${MD5}.sng`);
    expect([...new Uint8Array(await buf.arrayBuffer())]).toEqual([83, 78, 71, 80, 75, 71]);
  });

  it('reports progress when the size is known', async () => {
    const bytes = new Uint8Array(1000);
    const { client } = setup(() => new Response(bytes, { headers: { 'content-length': '1000' } }));
    const seen = [];
    const buf = await client.download(MD5, (f) => seen.push(f));
    expect(buf.size).toBe(1000);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('refuses a song bigger than the limit without reading it', async () => {
    const { client } = setup(
      () =>
        new Response(new Uint8Array(4), { headers: { 'content-length': String(MAX_DOWNLOAD_BYTES + 1) } }),
    );
    await expect(client.download(MD5)).rejects.toMatchObject({ kind: 'too-big' });
  });

  it('counts the bytes as they arrive, so the cap holds with no Content-Length', async () => {
    const chunk = new Uint8Array(400);
    let pulled = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
        if (pulled > 100) controller.close(); // a runaway reply: the client has to be the one to stop
      },
    });
    const clock = { t: 1_000_000 };
    const fetch = vi.fn(async () => new Response(stream));
    const client = new EncoreClient({ fetch, now: () => clock.t, maxBytes: 1000 });
    await expect(client.download(MD5)).rejects.toMatchObject({ kind: 'too-big' });
    expect(pulled).toBeLessThan(10);
  });

  it('accepts a streamed reply under the cap with no Content-Length', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(300));
        controller.enqueue(new Uint8Array(300));
        controller.close();
      },
    });
    const clock = { t: 1_000_000 };
    const client = new EncoreClient({
      fetch: async () => new Response(stream),
      now: () => clock.t,
      maxBytes: 1000,
    });
    expect((await client.download(MD5)).size).toBe(600);
  });

  it('is capped at 100 MB', () => {
    expect(MAX_DOWNLOAD_BYTES).toBe(100 * 1024 * 1024);
  });

  it('refuses an id that is not an md5, without a request', async () => {
    const { client, fetch } = setup();
    await expect(client.download('../etc/passwd')).rejects.toMatchObject({ kind: 'shape' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('no request without a user action', () => {
  it('sends nothing on load, while typing, or after waiting; only a submit or a typing pause searches', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async (/** @type {string} */ _url) => json(fixture));
      const client = new EncoreClient({ fetch });
      const auto = new AutoSearch((q) => client.search(q));
      // "Load the screen": nothing is constructed that sends anything, and time passing sends nothing.
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fetch).not.toHaveBeenCalled();
      // Typing, one key at a time, each before the pause is over.
      for (const text of ['t', 'te', 'tes', 'test']) {
        auto.input(text);
        await vi.advanceTimersByTimeAsync(TYPING_DELAY_MS - 100);
      }
      expect(fetch).not.toHaveBeenCalled();
      // The pause after the last key sends one search, not one per key.
      await vi.advanceTimersByTimeAsync(200);
      expect(fetch).toHaveBeenCalledTimes(1);
      // Waiting longer sends nothing more: no polling, no refresh.
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(fetch).toHaveBeenCalledTimes(1);
      // A short query never searches by typing alone, a submit always does.
      auto.input('ab');
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetch).toHaveBeenCalledTimes(1);
      auto.submit('ab');
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('types the same query again without a second request', async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn();
      const auto = new AutoSearch(run);
      auto.input('test');
      await vi.advanceTimersByTimeAsync(TYPING_DELAY_MS);
      auto.input('test');
      await vi.advanceTimersByTimeAsync(TYPING_DELAY_MS * 2);
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the global timers in a way a browser accepts', async () => {
    // Browsers throw "Illegal invocation" when setTimeout is called with another object as `this`.
    const timers = [];
    vi.stubGlobal('setTimeout', function (/** @type {() => void} */ fn) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      timers.push(fn);
      return timers.length;
    });
    vi.stubGlobal('clearTimeout', function () {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    });
    try {
      const run = vi.fn();
      const auto = new AutoSearch(run);
      auto.input('test');
      auto.input('tests');
      timers[timers.length - 1]();
      expect(run).toHaveBeenCalledWith('tests');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('types at least half a second apart', () => {
    expect(TYPING_DELAY_MS).toBeGreaterThanOrEqual(500);
  });
});

describe('the result list and Show more', () => {
  /** Pages of 8 charts named P<page>-<n>; 40 found. */
  const pageBody = (page) => ({
    found: 40,
    page,
    data: Array.from({ length: 8 }, (_, i) => ({
      md5: String(page).padStart(2, '0') + String(i).padStart(30, '0'),
      name: `P${page}-${i}`,
      diff_guitar: 1,
    })),
  });
  const names = (list) => list.charts.map((c) => c.name);
  const pagesOf = (list) => [...new Set(names(list).map((n) => n.split('-')[0]))];

  /** A client whose fetch answers by the requested page, and can be told to fail or to wait. */
  function listSetup() {
    const clock = { t: 1_000_000 };
    const control = { fail: new Set(), gate: null };
    const requested = [];
    const fetch = vi.fn(async (/** @type {string} */ _url, /** @type {RequestInit} */ init = {}) => {
      const { page } = JSON.parse(String(init.body));
      requested.push(page);
      if (control.gate) await control.gate;
      if (control.fail.has(page)) return new Response('', { status: 503 });
      return json(pageBody(page));
    });
    const client = new EncoreClient({ fetch, now: () => clock.t });
    return { list: new ResultList(client), clock, control, requested };
  }

  it('adds pages in order', async () => {
    const { list, clock } = listSetup();
    await list.search('x');
    expect(list.page).toBe(1);
    expect(list.hasMore).toBe(true);
    clock.t += MIN_GAP_MS;
    expect(await list.more()).toBe(true);
    expect(pagesOf(list)).toEqual(['P1', 'P2']);
    expect(list.page).toBe(2);
  });

  it('ignores a second tap while Show more is in flight, so the page that is coming is not thrown away', async () => {
    const { list, clock, control, requested } = listSetup();
    await list.search('x');
    clock.t += MIN_GAP_MS;
    /** @type {(value?: unknown) => void} */
    let open = () => {};
    control.gate = new Promise((resolve) => (open = resolve));
    const first = list.more();
    clock.t += MIN_GAP_MS;
    const second = list.more();
    expect(await second).toBe(false);
    expect(list.busy).toBe(true);
    open();
    expect(await first).toBe(true);
    expect(requested).toEqual([1, 2]);
    expect(pagesOf(list)).toEqual(['P1', 'P2']);
    // The next tap asks for page 3, not page 4.
    control.gate = null;
    clock.t += MIN_GAP_MS;
    await list.more();
    expect(requested).toEqual([1, 2, 3]);
    expect(pagesOf(list)).toEqual(['P1', 'P2', 'P3']);
  });

  it('asks for the same page again after a refused request, with no gap', async () => {
    const { list, clock, requested } = listSetup();
    await list.search('x');
    // Tapped less than a second after the search: the client refuses without a request.
    await expect(list.more()).rejects.toMatchObject({ kind: 'throttled' });
    expect(list.page).toBe(1);
    expect(list.busy).toBe(false);
    expect(requested).toEqual([1]);
    clock.t += MIN_GAP_MS;
    await list.more();
    expect(requested).toEqual([1, 2]);
    expect(pagesOf(list)).toEqual(['P1', 'P2']);
  });

  it('asks for the same page again after a 503 and its back-off, with no gap', async () => {
    const { list, clock, control, requested } = listSetup();
    await list.search('x');
    clock.t += MIN_GAP_MS;
    control.fail.add(2);
    await expect(list.more()).rejects.toMatchObject({ kind: 'backoff', status: 503 });
    expect(list.page).toBe(1);
    expect(pagesOf(list)).toEqual(['P1']);
    // During the pause nothing is sent, and the page still has not moved.
    clock.t += BACKOFF_BASE_MS - 1;
    await expect(list.more()).rejects.toMatchObject({ kind: 'backoff' });
    expect(requested).toEqual([1, 2]);
    clock.t += 1;
    control.fail.clear();
    await list.more();
    expect(requested).toEqual([1, 2, 2]);
    expect(pagesOf(list)).toEqual(['P1', 'P2']);
    expect(list.charts).toHaveLength(16);
  });

  it('drops a page that arrives after a newer search replaced the list', async () => {
    const { list, clock, control } = listSetup();
    await list.search('x');
    clock.t += MIN_GAP_MS;
    /** @type {(value?: unknown) => void} */
    let open = () => {};
    control.gate = new Promise((resolve) => (open = resolve));
    const late = list.more();
    clock.t += MIN_GAP_MS;
    control.gate = null;
    await list.search('y');
    open();
    expect(await late).toBe(false);
    expect(pagesOf(list)).toEqual(['P1']);
    expect(list.query).toBe('y');
    expect(list.charts).toHaveLength(8);
    expect(list.busy).toBe(false);
  });

  it('has no more once everything found is shown, and ignores Show more then', async () => {
    const { list, clock, requested } = listSetup();
    await list.search('x');
    for (let p = 2; p <= 5; p++) {
      clock.t += MIN_GAP_MS;
      await list.more();
    }
    expect(list.charts).toHaveLength(40);
    expect(list.hasMore).toBe(false);
    expect(await list.more()).toBe(false);
    expect(requested).toEqual([1, 2, 3, 4, 5]);
  });
});
