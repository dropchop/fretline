// Client for Chorus Encore (https://www.enchor.us), the community song index: search its charts and
// download one as a .sng file. The API is undocumented, so every response is checked before it is used.
//
// The maintainer's condition for this feature is: don't hammer the site. So the client:
//   - sends a request only when the caller asks (a search submit, a typing pause, a Download tap);
//     it never polls, prefetches or refreshes in the background;
//   - answers a repeated search from a session cache without a request;
//   - keeps itself under REQUEST_LIMIT requests per WINDOW_MS (the site allows about 50 per window)
//     and at least MIN_GAP_MS apart, by refusing the extra calls rather than queueing them;
//   - after a 429 or a 5xx, makes no request at all until a back-off has passed, and never retries by itself.
// Songs are fetched straight from the site into the user's browser; nothing passes through our servers.

export const SEARCH_URL = 'https://api.enchor.us/search';
export const fileUrl = (md5) => `https://files.enchor.us/${md5}.sng`;
export const SITE_URL = 'https://www.enchor.us/';

export const PER_PAGE = 8;
/** At most this many requests in any WINDOW_MS (searches and downloads together). */
export const REQUEST_LIMIT = 10;
export const WINDOW_MS = 60_000;
/** Least time between two requests. */
export const MIN_GAP_MS = 1000;
/** The first back-off after a 429 or 5xx; it doubles for each failure in a row, up to BACKOFF_MAX_MS. */
export const BACKOFF_BASE_MS = 5000;
export const BACKOFF_MAX_MS = 120_000;
/** Typing pauses this long before a search is sent, and only for queries of at least MIN_QUERY_LENGTH. */
export const TYPING_DELAY_MS = 800;
export const MIN_QUERY_LENGTH = 3;
/** A song bigger than this is not fetched into memory. */
export const MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024;
const CACHE_LIMIT = 40;

/** Parts of a chart this game can play, from the `diff_*` fields of a search result. */
const PARTS = [
  ['guitar', 'Guitar'],
  ['guitar_coop', 'Co-op guitar'],
  ['rhythm', 'Rhythm'],
  ['bass', 'Bass'],
  ['keys', 'Keys'],
  ['drums', 'Drums'],
];

/**
 * kind: 'throttled' (we held the request back), 'backoff' (the site asked us to slow down),
 * 'http' (some other bad status), 'network' (couldn't connect), 'shape' (the reply wasn't what we expect),
 * 'too-big' (the download is larger than we'll hold).
 */
export class EncoreError extends Error {
  /**
   * @param {'throttled'|'backoff'|'http'|'network'|'shape'|'too-big'} kind
   * @param {string} message plain text for the player
   * @param {{waitMs?: number, status?: number}} [extra]
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'EncoreError';
    this.kind = kind;
    this.waitMs = extra.waitMs ?? 0;
    this.status = extra.status ?? 0;
  }
}

/**
 * @typedef {object} EncoreChart
 * @property {string} md5
 * @property {string} name
 * @property {string} artist
 * @property {string} charter
 * @property {string} album
 * @property {string} year
 * @property {number} lengthMs 0 when unknown
 * @property {{label: string, level: number}[]} parts parts this game can play, level 0-6
 */

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** Reads one search hit; null when it lacks what we need (an id and a title). */
export function parseChart(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const md5 = text(raw.md5).toLowerCase();
  const name = text(raw.name);
  if (!/^[0-9a-f]{32}$/.test(md5) || !name) return null;
  const parts = [];
  for (const [key, label] of PARTS) {
    const level = raw[`diff_${key}`];
    if (typeof level === 'number' && level >= 0) parts.push({ label, level });
  }
  return {
    md5,
    name,
    artist: text(raw.artist) || 'Unknown Artist',
    charter: text(raw.charter),
    album: text(raw.album),
    year: text(raw.year),
    lengthMs: typeof raw.song_length === 'number' && raw.song_length > 0 ? raw.song_length : 0,
    parts,
  };
}

/**
 * @typedef {object} EncoreClientOptions
 * @property {typeof fetch} [fetch]
 * @property {() => number} [now] milliseconds, for tests
 */

export class EncoreClient {
  /** @param {EncoreClientOptions} [options] */
  constructor({ fetch: fetchImpl, now = () => Date.now() } = {}) {
    this.fetch = fetchImpl ?? ((...args) => fetch(...args));
    this.now = now;
    /** Times of the requests sent in the current window. */
    this.sent = [];
    this.blockedUntil = 0;
    this.failures = 0;
    /** @type {Map<string, {charts: EncoreChart[], total: number}>} */
    this.cache = new Map();
    /** Requests this client has sent over the network; tests and the UI can read it. */
    this.requestCount = 0;
  }

