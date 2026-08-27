// Help Desk Badge Generator — In-Memory Rate Limiter
// Tracks badge creation and game score submissions per IP address

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_STORE_SIZE = 10000;

// Game scores get their own bucket so active game play can't lock a user
// out of badge creation (or vice versa).
const GAME_SCORE_HOURLY = 30;
const GAME_SCORE_DAILY = 100;

// Badge edits get their own bucket too — tuning a badge you already made is a
// normal thing to do repeatedly, and it must never eat the creation quota.
// Still bounded, because each edit costs 1-2 serialized Chrome renders.
const EDIT_HOURLY = 30;
const EDIT_DAILY = 100;
const EDIT_HOURLY_SHOW = 120;
const EDIT_DAILY_SHOW = 400;

// Recovery is a lookup, not a write — cheap, but brute-forceable, so bounded.
const RECOVER_HOURLY = 20;
const RECOVER_DAILY = 60;

interface RateEntry {
  timestamps: number[];
}

const store = new Map<string, RateEntry>();
const gameScoreStore = new Map<string, RateEntry>();
const editStore = new Map<string, RateEntry>();
const recoverStore = new Map<string, RateEntry>();
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
  for (const s of [store, gameScoreStore, editStore, recoverStore]) {
    for (const [key, entry] of s) {
      entry.timestamps = entry.timestamps.filter(t => t > cutoff);
      if (entry.timestamps.length === 0) s.delete(key);
    }
  }
}, 10 * 60 * 1000);

function getLimits(): { hourly: number; daily: number } {
  if (showModeActive) {
    return { hourly: 300, daily: 800 };
  }
  return { hourly: 10, daily: 20 };
}

/** Reset all rate limit state (for testing) */
export function resetRateLimits(): void {
  store.clear();
  gameScoreStore.clear();
  editStore.clear();
  recoverStore.clear();
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

/**
 * Dedicated rate limiter for game score submissions.
 * Kept separate from the badge-creation store so a user actively playing
 * games can't hit badge creation limits (or vice versa). Limits are more
 * generous since game rounds are short and legitimate players play many.
 */
export function checkGameScoreRateLimit(ip: string): { allowed: boolean; message?: string } {
  return checkBucket(gameScoreStore, ip, GAME_SCORE_HOURLY, GAME_SCORE_DAILY, {
    hourly: 'Game score submissions rate limit reached. Try again shortly.',
    daily: 'Daily game score submission limit reached.',
  });
}

/**
 * Rate limiter for badge EDITS (PUT /api/badge/:id).
 *
 * Its own bucket, for the same reason game scores got one: editing your badge
 * must not consume the badge-creation quota. Edits were previously unlimited
 * while costing 1-2 headless-Chrome renders each on a globally serialized
 * pipeline.
 */
export function checkEditRateLimit(ip: string): { allowed: boolean; message?: string } {
  const limits = showModeActive
    ? { hourly: EDIT_HOURLY_SHOW, daily: EDIT_DAILY_SHOW }
    : { hourly: EDIT_HOURLY, daily: EDIT_DAILY };
  return checkBucket(editStore, ip, limits.hourly, limits.daily, {
    hourly: 'Too many badge edits. The printer needs a minute.',
    daily: 'Daily badge edit limit reached.',
  });
}

/**
 * Rate limiter for badge recovery attempts.
 *
 * Previously shared the badge-creation bucket, so ten recovery attempts burned
 * the entire creation quota for that key. At a show, where a venue NAT collapses
 * the whole audience onto one IP, that locked the room out of making badges.
 */
export function checkRecoverRateLimit(ip: string): { allowed: boolean; message?: string } {
  return checkBucket(recoverStore, ip, RECOVER_HOURLY, RECOVER_DAILY, {
    hourly: 'Too many recovery attempts. Try again shortly.',
    daily: 'Daily recovery attempt limit reached.',
  });
}

/**
 * Shared sliding-window bucket check with the store-eviction policy.
 * Extracted so each new limiter is a declaration rather than a copy of the
 * whole algorithm — the recover limiter existing only as a copy is how it
 * ended up sharing the creation bucket in the first place.
 */
function checkBucket(
  bucket: Map<string, RateEntry>,
  ip: string,
  hourlyLimit: number,
  dailyLimit: number,
  messages: { hourly: string; daily: string },
): { allowed: boolean; message?: string } {
  const now = Date.now();

  let entry = bucket.get(ip);
  if (!entry) {
    entry = { timestamps: [] };
    bucket.set(ip, entry);
  }

  // Prune expired
  entry.timestamps = entry.timestamps.filter(t => t > now - DAY_MS);

  const hourlyCount = entry.timestamps.filter(t => t > now - HOUR_MS).length;
  if (hourlyCount >= hourlyLimit) {
    return { allowed: false, message: messages.hourly };
  }

  if (entry.timestamps.length >= dailyLimit) {
    return { allowed: false, message: messages.daily };
  }

  entry.timestamps.push(now);

  // Same eviction policy as the badge store
  if (bucket.size > MAX_STORE_SIZE) {
    const staleThreshold = now - DAY_MS;
    for (const [key, e] of bucket) {
      if (bucket.size <= MAX_STORE_SIZE * 0.9) break;
      const latest = e.timestamps[e.timestamps.length - 1] || 0;
      if (latest < staleThreshold) bucket.delete(key);
    }
    if (bucket.size > MAX_STORE_SIZE) {
      const evictCount = Math.floor(MAX_STORE_SIZE * 0.1);
      let removed = 0;
      for (const key of bucket.keys()) {
        if (removed >= evictCount) break;
        bucket.delete(key);
        removed++;
      }
    }
  }

  return { allowed: true };
}
