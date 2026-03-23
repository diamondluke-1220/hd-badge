// Help Desk Badge Generator — In-Memory Rate Limiter
// Tracks badge creation attempts per IP address

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_STORE_SIZE = 10000;

interface RateEntry {
  timestamps: number[];
}

const store = new Map<string, RateEntry>();
let showModeActive = process.env.SHOW_MODE === '1';

export function setShowMode(active: boolean): void {
  showModeActive = active;
}

export function isShowMode(): boolean {
  return showModeActive;
}

// Every 10 minutes, remove rate limit entries with no activity in the past 24 hours
setInterval(() => {
  const cutoff = Date.now() - DAY_MS;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 10 * 60 * 1000);

function getLimits(): { hourly: number; daily: number } {
  if (showModeActive) {
    return { hourly: 50, daily: 200 };
  }
  return { hourly: 3, daily: 10 };
}

/** Reset all rate limit state (for testing) */
export function resetRateLimits(): void {
  store.clear();
}

export function checkRateLimit(ip: string): { allowed: boolean; message?: string } {
  const now = Date.now();
  const limits = getLimits();

  let entry = store.get(ip);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(ip, entry);
  }

  // Prune expired
  entry.timestamps = entry.timestamps.filter(t => t > now - DAY_MS);

  // Check hourly
  const hourlyCount = entry.timestamps.filter(t => t > now - HOUR_MS).length;
  if (hourlyCount >= limits.hourly) {
    return {
      allowed: false,
      message: 'Badge printer is overheating. Try again later.',
    };
  }

  // Check daily
  if (entry.timestamps.length >= limits.daily) {
    return {
      allowed: false,
      message: 'HR has flagged excessive badge requests. Daily limit reached.',
    };
  }

  // Record this attempt
  entry.timestamps.push(now);

  // Evict stale entries if store grows too large (LRU by most recent timestamp)
  if (store.size > MAX_STORE_SIZE) {
    const staleThreshold = now - DAY_MS;
    for (const [key, e] of store) {
      if (store.size <= MAX_STORE_SIZE * 0.9) break;
      const latest = e.timestamps[e.timestamps.length - 1] || 0;
      if (latest < staleThreshold) store.delete(key);
    }
    // If still over capacity after stale eviction, drop oldest-inserted
    if (store.size > MAX_STORE_SIZE) {
      const evictCount = Math.floor(MAX_STORE_SIZE * 0.1);
      let removed = 0;
      for (const key of store.keys()) {
        if (removed >= evictCount) break;
        store.delete(key);
        removed++;
      }
    }
  }

  return { allowed: true };
}
