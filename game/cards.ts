// Card definitions for Help Desk Card Battler
// All card data — no logic, no DOM, just data.

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
  rarity: 'starter' | 'common' | 'uncommon' | 'rare';
  target: 'enemy' | 'self' | 'allEnemies';
  effects: CardEffect[];
  flavor?: string;
}

// Runtime card instance (tracks unique instance in a deck)
export interface Card extends CardDef {
  instanceId: number; // unique per card instance in a run
}

let _nextInstanceId = 0;
export function createCardInstance(def: CardDef): Card {
  return { ...def, instanceId: _nextInstanceId++ };
}
export function resetInstanceCounter() { _nextInstanceId = 0; }

// ─── Starter Deck ────────────────────────────────────────

export const STARTER_DECK: CardDef[] = [
  { id: 'stapler_strike', name: 'Stapler Strike', cost: 1, type: 'attack',
    rarity: 'starter', target: 'enemy',
    effects: [{ type: 'damage', value: 6 }],
    flavor: 'The red Swingline. Everyone knows not to touch it.' },

  { id: 'stapler_strike', name: 'Stapler Strike', cost: 1, type: 'attack',
    rarity: 'starter', target: 'enemy',
    effects: [{ type: 'damage', value: 6 }] },

  { id: 'coffee_break', name: 'Coffee Break', cost: 1, type: 'skill',
    rarity: 'starter', target: 'self',
    effects: [{ type: 'block', value: 5 }],
    flavor: 'Nobody can hurt you in the break room. Unwritten rule.' },

  { id: 'coffee_break', name: 'Coffee Break', cost: 1, type: 'skill',
    rarity: 'starter', target: 'self',
    effects: [{ type: 'block', value: 5 }] },

  { id: 'memo', name: 'Memo', cost: 1, type: 'attack',
    rarity: 'starter', target: 'enemy',
    effects: [{ type: 'damage', value: 4 }, { type: 'draw', value: 1 }],
    flavor: 'As per the attached, which you did not read.' },

  { id: 'duck_and_cover', name: 'Duck and Cover', cost: 1, type: 'skill',
    rarity: 'starter', target: 'self',
    effects: [{ type: 'block', value: 8 }],
    flavor: 'Monitor angled just right. Headphones on. Invisible.' },

  { id: 'escalate', name: 'Escalate', cost: 1, type: 'attack',
    rarity: 'starter', target: 'enemy',
    effects: [{ type: 'damage', value: 8 }],
    flavor: 'Not your problem anymore. Forwarded with high importance.' },

  { id: 'keyboard_warrior', name: 'Keyboard Warrior', cost: 1, type: 'attack',
    rarity: 'starter', target: 'enemy',
    effects: [{ type: 'multiHit', value: 3, times: 2 }],
    flavor: '142 WPM when angry. 30 otherwise.' },

  { id: 'pto_request', name: 'PTO Request', cost: 1, type: 'skill',
    rarity: 'starter', target: 'self',
    effects: [{ type: 'block', value: 3 }, { type: 'energy', value: 1 }],
    flavor: 'Submitted 6 weeks ago. Approved 5 minutes ago.' },

  { id: 'documentation', name: 'Documentation', cost: 1, type: 'power',
    rarity: 'starter', target: 'self',
    effects: [{ type: 'applyStatus', status: 'documented', value: 2 }],
    flavor: 'Wrote it down. Updated the wiki. Screenshot for good measure.' },
];

// ─── Reward Pool ─────────────────────────────────────────

export const REWARD_POOL: CardDef[] = [
  // Burnout archetype
  { id: 'scope_creep', name: 'Scope Creep', cost: 1, type: 'attack',
    rarity: 'common', target: 'enemy',
    effects: [{ type: 'damage', value: 3 }, { type: 'applyStatus', status: 'burnout', value: 4 }],
    flavor: 'Oh and one more thing. And another. And...' },

  { id: 'weekend_email', name: 'Weekend Email', cost: 1, type: 'skill',
    rarity: 'common', target: 'enemy',
    effects: [{ type: 'applyStatus', status: 'burnout', value: 6 }],
    flavor: 'Sent at 11:47 PM on a Saturday. "Quick question."' },

  { id: 'unrealistic_deadline', name: 'Unrealistic Deadline', cost: 2, type: 'attack',
    rarity: 'uncommon', target: 'enemy',
    effects: [{ type: 'damage', value: 5 }, { type: 'applyStatus', status: 'burnout', value: 8 }],
    flavor: "Need this by EOD. It's 4:55." },

  // Unpatched archetype
  { id: 'vulnerability_scan', name: 'Vulnerability Scan', cost: 1, type: 'skill',
    rarity: 'common', target: 'enemy',
    effects: [{ type: 'applyStatus', status: 'unpatched', value: 2 }],
    flavor: '47 critical. 212 high. Last scan: never.' },

  { id: 'zero_day', name: 'Zero Day', cost: 2, type: 'attack',
    rarity: 'rare', target: 'enemy',
    effects: [{ type: 'damage', value: 18 }],
    flavor: 'No patch exists. No fix coming. Good luck.' },

  // Utility
  { id: 'double_espresso', name: 'Double Espresso', cost: 0, type: 'skill',
    rarity: 'uncommon', target: 'self',
    effects: [{ type: 'applyStatus', status: 'caffeinated', value: 2 }, { type: 'draw', value: 1 }],
    flavor: 'Third one today. Hands are shaking. Never felt more alive.' },

  { id: 'hr_complaint', name: 'HR Complaint', cost: 1, type: 'skill',
    rarity: 'common', target: 'enemy',
    effects: [{ type: 'applyStatus', status: 'micromanaged', value: 2 }],
    flavor: 'Filed in triplicate. Acknowledged in 5-7 business days.' },

  { id: 'reply_all', name: 'Reply All', cost: 2, type: 'attack',
    rarity: 'common', target: 'allEnemies',
    effects: [{ type: 'damage', value: 8 }],
    flavor: '312 recipients. No one asked for this.' },

  { id: 'lunch_thief', name: 'Lunch Thief', cost: 1, type: 'skill',
    rarity: 'common', target: 'self',
    effects: [{ type: 'heal', value: 6 }],
    flavor: "It said 'Dave' on it. You are not Dave." },

  { id: 'malicious_compliance', name: 'Malicious Compliance', cost: 2, type: 'skill',
    rarity: 'rare', target: 'self',
    effects: [{ type: 'block', value: 20 }, { type: 'draw', value: 2 }],
    flavor: 'Per policy 4.7.3, subsection (b), paragraph 2. I followed every word.' },
];
