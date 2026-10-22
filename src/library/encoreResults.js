// The list a search builds up on the Find songs screen: page 1 from a search, more pages from "Show more".
// A page counts only once it has arrived. A refused or failed request leaves the list and the page where
// they were, so asking again fetches the same page rather than skipping one.

/** @typedef {import('./encore.js').EncoreChart} EncoreChart */

export class ResultList {
  /** @param {import('./encore.js').EncoreClient} client */
  constructor(client) {
    this.client = client;
    this.query = '';
    /** @type {EncoreChart[]} */
    this.charts = [];
    this.total = 0;
    /** The last page that arrived (0 before the first search has). */
    this.page = 0;
    /** True while a request for this list is in flight. */
    this.busy = false;
    this.token = 0;
  }

  get hasMore() {
    return this.charts.length > 0 && this.charts.length < this.total;
  }

  /** Starts a new list for `query`. Throws what the client throws; the list is then empty. */
  async search(query) {
    const mine = ++this.token;
    this.query = query;
    this.charts = [];
    this.total = 0;
    this.page = 0;
    this.busy = true;
    try {
      const result = await this.client.search(query, 1);
      if (mine !== this.token) return;
      this.charts = result.charts;
      this.total = result.total;
      this.page = 1;
    } finally {
      if (mine === this.token) this.busy = false;
    }
  }

  /**
   * Adds the next page. Ignored (returns false) while a request is in flight or when there is no more;
   * on an error the list and the page stay as they were, so the next try asks for the same page.
   * @returns {Promise<boolean>} whether a page was added
   */
  async more() {
    if (this.busy || !this.hasMore) return false;
    const mine = this.token;
    this.busy = true;
    try {
      const result = await this.client.search(this.query, this.page + 1);
      if (mine !== this.token) return false;
      this.charts = [...this.charts, ...result.charts];
      this.total = result.total;
      this.page++;
      return true;
    } finally {
      if (mine === this.token) this.busy = false;
    }
  }
}
