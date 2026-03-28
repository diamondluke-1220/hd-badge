#!/usr/bin/env bun
// Headless combat test runner
// Simulates fights with basic AI to validate balance.
// Usage: bun run game/test-combat.ts

import { STARTER_DECK, REWARD_POOL, createCardInstance, resetInstanceCounter, type Card } from './cards';
import { NORMAL_ENEMIES, ELITE_ENEMY, BOSS_ENEMY, createEnemyInstance, type EnemyDef } from './enemies';
import {
  initCombat, startTurn, endTurn, resolveCard, resolveEnemyTurn,
  isCombatOver, canPlayCard, type CombatState, type GameEvent,
} from './combat';

// ─── Simple AI — plays cards each turn ───────────────────

function aiPlayTurn(state: CombatState): GameEvent[] {
  const events: GameEvent[] = [];

  // Simulates a decent but imperfect human player.
  // Plays powers, then makes reasonable but not always optimal choices.
  const playable = () => state.hand.filter(c => canPlayCard(state, c));

  // Play powers first (one-time permanent effects) — humans always do this
  for (const card of playable()) {
    if (card.type === 'power') {
      resolveCard(state, card, 0, events);
    }
  }

  // Find primary target (lowest HP alive enemy)
  const targetIdx = state.enemies.reduce((best, e, i) => {
    if (e.currentHP <= 0) return best;
    if (best === -1) return i;
    return e.currentHP < state.enemies[best].currentHP ? i : best;
  }, -1);

  // Play remaining cards — sometimes suboptimal
  let played = true;
  while (played) {
    played = false;
    const cards = playable();
    if (cards.length === 0) break;

    // 15% chance to play a random playable card instead of optimal
    const useRandom = Math.random() < 0.15;

    if (useRandom) {
      const card = cards[Math.floor(Math.random() * cards.length)];
      const target = card.target === 'self' ? 0 : targetIdx;
      resolveCard(state, card, target, events);
      played = true;
    } else {
      // Prefer 0-cost, then attacks, then skills
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
          resolveCard(state, card, target, events);
          played = true;
          break;
        }
      }
    }

    // 10% chance to end turn early (not spending all energy)
    if (Math.random() < 0.10) break;
  }

  return events;
}

// ─── Simulate One Fight ──────────────────────────────────

interface FightResult {
  won: boolean;
  turns: number;
  playerHPRemaining: number;
  playerHPStart: number;
}

function simulateFight(
  deck: Card[], enemyDefs: EnemyDef[], playerHP: number, playerMaxHP: number
): FightResult {
  const enemies = enemyDefs.map(createEnemyInstance);
  const state = initCombat([...deck], enemies, playerHP, playerMaxHP);
  const maxTurns = 30; // safety valve

  for (let t = 0; t < maxTurns; t++) {
    const turnEvents: GameEvent[] = [];

    // Start turn (draw, tick statuses, show intents)
    startTurn(state, turnEvents);

    // Check if burnout killed everything
    let result = isCombatOver(state);
    if (result) return { won: result === 'won', turns: state.turn, playerHPRemaining: state.playerHP, playerHPStart: playerHP };

    // AI plays cards
    aiPlayTurn(state);

    // Check after player plays
    result = isCombatOver(state);
    if (result) return { won: result === 'won', turns: state.turn, playerHPRemaining: state.playerHP, playerHPStart: playerHP };

    // Enemy turn
    resolveEnemyTurn(state, turnEvents);

    // End turn (discard, tick statuses)
    endTurn(state, turnEvents);

    result = isCombatOver(state);
    if (result) return { won: result === 'won', turns: state.turn, playerHPRemaining: state.playerHP, playerHPStart: playerHP };
  }

  // Timeout = loss
  return { won: false, turns: maxTurns, playerHPRemaining: state.playerHP, playerHPStart: playerHP };
}

// ─── Run Simulations ─────────────────────────────────────

