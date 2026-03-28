// Card definitions for Help Desk Card Battler — Executive Edition
// Cards now have suits (for scoring) and ranks (for KPI contribution).
// Suit is independent of card type — combat reads type+effects, scoring reads suit+rank.

import type { Suit } from './suits';

export interface CardEffect {
  type: 'damage' | 'block' | 'draw' | 'energy' | 'applyStatus' | 'heal' | 'multiHit';
  value: number;
  status?: string;
  times?: number;
}

export interface CardDef {
  id: string;
  name: string;
  cost: number;
  type: 'attack' | 'skill' | 'power';
  suit: Suit;
  rank: number; // 1-10, used for KPI scoring
  rarity: 'starter' | 'common' | 'uncommon' | 'rare';
  target: 'enemy' | 'self' | 'allEnemies';
  effects: CardEffect[];
  flavor?: string;
}

export interface Card extends CardDef {
  instanceId: number;
}

let _nextInstanceId = 0;
export function createCardInstance(def: CardDef): Card {
  return { ...def, instanceId: _nextInstanceId++ };
}
export function resetInstanceCounter() { _nextInstanceId = 0; }

// ─── Starter Deck (10 cards, balanced suits: 3D/3M/2G/2H) ──────

export const STARTER_DECK: CardDef[] = [
  // Tickets (3) — IT escalations, patches, troubleshooting
  { id: 'escalate_to_level_2', name: 'Escalate to Level 2', cost: 1, type: 'attack',
    suit: 'tickets', rank: 6,
    rarity: 'starter', target: 'enemy',
    effects: [{ type: 'damage', value: 6 }],
    flavor: 'Not your problem anymore. Forwarded with high importance.' },

  { id: 'password_expired', name: 'Password Expired', cost: 1, type: 'attack',
    suit: 'tickets', rank: 8,
    rarity: 'starter', target: 'enemy',
    effects: [{ type: 'damage', value: 8 }],
    flavor: 'Your password has expired. No, the old one won\'t work.' },

  { id: 'works_on_my_machine', name: 'Works On My Machine', cost: 1, type: 'skill',
    suit: 'tickets', rank: 4,
    rarity: 'starter', target: 'self',
    effects: [{ type: 'block', value: 5 }, { type: 'draw', value: 1 }],
    flavor: 'Works on my machine. Closing ticket.' },

  // Bureaucracy (3) — red tape, policies, CYA
  { id: 'per_my_last_email', name: 'Per My Last Email', cost: 1, type: 'attack',
    suit: 'bureaucracy', rank: 5,
    rarity: 'starter', target: 'enemy',
    effects: [{ type: 'damage', value: 5 }, { type: 'applyStatus', status: 'micromanaged', value: 1 }],
    flavor: 'As I clearly stated in my previous correspondence...' },

  { id: 'reply_all', name: 'Reply All', cost: 2, type: 'attack',
    suit: 'bureaucracy', rank: 7,
    rarity: 'starter', target: 'allEnemies',
    effects: [{ type: 'damage', value: 7 }],
    flavor: '312 recipients. No one asked for this.' },

  { id: 'documentation', name: 'Documentation', cost: 1, type: 'power',
    suit: 'bureaucracy', rank: 3,
    rarity: 'starter', target: 'self',
    effects: [{ type: 'applyStatus', status: 'documented', value: 2 }],
    flavor: 'Wrote it down. Updated the wiki. Screenshot for good measure.' },

  // Meetings (2) — stalling, blocking, culture
  { id: 'schedule_a_meeting', name: 'Schedule A Meeting', cost: 1, type: 'skill',
    suit: 'meetings', rank: 5,
    rarity: 'starter', target: 'self',
    effects: [{ type: 'block', value: 7 }],
    flavor: 'Nothing productive will happen, but nobody can touch you.' },

  { id: 'all_hands', name: 'All-Hands', cost: 1, type: 'skill',
    suit: 'meetings', rank: 4,
    rarity: 'starter', target: 'self',
    effects: [{ type: 'block', value: 5 }, { type: 'energy', value: 1 }],
    flavor: 'Mandatory attendance. Somehow, you leave with more energy.' },

  // Org Chart (2) — hiring, firing, reorgs, power moves
  { id: 'fire_the_intern', name: 'Fire The Intern', cost: 0, type: 'skill',
    suit: 'orgchart', rank: 2,
    rarity: 'starter', target: 'self',
    effects: [{ type: 'draw', value: 2 }],
    flavor: "It's not personal. It's headcount." },

  { id: 'hr_complaint', name: 'HR Complaint', cost: 1, type: 'skill',
    suit: 'orgchart', rank: 6,
    rarity: 'starter', target: 'enemy',
    effects: [{ type: 'applyStatus', status: 'micromanaged', value: 2 }],
    flavor: 'Filed in triplicate. Acknowledged in 5-7 business days.' },
];

