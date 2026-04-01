#!/usr/bin/env bun
// ─── Arcade Fight Simulator ─────────────────────────────────
// Headless Monte Carlo simulation of the arcade fight system.
// Mirrors the exact probability logic from arcade-cinematic.js
// Usage: bun run scripts/fight-sim.ts [count]

const FIGHT_COUNT = parseInt(process.argv[2] || '10000');

// ─── Constants (mirrored from view-arcade.js / arcade-cinematic.js) ───

const BOSSES = [
  { id: 'HD-00001', name: 'Luke', move: 'TICKET ESCALATION' },
  { id: 'HD-00002', name: 'Drew', move: 'FEEDBACK LOOP' },
  { id: 'HD-00003', name: 'Henry', move: 'CLICK TRACK OF DOOM' },
  { id: 'HD-00004', name: 'Todd', move: '1000 YARD STARE' },
  { id: 'HD-00005', name: 'Adam', move: 'LOW END THEORY' },
];

const CREATURES = [
  { name: 'The Phantom Printer', move: 'PAPER JAM OF DOOM' },
  { name: 'The Network Wizard', move: 'PACKET STORM' },
  { name: 'Watercooler Will', move: 'GOSSIP BOMB' },
  { name: 'HR Nancy', move: 'MANDATORY FUN' },
  { name: 'The Dirty Microwave', move: 'FISH FRIDAY' },
  { name: 'The MFA Guardian', move: 'TOKEN EXPIRED' },
  { name: 'The Consultant', move: 'BUDGET SLASH' },
  { name: 'Sally in Accounting', move: 'EXPENSE DENIED' },
];

const INTERNS = [
  { name: 'THE INTERN', move: 'UNPAID OVERTIME' },
];

// ─── Fight simulation (mirrors _pickOpponent, _determineWinner, _animateFight) ───

interface FightResult {
  opponentType: 'boss' | 'creature' | 'intern';
  opponentName: string;
  move: string;
  winner: 'employee' | 'opponent';
  hasSpecialMove: boolean;
  doComeback: boolean;
  doBossFinisher: boolean;
  doSlugfest: boolean;
}

function simulateFight(): FightResult {
  // Pick opponent (same roll thresholds as arcade-cinematic.js line 20)
  const roll = Math.random();
  let opponentType: 'boss' | 'creature' | 'intern';
  let opponentName: string;
  let move: string;

  if (roll < 0.60) {
    opponentType = 'boss';
    const boss = BOSSES[Math.floor(Math.random() * BOSSES.length)];
    opponentName = boss.name;
    move = boss.move;
  } else if (roll < 0.90) {
    opponentType = 'creature';
    const creature = CREATURES[Math.floor(Math.random() * CREATURES.length)];
    opponentName = creature.name;
    move = creature.move;
  } else {
    opponentType = 'intern';
    const intern = INTERNS[Math.floor(Math.random() * INTERNS.length)];
    opponentName = intern.name;
    move = intern.move;
  }

  // Determine winner (same logic as _determineWinner)
  let winner: 'employee' | 'opponent';
  if (opponentType === 'intern') {
    winner = Math.random() < 0.2 ? 'opponent' : 'employee';
  } else if (opponentType === 'boss') {
    winner = Math.random() < 0.65 ? 'opponent' : 'employee';
  } else {
    winner = Math.random() < 0.5 ? 'employee' : 'opponent';
  }

  // Fight mechanics (same logic as _animateFight lines 779-791)
  const isBoss = opponentType === 'boss';
  const hasSpecialMove = opponentType !== 'intern' && !!move;
  const doComeback = winner === 'employee' && Math.random() < 0.35;
  const doBossFinisher = winner === 'opponent' && isBoss && !doComeback && Math.random() < 0.3;
  const doSlugfest = !doComeback && !doBossFinisher && Math.random() < 0.25;

  return {
    opponentType, opponentName, move, winner,
    hasSpecialMove, doComeback, doBossFinisher, doSlugfest,
  };
}

// ─── Run simulation ───

const results: FightResult[] = [];
for (let i = 0; i < FIGHT_COUNT; i++) {
  results.push(simulateFight());
}

// ─── Analysis ───

const pct = (n: number) => ((n / FIGHT_COUNT) * 100).toFixed(1) + '%';
const count = (fn: (r: FightResult) => boolean) => results.filter(fn).length;

console.log(`\n══════════════════════════════════════════════`);
console.log(`  ARCADE FIGHT SIMULATOR — ${FIGHT_COUNT.toLocaleString()} fights`);
console.log(`══════════════════════════════════════════════\n`);

// Opponent type distribution
const bossFights = count(r => r.opponentType === 'boss');
const creatureFights = count(r => r.opponentType === 'creature');
const internFights = count(r => r.opponentType === 'intern');

