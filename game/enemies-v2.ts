// Enemy definitions for Help Desk Card Battler — Executive Edition
// You're the evil exec. These are the employees fighting back.

import type { StatusInstance } from './statuses';

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
  department: string;
  tagline: string;
  intentPattern: EnemyIntent[];
}

export interface EnemyInstance extends EnemyDef {
  currentHP: number;
  block: number;
  intentIndex: number;
  statusEffects: StatusInstance[];
}

export function createEnemyInstance(def: EnemyDef): EnemyInstance {
  return {
    ...def,
    currentHP: def.hp,
    block: 0,
    intentIndex: 0,
    statusEffects: [],
  };
}

// ─── Department Employees (Normal Enemies) ──────────────────

export const NORMAL_ENEMIES: EnemyDef[] = [
  { id: 'the_slacker', name: 'The Slacker', hp: 30,
    department: 'IT',
    tagline: 'Doing the bare minimum since orientation.',
    intentPattern: [
      { type: 'attack', value: 8 },
      { type: 'defend', value: 6 },
      { type: 'attack', value: 12 },
    ] },

  { id: 'passive_aggressive_pam', name: 'Passive-Aggressive Pam', hp: 36,
    department: 'HR',
    tagline: '"Per my last email, which you clearly didn\'t read."',
    intentPattern: [
      { type: 'debuff', value: 2, status: 'micromanaged' },
      { type: 'attack', value: 10 },
      { type: 'multiAttack', value: 4, times: 3 },
    ] },

  { id: 'union_rep', name: 'Union Rep', hp: 42,
    department: 'Operations',
    tagline: 'Article 7, Section 3, Paragraph 2. Read it.',
    intentPattern: [
      { type: 'defend', value: 12 },
      { type: 'buff', value: 2, status: 'seniority' },
      { type: 'attack', value: 14 },
      { type: 'defend', value: 10 },
    ] },

  { id: 'whistleblower', name: 'The Whistleblower', hp: 28,
    department: 'Compliance',
    tagline: 'I have documentation. All of it.',
    intentPattern: [
      { type: 'debuff', value: 2, status: 'unpatched' },
      { type: 'attack', value: 16 },
      { type: 'debuff', value: 3, status: 'burnout' },
    ] },
];

// ─── Elite Enemy ─────────────────────────────────────────────

export const ELITE_ENEMY: EnemyDef = {
  id: 'tenured_professor', name: 'The Tenured Employee', hp: 76,
  department: 'All',
  tagline: "Can't fire me. Won't retire. Knows where the bodies are buried.",
  intentPattern: [
    { type: 'attack', value: 12 },
    { type: 'buff', value: 3, status: 'seniority' },
    { type: 'multiAttack', value: 5, times: 3 },
    { type: 'heal', value: 12 },
    { type: 'attack', value: 18 },
  ],
};

// ─── Boss ────────────────────────────────────────────────────

export const BOSS_ENEMY: EnemyDef = {
  id: 'help_desk', name: 'Help Desk', hp: 92,
  department: 'IT',
  tagline: 'We ARE the Help Desk. We filed a ticket about YOU.',
  intentPattern: [
    { type: 'attack', value: 16 },
    { type: 'buff', value: 3, status: 'seniority' },
    { type: 'multiAttack', value: 6, times: 3 },
    { type: 'heal', value: 12 },
    { type: 'debuff', value: 2, status: 'unpatched' },
    { type: 'attack', value: 22 },
  ],
};