// ─── Reward Pool ─────────────────────────────────────────

export const REWARD_POOL: CardDef[] = [
  // Tickets
  { id: 'patch_tuesday', name: 'Patch Tuesday', cost: 2, type: 'attack',
    suit: 'tickets', rank: 9,
    rarity: 'uncommon', target: 'enemy',
    effects: [{ type: 'damage', value: 5 }, { type: 'applyStatus', status: 'unpatched', value: 2 }],
    flavor: '47 critical. 212 high. Last scan: never.' },

  { id: 'bsod', name: 'BSOD', cost: 2, type: 'attack',
    suit: 'tickets', rank: 10,
    rarity: 'rare', target: 'enemy',
    effects: [{ type: 'damage', value: 18 }],
    flavor: 'Blue screen. No save. No warning. No mercy.' },

  { id: 'ctrl_z', name: 'Ctrl+Z', cost: 1, type: 'skill',
    suit: 'tickets', rank: 7,
    rarity: 'common', target: 'self',
    effects: [{ type: 'block', value: 8 }, { type: 'draw', value: 1 }],
    flavor: 'Ctrl+Z that decision.' },

  // Bureaucracy
  { id: 'cc_the_ceo', name: "CC The CEO", cost: 1, type: 'attack',
    suit: 'bureaucracy', rank: 8,
    rarity: 'common', target: 'enemy',
    effects: [{ type: 'damage', value: 10 }],
    flavor: 'Nuclear option. Nobody wins, but they lose harder.' },

  { id: 'policy_change', name: 'Policy Change', cost: 1, type: 'skill',
    suit: 'bureaucracy', rank: 6,
    rarity: 'common', target: 'enemy',
    effects: [{ type: 'applyStatus', status: 'unpatched', value: 2 }],
    flavor: 'Effective immediately. No, we will not be taking questions.' },

  // Meetings
  { id: 'emergency_meeting', name: 'Emergency Meeting', cost: 0, type: 'skill',
    suit: 'meetings', rank: 3,
    rarity: 'uncommon', target: 'self',
    effects: [{ type: 'block', value: 12 }, { type: 'draw', value: 1 }],
    flavor: 'Drop everything. Yes, everything.' },

  { id: 'synergy_session', name: 'Synergy Session', cost: 1, type: 'skill',
    suit: 'meetings', rank: 5,
    rarity: 'common', target: 'self',
    effects: [{ type: 'applyStatus', status: 'caffeinated', value: 3 }],
    flavor: 'Alignment. Bandwidth. Circle back. You feel... powerful.' },

  // Org Chart
  { id: 'mass_layoff', name: 'Mass Layoff', cost: 2, type: 'attack',
    suit: 'orgchart', rank: 9,
    rarity: 'rare', target: 'allEnemies',
    effects: [{ type: 'damage', value: 10 }],
    flavor: 'We appreciate your contributions. Security will escort you out.' },

  { id: 'hire_consultant', name: 'Hire Consultant', cost: 1, type: 'skill',
    suit: 'orgchart', rank: 7,
    rarity: 'uncommon', target: 'self',
    effects: [{ type: 'heal', value: 8 }],
    flavor: "$500/hour. Results not guaranteed. But you'll feel better." },

  { id: 'reorganization', name: 'Reorganization', cost: 2, type: 'skill',
    suit: 'orgchart', rank: 8,
    rarity: 'rare', target: 'self',
    effects: [{ type: 'block', value: 20 }, { type: 'draw', value: 2 }],
    flavor: 'New org chart. Same problems. But hey, new titles.' },
];
