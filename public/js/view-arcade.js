// ─── Arcade Renderer (Select Screen View) ────────────────
// Implements the renderer interface: { init, addBadge, destroy }
// Fighting-game character select screen for the employee directory.

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
  _previewPanel: null,
  _gridPanel: null,
  _announcer: null,

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

  // Mythical creatures for VS battles
  _CREATURES: [
    { name: 'The Phantom Printer', tagline: 'PC LOAD LETTER.', move: 'PAPER JAM OF DOOM', silhouette: '\uD83D\uDDA8\uFE0F' },
    { name: 'The Reply-All Hydra', tagline: 'Cut one thread, two more appear.', move: 'INBOX APOCALYPSE', silhouette: '\uD83D\uDC09' },
    { name: 'The Meeting That Could Have Been An Email', tagline: 'This will only take an hour.', move: 'CALENDAR BLOCK', silhouette: '\uD83D\uDCC5' },
    { name: 'The Ghost of Deadlines Past', tagline: 'Remember Q3? I do.', move: 'SCOPE CREEP CURSE', silhouette: '\uD83D\uDC7B' },
    { name: 'The Sentient Thermostat', tagline: "It's always 72. Always.", move: 'TEMPERATURE WAR', silhouette: '\uD83C\uDF21\uFE0F' },
    { name: 'The Slack Notification Swarm', tagline: 'You have 847 unread messages.', move: '@CHANNEL STORM', silhouette: '\uD83D\uDD14' },
  ],

  _INTERN_CLASSES: ['Unpaid Chaos Agent', 'Coffee Fetcher Supreme', 'Resume Padder', 'LinkedIn Warrior'],
  _INTERN_MOVES: ['NETWORKING EVENT', 'UNPAID OVERTIME', 'COVER LETTER BARRAGE', 'LINKEDIN ENDORSEMENT SPAM'],
  _INTERN_TAGLINES: ["I'm just happy to be here.", 'Is this paid?', 'I put this on my resume.', 'My dad knows someone.'],

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

    // Start idle animations
    this._startIdleAnimations();
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

  _buildLayout() {
    this._container.innerHTML = `
      <div class="arcade-container">
        <div class="arcade-grid-panel">
          <div class="arcade-boss-row"></div>
          <div class="arcade-grid"></div>
        </div>
        <div class="arcade-preview-panel">
          <div class="arcade-preview-portrait">
            <div class="arcade-preview-silhouette">?</div>
          </div>
          <div class="arcade-preview-name">SELECT A FIGHTER</div>
          <div class="arcade-preview-level"></div>
          <div class="arcade-preview-class"></div>
          <div class="arcade-preview-tagline"></div>
          <div class="arcade-preview-stats"></div>
          <div class="arcade-preview-move"></div>
          <div class="arcade-preview-division"></div>
          <div class="arcade-preview-quote"></div>
        </div>
        <div class="arcade-tabs"></div>
        <div class="arcade-announcer">
          <span class="arcade-announcer-text">INSERT COIN</span>
        </div>
      </div>
    `;

    this._gridPanel = this._container.querySelector('.arcade-grid');
    this._previewPanel = this._container.querySelector('.arcade-preview-panel');
    this._announcer = this._container.querySelector('.arcade-announcer-text');

    // Build tabs
    this._buildTabs();
  },

  _buildTabs() {
    const tabBar = this._container.querySelector('.arcade-tabs');
    if (!tabBar) return;

    const allBtn = document.createElement('button');
    allBtn.className = 'arcade-tab active';
    allBtn.textContent = 'ALL';
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

    // Update tab active state
    const tabs = this._container.querySelectorAll('.arcade-tab');
    tabs.forEach(t => t.classList.remove('active'));
    if (division === 'ALL') {
      tabs[0].classList.add('active');
    } else {
      tabs.forEach(t => {
        if (t.dataset.division === division) t.classList.add('active');
      });
    }

    // Filter grid slots
    const slots = this._container.querySelectorAll('.arcade-slot');
    slots.forEach(slot => {
      if (division === 'ALL') {
        slot.style.display = '';
      } else {
        slot.style.display = slot.dataset.division === division ? '' : 'none';
      }
    });

    // Filter boss row
    const bossSlots = this._container.querySelectorAll('.arcade-boss-row .arcade-slot');
    bossSlots.forEach(slot => {
      if (division === 'ALL') {
        slot.style.display = '';
      } else {
        slot.style.display = slot.dataset.division === division ? '' : 'none';
      }
    });
  },

  _populateGrid() {
    const bossRow = this._container.querySelector('.arcade-boss-row');
    const grid = this._gridPanel;
    if (!bossRow || !grid) return;

    this._allBadges.forEach(badge => {
      const slot = this._createSlot(badge);
      if (badge.isBandMember) {
        bossRow.appendChild(slot);
      } else {
        grid.appendChild(slot);
      }
    });
  },

  _createSlot(badge) {
    const div = getDivisionForDept(badge.department, badge.isBandMember);
    const slot = document.createElement('div');
    slot.className = 'arcade-slot';
    slot.dataset.employeeId = badge.employeeId;
    slot.dataset.division = div;
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

    // Hover → update preview (unless locked)
    slot.addEventListener('mouseenter', () => {
      if (!this._locked) {
        this._highlightSlot(slot);
        this._updatePreview(badge);
      }
    });

    // Click → lock/unlock selection
    slot.addEventListener('click', () => {
      if (this._locked && this._selectedBadge && this._selectedBadge.employeeId === badge.employeeId) {
        // Unlock
        this._locked = false;
        slot.classList.remove('selected');
        return;
      }
      // Lock on this badge
      this._container.querySelectorAll('.arcade-slot.selected').forEach(s => s.classList.remove('selected'));
      slot.classList.add('selected');
      this._locked = true;
      this._selectedBadge = badge;
      this._updatePreview(badge);
      showBadgeDetail(badge.employeeId, badge.name);
    });

    return slot;
  },

  _highlightSlot(slot) {
    this._container.querySelectorAll('.arcade-slot.highlighted').forEach(s => s.classList.remove('highlighted'));
    slot.classList.add('highlighted');
  },

  _updatePreview(badge) {
    if (!this._previewPanel) return;

    const div = getDivisionForDept(badge.department, badge.isBandMember);
    const stats = ArcadeStats.getEmployeeStats(badge.name, badge.employeeId, div);
    const cls = ArcadeStats.getClass(stats, div, badge.name);
    const level = ArcadeStats.getLevel(stats);
    const move = ArcadeStats.getMove(badge.name, div);
    const quote = ArcadeStats.getQuote(badge.name);
    const color = this._DIV_COLORS[div] || '#ffd700';

    // Portrait
    const portraitEl = this._previewPanel.querySelector('.arcade-preview-portrait');
    portraitEl.innerHTML = `
      <img class="arcade-preview-img" src="/api/badge/${esc(badge.employeeId)}/headshot"
           alt="${esc(badge.name)}"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
      <div class="arcade-preview-silhouette" style="display:none">?</div>
    `;
    portraitEl.style.borderColor = color;

    // Name
    this._previewPanel.querySelector('.arcade-preview-name').textContent = badge.name;
    this._previewPanel.querySelector('.arcade-preview-name').style.color = color;

    // Level
    this._previewPanel.querySelector('.arcade-preview-level').textContent = `LVL ${level}`;

    // Class
    const classEl = this._previewPanel.querySelector('.arcade-preview-class');
    classEl.textContent = cls.name;
    classEl.style.color = color;

    // Tagline
    this._previewPanel.querySelector('.arcade-preview-tagline').textContent = cls.tagline;

    // Stats bars
    const statsEl = this._previewPanel.querySelector('.arcade-preview-stats');
    let statsHTML = '';
    ArcadeStats.STAT_NAMES.forEach(statName => {
      const val = stats[statName];
      let blocks = '';
      for (let i = 1; i <= 10; i++) {
        blocks += `<span class="arcade-stat-block ${i <= val ? 'filled' : ''}" style="${i <= val ? 'background:' + color : ''}"></span>`;
      }
      statsHTML += `
        <div class="arcade-stat-row">
          <span class="arcade-stat-label">${statName}</span>
          <div class="arcade-stat-bar">${blocks}</div>
          <span class="arcade-stat-val">${val}</span>
        </div>
      `;
    });
    statsEl.innerHTML = statsHTML;

    // Animate bars if FX on
    if (animationsEnabled()) {
      const rows = statsEl.querySelectorAll('.arcade-stat-row');
      rows.forEach((row, i) => {
        row.style.opacity = '0';
        row.style.transform = 'translateX(20px)';
        const t = setTimeout(() => {
          row.style.transition = 'opacity 0.2s, transform 0.2s';
          row.style.opacity = '1';
          row.style.transform = 'translateX(0)';
        }, i * 60);
        this._timeouts.push(t);
      });
    }

    // Move
    this._previewPanel.querySelector('.arcade-preview-move').innerHTML =
      `<span class="arcade-move-label">SPECIAL:</span> ${esc(move)}`;

    // Division
    const divInfo = PUBLIC_DIVISIONS.find(d => d.theme === div);
    const divEl = this._previewPanel.querySelector('.arcade-preview-division');
    divEl.textContent = divInfo ? divInfo.name : div;
    divEl.style.color = color;

    // Quote
    this._previewPanel.querySelector('.arcade-preview-quote').textContent = `"${quote}"`;

    // Announcer
    this._setAnnouncer(`${badge.name.toUpperCase()} ENTERS THE RING`);
  },

  _updatePreviewCreature(creature) {
    if (!this._previewPanel) return;

    const portraitEl = this._previewPanel.querySelector('.arcade-preview-portrait');
    portraitEl.innerHTML = `<div class="arcade-preview-silhouette arcade-creature-silhouette">${creature.silhouette}</div>`;
    portraitEl.style.borderColor = '#ff0040';

    this._previewPanel.querySelector('.arcade-preview-name').textContent = creature.name;
    this._previewPanel.querySelector('.arcade-preview-name').style.color = '#ff0040';
    this._previewPanel.querySelector('.arcade-preview-level').textContent = 'LVL ??';
    this._previewPanel.querySelector('.arcade-preview-class').textContent = 'MYTHICAL BEAST';
    this._previewPanel.querySelector('.arcade-preview-class').style.color = '#ff0040';
    this._previewPanel.querySelector('.arcade-preview-tagline').textContent = creature.tagline;
    this._previewPanel.querySelector('.arcade-preview-stats').innerHTML = '';
    this._previewPanel.querySelector('.arcade-preview-move').innerHTML =
      `<span class="arcade-move-label">SPECIAL:</span> ${esc(creature.move)}`;
    this._previewPanel.querySelector('.arcade-preview-division').textContent = 'UNKNOWN ORIGIN';
    this._previewPanel.querySelector('.arcade-preview-division').style.color = '#ff0040';
    this._previewPanel.querySelector('.arcade-preview-quote').textContent = '';
  },

  _updatePreviewIntern(intern) {
    if (!this._previewPanel) return;

    const portraitEl = this._previewPanel.querySelector('.arcade-preview-portrait');
    portraitEl.innerHTML = `<div class="arcade-preview-silhouette">?</div>`;
    portraitEl.style.borderColor = '#888';

    this._previewPanel.querySelector('.arcade-preview-name').textContent = 'THE INTERN';
    this._previewPanel.querySelector('.arcade-preview-name').style.color = '#888';
    this._previewPanel.querySelector('.arcade-preview-level').textContent = 'LVL 1';
    this._previewPanel.querySelector('.arcade-preview-class').textContent = intern.className;
    this._previewPanel.querySelector('.arcade-preview-class').style.color = '#888';
    this._previewPanel.querySelector('.arcade-preview-tagline').textContent = intern.tagline;
    this._previewPanel.querySelector('.arcade-preview-stats').innerHTML = '';
    this._previewPanel.querySelector('.arcade-preview-move').innerHTML =
      `<span class="arcade-move-label">SPECIAL:</span> ${esc(intern.move)}`;
    this._previewPanel.querySelector('.arcade-preview-division').textContent = 'TEMP HIRE';
    this._previewPanel.querySelector('.arcade-preview-division').style.color = '#888';
    this._previewPanel.querySelector('.arcade-preview-quote').textContent = `"${intern.tagline}"`;
  },

  _setAnnouncer(text) {
    if (this._announcer) {
      this._announcer.textContent = text;
    }
  },

  // ─── Idle Animations ──────────────────────────────────────

  _startIdleAnimations() {
    // INSERT COIN blink
    const blinkId = setInterval(() => {
      if (!animationsEnabled()) return;
      if (this._announcer) this._announcer.classList.toggle('blink');
    }, 1000);
    this._intervals.push(blinkId);

    // Demo rotation — show random badge/creature/intern in preview every 15s
    const demoId = setInterval(() => {
      if (!animationsEnabled() || this._locked) return;
      this._showRandomPreview();
    }, 15000);
    this._intervals.push(demoId);

    // Random slot pulse every 10-20s
    const pulseLoop = () => {
      if (!animationsEnabled()) {
        const t = setTimeout(pulseLoop, 15000);
        this._timeouts.push(t);
        return;
      }
      const slots = this._container.querySelectorAll('.arcade-slot');
      if (slots.length > 0) {
        const randomSlot = slots[Math.floor(Math.random() * slots.length)];
        randomSlot.classList.add('pulse');
        const removeT = setTimeout(() => randomSlot.classList.remove('pulse'), 2000);
        this._timeouts.push(removeT);
      }
      const delay = 10000 + Math.floor(Math.random() * 10000);
      const t = setTimeout(pulseLoop, delay);
      this._timeouts.push(t);
    };
    const initialPulseT = setTimeout(pulseLoop, 10000);
    this._timeouts.push(initialPulseT);

    // Announcer rotation every 8s
    let annIdx = 0;
    const annId = setInterval(() => {
      if (!animationsEnabled() || this._locked) return;
      annIdx = (annIdx + 1) % this._ANNOUNCER_LINES.length;
      this._setAnnouncer(this._ANNOUNCER_LINES[annIdx]);
    }, 8000);
    this._intervals.push(annId);
  },

  _showRandomPreview() {
    const roll = Math.random();
    if (roll < 0.6 && this._allBadges.length > 0) {
      // Random employee
      const badge = this._allBadges[Math.floor(Math.random() * this._allBadges.length)];
      this._updatePreview(badge);
    } else if (roll < 0.85) {
      // Random creature
      const creature = this._CREATURES[Math.floor(Math.random() * this._CREATURES.length)];
      this._updatePreviewCreature(creature);
    } else {
      // Random intern
      const idx = Math.floor(Math.random() * this._INTERN_CLASSES.length);
      this._updatePreviewIntern({
        className: this._INTERN_CLASSES[idx],
        move: this._INTERN_MOVES[idx],
        tagline: this._INTERN_TAGLINES[idx],
      });
    }
  },

  // ─── addBadge (SSE live hire) ──────────────────────────────

  async addBadge(badge) {
    const div = getDivisionForDept(badge.department, badge.isBandMember);

    // Dedup: if already exists, highlight the slot instead of re-adding
    const existingSlot = this._container.querySelector(`[data-employee-id="${badge.employeeId}"]`);
    if (existingSlot) {
      existingSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
      existingSlot.classList.add('pulse');
      this._updatePreview(badge);
      setTimeout(() => existingSlot.classList.remove('pulse'), 2000);
      return;
    }

    // Add to internal list
    this._allBadges.push(badge);
    if (badge.isBandMember) this._bossBadges.push(badge);

    // Create slot
    const slot = this._createSlot(badge);

    // Determine placement
    const target = badge.isBandMember
      ? this._container.querySelector('.arcade-boss-row')
      : this._gridPanel;
    if (!target) return;

    // Respect current filter
    if (this._activeTab !== 'ALL' && div !== this._activeTab) {
      slot.style.display = 'none';
    }

    if (animationsEnabled()) {
      await this._animateProvision(slot, badge, target, div);
      await this._animateVS(badge, div);
    } else {
      target.appendChild(slot);
      this._updatePreview(badge);
    }

    slot.classList.add('new');

    // Update org header count
    const subEl = document.querySelector('.org-header-sub');
    if (subEl) {
      const match = subEl.textContent.match(/(\d+)/);
      if (match) {
        const newTotal = parseInt(match[1]) + 1;
        subEl.innerHTML = `Employee Directory &bull; ${newTotal} on payroll`;
      }
    }
  },

  // ─── Provisioning Unlock Sequence ─────────────────────────

  _animateProvision(slot, badge, target, div) {
    return new Promise(resolve => {
      const color = this._DIV_COLORS[div] || '#ffd700';

      // Add slot to DOM with provisioning state
      slot.classList.add('provisioning');
      const photoWrap = slot.querySelector('.arcade-slot-photo-wrap');
      const img = slot.querySelector('.arcade-slot-photo');
      const silhouette = slot.querySelector('.arcade-slot-silhouette');

      // Start with silhouette visible
      if (img) img.style.display = 'none';
      if (silhouette) {
        silhouette.style.display = 'flex';
        silhouette.textContent = '?';
      }

      // Add overlay
      const overlay = document.createElement('div');
      overlay.className = 'arcade-provision-overlay';
      overlay.innerHTML = `
        <div class="arcade-provision-text">PROVISIONING...</div>
        <div class="arcade-provision-bar"><div class="arcade-provision-fill"></div></div>
      `;
      slot.appendChild(overlay);

      target.appendChild(slot);

      const fill = overlay.querySelector('.arcade-provision-fill');

      // Animate progress bar (stalls at 99% for 500ms)
      fill.style.transition = 'width 1s linear';
      requestAnimationFrame(() => {
        fill.style.width = '99%';
      });

      const t1 = setTimeout(() => {
        // Stall at 99%
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
        // Reveal photo with grayscale → color transition
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
        // Update preview with stat slam
        this._updatePreviewWithSlam(badge, div);

        // EMPLOYEE ACTIVATED flash
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

  _updatePreviewWithSlam(badge, div) {
    const stats = ArcadeStats.getEmployeeStats(badge.name, badge.employeeId, div);
    const cls = ArcadeStats.getClass(stats, div, badge.name);
    const level = ArcadeStats.getLevel(stats);
    const move = ArcadeStats.getMove(badge.name, div);
    const quote = ArcadeStats.getQuote(badge.name);
    const color = this._DIV_COLORS[div] || '#ffd700';

    // Portrait
    const portraitEl = this._previewPanel.querySelector('.arcade-preview-portrait');
    portraitEl.innerHTML = `
      <img class="arcade-preview-img" src="/api/badge/${esc(badge.employeeId)}/headshot"
           alt="${esc(badge.name)}"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
      <div class="arcade-preview-silhouette" style="display:none">?</div>
    `;
    portraitEl.style.borderColor = color;

    // Name
    this._previewPanel.querySelector('.arcade-preview-name').textContent = badge.name;
    this._previewPanel.querySelector('.arcade-preview-name').style.color = color;

    // Level
    this._previewPanel.querySelector('.arcade-preview-level').textContent = `LVL ${level}`;

    // Class — type letter by letter
    const classEl = this._previewPanel.querySelector('.arcade-preview-class');
    classEl.textContent = '';
    classEl.style.color = color;
    const className = cls.name;
    for (let i = 0; i < className.length; i++) {
      const t = setTimeout(() => {
        classEl.textContent += className[i];
      }, i * 50);
      this._timeouts.push(t);
    }

    // Tagline (after class finishes typing)
    const tagT = setTimeout(() => {
      this._previewPanel.querySelector('.arcade-preview-tagline').textContent = cls.tagline;
    }, className.length * 50 + 100);
    this._timeouts.push(tagT);

    // Stats — slam one by one
    const statsEl = this._previewPanel.querySelector('.arcade-preview-stats');
    statsEl.innerHTML = '';

    ArcadeStats.STAT_NAMES.forEach((statName, i) => {
      const val = stats[statName];
      const t = setTimeout(() => {
        let blocks = '';
        for (let b = 1; b <= 10; b++) {
          blocks += `<span class="arcade-stat-block ${b <= val ? 'filled' : ''}" style="${b <= val ? 'background:' + color : ''}"></span>`;
        }
        const row = document.createElement('div');
        row.className = 'arcade-stat-row stat-slam';
        row.innerHTML = `
          <span class="arcade-stat-label">${statName}</span>
          <div class="arcade-stat-bar">${blocks}</div>
          <span class="arcade-stat-val">${val}</span>
        `;
        statsEl.appendChild(row);
      }, i * 100);
      this._timeouts.push(t);
    });

    // Move — flash after stats
    const moveT = setTimeout(() => {
      const moveEl = this._previewPanel.querySelector('.arcade-preview-move');
      moveEl.innerHTML = `<span class="arcade-move-label">SPECIAL:</span> <span class="arcade-move-name flash">${esc(move)}</span>`;
    }, ArcadeStats.STAT_NAMES.length * 100 + 200);
    this._timeouts.push(moveT);

    // Division
    const divInfo = PUBLIC_DIVISIONS.find(d => d.theme === div);
    const divEl = this._previewPanel.querySelector('.arcade-preview-division');
    divEl.textContent = divInfo ? divInfo.name : div;
    divEl.style.color = color;

    // Quote
    this._previewPanel.querySelector('.arcade-preview-quote').textContent = `"${quote}"`;
  },

  // ─── VS Screen ─────────────────────────────────────────────

  _animateVS(badge, div) {
    return new Promise(resolve => {
      // Pick opponent: 40% boss, 35% creature, 25% intern
      const roll = Math.random();
      let opponent;

      if (roll < 0.4 && this._bossBadges.length > 0) {
        const boss = this._bossBadges[Math.floor(Math.random() * this._bossBadges.length)];
        const bossDivision = getDivisionForDept(boss.department, boss.isBandMember);
        const bossStats = ArcadeStats.getEmployeeStats(boss.name, boss.employeeId, bossDivision);
        const bossCls = ArcadeStats.getClass(bossStats, bossDivision, boss.name);
        const bossMove = ArcadeStats.getMove(boss.name, bossDivision);
        opponent = {
          type: 'boss',
          name: boss.name,
          photoUrl: `/api/badge/${boss.employeeId}/headshot`,
          className: bossCls.name,
          move: bossMove,
          stats: bossStats,
          tagline: bossCls.tagline,
        };
      } else if (roll < 0.75) {
        const creature = this._CREATURES[Math.floor(Math.random() * this._CREATURES.length)];
        opponent = {
          type: 'creature',
          name: creature.name,
          silhouette: creature.silhouette,
          className: 'MYTHICAL BEAST',
          move: creature.move,
          tagline: creature.tagline,
          stats: null,
        };
      } else {
        const idx = Math.floor(Math.random() * this._INTERN_CLASSES.length);
        opponent = {
          type: 'intern',
          name: 'THE INTERN',
          className: this._INTERN_CLASSES[idx],
          move: this._INTERN_MOVES[idx],
          tagline: this._INTERN_TAGLINES[idx],
          stats: null,
        };
      }

      const employeeStats = ArcadeStats.getEmployeeStats(badge.name, badge.employeeId, div);
      const employeeColor = this._DIV_COLORS[div] || '#ffd700';

      // Create VS overlay
      const overlay = document.createElement('div');
      overlay.className = 'arcade-vs-overlay';

      // Left side: new employee
      let leftPortrait;
      leftPortrait = `<img class="arcade-vs-portrait" src="/api/badge/${esc(badge.employeeId)}/headshot"
        alt="${esc(badge.name)}"
        onerror="this.style.display='none'">`;

      // Right side: opponent
      let rightPortrait;
      if (opponent.type === 'boss') {
        rightPortrait = `<img class="arcade-vs-portrait" src="${esc(opponent.photoUrl)}"
          alt="${esc(opponent.name)}"
          onerror="this.style.display='none'">`;
      } else if (opponent.type === 'creature') {
        rightPortrait = `<div class="arcade-vs-creature-silhouette">${opponent.silhouette}</div>`;
      } else {
        rightPortrait = `<div class="arcade-vs-creature-silhouette">?</div>`;
      }

      // Build stat comparison
      let statComparison = '';
      if (opponent.stats) {
        ArcadeStats.STAT_NAMES.forEach(statName => {
          const eVal = employeeStats[statName];
          const oVal = opponent.stats[statName];
          const eWin = eVal > oVal ? ' win' : '';
          const oWin = oVal > eVal ? ' win' : '';
          statComparison += `
            <div class="arcade-vs-stat-row">
              <span class="arcade-vs-stat-val${eWin}">${eVal}</span>
              <span class="arcade-vs-stat-name">${statName}</span>
              <span class="arcade-vs-stat-val${oWin}">${oVal}</span>
            </div>
          `;
        });
      }

      overlay.innerHTML = `
        <div class="arcade-vs-side arcade-vs-left" style="--side-color: ${employeeColor}">
          <div class="arcade-vs-portrait-wrap">${leftPortrait}</div>
          <div class="arcade-vs-fighter-name">${esc(badge.name)}</div>
          <div class="arcade-vs-fighter-class">${esc(ArcadeStats.getClass(employeeStats, div, badge.name).name)}</div>
        </div>
        <div class="arcade-vs-center">
          <div class="arcade-vs-text">VS</div>
          ${statComparison ? `<div class="arcade-vs-stats">${statComparison}</div>` : ''}
        </div>
        <div class="arcade-vs-side arcade-vs-right" style="--side-color: ${opponent.type === 'creature' ? '#ff0040' : opponent.type === 'intern' ? '#888' : '#ffffff'}">
          <div class="arcade-vs-portrait-wrap">${rightPortrait}</div>
          <div class="arcade-vs-fighter-name">${esc(opponent.name)}</div>
          <div class="arcade-vs-fighter-class">${esc(opponent.className)}</div>
        </div>
        <div class="arcade-vs-announcer">${esc(this._getVSAnnouncerLine(badge, opponent))}</div>
        <div class="arcade-vs-result" style="display:none"></div>
      `;

      this._container.querySelector('.arcade-container').appendChild(overlay);

      // Animate VS text slam
      requestAnimationFrame(() => {
        overlay.classList.add('active');
        const vsText = overlay.querySelector('.arcade-vs-text');
        if (vsText) {
          vsText.classList.add('slam');
        }
      });

      // Show winner after 2.5s
      const t1 = setTimeout(() => {
        const result = overlay.querySelector('.arcade-vs-result');
        if (result) {
          result.style.display = '';
          result.innerHTML = `
            <div class="arcade-vs-winner-label">WINNER:</div>
            <div class="arcade-vs-winner-name" style="color: ${employeeColor}">${esc(badge.name)}</div>
            <div class="arcade-vs-victory-text">${this._getVictoryText(opponent)}</div>
          `;
        }
      }, 2500);
      this._timeouts.push(t1);

      // Dissolve overlay after 4s
      const t2 = setTimeout(() => {
        overlay.style.transition = 'opacity 0.5s';
        overlay.style.opacity = '0';
        const t3 = setTimeout(() => overlay.remove(), 500);
        this._timeouts.push(t3);
        resolve();
      }, 4000);
      this._timeouts.push(t2);
    });
  },

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
    if (opponent.type === 'boss') {
      return 'PROMOTION INCOMING';
    } else if (opponent.type === 'creature') {
      return 'THREAT NEUTRALIZED';
    } else {
      return 'THE INTERN HAS BEEN DEFEATED. AGAIN.';
    }
  },

  // ─── Destroy ───────────────────────────────────────────────

  destroy() {
    // Clear all intervals
    this._intervals.forEach(id => clearInterval(id));
    this._intervals = [];

    // Clear all timeouts
    this._timeouts.forEach(id => clearTimeout(id));
    this._timeouts = [];

    // Clear container
    if (this._container) {
      this._container.innerHTML = '';
    }

    // Reset state
    this._container = null;
    this._stats = null;
    this._allBadges = [];
    this._bossBadges = [];
    this._selectedBadge = null;
    this._locked = false;
    this._previewPanel = null;
    this._gridPanel = null;
    this._announcer = null;
    this._activeTab = 'ALL';
  },
};
