#!/usr/bin/env bun
// Hybrid Combat + Scoring Test Runner
// Tests the full loop: combat → tag → score → profit tracking
// Validates balance for both win rates AND profit targets.
// Usage: bun run game/test-hybrid.ts

import { STARTER_DECK, REWARD_POOL, createCardInstance, resetInstanceCounter, type Card, type CardDef } from './cards-v2';
import { NORMAL_ENEMIES, ELITE_ENEMY, ELITE_ENEMIES, BOSS_ENEMY, BOSS_ENEMIES, createEnemyInstance, type EnemyDef } from './enemies-v2';
import type { Suit } from './suits';
import { detectStyle } from './styles';
import { PERK_CATALOG, type PerkInstance } from './perks';
import { calculateProfit, QUARTERLY_TARGETS, type TaggedCard } from './scoring';
import { applyStatus, getStacks, tickStatuses, type StatusInstance } from './statuses';

// ─── Reuse combat engine (imports from original, adapted for v2 cards) ───

import {
  initCombat, startTurn, endTurn, resolveCard, resolveEnemyTurn,
  isCombatOver, canPlayCard, shuffle, drawCards,
  type CombatState, type GameEvent,
} from './combat';

// Adapt v2 cards to combat engine (combat only reads type+effects, not suit/rank)
// The combat engine's Card type doesn't have suit/rank, but our v2 cards do.
// Since TypeScript structural typing means v2 Card extends v1 Card, this works directly.

// ─── AI Tagging Strategy ────────────────────────────────────

interface PlayedCardInfo {
  suit: Suit;
  rank: number;
  rankBonus?: number;
  cardName: string;
}

function toTaggedCard(c: PlayedCardInfo): TaggedCard {
  return { suit: c.suit, rank: c.rank, rankBonus: c.rankBonus, cardName: c.cardName };
}

function aiTagCards(playedCards: PlayedCardInfo[], maxTags: number): TaggedCard[] {
  if (playedCards.length === 0) return [];
  const tagLimit = Math.min(maxTags, playedCards.length);

  // Count suits in played cards
  const suitCounts = new Map<Suit, PlayedCardInfo[]>();
  for (const c of playedCards) {
    const arr = suitCounts.get(c.suit) || [];
    arr.push(c);
    suitCounts.set(c.suit, arr);
  }

  // Strategy 1: Try Board Resolution (3 same suit)
  for (const [, cards] of suitCounts) {
    if (cards.length >= 3 && tagLimit >= 3) {
      const sorted = cards.sort((a, b) => b.rank - a.rank);
      return sorted.slice(0, 3).map(c => (toTaggedCard(c)));
    }
  }

  // Strategy 2: Try Cross-Functional (3 different suits)
  if (tagLimit >= 3 && suitCounts.size >= 3) {
    const tagged: TaggedCard[] = [];
    for (const [, cards] of suitCounts) {
      if (tagged.length >= 3) break;
      const best = cards.sort((a, b) => b.rank - a.rank)[0];
      tagged.push({ suit: best.suit, rank: best.rank, rankBonus: best.rankBonus, cardName: best.cardName });
    }
    if (tagged.length >= 3) return tagged.slice(0, 3);
  }

  // Strategy 3: Try Follow-Up (2 same suit)
  for (const [, cards] of suitCounts) {
    if (cards.length >= 2) {
      const sorted = cards.sort((a, b) => b.rank - a.rank);
      const tagged = sorted.slice(0, 2).map(c => toTaggedCard(c));
      // Fill remaining slots with highest rank cards from other suits
      const remaining = playedCards
        .filter(c => !tagged.some(t => t.cardName === c.cardName && t.rank === c.rank))
        .sort((a, b) => b.rank - a.rank);
      while (tagged.length < tagLimit && remaining.length > 0) {
        const c = remaining.shift()!;
        tagged.push(toTaggedCard(c));
      }
      return tagged.slice(0, tagLimit);
    }
  }

  // Fallback: tag highest rank cards
  const sorted = [...playedCards].sort((a, b) => b.rank - a.rank);
  return sorted.slice(0, tagLimit).map(c => (toTaggedCard(c)));
}

// ─── AI Combat (adapted from test-combat.ts) ───────────────

