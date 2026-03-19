# Fight Test Console Commands

Open the arcade view in a browser, open DevTools console, and paste these commands.

## Force a Specific Fight

```js
// Force next fight: specify opponent type, creature name, winner, and mechanics
// All params optional — omit any to use random
window._testFight = {
  opponent: 'creature',           // 'boss' | 'creature' | 'intern'
  creatureName: 'Sally in Accounting', // exact creature name (only for creature type)
  bossId: 'HD-00002',            // exact boss ID (only for boss type): HD-00001 Luke, HD-00002 Drew, HD-00003 Henry, HD-00004 Todd, HD-00005 Adam
  winner: 'employee',            // 'employee' | 'opponent'
  doStun: true,                  // force stun on/off
  stunTime: 5000,                // 5000 (early) or 9500 (late)
  doComeback: true,              // force comeback (employee wins only)
  doBossFinisher: false,         // force boss finisher (opponent wins + boss only)
  doStunInterrupt: false,        // force stun interrupt
  doSlugfest: false,             // force slugfest Act 3
  doMomentum: true,              // force momentum run in Act 1
  background: 'corner-office',   // force specific background
};
```

## Quick Presets

```js
// Drew's feedback loop special
window._testFight = { opponent: 'boss', bossId: 'HD-00002', winner: 'opponent' };

// Todd's laser with employee win
window._testFight = { opponent: 'boss', bossId: 'HD-00004', winner: 'employee' };

// Sally's expense denied
window._testFight = { opponent: 'creature', creatureName: 'Sally in Accounting' };

// Employee comeback
window._testFight = { opponent: 'creature', winner: 'employee', doComeback: true };

// Boss finisher (Drew)
window._testFight = { opponent: 'boss', bossId: 'HD-00002', winner: 'opponent', doBossFinisher: true };

// Stun interrupt
window._testFight = { opponent: 'creature', doStunInterrupt: true };

// Intern upset win
window._testFight = { opponent: 'intern', winner: 'opponent' };

// Slugfest
window._testFight = { opponent: 'creature', doSlugfest: true };

// Clear (return to random)
delete window._testFight;
```

## Usage
1. Paste a preset into the console
2. Wait for the next fight to trigger (or click a badge to force selection)
3. The test overrides apply for ONE fight, then auto-clear

## Creature Names
- The Phantom Printer
- The Network Wizard
- Watercooler Will
- HR Nancy
- The Dirty Microwave
- The MFA Guardian
- The Consultant
- Sally in Accounting

## Boss IDs
- HD-00001: Luke (TICKET ESCALATION)
- HD-00002: Drew (FEEDBACK LOOP)
- HD-00003: Henry (CLICK TRACK OF DOOM)
- HD-00004: Todd (1000 YARD STARE)
- HD-00005: Adam (LOW END THEORY)
