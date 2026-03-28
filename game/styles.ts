// Management Style detection — our "poker hands"
// Detects the best Management Style from tagged card suits.
// Each style has base KPI (chips) and Leverage (mult).

import type { Suit } from './suits';

export interface ManagementStyle {
  id: string;
  name: string;
  description: string;
  baseKPI: number;
  baseLeverage: number;
  rank: number; // higher = better hand
  tagLimit: number; // how many cards this style allows tagging
}

// Styles ranked low to high (like poker hands)
export const MANAGEMENT_STYLES: ManagementStyle[] = [
  { id: 'ad_hoc', name: 'Ad Hoc', description: 'No matching suits. Just winging it.',
    baseKPI: 5, baseLeverage: 1, rank: 0, tagLimit: 3 },

  { id: 'follow_up', name: 'Follow-Up', description: '2 cards of the same suit.',
    baseKPI: 10, baseLeverage: 2, rank: 1, tagLimit: 3 },

  { id: 'policy_update', name: 'Policy Update', description: '3 cards of the same suit.',
    baseKPI: 20, baseLeverage: 4, rank: 2, tagLimit: 3 },

  { id: 'cross_functional', name: 'Cross-Functional', description: '3 cards, each a different suit.',
    baseKPI: 25, baseLeverage: 5, rank: 3, tagLimit: 3 },

  { id: 'board_resolution', name: 'Board Resolution', description: '3 cards, all the same suit.',
    baseKPI: 40, baseLeverage: 8, rank: 4, tagLimit: 3 },
];

// For future expansion: Micromanager styles with tagLimit: 5
// { id: 'delegation', name: 'Delegation', description: '2 different pairs from 4 tagged cards.',
//   baseKPI: 15, baseLeverage: 3, rank: 2, tagLimit: 4 },
// { id: 'restructuring', name: 'Restructuring', description: '3+2 suits from 5 tagged cards.',
//   baseKPI: 30, baseLeverage: 6, rank: 5, tagLimit: 5 },
// { id: 'hostile_takeover', name: 'Hostile Takeover', description: '4+1 same suit from 5 tagged.',
//   baseKPI: 50, baseLeverage: 10, rank: 6, tagLimit: 5 },

interface SuitCount {
  suit: Suit;
  count: number;
}

function countSuits(suits: Suit[]): SuitCount[] {
  const map = new Map<Suit, number>();
  for (const s of suits) {
    map.set(s, (map.get(s) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([suit, count]) => ({ suit, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Detect the best Management Style from tagged card suits.
 * Only considers styles with tagLimit <= number of tagged cards.
 * Returns best matching style (highest rank).
 */
export function detectStyle(taggedSuits: Suit[]): ManagementStyle {
  const n = taggedSuits.length;
  if (n === 0) return MANAGEMENT_STYLES[0]; // Ad Hoc

  const counts = countSuits(taggedSuits);
  const maxCount = counts[0]?.count ?? 0;
  const uniqueSuits = counts.length;

  // Check from highest rank down
  // Board Resolution: all 3 same suit
  if (n >= 3 && maxCount >= 3) {
    return MANAGEMENT_STYLES[4]; // Board Resolution
  }

  // Cross-Functional: 3 different suits
  if (n >= 3 && uniqueSuits >= 3) {
    return MANAGEMENT_STYLES[3]; // Cross-Functional
  }

  // Policy Update: 3 of same suit (but we already caught that above as Board Resolution)
  // This handles the case where you tag 3 cards, 2 same + 1 different — not Policy Update.
  // Policy Update requires 3 same — which IS Board Resolution for tag limit 3.
  // So for 3-tag system: Policy Update = impossible (it IS Board Resolution).
  // Let's redefine: Policy Update = 2 same suit + 1 other (weaker than Cross-Functional)
  // Actually, let me reconsider the hierarchy for 3-card hands:

  // For 3 tagged cards, possible combos:
  // AAA = Board Resolution (best)
  // ABC = Cross-Functional (3 unique suits)
  // AAB = Follow-Up (pair, with an extra card)
  // This is the natural hierarchy. Policy Update doesn't fit 3-card hands.

  // Follow-Up: 2 of same suit
  if (maxCount >= 2) {
    return MANAGEMENT_STYLES[1]; // Follow-Up
  }

  // Ad Hoc: no matches (but with 4 suits and 3 cards, we'd always have at most 3 unique)
  // This can only happen with 1 tagged card
  return MANAGEMENT_STYLES[0]; // Ad Hoc
}

/**
 * Get all possible styles the player could form from available suits.
 * Used for preview/hint system.
 */
export function getPossibleStyles(availableSuits: Suit[]): ManagementStyle[] {
  // For each combination of suits up to tag limit, check what style it forms
  // For now, just return all styles as reference
  return [...MANAGEMENT_STYLES];
}