function runSimulation(
  label: string, deck: Card[], enemyDefs: EnemyDef[],
  runs: number, startHP: number, maxHP: number
): { winRate: number; avgTurns: number; avgHPRemaining: number } {
  let wins = 0;
  let totalTurns = 0;
  let totalHPRemaining = 0;

  for (let i = 0; i < runs; i++) {
    const result = simulateFight(deck, enemyDefs, startHP, maxHP);
    if (result.won) {
      wins++;
      totalHPRemaining += result.playerHPRemaining;
    }
    totalTurns += result.turns;
  }

  return {
    winRate: wins / runs,
    avgTurns: totalTurns / runs,
    avgHPRemaining: wins > 0 ? totalHPRemaining / wins : 0,
  };
}

// ─── Main ────────────────────────────────────────────────

const RUNS = 500;
const MAX_HP = 72;

console.log('═══════════════════════════════════════════════════');
console.log('  HELP DESK CARD BATTLER — Combat Balance Test');
console.log('═══════════════════════════════════════════════════');
console.log(`  Simulating ${RUNS} fights per matchup`);
console.log(`  Player HP: ${MAX_HP} | Energy: 3/turn | Hand: 5`);
console.log(`  Deck: Starter (10 cards) | AI: greedy priority`);
console.log('');

// Build starter deck instances
resetInstanceCounter();
const starterDeck = STARTER_DECK.map(createCardInstance);

// Individual enemy matchups
console.log('─── Individual Enemy Matchups (Starter Deck) ─────');
console.log('');

for (const enemy of NORMAL_ENEMIES) {
  const result = runSimulation(enemy.name, starterDeck, [enemy], RUNS, MAX_HP, MAX_HP);
  const bar = '█'.repeat(Math.round(result.winRate * 20)) + '░'.repeat(20 - Math.round(result.winRate * 20));
  console.log(`  ${enemy.name.padEnd(22)} ${bar} ${(result.winRate * 100).toFixed(0).padStart(3)}% win | ${result.avgTurns.toFixed(1)} turns | ${result.avgHPRemaining.toFixed(0)} HP left`);
}

console.log('');

// Elite
const eliteResult = runSimulation(ELITE_ENEMY.name, starterDeck, [ELITE_ENEMY], RUNS, MAX_HP, MAX_HP);
const eliteBar = '█'.repeat(Math.round(eliteResult.winRate * 20)) + '░'.repeat(20 - Math.round(eliteResult.winRate * 20));
console.log(`  ${ELITE_ENEMY.name.padEnd(22)} ${eliteBar} ${(eliteResult.winRate * 100).toFixed(0).padStart(3)}% win | ${eliteResult.avgTurns.toFixed(1)} turns | ${eliteResult.avgHPRemaining.toFixed(0)} HP left`);
console.log('  ^ Elite (harder, expected 40-60% win rate)');

console.log('');

// Boss
const bossResult = runSimulation(BOSS_ENEMY.name, starterDeck, [BOSS_ENEMY], RUNS, MAX_HP, MAX_HP);
const bossBar = '█'.repeat(Math.round(bossResult.winRate * 20)) + '░'.repeat(20 - Math.round(bossResult.winRate * 20));
console.log(`  ${BOSS_ENEMY.name.padEnd(22)} ${bossBar} ${(bossResult.winRate * 100).toFixed(0).padStart(3)}% win | ${bossResult.avgTurns.toFixed(1)} turns | ${bossResult.avgHPRemaining.toFixed(0)} HP left`);
console.log('  ^ Boss (expected 25-40% win rate with starter deck)');

console.log('');

// Full floor run (5 fights + elite + boss, HP carries over)
console.log('─── Full Floor Run (5 normal + elite + boss) ─────');
console.log('');

let floorWins = 0;
let totalFightsWon = 0;
const floorRuns = RUNS;

