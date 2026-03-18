// ─── Arcade Renderer (Select Screen View) ────────────────
// Implements the renderer interface: { init, addBadge, destroy }
// Fighting-game character select screen for the employee directory.
// VS animation is the main presentation focus — Punch-Out inspired choreography.

window.ArcadeRenderer = {
  _container: null,
  _stats: null,
  _allBadges: [],
  _bossBadges: [],
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
    'THE PTO REQUEST HAS BEEN DENIED',
    'SYNERGY LEVELS CRITICAL',
    'PLEASE HOLD FOR THE NEXT COMBATANT',
    'WE GOT A RED ALERT',
  ],

  // Boss creatures for VS battles — "Corporate Dread" illustrated art
  _CREATURES: [
    { name: 'The Phantom Printer', tagline: 'PC LOAD LETTER.', move: 'PAPER JAM OF DOOM', imageUrl: '/images/arcade/phantom-printer.png' },
    { name: 'The Network Wizard', tagline: "It's always DNS.", move: 'PACKET STORM', imageUrl: '/images/arcade/network-wizard.png' },
    { name: 'Watercooler Will', tagline: 'Oh hey, quick question...', move: 'ENDLESS ANECDOTE', imageUrl: '/images/arcade/watercooler-will.png' },
    { name: 'HR Nancy', tagline: 'Just a quick mandatory training.', move: 'COMPLIANCE LOCKDOWN', imageUrl: '/images/arcade/hr-nancy.png' },
    { name: 'The Dirty Microwave', tagline: 'WHO LEFT FISH IN HERE?!', move: 'HAZMAT EXPLOSION', imageUrl: '/images/arcade/dirty-microwave.png' },
    { name: 'The MFA Guardian', tagline: 'Enter your code. 3 seconds.', move: 'CODE SWITCH', imageUrl: '/images/arcade/mfa-guardian.png' },
    { name: 'The Consultant', tagline: "Twice the pay. Half the work.", move: 'BUDGET SLASH', imageUrl: '/images/arcade/the-consultant.png' },
  ],

  // Intern opponents
  _INTERNS: [
    { name: 'THE INTERN', className: 'Unpaid Intern', tagline: "I'm just happy to be here.", move: 'UNPAID OVERTIME', imageUrl: '/images/arcade/unpaid-intern.png' },
    { name: 'THE INTERN', className: 'Asst. Regional Manager', tagline: "That's my title.", move: 'DELEGATION', imageUrl: '/images/arcade/assistant-regional-manager.png' },
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
    'HD-00003': 'PERCUSSIVE MAINTENANCE',
    'HD-00004': 'POWER SURGE',
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
    'HD-00002': [ // Drew — Chief Audio Architect
      "You're about to get feedback.",
      "I don't like your tone.",
      "This mix needs more pain.",
    ],
    'HD-00003': [ // Henry — Chief Impact Officer
      "I hit things for a living.",
      "Brace for impact.",
      "That's gonna leave a mark.",
    ],
    'HD-00004': [ // Todd — VP of Power Distribution
      "I control the power here.",
      "Your access has been revoked.",
      "Lights out.",
    ],
    'HD-00005': [ // Adam — VP of Bottom Line Operations
      "The bottom line is you lose.",
      "This is non-negotiable.",
      "Check the budget. You're cut.",
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
    'DEMOTED TO INTERN STATUS',
    'SENT TO GET EVERYONE COFFEE',
    'TRANSFERRED TO NIGHT SHIFT',
    'NOW ON UNPTO',
    'FRIDAY JEANS ACCESS REVOKED',
    'ADDED TO THE PIP',
    'PARKING SPOT REASSIGNED',
    'WELCOME TO YOUR EXIT INTERVIEW',
    'INSTALLING 1 OF 1000 UPDATES',
    "YOU CAN'T QUIT, YOU'RE FIRED",
  ],

  // Stage backgrounds for VS overlay only
  _BACKGROUNDS: ['server-room', 'break-room', 'network-closet', 'front-entrance', 'meeting-room', 'cubicle-farm'],

  // Creature/boss → preferred background mapping
  _CREATURE_BACKGROUNDS: {
    'The Dirty Microwave': 'break-room',
    'The Network Wizard': 'network-closet',
    'The Phantom Printer': 'cubicle-farm',
    'Watercooler Will': 'break-room',
    'HR Nancy': 'meeting-room',
    'The MFA Guardian': 'server-room',
    'The Consultant': 'meeting-room',
    'THE INTERN': 'cubicle-farm',
  },

  // Boss band member → preferred background mapping
  _BOSS_BACKGROUNDS: {
    'HD-00001': 'server-room',      // Luke — server room
    'HD-00002': 'meeting-room',     // Drew — meeting room
    'HD-00003': 'cubicle-farm',     // Henry — cubicle farm
    'HD-00004': 'network-closet',   // Todd — network closet
    'HD-00005': 'server-room',      // Adam — server room
  },

  async init(container, stats) {
    this._container = container;
    this._stats = stats;
    this._allBadges = [];
    this._bossBadges = [];
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

    // Start rotation
    this._startRotation();
  },

  async _fetchAllBadges() {
    const badges = await BadgePool.fetchAll({ limit: 100 });
    // Band members are bosses only — they appear as opponents, not as rotating fighters
    this._allBadges = badges.filter(b => !b.isBandMember);
    badges.forEach(b => {
      if (b.isBandMember) this._bossBadges.push(b);
    });
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

    // Show/hide slots
    const slots = this._container.querySelectorAll('.arcade-slot');
    slots.forEach(slot => {
      if (division === 'ALL') {
        slot.style.display = '';
      } else {
        slot.style.display = slot.dataset.division === division ? '' : 'none';
      }
    });

    // (Division headers removed — tabs handle filtering)
  },

  _populateGrid() {
    const grid = this._gridPanel;
    if (!grid) return;

    // API already returns bosses first, then newest — use that order
    this._allBadges.forEach(badge => {
      const slot = this._createSlot(badge);
      grid.appendChild(slot);
    });

    // Auto-size slots to fill available space with multiple rows
    this._autoSizeGrid();
  },

  _autoSizeGrid() {
    const grid = this._gridPanel;
    const roster = this._container.querySelector('.arcade-roster');
    if (!grid || !roster) return;

    const badgeCount = this._allBadges.length;
    if (badgeCount === 0) return;

    // Available space
    const rosterWidth = roster.clientWidth - 32; // padding
    const rosterHeight = roster.clientHeight - 24;
    const gap = 4;

    // Start large and shrink based on badge count
    // Few badges = big portraits filling the grid, many = compact
    const minW = 44, minH = 54;
    const maxW = 120, maxH = 146;

    let bestW = maxW, bestH = maxH;

    for (let w = maxW; w >= minW; w -= 4) {
      const h = Math.round(w * (146 / 120)); // maintain aspect ratio
      const cols = Math.floor((rosterWidth + gap) / (w + gap));
      if (cols <= 0) continue;
      const rows = Math.ceil(badgeCount / cols);
      const totalHeight = rows * (h + gap) - gap;

      // Accept this size if it fits within available height (with some overflow allowed)
      if (totalHeight <= rosterHeight * 1.3) {
        bestW = w;
        bestH = h;
        break; // Take the largest size that fits
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
      const slots = [...this._container.querySelectorAll('.arcade-slot:not([style*="display: none"])')];
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
    if (this._allBadges.length === 0) return;
    this._shuffledBadges = hdShuffle(this._allBadges);
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

  _stopRotation() {
    if (this._rotationTimer) {
      clearInterval(this._rotationTimer);
      this._intervals = this._intervals.filter(id => id !== this._rotationTimer);
      this._rotationTimer = null;
    }
  },

  _resumeRotation() {
    this._stopRotation();
    const interval = animationsEnabled() ? 18000 : 3000;
    this._rotationTimer = setInterval(() => {
      if (this._isArrivalActive || this._locked || this._isVSActive) return;
      this._rotationTick++;
      this._rotationIndex++;

      if (this._rotationIndex >= this._shuffledBadges.length) {
        this._shuffledBadges = hdShuffle(this._allBadges);
        this._rotationIndex = 0;
      }

      this._showVSMatchup();
    }, interval);
    this._intervals.push(this._rotationTimer);
  },

  // ─── Cursor Selection Animation (~7s, progressive deceleration) ──────────────

  _animateCursorSelect(targetBadge, onLand) {
    const visibleSlots = [...this._container.querySelectorAll('.arcade-slot:not([style*="display: none"])')];
    if (visibleSlots.length === 0) {
      if (onLand) onLand();
      return;
    }

    // Clear any existing cursor highlights
    this._container.querySelectorAll('.arcade-slot.cursor-active').forEach(s => s.classList.remove('cursor-active'));
    this._container.querySelectorAll('.arcade-slot.highlighted').forEach(s => s.classList.remove('highlighted'));

    this._setAnnouncer('SELECTING FIGHTER...');

    // Build deceleration schedule: ~6.5s total (smooth deceleration, snappy finish)
    const steps = [];
    let t = 0;

    // Phase 1: rapid cycling (100ms intervals, 10 steps = 1.0s)
    for (let i = 0; i < 10; i++) { steps.push(t); t += 100; }
    // Phase 2: fast (150ms intervals, 8 steps = 1.2s)
    for (let i = 0; i < 8; i++) { steps.push(t); t += 150; }
    // Phase 3: easing (250ms intervals, 4 steps = 1.0s)
    for (let i = 0; i < 4; i++) { steps.push(t); t += 250; }
    // Phase 4: slowing (375ms intervals, 3 steps = 1.125s)
    for (let i = 0; i < 3; i++) { steps.push(t); t += 375; }
    // Phase 5: heavy (450ms intervals, 2 steps = 0.9s)
    for (let i = 0; i < 2; i++) { steps.push(t); t += 450; }
    // Phase 6: landing (525ms intervals, 2 steps = 1.05s)
    for (let i = 0; i < 2; i++) { steps.push(t); t += 525; }
    // Final land
    const landTime = t + 500;

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

        // Tick pulse on announcer bar
        if (this._announcer) {
          this._announcer.classList.remove('tick-pulse');
          void this._announcer.offsetWidth; // force reflow to restart animation
          this._announcer.classList.add('tick-pulse');
        }

        // Pulse the matching division tab
        this._pulseDivisionTab(slot.dataset.division);

        // Update spotlight during slow/crawl phases (last 10 steps)
        if (idx >= totalSteps - 10) {
          const eid = slot.dataset.employeeId;
          const badge = this._allBadges.find(b => b.employeeId === eid);
          if (badge) this._updateSpotlight(badge);
        }
      }, delay);
      this._timeouts.push(tid);
    });

    // Final land on target
    const landTid = setTimeout(() => {
      this._container.querySelectorAll('.arcade-slot.cursor-active').forEach(s => s.classList.remove('cursor-active'));
      if (targetSlot) {
        targetSlot.classList.add('cursor-active');
        targetSlot.classList.add('highlighted');
        targetSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      // Update spotlight with landed badge
      this._updateSpotlight(targetBadge);

      this._setAnnouncer(`${targetBadge.name.toUpperCase()} ENTERS THE RING`);

      const doneTid = setTimeout(() => {
        if (onLand) onLand();
      }, 400);
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
    if (!animationsEnabled()) {
      // FX off: just update spotlight, no cursor animation
      this._updateSpotlight(badge);
      const div = getDivisionForDept(badge.department, badge.isBandMember);
      this._pulseDivisionTab(div);
      this._highlightSlot(this._container.querySelector(`[data-employee-id="${badge.employeeId}"]`));
      return;
    }
    this._isVSActive = true;
    this._animateCursorSelect(badge, () => {
      this._isVSActive = false;
    });
  },

  _showVSMatchup() {
    if (this._rotationIndex >= this._shuffledBadges.length) {
      this._shuffledBadges = hdShuffle(this._allBadges);
      this._rotationIndex = 0;
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

        // Chain next matchup directly — breather owns the loop, no interval dependency
        const breatherId = setTimeout(() => {
          if (this._locked || this._isArrivalActive || this._isVSActive) return;
          this._setAnnouncer('', { blink: false, large: false });
          this._rotationIndex++;
          if (this._rotationIndex >= this._shuffledBadges.length) {
            this._shuffledBadges = hdShuffle(this._allBadges);
            this._rotationIndex = 0;
          }
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
    } else {
      this._allBadges.push(badge);
    }
    this._shuffledBadges = hdShuffle(this._allBadges);

    const div = getDivisionForDept(badge.department, badge.isBandMember);
    const slot = this._createSlot(badge);

    const target = this._gridPanel;
    if (!target) return;

    if (this._activeTab !== 'ALL' && div !== this._activeTab) {
      slot.style.display = 'none';
    }

    if (animationsEnabled()) {
      await this._animateProvision(slot, badge, this._getDivisionInsertTarget(div), div);
      await this._animateVS(badge, div, true);
    } else {
      this._getDivisionInsertTarget(div).appendChild(slot);
    }

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

  destroy() {
    this._intervals.forEach(id => clearInterval(id));
    this._intervals = [];

    this._timeouts.forEach(id => clearTimeout(id));
    this._timeouts = [];

    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }

    if (this._container) {
      this._container.innerHTML = '';
    }

    this._container = null;
    this._stats = null;
    this._allBadges = [];
    this._bossBadges = [];
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
