// ─── Badge Pool — shared badge fetch with pagination ─────────────
// Eliminates duplicated paginated fetch loops across views.

window.BadgePool = {
  /**
   * Fetch all badges with automatic pagination.
   * @param {Object} [opts]
   * @param {number} [opts.limit=100] - Per-page limit
   * @param {boolean} [opts.recentFirst=false] - Pass recentFirst=1 to API
   * @param {number} [opts.maxBadges] - Stop after collecting this many badges
   * @returns {Promise<Array>} All fetched badges
   */
  async fetchAll(opts = {}) {
    const limit = opts.limit || 100;
    const recentFirst = opts.recentFirst || false;
    const maxBadges = opts.maxBadges || Infinity;

    let all = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      try {
        let url = `/api/orgchart?page=${page}&limit=${limit}`;
        if (recentFirst) url += '&recentFirst=1';
        const resp = await fetch(url);
        const data = await resp.json();
        const badges = data.badges || [];
        all = all.concat(badges);
        totalPages = data.pages || 1;
        page++;
        if (all.length >= maxBadges) {
          all = all.slice(0, maxBadges);
          break;
        }
      } catch {
        break;
      }
    }

    return all;
  },
};