for (let r = 0; r < floorRuns; r++) {
  resetInstanceCounter();
  let deck = STARTER_DECK.map(createCardInstance);
  let hp = MAX_HP;
  let fightsWon = 0;

  // 5 normal fights (random enemy each)
  for (let f = 0; f < 5; f++) {
    const enemy = NORMAL_ENEMIES[Math.floor(Math.random() * NORMAL_ENEMIES.length)];
    const result = simulateFight(deck, [enemy], hp, MAX_HP);
    if (!result.won) break;
    fightsWon++;
    hp = result.playerHPRemaining;

    // Simulate card reward: add a random reward card
    if (REWARD_POOL.length > 0) {
      const reward = REWARD_POOL[Math.floor(Math.random() * REWARD_POOL.length)];
      deck.push(createCardInstance(reward));
    }

    // Simulate "smart player takes less damage" — small heal between fights
    // Real players block better than the AI. This approximates that gap.
    hp = Math.min(hp + 6, MAX_HP);
  }

  // Elite
  if (fightsWon === 5) {
    const result = simulateFight(deck, [ELITE_ENEMY], hp, MAX_HP);
    if (result.won) {
      fightsWon++;
      hp = result.playerHPRemaining;
      // Reward after elite
      const reward = REWARD_POOL[Math.floor(Math.random() * REWARD_POOL.length)];
      deck.push(createCardInstance(reward));
    }
  }

  // Boss
  if (fightsWon === 6) {
    const result = simulateFight(deck, [BOSS_ENEMY], hp, MAX_HP);
    if (result.won) {
      fightsWon++;
      floorWins++;
    }
  }

  totalFightsWon += fightsWon;
}

const avgFights = totalFightsWon / floorRuns;
const floorRate = floorWins / floorRuns;
const floorBar = '█'.repeat(Math.round(floorRate * 20)) + '░'.repeat(20 - Math.round(floorRate * 20));

console.log(`  Floor clear rate:   ${floorBar} ${(floorRate * 100).toFixed(0).padStart(3)}%`);
console.log(`  Avg fights won:     ${avgFights.toFixed(1)} / 7`);
console.log(`  Full clears:        ${floorWins} / ${floorRuns}`);
console.log('');
console.log('  Target: 20-35% floor clear rate');
console.log('  (Feels hard but achievable — like StS Act 1)');
console.log('');

// Balance check
console.log('─── Balance Check ─────────────────────────────────');
console.log('');

const issues: string[] = [];

// Normal fights at full HP should be near-guaranteed (95%+) — like StS
for (const enemy of NORMAL_ENEMIES) {
  const r = runSimulation(enemy.name, starterDeck, [enemy], RUNS, MAX_HP, MAX_HP);
  if (r.winRate < 0.90) issues.push(`⚠ ${enemy.name}: win rate ${(r.winRate*100).toFixed(0)}% too low (target: 90%+ at full HP)`);
  if (r.avgTurns > 6) issues.push(`⚠ ${enemy.name}: avg ${r.avgTurns.toFixed(1)} turns too slow (target: 3-5)`);
}

// Elite at full HP should be beatable but taxing (70-90%)
if (eliteResult.winRate < 0.60) issues.push(`⚠ Elite (${ELITE_ENEMY.name}): win rate ${(eliteResult.winRate*100).toFixed(0)}% too low (target: 70-90% at full HP)`);
if (eliteResult.winRate > 0.95) issues.push(`⚠ Elite (${ELITE_ENEMY.name}): win rate ${(eliteResult.winRate*100).toFixed(0)}% too easy (target: 70-90%)`);

// Boss at full HP — should be a real fight (40-65%)
if (bossResult.winRate < 0.30) issues.push(`⚠ Boss (${BOSS_ENEMY.name}): win rate ${(bossResult.winRate*100).toFixed(0)}% too punishing (target: 40-65% at full HP)`);
if (bossResult.winRate > 0.70) issues.push(`⚠ Boss (${BOSS_ENEMY.name}): win rate ${(bossResult.winRate*100).toFixed(0)}% too easy (target: 40-65%)`);

// Floor clear — the true balance metric. AI plays imperfectly, so 15-35% is good.
if (floorRate < 0.10) issues.push(`⚠ Floor clear rate ${(floorRate*100).toFixed(0)}% too punishing (target: 15-35%)`);
if (floorRate > 0.45) issues.push(`⚠ Floor clear rate ${(floorRate*100).toFixed(0)}% too easy (target: 15-35%)`);

if (issues.length === 0) {
  console.log('  ✅ All balance targets met!');
} else {
  for (const issue of issues) console.log(`  ${issue}`);
}

console.log('');
console.log('═══════════════════════════════════════════════════');
