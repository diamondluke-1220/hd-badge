// Management Perks — our "Jokers"
// Passive modifiers collected between fights that modify profit scoring.
// Perks process in order: additive KPI first, then additive leverage, then multiplicative leverage.

import type { Suit } from './suits';
import type { ManagementStyle } from './styles';

export type PerkTrigger =
  | { type: 'always' } // fires every scoring phase
  | { type: 'on_style'; styleId: string } // fires when specific style is detected
  | { type: 'on_suit_tagged'; suit: Suit; minCount: number } // fires when N+ of suit tagged
  | { type: 'on_cards_tagged'; minCount: number } // fires when N+ cards tagged
  | { type: 'on_combat_hp_above'; percent: number }; // fires when HP > X% after combat

export type PerkEffect =
  | { type: 'add_kpi'; value: number } // +flat KPI (chips)
  | { type: 'add_leverage'; value: number } // +flat leverage (mult)
  | { type: 'mult_leverage'; value: number }; // ×leverage (xMult — the broken ones)

export interface PerkDef {
  id: string;
  name: string;
  description: string;
  rarity: 'common' | 'uncommon' | 'rare';
  trigger: PerkTrigger;
  effect: PerkEffect;
}

export interface PerkInstance extends PerkDef {
  slotIndex: number; // position matters for processing order
}

// ─── Perk Catalog (6 total: 4 base, 2 progression-gated) ──────

export const PERK_CATALOG: PerkDef[] = [
  // === BASE PERKS (available from start) ===

  // 1. Additive KPI — simple, always-on
  { id: 'corner_office', name: 'Corner Office',
    description: '+15 KPI on every scoring phase.',
    rarity: 'common',
    trigger: { type: 'always' },
    effect: { type: 'add_kpi', value: 15 } },

  // 2. Conditional additive leverage
  { id: 'yes_man', name: 'Yes Man',
    description: '+3 Leverage when you tag 3 cards.',
    rarity: 'common',
    trigger: { type: 'on_cards_tagged', minCount: 3 },
    effect: { type: 'add_leverage', value: 3 } },

  // 3. Suit-conditional additive KPI — renamed to Please Hold (from the song)
  { id: 'please_hold', name: 'Please Hold',
    description: '+20 KPI when 2+ Tickets cards tagged.',
    rarity: 'uncommon',
    trigger: { type: 'on_suit_tagged', suit: 'tickets', minCount: 2 },
    effect: { type: 'add_kpi', value: 20 } },

  // 4. Style-conditional xMult (THE IMPORTANT ONE)
  { id: 'micromanager', name: 'Micromanager',
    description: '×2 Leverage when Cross-Functional or Board Resolution.',
    rarity: 'uncommon',
    trigger: { type: 'on_style', styleId: 'cross_functional' },
    effect: { type: 'mult_leverage', value: 2 } },

  // === PROGRESSION-GATED PERKS (unlocked after ante 2) ===

  // 5. HP-conditional xMult — risk/reward
  { id: 'golden_parachute', name: 'Golden Parachute',
    description: '×1.5 Leverage when HP above 75% after combat.',
    rarity: 'rare',
    trigger: { type: 'on_combat_hp_above', percent: 75 },
    effect: { type: 'mult_leverage', value: 1.5 } },

  // 6. Always-on xMult — the endgame perk
  { id: 'hostile_ceo', name: 'Hostile CEO',
    description: '×1.5 Leverage on every scoring phase.',
    rarity: 'rare',
    trigger: { type: 'always' },
    effect: { type: 'mult_leverage', value: 1.5 } },
];

// Also make Micromanager trigger on Board Resolution too
// (handled in evaluation logic — checks if style rank >= cross_functional)

/**
 * Evaluate whether a perk's trigger condition is met.
 */
export function isPerkTriggered(
  perk: PerkDef,
  context: {
    style: ManagementStyle;
    taggedSuits: Suit[];
    playerHPPercent: number;
  }
): boolean {
  const { trigger } = perk;
  switch (trigger.type) {
    case 'always':
      return true;
    case 'on_style':
      // Micromanager triggers on Cross-Functional AND Board Resolution (rank >= target)
      if (perk.id === 'micromanager') {
        return context.style.rank >= 3; // Cross-Functional or better
      }
      return context.style.id === trigger.styleId;
    case 'on_suit_tagged':
      return context.taggedSuits.filter(s => s === trigger.suit).length >= trigger.minCount;
    case 'on_cards_tagged':
      return context.taggedSuits.length >= trigger.minCount;
    case 'on_combat_hp_above':
      return context.playerHPPercent >= trigger.percent;
    default:
      return false;
  }
}
