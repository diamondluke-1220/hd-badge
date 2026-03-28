// Profit Scoring Engine
// Calculates per-turn profit from tagged cards + Management Style + Perks.
// Formula: profit = (sum_of_ranks + style_baseKPI + additive_KPI_perks) × (style_baseLeverage + additive_leverage_perks) × (product_of_xMult_perks)

import type { Suit } from './suits';
import type { ManagementStyle } from './styles';
import { detectStyle } from './styles';
import type { PerkInstance } from './perks';
import { isPerkTriggered } from './perks';

export interface TaggedCard {
  suit: Suit;
  rank: number; // 1-10, contributes to base KPI
  cardName: string; // for display
}

export interface ScoringContext {
  taggedCards: TaggedCard[];
  perks: PerkInstance[];
  playerHPPercent: number; // 0-100
}

export interface ScoringBreakdown {
  style: ManagementStyle;
  taggedSuits: Suit[];

  // KPI calculation
  rankSum: number; // sum of tagged card ranks
  styleBaseKPI: number; // from Management Style
  perkAdditiveKPI: number; // sum of +KPI perks that triggered
  totalKPI: number; // rankSum + styleBaseKPI + perkAdditiveKPI

  // Leverage calculation
  styleBaseLeverage: number; // from Management Style
  perkAdditiveLeverage: number; // sum of +Leverage perks that triggered
  subtotalLeverage: number; // styleBaseLeverage + perkAdditiveLeverage
  perkMultLeverage: number; // product of xMult perks that triggered
  totalLeverage: number; // subtotalLeverage × perkMultLeverage

  // Final
  profit: number; // totalKPI × totalLeverage

  // Perk activations for display
  activatedPerks: { perkName: string; effect: string }[];
}

/**
 * Calculate profit from tagged cards, style, and perks.
 * Returns full breakdown for UI display / animation.
 */
export function calculateProfit(ctx: ScoringContext): ScoringBreakdown {
  const taggedSuits = ctx.taggedCards.map(c => c.suit);
  const style = detectStyle(taggedSuits);

  // Base KPI from card ranks
  const rankSum = ctx.taggedCards.reduce((sum, c) => sum + c.rank, 0);

  // Evaluate perks in slot order (order matters!)
  let perkAdditiveKPI = 0;
  let perkAdditiveLeverage = 0;
  let perkMultLeverage = 1; // multiplicative identity
  const activatedPerks: { perkName: string; effect: string }[] = [];

  const triggerContext = {
    style,
    taggedSuits,
    playerHPPercent: ctx.playerHPPercent,
  };

  // Process perks in slot order
  const sortedPerks = [...ctx.perks].sort((a, b) => a.slotIndex - b.slotIndex);

  for (const perk of sortedPerks) {
    if (!isPerkTriggered(perk, triggerContext)) continue;

    switch (perk.effect.type) {
      case 'add_kpi':
        perkAdditiveKPI += perk.effect.value;
        activatedPerks.push({ perkName: perk.name, effect: `+${perk.effect.value} KPI` });
        break;
      case 'add_leverage':
        perkAdditiveLeverage += perk.effect.value;
        activatedPerks.push({ perkName: perk.name, effect: `+${perk.effect.value} Leverage` });
        break;
      case 'mult_leverage':
        perkMultLeverage *= perk.effect.value;
        activatedPerks.push({ perkName: perk.name, effect: `×${perk.effect.value} Leverage` });
        break;
    }
  }

  const totalKPI = rankSum + style.baseKPI + perkAdditiveKPI;
  const subtotalLeverage = style.baseLeverage + perkAdditiveLeverage;
  const totalLeverage = subtotalLeverage * perkMultLeverage;
  const profit = Math.floor(totalKPI * totalLeverage);

  return {
    style,
    taggedSuits,
    rankSum,
    styleBaseKPI: style.baseKPI,
    perkAdditiveKPI,
    totalKPI,
    styleBaseLeverage: style.baseLeverage,
    perkAdditiveLeverage,
    subtotalLeverage,
    perkMultLeverage,
    totalLeverage,
    profit,
    activatedPerks,
  };
}

// ─── Quarterly Targets (score thresholds per ante) ─────────

export const QUARTERLY_TARGETS = [
  300,   // Ante 1 — achievable with basic styles, no perks
  800,   // Ante 2 — needs decent styles or 1 perk
  2000,  // Ante 3 — needs good styles + perks
  5000,  // Ante 4 — needs multiplicative perks
  11000, // Ante 5 (future)
  20000, // Ante 6 (future)
];

/**
 * Check if cumulative profit meets the quarterly target for the given ante.
 */
export function meetsQuarterlyTarget(cumulativeProfit: number, ante: number): boolean {
  const target = QUARTERLY_TARGETS[ante - 1] ?? Infinity;
  return cumulativeProfit >= target;
}
