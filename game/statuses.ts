// Status effect definitions for Help Desk Card Battler
// Pure data + tick functions. No DOM.

export interface StatusDef {
  id: string;
  name: string;
  type: 'buff' | 'debuff';
  decrements: boolean; // does it lose stacks each turn?
  description: string;
}

export interface StatusInstance {
  id: string;
  stacks: number;
}

// ─── Status Definitions ──────────────────────────────────

export const STATUS_DEFS: Record<string, StatusDef> = {
  burnout: {
    id: 'burnout', name: 'Burnout', type: 'debuff', decrements: true,
    description: 'Takes {N} damage at turn start. Loses 1 stack each turn.',
  },
  caffeinated: {
    id: 'caffeinated', name: 'Caffeinated', type: 'buff', decrements: true,
    description: '+{N} damage on all attacks. Loses 1 stack each turn.',
  },
  seniority: {
    id: 'seniority', name: 'Seniority', type: 'buff', decrements: false,
    description: '+{N} damage on all attacks. Permanent.',
  },
  unpatched: {
    id: 'unpatched', name: 'Unpatched', type: 'debuff', decrements: true,
    description: 'Takes 50% more damage. Loses 1 stack each turn.',
  },
  micromanaged: {
    id: 'micromanaged', name: 'Micromanaged', type: 'debuff', decrements: true,
    description: 'Deals 25% less damage. Loses 1 stack each turn.',
  },
  documented: {
    id: 'documented', name: 'Documented', type: 'buff', decrements: false,
    description: 'Gain {N} block at start of each turn. Permanent.',
  },
};

// ─── Status Helpers ──────────────────────────────────────

export function applyStatus(effects: StatusInstance[], statusId: string, stacks: number): void {
  const existing = effects.find(s => s.id === statusId);
  if (existing) {
    existing.stacks += stacks;
  } else {
    effects.push({ id: statusId, stacks });
  }
}

export function getStacks(effects: StatusInstance[], statusId: string): number {
  const s = effects.find(e => e.id === statusId);
  return s ? s.stacks : 0;
}

export function tickStatuses(effects: StatusInstance[]): StatusInstance[] {
  // Decrement all decrementable statuses, remove at 0
  return effects.filter(s => {
    const def = STATUS_DEFS[s.id];
    if (def && def.decrements) {
      s.stacks -= 1;
      return s.stacks > 0;
    }
    return true; // permanent statuses stay
  });
}
