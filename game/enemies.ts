// Enemy definitions for Help Desk Card Battler
// Intent patterns cycle — enemy does intent[0], then intent[1], etc., wrapping around.

export interface EnemyIntent {
  type: 'attack' | 'defend' | 'buff' | 'debuff' | 'multiAttack' | 'heal';
  value: number;
  times?: number;
  status?: string;
}

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  tagline: string;
  intentPattern: EnemyIntent[];
}

export interface EnemyInstance extends EnemyDef {
  currentHP: number;
  block: number;
  intentIndex: number;
  statusEffects: StatusInstance[];
}

import type { StatusInstance } from './statuses';

export function createEnemyInstance(def: EnemyDef): EnemyInstance {
  return {
    ...def,
    currentHP: def.hp,
    block: 0,
    intentIndex: 0,
    statusEffects: [],
  };
}

// ─── Normal Enemies ──────────────────────────────────────

export const NORMAL_ENEMIES: EnemyDef[] = [
  { id: 'the_slacker', name: 'The Slacker', hp: 30,
    tagline: 'Doing the bare minimum since day one.',
    intentPattern: [
      { type: 'attack', value: 8 },
      { type: 'defend', value: 6 },
      { type: 'attack', value: 12 },
    ] },

  { id: 'reply_all_randy', name: 'Reply-All Randy', hp: 36,
    tagline: 'You have 47 unread messages. 48. 49.',
    intentPattern: [
      { type: 'multiAttack', value: 4, times: 3 },
      { type: 'buff', value: 2, status: 'seniority' },
      { type: 'attack', value: 14 },
    ] },

  { id: 'the_micromanager', name: 'The Micromanager', hp: 42,
    tagline: 'Just checking in. Again.',
    intentPattern: [
      { type: 'debuff', value: 2, status: 'micromanaged' },
      { type: 'attack', value: 12 },
      { type: 'attack', value: 14 },
      { type: 'defend', value: 10 },
    ] },

  { id: 'printer_jam', name: 'Printer Jam', hp: 28,
    tagline: 'PC LOAD LETTER.',
    intentPattern: [
      { type: 'defend', value: 14 },
      { type: 'defend', value: 12 },
      { type: 'attack', value: 20 },
    ] },
];

// ─── Elite Enemy ─────────────────────────────────────────

export const ELITE_ENEMY: EnemyDef = {
  id: 'the_consultant', name: 'The Consultant', hp: 76,
  tagline: "That'll be $500/hour. Results not guaranteed.",
  intentPattern: [
    { type: 'attack', value: 12 },
    { type: 'buff', value: 3, status: 'seniority' },
    { type: 'multiAttack', value: 5, times: 3 },
    { type: 'debuff', value: 2, status: 'unpatched' },
    { type: 'attack', value: 18 },
  ],
};

// ─── Boss ────────────────────────────────────────────────

export const BOSS_ENEMY: EnemyDef = {
  id: 'the_sysadmin', name: 'The Sysadmin', hp: 92,
  tagline: 'sudo rm -rf /your/career',
  intentPattern: [
    { type: 'attack', value: 16 },
    { type: 'buff', value: 3, status: 'seniority' },
    { type: 'multiAttack', value: 6, times: 3 },
    { type: 'heal', value: 12 },
    { type: 'debuff', value: 2, status: 'unpatched' },
    { type: 'attack', value: 22 },
  ],
};
