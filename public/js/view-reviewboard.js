// ─── Review Board Renderer ───────────────────────────────
// Implements the renderer interface: { init, addBadge, destroy }
// Vestaboard-style 10×44 grid — one employee at a time with comedy performance reviews.
// Badge tile panel (12×16) on the right, sampled from headshot photo.

window.ReviewBoardRenderer = {
  _container: null,
  _stats: null,
  _stage: null,
  _grid: null,
  _badgePanel: null,
  _badgeGrid: null,
  _badgeCells: [],         // [row][col] 2D array for badge tile grid
  _badgeCanvas: null,
  _badgeRevealImg: null,    // <img> overlay for crossfade reveal
  _cells: [],             // [row][col] 2D array of .flap-char elements
  _allBadges: [],
  _shuffledBadges: [],
  _rotationIndex: 0,
  _rotationTimer: null,
  _arrivalQueue: [],
  _isArrivalActive: false,
  _currentBadge: null,
  _packetOverlay: null,
  _packetPanel: null,
  _escHandler: null,
  _autoDismissTimer: null,
  _resizeHandler: null,

  // ─── Constants ───────────────────────────────────────────

  ROWS: 10,
  COLS: 44,
  BADGE_COLS: 12,
  BADGE_ROWS: 16,
  CHARSET: ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-./',

  DIVISION_COLORS: {
    '_exec': '#ffffff',
    'IT': '#00d4ff',
    'Office': '#ff3366',
    'Corporate': '#ff6b35',
    'Punk': '#00ff41',
    '_custom': '#ffd700',
  },

  REVIEW_QUOTES: [
    // Style A — Fake review form
    ['STRENGTHS: NONE IDENTIFIED AT THIS TIME',
     'WEAKNESSES: SEE ATTACHED 47 PAGE BINDER',
     'RECOMMENDATION: KEEP AROUND FOR MORALE',
     'NOTE: EVERYONE FEELS BETTER ABOUT SELF',
     'STATUS: FILE SEALED BY LEGAL COUNSEL'],
    ['STRENGTHS: SHOWS UP MOST DAYS ARGUABLY',
     'WEAKNESSES: LITERALLY EVERYTHING ELSE',
     'RECOMMENDATION: HIDE THEM DURING AUDITS',
     'NOTES: SOMEHOW PASSED PROBATION TWICE',
     'REVIEWER: WISHES TO REMAIN ANONYMOUS'],
    ['STRENGTHS: VERY GOOD AT LEAVING EARLY',
     'WEAKNESSES: VERY BAD AT ARRIVING FIRST',
     'RECOMMENDATION: CONSIDER A GPS TRACKER',
     'ESTIMATED ROI: EXTREMELY WORTHWHILE',
     'APPROVED BY: EVERYONE IN MANAGEMENT'],
    ['STRENGTHS: WORLD CLASS CHAIR WARMING',
     'WEAKNESSES: EVERY SINGLE LISTED JOB DUTY',
     'RECOMMENDATION: PROMOTE TO CUSTOMER',
     'TIMELINE: AS SOON AS HUMANLY POSSIBLE',
     'BACKUP PLAN: QUIETLY RENAME THE ROLE'],
    ['STRENGTHS: RELIABLE CORPORATE WIFI USE',
     'WEAKNESSES: ANY AND ALL ASSIGNED TASKS',
     'RECOMMENDATION: CHANGE ALL THE PASSWORDS',
     'NETWORK BANDWIDTH RECOVERED: 40 PERCENT',
     'MORALE IMPACT: SURPRISINGLY POSITIVE'],

    // Style B — Rating labels
    ['ATTENDANCE: TECHNICALLY PRESENT MOST DAYS',
     'INITIATIVE: ONLY DISPLAYS WHEN THREATENED',
     'TEAMWORK: ACTIVELY PREFERS THE OPPOSITE',
     'PUNCTUALITY: MORE OF A LOOSE GUIDELINE',
     'OVERALL SCORE: NEEDS SIGNIFICANT WORK'],
    ['COMMUNICATION: CONSISTS MOSTLY OF SIGHING',
     'PUNCTUALITY: RELATIVE TO THEIR TIME ZONE',
     'PROFESSIONALISM: ON A SLIDING SCALE HERE',
     'DRESS CODE: ONLY TECHNICALLY COMPLIANT',
     'GENERAL ATTITUDE: PURE WEAPONIZED APATHY'],
    ['LEADERSHIP: LEADS THE DAILY LUNCH EXODUS',
     'CREATIVITY: ONLY IN EXCUSE MANUFACTURING',
     'FOCUS: ENTIRELY ON THEIR PHONE SCREEN',
     'DELEGATION: EXPERT LEVEL AT RECEIVING IT',
     'LONG TERM VISION: EXTENDS TO HAPPY HOUR'],
    ['PRODUCTIVITY: ONLY MEASURABLE VIA NAPS',
     'ATTITUDE: CURRENTLY PENDING INVESTIGATION',
     'PERSONAL HYGIENE: NO COMMENT WHATSOEVER',
     'RELIABILITY: ERROR FOUR OH FOUR NOT FOUND',
     'FUTURE POTENTIAL: A THEORETICAL MAXIMUM'],
    ['WORK ETHIC: PURELY THEORETICAL CONSTRUCT',
     'RELIABILITY: PLEASE SEE ABSENCE RECORDS',
     'PERSONAL GROWTH: IN DESK SNACK STOCKPILE',
     'AMBITION: DIRECTED COMPLETELY INWARD',
     'PROFESSIONAL OUTLOOK: AGGRESSIVELY MEH'],

    // Style C — Direct roast
    ['NOT TECHNICALLY THE WORST EMPLOYEE HERE',
     'JUST HISTORICALLY THE MOST CONSISTENT',
     'AT BEING COMPLETELY UNAVAILABLE FOR WORK',
     'WHICH TAKES A VERY SPECIAL KIND OF FOCUS',
     'THAT WE HONESTLY HAVE TO RESPECT A BIT'],
    ['SOMEHOW STILL GAINFULLY EMPLOYED HERE',
     'DESPITE MULTIPLE YEARS OF CLEAR EVIDENCE',
     'THAT STRONGLY SUGGESTS THE OPPOSITE CALL',
     'HR MAINTAINS A DEDICATED FILE ON THIS',
     'THE FILE NOW HAS ITS OWN FILE CABINET'],
    ['CONSISTENTLY MAKES OTHERS LOOK TALENTED',
     'STRICTLY BY COMPARISON AND NEVER EVER',
     'THROUGH ANY FORM OF REAL COLLABORATION',
     'TEAM MVP MEASURED PURELY BY SUBTRACTION',
     'A TRUE INSPIRATION IN REVERSE HONESTLY'],
    ['WOULD PROBABLY BE MISSED AROUND HERE',
     'IF LITERALLY ANYONE HAD EVER NOTICED',
     'THAT THEY WERE ACTUALLY IN THE BUILDING',
     'DESK HAS BEEN EMPTY FOR THREE WEEKS NOW',
     'UPDATE: THEY WERE ON VACATION APPARENTLY'],
    ['HAS NEVER ACTUALLY BEEN FORMALLY FIRED',
     'WHICH IS VERY HONESTLY AND GENUINELY',
     'THE SINGLE BIGGEST SURPRISE THIS QUARTER',
     'POSSIBLY THE MOST SHOCKING THING ALL YEAR',
     'SEVERAL BETS WERE LOST OVER THIS FACT'],
    ['CONSISTENTLY DOES THE ABSOLUTE BARE MIN',
     'AND YET SOMEHOW STILL ALWAYS MANAGES TO',
     'FIND EVEN THAT LEVEL TOTALLY EXHAUSTING',
     'TOOK A FIFTEEN MINUTE BREAK HALFWAY THRU',
     'READING THIS VERY PERFORMANCE REVIEW'],
    ['PEAK INDIVIDUAL PERFORMANCE WAS RECORDED',
     'ON ONE SPECIFIC TUESDAY BACK IN MARCH',
     'THE TEAM IS STILL ACTIVELY INVESTIGATING',
     'WHAT EXACTLY HAPPENED ON THAT SINGLE DAY',
     'SECURITY CAMERA FOOTAGE INCONCLUSIVE'],
    ['CONTRIBUTES SIGNIFICANTLY TO TEAM MORALE',
     'PRIMARILY BY GIVING LITERALLY EVERYONE',
     'A CONVENIENT PERSON TO COMPLAIN ABOUT',
     'A TRULY UNIFYING FORCE IN THE DEPARTMENT',
     'JUST ABSOLUTELY NOT IN ANY POSITIVE WAY'],

    // Style D — Rating + comment
    ['OVERALL PERFORMANCE RATING: TWO OF TEN',
     'OFFICIAL RECOMMENDATION: WOULD NOT REHIRE',
     'UNEXPLAINED STATUS: STILL HERE EVERY DAY',
     'BUYOUT WAS CONSIDERED BUT TOO EXPENSIVE',
     'CURRENT STRATEGY: SIMPLY WAIT IT OUT'],
    ['FINAL PERFORMANCE SCORE: FULLY REDACTED',
     'BY THE LEGAL TEAM FOR LIABILITY REASONS',
     'SEE REFERENCE FILE NUMBERS 404 THRU 407',
     'NOTE: WE ACTUALLY RAN OUT OF FILE NUMBERS',
     'ADDITIONAL STORAGE HAS BEEN REQUISITIONED'],
    ['THIS ANNUAL REVIEW HAS BEEN POSTPONED',
     'THE ASSIGNED REVIEWER REQUIRED THERAPY',
     'AFTER THE PREVIOUS QUARTERLY ATTEMPT',
     'A NEW REVIEWER HAS SINCE BEEN ASSIGNED',
     'THEY ARE ALREADY REQUESTING A TRANSFER'],
    ['QUARTERLY GOALS: ZERO OF SEVEN WERE MET',
     'GOAL NUMBER EIGHT WAS ADDED: TRY HARDER',
     'STATUS OF GOAL EIGHT: ALSO NOT MET YET',
     'GOAL NINE: SUCCESSFULLY MEET ANY GOAL',
     'STATUS OF GOAL NINE: PENDING FOREVER'],
    ['SELF ASSESSMENT SCORE: TEN OUT OF TEN',
     'DIRECT MANAGER REVIEW: PLEASE SEE ME',
     'HUMAN RESOURCES REVIEW: PLEASE SEE LAWYER',
     'PEER FEEDBACK SUMMARY: DECLINED COMMENT',
     'CUSTOMER SATISFACTION RATING: ONE STAR'],

    // Style E — Extended narrative
    ['HAS EXTREMELY STRONG PERSONAL OPINIONS',
     'ABOUT A WIDE RANGE OF UNRELATED TOPICS',
     'THAT ABSOLUTELY DO NOT CONCERN THEM HERE',
     'AND SUSPICIOUSLY WEAK OPINIONS ON THINGS',
     'THAT ARE LITERALLY PART OF THEIR JOB'],
    ['UNDISPUTED COMPANY REPLY ALL CHAMPION',
     'THREE CONSECUTIVE YEARS AND STILL GOING',
     'WE HAVE FORMALLY ASKED THEM TO STOP THIS',
     'THE REQUEST WAS POLITELY MADE FOUR TIMES',
     'THEY REPLIED ALL TO ACKNOWLEDGE RECEIPT'],
    ['ONCE PUBLICLY DESCRIBED AS ESSENTIAL STAFF',
     'BY A PERSON WHO WAS IMMEDIATELY AND VERY',
     'FIRMLY CORRECTED BY MULTIPLE WITNESSES',
     'THAT PERSON HAS SINCE BEEN TRANSFERRED',
     'AND THEN INEXPLICABLY PROMOTED SOMEHOW'],
    ['TAKES CREDIT ABSOLUTELY BEAUTIFULLY HERE',
     'DEFLECTS ALL BLAME WITH GENUINE ARTISTRY',
     'DOES NEITHER ACTUAL JOB PARTICULARLY WELL',
     'BUT TRULY EXCELS AT LEAVING THE BUILDING',
     'RIGHT BEFORE ANY REAL CLEANUP HAS TO START'],
    ['FORMALLY SUBMITTED A REQUEST FOR A RAISE',
     'MANAGEMENT RESPONDED ASKING FOR RESULTS',
     'THE RESULTING STALEMATE CONTINUES TODAY',
     'WE ARE NOW ENTERING THE FOURTH QUARTER',
     'OF THIS PARTICULAR SALARY NEGOTIATION'],
  ],

  // ─── Hash ──────────────────────────────────────────────

  _sfHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
    }
    return hash;
  },

  // ─── Character Cell Helpers ────────────────────────────

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
      cell.querySelector('.static-top').textContent = toChar;
      cell.querySelector('.static-bottom').textContent = toChar;
      cell.querySelector('.flap-top').textContent = fromChar;
      cell.querySelector('.flap-bottom').textContent = toChar;
      const flapTop = cell.querySelector('.flap-top');
      const flapBottom = cell.querySelector('.flap-bottom');
      flapTop.classList.add('flipping');
      flapBottom.classList.add('flipping');
      setTimeout(() => {
        flapTop.classList.remove('flipping');
        flapBottom.classList.remove('flipping');
        this._setChar(cell, toChar);
        resolve();
      }, 90);
    });
  },

  async _cycleToChar(cell, targetChar, currentChar) {
    if (!animationsEnabled()) {
      this._setChar(cell, targetChar);
      return;
    }
    const cycles = 3 + (this._sfHash(targetChar + Math.random()) % 2); // 3-4 intermediates
    let prev = currentChar || ' ';
    for (let i = 0; i < cycles; i++) {
      const next = this.CHARSET[Math.floor(Math.random() * this.CHARSET.length)];
      await this._flipChar(cell, prev, next);
      prev = next;
    }
    await this._flipChar(cell, prev, targetChar);
  },

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // ─── Badge Data Helpers ────────────────────────────────

  _getDivision(badge) {
    return getDivisionForDept(badge.department, badge.isBandMember);
  },

  _getReviewQuote(name) {
    const h = this._sfHash(name);
    return this.REVIEW_QUOTES[h % this.REVIEW_QUOTES.length];
  },

  // ─── Grid Construction ─────────────────────────────────

  _buildGrid() {
    this._grid = document.createElement('div');
    this._grid.className = 'rb-grid';
    this._cells = [];
    for (let r = 0; r < this.ROWS; r++) {
      const row = [];
      for (let c = 0; c < this.COLS; c++) {
        const cell = this._createCharCell();
        this._grid.appendChild(cell);
        row.push(cell);
      }
      this._cells.push(row);
    }
    return this._grid;
  },

  // ─── Badge Tile Panel ──────────────────────────────────

  _buildBadgePanel() {
    this._badgePanel = document.createElement('div');
    this._badgePanel.className = 'rb-badge-panel';

    this._badgeGrid = document.createElement('div');
    this._badgeGrid.className = 'rb-badge-grid';

    this._badgeCells = [];
    for (let r = 0; r < this.BADGE_ROWS; r++) {
      const row = [];
      for (let c = 0; c < this.BADGE_COLS; c++) {
        const cell = this._createCharCell();
        cell.classList.add('rb-badge-tile');
        this._badgeGrid.appendChild(cell);
        row.push(cell);
      }
      this._badgeCells.push(row);
    }

    this._badgePanel.appendChild(this._badgeGrid);

    // Click handler for simplified badge card
    this._badgePanel.addEventListener('click', () => {
      if (this._currentBadge) {
        this._openPacket(this._currentBadge);
      }
    });

    return this._badgePanel;
  },

  // ─── Canvas Color Sampling ─────────────────────────────

  _sampleBadgeColors(imgSrc) {
    return new Promise((resolve) => {
      const cols = this.BADGE_COLS;
      const rows = this.BADGE_ROWS;

      if (!this._badgeCanvas) {
        this._badgeCanvas = document.createElement('canvas');
      }
      this._badgeCanvas.width = cols;
      this._badgeCanvas.height = rows;
      const ctx = this._badgeCanvas.getContext('2d');

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.drawImage(img, 0, 0, cols, rows);
        const imageData = ctx.getImageData(0, 0, cols, rows);
        const colors = [];
        for (let r = 0; r < rows; r++) {
          const row = [];
          for (let c = 0; c < cols; c++) {
            const i = (r * cols + c) * 4;
            const red = imageData.data[i];
            const green = imageData.data[i + 1];
            const blue = imageData.data[i + 2];
            // Luminance check — dark pixels become default tile dark
            const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
            if (luminance < 15) {
              row.push('#252525');
            } else {
              row.push('#' +
                red.toString(16).padStart(2, '0') +
                green.toString(16).padStart(2, '0') +
                blue.toString(16).padStart(2, '0'));
            }
          }
          colors.push(row);
        }
        resolve(colors);
      };
      img.onerror = () => {
        // Fallback: all tiles dark
        const colors = [];
        for (let r = 0; r < rows; r++) {
          const row = [];
          for (let c = 0; c < cols; c++) {
            row.push('#252525');
          }
          colors.push(row);
        }
        resolve(colors);
      };
      img.src = imgSrc;
    });
  },

  _setTileColor(cell, color) {
    const flaps = cell.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
    flaps.forEach(el => {
      el.style.background = color;
      el.style.color = color;
    });
    this._setChar(cell, ' ');
  },

  _clearTileColor(cell) {
    const flaps = cell.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
    flaps.forEach(el => {
      el.style.background = '';
      el.style.color = '';
    });
  },

  async _animateBadgeTilesToDark() {
    if (!this._badgeCells.length) return;
    const promises = [];
    let idx = 0;
    for (let r = 0; r < this.BADGE_ROWS; r++) {
      for (let c = 0; c < this.BADGE_COLS; c++) {
        const cell = this._badgeCells[r][c];
        const delay = idx * 5;
        promises.push(new Promise(resolve => {
          setTimeout(() => {
            this._setTileColor(cell, '#252525');
            resolve();
          }, delay);
        }));
        idx++;
      }
    }
    await Promise.all(promises);
  },

  async _animateBadgeTilesToColors(colors) {
    if (!this._badgeCells.length) return;
    const promises = [];
    let idx = 0;
    for (let r = 0; r < this.BADGE_ROWS; r++) {
      for (let c = 0; c < this.BADGE_COLS; c++) {
        const cell = this._badgeCells[r][c];
        const color = colors[r][c];
        const delay = idx * 20;
        promises.push(new Promise(resolve => {
          setTimeout(() => {
            this._setTileColor(cell, color);
            resolve();
          }, delay);
        }));
        idx++;
      }
    }
    await Promise.all(promises);
  },

  // ─── Badge Crossfade Reveal ─────────────────────────────

  _hideBadgeReveal() {
    if (this._badgeRevealImg) {
      this._badgeRevealImg.remove();
      this._badgeRevealImg = null;
    }
  },

  _revealBadgeImage(imgSrc) {
    this._hideBadgeReveal();
    if (!this._badgePanel) return;

    const img = document.createElement('img');
    img.className = 'rb-badge-reveal';
    img.src = imgSrc;
    img.alt = '';
    img.draggable = false;
    // Start transparent, fade in after tiles land
    img.style.opacity = '0';
    this._badgePanel.appendChild(img);
    this._badgeRevealImg = img;

    // Fade in after 500ms settle
    setTimeout(() => {
      if (this._badgeRevealImg === img) {
        img.style.opacity = '1';
      }
    }, 500);
  },

  // ─── Tile Sizing ───────────────────────────────────────

  _sizeTiles() {
    if (!this._grid) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight - 50; // account for view switcher bar
    const gap = 1;
    const pad = 40;
    const hasBadgePanel = vw >= 1024;

    // Board takes ~72% of width when badge panel is visible
    const availW = hasBadgePanel ? Math.floor(vw * 0.72) : vw;
    const maxTileW = Math.floor((availW - pad * 2 - gap * (this.COLS - 1)) / this.COLS);
    const maxTileH = Math.floor((vh - pad * 2 - gap * (this.ROWS - 1)) / this.ROWS);
    // Maintain 1:1.82 aspect ratio
    let tileW = maxTileW;
    let tileH = Math.round(tileW * 1.82);
    if (tileH > maxTileH) {
      tileH = maxTileH;
      tileW = Math.round(tileH / 1.82);
    }
    // Minimum size
    tileW = Math.max(tileW, 10);
    tileH = Math.max(tileH, 18);
    // Font size ~145% of tile width
    const fontSize = Math.max(12, Math.round(tileW * 1.45));
    // Line height matches tile height for vertical centering
    this._grid.style.setProperty('--rb-line-h', tileH + 'px');
    this._grid.style.setProperty('--rb-tile-w', tileW + 'px');
    this._grid.style.setProperty('--rb-tile-h', tileH + 'px');
    this._grid.style.setProperty('--rb-font', fontSize + 'px');

    // Size badge tiles so panel height matches board height
    // Square tiles — 12:16 grid ratio (0.75:1) matches headshot aspect (0.749:1)
    if (this._badgeGrid) {
      const boardGridH = this.ROWS * tileH + (this.ROWS - 1);
      const badgeTileH = Math.max(10, Math.floor(boardGridH / this.BADGE_ROWS));
      this._badgeGrid.style.setProperty('--rb-badge-tile-h', badgeTileH + 'px');
    }
  },

  // ─── Row Text Helpers ──────────────────────────────────

  _setRowText(rowIdx, text, startCol) {
    startCol = startCol || 0;
    const maxLen = this.COLS - startCol;
    const padded = text.toUpperCase().padEnd(maxLen, ' ').substring(0, maxLen);
    for (let c = 0; c < maxLen; c++) {
      this._setChar(this._cells[rowIdx][startCol + c], padded[c]);
    }
  },

  _centerCol(text) {
    return Math.max(0, Math.floor((this.COLS - text.length) / 2));
  },

  // ─── Name Color Helper ─────────────────────────────────

  _setRowDivisionColor(rowIdx, divColor, startCol, length) {
    for (let c = startCol; c < startCol + length && c < this.COLS; c++) {
      const cell = this._cells[rowIdx][c];
      const flaps = cell.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
      flaps.forEach(el => {
        el.style.color = divColor;
      });
    }
  },

  _clearRowColor(rowIdx) {
    for (let c = 0; c < this.COLS; c++) {
      const cell = this._cells[rowIdx][c];
      const flaps = cell.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
      flaps.forEach(el => {
        el.style.color = '';
      });
    }
  },

  // ─── Accent Tile (division color block) ─────────────────

  _setAccentTile(rowIdx, color) {
    const cell = this._cells[rowIdx][0];
    const flaps = cell.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
    flaps.forEach(el => {
      el.style.background = color;
      el.style.color = color;
    });
    this._setChar(cell, ' ');
  },

  _clearAccentTile(rowIdx) {
    const cell = this._cells[rowIdx][0];
    const flaps = cell.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
    flaps.forEach(el => {
      el.style.background = '';
      el.style.color = '';
    });
  },

  // ─── Color Flash Helper ────────────────────────────────

  _flashTileColor(cell, divColor) {
    const flaps = cell.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
    flaps.forEach(el => {
      el.style.transition = 'background 150ms ease';
      el.style.background = divColor;
    });
    setTimeout(() => {
      flaps.forEach(el => {
        el.style.transition = 'background 300ms ease';
        el.style.background = '';
      });
      setTimeout(() => {
        flaps.forEach(el => {
          el.style.transition = '';
        });
      }, 350);
    }, 150);
  },

  // ─── Display Badge ─────────────────────────────────────

  _displayBadgeInstant(badge) {
    const name = (badge.name || 'UNKNOWN').toUpperCase();
    const title = (badge.title || 'EMPLOYEE').toUpperCase();
    const div = this._getDivision(badge);
    const divColor = this.DIVISION_COLORS[div] || '#F5E6C8';
    const quote = this._getReviewQuote(name);

    // Clear any previous row colors
    for (let r = 0; r < this.ROWS; r++) this._clearRowColor(r);

    // Row 0: centered name in division color
    const nameStart = this._centerCol(name);
    this._setRowText(0, ' '.repeat(nameStart) + name, 0);
    this._setRowDivisionColor(0, divColor, nameStart, name.length);

    // Row 1: centered title in division color
    const titleStart = this._centerCol(title);
    this._setRowText(1, ' '.repeat(titleStart) + title, 0);
    this._setRowDivisionColor(1, divColor, titleStart, title.length);

    // Row 2: blank spacer
    this._setRowText(2, '', 0);

    // Rows 3-8: pre-formatted review lines (up to 6)
    const numQuoteLines = Math.min(quote.length, 6);
    for (let i = 0; i < numQuoteLines; i++) {
      this._setRowText(3 + i, quote[i] || '', 0);
    }
    // Clear remaining rows
    for (let i = numQuoteLines; i < this.ROWS - 3; i++) {
      this._setRowText(3 + i, '', 0);
    }

    this._currentBadge = badge;

    // Load badge tile colors then reveal
    const imgSrc = '/api/badge/' + encodeURIComponent(badge.employeeId || '') + '/headshot';
    this._hideBadgeReveal();
    this._sampleBadgeColors(imgSrc).then(colors => {
      for (let r = 0; r < this.BADGE_ROWS; r++) {
        for (let c = 0; c < this.BADGE_COLS; c++) {
          if (this._badgeCells[r] && this._badgeCells[r][c]) {
            this._setTileColor(this._badgeCells[r][c], colors[r][c]);
          }
        }
      }
      // Crossfade: sharp PNG fades in over the tiles
      this._revealBadgeImage(imgSrc);
    });
  },

  async _displayBadgeAnimated(badge) {
    const name = (badge.name || 'UNKNOWN').toUpperCase();
    const title = (badge.title || 'EMPLOYEE').toUpperCase();
    const div = this._getDivision(badge);
    const divColor = this.DIVISION_COLORS[div] || '#F5E6C8';
    const quote = this._getReviewQuote(name);

    // Pre-sample badge colors before animation starts
    const imgSrc = '/api/badge/' + encodeURIComponent(badge.employeeId || '') + '/headshot';
    const badgeColorsPromise = this._sampleBadgeColors(imgSrc);

    // Hide previous reveal image before new animation
    this._hideBadgeReveal();

    // Phase A: Badge tiles flip to dark + Board text cascade start simultaneously
    const badgeDarkPromise = this._animateBadgeTilesToDark();

    // Clear previous row colors
    for (let r = 0; r < this.ROWS; r++) this._clearRowColor(r);

    // Prepare target text for all 10 rows
    const nameStart = this._centerCol(name);
    const titleStart = this._centerCol(title);
    const rowTexts = [];
    rowTexts.push((' '.repeat(nameStart) + name).padEnd(this.COLS, ' ').substring(0, this.COLS));
    rowTexts.push((' '.repeat(titleStart) + title).padEnd(this.COLS, ' ').substring(0, this.COLS));
    rowTexts.push(' '.repeat(this.COLS)); // blank spacer
    const numQuoteLines = Math.min(quote.length, 6);
    for (let i = 0; i < numQuoteLines; i++) {
      rowTexts.push((quote[i] || '').padEnd(this.COLS, ' ').substring(0, this.COLS));
    }
    // Pad remaining rows blank
    while (rowTexts.length < this.ROWS) {
      rowTexts.push(' '.repeat(this.COLS));
    }

    // Phase B: Board column cascade with color flash
    const stagger = 50;
    const boardPromises = [];

    for (let c = 0; c < this.COLS; c++) {
      for (let r = 0; r < this.ROWS; r++) {
        const targetChar = rowTexts[r][c].toUpperCase();
        const currentChar = this._cells[r][c].querySelector('.static-top').textContent || ' ';
        if (targetChar === currentChar) continue;
        const col = c;
        const row = r;
        boardPromises.push(
          new Promise(resolve => {
            setTimeout(() => {
              // Color flash on this tile
              this._flashTileColor(this._cells[row][col], divColor);
              this._cycleToChar(this._cells[row][col], targetChar, currentChar).then(resolve);
            }, col * stagger);
          })
        );
      }
    }

    // Phase B (badge): animate to new colors simultaneously
    const badgeColors = await badgeColorsPromise;
    await badgeDarkPromise;
    const badgeColorPromise = this._animateBadgeTilesToColors(badgeColors);

    await Promise.all(boardPromises);

    // Set name and title division color after text lands
    this._setRowDivisionColor(0, divColor, nameStart, name.length);
    this._setRowDivisionColor(1, divColor, titleStart, title.length);

    await badgeColorPromise;

    // Crossfade: sharp PNG fades in over the tiles
    this._revealBadgeImage(imgSrc);

    this._currentBadge = badge;
  },

  // ─── Rotation ──────────────────────────────────────────

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

    // Display first badge instantly
    this._displayBadgeInstant(this._shuffledBadges[0]);

    const holdTime = this._allBadges.length < 3 ? 20000 : 12000;

    this._rotationTimer = setInterval(() => {
      if (this._isArrivalActive) return;
      this._rotationIndex++;
      if (this._rotationIndex >= this._shuffledBadges.length) {
        this._shuffledBadges = this._shuffle(this._allBadges);
        this._rotationIndex = 0;
      }
      this._displayBadgeAnimated(this._shuffledBadges[this._rotationIndex]);
    }, holdTime);
  },

  _stopRotation() {
    if (this._rotationTimer) {
      clearInterval(this._rotationTimer);
      this._rotationTimer = null;
    }
  },

  _resumeRotation() {
    this._stopRotation();
    const holdTime = this._allBadges.length < 3 ? 20000 : 12000;
    this._rotationTimer = setInterval(() => {
      if (this._isArrivalActive) return;
      this._rotationIndex++;
      if (this._rotationIndex >= this._shuffledBadges.length) {
        this._shuffledBadges = this._shuffle(this._allBadges);
        this._rotationIndex = 0;
      }
      this._displayBadgeAnimated(this._shuffledBadges[this._rotationIndex]);
    }, holdTime);
  },

  // ─── Arrival Interruption ──────────────────────────────

  async _processArrival(badge) {
    this._isArrivalActive = true;
    this._stopRotation();

    const div = this._getDivision(badge);
    const divColor = this.DIVISION_COLORS[div] || '#F5E6C8';

    // Hide previous reveal image
    this._hideBadgeReveal();

    // Pre-sample badge colors
    const imgSrc = '/api/badge/' + encodeURIComponent(badge.employeeId || '') + '/headshot';
    const badgeColorsPromise = this._sampleBadgeColors(imgSrc);

    // PHASE 1: Color wave across all board tiles + badge tiles
    const allCells = [];
    for (let r = 0; r < this.ROWS; r++) {
      for (let c = 0; c < this.COLS; c++) {
        allCells.push(this._cells[r][c]);
      }
    }
    // Include badge tiles in the wave
    for (let r = 0; r < this.BADGE_ROWS; r++) {
      for (let c = 0; c < this.BADGE_COLS; c++) {
        if (this._badgeCells[r] && this._badgeCells[r][c]) {
          allCells.push(this._badgeCells[r][c]);
        }
      }
    }

    allCells.forEach((cell, i) => {
      setTimeout(() => {
        const flaps = cell.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
        flaps.forEach(el => {
          el.style.background = divColor;
          el.style.color = '#111';
          el.style.transition = 'background 200ms ease';
        });
      }, i * 8);
    });

    await this._delay(allCells.length * 8 + 200);

    // PHASE 2: Reveal — flip to new employee content with enhanced cascade
    const name = (badge.name || 'UNKNOWN').toUpperCase();
    const title = (badge.title || 'EMPLOYEE').toUpperCase();
    const quote = this._getReviewQuote(name);

    const nameStart = this._centerCol(name);
    const rowTexts = [];
    rowTexts.push((' '.repeat(nameStart) + name).padEnd(this.COLS, ' ').substring(0, this.COLS));
    const titleStart = this._centerCol(title);
    rowTexts.push((' '.repeat(titleStart) + title).padEnd(this.COLS, ' ').substring(0, this.COLS));
    rowTexts.push(' '.repeat(this.COLS));
    const numQuoteLines = Math.min(quote.length, 6);
    for (let i = 0; i < numQuoteLines; i++) {
      rowTexts.push((quote[i] || '').padEnd(this.COLS, ' ').substring(0, this.COLS));
    }
    while (rowTexts.length < this.ROWS) {
      rowTexts.push(' '.repeat(this.COLS));
    }

    // Clear row colors
    for (let r = 0; r < this.ROWS; r++) this._clearRowColor(r);

    // Board column cascade with color flash
    const colPromises = [];
    for (let c = 0; c < this.COLS; c++) {
      for (let r = 0; r < this.ROWS; r++) {
        const targetChar = rowTexts[r][c].toUpperCase();
        const col = c;
        const row = r;
        colPromises.push(
          new Promise(resolve => {
            setTimeout(() => {
              const cell = this._cells[row][col];
              this._setChar(cell, targetChar);
              // Remove color wave from this tile with transition
              const flaps = cell.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
              flaps.forEach(el => {
                el.style.transition = 'background 300ms ease, color 300ms ease';
                el.style.background = '';
                el.style.color = '';
              });
              setTimeout(() => {
                flaps.forEach(el => { el.style.transition = ''; });
              }, 400);
              resolve();
            }, col * 50);
          })
        );
      }
    }

    // Badge tiles: color wave clear + new colors simultaneously
    const badgeColors = await badgeColorsPromise;
    const badgeColorPromise = this._animateBadgeTilesToColors(badgeColors);

    await Promise.all(colPromises);

    // Set name and title division color
    this._setRowDivisionColor(0, divColor, nameStart, name.length);
    this._setRowDivisionColor(1, divColor, titleStart, title.length);

    await badgeColorPromise;

    // Crossfade: sharp PNG fades in over the tiles
    this._revealBadgeImage(imgSrc);

    this._currentBadge = badge;

    // PHASE 3: Hold for 15 seconds
    await this._delay(15000);

    // PHASE 4: Resume
    this._isArrivalActive = false;

    if (!this._allBadges.find(b => b.employeeId === badge.employeeId)) {
      this._allBadges.push(badge);
      this._shuffledBadges = this._shuffle(this._allBadges);
    }

    if (this._arrivalQueue.length > 0) {
      const next = this._arrivalQueue.shift();
      this._processArrival(next);
    } else {
      this._resumeRotation();
    }
  },

  // ─── Simplified Badge Card (image only) ────────────────

  _openPacket(badge) {
    this._closePacket();

    const name = badge.name || 'UNKNOWN';
    const badgeImgSrc = '/api/badge/' + encodeURIComponent(badge.employeeId || '') + '/headshot';

    const overlay = document.createElement('div');
    overlay.className = 'sf-badge-card-overlay';

    const card = document.createElement('div');
    card.className = 'sf-badge-card rb-badge-card-simple';

    card.innerHTML =
      '<button class="sf-badge-card-close">&times;</button>' +
      '<div class="sf-badge-card-img">' +
        '<img src="' + esc(badgeImgSrc) + '" alt="Badge: ' + esc(name) + '" />' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(card);

    const close = () => this._closePacket();
    overlay.addEventListener('click', close);
    card.querySelector('.sf-badge-card-close').addEventListener('click', close);

    this._packetOverlay = overlay;
    this._packetPanel = card;

    this._escHandler = (e) => {
      if (e.key === 'Escape') this._closePacket();
    };
    document.addEventListener('keydown', this._escHandler);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.add('open');
        card.classList.add('open');
      });
    });

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

  // ─── Renderer Interface ────────────────────────────────

  async init(container, stats) {
    this._container = container;
    this._stats = stats;

    // Build stage (flex row: board + badge panel)
    this._stage = document.createElement('div');
    this._stage.className = 'rb-stage';

    // Title above board
    const titleDiv = document.createElement('div');
    titleDiv.className = 'rb-title';
    titleDiv.textContent = 'AI PERFORMANCE REVIEW';

    // Board wrapper
    const board = document.createElement('div');
    board.className = 'rb-board';

    board.appendChild(titleDiv);
    const grid = this._buildGrid();
    board.appendChild(grid);

    // Click handler for badge card
    board.addEventListener('click', () => {
      if (this._currentBadge) {
        this._openPacket(this._currentBadge);
      }
    });

    this._stage.appendChild(board);

    // Badge tile panel
    const badgePanel = this._buildBadgePanel();
    this._stage.appendChild(badgePanel);

    container.appendChild(this._stage);

    // Size tiles
    this._sizeTiles();

    // Resize handler
    this._resizeHandler = () => this._sizeTiles();
    window.addEventListener('resize', this._resizeHandler);

    // Fetch badges
    try {
      let page = 1;
      let badges = [];
      while (true) {
        const resp = await fetch('/api/orgchart?page=' + page + '&limit=100');
        const data = await resp.json();
        if (data.badges && data.badges.length) {
          badges = badges.concat(data.badges);
          if (badges.length >= (data.total || 0)) break;
          page++;
        } else {
          break;
        }
      }
      this._allBadges = badges;
    } catch {
      this._allBadges = [];
    }

    // Start rotation
    if (this._allBadges.length > 0) {
      this._startRotation();
    }
  },

  addBadge(badge) {
    this._arrivalQueue.push(badge);
    if (!this._isArrivalActive) {
      const next = this._arrivalQueue.shift();
      this._processArrival(next);
    }
  },

  destroy() {
    this._stopRotation();
    this._closePacket();
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._container) {
      this._container.innerHTML = '';
    }
    this._container = null;
    this._stats = null;
    this._stage = null;
    this._grid = null;
    this._badgePanel = null;
    this._badgeGrid = null;
    this._badgeCells = [];
    this._badgeCanvas = null;
    this._cells = [];
    this._allBadges = [];
    this._shuffledBadges = [];
    this._rotationIndex = 0;
    this._arrivalQueue = [];
    this._isArrivalActive = false;
    this._currentBadge = null;
  },
};
