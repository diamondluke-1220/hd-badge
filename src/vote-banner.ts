// BOM 2026 "Vote for Help Desk" banner activeness.
// Source of truth for whether the top banner should appear.
// Client reads via GET /api/site-config — never reads env directly.

// Vote phase: June 1-30, 2026. Madison is Central Daylight Time (UTC-5) in June.
// End is exclusive: banner disappears at midnight CT on July 1.
const WINDOW_START = new Date('2026-06-01T00:00:00-05:00');
const WINDOW_END = new Date('2026-07-01T00:00:00-05:00');

export type VoteOverride = 'on' | 'off' | 'auto';

export function isVoteBannerActive(now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.BOM_VOTE_OVERRIDE ?? 'auto').toLowerCase();
  const override: VoteOverride = raw === 'on' || raw === 'off' ? raw : 'auto';
  if (override === 'on') return true;
  if (override === 'off') return false;
  return now >= WINDOW_START && now < WINDOW_END;
}
