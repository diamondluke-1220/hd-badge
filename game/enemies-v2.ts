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
  randomIntents?: boolean; // when true, picks random intent each turn instead of cycling
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
    intentIndex: def.randomIntents ? Math.floor(Math.random() * def.intentPattern.length) : 0,
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

  // ─── New Enemies (from arcade roster) ──────────────────────

  { id: 'network_wizard', name: 'The Network Wizard', hp: 32,
    department: 'IT',
    tagline: "It's always DNS.",
    randomIntents: true,
    intentPattern: [
      { type: 'attack', value: 10 },
      { type: 'multiAttack', value: 4, times: 3 },
      { type: 'defend', value: 8 },
      { type: 'debuff', value: 2, status: 'unpatched' },
    ] },

  { id: 'watercooler_will', name: 'Watercooler Will', hp: 34,
    department: 'Operations',
    tagline: 'Oh hey, quick question...',
    randomIntents: true,
    intentPattern: [
      { type: 'debuff', value: 2, status: 'burnout' },
      { type: 'attack', value: 8 },
      { type: 'debuff', value: 1, status: 'micromanaged' },
      { type: 'defend', value: 10 },
    ] },

  { id: 'hr_nancy', name: 'HR Nancy', hp: 38,
    department: 'HR',
    tagline: 'Just a quick mandatory training.',
    randomIntents: true,
    intentPattern: [
      { type: 'defend', value: 12 },
      { type: 'debuff', value: 2, status: 'micromanaged' },
      { type: 'attack', value: 10 },
      { type: 'debuff', value: 2, status: 'burnout' },
    ] },

  { id: 'dirty_microwave', name: 'The Dirty Microwave', hp: 26,
    department: 'Facilities',
    tagline: 'WHO LEFT FISH IN HERE?!',
    randomIntents: true,
    intentPattern: [
      { type: 'attack', value: 14 },
      { type: 'attack', value: 18 },
      { type: 'debuff', value: 3, status: 'burnout' },
    ] },

  { id: 'mfa_guardian', name: 'The MFA Guardian', hp: 30,
    department: 'IT',
    tagline: 'Enter your code. 3 seconds.',
    randomIntents: true,
    intentPattern: [
      { type: 'attack', value: 12 },
      { type: 'defend', value: 10 },
      { type: 'attack', value: 8 },
      { type: 'multiAttack', value: 3, times: 3 },
    ] },

  { id: 'sally_accounting', name: 'Sally in Accounting', hp: 36,
    department: 'Finance',
    tagline: 'This fight will be 1040-EZ.',
    randomIntents: true,
    intentPattern: [
      { type: 'attack', value: 10 },
      { type: 'debuff', value: 2, status: 'micromanaged' },
      { type: 'heal', value: 8 },
      { type: 'defend', value: 8 },
    ] },
];

// ─── Elite Enemies ───────────────────────────────────────────

export const ELITE_ENEMIES: EnemyDef[] = [
  { id: 'tenured_employee', name: 'The Tenured Employee', hp: 76,
    department: 'All',
    tagline: "Can't fire me. Won't retire. Knows where the bodies are buried.",
    intentPattern: [
      { type: 'attack', value: 12 },
      { type: 'buff', value: 3, status: 'seniority' },
      { type: 'multiAttack', value: 5, times: 3 },
      { type: 'heal', value: 12 },
      { type: 'attack', value: 18 },
    ] },

  { id: 'the_consultant', name: 'The Consultant', hp: 72,
    department: 'All',
    tagline: 'Twice the pay. Half the work.',
    randomIntents: true,
    intentPattern: [
      { type: 'attack', value: 18 },
      { type: 'multiAttack', value: 6, times: 3 },
      { type: 'heal', value: 14 },
      { type: 'attack', value: 14 },
      { type: 'defend', value: 16 },
    ] },

  { id: 'the_intern', name: 'The Intern', hp: 72,
    department: 'All',
    tagline: "I'm just happy to be here.",
    randomIntents: true,
    intentPattern: [
      { type: 'multiAttack', value: 4, times: 4 },
      { type: 'attack', value: 10 },
      { type: 'multiAttack', value: 3, times: 5 },
      { type: 'buff', value: 3, status: 'caffeinated' },
    ] },
];

// Keep single export for backwards compat with test-hybrid.ts
export const ELITE_ENEMY: EnemyDef = ELITE_ENEMIES[0];

// ─── Boss Enemies (Band Members + Help Desk) ────────────────

export const BOSS_ENEMIES: EnemyDef[] = [
  { id: 'help_desk', name: 'Help Desk', hp: 92,
    department: 'IT',
    tagline: 'We ARE the Help Desk. We filed a ticket about YOU.',
    intentPattern: [
      { type: 'attack', value: 16 },
      { type: 'buff', value: 3, status: 'seniority' },
      { type: 'multiAttack', value: 6, times: 3 },
      { type: 'heal', value: 12 },
      { type: 'debuff', value: 2, status: 'unpatched' },
      { type: 'attack', value: 22 },
    ] },

  { id: 'boss_luke', name: 'Luke', hp: 88,
    department: 'IT',
    tagline: "I'm escalating this to ME.",
    intentPattern: [
      { type: 'attack', value: 10 },
      { type: 'buff', value: 2, status: 'seniority' },
      { type: 'attack', value: 14 },
      { type: 'buff', value: 2, status: 'seniority' },
      { type: 'attack', value: 18 },
      { type: 'multiAttack', value: 6, times: 3 },
    ] },

  { id: 'boss_drew', name: 'Drew', hp: 85,
    department: 'Audio',
    tagline: "You're about to get feedback.",
    intentPattern: [
      { type: 'attack', value: 12 },
      { type: 'debuff', value: 2, status: 'burnout' },
      { type: 'attack', value: 16 },
      { type: 'buff', value: 3, status: 'seniority' },
      { type: 'multiAttack', value: 5, times: 3 },
      { type: 'attack', value: 20 },
    ] },

  { id: 'boss_henry', name: 'Henry', hp: 95,
    department: 'Operations',
    tagline: 'Brace for impact.',
    intentPattern: [
      { type: 'multiAttack', value: 4, times: 3 },
      { type: 'defend', value: 14 },
      { type: 'multiAttack', value: 5, times: 3 },
      { type: 'buff', value: 2, status: 'seniority' },
      { type: 'multiAttack', value: 6, times: 4 },
    ] },

  { id: 'boss_todd', name: 'Todd', hp: 96,
    department: 'Power',
    tagline: 'Stare Intensifies....',
    intentPattern: [
      { type: 'debuff', value: 3, status: 'micromanaged' },
      { type: 'multiAttack', value: 7, times: 3 },
      { type: 'debuff', value: 3, status: 'burnout' },
      { type: 'attack', value: 22 },
      { type: 'heal', value: 10 },
      { type: 'multiAttack', value: 8, times: 3 },
    ] },
];

// Keep single export for backwards compat with test-hybrid.ts
export const BOSS_ENEMY: EnemyDef = BOSS_ENEMIES[0];