console.log(`── OPPONENT DISTRIBUTION ──────────────────────`);
console.log(`  Boss:     ${pct(bossFights).padStart(6)}  (expected ~60%)`);
console.log(`  Creature: ${pct(creatureFights).padStart(6)}  (expected ~30%)`);
console.log(`  Intern:   ${pct(internFights).padStart(6)}  (expected ~10%)`);

// Win rates by type
console.log(`\n── WIN RATES (opponent wins) ──────────────────`);
const bossWins = count(r => r.opponentType === 'boss' && r.winner === 'opponent');
const creatureWins = count(r => r.opponentType === 'creature' && r.winner === 'opponent');
const internWins = count(r => r.opponentType === 'intern' && r.winner === 'opponent');
console.log(`  Boss:     ${((bossWins / bossFights) * 100).toFixed(1).padStart(6)}%  (expected ~65%)`);
console.log(`  Creature: ${((creatureWins / creatureFights) * 100).toFixed(1).padStart(6)}%  (expected ~50%)`);
console.log(`  Intern:   ${((internWins / internFights) * 100).toFixed(1).padStart(6)}%  (expected ~20%)`);

// Per-boss breakdown
console.log(`\n── PER-BOSS BREAKDOWN ────────────────────────`);
for (const boss of BOSSES) {
  const fights = count(r => r.opponentName === boss.name);
  const wins = count(r => r.opponentName === boss.name && r.winner === 'opponent');
  const finishers = count(r => r.opponentName === boss.name && r.doBossFinisher);
  const specials = count(r => r.opponentName === boss.name && r.hasSpecialMove);
  console.log(`  ${boss.name.padEnd(8)} ${fights.toString().padStart(5)} fights | ${((wins / fights) * 100).toFixed(1).padStart(5)}% win | ${finishers.toString().padStart(4)} finishers (${((finishers / fights) * 100).toFixed(1)}%) | ${specials} specials`);
}

// Per-creature breakdown
console.log(`\n── PER-CREATURE BREAKDOWN ────────────────────`);
for (const creature of CREATURES) {
  const fights = count(r => r.opponentName === creature.name);
  const wins = count(r => r.opponentName === creature.name && r.winner === 'opponent');
  const specials = count(r => r.opponentName === creature.name && r.hasSpecialMove);
  console.log(`  ${creature.name.padEnd(22)} ${fights.toString().padStart(4)} fights | ${((wins / fights) * 100).toFixed(1).padStart(5)}% win | ${specials} specials`);
}

// Mechanics distribution
console.log(`\n── FIGHT MECHANICS ───────────────────────────`);
const comebacks = count(r => r.doComeback);
const finishers = count(r => r.doBossFinisher);
const slugfests = count(r => r.doSlugfest);
const specials = count(r => r.hasSpecialMove);
const plain = FIGHT_COUNT - comebacks - finishers - slugfests;
console.log(`  Special moves:  ${pct(specials).padStart(6)}  (expected ~90% — all non-interns)`);
console.log(`  Comebacks:      ${pct(comebacks).padStart(6)}  (expected ~35% of employee wins)`);
console.log(`  Boss finishers: ${pct(finishers).padStart(6)}  (expected ~30% of boss opponent wins)`);
console.log(`  Slugfests:      ${pct(slugfests).padStart(6)}  (expected ~25% of remainder)`);

// Cross-check: boss finishers should ONLY happen when boss wins
const badFinishers = count(r => r.doBossFinisher && (r.opponentType !== 'boss' || r.winner !== 'opponent'));
console.log(`\n── INTEGRITY CHECKS ──────────────────────────`);
console.log(`  Boss finisher on non-boss or employee win: ${badFinishers === 0 ? '✓ PASS (0)' : `✗ FAIL (${badFinishers})`}`);
const comebackOnLoss = count(r => r.doComeback && r.winner !== 'employee');
console.log(`  Comeback on non-employee win:              ${comebackOnLoss === 0 ? '✓ PASS (0)' : `✗ FAIL (${comebackOnLoss})`}`);
const internSpecial = count(r => r.opponentType === 'intern' && r.doBossFinisher);
console.log(`  Boss finisher on intern:                   ${internSpecial === 0 ? '✓ PASS (0)' : `✗ FAIL (${internSpecial})`}`);
const finisherAndComeback = count(r => r.doBossFinisher && r.doComeback);
console.log(`  Finisher + comeback overlap:               ${finisherAndComeback === 0 ? '✓ PASS (0)' : `✗ FAIL (${finisherAndComeback})`}`);

console.log(`\n══════════════════════════════════════════════\n`);