function aiPlayTurn(state: CombatState): { events: GameEvent[]; playedCards: PlayedCardInfo[] } {
  const events: GameEvent[] = [];
  const playedCards: PlayedCardInfo[] = [];

  const playable = () => state.hand.filter(c => canPlayCard(state, c));

  // Play powers first
  for (const card of playable()) {
    if (card.type === 'power') {
      const v2card = card as unknown as Card; // structural cast
      playedCards.push({ suit: v2card.suit, rank: v2card.rank, rankBonus: v2card.rankBonus, cardName: v2card.name });
      resolveCard(state, card, 0, events);
    }
  }

  // Find primary target
  const targetIdx = state.enemies.reduce((best, e, i) => {
    if (e.currentHP <= 0) return best;
    if (best === -1) return i;
    return e.currentHP < state.enemies[best].currentHP ? i : best;
  }, -1);

  // Play remaining cards
  let played = true;
  while (played) {
    played = false;
    const cards = playable();
    if (cards.length === 0) break;

    // 15% chance random
    const useRandom = Math.random() < 0.15;

    if (useRandom) {
      const card = cards[Math.floor(Math.random() * cards.length)];
      const target = card.target === 'self' ? 0 : targetIdx;
      const v2card = card as unknown as Card;
      playedCards.push({ suit: v2card.suit, rank: v2card.rank, rankBonus: v2card.rankBonus, cardName: v2card.name });
      resolveCard(state, card, target, events);
      played = true;
    } else {
      const sorted = [...cards].sort((a, b) => {
        if (a.cost === 0 && b.cost !== 0) return -1;
        if (b.cost === 0 && a.cost !== 0) return 1;
        if (a.type === 'attack' && b.type !== 'attack') return -1;
        if (b.type === 'attack' && a.type !== 'attack') return 1;
        return (b.effects[0]?.value ?? 0) - (a.effects[0]?.value ?? 0);
      });

      for (const card of sorted) {
        if (canPlayCard(state, card)) {
          const target = card.target === 'self' ? 0 : targetIdx;
          const v2card = card as unknown as Card;
          playedCards.push({ suit: v2card.suit, rank: v2card.rank, rankBonus: v2card.rankBonus, cardName: v2card.name });
          resolveCard(state, card, target, events);
          played = true;
          break;
        }
      }
    }

    if (Math.random() < 0.10) break;
  }

  return { events, playedCards };
}

// ─── Simulate One Fight ──────────────────────────────────────

interface FightResult {
  won: boolean;
  turns: number;
  playerHPRemaining: number;
  playerHPStart: number;
  profitPerTurn: number[];
  totalProfit: number;
  stylesUsed: string[];
}

function simulateFight(
  deck: Card[], enemyDefs: EnemyDef[], playerHP: number, playerMaxHP: number,
  perks: PerkInstance[]
): FightResult {
  const enemies = enemyDefs.map(createEnemyInstance);
  // Cast v2 cards to v1 combat Card type (structural compatibility)
  const state = initCombat(deck as any, enemies, playerHP, playerMaxHP);
  const maxTurns = 30;

  const profitPerTurn: number[] = [];
  const stylesUsed: string[] = [];
  let totalProfit = 0;

  for (let t = 0; t < maxTurns; t++) {
    const turnEvents: GameEvent[] = [];
    startTurn(state, turnEvents);

    let result = isCombatOver(state);
    if (result) return {
      won: result === 'won', turns: state.turn,
      playerHPRemaining: state.playerHP, playerHPStart: playerHP,
      profitPerTurn, totalProfit, stylesUsed,
    };

    // AI plays cards (combat) and tracks what was played
    const { playedCards } = aiPlayTurn(state);

    result = isCombatOver(state);
    if (result) {
      // Score final turn even if combat ended
      const tagged = aiTagCards(playedCards, 3);
      if (tagged.length > 0) {
        const hpPercent = Math.floor((state.playerHP / state.playerMaxHP) * 100);
        const scoring = calculateProfit({ taggedCards: tagged, perks, playerHPPercent: hpPercent });
        profitPerTurn.push(scoring.profit);
        totalProfit += scoring.profit;
        stylesUsed.push(scoring.style.name);
      }
      return {
        won: result === 'won', turns: state.turn,
        playerHPRemaining: state.playerHP, playerHPStart: playerHP,
        profitPerTurn, totalProfit, stylesUsed,
      };
    }

    // TAG PHASE: AI selects cards for scoring
    const tagged = aiTagCards(playedCards, 3);
    if (tagged.length > 0) {
      const hpPercent = Math.floor((state.playerHP / state.playerMaxHP) * 100);
      const scoring = calculateProfit({ taggedCards: tagged, perks, playerHPPercent: hpPercent });
      profitPerTurn.push(scoring.profit);
      totalProfit += scoring.profit;
      stylesUsed.push(scoring.style.name);
    }

    // Enemy turn
    resolveEnemyTurn(state, turnEvents);
    endTurn(state, turnEvents);

    result = isCombatOver(state);
    if (result) return {
      won: result === 'won', turns: state.turn,
      playerHPRemaining: state.playerHP, playerHPStart: playerHP,
      profitPerTurn, totalProfit, stylesUsed,
    };
  }

  return {
    won: false, turns: maxTurns,
    playerHPRemaining: state.playerHP, playerHPStart: playerHP,
    profitPerTurn, totalProfit, stylesUsed,
  };
}

