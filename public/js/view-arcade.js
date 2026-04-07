// ─── Arcade Renderer (Select Screen View) ────────────────
// Implements the renderer interface: { init, addBadge, destroy }
// Fighting-game character select screen for the employee directory.
// VS animation is the main presentation focus — Punch-Out inspired choreography.

const ROSTER_SIZE = 28;
const ROSTER_COOLDOWN = 6; // fights to wait before swapping out a fought badge

window.ArcadeRenderer = {
  _container: null,
  _stats: null,
  _allBadges: [],
  _bossBadges: [],
  _rosterSlots: [],   // { badge, foughtAt: null|tickNumber } — active in grid
  _rosterPool: [],    // badges waiting to enter the roster
  _selectedBadge: null,
  _locked: false,
  _intervals: [],
  _timeouts: [],
  _activeTab: 'ALL',
  _gridPanel: null,
  _announcer: null,
  _bgIndex: 0,
  _isVSActive: false,

  // Division accent colors — from shared.js DIVISION_ACCENT_COLORS

  _ANNOUNCER_LINES: [
    'SELECT YOUR FIGHTER',
    'A NEW CHALLENGER HAS ARRIVED',
    'INSERT COIN TO CONTINUE',
    'CHOOSE YOUR DESTINY',
    'THE HELP DESK AWAITS',
    'REPORT TO YOUR CUBICLE',
    'ALL TICKETS WILL BE RESOLVED',
    'WELCOME TO THE CORPORATE ARENA',
    'MAY YOUR UPTIME BE ETERNAL',
    'CTRL+ALT+DEFEAT',
    'YOUR TIMESHEET IS DUE',
    'SYNERGY LEVELS CRITICAL',
    'PLEASE HOLD FOR THE NEXT COMBATANT',
    'WE GOT A RED ALERT',
  ],

  // Boss creatures for VS battles — "Corporate Dread" illustrated art
  _CREATURES: [
    { name: 'The Phantom Printer', tagline: 'PC LOAD LETTER.', move: 'PAPER FEED FRENZY', imageUrl: '/images/arcade/phantom-printer.png' },
    { name: 'The Network Wizard', tagline: "It's always DNS.", move: 'PACKET STORM', imageUrl: '/images/arcade/network-wizard.png' },
    { name: 'Watercooler Will', tagline: 'Oh hey, quick question...', move: 'ENDLESS ANECDOTE', imageUrl: '/images/arcade/watercooler-will.png' },
    { name: 'HR Nancy', tagline: 'Just a quick mandatory training.', move: 'COMPLIANCE LOCKDOWN', imageUrl: '/images/arcade/hr-nancy.png' },
    { name: 'The Dirty Microwave', tagline: 'WHO LEFT FISH IN HERE?!', move: 'HAZMAT EXPLOSION', imageUrl: '/images/arcade/dirty-microwave.png' },
    { name: 'The MFA Guardian', tagline: 'Enter your code. 3 seconds.', move: 'CODE SWITCH', imageUrl: '/images/arcade/mfa-guardian.png' },
    { name: 'The Consultant', tagline: "Twice the pay. Half the work.", move: 'BUDGET SLASH', imageUrl: '/images/arcade/the-consultant.png' },
    { name: 'Sally in Accounting', tagline: "This fight will be 1040-EZ.", move: 'EXPENSE DENIED', imageUrl: '/images/arcade/sally-accounting.jpg' },
  ],

  // Intern opponents
  _INTERNS: [
    { name: 'THE INTERN', className: 'Unpaid Intern', tagline: "I'm just happy to be here.", move: 'UNPAID OVERTIME', imageUrl: '/images/arcade/unpaid-intern.png' },
  ],

  // SNES pixel art portraits for boss opponents (band members)
  // Generate missing portraits: bun run scripts/snes-portrait.ts --photo <path> --name <name>
  _BOSS_PORTRAITS: {
    'HD-00001': '/images/arcade/luke-boss.png',
    'HD-00002': '/images/arcade/drew-boss.png',
    'HD-00003': '/images/arcade/henry-boss.png',
    'HD-00004': '/images/arcade/todd-boss.png',
    'HD-00005': '/images/arcade/adam-boss.png',
  },

  // Boss-specific special moves
  _BOSS_MOVES: {
    'HD-00001': 'TICKET ESCALATION',
    'HD-00002': 'FEEDBACK LOOP',
    'HD-00003': 'CLICK TRACK OF DOOM',
    'HD-00004': '1000 YARD STARE',
    'HD-00005': 'LOW END THEORY',
  },

  // Per-boss trash-talk lines (keyed by employee ID)
  _BOSS_TAGLINES: {
    'HD-00001': [ // Luke — Chief Escalation Officer
      "I'm escalating this to ME.",
      "Your ticket has been reassigned.",
      "Priority: you losing.",
      "Help desk, please hold.",
    ],
    'HD-00002': [ // Drew — Chief String Tickler
      "You're about to get feedback.",
      "I don't like your tone.",
      "This mix needs more pain.",
    ],
    'HD-00003': [ // Henry — Chief Impact Officer
      "I hit things for a living.",
      "Brace for impact.",
      "That's gonna leave a mark.",
    ],
    'HD-00004': [ // Todd — President of Mutes and Strums
      "Stare Intensifies....",
      "Your access has been revoked.",
      "Lights out.",
    ],
    'HD-00005': [ // Adam — VP of Bottom Line Operations
      "The bottom line is you lose.",
      "Oh I can go lower.",
      "Bass in your face!!.",
    ],
  },
  _BOSS_TAGLINES_FALLBACK: [
    "You're not even on the org chart.",
    "Your badge has been deactivated.",
    "My calendar says you're fired.",
  ],

  // Employee defeat lines (when boss/creature wins)
  _EMPLOYEE_DEFEAT_LINES: [
    'SENT TO SENSITIVITY TRAINING',
    'BADGE ACCESS REVOKED',
    'REASSIGNED TO THE BASEMENT',
    'MANDATORY OVERTIME ACTIVATED',
    'MOVED TO AN OPEN FLOOR PLAN',
    'UP FOR PERFORMANCE REVIEW',
    'SENT TO GET EVERYONE COFFEE',
    'TRANSFERRED TO NIGHT SHIFT',
    'NOW ON UNPTO',
    'FRIDAY JEANS ACCESS REVOKED',
    'CUT OUT OF THE CARPOOL',
    'PARKING SPOT REASSIGNED',
    'INSTALLING 1 OF 1000 UPDATES',
    "YOU CAN'T QUIT, YOU'RE FIRED",
  ],

  // Stage backgrounds for VS overlay only
  _BACKGROUNDS: ['server-room', 'break-room', 'meeting-room', 'cubicle-farm', 'corner-office'],

  // Creature → possible backgrounds (random pick from array)
  _CREATURE_BACKGROUNDS: {
    'The Dirty Microwave': ['break-room'],
    'The Network Wizard': ['server-room'],
    'The Phantom Printer': ['cubicle-farm', 'meeting-room'],
    'Watercooler Will': ['break-room', 'cubicle-farm'],
    'HR Nancy': ['meeting-room', 'cubicle-farm'],
    'The MFA Guardian': ['server-room'],
    'The Consultant': ['meeting-room', 'cubicle-farm'],
    'Sally in Accounting': ['meeting-room', 'cubicle-farm'],
    'THE INTERN': ['cubicle-farm', 'break-room'],
  },

  // Boss band members: 80% corner-office, 20% random other stage
  _BOSS_BACKGROUNDS: {
    _default: 'corner-office',
    _others: ['server-room', 'break-room', 'meeting-room', 'cubicle-farm'],
  },

  async init(container, stats) {
    this._container = container;
    this._stats = stats;
    this._allBadges = [];
    this._bossBadges = [];
    this._rosterSlots = [];
    this._rosterPool = [];
    this._selectedBadge = null;
    this._locked = false;
    this._intervals = [];
    this._timeouts = [];
    this._activeTab = 'ALL';
    this._rotationTimer = null;
    this._rotationIndex = 0;
    this._shuffledBadges = [];
    this._isArrivalActive = false;
    this._arrivalQueue = [];
    this._rotationTick = 0;
    this._bgIndex = 0;
    this._isVSActive = false;

    // Touch device detection for QTE prompts (SPACE vs TAP label)
    if ('ontouchstart' in window) container.classList.add('touch-device');

    // Preload sample-based SFX
    if (window.ArcadeSFX && ArcadeSFX.preload) ArcadeSFX.preload();

    // Initialize shared stats (ticker, donut)
    initRendererStats(stats);

    // Fetch all badges (paginated)
    await this._fetchAllBadges();

    // Build layout
    this._buildLayout();

    // Populate grid
    this._populateGrid();

    // Re-size grid on window resize
    this._resizeHandler = () => this._autoSizeGrid();
    window.addEventListener('resize', this._resizeHandler);

    // Pause expensive animations when tab is not visible (CPU/battery)
    this._onVisibilityChange = () => {
      if (!this._container) return;
      if (document.visibilityState === 'hidden') {
        this._stopRotation();
        if (this._container.getAnimations) {
          this._container.getAnimations({ subtree: true }).forEach(a => a.pause());
        }
      } else if (document.visibilityState === 'visible') {
        if (this._container.getAnimations) {
          this._container.getAnimations({ subtree: true }).forEach(a => a.play());
        }
        // Resume rotation only if we're idle (not mid-fight, arrival, or locked)
        if (!this._locked && !this._isVSActive && !this._isArrivalActive) {
          this._resumeRotation();
        }
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    // Attract mode on first load (once per session)
    if (!window._arcadeAttractDone && animationsEnabled()) {
      window._arcadeAttractDone = true;
      this._playAttractMode();
    } else {
      this._startRotation();
    }
  },

  async _fetchAllBadges() {
    const badges = await BadgePool.fetchAll({ limit: 500 });
    // Band members are bosses only — they appear as opponents, not as rotating fighters
    const fanBadges = [];
    badges.forEach(b => {
      if (b.isBandMember) this._bossBadges.push(b);
      else fanBadges.push(b);
    });
    this._allBadges = fanBadges;

    // Split into active roster (up to ROSTER_SIZE) + waiting pool
    const shuffled = hdShuffle([...fanBadges]);
    this._rosterSlots = shuffled.slice(0, ROSTER_SIZE).map(b => ({ badge: b, foughtAt: null }));
    this._rosterPool = shuffled.slice(ROSTER_SIZE);
  },

  // ─── Layout (Clean Grid — no arena, no fighter portraits) ───────

  _buildLayout() {
    this._container.innerHTML = `
      <div class="arcade-container">
        <div class="arcade-header">
          <span class="arcade-header-text">SELECT YOUR FIGHTER</span>
        </div>
        <div class="arcade-tabs"></div>
        <div class="arcade-spotlight">
          <div class="arcade-spotlight-photo-wrap">
            <div class="arcade-spotlight-silhouette">?</div>
          </div>
          <div class="arcade-spotlight-info">
            <div class="arcade-spotlight-name">AWAITING SELECTION</div>
            <div class="arcade-spotlight-title"></div>
            <div class="arcade-spotlight-dept"></div>
          </div>
          <button class="arcade-codex-btn" id="arcadeCodexBtn">CODEX</button>
        </div>
        <div class="arcade-announcer">
          <span class="arcade-announcer-text">INSERT COIN</span>
        </div>
        <div class="arcade-roster arcade-roster-full">
          <div class="arcade-grid"></div>
        </div>
      </div>
    `;

    this._gridPanel = this._container.querySelector('.arcade-grid');
    this._announcer = this._container.querySelector('.arcade-announcer-text');
    this._spotlight = this._container.querySelector('.arcade-spotlight');

    // Codex button
    const codexBtn = this._container.querySelector('#arcadeCodexBtn');
    if (codexBtn) codexBtn.addEventListener('click', () => this._buildCodex());

    // Build tabs
    this._buildTabs();
  },

  _buildTabs() {
    const tabBar = this._container.querySelector('.arcade-tabs');
    if (!tabBar) return;

    const allBtn = document.createElement('button');
    allBtn.className = 'arcade-tab active';
    allBtn.textContent = 'ALL DIVISIONS';
    allBtn.style.setProperty('--tab-color', '#00ffcc');
    allBtn.addEventListener('click', () => this._filterByDivision('ALL'));
    tabBar.appendChild(allBtn);

    PUBLIC_DIVISIONS.forEach(div => {
      const btn = document.createElement('button');
      btn.className = 'arcade-tab';
      btn.textContent = div.name;
      btn.dataset.division = div.theme;
      btn.style.setProperty('--tab-color', DIVISION_ACCENT_COLORS[div.theme] || '#ffd700');
      btn.addEventListener('click', () => this._filterByDivision(div.theme));
      tabBar.appendChild(btn);
    });
  },

  _filterByDivision(division) {
    this._activeTab = division;

    const tabs = this._container.querySelectorAll('.arcade-tab');
    tabs.forEach(t => t.classList.remove('active'));
    if (division === 'ALL') {
      tabs[0].classList.add('active');
    } else {
      tabs.forEach(t => {
        if (t.dataset.division === division) t.classList.add('active');
      });
    }

    // Show/hide slots via class toggle (avoids inline style reflow per slot)
    const slots = this._container.querySelectorAll('.arcade-slot');
    slots.forEach(slot => {
      slot.classList.toggle('slot-hidden', division !== 'ALL' && slot.dataset.division !== division);
    });

    // (Division headers removed — tabs handle filtering)
  },

  _populateGrid() {
    const grid = this._gridPanel;
    if (!grid) return;

    // Only render active roster slots (not the full pool)
    this._rosterSlots.forEach(rs => {
      const slot = this._createSlot(rs.badge);
      grid.appendChild(slot);
    });

    // Auto-size slots to fill available space with multiple rows
    this._autoSizeGrid();
  },

  _autoSizeGrid() {
    const grid = this._gridPanel;
    const roster = this._container.querySelector('.arcade-roster');
    if (!grid || !roster) return;

    const badgeCount = this._rosterSlots.length;
    if (badgeCount === 0) return;

    // Available space — use viewport height minus roster's top position for true available height
    const rosterWidth = roster.clientWidth - 32; // padding
    const rosterTop = roster.getBoundingClientRect().top;
    const rosterHeight = window.innerHeight - rosterTop - 16; // 16px bottom margin
    const gap = 4;

    // Sizing strategy: pick the width that fits EXACTLY targetCols
    // columns. This guarantees DESIRED_ROWS rows regardless of the
    // measured rosterHeight, which is unreliable during initial layout
    // (the flex parent hasn't resolved its size yet, so `roster.getBoundingClientRect().top`
    // is near the bottom of the viewport and rosterHeight comes out as
    // ~66px on first paint). The previous height-search loop would then
    // collapse the layout into 1 row of tiny 46px slots.
    const minW = 44;
    const maxW = 140;
    const aspect = 146 / 120;
    const DESIRED_ROWS = 2;
    const targetCols = Math.ceil(badgeCount / DESIRED_ROWS);

    let bestW = Math.floor((rosterWidth - (targetCols - 1) * gap) / targetCols);
    bestW = Math.max(minW, Math.min(maxW, bestW));
    let bestH = Math.round(bestW * aspect);

    // Height-fit shrinkage: if the available height is reliably measured
    // (above a sanity threshold ruling out the 66px first-paint glitch)
    // AND the natural 2-row layout overflows it, shrink uniformly so
    // both rows fit. Aspect ratio is preserved.
    const SANITY_MIN_HEIGHT = 200;
    if (rosterHeight > SANITY_MIN_HEIGHT) {
      const naturalHeight = DESIRED_ROWS * bestH + (DESIRED_ROWS - 1) * gap;
      if (naturalHeight > rosterHeight) {
        const maxH = Math.floor((rosterHeight - (DESIRED_ROWS - 1) * gap) / DESIRED_ROWS);
        const shrunkW = Math.round(maxH / aspect);
        bestW = Math.max(minW, Math.min(maxW, shrunkW));
        bestH = Math.round(bestW * aspect);
      }
    }

    grid.style.setProperty('--slot-w', bestW + 'px');
    grid.style.setProperty('--slot-h', bestH + 'px');

    // Apply dynamic sizing via CSS custom properties
    const slots = grid.querySelectorAll('.arcade-slot');
    slots.forEach(s => {
      s.style.width = bestW + 'px';
      s.style.height = bestH + 'px';
    });
  },

  _createSlot(badge) {
    const div = getDivisionForDept(badge.department, badge.isBandMember);
    const slot = document.createElement('div');
    slot.className = 'arcade-slot';
    slot.dataset.employeeId = badge.employeeId;
    slot.dataset.division = div;
    slot.setAttribute('role', 'button');
    slot.setAttribute('tabindex', '0');
    slot.setAttribute('aria-label', `${badge.name}, ${badge.title}${badge.isBandMember ? ' (Boss)' : ''}`);
    if (badge.isBandMember) slot.classList.add('boss');

    const color = DIVISION_ACCENT_COLORS[div] || '#ffd700';
    slot.style.setProperty('--slot-color', color);

    // Band members use SNES pixel art portraits; fans use headshot API
    const slotPhoto = (badge.isBandMember && this._BOSS_PORTRAITS[badge.employeeId])
      ? this._BOSS_PORTRAITS[badge.employeeId]
      : `/api/badge/${esc(badge.employeeId)}/headshot`;

    slot.innerHTML = `
      <div class="arcade-slot-photo-wrap">
        <img class="arcade-slot-photo" src="${esc(slotPhoto)}"
             alt="${esc(badge.name)}" loading="lazy"
             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
        <div class="arcade-slot-silhouette" style="display:none">?</div>
      </div>
      <div class="arcade-slot-name">${esc(badge.name)}</div>
    `;

    // Click → lock/unlock selection + show detail
    const selectSlot = () => {
      if (this._locked && this._selectedBadge && this._selectedBadge.employeeId === badge.employeeId) {
        this._locked = false;
        slot.classList.remove('selected');
        this._resumeRotation();
        return;
      }
      this._container.querySelectorAll('.arcade-slot.selected').forEach(s => s.classList.remove('selected'));
      slot.classList.add('selected');
      this._locked = true;
      this._selectedBadge = badge;
      showBadgeDetail(badge.employeeId, badge.name);
    };
    slot.addEventListener('click', selectSlot);

    // Keyboard: Enter/Space to select, arrow keys to navigate
    slot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectSlot();
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const slots = [...this._container.querySelectorAll('.arcade-slot:not(.slot-hidden)')];
      const idx = slots.indexOf(slot);
      if (idx === -1) return;
      let next = idx;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(idx + 1, slots.length - 1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(idx - 1, 0);
      slots[next].focus();
    });

    return slot;
  },

  _highlightSlot(slot) {
    this._container.querySelectorAll('.arcade-slot.highlighted').forEach(s => s.classList.remove('highlighted'));
    slot.classList.add('highlighted');
  },

  // ─── Announcer ──────────────────────────────────────────────

  _setAnnouncer(text, { blink = false, large = false } = {}) {
    if (this._announcer) {
      this._announcer.textContent = text;
      this._announcer.classList.remove('tick-pulse');
      this._announcer.classList.toggle('blink', blink);
      this._announcer.classList.toggle('announcer-large', large);
    }
  },

  // ─── Rotation System ───────────────────────────────────────

  _startRotation() {
    if (this._rosterSlots.length === 0) return;
    // Build fight queue from unfought roster members
    this._shuffledBadges = hdShuffle(this._rosterSlots.filter(rs => rs.foughtAt === null).map(rs => rs.badge));
    // If everyone has fought, pick from oldest-fought
    if (this._shuffledBadges.length === 0) {
      this._shuffledBadges = this._rosterSlots
        .slice().sort((a, b) => (a.foughtAt || 0) - (b.foughtAt || 0))
        .map(rs => rs.badge);
    }
    this._rotationIndex = 0;
    this._rotationTick = 0;

    // Show welcome text first, then begin selection after 3s
    this._setAnnouncer('WELCOME TO THE CORPORATE ARENA', { blink: true, large: true });

    const startDelay = animationsEnabled() ? 3000 : 0;
    const startTid = setTimeout(() => {
      this._setAnnouncer('', { blink: false, large: false });
      // Go straight to VS matchup (cursor select → fight → breather chain)
      this._showVSMatchup();
    }, startDelay);
    this._timeouts.push(startTid);
  },

  // ─── Attract Mode (first load boot sequence) ────────────

  _playAttractMode() {
    const container = this._container.querySelector('.arcade-container');
    if (!container) { this._startRotation(); return; }

    // Add attract title overlay
    const titleOverlay = document.createElement('div');
    titleOverlay.className = 'arcade-attract-title';
    titleOverlay.innerHTML = '<div class="arcade-attract-title-text">WELCOME TO THE<br>CORPORATE ARENA</div>';
    container.appendChild(titleOverlay);

    // Phase 1: Full brightness bg, show title
    container.classList.add('attract-mode');
    requestAnimationFrame(() => {
      titleOverlay.style.transition = 'opacity 0.5s ease';
      titleOverlay.style.opacity = '1';
    });

    // Phase 2: Dim background (2s)
    const t1 = setTimeout(() => {
      container.classList.remove('attract-mode');
      container.classList.add('attract-dim');
    }, 2000);

    // Phase 3: Fade out title, reveal UI (3s)
    const t2 = setTimeout(() => {
      titleOverlay.style.opacity = '0';
      container.classList.add('attract-reveal');
    }, 3000);

    // Phase 4: Clean up, start rotation (5s)
    const t3 = setTimeout(() => {
      titleOverlay.remove();
      container.classList.remove('attract-dim', 'attract-reveal');
      this._startRotation();
    }, 5000);

    this._timeouts.push(t1, t2, t3);
  },

  // ─── Codex (enemy bestiary) ─────────────────────────────

  _CODEX_ENTRIES: {
    // Creatures
    'The Phantom Printer': { type: 'creature', desc: 'A haunted office printer that feeds on misery and ink cartridges. Has been "out of toner" since 2019. No one has ever successfully printed on the first try.', move: 'PAPER FEED FRENZY' },
    'The Network Wizard': { type: 'creature', desc: "Claims to know the dark arts of subnetting. Blames DNS for everything, and is right 60% of the time. Nobody knows what he actually does, but nothing works without him.", move: 'PACKET STORM' },
    'Watercooler Will': { type: 'creature', desc: "Has a story for every occasion. None of them are short. He'll corner you for 45 minutes about his weekend. There is no escape. There is only nodding.", move: 'ENDLESS ANECDOTE' },
    'HR Nancy': { type: 'creature', desc: "Compliance isn't just mandatory — it's punishable by death. Enforces policy with an iron fist wrapped in a mandatory training module. Forget to fill out the forms properly and you'll soon realize what she's been training for.", move: 'COMPLIANCE LOCKDOWN' },
    'The Dirty Microwave': { type: 'creature', desc: "Nobody claims it. Nobody cleans it. The smell has its own HR file. Fish reheaters are its sworn allies. The only thing worse than the smell are the passive-aggressive emails asking everyone to chip in and clean it.", move: 'HAZMAT EXPLOSION' },
    'The MFA Guardian': { type: 'creature', desc: "Not an agent of chaos — a titan of entropy. A constantly rotating code that has no problem locking you out for good. Has locked out the CEO twice. Shows no remorse.", move: 'CODE SWITCH' },
    'The Consultant': { type: 'creature', desc: "Twice the pay, half the deliverables. Will recommend a strategy that you already tried last quarter. The only thing nicer than his car is his golden parachute.", move: 'BUDGET SLASH' },
    'Sally in Accounting': { type: 'creature', desc: "The most dangerous person in the building and she knows it. Runs the books with an iron abacus — every receipt, every decimal, every dime. 1040-EZ on the eyes but there's nothing easy about getting past her. Your expense report never stood a chance.", move: 'EXPENSE DENIED' },
    'THE INTERN': { type: 'intern', desc: "Has a badge but no authority, a desk but no seniority, a fresh degree but no idea what's happening. Brings great energy though. 10/10 would hire again.", move: 'UNPAID OVERTIME' },
    // Bosses
    'Luke': { type: 'boss', desc: 'Chief Escalation Officer. Will escalate your ticket to himself, then close it. Band frontman. Please hold.', move: 'TICKET ESCALATION' },
    'Drew': { type: 'boss', desc: "Chief String Tickler. His feedback isn't constructive — it's a 100-watt wall of sound. Wields a Flying V.", move: 'FEEDBACK LOOP' },
    'Henry': { type: 'boss', desc: 'Chief Impact Officer. Hits things professionally. His click track has ended careers and started mosh pits.', move: 'CLICK TRACK OF DOOM' },
    'Todd': { type: 'boss', desc: 'President of Mutes and Strums. Runs the Dept. of Downstroke Governance. His stare has rebooted servers and crushed spirits.', move: '1000 YARD STARE' },
    'Adam': { type: 'boss', desc: 'VP of Bottom Line Operations. The low end is non-negotiable. Cuts budgets and bass lines with equal precision.', move: 'LOW END THEORY' },
  },

  _buildCodex() {
    const overlay = document.createElement('div');
    overlay.className = 'arcade-codex-overlay active';

    const sections = [
      { title: 'CREATURES', type: 'creature' },
      { title: 'OTHER', type: 'intern' },
      { title: 'HELP DESK', type: 'boss' },
    ];

    let html = `<div class="arcade-codex-header">
      <span class="arcade-codex-title">CORPORATE CODEX</span>
      <button class="arcade-codex-close">&times;</button>
    </div>`;

    for (const section of sections) {
      const entries = Object.entries(this._CODEX_ENTRIES).filter(([, e]) => e.type === section.type);
      if (entries.length === 0) continue;

      const isBossSection = section.type === 'boss';
      html += `<div class="arcade-codex-section"><div class="arcade-codex-section-title">${section.title}</div>`;
      html += '<div class="arcade-codex-boss-grid">';

      for (const [name, entry] of entries) {
        let portrait = '';
        if (entry.type === 'boss') {
          const bossId = { Luke: 'HD-00001', Drew: 'HD-00002', Henry: 'HD-00003', Todd: 'HD-00004', Adam: 'HD-00005' }[name];
          portrait = this._BOSS_PORTRAITS[bossId] || '';
        } else {
          const creature = this._CREATURES.find(c => c.name === name) || this._INTERNS.find(c => c.name === name);
          portrait = creature ? creature.imageUrl : '';
        }

        const displayName = esc(name);
        const portraitClass = isBossSection ? 'arcade-codex-band-portrait' : 'arcade-codex-creature-portrait';
        const entryClass = isBossSection ? 'arcade-codex-entry arcade-codex-boss-entry arcade-codex-band' : 'arcade-codex-entry arcade-codex-boss-entry';

        html += `<div class="${entryClass}">
          <div class="arcade-codex-boss-portrait-wrap">
            <img class="${portraitClass}" src="${esc(portrait)}" alt="${displayName}" onerror="this.style.display='none'">
          </div>
          <div class="arcade-codex-info">
            <div class="arcade-codex-name">${displayName}</div>
            <div class="arcade-codex-move">SPECIAL MOVE: ${esc(entry.move)}</div>
            <div class="arcade-codex-desc">${esc(entry.desc)}</div>
          </div>
        </div>`;
      }

      html += '</div></div>';
    }

    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    overlay.querySelector('.arcade-codex-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  },

  _stopRotation() {
    if (this._rotationTimer) {
      clearInterval(this._rotationTimer);
      this._intervals = this._intervals.filter(id => id !== this._rotationTimer);
      this._rotationTimer = null;
    }
  },

  _clearFightResults() {
    this._container.querySelectorAll('.arcade-slot.fight-winner, .arcade-slot.fight-loser').forEach(slot => {
      slot.classList.remove('fight-winner', 'fight-loser');
      const label = slot.querySelector('.arcade-slot-result');
      if (label) label.remove();
    });
  },

  _resumeRotation() {
    this._stopRotation();
    const interval = animationsEnabled() ? 18000 : 3000;
    this._rotationTimer = setInterval(() => {
      if (this._isArrivalActive || this._locked || this._isVSActive) return;
      this._rotationIndex++;
      this._showVSMatchup();
    }, interval);
    this._intervals.push(this._rotationTimer);
  },

  // ─── Cursor Selection Animation (~7s, progressive deceleration) ──────────────

  _animateCursorSelect(targetBadge, onLand) {
    const visibleSlots = [...this._container.querySelectorAll('.arcade-slot:not(.slot-hidden)')];
    if (visibleSlots.length === 0) {
      if (onLand) onLand();
      return;
    }

    // Clear any existing cursor highlights
    this._container.querySelectorAll('.arcade-slot.cursor-active').forEach(s => s.classList.remove('cursor-active'));
    this._container.querySelectorAll('.arcade-slot.highlighted').forEach(s => s.classList.remove('highlighted'));

    this._setAnnouncer('SELECTING FIGHTER...');

    // Build deceleration schedule: smooth exponential curve
    // Fast spin (40ms) → gradual slowdown → final crawl, no jarring jumps
    const steps = [];
    let t = 0;
    let interval = 40;
    const maxTime = 5200; // cursor animation budget before landing

    while (t < maxTime) {
      steps.push(t);
      t += Math.round(interval);
      interval *= 1.08;
    }
    // Final land
    const landTime = t + 200;

    const targetSlot = this._container.querySelector(`[data-employee-id="${targetBadge.employeeId}"]`);
    const totalSteps = steps.length;

    steps.forEach((delay, idx) => {
      const tid = setTimeout(() => {
        this._container.querySelectorAll('.arcade-slot.cursor-active').forEach(s => s.classList.remove('cursor-active'));

        let slot;
        // Last 4 steps: converge toward neighbors of the target
        if (idx >= totalSteps - 4 && targetSlot) {
          const targetIdx = visibleSlots.indexOf(targetSlot);
          if (targetIdx >= 0) {
            const offset = (totalSteps - idx);
            const nearIdx = Math.max(0, Math.min(visibleSlots.length - 1, targetIdx + (Math.random() < 0.5 ? offset : -offset)));
            slot = visibleSlots[nearIdx];
          }
        }
        if (!slot) {
          slot = visibleSlots[Math.floor(Math.random() * visibleSlots.length)];
        }

        slot.classList.add('cursor-active');
        if (window.ArcadeSFX) ArcadeSFX.play('cursorTick');

        // Tick pulse on announcer bar
        if (this._announcer) {
          this._announcer.classList.remove('tick-pulse');
          void this._announcer.offsetWidth; // force reflow to restart animation
          this._announcer.classList.add('tick-pulse');
        }

        // Pulse the matching division tab
        this._pulseDivisionTab(slot.dataset.division);

        // Update spotlight on every step
        const eid = slot.dataset.employeeId;
        const badge = this._allBadges.find(b => b.employeeId === eid);
        if (badge) this._updateSpotlight(badge);
      }, delay);
      this._timeouts.push(tid);
    });

    // Final land — highlight slot, dim surroundings around spotlight, add SELECTED
    const landTid = setTimeout(() => {
      this._container.querySelectorAll('.arcade-slot.cursor-active').forEach(s => s.classList.remove('cursor-active'));
      if (targetSlot) {
        targetSlot.classList.add('cursor-active');
        targetSlot.classList.add('highlighted');
        targetSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (window.ArcadeSFX) ArcadeSFX.play('selectConfirm');

        // Add SELECTED overlay on the slot
        const selLabel = document.createElement('div');
        selLabel.className = 'arcade-slot-result arcade-slot-selected-label';
        selLabel.textContent = 'SELECTED';
        targetSlot.appendChild(selLabel);
      }

      // Update spotlight with landed badge + add SELECTED state
      this._updateSpotlight(targetBadge);
      const spot = this._container.querySelector('.arcade-spotlight');
      if (spot) {
        spot.classList.add('selection-focus');
        // Add SELECTED text to spotlight
        const spotLabel = document.createElement('div');
        spotLabel.className = 'arcade-spotlight-selected-label';
        spotLabel.textContent = 'SELECTED';
        spot.appendChild(spotLabel);
      }

      this._setAnnouncer(`${targetBadge.name.toUpperCase()} ENTERS THE RING`);

      // Dramatic pause — let the selection breathe (2s) before fight begins
      const doneTid = setTimeout(() => {
        // Clean up selection state before VS overlay takes over
        if (spot) {
          spot.classList.remove('selection-focus');
          const spotSel = spot.querySelector('.arcade-spotlight-selected-label');
          if (spotSel) spotSel.remove();
        }
        const selEl = targetSlot?.querySelector('.arcade-slot-selected-label');
        if (selEl) selEl.remove();
        if (onLand) onLand();
      }, 2000);
      this._timeouts.push(doneTid);
    }, landTime);
    this._timeouts.push(landTid);
  },

  _pulseDivisionTab(division) {
    const tabs = this._container.querySelectorAll('.arcade-tab');
    tabs.forEach(t => {
      if (t.dataset.division === division) {
        const color = DIVISION_ACCENT_COLORS[division] || '#ffd700';
        t.style.setProperty('--pulse-color', color);
        t.classList.add('division-pulse');
      } else {
        t.classList.remove('division-pulse');
      }
    });
  },

  _updateSpotlight(badge) {
    const spot = this._spotlight;
    if (!spot) return;

    const div = getDivisionForDept(badge.department, badge.isBandMember);
    const color = DIVISION_ACCENT_COLORS[div] || '#ffd700';

    const photoWrap = spot.querySelector('.arcade-spotlight-photo-wrap');
    const nameEl = spot.querySelector('.arcade-spotlight-name');
    const titleEl = spot.querySelector('.arcade-spotlight-title');
    const deptEl = spot.querySelector('.arcade-spotlight-dept');

    // Update photo
    const existingImg = photoWrap.querySelector('.arcade-spotlight-photo');
    const silhouette = photoWrap.querySelector('.arcade-spotlight-silhouette');

    if (existingImg) existingImg.remove();

    const img = document.createElement('img');
    img.className = 'arcade-spotlight-photo';
    // Band members use SNES pixel art portraits
    img.src = (badge.isBandMember && this._BOSS_PORTRAITS[badge.employeeId])
      ? this._BOSS_PORTRAITS[badge.employeeId]
      : `/api/badge/${esc(badge.employeeId)}/headshot`;
    img.alt = badge.name;
    img.onerror = () => { img.style.display = 'none'; if (silhouette) silhouette.style.display = 'flex'; };
    img.onload = () => { if (silhouette) silhouette.style.display = 'none'; };
    photoWrap.insertBefore(img, silhouette);

    // Update info
    nameEl.textContent = badge.name.toUpperCase();
    nameEl.style.color = color;
    titleEl.textContent = badge.title || '';
    if (deptEl) deptEl.textContent = badge.department || '';

    // Border color
    spot.style.setProperty('--spotlight-color', color);
    spot.classList.add('active');
  },

  _displayRotationBadge(badge) {
    // Cursor selection always runs — it's core UX, not decoration
    this._isVSActive = true;
    this._animateCursorSelect(badge, () => {
      this._isVSActive = false;
    });
  },

  // ─── Roster Swap Logic ──────────────────────────────────────

  _markFought(employeeId) {
    const rs = this._rosterSlots.find(r => r.badge.employeeId === employeeId);
    if (rs) rs.foughtAt = this._rotationTick;
  },

  _postFightSwap() {
    if (this._rosterPool.length === 0) return;

    // Find roster members eligible for swap (fought ROSTER_COOLDOWN+ ticks ago)
    const swappable = this._rosterSlots.filter(rs =>
      rs.foughtAt !== null && (this._rotationTick - rs.foughtAt) >= ROSTER_COOLDOWN
    );

    // Sort by oldest fought first
    swappable.sort((a, b) => (a.foughtAt || 0) - (b.foughtAt || 0));

    // Swap one per fight cycle to keep it gradual
    if (swappable.length > 0 && this._rosterPool.length > 0) {
      this._swapRosterSlot(swappable[0]);
    }
  },

  _swapRosterSlot(rosterSlot) {
    const oldBadge = rosterSlot.badge;
    const newBadge = this._rosterPool.shift();
    if (!newBadge) return;

    // Remove old slot from DOM
    const oldSlotEl = this._container.querySelector(`[data-employee-id="${oldBadge.employeeId}"]`);
    if (oldSlotEl) {
      oldSlotEl.classList.add('slot-swap-out');
      setTimeout(() => {
        oldSlotEl.remove();
        // Add new slot
        const newSlotEl = this._createSlot(newBadge);
        newSlotEl.classList.add('slot-swap-in');
        this._gridPanel.appendChild(newSlotEl);
        this._autoSizeGrid();
        setTimeout(() => newSlotEl.classList.remove('slot-swap-in'), 500);
      }, 300);
    }

    // Update roster state
    rosterSlot.badge = newBadge;
    rosterSlot.foughtAt = null;

    // Old badge goes back to pool (can re-enter later)
    this._rosterPool.push(oldBadge);
  },

  _forceSwapForSSE(newBadge) {
    // Priority eviction: fought badges first (oldest), then unfought (oldest in roster)
    const fought = this._rosterSlots
      .filter(rs => rs.foughtAt !== null)
      .sort((a, b) => (a.foughtAt || 0) - (b.foughtAt || 0));

    const target = fought.length > 0 ? fought[0] : this._rosterSlots[0];
    if (!target) return;

    // Direct swap — no pool recycling for the evicted badge (it goes to pool)
    const oldBadge = target.badge;
    const oldSlotEl = this._container.querySelector(`[data-employee-id="${oldBadge.employeeId}"]`);
    if (oldSlotEl) oldSlotEl.remove();

    target.badge = newBadge;
    target.foughtAt = null;
    this._rosterPool.push(oldBadge);
  },

  _showVSMatchup() {
    // Rebuild fight queue if exhausted
    if (this._rotationIndex >= this._shuffledBadges.length) {
      const unfought = this._rosterSlots.filter(rs => rs.foughtAt === null).map(rs => rs.badge);
      if (unfought.length > 0) {
        this._shuffledBadges = hdShuffle(unfought);
      } else {
        // Everyone fought — pick oldest-fought for rematches
        this._shuffledBadges = this._rosterSlots
          .slice().sort((a, b) => (a.foughtAt || 0) - (b.foughtAt || 0))
          .map(rs => rs.badge);
      }
      this._rotationIndex = 0;
      this._clearFightResults();
    }
    const currentBadge = this._shuffledBadges[this._rotationIndex];
    if (!currentBadge) return;

    const div = getDivisionForDept(currentBadge.department, currentBadge.isBandMember);

    if (!animationsEnabled()) {
      // FX off: just update spotlight and highlight slot, no cursor/VS animation
      this._updateSpotlight(currentBadge);
      this._pulseDivisionTab(div);
      const slot = this._container.querySelector(`[data-employee-id="${currentBadge.employeeId}"]`);
      if (slot) {
        this._container.querySelectorAll('.arcade-slot.cursor-active').forEach(s => s.classList.remove('cursor-active'));
        this._container.querySelectorAll('.arcade-slot.highlighted').forEach(s => s.classList.remove('highlighted'));
        slot.classList.add('highlighted');
        slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      this._setAnnouncer(`${currentBadge.name.toUpperCase()} ENTERS THE RING`);
      return;
    }

    // Stop interval timer — breather chain owns the loop from here
    this._stopRotation();

    // Run cursor animation, then fire VS when it lands
    this._isVSActive = true;
    this._setAnnouncer('SELECTING FIGHTER...');
    this._animateCursorSelect(currentBadge, () => {
      this._animateVS(currentBadge, div).then(() => {
        this._isVSActive = false;
        // Blinking INSERT COIN style text during breather — immediately visible
        this._setAnnouncer('WELCOME TO THE CORPORATE ARENA', { blink: true, large: true });

        // Mark fighter as fought + run roster swap logic
        this._markFought(currentBadge.employeeId);
        this._rotationTick++;
        this._postFightSwap();

        // Chain next matchup directly — breather owns the loop, no interval dependency
        const breatherId = setTimeout(() => {
          if (this._locked || this._isArrivalActive || this._isVSActive) return;
          this._setAnnouncer('', { blink: false, large: false });
          this._rotationIndex++;
          this._showVSMatchup();
        }, 4000);
        this._timeouts.push(breatherId);
      });
    });
  },

  // ─── VS Cinematic (see arcade-cinematic.js) ────────────────
  // Methods mixed in: _pickOpponent, _determineWinner, _createBeat,
  // _animateVS, _animateFight, _typewriterEffect, _spawnFireworks,
  // _spawnConfetti, _highlightWinnerBadge, boss specials, announcer lines

  // ─── addBadge (SSE live hire) — interrupts rotation ───────

  async addBadge(badge) {
    if (this._isArrivalActive) {
      this._arrivalQueue.push(badge);
      return;
    }

    const existingSlot = this._container.querySelector(`[data-employee-id="${badge.employeeId}"]`);
    if (existingSlot) {
      existingSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
      existingSlot.classList.add('pulse');
      setTimeout(() => existingSlot.classList.remove('pulse'), 2000);
      return;
    }

    this._isArrivalActive = true;
    this._stopRotation();
    this._setAnnouncer('A NEW CONTENDER HAS ARRIVED!');

    if (badge.isBandMember) {
      this._bossBadges.push(badge);
      // Boss — no roster slot needed, just resume
      this._isArrivalActive = false;
      if (this._arrivalQueue.length > 0) {
        const next = this._arrivalQueue.shift();
        this.addBadge(next);
      } else {
        this._resumeRotation();
      }
      return;
    }

    this._allBadges.push(badge);

    // Force-swap into roster (evicts oldest fought badge)
    if (this._rosterSlots.length >= ROSTER_SIZE) {
      this._forceSwapForSSE(badge);
    } else {
      this._rosterSlots.push({ badge, foughtAt: null });
    }

    const div = getDivisionForDept(badge.department, badge.isBandMember);
    const slot = this._createSlot(badge);

    const target = this._gridPanel;
    if (!target) return;

    if (this._activeTab !== 'ALL' && div !== this._activeTab) {
      slot.classList.add('slot-hidden');
    }

    if (animationsEnabled()) {
      await this._animateProvision(slot, badge, this._getDivisionInsertTarget(div), div);
      await this._animateVS(badge, div, true);
    } else {
      this._getDivisionInsertTarget(div).appendChild(slot);
    }

    // Mark as fought (they just had their VS intro fight)
    this._markFought(badge.employeeId);
    this._rotationTick++;

    slot.classList.add('new');
    this._autoSizeGrid();

    this._isArrivalActive = false;
    if (this._arrivalQueue.length > 0) {
      const next = this._arrivalQueue.shift();
      this.addBadge(next);
    } else {
      this._resumeRotation();
    }
  },

  // Find the grid container for inserting a badge into its division section
  _getDivisionInsertTarget(div) {
    // Just return the grid — badge appends at end. Division grouping is initial layout only.
    // SSE additions are rare and will appear at the bottom (the provisioning animation draws attention).
    return this._gridPanel;
  },

  // ─── Provisioning Unlock Sequence ─────────────────────────

  _animateProvision(slot, badge, target, div) {
    return new Promise(resolve => {
      const color = DIVISION_ACCENT_COLORS[div] || '#ffd700';

      slot.classList.add('provisioning');
      const photoWrap = slot.querySelector('.arcade-slot-photo-wrap');
      const img = slot.querySelector('.arcade-slot-photo');
      const silhouette = slot.querySelector('.arcade-slot-silhouette');

      if (img) img.style.display = 'none';
      if (silhouette) {
        silhouette.style.display = 'flex';
        silhouette.textContent = '?';
      }

      const overlay = document.createElement('div');
      overlay.className = 'arcade-provision-overlay';
      overlay.innerHTML = `
        <div class="arcade-provision-text">PROVISIONING...</div>
        <div class="arcade-provision-bar"><div class="arcade-provision-fill"></div></div>
      `;
      slot.appendChild(overlay);

      target.appendChild(slot);

      const fill = overlay.querySelector('.arcade-provision-fill');

      fill.style.transition = 'width 1s linear';
      requestAnimationFrame(() => {
        fill.style.width = '99%';
      });

      const t1 = setTimeout(() => {
        overlay.querySelector('.arcade-provision-text').textContent = 'VERIFYING CREDENTIALS...';
      }, 1000);
      this._timeouts.push(t1);

      const t2 = setTimeout(() => {
        fill.style.transition = 'width 0.2s linear';
        fill.style.width = '100%';
        overlay.querySelector('.arcade-provision-text').textContent = 'APPROVED';
        overlay.querySelector('.arcade-provision-text').style.color = '#00ff41';
      }, 1500);
      this._timeouts.push(t2);

      const t3 = setTimeout(() => {
        if (img) {
          img.style.display = '';
          img.style.filter = 'grayscale(100%)';
          img.style.transition = 'filter 0.8s ease';
          requestAnimationFrame(() => {
            img.style.filter = 'grayscale(0%)';
          });
        }
        if (silhouette) silhouette.style.display = 'none';

        slot.classList.remove('provisioning');
        overlay.remove();
      }, 2000);
      this._timeouts.push(t3);

      const t4 = setTimeout(() => {
        const activatedOverlay = document.createElement('div');
        activatedOverlay.className = 'arcade-activated-overlay';
        activatedOverlay.textContent = 'EMPLOYEE ACTIVATED';
        slot.appendChild(activatedOverlay);

        const t5 = setTimeout(() => {
          activatedOverlay.style.transition = 'opacity 0.5s';
          activatedOverlay.style.opacity = '0';
          const t6 = setTimeout(() => activatedOverlay.remove(), 500);
          this._timeouts.push(t6);
        }, 800);
        this._timeouts.push(t5);

        this._setAnnouncer(`${badge.name.toUpperCase()} HAS BEEN ACTIVATED`);
      }, 2200);
      this._timeouts.push(t4);

      const t7 = setTimeout(resolve, 3200);
      this._timeouts.push(t7);
    });
  },

  // ─── Destroy ───────────────────────────────────────────────

  updateBadge(badge) {
    // Update in-memory badge data
    const idx = this._allBadges.findIndex(b => b.employeeId === badge.employeeId);
    if (idx >= 0) {
      Object.keys(badge).forEach(k => { if (badge[k] !== undefined) this._allBadges[idx][k] = badge[k]; });
    }
    // Update slot name label
    const slot = this._container?.querySelector(`[data-employee-id="${badge.employeeId}"]`);
    if (slot) {
      const nameEl = slot.querySelector('.arcade-slot-name');
      if (nameEl) nameEl.textContent = badge.name;
      // Cache-bust headshot
      const img = slot.querySelector('img');
      if (img) img.src = `/api/badge/${badge.employeeId}/headshot?t=${Date.now()}`;
    }
  },

  destroy() {
    this._intervals.forEach(id => clearInterval(id));
    this._intervals = [];

    this._timeouts.forEach(id => clearTimeout(id));
    this._timeouts = [];

    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }

    if (this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      this._onVisibilityChange = null;
    }

    if (this._container) {
      this._container.innerHTML = '';
    }

    this._container = null;
    this._stats = null;
    this._allBadges = [];
    this._bossBadges = [];
    this._rosterSlots = [];
    this._rosterPool = [];
    this._selectedBadge = null;
    this._locked = false;
    this._gridPanel = null;
    this._announcer = null;
    this._spotlight = null;
    this._activeTab = 'ALL';
    this._rotationTimer = null;
    this._shuffledBadges = [];
    this._rotationIndex = 0;
    this._isArrivalActive = false;
    this._arrivalQueue = [];
    this._rotationTick = 0;
    this._bgIndex = 0;
    this._isVSActive = false;
  },
};
