// ═══════════════════════════════════════════════════════
// Help Desk: Executive Edition — Game Engine
// Hybrid StS combat + Balatro scoring with tagging mechanic
// ═══════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── SUIT SYSTEM ─────────────────────────────────────
  const SUIT_ICONS = { tickets: 'TK', bureaucracy: 'BC', meetings: 'MT', orgchart: 'OC' };
  const SUIT_NAMES = { tickets: 'Tickets', bureaucracy: 'Bureaucracy', meetings: 'Meetings', orgchart: 'Org Chart' };

  // ─── CARD DATA (v2 — Executive Edition) ──────────────
  const STARTER_DECK = [
    { id: 'escalate_to_level_2', name: 'Escalate to Level 2', cost: 1, type: 'attack', suit: 'tickets', rank: 6,
      target: 'enemy', effects: [{ type: 'damage', value: 6 }],
      flavor: 'Not your problem anymore. Forwarded with high importance.' },
    { id: 'password_expired', name: 'Password Expired', cost: 1, type: 'attack', suit: 'tickets', rank: 8,
      target: 'enemy', effects: [{ type: 'damage', value: 8 }],
      flavor: "Your password has expired. No, the old one won't work." },
    { id: 'works_on_my_machine', name: 'Works On My Machine', cost: 1, type: 'skill', suit: 'tickets', rank: 4,
      target: 'self', effects: [{ type: 'block', value: 5 }, { type: 'draw', value: 1 }],
      flavor: 'Works on my machine. Closing ticket.' },
    { id: 'per_my_last_email', name: 'Per My Last Email', cost: 1, type: 'attack', suit: 'bureaucracy', rank: 5,
      target: 'enemy', effects: [{ type: 'damage', value: 5 }, { type: 'applyStatus', status: 'micromanaged', value: 1 }],
      flavor: 'As I clearly stated in my previous correspondence...' },
    { id: 'reply_all', name: 'Reply All', cost: 2, type: 'attack', suit: 'bureaucracy', rank: 7,
      target: 'allEnemies', effects: [{ type: 'damage', value: 7 }],
      flavor: '312 recipients. No one asked for this.' },
    { id: 'documentation', name: 'Documentation', cost: 1, type: 'power', suit: 'bureaucracy', rank: 3,
      target: 'self', effects: [{ type: 'applyStatus', status: 'documented', value: 2 }],
      flavor: 'Wrote it down. Updated the wiki. Screenshot for good measure.' },
    { id: 'schedule_a_meeting', name: 'Schedule A Meeting', cost: 1, type: 'skill', suit: 'meetings', rank: 5,
      target: 'self', effects: [{ type: 'block', value: 7 }],
      flavor: 'Nothing productive will happen, but nobody can touch you.' },
    { id: 'all_hands', name: 'All-Hands', cost: 1, type: 'skill', suit: 'meetings', rank: 4,
      target: 'self', effects: [{ type: 'block', value: 5 }, { type: 'energy', value: 1 }],
      flavor: 'Mandatory attendance. Somehow, you leave with more energy.' },
    { id: 'fire_the_intern', name: 'Fire The Intern', cost: 0, type: 'skill', suit: 'orgchart', rank: 2,
      target: 'self', effects: [{ type: 'draw', value: 2 }],
      flavor: "It's not personal. It's headcount." },
    { id: 'hr_complaint', name: 'HR Complaint', cost: 1, type: 'skill', suit: 'orgchart', rank: 6,
      target: 'enemy', effects: [{ type: 'applyStatus', status: 'micromanaged', value: 2 }],
      flavor: 'Filed in triplicate. Acknowledged in 5-7 business days.' },
  ];

  const REWARD_POOL = [
    { id: 'patch_tuesday', name: 'Patch Tuesday', cost: 2, type: 'attack', suit: 'tickets', rank: 9,
      target: 'enemy', effects: [{ type: 'damage', value: 5 }, { type: 'applyStatus', status: 'unpatched', value: 2 }],
      flavor: '47 critical. 212 high. Last scan: never.' },
    { id: 'bsod', name: 'BSOD', cost: 2, type: 'attack', suit: 'tickets', rank: 10,
      target: 'enemy', effects: [{ type: 'damage', value: 18 }],
      flavor: 'Blue screen. No save. No warning. No mercy.' },
    { id: 'ctrl_z', name: 'Ctrl+Z', cost: 1, type: 'skill', suit: 'tickets', rank: 7,
      target: 'self', effects: [{ type: 'block', value: 8 }, { type: 'draw', value: 1 }],
      flavor: 'Ctrl+Z that decision.' },
    { id: 'cc_the_ceo', name: 'CC The CEO', cost: 1, type: 'attack', suit: 'bureaucracy', rank: 8,
      target: 'enemy', effects: [{ type: 'damage', value: 10 }],
      flavor: 'Nuclear option. Nobody wins, but they lose harder.' },
    { id: 'policy_change', name: 'Policy Change', cost: 1, type: 'skill', suit: 'bureaucracy', rank: 6,
      target: 'enemy', effects: [{ type: 'applyStatus', status: 'unpatched', value: 2 }],
      flavor: 'Effective immediately. No, we will not be taking questions.' },
    { id: 'emergency_meeting', name: 'Emergency Meeting', cost: 0, type: 'skill', suit: 'meetings', rank: 3,
      target: 'self', effects: [{ type: 'block', value: 12 }, { type: 'draw', value: 1 }],
      flavor: 'Drop everything. Yes, everything.' },
    { id: 'synergy_session', name: 'Synergy Session', cost: 1, type: 'skill', suit: 'meetings', rank: 5,
      target: 'self', effects: [{ type: 'applyStatus', status: 'caffeinated', value: 3 }],
      flavor: 'Alignment. Bandwidth. Circle back. You feel... powerful.' },
    { id: 'mass_layoff', name: 'Mass Layoff', cost: 2, type: 'attack', suit: 'orgchart', rank: 9,
      target: 'allEnemies', effects: [{ type: 'damage', value: 10 }],
      flavor: 'We appreciate your contributions. Security will escort you out.' },
    { id: 'hire_consultant', name: 'Hire Consultant', cost: 1, type: 'skill', suit: 'orgchart', rank: 7,
      target: 'self', effects: [{ type: 'heal', value: 8 }],
      flavor: "$500/hour. Results not guaranteed. But you'll feel better." },
    { id: 'reorganization', name: 'Reorganization', cost: 2, type: 'skill', suit: 'orgchart', rank: 8,
      target: 'self', effects: [{ type: 'block', value: 20 }, { type: 'draw', value: 2 }],
      flavor: 'New org chart. Same problems. But hey, new titles.' },
  ];

  // ─── ENEMY DATA (v2 — Executive themed) ──────────────
  const FLOOR_ENCOUNTERS = [
    { type: 'normal', dept: 'IT', enemies: [{ id: 'the_slacker', name: 'The Slacker', hp: 30, dept: 'IT',
      tagline: 'Doing the bare minimum since orientation.', icon: '😴',
      intentPattern: [{ type: 'attack', value: 8 },{ type: 'defend', value: 6 },{ type: 'attack', value: 12 }] }] },
    { type: 'normal', dept: 'HR', enemies: [{ id: 'passive_aggressive_pam', name: 'Passive-Aggressive Pam', hp: 36, dept: 'HR',
      tagline: 'Per my last email, which you clearly didn\'t read.', icon: '💅',
      intentPattern: [{ type: 'debuff', value: 2, status: 'micromanaged' },{ type: 'attack', value: 10 },{ type: 'multiAttack', value: 4, times: 3 }] }] },
    { type: 'normal', dept: 'Operations', enemies: [{ id: 'union_rep', name: 'Union Rep', hp: 42, dept: 'Operations',
      tagline: 'Article 7, Section 3, Paragraph 2. Read it.', icon: '✊',
      intentPattern: [{ type: 'defend', value: 12 },{ type: 'buff', value: 2, status: 'seniority' },{ type: 'attack', value: 14 },{ type: 'defend', value: 10 }] }] },
    { type: 'normal', dept: 'Compliance', enemies: [{ id: 'whistleblower', name: 'The Whistleblower', hp: 28, dept: 'Compliance',
      tagline: 'I have documentation. All of it.', icon: '📢',
      intentPattern: [{ type: 'debuff', value: 2, status: 'unpatched' },{ type: 'attack', value: 16 },{ type: 'debuff', value: 3, status: 'burnout' }] }] },
    { type: 'normal', dept: 'IT', enemies: [{ id: 'phantom_printer', name: 'The Phantom Printer', hp: 28, dept: 'IT',
      tagline: 'PC LOAD LETTER.', icon: '🖨️',
      intentPattern: [{ type: 'defend', value: 14 },{ type: 'defend', value: 12 },{ type: 'attack', value: 20 }] }] },
    { type: 'elite', dept: 'All', enemies: [{ id: 'tenured_employee', name: 'The Tenured Employee', hp: 76, dept: 'All',
      tagline: "Can't fire me. Won't retire. Knows where the bodies are buried.", icon: '🪨',
      intentPattern: [{ type: 'attack', value: 12 },{ type: 'buff', value: 3, status: 'seniority' },{ type: 'multiAttack', value: 5, times: 3 },{ type: 'heal', value: 12 },{ type: 'attack', value: 18 }] }] },
    { type: 'boss', dept: 'IT', enemies: [{ id: 'help_desk', name: 'Help Desk', hp: 92, dept: 'IT',
      tagline: 'We ARE the Help Desk. We filed a ticket about YOU.', icon: '🎸',
      intentPattern: [{ type: 'attack', value: 16 },{ type: 'buff', value: 3, status: 'seniority' },{ type: 'multiAttack', value: 6, times: 3 },{ type: 'heal', value: 12 },{ type: 'debuff', value: 2, status: 'unpatched' },{ type: 'attack', value: 22 }] }] },
  ];

  // ─── STATUS DEFINITIONS ──────────────────────────────
  const STATUS_DEFS = {
    burnout:      { name: 'Burnout',      type: 'debuff', dec: true,  desc: 'Takes {N} dmg/turn' },
    caffeinated:  { name: 'Caffeinated',  type: 'buff',   dec: true,  desc: '+{N} attack damage' },
    seniority:    { name: 'Seniority',    type: 'buff',   dec: false, desc: '+{N} attack damage' },
    unpatched:    { name: 'Unpatched',    type: 'debuff', dec: true,  desc: 'Takes 50% more dmg' },
    micromanaged: { name: 'Micromanaged', type: 'debuff', dec: true,  desc: 'Deals 25% less dmg' },
    documented:   { name: 'Documented',   type: 'buff',   dec: false, desc: '+{N} block/turn' },
  };

  // ─── MANAGEMENT STYLES ───────────────────────────────
  const STYLES = [
    { id: 'ad_hoc', name: 'Ad Hoc', baseKPI: 5, baseLev: 1, rank: 0 },
    { id: 'follow_up', name: 'Follow-Up', baseKPI: 10, baseLev: 2, rank: 1 },
    { id: 'cross_functional', name: 'Cross-Functional', baseKPI: 25, baseLev: 5, rank: 3 },
    { id: 'board_resolution', name: 'Board Resolution', baseKPI: 40, baseLev: 8, rank: 4 },
  ];

  function detectStyle(suits) {
    if (suits.length === 0) return STYLES[0];
    const counts = {};
    suits.forEach(s => counts[s] = (counts[s] || 0) + 1);
    const vals = Object.values(counts);
    const maxCount = Math.max(...vals);
    const uniqueSuits = Object.keys(counts).length;

    if (suits.length >= 3 && maxCount >= 3) return STYLES[3]; // Board Resolution
    if (suits.length >= 3 && uniqueSuits >= 3) return STYLES[2]; // Cross-Functional
    if (maxCount >= 2) return STYLES[1]; // Follow-Up
    return STYLES[0]; // Ad Hoc
  }

  // ─── PERK CATALOG ────────────────────────────────────
  const PERK_CATALOG = [
    { id: 'corner_office', name: 'Corner Office', desc: '+15 KPI always.', rarity: 'common',
      trigger: 'always', effect: { type: 'add_kpi', value: 15 } },
    { id: 'yes_man', name: 'Yes Man', desc: '+3 Leverage when 3 cards tagged.', rarity: 'common',
      trigger: 'cards3', effect: { type: 'add_lev', value: 3 } },
    { id: 'please_hold', name: 'Please Hold', desc: '+20 KPI when 2+ Tickets tagged.', rarity: 'uncommon',
      trigger: 'tickets2', effect: { type: 'add_kpi', value: 20 } },
    { id: 'micromanager', name: 'Micromanager', desc: 'x2 Leverage on Cross-Functional+.', rarity: 'uncommon',
      trigger: 'style3', effect: { type: 'mult_lev', value: 2 } },
    { id: 'golden_parachute', name: 'Golden Parachute', desc: 'x1.5 Leverage when HP>75%.', rarity: 'rare',
      trigger: 'hp75', effect: { type: 'mult_lev', value: 1.5 } },
    { id: 'hostile_ceo', name: 'Hostile CEO', desc: 'x1.5 Leverage always.', rarity: 'rare',
      trigger: 'always', effect: { type: 'mult_lev', value: 1.5 } },
  ];

  function isPerkTriggered(perk, ctx) {
    switch (perk.trigger) {
      case 'always': return true;
      case 'cards3': return ctx.tagCount >= 3;
      case 'tickets2': return (ctx.suitCounts.tickets || 0) >= 2;
      case 'style3': return ctx.style.rank >= 3;
      case 'hp75': return ctx.hpPct >= 75;
      default: return false;
    }
  }

  function calculateProfit(taggedCards, perks, hpPct) {
    const suits = taggedCards.map(c => c.suit);
    const style = detectStyle(suits);
    const rankSum = taggedCards.reduce((s, c) => s + c.rank, 0);

    const suitCounts = {};
    suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
    const ctx = { style, tagCount: taggedCards.length, suitCounts, hpPct };

    let addKPI = 0, addLev = 0, multLev = 1;
    const triggered = [];

    for (const perk of perks) {
      if (!isPerkTriggered(perk, ctx)) continue;
      triggered.push(perk);
      switch (perk.effect.type) {
        case 'add_kpi': addKPI += perk.effect.value; break;
        case 'add_lev': addLev += perk.effect.value; break;
        case 'mult_lev': multLev *= perk.effect.value; break;
      }
    }

    const totalKPI = rankSum + style.baseKPI + addKPI;
    const totalLev = (style.baseLev + addLev) * multLev;
    const profit = Math.floor(totalKPI * totalLev);

    return { style, rankSum, totalKPI, totalLev, profit, triggered, multLev };
  }

  const QUARTERLY_TARGETS = [300, 800, 2000, 5000, 11000, 20000];

  // ─── Utility ─────────────────────────────────────────
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  let _nextId = 0;
  function cardInstance(def) { return { ...def, _uid: _nextId++ }; }

  function getStacks(statuses, id) {
    const s = statuses.find(e => e.id === id);
    return s ? s.stacks : 0;
  }

  function applyStatusTo(statuses, id, stacks) {
    const existing = statuses.find(s => s.id === id);
    if (existing) existing.stacks += stacks;
    else statuses.push({ id, stacks });
  }

  function tickStatuses(statuses) {
    return statuses.filter(s => {
      const def = STATUS_DEFS[s.id];
      if (def && def.dec) { s.stacks -= 1; return s.stacks > 0; }
      return true;
    });
  }

  function describeCard(card) {
    return card.effects.map(e => {
      switch (e.type) {
        case 'damage': return `Deal ${e.value} damage`;
        case 'multiHit': return `Deal ${e.value} x${e.times}`;
        case 'block': return `Gain ${e.value} block`;
        case 'draw': return `Draw ${e.value}`;
        case 'energy': return `+${e.value} energy`;
        case 'heal': return `Heal ${e.value}`;
        case 'applyStatus': {
          const sd = STATUS_DEFS[e.status];
          return sd ? `Apply ${e.value} ${sd.name}` : '';
        }
        default: return '';
      }
    }).filter(Boolean).join('. ') + '.';
  }

  function describeIntent(intent) {
    switch (intent.type) {
      case 'attack': return { text: `⚔ ${intent.value}`, cls: '' };
      case 'multiAttack': return { text: `⚔ ${intent.value}×${intent.times}`, cls: '' };
      case 'defend': return { text: `🛡 ${intent.value}`, cls: 'defend' };
      case 'buff': return { text: '↑ Buff', cls: 'buff' };
      case 'debuff': return { text: '↓ Debuff', cls: 'buff' };
      case 'heal': return { text: `♥ ${intent.value}`, cls: 'defend' };
      default: return { text: '?', cls: '' };
    }
  }

  // ─── Game State ──────────────────────────────────────
  const G = {
    screen: 'title',
    run: null,
    combat: null,
    stats: { cardsPlayed: 0, damageDealt: 0 },
  };

  function startRun() {
    _nextId = 0;
    G.stats = { cardsPlayed: 0, damageDealt: 0 };
    G.run = {
      playerHP: 72,
      playerMaxHP: 72,
      deck: STARTER_DECK.map(cardInstance),
      floor: 0,
      totalProfit: 0,
      perks: [],
    };
    showScreen('map');
    renderMap();
  }

  // ─── Combat Engine ───────────────────────────────────
  function initCombat(encounter) {
    const enemies = encounter.enemies.map(def => ({
      ...def, currentHP: def.hp, block: 0, intentIndex: 0, statusEffects: [],
    }));

    G.combat = {
      enemies,
      turn: 0,
      phase: 'playerTurn', // playerTurn | tagging | enemyTurn
      playerBlock: 0,
      energy: 3,
      maxEnergy: 3,
      drawPile: shuffle([...G.run.deck]),
      hand: [],
      discardPile: [],
      exhaustPile: [],
      playerStatuses: [],
      selectedCard: null,
      playedThisTurn: [], // cards played this turn (for tagging)
      taggedCards: [],     // cards tagged for scoring
      fightProfit: 0,
    };

    // Reset UI state from any previous tag phase
    document.getElementById('combat-tag-zone').style.display = 'none';
    document.getElementById('combat-hand').style.display = '';
    document.getElementById('btn-end-turn').style.display = '';
    // Remove stale player status element if it exists from previous fight
    const oldStatus = document.getElementById('combat-player-statuses');
    if (oldStatus) oldStatus.innerHTML = '';

    startCombatTurn();
  }

  function drawCards(count) {
    for (let i = 0; i < count; i++) {
      if (G.combat.drawPile.length === 0) {
        if (G.combat.discardPile.length === 0) break;
        G.combat.drawPile = shuffle(G.combat.discardPile);
        G.combat.discardPile = [];
      }
      G.combat.hand.push(G.combat.drawPile.pop());
    }
  }

  function startCombatTurn() {
    const c = G.combat;
    c.turn++;
    c.energy = c.maxEnergy;
    c.playerBlock = 0;
    c.phase = 'playerTurn';
    c.selectedCard = null;
    c.playedThisTurn = [];
    c.taggedCards = [];

    // Documented block
    const doc = getStacks(c.playerStatuses, 'documented');
    if (doc > 0) c.playerBlock += doc;

    // Tick burnout on enemies
    c.enemies.forEach(enemy => {
      if (enemy.currentHP <= 0) return;
      const burn = getStacks(enemy.statusEffects, 'burnout');
      if (burn > 0) {
        enemy.currentHP = Math.max(0, enemy.currentHP - burn);
        announce(`${enemy.name} takes ${burn} Burnout damage!`);
      }
    });

    // Tick burnout on player
    const pBurn = getStacks(c.playerStatuses, 'burnout');
    if (pBurn > 0) G.run.playerHP = Math.max(0, G.run.playerHP - pBurn);

    if (checkCombatEnd()) return;

    drawCards(5);
    renderCombat();
  }

  function calcPlayerDamage(base) {
    let dmg = base;
    dmg += getStacks(G.combat.playerStatuses, 'caffeinated');
    dmg += getStacks(G.combat.playerStatuses, 'seniority');
    return Math.max(0, dmg);
  }

  function dealDamageToEnemy(enemyIdx, baseDmg) {
    const enemy = G.combat.enemies[enemyIdx];
    if (!enemy || enemy.currentHP <= 0) return 0;
    let dmg = calcPlayerDamage(baseDmg);
    if (getStacks(enemy.statusEffects, 'unpatched') > 0) dmg = Math.floor(dmg * 1.5);
    let blocked = 0;
    if (enemy.block > 0) { blocked = Math.min(enemy.block, dmg); enemy.block -= blocked; dmg -= blocked; }
    const actual = Math.min(dmg, enemy.currentHP);
    enemy.currentHP -= actual;
    G.stats.damageDealt += actual;
    return actual;
  }

  function dealDamageToPlayer(baseDmg) {
    const c = G.combat;
    let dmg = baseDmg;
    let blocked = 0;
    if (c.playerBlock > 0) { blocked = Math.min(c.playerBlock, dmg); c.playerBlock -= blocked; dmg -= blocked; }
    G.run.playerHP = Math.max(0, G.run.playerHP - dmg);
    return { actual: dmg, blocked };
  }

  function playCard(card, targetIdx) {
    const c = G.combat;
    if (card.cost > c.energy || c.phase !== 'playerTurn') return;

    c.energy -= card.cost;
    G.stats.cardsPlayed++;

    for (const effect of card.effects) {
      switch (effect.type) {
        case 'damage':
          if (card.target === 'allEnemies') c.enemies.forEach((_, i) => dealDamageToEnemy(i, effect.value));
          else dealDamageToEnemy(targetIdx, effect.value);
          break;
        case 'multiHit':
          for (let i = 0; i < (effect.times || 1); i++) {
            if (c.enemies[targetIdx]?.currentHP <= 0) break;
            dealDamageToEnemy(targetIdx, effect.value);
          }
          break;
        case 'block': c.playerBlock += effect.value; break;
        case 'draw': drawCards(effect.value); break;
        case 'energy': c.energy += effect.value; break;
        case 'heal': {
          const healed = Math.min(effect.value, G.run.playerMaxHP - G.run.playerHP);
          G.run.playerHP += healed;
          break;
        }
        case 'applyStatus':
          if (card.target === 'self') applyStatusTo(c.playerStatuses, effect.status, effect.value);
          else if (card.target === 'allEnemies') c.enemies.forEach(e => { if (e.currentHP > 0) applyStatusTo(e.statusEffects, effect.status, effect.value); });
          else { const enemy = c.enemies[targetIdx]; if (enemy && enemy.currentHP > 0) applyStatusTo(enemy.statusEffects, effect.status, effect.value); }
          break;
      }
    }

    // Track played card for tagging
    c.playedThisTurn.push({ suit: card.suit, rank: card.rank, name: card.name, _uid: card._uid });

    // Move from hand
    const idx = c.hand.findIndex(h => h._uid === card._uid);
    if (idx >= 0) c.hand.splice(idx, 1);
    if (card.type === 'power') c.exhaustPile.push(card);
    else c.discardPile.push(card);

    c.selectedCard = null;
    if (!checkCombatEnd()) renderCombat();
  }

  function enterTagPhase() {
    const c = G.combat;
    if (c.phase !== 'playerTurn') return;

    // Discard remaining hand
    c.discardPile.push(...c.hand);
    c.hand = [];

    if (c.playedThisTurn.length === 0) {
      // No cards played, skip tagging
      executeEnemyTurn();
      return;
    }

    c.phase = 'tagging';
    c.taggedCards = [];
    renderTagPhase();
  }

  function toggleTag(cardUid) {
    const c = G.combat;
    if (c.phase !== 'tagging') return;

    const idx = c.taggedCards.findIndex(t => t._uid === cardUid);
    if (idx >= 0) {
      c.taggedCards.splice(idx, 1);
    } else if (c.taggedCards.length < 3) {
      const card = c.playedThisTurn.find(p => p._uid === cardUid);
      if (card) c.taggedCards.push(card);
    }

    renderTagPhase();
  }

  function submitTags() {
    const c = G.combat;
    if (c.phase !== 'tagging') return;

    // If no tags, auto-tag best cards
    if (c.taggedCards.length === 0 && c.playedThisTurn.length > 0) {
      const sorted = [...c.playedThisTurn].sort((a, b) => b.rank - a.rank);
      c.taggedCards = sorted.slice(0, Math.min(3, sorted.length));
    }

    // Calculate profit
    const hpPct = Math.floor((G.run.playerHP / G.run.playerMaxHP) * 100);
    const result = calculateProfit(c.taggedCards, G.run.perks, hpPct);

    c.fightProfit += result.profit;
    G.run.totalProfit += result.profit;

    // Show scoring announcement
    announce(`${result.style.name} — $${result.profit}`);

    // Animate profit bump
    const profitEl = document.getElementById('combat-profit-val');
    profitEl.textContent = '$' + G.run.totalProfit;
    profitEl.classList.remove('bump');
    void profitEl.offsetWidth;
    profitEl.classList.add('bump');

    // Highlight triggered perks
    renderCombatPerks(result.triggered);

    // Brief delay for visual feedback, then enemy turn
    setTimeout(() => {
      executeEnemyTurn();
    }, 800);
  }

  function executeEnemyTurn() {
    const c = G.combat;
    c.phase = 'enemyTurn';

    // Hide tag zone
    document.getElementById('combat-tag-zone').style.display = 'none';

    // Enemy actions
    c.enemies.forEach((enemy, i) => {
      if (enemy.currentHP <= 0) return;
      const intent = enemy.intentPattern[enemy.intentIndex % enemy.intentPattern.length];
      const micro = getStacks(enemy.statusEffects, 'micromanaged') > 0;
      const dmgMod = micro ? 0.75 : 1;
      const str = getStacks(enemy.statusEffects, 'seniority');

      switch (intent.type) {
        case 'attack': dealDamageToPlayer(Math.floor((intent.value + str) * dmgMod)); break;
        case 'multiAttack':
          for (let t = 0; t < (intent.times || 1); t++) {
            if (G.run.playerHP <= 0) break;
            dealDamageToPlayer(Math.floor((intent.value + str) * dmgMod));
          }
          break;
        case 'defend': enemy.block += intent.value; break;
        case 'buff': if (intent.status) applyStatusTo(enemy.statusEffects, intent.status, intent.value); break;
        case 'debuff': if (intent.status) applyStatusTo(c.playerStatuses, intent.status, intent.value); break;
        case 'heal': { const h = Math.min(intent.value, enemy.hp - enemy.currentHP); enemy.currentHP += h; break; }
      }
      enemy.intentIndex = (enemy.intentIndex + 1) % enemy.intentPattern.length;
    });

    c.enemies.forEach(e => { e.block = 0; });
    c.playerStatuses = tickStatuses(c.playerStatuses);
    c.enemies.forEach(e => { if (e.currentHP > 0) e.statusEffects = tickStatuses(e.statusEffects); });

    if (!checkCombatEnd()) startCombatTurn();
  }

  function checkCombatEnd() {
    if (G.run.playerHP <= 0) {
      showScreen('gameover');
      renderGameOver();
      return true;
    }
    if (G.combat.enemies.every(e => e.currentHP <= 0)) {
      // Auto-score any untagged played cards before ending combat
      const c = G.combat;
      if (c.playedThisTurn.length > 0 && c.phase === 'playerTurn') {
        const sorted = [...c.playedThisTurn].sort((a, b) => b.rank - a.rank);
        const autoTagged = sorted.slice(0, Math.min(3, sorted.length));
        const hpPct = Math.floor((G.run.playerHP / G.run.playerMaxHP) * 100);
        const result = calculateProfit(autoTagged, G.run.perks, hpPct);
        c.fightProfit += result.profit;
        G.run.totalProfit += result.profit;
      }

      G.run.floor++;
      if (G.run.floor >= FLOOR_ENCOUNTERS.length) {
        showScreen('complete');
        renderComplete();
      } else {
        showScreen('reward');
        renderReward();
      }
      return true;
    }
    return false;
  }

  // ─── Screen Management ───────────────────────────────
  function showScreen(name) {
    G.screen = name;
    document.querySelectorAll('.game-screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
  }

  function announce(text) {
    const el = document.getElementById('combat-announcer');
    if (el) el.textContent = text;
  }

  // ─── Render: Map ─────────────────────────────────────
  function renderMap() {
    const container = document.getElementById('map-nodes');
    container.innerHTML = '';

    document.getElementById('map-hp-val').textContent = G.run.playerHP;
    document.getElementById('map-hp-max').textContent = G.run.playerMaxHP;
    document.getElementById('map-deck-count').textContent = G.run.deck.length;
    document.getElementById('map-profit-val').textContent = G.run.totalProfit;

    // Perks
    const perkContainer = document.getElementById('map-perks');
    perkContainer.innerHTML = G.run.perks.length > 0
      ? G.run.perks.map(p => `<div class="map-perk-slot" title="${p.desc}">${p.name}</div>`).join('')
      : '<span style="font-size:clamp(7px,0.9vw,9px);color:var(--text-dim)">No perks yet</span>';

    FLOOR_ENCOUNTERS.forEach((enc, i) => {
      const node = document.createElement('div');
      const state = i < G.run.floor ? 'completed' : i === G.run.floor ? 'current' : 'locked';
      node.className = `map-node ${enc.type} ${state}`;

      const icon = enc.type === 'boss' ? '💀' : enc.type === 'elite' ? '⭐' : '⚔';
      const label = enc.type === 'boss' ? 'BOSS' : enc.type === 'elite' ? 'ELITE' : enc.dept + ' DEPT';
      const enemyName = enc.enemies[0].name;

      node.innerHTML = `
        <div class="map-node-icon">${icon}</div>
        <div class="map-node-info">
          <div class="map-node-name">${state === 'locked' ? '???' : enemyName}</div>
          <div class="map-node-type">${label}</div>
        </div>
      `;

      if (state === 'current') {
        node.addEventListener('click', () => {
          showScreen('combat');
          initCombat(enc);
        });
      }
      container.appendChild(node);
    });
  }

  // ─── Render: Combat ──────────────────────────────────
  function renderCombat() {
    const c = G.combat;

    // Top bar
    document.getElementById('combat-profit-val').textContent = '$' + G.run.totalProfit;
    document.getElementById('combat-turn-display').textContent = 'TURN ' + c.turn;
    document.getElementById('combat-target-val').textContent = '$' + (QUARTERLY_TARGETS[0] || '???');

    // Enemies
    const enemyZone = document.getElementById('combat-enemies');
    enemyZone.innerHTML = '';
    c.enemies.forEach((enemy, i) => {
      const div = document.createElement('div');
      div.className = 'combat-enemy';
      if (enemy.currentHP <= 0) div.style.opacity = '0.3';

      const intent = enemy.intentPattern[enemy.intentIndex % enemy.intentPattern.length];
      const intentInfo = describeIntent(intent);
      const hpPct = Math.max(0, (enemy.currentHP / enemy.hp) * 100);
      const hpColor = hpPct > 60 ? 'var(--hp-green)' : hpPct > 30 ? 'var(--hp-yellow)' : 'var(--hp-red)';

      let statusHTML = '';
      enemy.statusEffects.forEach(s => {
        const def = STATUS_DEFS[s.id];
        if (def) statusHTML += `<span class="combat-status-badge ${def.type}">${def.name} ${s.stacks}</span>`;
      });

      div.innerHTML = `
        <div class="combat-enemy-intent ${intentInfo.cls}">${enemy.currentHP > 0 ? intentInfo.text : ''}</div>
        <div class="combat-enemy-portrait">${enemy.icon || '?'}</div>
        <div class="combat-enemy-name">${enemy.name}</div>
        <div class="combat-enemy-dept">${enemy.dept}</div>
        <div class="combat-enemy-hp-bar"><div class="combat-enemy-hp-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
        <div class="combat-enemy-hp-text">${Math.max(0, enemy.currentHP)}/${enemy.hp}${enemy.block > 0 ? ' 🛡' + enemy.block : ''}</div>
        <div class="combat-enemy-statuses">${statusHTML}</div>
      `;
      enemyZone.appendChild(div);
    });

    // Player info
    const hpPct = Math.max(0, (G.run.playerHP / G.run.playerMaxHP) * 100);
    const hpColor = hpPct > 60 ? 'var(--hp-green)' : hpPct > 30 ? 'var(--hp-yellow)' : 'var(--hp-red)';
    document.getElementById('combat-hp-fill').style.width = hpPct + '%';
    document.getElementById('combat-hp-fill').style.backgroundColor = hpColor;
    document.getElementById('combat-hp-text').textContent = `${G.run.playerHP}/${G.run.playerMaxHP}`;
    document.getElementById('combat-energy-val').textContent = c.energy;
    document.getElementById('combat-energy-max').textContent = c.maxEnergy;
    document.getElementById('combat-draw-count').textContent = c.drawPile.length;
    document.getElementById('combat-discard-count').textContent = c.discardPile.length;

    const blockDisplay = document.getElementById('combat-block-display');
    if (c.playerBlock > 0) {
      blockDisplay.style.display = '';
      document.getElementById('combat-block-val').textContent = c.playerBlock;
    } else {
      blockDisplay.style.display = 'none';
    }

    // Perks
    renderCombatPerks([]);

    // Player statuses
    let existingStatusEl = document.getElementById('combat-player-statuses');
    if (!existingStatusEl) {
      existingStatusEl = document.createElement('div');
      existingStatusEl.id = 'combat-player-statuses';
      existingStatusEl.style.cssText = 'display:flex;gap:6px;padding:2px 8px;font-size:clamp(7px,0.9vw,9px);flex-wrap:wrap;';
      const infoBar = document.querySelector('.combat-player-info');
      infoBar.parentNode.insertBefore(existingStatusEl, infoBar.nextSibling);
    }
    let pStatusHTML = '';
    c.playerStatuses.forEach(s => {
      const def = STATUS_DEFS[s.id];
      if (def) pStatusHTML += `<span class="combat-status-badge ${def.type}">▲ ${def.name} ${s.stacks}</span> `;
    });
    existingStatusEl.innerHTML = pStatusHTML;

    // Reset visibility from tag phase
    document.getElementById('combat-tag-zone').style.display = 'none';
    document.getElementById('combat-hand').style.display = '';
    document.getElementById('btn-end-turn').style.display = '';

    // Hand
    const handEl = document.getElementById('combat-hand');
    handEl.innerHTML = '';
    c.hand.forEach(card => {
      const div = document.createElement('div');
      const playable = card.cost <= c.energy && c.phase === 'playerTurn';
      div.className = `combat-card suit-${card.suit}${!playable ? ' unplayable' : ''}`;

      const suitIcon = SUIT_ICONS[card.suit] || '?';

      div.innerHTML = `
        <div class="combat-card-cost">${card.cost}</div>
        <div class="combat-card-suit suit-${card.suit}">${suitIcon}</div>
        <div class="combat-card-name">${card.name}</div>
        <div class="combat-card-meta">
          <span class="combat-card-type">${card.type}</span>
          <span class="combat-card-rank">R${card.rank}</span>
        </div>
        <div class="combat-card-desc">${describeCard(card)}</div>
        ${card.flavor ? `<div class="combat-card-flavor">${card.flavor}</div>` : ''}
      `;

      if (playable) {
        div.addEventListener('click', () => {
          if (card.target === 'self' || card.target === 'allEnemies') {
            playCard(card, 0);
          } else {
            const aliveIdx = c.enemies.findIndex(e => e.currentHP > 0);
            if (aliveIdx >= 0) playCard(card, aliveIdx);
          }
        });
      }
      handEl.appendChild(div);
    });

    // Update end turn button text
    const endBtn = document.getElementById('btn-end-turn');
    if (c.playedThisTurn.length > 0) {
      endBtn.textContent = 'FILE REPORT';
      endBtn.classList.add('file-report');
    } else {
      endBtn.textContent = 'END TURN';
      endBtn.classList.remove('file-report');
    }

    if (c.phase === 'playerTurn') {
      announce(`Turn ${c.turn} — Your move`);
    }
  }

  function renderCombatPerks(triggered) {
    const container = document.getElementById('combat-perks');
    if (G.run.perks.length === 0) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = G.run.perks.map(p => {
      const isTriggered = triggered.some(t => t.id === p.id);
      return `<div class="combat-perk${isTriggered ? ' triggered' : ''}" title="${p.desc}">${p.name}</div>`;
    }).join('');
  }

  // ─── Render: Tag Phase ───────────────────────────────
  function renderTagPhase() {
    const c = G.combat;
    const tagZone = document.getElementById('combat-tag-zone');
    tagZone.style.display = '';

    // Hide hand, hide end turn button
    document.getElementById('combat-hand').style.display = 'none';
    document.getElementById('btn-end-turn').style.display = 'none';

    // Render played cards as tag-able mini cards
    const cardsContainer = document.getElementById('tag-zone-cards');
    cardsContainer.innerHTML = '';

    c.playedThisTurn.forEach(card => {
      const div = document.createElement('div');
      const isTagged = c.taggedCards.some(t => t._uid === card._uid);
      div.className = `tag-card${isTagged ? ' tagged' : ''}`;
      div.innerHTML = `
        <div class="tag-card-suit-label suit-color-${card.suit}">${SUIT_NAMES[card.suit] || '?'}</div>
        <div class="tag-card-name">${card.name}</div>
        <div class="tag-card-rank">Rank ${card.rank}</div>
      `;
      div.addEventListener('click', () => toggleTag(card._uid));
      cardsContainer.appendChild(div);
    });

    // Update preview + style guide highlighting
    const hpPct = Math.floor((G.run.playerHP / G.run.playerMaxHP) * 100);
    const tagged = c.taggedCards.length > 0 ? c.taggedCards : [];

    // Clear all style guide highlights
    document.querySelectorAll('.style-guide-row').forEach(r => r.classList.remove('active-style'));

    if (tagged.length > 0) {
      const result = calculateProfit(tagged, G.run.perks, hpPct);
      document.getElementById('preview-style').textContent = result.style.name;
      document.getElementById('preview-mult').textContent = `×${result.totalLev.toFixed(1)}`;
      document.getElementById('preview-profit').textContent = `$${result.profit}`;

      // Highlight matching style in guide
      const activeRow = document.querySelector(`.style-guide-row[data-style="${result.style.id}"]`);
      if (activeRow) activeRow.classList.add('active-style');
    } else {
      document.getElementById('preview-style').textContent = 'Tag cards to score';
      document.getElementById('preview-mult').textContent = '';
      document.getElementById('preview-profit').textContent = '$0';
    }

    // Show tag count
    const tagCount = c.taggedCards.length;
    const hint = tagCount === 0
      ? 'Tag up to 3 cards — diversity beats pairs!'
      : tagCount < 3
        ? `${tagCount}/3 tagged — add more for better combos`
        : '3/3 tagged — submit when ready';
    document.querySelector('.tag-zone-hint').textContent = hint;

    announce(tagCount === 0 ? 'Select cards for your performance report' : `${tagCount}/3 tagged`);
  }

  // ─── Render: Reward ──────────────────────────────────
  function renderReward() {
    document.getElementById('reward-profit-summary').textContent =
      `Profit extracted: $${G.combat?.fightProfit || 0} (Total: $${G.run.totalProfit})`;

    // Card rewards
    const container = document.getElementById('reward-cards');
    container.innerHTML = '';
    const choices = shuffle(REWARD_POOL).slice(0, 3);
    choices.forEach(cardDef => {
      const div = document.createElement('div');
      div.className = `reward-card suit-${cardDef.suit}`;
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:10px;background:var(--energy-color);color:#000;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center">${cardDef.cost}</span>
          <span class="combat-card-suit suit-${cardDef.suit}" style="position:relative;top:0;right:0">${SUIT_ICONS[cardDef.suit] || ''}</span>
        </div>
        <div class="combat-card-name" style="font-size:clamp(7px,1vw,10px)">${cardDef.name}</div>
        <div class="combat-card-meta"><span class="combat-card-type">${cardDef.type}</span><span class="combat-card-rank">R${cardDef.rank}</span></div>
        <div class="combat-card-desc" style="font-size:clamp(6px,0.8vw,9px)">${describeCard(cardDef)}</div>
        ${cardDef.flavor ? `<div class="combat-card-flavor">${cardDef.flavor}</div>` : ''}
      `;
      div.addEventListener('click', () => {
        G.run.deck.push(cardInstance(cardDef));
        showScreen('map');
        renderMap();
      });
      container.appendChild(div);
    });

    // Perk rewards (after fights 2 and 4)
    const perkSection = document.getElementById('reward-perk-section');
    if (G.run.floor === 2 || G.run.floor === 4) {
      perkSection.style.display = '';
      const perkContainer = document.getElementById('reward-perks');
      perkContainer.innerHTML = '';

      const available = PERK_CATALOG.filter(p => !G.run.perks.some(rp => rp.id === p.id));
      const perkChoices = shuffle(available).slice(0, 3);

      perkChoices.forEach(perkDef => {
        const div = document.createElement('div');
        div.className = 'reward-perk';
        div.innerHTML = `
          <div class="reward-perk-name">${perkDef.name}</div>
          <div class="reward-perk-desc">${perkDef.desc}</div>
          <div class="reward-perk-rarity">${perkDef.rarity}</div>
        `;
        div.addEventListener('click', () => {
          G.run.perks.push(perkDef);
          // Disable all perk choices (one pick only)
          perkContainer.querySelectorAll('.reward-perk').forEach(p => {
            p.style.opacity = '0.3';
            p.style.pointerEvents = 'none';
          });
          div.style.opacity = '1';
          div.style.borderColor = 'var(--gold)';
        });
        perkContainer.appendChild(div);
      });
    } else {
      perkSection.style.display = 'none';
    }
  }

  // ─── Render: Game Over / Complete ────────────────────
  function renderGameOver() {
    document.getElementById('gameover-fights').textContent = G.run.floor;
    document.getElementById('gameover-profit').textContent = G.run.totalProfit;
    document.getElementById('gameover-cards').textContent = G.stats.cardsPlayed;
  }

  function renderComplete() {
    document.getElementById('complete-profit').textContent = G.run.totalProfit;
    document.getElementById('complete-hp').textContent = G.run.playerHP;
    document.getElementById('complete-perks').textContent = G.run.perks.length;
    document.getElementById('complete-cards').textContent = G.stats.cardsPlayed;

    // Grade based on profit
    const profit = G.run.totalProfit;
    let grade = 'D — Needs Improvement';
    if (profit >= 5000) grade = 'S — Wall Street Material';
    else if (profit >= 3000) grade = 'A — Board Approved';
    else if (profit >= 1500) grade = 'B — Meets Expectations';
    else if (profit >= 500) grade = 'C — Probationary';

    document.getElementById('complete-grade').textContent = grade;
  }

  // ─── Event Binding ───────────────────────────────────
  document.getElementById('btn-start-run').addEventListener('click', startRun);

  document.getElementById('btn-end-turn').addEventListener('click', () => {
    if (G.combat?.phase === 'playerTurn') enterTagPhase();
  });

  document.getElementById('btn-submit-tags').addEventListener('click', submitTags);

  document.getElementById('btn-skip-reward').addEventListener('click', () => {
    showScreen('map');
    renderMap();
  });

  document.getElementById('btn-retry').addEventListener('click', startRun);
  document.getElementById('btn-new-run').addEventListener('click', startRun);

})();