// ─── Run Simulations ─────────────────────────────────────────

interface SimResult {
  winRate: number;
  avgTurns: number;
  avgHPRemaining: number;
  profitStats: {
    min: number; max: number; avg: number; median: number;
  };
  styleDistribution: Record<string, number>;
}

function runSimulation(
  label: string, deck: Card[], enemyDefs: EnemyDef[],
  runs: number, startHP: number, maxHP: number, perks: PerkInstance[]
): SimResult {
  let wins = 0;
  let totalTurns = 0;
  let totalHPRemaining = 0;
  const allProfits: number[] = [];
  const styleCounts: Record<string, number> = {};

  for (let i = 0; i < runs; i++) {
    const result = simulateFight(deck, enemyDefs, startHP, maxHP, perks);
    if (result.won) {
      wins++;
      totalHPRemaining += result.playerHPRemaining;
    }
    totalTurns += result.turns;
    allProfits.push(result.totalProfit);
    for (const s of result.stylesUsed) {
      styleCounts[s] = (styleCounts[s] || 0) + 1;
    }
  }

  allProfits.sort((a, b) => a - b);
  const median = allProfits[Math.floor(allProfits.length / 2)] ?? 0;

  return {
    winRate: wins / runs,
    avgTurns: totalTurns / runs,
    avgHPRemaining: wins > 0 ? totalHPRemaining / wins : 0,
    profitStats: {
      min: allProfits[0] ?? 0,
      max: allProfits[allProfits.length - 1] ?? 0,
      avg: allProfits.reduce((a, b) => a + b, 0) / allProfits.length,
      median,
    },
    styleDistribution: styleCounts,
  };
}

// ─── Main ────────────────────────────────────────────────────

const RUNS = 500;
const MAX_HP = 72;

