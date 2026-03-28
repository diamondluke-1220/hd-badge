// Combat Resolver for Help Desk Card Battler
// Pure functions, no DOM, no side effects beyond state mutation.
// Produces GameEvent[] arrays for UI layer to animate.

import type { Card, CardEffect } from './cards';
import type { EnemyInstance } from './enemies';
import { applyStatus, getStacks, tickStatuses, type StatusInstance } from './statuses';

// ─── Game State ──────────────────────────────────────────

export interface CombatState {
  playerHP: number;
  playerMaxHP: number;
  playerBlock: number;
  energy: number;
  maxEnergy: number;
  drawPile: Card[];
  hand: Card[];
  discardPile: Card[];
  exhaustPile: Card[];
  playerStatuses: StatusInstance[];
  enemies: EnemyInstance[];
  turn: number;
}

// ─── Game Events ─────────────────────────────────────────

export type GameEvent =
  | { type: 'DRAW'; cardName: string }
  | { type: 'SHUFFLE' }
  | { type: 'PLAY_CARD'; cardName: string; cost: number }
  | { type: 'DAMAGE'; target: 'enemy'; index: number; value: number; blocked: number }
  | { type: 'PLAYER_DAMAGE'; value: number; blocked: number }
  | { type: 'BLOCK'; value: number }
  | { type: 'ENEMY_BLOCK'; index: number; value: number }
  | { type: 'ENERGY_GAIN'; value: number }
  | { type: 'HEAL'; value: number }
  | { type: 'ENEMY_HEAL'; index: number; value: number }
  | { type: 'STATUS_APPLIED'; target: 'player' | 'enemy'; index: number; status: string; stacks: number }
  | { type: 'STATUS_TICK'; target: 'player' | 'enemy'; index: number; status: string; damage?: number }
  | { type: 'ENEMY_DIED'; index: number; name: string }
  | { type: 'ENEMY_INTENT'; index: number; intent: string; value: number; times?: number }
  | { type: 'TURN_START'; turn: number; energy: number }
  | { type: 'TURN_END' }
  | { type: 'COMBAT_WON' }
  | { type: 'COMBAT_LOST' };

// ─── Shuffle ─────────────────────────────────────────────

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Draw Cards ──────────────────────────────────────────

export function drawCards(state: CombatState, count: number, events: GameEvent[]): void {
  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length === 0) break;
      state.drawPile = shuffle(state.discardPile);
      state.discardPile = [];
      events.push({ type: 'SHUFFLE' });
    }
    const card = state.drawPile.pop()!;
    state.hand.push(card);
    events.push({ type: 'DRAW', cardName: card.name });
  }
}

// ─── Damage Calculation ──────────────────────────────────

function calcPlayerDamage(state: CombatState, baseDmg: number): number {
  let dmg = baseDmg;
  dmg += getStacks(state.playerStatuses, 'caffeinated');
  dmg += getStacks(state.playerStatuses, 'seniority');
  return Math.max(0, dmg);
}

function applyUnpatched(enemy: EnemyInstance, dmg: number): number {
  if (getStacks(enemy.statusEffects, 'unpatched') > 0) {
    return Math.floor(dmg * 1.5);
  }
  return dmg;
}

function dealDamageToEnemy(enemy: EnemyInstance, dmg: number, index: number, events: GameEvent[]): void {
  let blocked = 0;
  if (enemy.block > 0) {
    blocked = Math.min(enemy.block, dmg);
    enemy.block -= blocked;
    dmg -= blocked;
  }
  const actual = Math.min(dmg, enemy.currentHP);
  enemy.currentHP -= actual;
  events.push({ type: 'DAMAGE', target: 'enemy', index, value: actual, blocked });
  if (enemy.currentHP <= 0) {
    events.push({ type: 'ENEMY_DIED', index, name: enemy.name });
  }
}

function dealDamageToPlayer(state: CombatState, dmg: number, events: GameEvent[]): void {
  let blocked = 0;
  if (state.playerBlock > 0) {
    blocked = Math.min(state.playerBlock, dmg);
    state.playerBlock -= blocked;
    dmg -= blocked;
  }
  const actual = Math.min(dmg, state.playerHP);
  state.playerHP -= actual;
  events.push({ type: 'PLAYER_DAMAGE', value: actual, blocked });
}

// ─── Card Resolution ─────────────────────────────────────

export function canPlayCard(state: CombatState, card: Card): boolean {
  return card.cost <= state.energy;
}

