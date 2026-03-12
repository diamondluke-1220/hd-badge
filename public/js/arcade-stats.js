// ─── Arcade Stats Engine ─────────────────────────────────
// Deterministic stat generation for Arcade Select Screen.
// Pure functions — no DB, no side effects.

(function() {
  function arcHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
    }
    return hash;
  }

  // Seeded pseudo-random from hash
  function seededRand(seed) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  }

  const STAT_NAMES = ['PWR', 'DEF', 'SPD', 'INT', 'LCK', 'CHR', 'STA', 'RBL'];

  // Division templates: [min, max] per stat
  const TEMPLATES = {
    'IT':        { PWR: [3,7], DEF: [3,7], SPD: [6,10], INT: [6,10], LCK: [1,5], CHR: [1,5], STA: [3,7], RBL: [3,7] },
    'Corporate': { PWR: [3,7], DEF: [6,10], SPD: [1,5],  INT: [3,7],  LCK: [3,7], CHR: [6,10], STA: [3,7], RBL: [1,5] },
    'Office':    { PWR: [1,5], DEF: [3,7], SPD: [3,7],  INT: [1,5],  LCK: [6,10], CHR: [3,7], STA: [6,10], RBL: [3,7] },
    'Punk':      { PWR: [6,10], DEF: [1,5], SPD: [3,7],  INT: [3,7],  LCK: [3,7], CHR: [1,5], STA: [3,7], RBL: [6,10] },
    '_exec':     { PWR: [5,9], DEF: [5,9], SPD: [5,9],  INT: [5,9],  LCK: [5,9], CHR: [5,9], STA: [5,9], RBL: [5,9] },
    '_custom':   { PWR: [3,8], DEF: [3,8], SPD: [3,8],  INT: [3,8],  LCK: [3,8], CHR: [3,8], STA: [3,8], RBL: [3,8] },
  };

  // Signature minimums
  const SIGNATURES = { 'IT': { INT: 7 }, 'Corporate': { DEF: 7 }, 'Office': { STA: 7 }, 'Punk': { RBL: 8 } };

  function getEmployeeStats(name, id, division) {
    const div = TEMPLATES[division] || TEMPLATES['_custom'];
    const sig = SIGNATURES[division] || {};
    let seed = arcHash(name + (id || ''));
    const stats = {};

    STAT_NAMES.forEach((stat, i) => {
      seed = seededRand(seed + i);
      const range = div[stat];
      let val = range[0] + (seed % (range[1] - range[0] + 1));
      // Apply signature minimum
      if (sig[stat] && val < sig[stat]) val = sig[stat];
      stats[stat] = val;
    });

    // Cap total at 48
    let total = STAT_NAMES.reduce((s, k) => s + stats[k], 0);
    while (total > 48) {
      // Find highest stat and reduce
      const highest = STAT_NAMES.reduce((a, b) => stats[a] >= stats[b] ? a : b);
      if (stats[highest] > 1) { stats[highest]--; total--; }
      else break;
    }

    return stats;
  }

  // 12 character classes
  const CLASSES = [
    { name: 'Help Desk Warrior', division: 'IT', stats: ['STA', 'SPD'], tagline: 'Have you tried turning it off and on again?' },
    { name: 'Cable Monk', division: 'IT', stats: ['INT', 'DEF'], tagline: 'Silence. I\'m tracing.' },
    { name: 'DevOps Druid', division: 'IT', stats: ['INT', 'SPD'], tagline: 'The pipeline is a living thing.' },
    { name: 'Shadow IT Rogue', division: 'IT', stats: ['RBL', 'SPD'], tagline: 'You didn\'t see me install this.' },
    { name: 'Printer Necromancer', division: 'Office', stats: ['STA', 'LCK'], tagline: 'PC LOAD LETTER? I speak its tongue.' },
    { name: 'Spreadsheet Wizard', division: 'Corporate', stats: ['INT', 'DEF'], tagline: 'VLOOKUP is my love language.' },
    { name: 'Standup Bard', division: 'Corporate', stats: ['CHR', 'STA'], tagline: 'My blocker is this meeting.' },
    { name: 'Slack Assassin', division: 'Corporate', stats: ['DEF', 'INT'], tagline: 'Seen. Not responding.' },
    { name: 'Compliance Paladin', division: 'Corporate', stats: ['DEF', 'CHR'], tagline: 'Policy is policy.' },
    { name: 'Intern Summoner', division: 'Corporate', stats: ['CHR', 'LCK'], tagline: 'I need someone to take notes.' },
    { name: 'Mosh Pit Berserker', division: 'Punk', stats: ['PWR', 'RBL'], tagline: 'CHECK ONE TWO.' },
    { name: 'Riff Tank', division: 'Punk', stats: ['STA', 'DEF'], tagline: 'I take the hits so the band doesn\'t have to.' },
  ];

  function getClass(stats, division, name) {
    // Get top 2 stats
    const sorted = STAT_NAMES.slice().sort((a, b) => stats[b] - stats[a]);
    const top2 = new Set([sorted[0], sorted[1]]);

    // Find matching class for this division
    const divClasses = CLASSES.filter(c => c.division === division);
    if (divClasses.length === 0) {
      // For _exec and _custom, pick from IT classes
      const fallback = CLASSES.filter(c => c.division === 'IT');
      return fallback[arcHash(name) % fallback.length];
    }

    // Score each class by how many of its stats match top 2
    let best = divClasses[0];
    let bestScore = 0;
    divClasses.forEach(c => {
      const score = c.stats.filter(s => top2.has(s)).length;
      if (score > bestScore) { bestScore = score; best = c; }
    });

    // Ties broken by name hash
    if (bestScore === 0) best = divClasses[arcHash(name) % divClasses.length];

    return best;
  }

  function getLevel(stats) {
    const total = STAT_NAMES.reduce((s, k) => s + stats[k], 0);
    return Math.min(10, Math.max(1, Math.floor(total / 4.8)));
  }

  const MOVES = {
    'IT': ['CTRL+ALT+DELETE', 'PACKET STORM', 'HARD RESET', 'FIREWALL SLAM', 'SUDO SMASH', 'PING OF DEATH'],
    'Corporate': ['REPLY ALL NUKE', 'CALENDAR BLOCK', 'SCOPE CREEP', 'SYNERGY BLAST', 'PASSIVE-AGGRESSIVE CC', 'BUDGET FREEZE'],
    'Punk': ['FEEDBACK SCREECH', 'STAGE DIVE', 'POWER CHORD SLAM', 'CROWD SURF', 'AMP TO ELEVEN', 'ENCORE'],
    'Office': ['JAM CLEAR', 'STAPLER SNIPE', 'COFFEE SPLASH', 'HOLD MUSIC', 'PAPER CUT FLURRY', 'SUPPLY CLOSET AMBUSH'],
  };

  function getMove(name, division) {
    const pool = MOVES[division] || MOVES['IT'];
    return pool[arcHash(name) % pool.length];
  }

  const QUOTES = [
    'Per my last email...', 'Works on my machine.', "That's a layer 8 problem.",
    "I don't have a ticket for that.", 'This could have been a Slack message.',
    'Did you check the wiki? There is no wiki.', 'My code is self-documenting.',
    "I'll take that offline.", 'Bold of you to deploy on a Friday.',
    "I'm not arguing, I'm explaining why I'm right.",
    'Let me share my screen... wrong monitor.',
    'As per the documentation that doesn\'t exist...',
    'I was on mute the whole time.', 'New phone, who dis?'
  ];

  function getQuote(name) {
    return QUOTES[arcHash(name) % QUOTES.length];
  }

  window.ArcadeStats = { getEmployeeStats, getClass, getLevel, getMove, getQuote, STAT_NAMES };
})();
