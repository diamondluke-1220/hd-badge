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

  // Division accent colors
  _DIV_COLORS: {
    '_exec': '#ffffff',
    'IT': '#00d4ff',
    'Office': '#ff3366',
    'Corporate': '#ff6b35',
    'Punk': '#00ff41',
    '_custom': '#ffd700',
  },

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
  ],

  // Boss creatures for VS battles — "Corporate Dread" illustrated art
  _CREATURES: [
    { name: 'The Phantom Printer', tagline: 'PC LOAD LETTER.', move: 'PAPER JAM OF DOOM', imageUrl: '/images/arcade/phantom-printer.png' },
    { name: 'The Network Wizard', tagline: 'Wireless or Wired?', move: 'PACKET STORM', imageUrl: '/images/arcade/network-wizard.png' },
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

  // Boss trash-talk lines
  _BOSS_TAGLINES: [
    "You're not even on the org chart.",
    "I approve your termination.",
    "Check your email. HR meeting.",
    "Your badge has been deactivated.",
    "I own this department.",
    "My calendar says you're fired.",
    "Welcome to your exit interview.",
  ],

  // Employee defeat lines (when boss/creature wins)
  _EMPLOYEE_DEFEAT_LINES: [
    'SENT TO SENSITIVITY TRAINING',
    'BADGE ACCESS REVOKED',
    'REASSIGNED TO THE BASEMENT',
    'MANDATORY OVERTIME ACTIVATED',
    'MOVED TO AN OPEN FLOOR PLAN',
    'DEMOTED TO INTERN STATUS',
    'PERFORMANCE REVIEW: UNSATISFACTORY',
    'TRANSFERRED TO NIGHT SHIFT',
  ],

  // Stage backgrounds for VS overlay only
  _BACKGROUNDS: ['server-room', 'break-room', 'network-closet', 'front-entrance', 'meeting-room', 'cubicle-farm'],

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

    // Set ticker globals
    window._tickerTotalHires = stats.visible || 0;
    if (stats.byDepartment) {
      window._tickerStats = Object.assign({}, stats.byDepartment);
    }
    initDonut(stats);

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
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      try {
        const resp = await fetch(`/api/orgchart?page=${page}&limit=100`);
        const data = await resp.json();
        if (data.badges && data.badges.length > 0) {
          this._allBadges = this._allBadges.concat(data.badges);
          data.badges.forEach(b => {
            if (b.isBandMember) this._bossBadges.push(b);
          });
        }
        hasMore = page < (data.pages || 1);
        page++;
      } catch {
        hasMore = false;
      }
    }
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
      btn.style.setProperty('--tab-color', this._DIV_COLORS[div.theme] || '#ffd700');
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

    // Target: fill the space with multiple rows
    // Start at max size and shrink until we get good coverage
    const minW = 56, minH = 68;  // current minimum
    const maxW = 80, maxH = 96;  // max slot size

    let bestW = minW, bestH = minH;

    for (let w = maxW; w >= minW; w -= 4) {
      const h = Math.round(w * (68 / 56)); // maintain aspect ratio
      const cols = Math.floor((rosterWidth + gap) / (w + gap));
      const rows = Math.ceil(badgeCount / cols);
      const totalHeight = rows * (h + gap) - gap;

      if (cols > 0 && totalHeight <= rosterHeight * 1.2) {
        bestW = w;
        bestH = h;
        // Prefer more rows over fewer — keep going unless we're getting too small
        if (rows >= 2) break;
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

    const color = this._DIV_COLORS[div] || '#ffd700';
    slot.style.setProperty('--slot-color', color);

    slot.innerHTML = `
      <div class="arcade-slot-photo-wrap">
        <img class="arcade-slot-photo" src="/api/badge/${esc(badge.employeeId)}/headshot"
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

  _setAnnouncer(text) {
    if (this._announcer) {
      this._announcer.textContent = text;
    }
  },

  // ─── Rotation System ───────────────────────────────────────

  _shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  _startRotation() {
    if (this._allBadges.length === 0) return;
    this._shuffledBadges = this._shuffle(this._allBadges);
    this._rotationIndex = 0;
    this._rotationTick = 0;

    // Start with cursor select on first badge
    this._displayRotationBadge(this._shuffledBadges[0]);

    // FX on: ~32s (cursor 7s + VS 25s). FX off: 3s quick cycling.
    const interval = animationsEnabled() ? 32000 : 3000;
    this._rotationTimer = setInterval(() => {
      if (this._isArrivalActive || this._locked || this._isVSActive) return;
      this._rotationTick++;
      this._rotationIndex++;

      if (this._rotationIndex >= this._shuffledBadges.length) {
        this._shuffledBadges = this._shuffle(this._allBadges);
        this._rotationIndex = 0;
      }

      this._showVSMatchup();
    }, interval);
    this._intervals.push(this._rotationTimer);
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
        this._shuffledBadges = this._shuffle(this._allBadges);
        this._rotationIndex = 0;
      }

      this._showVSMatchup();
    }, interval);
    this._intervals.push(this._rotationTimer);
  },

  // ─── Cursor Selection Animation (6-8s, slowed) ──────────────

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

    // Build deceleration schedule: ~6.8s total
    const steps = [];
    let t = 0;

    // Phase 1: fast cycling (100ms intervals, 10 steps = 1s)
    for (let i = 0; i < 10; i++) { steps.push(t); t += 100; }
    // Phase 2: medium (180ms intervals, 8 steps = 1.44s)
    for (let i = 0; i < 8; i++) { steps.push(t); t += 180; }
    // Phase 3: slowing (300ms intervals, 6 steps = 1.8s)
    for (let i = 0; i < 6; i++) { steps.push(t); t += 300; }
    // Phase 4: crawling (500ms intervals, 4 steps = 2s)
    for (let i = 0; i < 4; i++) { steps.push(t); t += 500; }
    // Final land
    const landTime = t + 600;

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
        const color = this._DIV_COLORS[division] || '#ffd700';
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
    const color = this._DIV_COLORS[div] || '#ffd700';

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
    img.src = `/api/badge/${esc(badge.employeeId)}/headshot`;
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
      this._shuffledBadges = this._shuffle(this._allBadges);
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

    // Run cursor animation, then fire VS when it lands
    this._isVSActive = true;
    this._setAnnouncer('SELECTING FIGHTER...');
    this._animateCursorSelect(currentBadge, () => {
      this._animateVS(currentBadge, div).then(() => {
        this._isVSActive = false;
        this._setAnnouncer(this._ANNOUNCER_LINES[Math.floor(Math.random() * this._ANNOUNCER_LINES.length)]);
      });
    });
  },

  // ─── Pick Opponent ──────────────────────────────────────────

  _pickOpponent() {
    const roll = Math.random();

    if (roll < 0.4 && this._bossBadges.length > 0) {
      const boss = this._bossBadges[Math.floor(Math.random() * this._bossBadges.length)];
      // Use SNES pixel art portrait, with headshot API as fallback on 404
      const snesPortrait = this._BOSS_PORTRAITS[boss.employeeId];
      const fallbackUrl = `/api/badge/${boss.employeeId}/headshot`;
      return {
        type: 'boss',
        name: boss.name,
        photoUrl: snesPortrait || fallbackUrl,
        fallbackPhotoUrl: snesPortrait ? fallbackUrl : null,
        className: boss.title || 'BOSS',
        tagline: this._BOSS_TAGLINES[Math.floor(Math.random() * this._BOSS_TAGLINES.length)],
        move: this._BOSS_MOVES[boss.employeeId] || 'EXECUTIVE ORDER',
      };
    } else if (roll < 0.75) {
      const creature = this._CREATURES[Math.floor(Math.random() * this._CREATURES.length)];
      return {
        type: 'creature',
        name: creature.name,
        imageUrl: creature.imageUrl,
        className: 'CORPORATE DREAD',
        tagline: creature.tagline,
        move: creature.move,
      };
    } else {
      const intern = this._INTERNS[Math.floor(Math.random() * this._INTERNS.length)];
      return {
        type: 'intern',
        name: intern.name,
        imageUrl: intern.imageUrl,
        className: intern.className,
        tagline: intern.tagline,
        move: intern.move,
      };
    }
  },

  // ─── Determine Winner ───────────────────────────────────────

  _determineWinner(opponent) {
    // Interns always lose
    if (opponent.type === 'intern') return 'employee';
    // Bosses and creatures: 50/50
    return Math.random() < 0.5 ? 'employee' : 'opponent';
  },

  // ─── VS Screen — Full Cinematic Sequence (~25s) ────────────

  _animateVS(badge, div, isNewHire) {
    return new Promise(resolve => {
      const opponent = this._pickOpponent();
      const winner = this._determineWinner(opponent);

      const employeeColor = this._DIV_COLORS[div] || '#ffd700';
      const opponentColor = opponent.type === 'creature' ? '#ff0040' : opponent.type === 'intern' ? '#888' : '#D4A843';
      const bgName = this._BACKGROUNDS[this._bgIndex];
      this._bgIndex = (this._bgIndex + 1) % this._BACKGROUNDS.length;

      // Employee portrait src
      const empSrc = `/api/badge/${esc(badge.employeeId)}/headshot`;
      // Opponent portrait src + fallback for SNES portraits that don't exist yet
      const oppSrc = opponent.type === 'boss' ? esc(opponent.photoUrl) : esc(opponent.imageUrl);
      const oppFallback = opponent.fallbackPhotoUrl ? esc(opponent.fallbackPhotoUrl) : null;

      // Quote — opponent tagline (capped for typewriter timing)
      const quote = (opponent.tagline || '').slice(0, 40);

      // Create VS overlay
      const overlay = document.createElement('div');
      overlay.className = 'arcade-vs-overlay';
      overlay.innerHTML = `
        <div class="arcade-vs-bg arcade-bg-${bgName}"></div>
        <div class="arcade-vs-bg-darken"></div>

        <div class="arcade-vs-slash"></div>

        <div class="arcade-vs-side arcade-vs-left" style="--side-color: ${employeeColor}">
          <div class="arcade-vs-portrait-wrap">
            <img class="arcade-vs-portrait" src="${empSrc}"
              alt="${esc(badge.name)}" onerror="this.style.display='none'">
            <div class="arcade-vs-hit-spark"></div>
          </div>
          <div class="arcade-vs-fighter-name">${esc(badge.name)}</div>
          <div class="arcade-vs-fighter-class">${esc(badge.title || '')}</div>
        </div>

        <div class="arcade-vs-center">
          <div class="arcade-vs-text">VS</div>
        </div>

        <div class="arcade-vs-side arcade-vs-right" style="--side-color: ${opponentColor}">
          <div class="arcade-vs-portrait-wrap">
            <img class="arcade-vs-portrait" src="${oppSrc}"
              alt="${esc(opponent.name)}" onerror="${oppFallback ? `this.onerror=function(){this.style.display='none'};this.src='${oppFallback}'` : `this.style.display='none'`}">
            <div class="arcade-vs-hit-spark"></div>
          </div>
          <div class="arcade-vs-fighter-name">${esc(opponent.name)}</div>
          <div class="arcade-vs-fighter-class">${opponent.move ? 'SPECIAL MOVE: ' + esc(opponent.move) : esc(opponent.className || '')}</div>
        </div>

        <div class="arcade-vs-quote-bubble" style="--bubble-color: ${opponentColor}"></div>

        <div class="arcade-vs-hp-container" style="display:none">
          <div class="arcade-vs-hp-bar arcade-vs-hp-left">
            <div class="arcade-vs-hp-label">${esc(badge.name)}</div>
            <div class="arcade-vs-hp-track"><div class="arcade-vs-hp-fill" style="--hp-color: ${employeeColor}"></div></div>
          </div>
          <div class="arcade-vs-hp-bar arcade-vs-hp-right">
            <div class="arcade-vs-hp-label">${esc(opponent.name)}</div>
            <div class="arcade-vs-hp-track"><div class="arcade-vs-hp-fill" style="--hp-color: ${opponentColor}"></div></div>
          </div>
        </div>

        <div class="arcade-vs-announcer">${esc(this._getVSAnnouncerLine(badge, opponent))}</div>
        <div class="arcade-vs-result" style="display:none"></div>
      `;

      this._container.querySelector('.arcade-container').appendChild(overlay);

      // New hire enhancements — spin-in, NEW banner, fireworks
      if (isNewHire) {
        overlay.classList.add('new-hire');

        // Add NEW banner to employee portrait
        const leftPortrait = overlay.querySelector('.arcade-vs-left .arcade-vs-portrait-wrap');
        if (leftPortrait) {
          const newBanner = document.createElement('div');
          newBanner.className = 'arcade-vs-new-badge';
          newBanner.textContent = 'NEW';
          leftPortrait.appendChild(newBanner);
        }
      }

      // Helper to update the overlay's own announcer (not the main page one)
      const vsAnnouncer = overlay.querySelector('.arcade-vs-announcer');
      const setVSAnnouncer = (text) => {
        if (vsAnnouncer) vsAnnouncer.textContent = text;
      };

      // Force reflow
      overlay.getBoundingClientRect();

      // ═══════════════════════════════════════════════════════════
      // TIMELINE — ~25s total
      //   0.0s  Beat 1:  BG reveal (bright)
      //   1.5s  Beat 1b: BG darkens
      //   3.0s  Beat 2:  Employee slides in
      //   5.0s  Beat 3:  Slash + VS slam
      //   7.0s  Beat 4:  Opponent slides in
      //   8.0s  Beat 4b: VS text fades
      //   9.0s  Beat 5:  Quote typewriter
      //  12.0s  Beat 6:  FIGHT!! flash
      //  12.5s  Beat 7:  Fight sequence (~7.5s)
      //  20.5s  Beat 8:  Winner reveal
      //  23.5s  Dissolve
      // ═══════════════════════════════════════════════════════════

      // ─── Beat 1 (0s): Background fades in BRIGHT ──────────────
      requestAnimationFrame(() => {
        overlay.classList.add('bg-reveal');
        setVSAnnouncer('A CHALLENGER APPROACHES...');
      });

      // ─── Beat 1b (1.5s): Background darkens ──────────────────
      const t0 = setTimeout(() => {
        overlay.classList.add('bg-darken');
      }, 1500);
      this._timeouts.push(t0);

      // ─── Beat 2 (3.0s): Employee slides in from left ─────────
      const t1 = setTimeout(() => {
        overlay.classList.add('left-enter');
        setVSAnnouncer(isNewHire
          ? `NEW HIRE ${badge.name.toUpperCase()} REPORTS FOR DUTY!`
          : `${badge.name.toUpperCase()} ENTERS THE RING`);

        // Fireworks burst for new hires after portrait lands
        if (isNewHire) {
          const fwTid = setTimeout(() => {
            this._spawnFireworks(overlay.querySelector('.arcade-vs-left .arcade-vs-portrait-wrap'));
          }, 900);
          this._timeouts.push(fwTid);
        }
      }, 3000);
      this._timeouts.push(t1);

      // ─── Beat 3 (5.0s): Slash wipe + VS text slam ────────────
      const t2 = setTimeout(() => {
        overlay.classList.add('slash-fire');
        const vsText = overlay.querySelector('.arcade-vs-text');
        if (vsText) vsText.classList.add('slam');
      }, 5000);
      this._timeouts.push(t2);

      // ─── Beat 4 (7.0s): Opponent slides in from right ────────
      const t3 = setTimeout(() => {
        overlay.classList.add('right-enter');
        setVSAnnouncer(`${opponent.name.toUpperCase()} APPEARS!`);
      }, 7000);
      this._timeouts.push(t3);

      // ─── Beat 4b (8.0s): VS text fades out ───────────────────
      const tVSHide = setTimeout(() => {
        const vsText = overlay.querySelector('.arcade-vs-text');
        if (vsText) {
          vsText.style.animation = 'none';
          vsText.style.transition = 'opacity 0.4s ease';
          vsText.style.opacity = '0';
        }
      }, 8000);
      this._timeouts.push(tVSHide);

      // ─── Beat 5 (9.0s): Typewriter quote bubble ──────────────
      const t5 = setTimeout(() => {
        const bubble = overlay.querySelector('.arcade-vs-quote-bubble');
        if (bubble && quote) {
          bubble.classList.add('visible');
          this._typewriterEffect(bubble, `"${quote}"`, 55);
        }
      }, 9000);
      this._timeouts.push(t5);

      // ─── Beat 6 (12.0s): FIGHT!! flash ───────────────────────
      const tFight = setTimeout(() => {
        const fightEl = document.createElement('div');
        fightEl.className = 'arcade-vs-fight-flash';
        fightEl.textContent = 'FIGHT!!';
        overlay.appendChild(fightEl);
        fightEl.getBoundingClientRect();
        fightEl.classList.add('active');
        setVSAnnouncer('FIGHT!');
        const fightRemove = setTimeout(() => fightEl.remove(), 1000);
        this._timeouts.push(fightRemove);
      }, 12000);
      this._timeouts.push(tFight);

      // ─── Beat 7 (12.5s): Fight — HP bars + extended combat ───
      const t6 = setTimeout(() => {
        // Fade out quote bubble before fight
        const bubble = overlay.querySelector('.arcade-vs-quote-bubble');
        if (bubble) {
          bubble.style.transition = 'opacity 0.3s ease';
          bubble.style.opacity = '0';
        }
        this._animateFight(overlay, winner, badge, opponent, employeeColor, opponentColor, setVSAnnouncer);
      }, 12500);
      this._timeouts.push(t6);

      // ─── Beat 8 (20.5s): Winner reveal ────────────────────────
      const t7 = setTimeout(() => {
        // Ensure quote bubble is gone
        const bubbleCleanup = overlay.querySelector('.arcade-vs-quote-bubble');
        if (bubbleCleanup) bubbleCleanup.style.display = 'none';

        const result = overlay.querySelector('.arcade-vs-result');
        if (result) {
          result.style.display = '';

          if (winner === 'employee') {
            result.innerHTML = `
              <div class="arcade-vs-winner-label">WINNER</div>
              <div class="arcade-vs-winner-name" style="color: ${employeeColor}">${esc(badge.name)}</div>
              <div class="arcade-vs-victory-text">${this._getVictoryText(opponent)}</div>
            `;
            this._highlightWinnerBadge(badge.employeeId);
          } else {
            result.innerHTML = `
              <div class="arcade-vs-winner-label">WINNER</div>
              <div class="arcade-vs-winner-name" style="color: ${opponentColor}">${esc(opponent.name)}</div>
              <div class="arcade-vs-victory-text arcade-vs-defeat-text">${this._getDefeatText()}</div>
            `;
          }
          result.classList.add('reveal');
        }
        setVSAnnouncer(winner === 'employee'
          ? `${badge.name.toUpperCase()} WINS!`
          : `${opponent.name.toUpperCase()} WINS!`);
      }, 20500);
      this._timeouts.push(t7);

      // ─── Dissolve out at 23.5s ────────────────────────────────
      const t8 = setTimeout(() => {
        overlay.classList.add('dissolve');
        const t9 = setTimeout(() => {
          overlay.remove();
          const t10 = setTimeout(() => {
            this._container.querySelectorAll('.arcade-slot.winner-glow').forEach(s => s.classList.remove('winner-glow'));
          }, 2000);
          this._timeouts.push(t10);
          resolve();
        }, 600);
        this._timeouts.push(t9);
      }, 23500);
      this._timeouts.push(t8);
    });
  },

  // ─── Typewriter Effect ──────────────────────────────────────

  _typewriterEffect(el, text, msPerChar) {
    el.textContent = '';
    for (let i = 0; i < text.length; i++) {
      const tid = setTimeout(() => {
        el.textContent += text[i];
      }, i * msPerChar);
      this._timeouts.push(tid);
    }
  },

  // ─── Fireworks burst (new hire celebration) ────────────────

  _spawnFireworks(container) {
    if (!container) return;
    const colors = ['#ff3366', '#ffcc00', '#00ffcc', '#ff6b35', '#00ff41', '#ff00ff', '#00d4ff'];
    const count = 16;
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.className = 'arcade-vs-firework';
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const dist = 80 + Math.random() * 120;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      particle.style.cssText = `
        left: ${cx}px; top: ${cy}px;
        width: ${4 + Math.random() * 5}px;
        height: ${4 + Math.random() * 5}px;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        --fw-trajectory: translate(${dx}px, ${dy}px);
        animation-delay: ${Math.random() * 0.15}s;
        animation-duration: ${0.8 + Math.random() * 0.6}s;
      `;
      container.appendChild(particle);
      // Clean up after animation
      const tid = setTimeout(() => particle.remove(), 1600);
      this._timeouts.push(tid);
    }

    // Second burst slightly delayed for layered effect
    const t2 = setTimeout(() => {
      for (let i = 0; i < 10; i++) {
        const particle = document.createElement('div');
        particle.className = 'arcade-vs-firework';
        const angle = (Math.PI * 2 * i) / 10 + (Math.random() - 0.5) * 0.5;
        const dist = 50 + Math.random() * 80;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        particle.style.cssText = `
          left: ${cx}px; top: ${cy}px;
          width: ${3 + Math.random() * 4}px;
          height: ${3 + Math.random() * 4}px;
          background: ${colors[Math.floor(Math.random() * colors.length)]};
          --fw-trajectory: translate(${dx}px, ${dy}px);
          animation-duration: ${0.6 + Math.random() * 0.5}s;
        `;
        container.appendChild(particle);
        const tid = setTimeout(() => particle.remove(), 1400);
        this._timeouts.push(tid);
      }
    }, 300);
    this._timeouts.push(t2);
  },

  // ─── Fight Sequence (HP bars + hit sparks) ──────────────────

  // ─── Fight Announcer Lines ──────────────────────────────────

  _FIGHT_LINES_EVEN: [
    'TRADING BLOWS!',
    'NEITHER WILL BACK DOWN!',
    'AN EVEN MATCH!',
    'WHAT A BATTLE!',
  ],

  _FIGHT_LINES_WINNING: [
    'TAKING CONTROL!',
    'GAINING THE UPPER HAND!',
    'DOMINATING!',
    'ON THE OFFENSIVE!',
  ],

  _FIGHT_LINES_RALLY: [
    'WAIT... A COMEBACK?!',
    'REFUSING TO GO DOWN!',
    'DIGGING DEEP!',
    'NOT DONE YET!',
  ],

  _FIGHT_LINES_FINISH: [
    'THIS IS IT!',
    'THE FINAL BLOW!',
    'IT\'S OVER!',
    'DOWN FOR THE COUNT!',
  ],

  _animateFight(overlay, winner, badge, opponent, empColor, oppColor, setVSAnnouncer) {
    const hpContainer = overlay.querySelector('.arcade-vs-hp-container');
    if (!hpContainer) return;

    // Show HP bars with slide-in
    hpContainer.style.display = '';
    hpContainer.classList.add('visible');

    const leftFill = overlay.querySelector('.arcade-vs-hp-left .arcade-vs-hp-fill');
    const rightFill = overlay.querySelector('.arcade-vs-hp-right .arcade-vs-hp-fill');
    const leftSpark = overlay.querySelector('.arcade-vs-left .arcade-vs-hit-spark');
    const rightSpark = overlay.querySelector('.arcade-vs-right .arcade-vs-hit-spark');

    const loserFill = winner === 'employee' ? rightFill : leftFill;
    const loserSpark = winner === 'employee' ? rightSpark : leftSpark;
    const winnerFill = winner === 'employee' ? leftFill : rightFill;
    const winnerSpark = winner === 'employee' ? leftSpark : rightSpark;
    const winnerName = winner === 'employee' ? badge.name : opponent.name;
    const loserName = winner === 'employee' ? opponent.name : badge.name;

    // HP color helper
    const hpColor = (pct) => {
      if (pct > 60) return '#00ff41';
      if (pct > 30) return '#ffcc00';
      return '#ff3333';
    };

    const setHP = (fill, pct) => {
      fill.style.width = Math.max(0, pct) + '%';
      const c = hpColor(pct);
      fill.style.backgroundColor = c;
      fill.style.boxShadow = `0 0 6px ${c}`;
    };

    const doHit = (spark, shakeIntensity) => {
      spark.classList.add('flash');
      const t1 = setTimeout(() => spark.classList.remove('flash'), 150);
      this._timeouts.push(t1);

      const track = (spark === loserSpark ? loserFill : winnerFill).parentElement;
      if (track) {
        track.classList.add('hit-flash');
        const t2 = setTimeout(() => track.classList.remove('hit-flash'), 150);
        this._timeouts.push(t2);
      }

      if (shakeIntensity !== false) {
        overlay.classList.add('hit-shake');
        const t3 = setTimeout(() => overlay.classList.remove('hit-shake'), 120);
        this._timeouts.push(t3);
      }
    };

    const pickLine = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // ═══════════════════════════════════════════════════════════
    // Extended fight choreography (~7.5s)
    //
    // Both fighters start at 100%. The fight has 3 acts:
    //   Act 1 (0-2.5s):    Even exchange — both drop to ~65-75%
    //   Act 2 (2.5-5.0s):  Winner pushes, loser rallies briefly
    //   Act 3 (5.0-7.5s):  Final sequence — loser collapses, K.O.
    //
    // Winner ends at 15-40% HP for drama. Loser hits 0.
    // ═══════════════════════════════════════════════════════════

    let winnerHP = 100;
    let loserHP = 100;
    const winnerFinalHP = 15 + Math.floor(Math.random() * 25); // 15-40%

    // ─── Act 1: Even exchange (0–2.5s) ──────────────────────
    const act1 = [
      { delay: 400,  target: 'loser',  dmg: 10 },
      { delay: 900,  target: 'winner', dmg: 12 },
      { delay: 1400, target: 'loser',  dmg: 8 },
      { delay: 1800, target: 'winner', dmg: 10 },
      { delay: 2300, target: 'loser',  dmg: 7 },
    ];

    // ─── Act 2: Winner pushes, loser rallies (2.5–5.0s) ────
    const act2 = [
      { delay: 2800, target: 'loser',  dmg: 12 },
      { delay: 3200, target: 'loser',  dmg: 15 },
      { delay: 3700, target: 'winner', dmg: 8 },  // loser fights back
      { delay: 4100, target: 'winner', dmg: 12 },  // rally!
      { delay: 4600, target: 'loser',  dmg: 5 },   // winner recovers
    ];

    // ─── Act 3: Finish (5.0–7.5s) ──────────────────────────
    const act3 = [
      { delay: 5200, target: 'loser',  dmg: 10 },
      { delay: 5700, target: 'winner', dmg: 5 },   // last gasp
      { delay: 6200, target: 'loser',  dmg: 12 },
      { delay: 6800, target: 'loser',  dmg: 999, final: true }, // K.O. hit
    ];

    const allHits = [...act1, ...act2, ...act3];

    // Pre-calculate HP targets so the final hit always lands at 0 / winnerFinalHP
    // We'll track running totals and adjust the final hit
    let runWinnerDmg = 0;
    let runLoserDmg = 0;

    allHits.forEach(h => {
      if (h.final) return;
      if (h.target === 'winner') runWinnerDmg += h.dmg;
      else runLoserDmg += h.dmg;
    });

    // Scale damage so winner ends at winnerFinalHP and loser ends at 0
    const winnerScale = (100 - winnerFinalHP) / (runWinnerDmg || 1);
    const loserScale = 100 / (runLoserDmg || 1);

    // Announcer beats
    const announcerBeats = [
      { delay: 500,  line: pickLine(this._FIGHT_LINES_EVEN) },
      { delay: 2000, line: pickLine(this._FIGHT_LINES_EVEN) },
      { delay: 3300, line: `${winnerName.toUpperCase()} ${pickLine(this._FIGHT_LINES_WINNING)}` },
      { delay: 4200, line: `${loserName.toUpperCase()} ${pickLine(this._FIGHT_LINES_RALLY)}` },
      { delay: 5800, line: pickLine(this._FIGHT_LINES_FINISH) },
    ];

    announcerBeats.forEach(beat => {
      const tid = setTimeout(() => setVSAnnouncer(beat.line), beat.delay);
      this._timeouts.push(tid);
    });

    allHits.forEach(hit => {
      const tid = setTimeout(() => {
        if (hit.final) {
          // Final K.O. blow
          loserHP = 0;
          setHP(loserFill, 0);
          doHit(loserSpark, true);

          // K.O. text on loser portrait
          const loserPortrait = loserSpark.parentElement;
          if (loserPortrait) {
            const koEl = document.createElement('div');
            koEl.className = 'arcade-vs-ko-text';
            koEl.textContent = 'K.O.';
            loserPortrait.appendChild(koEl);
          }
          return;
        }

        if (hit.target === 'winner') {
          winnerHP -= hit.dmg * winnerScale;
          winnerHP = Math.max(winnerFinalHP, winnerHP);
          setHP(winnerFill, winnerHP);
          doHit(winnerSpark, hit.dmg > 10);
        } else {
          loserHP -= hit.dmg * loserScale;
          loserHP = Math.max(5, loserHP); // don't go below 5% until K.O.
          setHP(loserFill, loserHP);
          doHit(loserSpark, hit.dmg > 10);
        }
      }, hit.delay);
      this._timeouts.push(tid);
    });

    // Loser portrait dims after K.O.
    const dimTid = setTimeout(() => {
      const loserSide = winner === 'employee'
        ? overlay.querySelector('.arcade-vs-right')
        : overlay.querySelector('.arcade-vs-left');
      if (loserSide) loserSide.classList.add('defeated');
    }, 7200);
    this._timeouts.push(dimTid);
  },

  // ─── Winner Badge Highlight ─────────────────────────────────

  _highlightWinnerBadge(employeeId) {
    const slot = this._container.querySelector(`[data-employee-id="${employeeId}"]`);
    if (slot) {
      slot.classList.add('winner-glow');
      slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  },

  // ─── VS Announcer Lines ─────────────────────────────────────

  _getVSAnnouncerLine(badge, opponent) {
    if (opponent.type === 'boss') {
      const lines = [
        `${badge.name} CHALLENGES THE BOSS!`,
        `A BOLD MOVE AGAINST ${opponent.name.toUpperCase()}!`,
        `THE NEWCOMER DARES TO FIGHT MANAGEMENT!`,
      ];
      return lines[Math.floor(Math.random() * lines.length)];
    } else if (opponent.type === 'creature') {
      const lines = [
        `${badge.name} FACES ${opponent.name.toUpperCase()}!`,
        `A WILD ${opponent.name.toUpperCase()} APPEARS!`,
        `CAN ${badge.name.toUpperCase()} SURVIVE THIS?`,
      ];
      return lines[Math.floor(Math.random() * lines.length)];
    } else {
      const lines = [
        `${badge.name} VS THE INTERN... REALLY?`,
        `THIS ISN'T EVEN A FAIR FIGHT.`,
        `THE INTERN DIDN'T SIGN UP FOR THIS.`,
      ];
      return lines[Math.floor(Math.random() * lines.length)];
    }
  },

  _getVictoryText(opponent) {
    if (opponent.type === 'boss') return 'PROMOTION INCOMING';
    if (opponent.type === 'creature') return 'THREAT NEUTRALIZED';
    return 'THE INTERN HAS BEEN DEFEATED. AGAIN.';
  },

  _getDefeatText() {
    return this._EMPLOYEE_DEFEAT_LINES[Math.floor(Math.random() * this._EMPLOYEE_DEFEAT_LINES.length)];
  },

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

    this._allBadges.push(badge);
    if (badge.isBandMember) this._bossBadges.push(badge);
    this._shuffledBadges = this._shuffle(this._allBadges);

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
      const color = this._DIV_COLORS[div] || '#ffd700';

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
