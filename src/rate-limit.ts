// Help Desk Badge Generator — In-Memory Rate Limiter
// Tracks badge creation attempts per IP address

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface RateEntry {
  timestamps: number[];
}

const store = new Map<string, RateEntry>();

// Clean up stale entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - DAY_MS;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 10 * 60 * 1000);

function getLimits(): { hourly: number; daily: number } {
  if (process.env.SHOW_MODE === '1') {
    return { hourly: 10, daily: 50 };
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
  return { allowed: true };
}