console.log('═══════════════════════════════════════════════════════════');
console.log('  HELP DESK EXECUTIVE EDITION — Hybrid Balance Test');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Simulating ${RUNS} fights per matchup`);
console.log(`  Player HP: ${MAX_HP} | Energy: 3/turn | Hand: 5 | Tags: 3`);
console.log(`  Deck: Starter (10 cards) | AI: greedy + tag optimization`);
console.log('');

resetInstanceCounter();
const starterDeck = STARTER_DECK.map(createCardInstance);

// ─── Test 1: Combat balance (no perks) ──────────────────────

console.log('─── Combat Balance (No Perks) ────────────────────────────');
console.log('');

const noPerks: PerkInstance[] = [];

for (const enemy of NORMAL_ENEMIES) {
  const r = runSimulation(enemy.name, starterDeck, [enemy], RUNS, MAX_HP, MAX_HP, noPerks);
  const bar = '█'.repeat(Math.round(r.winRate * 20)) + '░'.repeat(20 - Math.round(r.winRate * 20));
  console.log(`  ${enemy.name.padEnd(28)} ${bar} ${(r.winRate * 100).toFixed(0).padStart(3)}% win | ${r.avgTurns.toFixed(1)}t | $${r.profitStats.avg.toFixed(0)} avg profit`);
}

console.log('');
for (const elite of ELITE_ENEMIES) {
  const r = runSimulation(elite.name, starterDeck, [elite], RUNS, MAX_HP, MAX_HP, noPerks);
  const bar = '█'.repeat(Math.round(r.winRate * 20)) + '░'.repeat(20 - Math.round(r.winRate * 20));
  console.log(`  ${elite.name.padEnd(28)} ${bar} ${(r.winRate * 100).toFixed(0).padStart(3)}% win | ${r.avgTurns.toFixed(1)}t | $${r.profitStats.avg.toFixed(0)} avg profit`);
}
console.log('  ^ Elites');
const eliteR = runSimulation(ELITE_ENEMY.name, starterDeck, [ELITE_ENEMY], RUNS, MAX_HP, MAX_HP, noPerks);

console.log('');
for (const boss of BOSS_ENEMIES) {
  const r = runSimulation(boss.name, starterDeck, [boss], RUNS, MAX_HP, MAX_HP, noPerks);
  const bar = '█'.repeat(Math.round(r.winRate * 20)) + '░'.repeat(20 - Math.round(r.winRate * 20));
  console.log(`  ${boss.name.padEnd(28)} ${bar} ${(r.winRate * 100).toFixed(0).padStart(3)}% win | ${r.avgTurns.toFixed(1)}t | $${r.profitStats.avg.toFixed(0)} avg profit`);
}
console.log('  ^ Bosses');
const bossR = runSimulation(BOSS_ENEMY.name, starterDeck, [BOSS_ENEMY], RUNS, MAX_HP, MAX_HP, noPerks);

// ─── Test 2: Profit Distribution ────────────────────────────

console.log('');
console.log('─── Profit Distribution (No Perks) ──────────────────────');
console.log('');

for (const enemy of NORMAL_ENEMIES) {
  const r = runSimulation(enemy.name, starterDeck, [enemy], RUNS, MAX_HP, MAX_HP, noPerks);
  console.log(`  ${enemy.name.padEnd(28)} min: $${r.profitStats.min.toString().padStart(5)} | avg: $${r.profitStats.avg.toFixed(0).padStart(5)} | med: $${r.profitStats.median.toString().padStart(5)} | max: $${r.profitStats.max.toString().padStart(5)}`);
}

// ─── Test 3: Style Distribution ─────────────────────────────

console.log('');
console.log('─── Management Style Distribution ─────────────────────');
console.log('');

const combinedStyles: Record<string, number> = {};
for (const enemy of NORMAL_ENEMIES) {
  const r = runSimulation(enemy.name, starterDeck, [enemy], RUNS, MAX_HP, MAX_HP, noPerks);
  for (const [style, count] of Object.entries(r.styleDistribution)) {
    combinedStyles[style] = (combinedStyles[style] || 0) + count;
  }
}
const totalStyles = Object.values(combinedStyles).reduce((a, b) => a + b, 0);
for (const [style, count] of Object.entries(combinedStyles).sort((a, b) => b[1] - a[1])) {
  const pct = ((count / totalStyles) * 100).toFixed(1);
  console.log(`  ${style.padEnd(20)} ${pct}%`);
}

// ─── Test 4: Perk Combo Testing ─────────────────────────────

console.log('');
console.log('─── Perk Combo Impact on Scoring ──────────────────────');
console.log('');

// Test each perk individually
for (let i = 0; i < PERK_CATALOG.length; i++) {
  const perk: PerkInstance = { ...PERK_CATALOG[i], slotIndex: 0 };
  const r = runSimulation(`+${perk.name}`, starterDeck, [NORMAL_ENEMIES[0]], RUNS, MAX_HP, MAX_HP, [perk]);
  const baseR = runSimulation('base', starterDeck, [NORMAL_ENEMIES[0]], RUNS, MAX_HP, MAX_HP, noPerks);
  const lift = ((r.profitStats.avg / baseR.profitStats.avg - 1) * 100).toFixed(0);
  console.log(`  ${perk.name.padEnd(20)} avg: $${r.profitStats.avg.toFixed(0).padStart(5)} (+${lift}% vs base)`);
}

// Test degenerate combo: all multiplicative perks
console.log('');
console.log('  --- Degenerate Combo Check (all xMult stacked) ---');
const degeneratePerks: PerkInstance[] = PERK_CATALOG
  .filter(p => p.effect.type === 'mult_leverage')
  .map((p, i) => ({ ...p, slotIndex: i }));
const degenR = runSimulation('ALL xMult', starterDeck, [NORMAL_ENEMIES[0]], RUNS, MAX_HP, MAX_HP, degeneratePerks);
const baseDegenR = runSimulation('base', starterDeck, [NORMAL_ENEMIES[0]], RUNS, MAX_HP, MAX_HP, noPerks);
console.log(`  All xMult perks:   avg: $${degenR.profitStats.avg.toFixed(0).padStart(5)} | max: $${degenR.profitStats.max.toString().padStart(5)} (+${((degenR.profitStats.avg / baseDegenR.profitStats.avg - 1) * 100).toFixed(0)}% vs base)`);

// ─── Test 5: Full Floor Run with Scoring ────────────────────

console.log('');
console.log('─── Full Floor Run (Combat + Scoring) ─────────────────');
console.log('');

let floorWins = 0;
let totalFightsWon = 0;
let totalFloorProfit = 0;
let quarterlyHits = 0;
const floorRuns = RUNS;

for (let r = 0; r < floorRuns; r++) {
  resetInstanceCounter();
  let deck = STARTER_DECK.map(createCardInstance);
  let hp = MAX_HP;
  let fightsWon = 0;
  let runProfit = 0;
  const runPerks: PerkInstance[] = [];

  // 5 normal fights
  for (let f = 0; f < 5; f++) {
    const enemy = NORMAL_ENEMIES[Math.floor(Math.random() * NORMAL_ENEMIES.length)];
    const result = simulateFight(deck, [enemy], hp, MAX_HP, runPerks);
    if (!result.won) break;
    fightsWon++;
    hp = result.playerHPRemaining;
    runProfit += result.totalProfit;

    // Card reward
    if (REWARD_POOL.length > 0) {
      const reward = REWARD_POOL[Math.floor(Math.random() * REWARD_POOL.length)];
      deck.push(createCardInstance(reward));
    }

    // Card upgrade: upgrade one non-upgraded card's rank by +2 (after fights 1, 3)
    if (f === 0 || f === 2) {
      const upgradeable = deck.filter(c => !c.upgraded);
      if (upgradeable.length > 0) {
        // AI picks highest rank card to upgrade (maximize scoring)
        upgradeable.sort((a, b) => (b.rank + (b.rankBonus ?? 0)) - (a.rank + (a.rankBonus ?? 0)));
        const target = upgradeable[0];
        target.rankBonus = (target.rankBonus ?? 0) + 2;
        target.upgraded = true;
      }
    }

    // Perk reward (1 random perk after fight 2 and fight 4)
    if ((f === 1 || f === 3) && PERK_CATALOG.length > 0) {
      const availablePerks = PERK_CATALOG.filter(p => !runPerks.some(rp => rp.id === p.id));
      if (availablePerks.length > 0) {
        const perkDef = availablePerks[Math.floor(Math.random() * availablePerks.length)];
        runPerks.push({ ...perkDef, slotIndex: runPerks.length });
      }
    }

    // Card removal: remove lowest-rank non-upgraded card (after fights 3 and 5)
    const REMOVE_COST = 200;
    if ((f === 2 || f === 4) && runProfit >= REMOVE_COST && deck.length > 5) {
      const removable = deck.filter(c => !c.upgraded);
      if (removable.length > 0) {
        // AI removes lowest effective rank card (weakest scoring value)
        removable.sort((a, b) => (a.rank + (a.rankBonus ?? 0)) - (b.rank + (b.rankBonus ?? 0)));
        const target = removable[0];
        const idx = deck.indexOf(target);
        if (idx !== -1) {
          deck.splice(idx, 1);
          runProfit -= REMOVE_COST;
        }
      }
    }

    hp = Math.min(hp + 6, MAX_HP);
  }

  // Elite
  if (fightsWon === 5) {
    const elite = ELITE_ENEMIES[Math.floor(Math.random() * ELITE_ENEMIES.length)];
    const result = simulateFight(deck, [elite], hp, MAX_HP, runPerks);
    if (result.won) {
      fightsWon++;
      hp = result.playerHPRemaining;
      runProfit += result.totalProfit;
      const reward = REWARD_POOL[Math.floor(Math.random() * REWARD_POOL.length)];
      deck.push(createCardInstance(reward));
    }
  }

  // Boss
  if (fightsWon === 6) {
    const boss = BOSS_ENEMIES[Math.floor(Math.random() * BOSS_ENEMIES.length)];
    const result = simulateFight(deck, [boss], hp, MAX_HP, runPerks);
    if (result.won) {
      fightsWon++;
      floorWins++;
      runProfit += result.totalProfit;
    }
  }

  totalFightsWon += fightsWon;
  totalFloorProfit += runProfit;

  // Check if this run's profit hit quarterly target for ante 1
  if (runProfit >= QUARTERLY_TARGETS[0]) quarterlyHits++;
}

const avgFights = totalFightsWon / floorRuns;
const floorRate = floorWins / floorRuns;
const floorBar = '█'.repeat(Math.round(floorRate * 20)) + '░'.repeat(20 - Math.round(floorRate * 20));

console.log(`  Floor clear rate:      ${floorBar} ${(floorRate * 100).toFixed(0).padStart(3)}%`);
console.log(`  Avg fights won:        ${avgFights.toFixed(1)} / 7`);
console.log(`  Full clears:           ${floorWins} / ${floorRuns}`);
console.log(`  Avg floor profit:      $${(totalFloorProfit / floorRuns).toFixed(0)}`);
console.log(`  Quarterly target hit:  ${((quarterlyHits / floorRuns) * 100).toFixed(0)}% (target: $${QUARTERLY_TARGETS[0]})`);
console.log('');

// ─── Balance Summary ─────────────────────────────────────────

console.log('─── Balance Summary ──────────────────────────────────');
console.log('');

const issues: string[] = [];

for (const enemy of NORMAL_ENEMIES) {
  const r = runSimulation(enemy.name, starterDeck, [enemy], RUNS, MAX_HP, MAX_HP, noPerks);
  if (r.winRate < 0.90) issues.push(`  ⚠ ${enemy.name}: win rate ${(r.winRate*100).toFixed(0)}% too low (target: 90%+)`);
  if (r.avgTurns > 6) issues.push(`  ⚠ ${enemy.name}: avg ${r.avgTurns.toFixed(1)} turns too slow (target: 3-5)`);
}

for (const elite of ELITE_ENEMIES) {
  const r = runSimulation(elite.name, starterDeck, [elite], RUNS, MAX_HP, MAX_HP, noPerks);
  if (r.winRate < 0.50) issues.push(`  ⚠ Elite ${elite.name}: win rate ${(r.winRate*100).toFixed(0)}% too low (target: 50%+)`);
}
for (const boss of BOSS_ENEMIES) {
  const r = runSimulation(boss.name, starterDeck, [boss], RUNS, MAX_HP, MAX_HP, noPerks);
  if (r.winRate < 0.20) issues.push(`  ⚠ Boss ${boss.name}: win rate ${(r.winRate*100).toFixed(0)}% too punishing (target: 20%+)`);
}
if (floorRate < 0.10) issues.push(`  ⚠ Floor clear rate ${(floorRate*100).toFixed(0)}% too punishing (target: 10-35%)`);
if (floorRate > 0.45) issues.push(`  ⚠ Floor clear rate ${(floorRate*100).toFixed(0)}% too easy (target: 10-35%)`);

// Scoring checks
const avgFloorProfit = totalFloorProfit / floorRuns;
if (avgFloorProfit < 150) issues.push(`  ⚠ Avg floor profit $${avgFloorProfit.toFixed(0)} too low to engage scoring system`);
if (degenR.profitStats.max > 100000) issues.push(`  ⚠ Degenerate xMult combo max $${degenR.profitStats.max} — score explosion risk`);

if (issues.length === 0) {
  console.log('  ✅ All balance targets met!');
} else {
  for (const issue of issues) console.log(issue);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
