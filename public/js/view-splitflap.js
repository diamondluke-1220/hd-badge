// ─── Split-Flap Lobby Directory Renderer ──────────────────
// Implements the renderer interface: { init, addBadge, destroy }
// Renders employees as a mechanical split-flap departure-board style directory.

window.SplitFlapRenderer = {
  _container: null,
  _stats: null,
  _allBadges: [],
  _floorSections: {},
  _floorBadges: {},       // floor -> { all: Badge[], visibleSet: Set<index> }
  _clockInterval: null,
  _idleInterval: null,
  _intercomInterval: null,
  _rotationInterval: null,
  _intercomIndex: 0,
  _packetOverlay: null,
  _packetPanel: null,
  _activePacketRow: null,
  _escHandler: null,

  // ─── Constants ───────────────────────────────────────────

  CHARSET: ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-./',

  FLOOR_MAP: {
    '_exec': 99,
    'IT': -1,
    'Office': 1,
    'Corporate': 2,
    'Punk': 13,
    '_custom': 99,
  },

  FLOOR_ORDER: [-1, 1, 2, 13, 99],

  FLOOR_LABELS: {
    '-1': 'BASEMENT (B1) \u2014 TECHNICAL FRUSTRATIONS',
    '1':  'FLOOR 1 \u2014 OFFICE CULTURE',
    '2':  'FLOOR 2 \u2014 CORPORATE SYNERGY',
    '13': 'FLOOR 13 \u2014 PUNK DIVISION',
    '99': 'PENTHOUSE \u2014 EXECUTIVE / SPECIAL',
  },

  DIVISION_COLORS: {
    '_exec': '#ffffff',
    'IT': '#00d4ff',
    'Office': '#ff3366',
    'Corporate': '#ff6b35',
    'Punk': '#00ff41',
    '_custom': '#ffd700',
  },

  DIVISION_CSS: {
    '_exec': 'exec',
    'IT': 'it',
    'Office': 'office',
    'Corporate': 'corporate',
    'Punk': 'punk',
    '_custom': 'custom',
  },

  STATUSES: [
    'CHECKED IN', 'AWAY FROM DESK', 'REPLY ALL', 'ON MUTE', 'AFK',
    'ESCALATED', 'GHOSTING', 'IN A MEETING', 'PTO PENDING', 'TICKET OPEN',
    'REBOOTING', 'OUT OF SCOPE', 'COFFEE RUN', 'COMPLIANCE', 'SHREDDING',
    'CHECKED OUT', 'MANDATORY FUN', 'DRESS CODE', 'AUTO-REPLY', 'ORIENTATION',
  ],

  ANNOUNCEMENTS: [
    'ATTENTION: [name] HAS BEEN SPOTTED NEAR THE SUPPLY CLOSET. AGAIN.',
    'PAGING [name] \u2014 YOUR DESK PHONE HAS BEEN RINGING FOR 45 MINUTES.',
    'REMINDER: THE PRINTER ON FLOOR 2 IS NOT A TOASTER. LOOKING AT YOU, [name].',
    'SECURITY ALERT: [name] ATTEMPTED TO BADGE INTO THE SERVER ROOM WITH A LIBRARY CARD.',
    '[name] IS REQUESTED AT THE FRONT DESK. YOUR UBER EATS IS GETTING COLD.',
    'WILL [name] PLEASE STOP REPLYING ALL TO THE ENTIRE COMPANY.',
    'LOST AND FOUND: ONE ERGONOMIC KEYBOARD LAST SEEN NEAR [name]\'S DESK.',
    'NOTICE: [name] HAS EXCEEDED THEIR MONTHLY COFFEE ALLOCATION BY 340%.',
    'CUSTODIAL ALERT: SOMEONE LEFT A SANDWICH IN CONFERENCE ROOM B. SUSPECTS: [name].',
    'IT DEPT REMINDER: YOUR PASSWORD IS NOT "PASSWORD". NICE TRY, [name].',
    'FIRE DRILL POSTPONED \u2014 [name] IS STILL IN THE BATHROOM.',
    'CONGRATULATIONS TO [name] FOR WINNING EMPLOYEE OF THE MONTH. PRIZE: MORE WORK.',
    'PARKING LOT NOTICE: [name], YOUR HEADLIGHTS ARE ON. THEY HAVE BEEN ON SINCE TUESDAY.',
    'HR REMINDER: CASUAL FRIDAY DOES NOT MEAN PAJAMAS. WE ARE LOOKING AT YOU, [name].',
    'MAINTENANCE: THE ELEVATOR IS MAKING THAT NOISE AGAIN. [name], STOP PRESSING ALL THE BUTTONS.',
    'ALL STAFF: THE POTLUCK IS CANCELLED. [name] BROUGHT SOMETHING QUESTIONABLE.',
  ],

  WIFI_PASSWORDS: [
    'helpdesk123', 'password1', 'changeme2024', 'askSteve',
    'hunter2', 'admin', 'letmein', 'guest',
  ],

  EMERGENCY_CONTACTS: [
    'good luck', 'see HR', 'not applicable', 'still pending', 'they know what they did',
  ],

  FUN_SKILLS: [
    'EXCEL (CLAIMS)', 'OUTLOOK (DEPENDENT)', 'LOOKING BUSY (EXPERT)', 'REPLY ALL (CERTIFIED)',
    'MOSH PIT SURVIVAL', 'POWERPOINT (WEAPONIZED)', 'CABLE MANAGEMENT (CHAOTIC)',
    'PASSIVE AGGRESSION (SENIOR)', 'GUITAR HERO (EXPERT)', 'FIREWALL EVASION',
    'MEETING AVOIDANCE', 'TICKET DEFLECTION (BLACK BELT)', 'SLAM DANCING (INTERMEDIATE)',
    'CTRL+Z (PROFESSIONAL)', 'BLAME REDIRECTION',
  ],

  FUN_LAST_SEEN: [
    'SUPPLY CLOSET 3:47PM', 'TAKING A LONG LUNCH', 'NOWHERE NEAR THE INCIDENT',
    'LEAVING EARLY (AGAIN)', 'SERVER ROOM (NAPPING)', 'LOADING DOCK (SMOKING)',
    'BACKSTAGE', 'MOSH PIT (COMPANY TIME)', 'HIDING FROM STANDUP', 'BATHROOM (45 MIN)',
    'OTHER BUILDING (UNVERIFIED)', 'PARKING LOT (SCREAMING)', 'BREAK ROOM (CRYING)',
    'GREEN ROOM', 'ROOF (DON\'T ASK)',
  ],

  FUN_HR_VIOLATIONS: [
    'EXCESSIVE SIGHING', 'UNAPPROVED SNACKING', 'AGGRESSIVE STAPLING',
    'MICROWAVED FISH (TWICE)', 'REPLIED ALL TO CEO', 'AIR GUITAR IN ELEVATOR',
    'SLAM DANCED IN BREAKROOM', 'UNPLUGGED THE FIREWALL', 'STAGE DOVE OFF COPIER',
    'DRESS CODE (BATTLE VEST)', 'INSTALLED LINUX ON PRINTER', 'CROWD SURFED AT TOWNHALL',
    'PLAYED DRUMS ON DESK (3HRS)', 'CHANGED HOLD MUSIC TO PUNK', 'STARTED PIT IN PARKING LOT',
  ],

  FUN_SPIRIT_ANIMAL: [
    'BROKEN PRINTER', 'STALE COFFEE', 'THAT ONE MEETING', 'MONDAY', 'BASS DROP',
    'UNPLUGGED ROUTER', 'ENCORE', '404 PAGE', 'FEEDBACK LOOP', 'DEAD BATTERY',
    'MOSH PIT', 'SPINNING WHEEL OF DEATH', 'POWER CHORD', 'UNREAD EMAIL',
    'BLINKING CURSOR', 'PATCH CABLE (UNLABELED)', 'FIRE ALARM (FALSE)',
  ],

  // Row cap per floor
  MAX_VISIBLE_ROWS: 8,

  // Column char limits
  COL_NAME: 18,
  COL_TITLE: 18,
  COL_DEPT: 16,
  COL_STATUS: 12,

  // ─── Hash ────────────────────────────────────────────────

  _sfHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
    }
    return hash;
  },

  // ─── Character Cell Helpers ──────────────────────────────

  _createCharCell() {
    const cell = document.createElement('div');
    cell.className = 'flap-char';
    cell.innerHTML =
      '<div class="static-top"></div>' +
      '<div class="static-bottom"></div>' +
      '<div class="flap-top"></div>' +
      '<div class="flap-bottom"></div>';
    this._setChar(cell, ' ');
    return cell;
  },

  _setChar(cell, char) {
    cell.querySelector('.static-top').textContent = char;
    cell.querySelector('.static-bottom').textContent = char;
    cell.querySelector('.flap-top').textContent = char;
    cell.querySelector('.flap-bottom').textContent = char;
  },

  _flipChar(cell, fromChar, toChar) {
    return new Promise(resolve => {
      if (!animationsEnabled()) {
        this._setChar(cell, toChar);
        resolve();
        return;
      }
      // Static layers show destination char (revealed as flap falls)
      cell.querySelector('.static-top').textContent = toChar;
      cell.querySelector('.static-bottom').textContent = toChar;
      // Flap layers: top shows old char falling away, bottom shows new char snapping in
      cell.querySelector('.flap-top').textContent = fromChar;
      cell.querySelector('.flap-bottom').textContent = toChar;
      // Trigger CSS animation
      const flapTop = cell.querySelector('.flap-top');
      const flapBottom = cell.querySelector('.flap-bottom');
      flapTop.classList.add('flipping');
      flapBottom.classList.add('flipping');
      setTimeout(() => {
        flapTop.classList.remove('flipping');
        flapBottom.classList.remove('flipping');
        this._setChar(cell, toChar);
        resolve();
      }, 70);
    });
  },

  async _cycleToChar(cell, targetChar, currentChar) {
    if (!animationsEnabled()) {
      this._setChar(cell, targetChar);
      return;
    }
    const cycles = 1 + (this._sfHash(targetChar + Math.random()) % 3);
    let prev = currentChar || ' ';
    for (let i = 0; i < cycles; i++) {
      const next = this.CHARSET[Math.floor(Math.random() * this.CHARSET.length)];
      await this._flipChar(cell, prev, next);
      prev = next;
    }
    await this._flipChar(cell, prev, targetChar);
  },

  // ─── Badge Data Helpers ──────────────────────────────────

  _getDivision(badge) {
    return getDivisionForDept(badge.department, badge.isBandMember);
  },

  _getFloor(division) {
    return this.FLOOR_MAP[division] !== undefined ? this.FLOOR_MAP[division] : 99;
  },

  _getFloorDivision(floor) {
    // Reverse lookup: floor number to division key for CSS
    for (const [div, f] of Object.entries(this.FLOOR_MAP)) {
      if (f === floor && div !== '_custom') return div;
    }
    return '_custom';
  },

  _getSuite(name, floor) {
    const h = this._sfHash(name);
    const mod20 = h % 20;
    // IT special suites
    if (floor === -1) {
      if (mod20 === 0) return 'STE-404';
      if (mod20 === 1) return 'STE-500';
      if (mod20 === 2) return 'STE-403';
      if (mod20 === 3) return 'STE-418';
      if (mod20 === 4) return 'STE-503';
    }
    // Standard suite: floor prefix + room number
    const prefix = floor === -1 ? 'B' : String(floor);
    const range = floor === 99 ? 20 : 50;
    const room = (h % range) + 1;
    return prefix + String(room).padStart(2, '0');
  },

  _getStatus(name) {
    return this.STATUSES[this._sfHash(name + new Date().toDateString()) % this.STATUSES.length];
  },

  // ─── Clock ───────────────────────────────────────────────

  _formatClock() {
    const now = new Date();
    let h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return String(h).padStart(2, ' ') + ':' + m + ' ' + ampm;
  },

  // ─── Intercom ────────────────────────────────────────────

  _getRandomName() {
    if (!this._allBadges.length) return 'UNKNOWN EMPLOYEE';
    const b = this._allBadges[Math.floor(Math.random() * this._allBadges.length)];
    return (b.name || 'UNKNOWN').toUpperCase();
  },

  _nextAnnouncement() {
    const tmpl = this.ANNOUNCEMENTS[this._intercomIndex % this.ANNOUNCEMENTS.length];
    this._intercomIndex++;
    return tmpl.replace(/\[name\]/g, this._getRandomName());
  },

  // ─── Floor Section Builder ───────────────────────────────

  _createFloorSection(floor, division) {
    const section = document.createElement('div');
    section.className = 'sf-floor';
    section.dataset.floor = floor;
    section.dataset.division = this.DIVISION_CSS[division] || 'custom';

    const header = document.createElement('div');
    header.className = 'sf-floor-header';
    header.innerHTML =
      '<div class="sf-floor-accent"></div>' +
      '<span class="sf-floor-label">' + esc(this.FLOOR_LABELS[floor] || ('FLOOR ' + floor)) + '</span>' +
      '<span class="sf-floor-count" style="font-size:12px;color:#999;margin-left:8px;"></span>' +
      '<span class="sf-floor-chevron">\u25BC</span>';

    header.addEventListener('click', () => {
      section.classList.toggle('collapsed');
    });

    const colLabels = document.createElement('div');
    colLabels.className = 'sf-col-labels';
    colLabels.innerHTML =
      '<span class="sf-col-accent"></span>' +
      '<span class="sf-col-name">NAME</span>' +
      '<span class="sf-col-title">TITLE</span>' +
      '<span class="sf-col-dept">DEPT</span>' +
      '<span class="sf-col-status">STATUS</span>';

    const body = document.createElement('div');
    body.className = 'sf-floor-body';
    body.appendChild(colLabels);

    section.appendChild(header);
    section.appendChild(body);

    return section;
  },

  _updateFloorCount(section) {
    const floor = parseInt(section.dataset.floor, 10);
    const floorData = this._floorBadges[floor];
    const countEl = section.querySelector('.sf-floor-count');
    if (countEl && floorData) {
      const visible = section.querySelectorAll('.sf-floor-body .sf-row').length;
      const total = floorData.all.length;
      countEl.textContent = '(' + visible + ' of ' + total + ')';
    } else if (countEl) {
      const rows = section.querySelectorAll('.sf-floor-body .sf-row');
      countEl.textContent = '(' + rows.length + ')';
    }
  },

  // ─── Row Builder ─────────────────────────────────────────

  _createRow(badge, animated) {
    const div = this._getDivision(badge);
    const floor = this._getFloor(div);
    const name = (badge.name || '').toUpperCase().substring(0, this.COL_NAME);
    const title = (badge.title || '').toUpperCase().substring(0, this.COL_TITLE);
    const dept = (badge.department || '').toUpperCase().substring(0, this.COL_DEPT);
    const suite = this._getSuite(badge.name || '', floor);
    const status = this._getStatus(badge.name || '');

    const row = document.createElement('div');
    row.className = 'sf-row';
    row.dataset.employeeId = badge.employeeId || '';
    row.dataset.name = badge.name || '';
    row.dataset.floor = floor;
    row.style.cursor = 'pointer';

    // Division accent tile (Vestaboard-style solid color tile)
    const divColor = this.DIVISION_COLORS[div] || '#F5E6C8';
    const accentCell = document.createElement('div');
    accentCell.className = 'sf-cell sf-cell-accent';
    const accentTile = this._createCharCell();
    const accentFlaps = accentTile.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
    accentFlaps.forEach(el => { el.style.background = divColor; });
    accentCell.appendChild(accentTile);

    // Create cells
    const nameCell = this._buildCell('sf-cell-name', this.COL_NAME);
    const titleCell = this._buildCell('sf-cell-title', this.COL_TITLE);
    const deptCell = this._buildCell('sf-cell-dept', this.COL_DEPT);
    const statusCell = this._buildCell('sf-cell-status', this.COL_STATUS);

    // Status prefix: colored tile indicator before status text
    const statusPrefix = document.createElement('div');
    statusPrefix.className = 'sf-status-prefix';
    statusPrefix.style.background = divColor;
    statusCell.insertBefore(statusPrefix, statusCell.firstChild);

    row.appendChild(accentCell);
    row.appendChild(nameCell);
    row.appendChild(titleCell);
    row.appendChild(deptCell);
    row.appendChild(statusCell);

    // Set chars immediately if not animated
    if (!animated) {
      this._setFieldText(nameCell, name, this.COL_NAME);
      this._setFieldText(titleCell, title, this.COL_TITLE);
      this._setFieldText(deptCell, dept, this.COL_DEPT);
      this._setFieldText(statusCell, status, this.COL_STATUS);
    }

    // Row click: open onboarding packet
    row.addEventListener('click', () => {
      this._openPacket(badge, suite, status);
    });

    return { row, nameCell, titleCell, deptCell, statusCell, name, title, dept, suite, status };
  },

  _buildCell(cls, charCount) {
    const cell = document.createElement('div');
    cell.className = 'sf-cell ' + cls;
    for (let i = 0; i < charCount; i++) {
      cell.appendChild(this._createCharCell());
    }
    return cell;
  },

  _setFieldText(cell, text, maxLen) {
    const padded = text.padEnd(maxLen, ' ').substring(0, maxLen);
    const chars = cell.querySelectorAll('.flap-char');
    for (let i = 0; i < chars.length && i < maxLen; i++) {
      this._setChar(chars[i], padded[i]);
    }
  },

  // ─── Cascade Animation ──────────────────────────────────

  async _animateField(cell, text, maxLen, staggerMs) {
    const padded = text.padEnd(maxLen, ' ').substring(0, maxLen);
    const chars = cell.querySelectorAll('.flap-char');
    const promises = [];
    for (let i = 0; i < chars.length && i < maxLen; i++) {
      const idx = i;
      const targetChar = padded[idx];
      const currentChar = chars[idx].querySelector('.static-top').textContent || ' ';
      promises.push(
        new Promise(resolve => {
          setTimeout(() => {
            this._cycleToChar(chars[idx], targetChar, currentChar).then(resolve);
          }, idx * staggerMs);
        })
      );
    }
    await Promise.all(promises);
  },

  async _animateStatusWithCheckin(cell, finalStatus, maxLen) {
    // First flip to "CHECKING IN"
    await this._animateField(cell, 'CHECKING IN', maxLen, 20);
    await this._delay(600);
    // Then flip to joke status
    await this._animateField(cell, finalStatus, maxLen, 30);
  },

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // ─── Floating Badge Card ────────────────────────────────

  _openPacket(badge, suite, status) {
    this._closePacket();

    const name = badge.name || 'UNKNOWN';
    const h = this._sfHash(name);
    const dept = badge.department || 'UNASSIGNED';
    const title = badge.title || 'EMPLOYEE';
    const song = badge.song || '';
    const accessLevel = badge.accessLevel || 'STANDARD';

    // Hash-assigned fun details
    const skill = this.FUN_SKILLS[h % this.FUN_SKILLS.length];
    const lastSeen = this.FUN_LAST_SEEN[(h * 7) % this.FUN_LAST_SEEN.length];
    const hrViolation = this.FUN_HR_VIOLATIONS[(h * 13) % this.FUN_HR_VIOLATIONS.length];
    const spiritAnimal = this.FUN_SPIRIT_ANIMAL[(h * 17) % this.FUN_SPIRIT_ANIMAL.length];

    // Overlay (click-outside-to-close)
    const overlay = document.createElement('div');
    overlay.className = 'sf-badge-card-overlay';

    // Card panel
    const card = document.createElement('div');
    card.className = 'sf-badge-card';

    // Badge image from server render endpoint
    const badgeImgSrc = '/api/badge/' + encodeURIComponent(badge.employeeId || '') + '/image';

    card.innerHTML =
      '<button class="sf-badge-card-close">&times;</button>' +
      '<div class="sf-badge-card-header">PERSONNEL FILE</div>' +
      '<div class="sf-badge-card-img">' +
        '<img src="' + esc(badgeImgSrc) + '" alt="Badge: ' + esc(name) + '" />' +
      '</div>' +
      '<div class="sf-badge-card-details">' +
        '<div class="sf-badge-card-detail" data-label="SKILLS" data-value="' + esc(skill) + '"></div>' +
        '<div class="sf-badge-card-detail" data-label="LAST SEEN" data-value="' + esc(lastSeen) + '"></div>' +
        '<div class="sf-badge-card-detail" data-label="HR VIOLATION" data-value="' + esc(hrViolation) + '"></div>' +
        '<div class="sf-badge-card-detail" data-label="SPIRIT ANIMAL" data-value="' + esc(spiritAnimal) + '"></div>' +
      '</div>' +
      '<div class="sf-badge-card-meta">' +
        (song ? '<div class="sf-badge-card-meta-row"><span class="sf-badge-card-meta-label">SONG:</span> ' + esc(song) + '</div>' : '') +
        '<div class="sf-badge-card-meta-row"><span class="sf-badge-card-meta-label">ACCESS:</span> ' + esc(accessLevel) + '</div>' +
        '<div class="sf-badge-card-meta-row"><span class="sf-badge-card-meta-label">SUITE:</span> ' + esc(suite) + '</div>' +
        '<div class="sf-badge-card-meta-row"><span class="sf-badge-card-meta-label">STATUS:</span> ' + esc(status) + '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(card);

    // Close handlers
    const close = () => this._closePacket();
    overlay.addEventListener('click', close);
    card.querySelector('.sf-badge-card-close').addEventListener('click', close);

    this._packetOverlay = overlay;
    this._packetPanel = card;

    // Escape key
    this._escHandler = (e) => {
      if (e.key === 'Escape') this._closePacket();
    };
    document.addEventListener('keydown', this._escHandler);

    // Animate open
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.add('open');
        card.classList.add('open');
      });
    });

    // Animate fun detail lines with split-flap cascade
    setTimeout(() => {
      const details = card.querySelectorAll('.sf-badge-card-detail');
      details.forEach((el, idx) => {
        const label = el.dataset.label;
        const value = el.dataset.value;
        const maxLen = 28;
        // Build flap chars for the line
        const lineText = (label + ': ' + value).toUpperCase().substring(0, maxLen);
        const container = document.createElement('div');
        container.className = 'sf-badge-card-flap-line';
        for (let i = 0; i < maxLen; i++) {
          container.appendChild(this._createCharCell());
        }
        el.innerHTML = '';
        el.appendChild(container);
        // Stagger each detail line
        setTimeout(() => {
          this._animateField(container, lineText, maxLen, 20);
        }, idx * 400);
      });
    }, 300);

    // Auto-dismiss after 10 seconds
    this._autoDismissTimer = setTimeout(() => {
      this._closePacket();
    }, 10000);
  },

  _closePacket() {
    if (this._autoDismissTimer) {
      clearTimeout(this._autoDismissTimer);
      this._autoDismissTimer = null;
    }
    if (this._packetOverlay) {
      this._packetOverlay.classList.remove('open');
      setTimeout(() => {
        if (this._packetOverlay && this._packetOverlay.parentNode) {
          this._packetOverlay.parentNode.removeChild(this._packetOverlay);
        }
        this._packetOverlay = null;
      }, 300);
    }
    if (this._packetPanel) {
      this._packetPanel.classList.remove('open');
      setTimeout(() => {
        if (this._packetPanel && this._packetPanel.parentNode) {
          this._packetPanel.parentNode.removeChild(this._packetPanel);
        }
        this._packetPanel = null;
      }, 300);
    }
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
  },

  // ─── Init ────────────────────────────────────────────────

  async init(container, stats) {
    this._container = container;
    this._stats = stats;
    this._allBadges = [];
    this._floorSections = {};
    this._floorBadges = {};
    this._intercomIndex = 0;

    // Fetch all badges (paginated)
    let allBadges = [];
    try {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const resp = await fetch('/api/orgchart?page=' + page + '&limit=100');
        const data = await resp.json();
        allBadges = allBadges.concat(data.badges || []);
        totalPages = data.pages || 1;
        page++;
      }
    } catch (err) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:#666;">Failed to load directory.</div>';
      return;
    }

    this._allBadges = allBadges;

    // Set globals for donut/ticker
    window._tickerTotalHires = stats.visible || 0;
    if (stats.byDepartment) {
      window._tickerStats = Object.assign({}, stats.byDepartment);
    }
    initDonut(stats);

    // Build board
    const board = document.createElement('div');
    board.className = 'sf-board';

    // Header
    const header = document.createElement('div');
    header.className = 'sf-header';
    header.innerHTML =
      '<div>' +
        '<div class="sf-header-title">HELP DESK INC.</div>' +
        '<div class="sf-header-security">SECURITY DESK</div>' +
      '</div>' +
      '<div class="sf-header-subtitle">LOBBY DIRECTORY</div>' +
      '<div class="sf-header-clock" id="sfClock">' + esc(this._formatClock()) + '</div>';
    board.appendChild(header);

    // Surface wrapper for floor sections
    const surface = document.createElement('div');
    surface.className = 'sf-surface';

    // Group badges by floor
    const byFloor = {};
    allBadges.forEach(badge => {
      const div = this._getDivision(badge);
      const floor = this._getFloor(div);
      if (!byFloor[floor]) byFloor[floor] = { badges: [], division: div };
      byFloor[floor].badges.push(badge);
    });

    // Build floor sections in sorted order
    this.FLOOR_ORDER.forEach(floor => {
      if (!byFloor[floor]) return;
      const { badges, division } = byFloor[floor];
      const section = this._createFloorSection(floor, division);
      const body = section.querySelector('.sf-floor-body');

      // Sort badges alphabetically within floor
      badges.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      // Track all badges for this floor (for rotation)
      const visibleSet = new Set();
      badges.forEach((badge, idx) => {
        if (idx < this.MAX_VISIBLE_ROWS) {
          const { row } = this._createRow(badge, false);
          body.appendChild(row);
          visibleSet.add(idx);
        }
      });
      this._floorBadges[floor] = { all: badges, visibleSet };

      this._updateFloorCount(section);
      this._floorSections[floor] = section;
      surface.appendChild(section);
    });

    board.appendChild(surface);

    // Intercom ticker
    const ticker = document.createElement('div');
    ticker.className = 'sf-ticker';
    ticker.innerHTML =
      '<div class="sf-ticker-label">INTERCOM</div>' +
      '<div class="sf-ticker-track">' +
        '<div class="sf-ticker-text" id="sfTickerText">' + esc(this._nextAnnouncement()) + '</div>' +
      '</div>';
    board.appendChild(ticker);

    container.innerHTML = '';
    container.appendChild(board);

    // Start intervals
    this._startClock();
    this._startIdleSettle();
    this._startIntercom();
    this._startRotation();
  },

  // ─── Intervals ───────────────────────────────────────────

  _startClock() {
    this._clockInterval = setInterval(() => {
      const el = document.getElementById('sfClock');
      if (!el) return;
      const newTime = this._formatClock();
      if (animationsEnabled()) {
        // Flip clock characters
        const oldText = el.textContent || '';
        el.textContent = newTime;
      } else {
        el.textContent = newTime;
      }
    }, 60000);
  },

  _startIdleSettle() {
    const scheduleNext = () => {
      const delay = 8000 + Math.floor(Math.random() * 7000); // 8-15s
      this._idleInterval = setTimeout(() => {
        if (!animationsEnabled()) {
          scheduleNext();
          return;
        }
        // Pick a random visible char cell and do a single flip cycle
        const visibleRows = this._container.querySelectorAll('.sf-floor:not(.collapsed) .sf-row');
        if (visibleRows.length > 0) {
          const row = visibleRows[Math.floor(Math.random() * visibleRows.length)];
          const chars = row.querySelectorAll('.flap-char');
          if (chars.length > 0) {
            const cell = chars[Math.floor(Math.random() * chars.length)];
            const current = cell.querySelector('.static-top').textContent || ' ';
            const intermediate = this.CHARSET[Math.floor(Math.random() * this.CHARSET.length)];
            this._flipChar(cell, current, intermediate).then(() => {
              return this._flipChar(cell, intermediate, current);
            });
          }
        }
        scheduleNext();
      }, delay);
    };
    scheduleNext();
  },

  _startIntercom() {
    this._intercomInterval = setInterval(() => {
      const el = document.getElementById('sfTickerText');
      if (!el) return;
      el.textContent = this._nextAnnouncement();
      // Reset animation to retrigger scroll
      el.style.animation = 'none';
      // Force reflow
      void el.offsetWidth;
      el.style.animation = '';
    }, 30000);
  },

  _startRotation() {
    this._rotationInterval = setInterval(() => {
      if (!animationsEnabled()) return;
      // Rotate each floor that has more badges than MAX_VISIBLE_ROWS
      for (const [floorStr, floorData] of Object.entries(this._floorBadges)) {
        const floor = parseInt(floorStr, 10);
        if (floorData.all.length <= this.MAX_VISIBLE_ROWS) continue;
        const section = this._floorSections[floor];
        if (!section || section.classList.contains('collapsed')) continue;

        const body = section.querySelector('.sf-floor-body');
        if (!body) continue;

        // Pick 2-3 visible indices to swap out
        const swapCount = 2 + Math.floor(Math.random() * 2); // 2 or 3
        const visibleArr = Array.from(floorData.visibleSet);
        const hiddenArr = [];
        for (let i = 0; i < floorData.all.length; i++) {
          if (!floorData.visibleSet.has(i)) hiddenArr.push(i);
        }
        if (hiddenArr.length === 0) continue;

        // Shuffle and pick
        const toRemove = [];
        const shuffledVisible = visibleArr.sort(() => Math.random() - 0.5);
        const shuffledHidden = hiddenArr.sort(() => Math.random() - 0.5);
        const actualSwaps = Math.min(swapCount, shuffledVisible.length, shuffledHidden.length);

        for (let i = 0; i < actualSwaps; i++) {
          toRemove.push({ outIdx: shuffledVisible[i], inIdx: shuffledHidden[i] });
        }

        // Execute swaps
        toRemove.forEach(({ outIdx, inIdx }) => {
          // Find and remove the outgoing row
          const rows = body.querySelectorAll('.sf-row');
          const outRow = Array.from(rows).find(r =>
            r.dataset.name === (floorData.all[outIdx].name || '').toUpperCase()
          );
          if (outRow) outRow.remove();

          // Create incoming row with animation
          const inBadge = floorData.all[inIdx];
          const { row, nameCell, titleCell, deptCell, statusCell, name, title, dept, status } =
            this._createRow(inBadge, true);
          body.appendChild(row);

          // Animate the new row in
          const stagger = 25;
          this._animateField(nameCell, name, this.COL_NAME, stagger).then(() => {
            return this._animateField(titleCell, title, this.COL_TITLE, stagger);
          }).then(() => {
            return this._animateField(deptCell, dept, this.COL_DEPT, stagger);
          }).then(() => {
            return this._animateField(statusCell, status, this.COL_STATUS, stagger);
          });

          // Update tracking
          floorData.visibleSet.delete(outIdx);
          floorData.visibleSet.add(inIdx);
        });

        this._updateFloorCount(section);
      }
    }, 12000);
  },

  // ─── addBadge ────────────────────────────────────────────

  async addBadge(badge) {
    if (!this._container) return;

    // Dedup: if this employee already has a row, re-animate it instead of adding
    const existing = this._container.querySelector(`[data-employee-id="${badge.employeeId}"]`);
    if (existing) {
      // Re-run the status flip as a "check-in" animation on the existing row
      existing.scrollIntoView({ behavior: 'smooth', block: 'center' });
      existing.classList.add('sf-row-glow');
      setTimeout(() => existing.classList.remove('sf-row-glow'), 2000);
      return;
    }

    this._allBadges.push(badge);

    const div = this._getDivision(badge);
    const floor = this._getFloor(div);

    // Find or create floor section
    let section = this._floorSections[floor];
    if (!section) {
      section = this._createFloorSection(floor, div);
      this._floorSections[floor] = section;

      // Insert in correct sort order
      const surface = this._container.querySelector('.sf-surface');
      if (surface) {
        let inserted = false;
        const floorIdx = this.FLOOR_ORDER.indexOf(floor);
        const existing = surface.querySelectorAll('.sf-floor');
        for (const ex of existing) {
          const exFloor = parseInt(ex.dataset.floor, 10);
          const exIdx = this.FLOOR_ORDER.indexOf(exFloor);
          if (floorIdx < exIdx) {
            surface.insertBefore(section, ex);
            inserted = true;
            break;
          }
        }
        if (!inserted) surface.appendChild(section);
      }
    }

    // If collapsed, expand so the new hire is visible
    if (section.classList.contains('collapsed')) {
      section.classList.remove('collapsed');
    }

    // Create row with blank cells for animation
    const { row, nameCell, titleCell, deptCell, statusCell, name, title, dept, suite, status } =
      this._createRow(badge, true);

    // Insert alphabetically
    const body = section.querySelector('.sf-floor-body');
    const rows = body.querySelectorAll('.sf-row');
    let inserted = false;
    for (const r of rows) {
      if ((r.dataset.name || '').localeCompare(badge.name || '') > 0) {
        body.insertBefore(row, r);
        inserted = true;
        break;
      }
    }
    if (!inserted) body.appendChild(row);

    // Track in floor badges
    if (!this._floorBadges[floor]) {
      this._floorBadges[floor] = { all: [], visibleSet: new Set() };
    }
    const floorData = this._floorBadges[floor];
    const newIdx = floorData.all.length;
    floorData.all.push(badge);
    floorData.visibleSet.add(newIdx);

    this._updateFloorCount(section);

    // Scroll into view
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // --- 3-State Color Animation: ARRIVAL → SETTLING → NORMAL ---
    // Vestaboard-style: color tile BACKGROUNDS with staggered cascade left-to-right
    const divColor = this.DIVISION_COLORS[div] || '#F5E6C8';
    const allTiles = row.querySelectorAll('.sf-cell-name .flap-char, .sf-cell-title .flap-char, .sf-cell-dept .flap-char, .sf-cell-status .flap-char');

    // STATE 1: ARRIVAL — staggered tile-by-tile color cascade
    const colorStagger = 15; // ms per tile for dramatic left-to-right wave
    allTiles.forEach((tile, i) => {
      setTimeout(() => {
        const flaps = tile.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
        flaps.forEach(el => {
          el.style.background = divColor;
          el.style.color = '#111';
          el.style.transition = 'background 200ms ease';
        });
      }, i * colorStagger);
    });

    // Wait for color cascade to sweep across before text animation
    await this._delay(allTiles.length * colorStagger + 100);

    // Stagger: 25ms per char for snappy text cascade
    const stagger = 25;

    // Cascade NAME
    await this._animateField(nameCell, name, this.COL_NAME, stagger);
    await this._delay(100);

    // Cascade TITLE
    await this._animateField(titleCell, title, this.COL_TITLE, stagger);
    await this._delay(100);

    // Cascade DEPT
    await this._animateField(deptCell, dept, this.COL_DEPT, stagger);
    await this._delay(100);

    // STATUS: "NOW ARRIVING" then "CHECKING IN" then joke status
    await this._animateField(statusCell, 'NOW ARRIVING', this.COL_STATUS, 20);
    await this._delay(800);

    // STATE 2: SETTLING — staggered fade to muted division color
    allTiles.forEach((tile, i) => {
      setTimeout(() => {
        const flaps = tile.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
        flaps.forEach(el => {
          el.style.background = divColor + '4D'; // ~30% opacity
          el.style.color = '#F5E6C8';
          el.style.transition = 'background 400ms ease, color 400ms ease';
        });
      }, i * 10);
    });

    await this._animateField(statusCell, 'CHECKING IN', this.COL_STATUS, 20);
    await this._delay(600);
    await this._animateField(statusCell, status, this.COL_STATUS, 30);

    // STATE 3: NORMAL — staggered return to standard dark tiles
    setTimeout(() => {
      allTiles.forEach((tile, i) => {
        setTimeout(() => {
          const flaps = tile.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
          flaps.forEach(el => {
            el.style.background = '';
            el.style.color = '';
            el.style.transition = 'background 300ms ease, color 300ms ease';
          });
          setTimeout(() => {
            flaps.forEach(el => { el.style.transition = ''; });
          }, 400);
        }, i * 8);
      });
    }, 3000);

    // Row glow
    row.classList.add('sf-row-glow');
    setTimeout(() => row.classList.remove('sf-row-glow'), 2000);

    // Trigger intercom announcement for the new hire
    const tickerEl = document.getElementById('sfTickerText');
    if (tickerEl) {
      const announcement = this.ANNOUNCEMENTS[
        this._sfHash(badge.name || '') % this.ANNOUNCEMENTS.length
      ].replace(/\[name\]/g, (badge.name || 'UNKNOWN').toUpperCase());
      tickerEl.textContent = announcement;
      tickerEl.style.animation = 'none';
      void tickerEl.offsetWidth;
      tickerEl.style.animation = '';
    }
  },

  // ─── Destroy ─────────────────────────────────────────────

  destroy() {
    if (this._clockInterval) {
      clearInterval(this._clockInterval);
      this._clockInterval = null;
    }
    if (this._idleInterval) {
      clearTimeout(this._idleInterval);
      this._idleInterval = null;
    }
    if (this._intercomInterval) {
      clearInterval(this._intercomInterval);
      this._intercomInterval = null;
    }
    if (this._rotationInterval) {
      clearInterval(this._rotationInterval);
      this._rotationInterval = null;
    }
    this._closePacket();
    if (this._container) {
      this._container.innerHTML = '';
    }
    this._container = null;
    this._stats = null;
    this._allBadges = [];
    this._floorSections = {};
    this._floorBadges = {};
    this._intercomIndex = 0;
    this._activePacketRow = null;
  },
};