  /** Throws unless a request may go out now; records it as sent otherwise. */
  #admit() {
    const now = this.now();
    if (now < this.blockedUntil) {
      const waitMs = this.blockedUntil - now;
      throw new EncoreError(
        'backoff',
        `Chorus Encore asked us to slow down. Try again in ${Math.ceil(waitMs / 1000)} s.`,
        { waitMs },
      );
    }
    this.sent = this.sent.filter((t) => now - t < WINDOW_MS);
    const last = this.sent[this.sent.length - 1];
    if (last !== undefined && now - last < MIN_GAP_MS) {
      throw new EncoreError('throttled', 'One moment, then try again.', {
        waitMs: MIN_GAP_MS - (now - last),
      });
    }
    if (this.sent.length >= REQUEST_LIMIT) {
      const waitMs = WINDOW_MS - (now - this.sent[0]);
      throw new EncoreError(
        'throttled',
        `That's a lot of requests to Chorus Encore. Try again in ${Math.ceil(waitMs / 1000)} s.`,
        { waitMs },
      );
    }
    this.sent.push(now);
    this.requestCount++;
  }

  /** @param {Response} res */
  #checkStatus(res) {
    if (res.ok || res.status === 206) {
      this.failures = 0;
      return;
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      const own = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.failures);
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(BACKOFF_MAX_MS, retryAfter * 1000) : own;
      this.failures++;
      this.blockedUntil = this.now() + Math.max(waitMs, own);
      throw new EncoreError(
        'backoff',
        res.status === 429
          ? `Chorus Encore says we're asking too often. Pausing for ${Math.ceil(Math.max(waitMs, own) / 1000)} s.`
          : `Chorus Encore had a problem (error ${res.status}). Pausing for ${Math.ceil(Math.max(waitMs, own) / 1000)} s before the next request.`,
        { waitMs: Math.max(waitMs, own), status: res.status },
      );
    }
    throw new EncoreError(
      'http',
      res.status === 404
        ? 'Chorus Encore no longer has that file.'
        : `Chorus Encore answered with error ${res.status}.`,
      { status: res.status },
    );
  }

  /**
   * Searches for charts. A query already searched in this session is answered from the cache.
   * @param {string} query
   * @param {number} [page] 1-based
   * @returns {Promise<{charts: EncoreChart[], total: number, cached: boolean}>}
   */
  async search(query, page = 1) {
    const q = query.trim();
    const key = `${page}:${q.toLowerCase()}`;
    const hit = this.cache.get(key);
    if (hit) return { ...hit, cached: true };

    this.#admit();
    let res;
    try {
      res = await this.fetch(SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search: q, per_page: PER_PAGE, page }),
      });
    } catch {
      throw new EncoreError('network', "Couldn't reach Chorus Encore. Check your connection.");
    }
    this.#checkStatus(res);
    let body;
    try {
      body = await res.json();
    } catch {
      throw new EncoreError(
        'shape',
        "Chorus Encore's answer wasn't what we expected, so the search can't be shown.",
      );
    }
    if (!body || !Array.isArray(body.data)) {
      throw new EncoreError(
        'shape',
        "Chorus Encore's answer wasn't what we expected, so the search can't be shown.",
      );
    }
    const charts = body.data.map(parseChart).filter(Boolean);
    const total = typeof body.found === 'number' ? body.found : charts.length;
    const result = { charts, total };
    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, result);
    return { ...result, cached: false };
  }

  /**
   * Downloads a chart's .sng into memory, in the user's browser only.
   * @param {string} md5
   * @param {(fraction: number) => void} [onProgress] called with 0-1 when the size is known
   * @returns {Promise<ArrayBuffer>}
   */
  async download(md5, onProgress) {
    if (!/^[0-9a-f]{32}$/.test(md5)) throw new EncoreError('shape', 'That chart has no usable id.');
    this.#admit();
    let res;
    try {
      res = await this.fetch(fileUrl(md5));
    } catch {
      throw new EncoreError('network', "Couldn't reach Chorus Encore. Check your connection.");
    }
    this.#checkStatus(res);
    const size = Number(res.headers?.get?.('content-length')) || 0;
    if (size > MAX_DOWNLOAD_BYTES) {
      res.body?.cancel?.().catch(() => {});
      throw new EncoreError('too-big', 'That song is too large to add on this device.');
    }
    if (!res.body?.getReader || !size) return res.arrayBuffer();
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        if (got > MAX_DOWNLOAD_BYTES) {
          reader.cancel().catch(() => {});
          throw new EncoreError('too-big', 'That song is too large to add on this device.');
        }
        onProgress?.(Math.min(1, got / size));
      }
    } catch (err) {
      if (err instanceof EncoreError) throw err;
      throw new EncoreError('network', 'The download was interrupted. Try again.');
    }
    return new Blob(chunks).arrayBuffer();
  }
}

/**
 * Turns typing and submits into searches: a submit searches at once, typing searches only after a pause
 * of TYPING_DELAY_MS and only for a query long enough to be meaningful. Opening a screen or typing
 * never sends anything by itself.
 */
export class AutoSearch {
  /**
   * @param {(query: string) => void} run called when a search should be sent
   * @param {{delay?: number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout}} [options]
   */
  constructor(run, { delay = TYPING_DELAY_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.run = run;
    this.delay = delay;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.lastSent = null;
  }

  input(value) {
    this.cancel();
    const q = value.trim();
    if (q.length < MIN_QUERY_LENGTH || q === this.lastSent) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.#fire(q);
    }, this.delay);
  }

  submit(value) {
    this.cancel();
    const q = value.trim();
    if (q) this.#fire(q);
  }

  cancel() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  #fire(q) {
    this.lastSent = q;
    this.run(q);
  }
}