export function resolveCard(
  state: CombatState, card: Card, targetIndex: number, events: GameEvent[]
): void {
  if (!canPlayCard(state, card)) return;

  state.energy -= card.cost;
  events.push({ type: 'PLAY_CARD', cardName: card.name, cost: card.cost });

  for (const effect of card.effects) {
    resolveEffect(state, card, effect, targetIndex, events);
  }

  // Move from hand to discard
  const idx = state.hand.findIndex(c => c.instanceId === card.instanceId);
  if (idx >= 0) state.hand.splice(idx, 1);

  // Powers go to exhaust (played once, permanent effect)
  if (card.type === 'power') {
    state.exhaustPile.push(card);
  } else {
    state.discardPile.push(card);
  }
}

function resolveEffect(
  state: CombatState, card: Card, effect: CardEffect,
  targetIndex: number, events: GameEvent[]
): void {
  switch (effect.type) {
    case 'damage': {
      if (card.target === 'allEnemies') {
        state.enemies.forEach((enemy, i) => {
          if (enemy.currentHP <= 0) return;
          let dmg = calcPlayerDamage(state, effect.value);
          dmg = applyUnpatched(enemy, dmg);
          dealDamageToEnemy(enemy, dmg, i, events);
        });
      } else {
        const enemy = state.enemies[targetIndex];
        if (!enemy || enemy.currentHP <= 0) break;
        let dmg = calcPlayerDamage(state, effect.value);
        dmg = applyUnpatched(enemy, dmg);
        dealDamageToEnemy(enemy, dmg, targetIndex, events);
      }
      break;
    }
    case 'multiHit': {
      const times = effect.times ?? 1;
      for (let i = 0; i < times; i++) {
        const enemy = state.enemies[targetIndex];
        if (!enemy || enemy.currentHP <= 0) break;
        let dmg = calcPlayerDamage(state, effect.value);
        dmg = applyUnpatched(enemy, dmg);
        dealDamageToEnemy(enemy, dmg, targetIndex, events);
      }
      break;
    }
    case 'block': {
      state.playerBlock += effect.value;
      events.push({ type: 'BLOCK', value: effect.value });
      break;
    }
    case 'draw': {
      drawCards(state, effect.value, events);
      break;
    }
    case 'energy': {
      state.energy += effect.value;
      events.push({ type: 'ENERGY_GAIN', value: effect.value });
      break;
    }
    case 'heal': {
      const healed = Math.min(effect.value, state.playerMaxHP - state.playerHP);
      state.playerHP += healed;
      events.push({ type: 'HEAL', value: healed });
      break;
    }
    case 'applyStatus': {
      if (!effect.status) break;
      if (card.target === 'self') {
        applyStatus(state.playerStatuses, effect.status, effect.value);
        events.push({ type: 'STATUS_APPLIED', target: 'player', index: 0, status: effect.status, stacks: effect.value });
      } else if (card.target === 'allEnemies') {
        state.enemies.forEach((enemy, i) => {
          if (enemy.currentHP <= 0) return;
          applyStatus(enemy.statusEffects, effect.status, effect.value);
          events.push({ type: 'STATUS_APPLIED', target: 'enemy', index: i, status: effect.status, stacks: effect.value });
        });
      } else {
        const enemy = state.enemies[targetIndex];
        if (!enemy || enemy.currentHP <= 0) break;
        applyStatus(enemy.statusEffects, effect.status, effect.value);
        events.push({ type: 'STATUS_APPLIED', target: 'enemy', index: targetIndex, status: effect.status, stacks: effect.value });
      }
      break;
    }
  }
}

// ─── Enemy Intent Resolution ─────────────────────────────

export function getEnemyCurrentIntent(enemy: EnemyInstance) {
  return enemy.intentPattern[enemy.intentIndex % enemy.intentPattern.length];
}

