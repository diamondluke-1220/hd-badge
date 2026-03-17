// Help Desk Badge Generator — Name Filter
// Hard-blocks hate speech. Flags edgy content for admin review.
// General profanity is ALLOWED — it's a punk show.

// Hard block: these prevent badge creation entirely
const BLOCKED_WORDS = new Set([
  // Racial/ethnic slurs
  'nigger', 'nigga', 'kike', 'spic', 'wetback', 'chink', 'gook', 'coon',
  'beaner', 'raghead', 'towelhead',
  // Anti-LGBTQ slurs
  'faggot', 'tranny',
  // Hate ideology
  'nazi', 'hitler', 'genocide', 'heil',
]);

// Soft flag: badge is created but auto-flagged for admin review
const FLAG_WORDS = new Set([
  // Sexual (allow but flag — might not want to print)
  'blowjob', 'handjob', 'jerkoff', 'cum', 'dildo', 'orgasm',
  // Violence (context-dependent at a punk show)
  'rape', 'rapist', 'molest', 'terrorist', 'shooter',
  // Trolling
  'ligma', 'sugma', 'bofa',
]);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasSubstringMatch(text: string, wordSet: Set<string>): boolean {
  const lower = text.toLowerCase().trim();
  for (const word of wordSet) {
    if (lower.includes(word)) return true;
  }
  return false;
}

function hasWordBoundaryMatch(text: string, wordSet: Set<string>): boolean {
  const lower = text.toLowerCase().trim();
  for (const word of wordSet) {
    const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i');
    if (regex.test(lower)) return true;
  }
  return false;
}

/**
 * Check if a name is allowed (not hate speech).
 * Uses substring matching — "TestHitler" is blocked, not just "Test Hitler".
 * False positives acceptable for hate speech (over-block > under-block).
 * Returns true if clean, false if contains hate speech.
 */
export function isNameClean(name: string): boolean {
  return !hasSubstringMatch(name, BLOCKED_WORDS);
}

/**
 * Check if a name should be flagged for admin review.
 * Uses word-boundary matching — more lenient for soft flags.
 * Returns true if the name contains flagged words.
 * Only call this AFTER isNameClean passes.
 */
export function shouldFlag(name: string): boolean {
  return hasWordBoundaryMatch(name, FLAG_WORDS);
}
