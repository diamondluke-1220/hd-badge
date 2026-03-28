// ═══════════════════════════════════════════════════════
// Help Desk: Corporate Card Battler — Game Engine
// State machine, screen management, combat UI bridge
// ═══════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── Card & Enemy Data (inline for prototype) ─────────

  const STARTER_DECK = [
    { id: 'stapler_strike', name: 'Stapler Strike', cost: 1, type: 'attack', target: 'enemy',
      effects: [{ type: 'damage', value: 6 }], flavor: 'The red Swingline. Everyone knows not to touch it.' },
    { id: 'stapler_strike', name: 'Stapler Strike', cost: 1, type: 'attack', target: 'enemy',
      effects: [{ type: 'damage', value: 6 }] },
    { id: 'coffee_break', name: 'Coffee Break', cost: 1, type: 'skill', target: 'self',
      effects: [{ type: 'block', value: 5 }], flavor: 'Nobody can hurt you in the break room. Unwritten rule.' },
    { id: 'coffee_break', name: 'Coffee Break', cost: 1, type: 'skill', target: 'self',
      effects: [{ type: 'block', value: 5 }] },
    { id: 'memo', name: 'Memo', cost: 1, type: 'attack', target: 'enemy',
      effects: [{ type: 'damage', value: 4 }, { type: 'draw', value: 1 }],
      flavor: 'As per the attached, which you did not read.' },
    { id: 'duck_and_cover', name: 'Duck and Cover', cost: 1, type: 'skill', target: 'self',
      effects: [{ type: 'block', value: 8 }], flavor: 'Monitor angled just right. Headphones on. Invisible.' },
    { id: 'escalate', name: 'Escalate', cost: 1, type: 'attack', target: 'enemy',
      effects: [{ type: 'damage', value: 8 }], flavor: 'Not your problem anymore. Forwarded with high importance.' },
    { id: 'keyboard_warrior', name: 'Keyboard Warrior', cost: 1, type: 'attack', target: 'enemy',
      effects: [{ type: 'multiHit', value: 3, times: 2 }], flavor: '142 WPM when angry. 30 otherwise.' },
    { id: 'pto_request', name: 'PTO Request', cost: 1, type: 'skill', target: 'self',
      effects: [{ type: 'block', value: 3 }, { type: 'energy', value: 1 }],
      flavor: 'Submitted 6 weeks ago. Approved 5 minutes ago.' },
    { id: 'documentation', name: 'Documentation', cost: 1, type: 'power', target: 'self',
      effects: [{ type: 'applyStatus', status: 'documented', value: 2 }],
      flavor: 'Wrote it down. Updated the wiki. Screenshot for good measure.' },
  ];

  const REWARD_POOL = [
    { id: 'scope_creep', name: 'Scope Creep', cost: 1, type: 'attack', target: 'enemy',
      effects: [{ type: 'damage', value: 3 }, { type: 'applyStatus', status: 'burnout', value: 4 }],
      flavor: 'Oh and one more thing. And another. And...' },
    { id: 'weekend_email', name: 'Weekend Email', cost: 1, type: 'skill', target: 'enemy',
      effects: [{ type: 'applyStatus', status: 'burnout', value: 6 }],
      flavor: 'Sent at 11:47 PM on a Saturday. "Quick question."' },
    { id: 'unrealistic_deadline', name: 'Unrealistic Deadline', cost: 2, type: 'attack', target: 'enemy',
      effects: [{ type: 'damage', value: 5 }, { type: 'applyStatus', status: 'burnout', value: 8 }],
      flavor: "Need this by EOD. It's 4:55." },
    { id: 'vulnerability_scan', name: 'Vulnerability Scan', cost: 1, type: 'skill', target: 'enemy',
      effects: [{ type: 'applyStatus', status: 'unpatched', value: 2 }],
      flavor: '47 critical. 212 high. Last scan: never.' },
    { id: 'zero_day', name: 'Zero Day', cost: 2, type: 'attack', target: 'enemy',
      effects: [{ type: 'damage', value: 18 }], flavor: 'No patch exists. No fix coming. Good luck.' },
    { id: 'double_espresso', name: 'Double Espresso', cost: 0, type: 'skill', target: 'self',
      effects: [{ type: 'applyStatus', status: 'caffeinated', value: 2 }, { type: 'draw', value: 1 }],
      flavor: 'Third one today. Hands are shaking. Never felt more alive.' },
    { id: 'hr_complaint', name: 'HR Complaint', cost: 1, type: 'skill', target: 'enemy',
      effects: [{ type: 'applyStatus', status: 'micromanaged', value: 2 }],
      flavor: 'Filed in triplicate. Acknowledged in 5-7 business days.' },
    { id: 'reply_all', name: 'Reply All', cost: 2, type: 'attack', target: 'allEnemies',
      effects: [{ type: 'damage', value: 8 }], flavor: '312 recipients. No one asked for this.' },
    { id: 'lunch_thief', name: 'Lunch Thief', cost: 1, type: 'skill', target: 'self',
      effects: [{ type: 'heal', value: 6 }], flavor: "It said 'Dave' on it. You are not Dave." },
    { id: 'malicious_compliance', name: 'Malicious Compliance', cost: 2, type: 'skill', target: 'self',
      effects: [{ type: 'block', value: 20 }, { type: 'draw', value: 2 }],
      flavor: 'Per policy 4.7.3, subsection (b), paragraph 2. I followed every word.' },
  ];

  const FLOOR_ENCOUNTERS = [
    { type: 'normal', enemies: [{ id: 'the_slacker', name: 'The Slacker', hp: 30, tagline: 'Doing the bare minimum since day one.', icon: '😴',
      intentPattern: [{ type: 'attack', value: 8 },{ type: 'defend', value: 6 },{ type: 'attack', value: 12 }] }] },
    { type: 'normal', enemies: [{ id: 'reply_all_randy', name: 'Reply-All Randy', hp: 36, tagline: 'You have 47 unread messages.', icon: '📧',
      intentPattern: [{ type: 'multiAttack', value: 4, times: 3 },{ type: 'buff', value: 2, status: 'seniority' },{ type: 'attack', value: 14 }] }] },
    { type: 'normal', enemies: [{ id: 'the_micromanager', name: 'The Micromanager', hp: 42, tagline: 'Just checking in. Again.', icon: '👔',
      intentPattern: [{ type: 'debuff', value: 2, status: 'micromanaged' },{ type: 'attack', value: 12 },{ type: 'attack', value: 14 },{ type: 'defend', value: 10 }] }] },
    { type: 'normal', enemies: [{ id: 'printer_jam', name: 'Printer Jam', hp: 28, tagline: 'PC LOAD LETTER.', icon: '🖨️',
      intentPattern: [{ type: 'defend', value: 14 },{ type: 'defend', value: 12 },{ type: 'attack', value: 20 }] }] },
    { type: 'normal', enemies: [{ id: 'the_slacker', name: 'The Slacker', hp: 30, tagline: 'Doing the bare minimum since day one.', icon: '😴',
      intentPattern: [{ type: 'attack', value: 8 },{ type: 'defend', value: 6 },{ type: 'attack', value: 12 }] }] },
    { type: 'elite', enemies: [{ id: 'the_consultant', name: 'The Consultant', hp: 76, tagline: "That'll be $500/hour.", icon: '💼',
      intentPattern: [{ type: 'attack', value: 12 },{ type: 'buff', value: 3, status: 'seniority' },{ type: 'multiAttack', value: 5, times: 3 },{ type: 'debuff', value: 2, status: 'unpatched' },{ type: 'attack', value: 18 }] }] },
    { type: 'boss', enemies: [{ id: 'the_sysadmin', name: 'The Sysadmin', hp: 92, tagline: 'sudo rm -rf /your/career', icon: '🖥️',
      intentPattern: [{ type: 'attack', value: 16 },{ type: 'buff', value: 3, status: 'seniority' },{ type: 'multiAttack', value: 6, times: 3 },{ type: 'heal', value: 12 },{ type: 'debuff', value: 2, status: 'unpatched' },{ type: 'attack', value: 22 }] }] },
  ];

  const STATUS_DEFS = {
    burnout:      { name: 'Burnout',      type: 'debuff', dec: true,  desc: 'Takes {N} dmg/turn' },
    caffeinated:  { name: 'Caffeinated',  type: 'buff',   dec: true,  desc: '+{N} attack damage' },
    seniority:    { name: 'Seniority',    type: 'buff',   dec: false, desc: '+{N} attack damage' },
    unpatched:    { name: 'Unpatched',    type: 'debuff', dec: true,  desc: 'Takes 50% more dmg' },
    micromanaged: { name: 'Micromanaged', type: 'debuff', dec: true,  desc: 'Deals 25% less dmg' },
    documented:   { name: 'Documented',   type: 'buff',   dec: false, desc: '+{N} block/turn' },
  };

  // ─── Utility ───────────────────────────────────────────

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
        case 'multiHit': return `Deal ${e.value} damage x${e.times}`;
        case 'block': return `Gain ${e.value} block`;
        case 'draw': return `Draw ${e.value}`;
        case 'energy': return `Gain ${e.value} energy`;
        case 'heal': return `Heal ${e.value} HP`;
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
      case 'buff': return { text: `↑ Buff`, cls: 'buff' };
      case 'debuff': return { text: `↓ Debuff`, cls: 'buff' };
      case 'heal': return { text: `♥ ${intent.value}`, cls: 'defend' };
      default: return { text: '?', cls: '' };
    }
  }

  // ─── Game State ────────────────────────────────────────

  const G = {
    screen: 'title',
    run: null,     // set on START_RUN
    combat: null,  // set on entering combat
    stats: { cardsPlayed: 0, damageDealt: 0 },
  };

  function startRun() {
    _nextId = 0;
    G.stats = { cardsPlayed: 0, damageDealt: 0 };
    G.run = {
      playerHP: 72,
      playerMaxHP: 72,
      deck: STARTER_DECK.map(cardInstance),
      floor: 0, // index into FLOOR_ENCOUNTERS
    };
    showScreen('map');
    renderMap();
  }

  // ─── Combat Engine (inline, mirrors game/combat.ts) ────

  function initCombat(encounter) {
    const enemies = encounter.enemies.map(def => ({
      ...def,
      currentHP: def.hp,
      block: 0,
      intentIndex: 0,
      statusEffects: [],
    }));

    G.combat = {
      enemies,
      turn: 0,
      phase: 'playerTurn',
      playerBlock: 0,
      energy: 3,
      maxEnergy: 3,
      drawPile: shuffle([...G.run.deck]),
      hand: [],
      discardPile: [],
      exhaustPile: [],
      playerStatuses: [],
      selectedCard: null,
    };

    startCombatTurn();
  }

  function drawCards(count) {
    for (let i = 0; i < count; i++) {
      if (G.combat.drawPile.length === 0) {
        if (G.combat.discardPile.length === 0) break;
        G.combat.drawPile = shuffle(G.combat.discardPile);
        G.combat.discardPile = [];
      }
      const card = G.combat.drawPile.pop();
      G.combat.hand.push(card);
    }
  }

  function startCombatTurn() {
    const c = G.combat;
    c.turn++;
    c.energy = c.maxEnergy;
    c.playerBlock = 0;
    c.phase = 'playerTurn';
    c.selectedCard = null;

    // Documented: gain block at turn start
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
    if (pBurn > 0) {
      G.run.playerHP = Math.max(0, G.run.playerHP - pBurn);
    }

    // Check deaths from burnout
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
    if (enemy.block > 0) {
      blocked = Math.min(enemy.block, dmg);
      enemy.block -= blocked;
      dmg -= blocked;
    }
    const actual = Math.min(dmg, enemy.currentHP);
    enemy.currentHP -= actual;
    G.stats.damageDealt += actual;
    return actual;
  }

  function dealDamageToPlayer(baseDmg) {
    const c = G.combat;
    let dmg = baseDmg;
    let blocked = 0;
    if (c.playerBlock > 0) {
      blocked = Math.min(c.playerBlock, dmg);
      c.playerBlock -= blocked;
      dmg -= blocked;
    }
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
          if (card.target === 'allEnemies') {
            c.enemies.forEach((_, i) => dealDamageToEnemy(i, effect.value));
          } else {
            dealDamageToEnemy(targetIdx, effect.value);
          }
          break;
        case 'multiHit':
          for (let i = 0; i < (effect.times || 1); i++) {
            if (c.enemies[targetIdx]?.currentHP <= 0) break;
            dealDamageToEnemy(targetIdx, effect.value);
          }
          break;
        case 'block':
          c.playerBlock += effect.value;
          break;
        case 'draw':
          drawCards(effect.value);
          break;
        case 'energy':
          c.energy += effect.value;
          break;
        case 'heal': {
          const healed = Math.min(effect.value, G.run.playerMaxHP - G.run.playerHP);
          G.run.playerHP += healed;
          break;
        }
        case 'applyStatus':
          if (card.target === 'self') {
            applyStatusTo(c.playerStatuses, effect.status, effect.value);
          } else if (card.target === 'allEnemies') {
            c.enemies.forEach(e => { if (e.currentHP > 0) applyStatusTo(e.statusEffects, effect.status, effect.value); });
          } else {
            const enemy = c.enemies[targetIdx];
            if (enemy && enemy.currentHP > 0) applyStatusTo(enemy.statusEffects, effect.status, effect.value);
          }
          break;
      }
    }

    // Move card from hand
    const idx = c.hand.findIndex(h => h._uid === card._uid);
    if (idx >= 0) c.hand.splice(idx, 1);
    if (card.type === 'power') c.exhaustPile.push(card);
    else c.discardPile.push(card);

    c.selectedCard = null;

    if (!checkCombatEnd()) renderCombat();
  }

  function endPlayerTurn() {
    const c = G.combat;
    if (c.phase !== 'playerTurn') return;
    c.phase = 'enemyTurn';

    // Discard hand
    c.discardPile.push(...c.hand);
    c.hand = [];

    // Enemy actions
    c.enemies.forEach((enemy, i) => {
      if (enemy.currentHP <= 0) return;
      const intent = enemy.intentPattern[enemy.intentIndex % enemy.intentPattern.length];
      const micro = getStacks(enemy.statusEffects, 'micromanaged') > 0;
      const dmgMod = micro ? 0.75 : 1;
      const str = getStacks(enemy.statusEffects, 'seniority');

      switch (intent.type) {
        case 'attack':
          dealDamageToPlayer(Math.floor((intent.value + str) * dmgMod));
          break;
        case 'multiAttack':
          for (let t = 0; t < (intent.times || 1); t++) {
            if (G.run.playerHP <= 0) break;
            dealDamageToPlayer(Math.floor((intent.value + str) * dmgMod));
          }
          break;
        case 'defend':
          enemy.block += intent.value;
          break;
        case 'buff':
          if (intent.status) applyStatusTo(enemy.statusEffects, intent.status, intent.value);
          break;
        case 'debuff':
          if (intent.status) applyStatusTo(c.playerStatuses, intent.status, intent.value);
          break;
        case 'heal': {
          const healed = Math.min(intent.value, enemy.hp - enemy.currentHP);
          enemy.currentHP += healed;
          break;
        }
      }
      enemy.intentIndex = (enemy.intentIndex + 1) % enemy.intentPattern.length;
    });

    // Reset enemy block
    c.enemies.forEach(e => { e.block = 0; });

    // Tick statuses
    c.playerStatuses = tickStatuses(c.playerStatuses);
    c.enemies.forEach(e => { if (e.currentHP > 0) e.statusEffects = tickStatuses(e.statusEffects); });

    if (!checkCombatEnd()) {
      startCombatTurn();
    }
  }

  function checkCombatEnd() {
    if (G.run.playerHP <= 0) {
      showScreen('gameover');
      renderGameOver();
      return true;
    }
    if (G.combat.enemies.every(e => e.currentHP <= 0)) {
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

  // ─── Screen Management ─────────────────────────────────

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

  // ─── Render: Map ───────────────────────────────────────

  function renderMap() {
    const container = document.getElementById('map-nodes');
    container.innerHTML = '';

    document.getElementById('map-hp-val').textContent = G.run.playerHP;
    document.getElementById('map-hp-max').textContent = G.run.playerMaxHP;
    document.getElementById('map-deck-count').textContent = G.run.deck.length;

    FLOOR_ENCOUNTERS.forEach((enc, i) => {
      const node = document.createElement('div');
      const state = i < G.run.floor ? 'completed' : i === G.run.floor ? 'current' : 'locked';
      node.className = `map-node ${enc.type} ${state}`;

      const icon = enc.type === 'boss' ? '💀' : enc.type === 'elite' ? '⭐' : '⚔';
      const label = enc.type === 'boss' ? 'BOSS' : enc.type === 'elite' ? 'ELITE' : `FIGHT ${i + 1}`;
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

  // ─── Render: Combat ────────────────────────────────────

  function renderCombat() {
    const c = G.combat;

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
        <div class="combat-enemy-hp-bar"><div class="combat-enemy-hp-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
        <div class="combat-enemy-hp-text">${Math.max(0, enemy.currentHP)} / ${enemy.hp}${enemy.block > 0 ? ` 🛡${enemy.block}` : ''}</div>
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

    // Player statuses — render in dedicated area below info bar
    let pStatusHTML = '';
    c.playerStatuses.forEach(s => {
      const def = STATUS_DEFS[s.id];
      if (def) pStatusHTML += `<span class="combat-status-badge ${def.type}">▲ ${def.name} ${s.stacks}</span> `;
    });
    let existingStatusEl = document.getElementById('combat-player-statuses');
    if (!existingStatusEl) {
      existingStatusEl = document.createElement('div');
      existingStatusEl.id = 'combat-player-statuses';
      existingStatusEl.style.cssText = 'display:flex;gap:6px;padding:4px 8px;font-size:clamp(8px,1vw,11px);';
      const infoBar = document.querySelector('.combat-player-info');
      infoBar.parentNode.insertBefore(existingStatusEl, infoBar.nextSibling);
    }
    existingStatusEl.innerHTML = pStatusHTML ? '<span style="color:var(--text-dim)">YOUR BUFFS:</span> ' + pStatusHTML : '';

    // Hand
    const handEl = document.getElementById('combat-hand');
    handEl.innerHTML = '';
    c.hand.forEach(card => {
      const div = document.createElement('div');
      const playable = card.cost <= c.energy && c.phase === 'playerTurn';
      div.className = `combat-card type-${card.type}${!playable ? ' unplayable' : ''}${c.selectedCard === card._uid ? ' selected' : ''}`;

      div.innerHTML = `
        <div class="combat-card-cost">${card.cost}</div>
        <div class="combat-card-name">${card.name}</div>
        <div class="combat-card-type">${card.type}</div>
        <div class="combat-card-desc">${describeCard(card)}</div>
        ${card.flavor ? `<div class="combat-card-flavor">${card.flavor}</div>` : ''}
      `;

      if (playable) {
        div.addEventListener('click', () => {
          if (card.target === 'self' || card.target === 'allEnemies') {
            playCard(card, 0);
          } else {
            // Need target selection — for single enemy just play on first alive
            const aliveIdx = c.enemies.findIndex(e => e.currentHP > 0);
            if (aliveIdx >= 0) playCard(card, aliveIdx);
          }
        });
      }

      handEl.appendChild(div);
    });

    // Announcer: show current turn
    if (c.phase === 'playerTurn') {
      announce(`Turn ${c.turn} — Your move`);
    }
  }

  // ─── Render: Reward ────────────────────────────────────

  function renderReward() {
    const container = document.getElementById('reward-cards');
    container.innerHTML = '';

    // Pick 3 random from reward pool
    const choices = shuffle(REWARD_POOL).slice(0, 3);
    choices.forEach(cardDef => {
      const div = document.createElement('div');
      div.className = `reward-card type-${cardDef.type}`;
      div.innerHTML = `
        <div class="combat-card-cost" style="position:relative;top:0;left:0;margin-bottom:8px">${cardDef.cost}</div>
        <div class="combat-card-name" style="font-size:clamp(8px,1.2vw,11px)">${cardDef.name}</div>
        <div class="combat-card-type">${cardDef.type}</div>
        <div class="combat-card-desc" style="font-size:clamp(6px,0.9vw,9px)">${describeCard(cardDef)}</div>
        ${cardDef.flavor ? `<div class="combat-card-flavor">${cardDef.flavor}</div>` : ''}
      `;
      div.addEventListener('click', () => {
        G.run.deck.push(cardInstance(cardDef));
        showScreen('map');
        renderMap();
      });
      container.appendChild(div);
    });
  }

  // ─── Render: Game Over / Complete ──────────────────────

  function renderGameOver() {
    document.getElementById('gameover-fights').textContent = G.run.floor;
    document.getElementById('gameover-cards').textContent = G.stats.cardsPlayed;
    document.getElementById('gameover-damage').textContent = G.stats.damageDealt;
  }

  function renderComplete() {
    document.getElementById('complete-hp').textContent = G.run.playerHP;
    document.getElementById('complete-cards').textContent = G.stats.cardsPlayed;
    document.getElementById('complete-damage').textContent = G.stats.damageDealt;
  }

  // ─── Event Binding ─────────────────────────────────────

  document.getElementById('btn-start-run').addEventListener('click', startRun);
  document.getElementById('btn-end-turn').addEventListener('click', endPlayerTurn);
  document.getElementById('btn-skip-reward').addEventListener('click', () => {
    showScreen('map');
    renderMap();
  });
  document.getElementById('btn-retry').addEventListener('click', startRun);
  document.getElementById('btn-new-run').addEventListener('click', startRun);

})();