export function resolveEnemyTurn(state: CombatState, events: GameEvent[]): void {
  for (let i = 0; i < state.enemies.length; i++) {
    const enemy = state.enemies[i];
    if (enemy.currentHP <= 0) continue;

    const intent = getEnemyCurrentIntent(enemy);
    const micromanaged = getStacks(enemy.statusEffects, 'micromanaged') > 0;
    const dmgMod = micromanaged ? 0.75 : 1;
    const str = getStacks(enemy.statusEffects, 'seniority');

    switch (intent.type) {
      case 'attack': {
        const dmg = Math.floor((intent.value + str) * dmgMod);
        dealDamageToPlayer(state, dmg, events);
        break;
      }
      case 'multiAttack': {
        const times = intent.times ?? 1;
        for (let t = 0; t < times; t++) {
          if (state.playerHP <= 0) break;
          const dmg = Math.floor((intent.value + str) * dmgMod);
          dealDamageToPlayer(state, dmg, events);
        }
        break;
      }
      case 'defend': {
        enemy.block += intent.value;
        events.push({ type: 'ENEMY_BLOCK', index: i, value: intent.value });
        break;
      }
      case 'buff': {
        if (intent.status) {
          applyStatus(enemy.statusEffects, intent.status, intent.value);
          events.push({ type: 'STATUS_APPLIED', target: 'enemy', index: i, status: intent.status, stacks: intent.value });
        }
        break;
      }
      case 'debuff': {
        if (intent.status) {
          applyStatus(state.playerStatuses, intent.status, intent.value);
          events.push({ type: 'STATUS_APPLIED', target: 'player', index: 0, status: intent.status, stacks: intent.value });
        }
        break;
      }
      case 'heal': {
        const healed = Math.min(intent.value, enemy.hp - enemy.currentHP);
        enemy.currentHP += healed;
        events.push({ type: 'ENEMY_HEAL', index: i, value: healed });
        break;
      }
    }

    // Advance intent: random enemies jump to random slot, scripted enemies cycle
    if (enemy.randomIntents) {
      enemy.intentIndex = Math.floor(Math.random() * enemy.intentPattern.length);
    } else {
      enemy.intentIndex = (enemy.intentIndex + 1) % enemy.intentPattern.length;
    }
  }
}

// ─── Turn Start / End ────────────────────────────────────

export function startTurn(state: CombatState, events: GameEvent[]): void {
  state.turn++;
  state.energy = state.maxEnergy;
  state.playerBlock = 0;

  // Documented: gain block at turn start
  const docStacks = getStacks(state.playerStatuses, 'documented');
  if (docStacks > 0) {
    state.playerBlock += docStacks;
    events.push({ type: 'BLOCK', value: docStacks });
  }

  events.push({ type: 'TURN_START', turn: state.turn, energy: state.energy });

  // Tick burnout on enemies
  for (let i = 0; i < state.enemies.length; i++) {
    const enemy = state.enemies[i];
    if (enemy.currentHP <= 0) continue;
    const burnout = getStacks(enemy.statusEffects, 'burnout');
    if (burnout > 0) {
      const dmg = Math.min(burnout, enemy.currentHP);
      enemy.currentHP -= dmg;
      events.push({ type: 'STATUS_TICK', target: 'enemy', index: i, status: 'burnout', damage: dmg });
      if (enemy.currentHP <= 0) {
        events.push({ type: 'ENEMY_DIED', index: i, name: enemy.name });
      }
    }
  }

  // Tick burnout on player (if enemies applied it)
  const playerBurnout = getStacks(state.playerStatuses, 'burnout');
  if (playerBurnout > 0) {
    const dmg = Math.min(playerBurnout, state.playerHP);
    state.playerHP -= dmg;
    events.push({ type: 'STATUS_TICK', target: 'player', index: 0, status: 'burnout', damage: dmg });
  }

  // Show enemy intents
  for (let i = 0; i < state.enemies.length; i++) {
    const enemy = state.enemies[i];
    if (enemy.currentHP <= 0) continue;
    const intent = getEnemyCurrentIntent(enemy);
    events.push({
      type: 'ENEMY_INTENT', index: i,
      intent: intent.type, value: intent.value, times: intent.times,
    });
  }

  // Draw hand
  drawCards(state, 5, events);
}

export function endTurn(state: CombatState, events: GameEvent[]): void {
  // Discard remaining hand
  state.discardPile.push(...state.hand);
  state.hand = [];

  // Reset enemy block
  for (const enemy of state.enemies) {
    enemy.block = 0;
  }

  // Tick decrementable statuses
  state.playerStatuses = tickStatuses(state.playerStatuses);
  for (const enemy of state.enemies) {
    if (enemy.currentHP <= 0) continue;
    enemy.statusEffects = tickStatuses(enemy.statusEffects);
  }

  events.push({ type: 'TURN_END' });
}

// ─── Combat Status Check ─────────────────────────────────

export function isCombatOver(state: CombatState): 'won' | 'lost' | null {
  if (state.playerHP <= 0) return 'lost';
  if (state.enemies.every(e => e.currentHP <= 0)) return 'won';
  return null;
}

// ─── Init Combat State ───────────────────────────────────

export function initCombat(
  deck: Card[], enemies: EnemyInstance[], playerHP: number, playerMaxHP: number
): CombatState {
  return {
    playerHP,
    playerMaxHP,
    playerBlock: 0,
    energy: 3,
    maxEnergy: 3,
    drawPile: shuffle(deck),
    hand: [],
    discardPile: [],
    exhaustPile: [],
    playerStatuses: [],
    enemies,
    turn: 0,
  };
}
