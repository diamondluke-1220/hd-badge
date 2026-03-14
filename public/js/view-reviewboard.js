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
  _badgeCol: null,          // column wrapper for AI indicator + badge panel
  _aiIndicator: null,       // AI loading indicator element
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
  _boardEl: null,

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

  SKILLS: [
    'PASSIVE AGGRESSION . REPLY-ALL . MUTING',
    'BLAME SHIFT . CALENDAR TETRIS . GOSSIP',
    'COFFEE RUNS . DESK NAPPING . UNMUTING',
    'EXCEL MACROS . CHAIR SPINNING . FEEDBACK',
    'WIFI FIXES . CABLE MGMT . CREATIVE EXCUSES',
    'MEETING DODGING . SNACKING . TUNING OUT',
    'INBOX DENIAL . THERMOSTAT WARS . SOLOS',
    'TICKET ESCALATION . JARGON . VOLUME CTRL',
    'POWERPOINT . LUNCH THEFT DENIAL . ENCORES',
    'STANDING DESK . VPN EXCUSES . EMOJI ABUSE',
    'SLACK STATUS . ZOOM BACKGROUNDS . SETLISTS',
    'BADGE SCANS . HEADPHONE ZONE . SOUNDCHECK',
    'FONT CRIMES . DROP THE MIC . FIREWALLS',
    'MEMO DRAFTS . CHAIR RACING . AMP TO ELEVEN',
    'AVOIDING EYE CONTACT . SIGHS . HEADLINING',
    'SCREEN SHARING . SIDE PROJECTS . HARMONICS',
    'PTO REQUESTS . BACKUP VOCALS . SHORTCUTS',
    'SYNERGY . CROWD CONTROL . MUTE BUTTON',
    'MERCH TABLE . CABLE MGMT . PAPER TRAILS',
    'OPENER SLOT . PARKING LOT MEETINGS . RIFFS',
  ],

  REVIEW_QUOTES: [
    // ── Style A: Fake review form ──────────────
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
    ['STRENGTHS: WORLD CLASS CHAIR WARMING',
     'WEAKNESSES: EVERY SINGLE LISTED JOB DUTY',
     'RECOMMENDATION: PROMOTE TO CUSTOMER',
     'TIMELINE: AS SOON AS HUMANLY POSSIBLE',
     'BACKUP PLAN: QUIETLY RENAME THE ROLE'],
    ['STRENGTHS: TYPES VERY FAST AND LOUDLY',
     'WEAKNESSES: NOTHING TYPED IS EVER USEFUL',
     'RECOMMENDATION: GIVE THEM A KEYBOARD',
     'WITH NO USB CABLE ATTACHED TO ANYTHING',
     'PRODUCTIVITY UNCHANGED SINCE EXPERIMENT'],
    ['STRENGTHS: EXCELLENT LEAVE APPLICATIONS',
     'WE RECOGNIZED A HIDDEN TALENT FOR FICTION',
     'AFTER READING SIX MONTHS OF SICK NOTES',
     'CREATIVE WRITING DEPT HAS BEEN NOTIFIED',
     'RECOMMENDATION: TRANSFER IMMEDIATELY'],

    // ── Style B: Rating labels ─────────────────
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
    ['INITIATIVE: ONLY DISPLAYS WHEN THREATENED',
     'TEAMWORK: ACTIVELY PREFERS THE OPPOSITE',
     'EMAIL ETIQUETTE: REPLY ALL HALL OF FAME',
     'MEETING CONDUCT: EATS FULL MEALS ON MUTE',
     'OVERALL SCORE: UNDER ACTIVE LITIGATION'],
    ['SELF AWARENESS: GAVE SELF TEN OUT OF TEN',
     'MANAGER AWARENESS: CANNOT CONFIRM OR DENY',
     'PEER FEEDBACK: UNIVERSALLY DECLINED',
     'CUSTOMER RATING: ONE STAR BUT CONSISTENT',
     'FLIGHT RISK SCORE: WE CAN ONLY HOPE'],
    ['ACCOUNTABILITY: EXPERT BLAME DEFLECTION',
     'TIME MANAGEMENT: SCHEDULES EMAILS AT 3AM',
     'OUTLOOK CALENDAR: 98 PERCENT FOCUS TIME',
     'ACTUAL FOCUS: ENTIRELY ON FANTASY LEAGUE',
     'DESK DECOR: AGGRESSIVELY MOTIVATIONAL'],

    // ── Style C: Narrative roast ───────────────
    ['NOT TECHNICALLY THE WORST EMPLOYEE HERE',
     'JUST HISTORICALLY THE MOST CONSISTENT',
     'AT BEING COMPLETELY UNAVAILABLE FOR WORK',
     'WHICH TAKES A VERY SPECIAL KIND OF FOCUS',
     'THAT WE HONESTLY HAVE TO RESPECT A BIT'],
    ['SOMEHOW STILL GAINFULLY EMPLOYED HERE',
     'DESPITE YEARS OF EVIDENCE TO THE CONTRARY',
     'HR MAINTAINS A DEDICATED FILE ON THIS',
     'THE FILE NOW HAS ITS OWN FILE CABINET'],
    ['WOULD PROBABLY BE MISSED AROUND HERE',
     'IF LITERALLY ANYONE HAD EVER NOTICED',
     'THAT THEY WERE ACTUALLY IN THE BUILDING',
     'DESK HAS BEEN EMPTY FOR THREE WEEKS NOW',
     'UPDATE: THEY WERE ON VACATION APPARENTLY'],
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
    ['HAS REACHED ROCK BOTTOM AND CONTINUES',
     'TO DIG WITH IMPRESSIVE DETERMINATION',
     'MANAGEMENT CONSIDERED INTERVENTION BUT',
     'DECIDED THE EXCAVATION WAS TOO AMUSING',
     'WE NOW MEASURE DEPTH INSTEAD OF OUTPUT'],
    ['OPENED A HELP DESK TICKET ABOUT SELF',
     'SUBJECT LINE: EMPLOYEE NOT RESPONDING',
     'IT WAS IMMEDIATELY CLOSED AS DUPLICATE',
     'OF FOURTEEN PREVIOUSLY FILED TICKETS',
     'ALL MARKED WONTFIX BY THE SAME MANAGER'],

    // ── Style D: Corporate speak decoded ───────
    ['MANAGER NOTES: IS UNUSUALLY LOYAL',
     'TRANSLATION: COMPLETELY UNHIREABLE',
     'ANYWHERE ELSE IN THE KNOWN INDUSTRY',
     'ADDENDUM: WE CHECKED JUST TO BE SURE',
     'EVEN LINKEDIN HAS STOPPED SUGGESTING'],
    ['PEER REVIEW: EXCEPTIONALLY WELL QUALIFIED',
     'WHICH IN OUR RUBRIC MEANS SPECIFICALLY',
     'NO MAJOR MISTAKES HAVE BEEN DETECTED YET',
     'EMPHASIS ON THE WORD YET'],
    ['OFFICIAL STATUS: CANDIDATE FOR FAST TRACK',
     'WHICH MEANS EVERY SINGLE MANAGER HERE',
     'HAS VOLUNTEERED TO TRANSFER THIS PERSON',
     'TO LITERALLY ANY OTHER TEAM OR BUILDING',
     'SEVERAL HAVE OFFERED TO PAY FOR THE MOVE'],
    ['CLASSIFIED INTERNALLY AS A CHANGE LEADER',
     'WHICH THE HANDBOOK DEFINES PRECISELY AS',
     'LOUDLY INDECISIVE AT EVERY OPPORTUNITY',
     'HAS STRONG OPINIONS ABOUT ALL THE THINGS',
     'THAT ARE ABSOLUTELY NONE OF THEIR CONCERN'],
    ['DESCRIBED AS NIMBLE BY UPPER MANAGEMENT',
     'MEANING THEY SURVIVED FOUR ROUNDS OF',
     'LAYOFFS AND NO ONE KNOWS WHAT THEY DO',
     'AT THIS POINT WE ARE AFRAID TO ASK'],
    ['NOTED AS HAVING A KEEN SENSE OF HUMOR',
     'WHICH IS THE HR APPROVED WAY OF SAYING',
     'THEY TELL WILDLY INAPPROPRIATE STORIES',
     'IN EVERY SINGLE ALL HANDS MEETING EVER',
     'LEGAL HAS A TEMPLATE APOLOGY ON STANDBY'],

    // ── Style E: The clueless manager ──────────
    ['THIS REVIEW WAS CLEARLY COPY PASTED FROM',
     'LAST YEARS REVIEW WHICH WAS COPY PASTED',
     'FROM THE YEAR BEFORE THAT AND SO ON BACK',
     'TO A PERSON WHO NO LONGER WORKS HERE',
     'ORIGINAL SUBJECT: UNCLEAR AT THIS POINT'],
    ['MANAGER STATED AND I QUOTE DIRECTLY HERE',
     'I AM NOT ENTIRELY SURE WHAT YOU DO EVERY',
     'DAY BUT WHATEVER IT IS PLEASE KEEP AT IT',
     'BECAUSE NOTHING HAS CAUGHT FIRE RECENTLY',
     'AND THAT IS GENUINELY THE BEST WE CAN DO'],
    ['REVIEWER DOCKED POINTS FOR NOT ARRIVING',
     'AT SEVEN AM INSTEAD OF SEVEN THIRTY AM',
     'THE EMPLOYEES SHIFT STARTS AT SEVEN THIRTY',
     'THIS WAS NOTED AND COMPLETELY IGNORED',
     'THE DEDUCTION STANDS PER MANAGEMENT'],
    ['DURING THIS REVIEW THE MANAGERS SCREEN',
     'SHARE ACCIDENTALLY REVEALED TWO TABS',
     'WHY DO MY EMPLOYEES HATE ME AND ALSO',
     'HOW TO LOOK CONFIDENT IN MEETINGS',
     'THE REVIEW WAS ADJOURNED INDEFINITELY'],

    // ── Style F: Observed behavior ─────────────
    ['ARRIVES EACH MORNING AND SPENDS THE FIRST',
     'THIRTY MINUTES LOOKING INCREDIBLY BUSY AT',
     'THEIR COMPUTER WHEN OUR MONITORING SHOWS',
     'THEY ARE IN FACT READING THE SAME FOUR',
     'WEBSITES ON A CONTINUOUS ROTATING LOOP'],
    ['APPEARS TO HAVE SET A PERSONAL GOAL OF',
     'SECURING A RAISE WITHOUT ANY ADDITIONAL',
     'EFFORT WHATSOEVER THIS QUARTER',
     'IT IS NOT GOING UNNOTICED'],
    ['AREAS FOR IMPROVEMENT: ESSENTIALLY ALL',
     'AREAS OF ACTUAL EXCELLENCE: HAS PERFECTED',
     'THE ART OF SLEEPING AT THEIR DESK WITHOUT',
     'GETTING CAUGHT BY ANYONE IN MANAGEMENT',
     'CURRENT UNDETECTED RECORD: FORTY FIVE MIN'],
    ['ACCOMPLISHES MOST TASKS BY TYPING RAPIDLY',
     'AND THEN PAUSING TO SAY HMMM INTERESTING',
     'OUT LOUD TO NO ONE IN PARTICULAR NEARBY',
     'NO ONE HAS QUESTIONED THIS IN FOUR YEARS',
     'WE CONSIDER THIS THEIR GREATEST STRENGTH'],

    // ── Style G: Review process comedy ─────────
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
    ['FINAL PERFORMANCE SCORE: FULLY REDACTED',
     'BY THE LEGAL TEAM FOR LIABILITY REASONS',
     'SEE REFERENCE FILE NUMBERS 404 THRU 407',
     'NOTE: WE RAN OUT OF FILE NUMBERS ENTIRELY',
     'ADDITIONAL STORAGE HAS BEEN REQUISITIONED'],
    ['SELF ASSESSMENT SCORE: TEN OUT OF TEN',
     'DIRECT MANAGER REVIEW: PLEASE SEE ME',
     'HUMAN RESOURCES REVIEW: PLEASE SEE LAWYER',
     'PEER FEEDBACK SUMMARY: DECLINED COMMENT',
     'CUSTOMER SATISFACTION RATING: ONE STAR'],
    ['MEETS EXPECTATIONS IS THE OFFICIAL SCORE',
     'WHICH SOUNDS FINE UNTIL YOU REALIZE THAT',
     'EXPECTATIONS WERE SET CATASTROPHICALLY LOW',
     'AFTER THE INCIDENT WE DO NOT DISCUSS',
     'AND THEY STILL ONLY BARELY SQUEAKED BY'],
    ['THE THREE SIXTY REVIEW RESULTS ARE IN',
     'DIRECT REPORTS SAY: NEVER MET THIS PERSON',
     'PEERS SAY: CANNOT CONFIRM THEY EXIST',
     'MANAGER SAYS: I THOUGHT THEY WERE YOURS',
     'BUILDING SECURITY: BADGE WORKS APPARENTLY'],

    // ── Style H: Email & communication habits ──
    ['HAS BEEN SENT PER MY LAST EMAIL FOURTEEN',
     'TIMES THIS QUARTER BY THE SAME COWORKER',
     'EACH ONE INCREASINGLY BOLD AND UNDERLINED',
     'THE FINAL MESSAGE WAS ENTIRELY IN RED CAPS',
     'AND CC D THE ENTIRE EXECUTIVE TEAM TWICE'],
    ['RESPONDS TO EVERY EMAIL WITH NOTED PERIOD',
     'REGARDLESS OF CONTENT OR LEVEL OF URGENCY',
     'FIRE DRILL EVACUATION NOTICE: NOTED PERIOD',
     'MANDATORY SALARY REVIEW INVITE: NOTED',
     'THEIR OWN TERMINATION LETTER: NOTED THX'],
    ['HAS MASTERED THE ART OF LOOKING CONCERNED',
     'WHILE UNDERSTANDING ABSOLUTELY NOTHING',
     'SIGNATURE MOVE IS NODDING AND THEN SAYING',
     'LETS TAKE THIS OFFLINE ABOUT EVERYTHING',
     'EVEN THINGS THAT WERE ALREADY OFFLINE'],

    // ── Style I: Reply-all & meeting chaos ─────
    ['UNDISPUTED COMPANY REPLY ALL CHAMPION',
     'THREE CONSECUTIVE YEARS AND STILL GOING',
     'WE HAVE FORMALLY ASKED THEM TO STOP THIS',
     'THE REQUEST WAS POLITELY MADE FOUR TIMES',
     'THEY REPLIED ALL TO ACKNOWLEDGE RECEIPT'],
    ['WAS ONCE DESCRIBED AS ESSENTIAL BY A PEER',
     'WHO WAS IMMEDIATELY CORRECTED BY SEVERAL',
     'WITNESSES AND THEN FORMALLY WRITTEN UP',
     'THAT PEER HAS SINCE BEEN TRANSFERRED OUT',
     'AND THEN INEXPLICABLY PROMOTED SOMEHOW'],
    ['TAKES CREDIT ABSOLUTELY BEAUTIFULLY HERE',
     'DEFLECTS ALL BLAME WITH GENUINE ARTISTRY',
     'DOES NEITHER ACTUAL JOB PARTICULARLY WELL',
     'BUT TRULY EXCELS AT LEAVING THE BUILDING',
     'RIGHT BEFORE ANY REAL CLEANUP MUST START'],
    ['THOUGHT THEY WERE ON MUTE DURING REVIEW',
     'SAID I WOULD RATHER BE AT THE DENTIST',
     'THEY WERE NOT IN FACT ON MUTE'],
    ['WAS CAUGHT EATING A FULL MEAL WITH SIDES',
     'DURING THEIR OWN PERFORMANCE REVIEW HERE',
     'SANDWICH CHIPS SOUP AND A FULL DRINK SET',
     'OFFERED THE REVIEWER HALF A GRANOLA BAR',
     'REVIEW PAUSED FOR TWENTY MINUTES TO EAT'],
    ['SCHEDULED A MEETING TO DISCUSS WHY THERE',
     'ARE TOO MANY MEETINGS THEN INVITED THE',
     'ENTIRE DEPARTMENT TO ATTEND FOR AN HOUR',
     'FOLLOW UP MEETING SCHEDULED FOR NEXT WEEK',
     'TO REVIEW THE MINUTES FROM THIS MEETING'],

    // ── Style J: Backhanded compliments ────────
    ['SETS VERY LOW PERSONAL STANDARDS FOR SELF',
     'AND THEN CONSISTENTLY FINDS A WAY TO FAIL',
     'TO ACHIEVE EVEN THOSE MODEST BENCHMARKS',
     'WHICH REQUIRES A SPECIAL KIND OF TALENT',
     'THAT FRANKLY SCIENCE CANNOT YET EXPLAIN'],
    ['DESCRIBED BY PEERS AS A GO GETTER WHICH',
     'AFTER INVESTIGATION MEANS THEY WANDER',
     'THE HALLS WITH A CLIPBOARD ONCE AN HOUR',
     'THE CLIPBOARD HAS BEEN VERIFIED AS BLANK',
     'THEY HAVE DONE THIS FOR THREE FULL YEARS'],
    ['IF THIS EMPLOYEE WERE ANY MORE RELAXED',
     'THEY WOULD TECHNICALLY BE IN A COMA STATE',
     'VITAL SIGNS ARE PRESENT BUT PRODUCTIVITY',
     'METRICS SUGGEST OTHERWISE AND HONESTLY',
     'THE CHAIR IS DOING MOST OF THE WORK HERE'],
    ['HAS A PHOTOGRAPHIC MEMORY WHICH IS GREAT',
     'EXCEPT THE LENS CAP APPEARS TO BE GLUED',
     'PERMANENTLY SHUT SINCE ORIENTATION DAY'],
    ['WORKS WELL WHEN CORNERED AND SUPERVISED',
     'REMOVE EITHER CONDITION AND PERFORMANCE',
     'DROPS TO LEVELS WE CANNOT LEGALLY PRINT'],
    ['STRONG UNDERSTANDING OF COMPANY CULTURE',
     'WHICH IS THE POLITE WAY OF NOTING THAT',
     'THIS PERSON KNOWS WHERE ALL THE BODIES',
     'ARE BURIED AND HAS MADE THAT FACT KNOWN',
     'PROMOTION WAS APPROVED WITHOUT DEBATE'],

    // ── Style K: IT / Help Desk specific ──────
    ['RESOLVED ZERO TICKETS THIS ENTIRE QUARTER',
     'BUT DID CLOSE FORTY SEVEN AS DUPLICATE',
     'AND TWELVE MORE AS CANNOT REPRODUCE',
     'TECHNICALLY THE FASTEST RESOLUTION TIME',
     'ON THE TEAM BY A SIGNIFICANT MARGIN'],
    ['ANSWER TO EVERY SINGLE REPORTED PROBLEM',
     'IS AND ALWAYS HAS BEEN WITHOUT EXCEPTION',
     'HAVE YOU TRIED TURNING IT OFF AND BACK ON',
     'THIS HAS WORKED EXACTLY TWICE IN FIVE YRS',
     'BOTH TIMES WERE THE SAME PRINTER IN MARCH'],
    ['CHANGED THEIR PASSWORD TO INCORRECT SO',
     'THAT WHEN THEY FORGET THE COMPUTER SAYS',
     'YOUR PASSWORD IS INCORRECT AS A REMINDER',
     'THIS WAS DESCRIBED AS INNOVATIVE BY NO ONE',
     'IT BROKE SINGLE SIGN ON FOR THE BUILDING'],
    ['ENTIRE JOB IS TELLING PEOPLE THE PROBLEM',
     'IS NOT THE NETWORK AND HAS GOTTEN SO GOOD',
     'AT IT THAT THEY NOW DO IT PREEMPTIVELY',
     'BEFORE ANYONE HAS EVEN REPORTED AN ISSUE',
     'THE NETWORK IS IN FACT SOMETIMES THE ISSUE'],
    ['SUBMITTED A TICKET ABOUT THEMSELVES',
     'SUBJECT: EMPLOYEE UNRESPONSIVE PLS FIX',
     'PRIORITY: LOW',
     'STATUS: CLOSED AS KNOWN ISSUE WONT PATCH'],

    // ── Style L: Music / band crossover ───────
    ['PERFORMANCE REVIEW READS LIKE A SETLIST',
     'OPENER: SHOWED UP TWENTY MINUTES LATE',
     'DEEP CUT: BLAMED IT ON CONSTRUCTION',
     'ENCORE: LEFT THIRTY MINUTES EARLY ALSO',
     'THE CROWD WHICH WAS NOBODY DID NOT CARE'],
    ['TREATS EVERY MEETING LIKE A SOLO PROJECT',
     'STARTS QUIET THEN BUILDS TO A CRESCENDO',
     'OF OPINIONS NO ONE ASKED FOR AT ANY POINT',
     'REFUSES TO HARMONIZE WITH THE REST OF US',
     'HAS BEEN ASKED TO TURN DOWN MANY TIMES'],
    ['ONLY EMPLOYEE TO REQUEST A RIDER FOR THE',
     'QUARTERLY ALL HANDS MEETING SPECIFICALLY',
     'ROOM TEMPERATURE WATER AND GREEN SKITTLES',
     'NO BROWN M AND MS IN THE BREAK ROOM EVER',
     'REQUEST WAS DENIED BUT RESPECTED SLIGHTLY'],
    ['THIS EMPLOYEES WORKFLOW HAS A DISTINCT',
     'VERSE CHORUS VERSE STRUCTURE TO IT WHERE',
     'THE VERSE IS NOT WORKING AND THE CHORUS',
     'IS COMPLAINING ABOUT IT TO EVERYONE NEAR',
     'THE BRIDGE IS A TEN MINUTE BATHROOM BREAK'],
    ['GIVES CONSISTENT FEEDBACK IN THE FORM OF',
     'A HEAVY SIGH FOLLOWED BY DIRECT EYE ROLL',
     'OCCASIONALLY ACCOMPANIED BY A QUIET WOW',
     'THIS THREE PIECE ARRANGEMENT OF CONTEMPT',
     'HAS BECOME THEIR SIGNATURE OFFICE TRACK'],

    // ── Style M: Short form / deadpan ─────────
    ['MEH'],
    ['ADEQUATE'],
    ['NO COMMENT'],
    ['FILE NOT FOUND'],
    ['SEE PREVIOUS REVIEW'],
    ['REVIEW DECLINED BY REVIEWER'],
    ['PENDING'],
    ['THIS SPACE INTENTIONALLY LEFT BLANK'],
    ['FURTHER REVIEW DEEMED UNNECESSARY'],
    ['RESULTS INCONCLUSIVE',
     'RECOMMEND CONTINUED OBSERVATION'],
    ['NOT THE WORST',
     'NOT THE BEST EITHER',
     'JUST SORT OF HERE'],
    ['PERFORMANCE: YES TECHNICALLY'],
    ['SHOWS UP',
     'THAT IS THE COMPLETE REVIEW'],
    ['NO FURTHER QUESTIONS AT THIS TIME',
     'OR HONESTLY EVER'],
    ['EMPLOYEE EXISTS',
     'VERIFICATION: CONFIRMED',
     'ADDITIONAL NOTES: NONE'],
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
    cell.dataset.char = char;
  },

  _flipChar(cell, fromChar, toChar) {
    return new Promise(resolve => {
      if (!animationsEnabled()) {
        this._setChar(cell, toChar);
        resolve();
        return;
      }
      cell.dataset.char = toChar;
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

  _getSkills(name) {
    const h = this._sfHash(name + 'skills');
    return this.SKILLS[h % this.SKILLS.length];
  },

  // Returns [line1, line2] for skills rows (centered, with SKILLS: header)
  // line2 is empty string if it fits on one row
  _formatSkillsLines(skills) {
    const full = 'SKILLS: ' + skills;
    if (full.length <= this.COLS) {
      // Fits on one line — center it
      const pad = Math.max(0, Math.floor((this.COLS - full.length) / 2));
      return [
        (' '.repeat(pad) + full).padEnd(this.COLS, ' ').substring(0, this.COLS),
        ' '.repeat(this.COLS),
      ];
    }
    // Split at a separator — try to balance line lengths
    const header = 'SKILLS: ';
    const maxFirst = this.COLS - header.length;
    // Collect all valid split points
    const splits = [];
    let searchFrom = 0;
    while (true) {
      const next = skills.indexOf(' . ', searchFrom);
      if (next === -1 || next > maxFirst) break;
      splits.push(next);
      searchFrom = next + 3;
    }
    let splitIdx = -1;
    if (splits.length > 0) {
      // Pick the split that best balances line lengths
      // (avoids single-word overflow like just "CLOCKS" on line 2)
      let bestBalance = Infinity;
      for (const idx of splits) {
        const l1Len = header.length + idx;
        const l2Len = skills.length - idx - 3;
        const balance = Math.abs(l1Len - l2Len);
        if (balance < bestBalance) {
          bestBalance = balance;
          splitIdx = idx;
        }
      }
    }
    let line1, line2;
    if (splitIdx > 0) {
      line1 = header + skills.substring(0, splitIdx);
      line2 = skills.substring(splitIdx + 3); // skip ' . '
    } else {
      // No good split point — hard truncate
      line1 = full.substring(0, this.COLS);
      line2 = '';
    }
    // Center both lines
    const pad1 = Math.max(0, Math.floor((this.COLS - line1.length) / 2));
    const pad2 = Math.max(0, Math.floor((this.COLS - line2.length) / 2));
    return [
      (' '.repeat(pad1) + line1).padEnd(this.COLS, ' ').substring(0, this.COLS),
      (' '.repeat(pad2) + line2).padEnd(this.COLS, ' ').substring(0, this.COLS),
    ];
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
        if (r === 2 || r === 3) cell.classList.add('rb-skills-row');
        if (r === 4) cell.classList.add('rb-review-start');
        this._grid.appendChild(cell);
        row.push(cell);
      }
      this._cells.push(row);
    }
    return this._grid;
  },

  // ─── Badge Tile Panel ──────────────────────────────────

  _buildBadgePanel() {
    // Column wrapper for badge panel
    this._badgeCol = document.createElement('div');
    this._badgeCol.className = 'rb-badge-col';

    this._badgePanel = document.createElement('div');
    this._badgePanel.className = 'rb-badge-panel';
    this._badgePanel.setAttribute('role', 'img');
    this._badgePanel.setAttribute('aria-label', 'Employee headshot mosaic');

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

    this._badgeCol.appendChild(this._badgePanel);
    return this._badgeCol;
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
              row.push('#1e1e1e');
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
            row.push('#1e1e1e');
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
            this._setTileColor(cell, '#1e1e1e');
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
    const vh = window.innerHeight - 50 - 60; // view switcher bar + header row
    const gap = 1;
    const isMobile = vw < 768;
    const pad = isMobile ? 4 : 40;
    const hasBadgePanel = vw >= 1024;

    let tileW, tileH, fontSize;

    if (isMobile) {
      // Mobile: use fixed reference tiles for good text proportions,
      // then scale the whole board to fit viewport width
      tileW = 18;
      tileH = 33;
      fontSize = 26;
    } else {
      // Desktop/tablet: calculate from viewport
      const availW = hasBadgePanel ? Math.floor(vw * 0.72) : vw;
      const maxTileW = Math.floor((availW - pad * 2 - gap * (this.COLS - 1)) / this.COLS);
      const maxTileH = Math.floor((vh - pad * 2 - gap * (this.ROWS - 1)) / this.ROWS);
      tileW = maxTileW;
      tileH = Math.round(tileW * 1.82);
      if (tileH > maxTileH) {
        tileH = maxTileH;
        tileW = Math.round(tileH / 1.82);
      }
      tileW = Math.max(tileW, 10);
      tileH = Math.max(tileH, 18);
      fontSize = Math.max(12, Math.round(tileW * 1.45));
    }

    this._grid.style.setProperty('--rb-line-h', tileH + 'px');
    this._grid.style.setProperty('--rb-tile-w', tileW + 'px');
    this._grid.style.setProperty('--rb-tile-h', tileH + 'px');
    this._grid.style.setProperty('--rb-font', fontSize + 'px');

    // Scale board to fit viewport if it overflows
    if (this._boardEl) {
      const gridPad = 12; // .rb-grid padding (6px each side)
      const gridWidth = tileW * this.COLS + gap * (this.COLS - 1) + gridPad;
      const gridHeight = tileH * this.ROWS + gap * (this.ROWS - 1) + gridPad;
      const availW = vw - pad * 2;
      if (gridWidth > availW) {
        const scale = availW / gridWidth;
        this._boardEl.style.transform = 'scale(' + scale + ')';
        this._boardEl.style.transformOrigin = 'top center';
        // Collapse layout height to match scaled visual height (prevents gap)
        this._boardEl.style.height = Math.ceil(gridHeight * scale) + 'px';
        this._boardEl.style.overflow = 'visible';
      } else {
        this._boardEl.style.transform = '';
        this._boardEl.style.height = '';
        this._boardEl.style.overflow = '';
      }
    }

    // Size badge tiles so panel height matches board height
    if (this._badgeGrid) {
      const boardGridH = this.ROWS * tileH + (this.ROWS - 1);
      let badgeTileH = Math.max(10, Math.floor(boardGridH / this.BADGE_ROWS));
      if (isMobile) {
        // On mobile, size badge to fill remaining space after scaled board
        const boardScaledH = this._boardEl ? parseInt(this._boardEl.style.height) || 160 : 160;
        const headerH = 30; // title row
        const gapH = 12;
        const remainingH = vh - headerH - boardScaledH - gapH - 16;
        const badgeTileFromH = Math.floor(Math.max(remainingH, 200) / this.BADGE_ROWS);
        // Also cap to viewport width
        const badgeTileFromW = Math.floor((vw - pad * 2 - 12 - (this.BADGE_COLS - 1)) / this.BADGE_COLS);
        badgeTileH = Math.min(badgeTileFromH, badgeTileFromW);
        badgeTileH = Math.max(badgeTileH, 14);
      }
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

  // Color "SKILLS:" label and skills text in white
  _colorSkillsLabel(rowIdx, lineText, color) {
    // Find where "SKILLS:" starts in the centered line
    const idx = lineText.indexOf('SKILLS:');
    if (idx === -1) return;
    const labelLen = 7; // "SKILLS:"
    this._setRowDivisionColor(rowIdx, color, idx, labelLen);
    // Set remaining text on this row to white (after "SKILLS: ")
    const textStart = idx + labelLen + 1;
    const textLen = lineText.trimEnd().length - textStart;
    if (textLen > 0) {
      this._setRowDivisionColor(rowIdx, '#ffffff', textStart, textLen);
    }
  },

  // Dim review body text for visual hierarchy (rows 5-9)
  _dimReviewRows() {
    const dimColor = '#c8baa0';
    for (let r = 5; r < 10; r++) {
      for (let c = 0; c < this.COLS; c++) {
        const cell = this._cells[r][c];
        const flaps = cell.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
        flaps.forEach(el => { el.style.color = dimColor; });
      }
    }
  },

  // Set badge panel glow to division color
  _setBadgePanelGlow(divColor) {
    if (!this._badgePanel) return;
    this._badgePanel.style.borderColor = divColor + '44';
    this._badgePanel.style.boxShadow = '0 0 16px ' + divColor + '1a';
  },

  _clearBadgePanelGlow() {
    if (!this._badgePanel) return;
    this._badgePanel.style.borderColor = '';
    this._badgePanel.style.boxShadow = '';
  },

  // Color skills overflow row (row 3) white if it has content
  _colorSkillsOverflow(rowIdx, lineText) {
    const startIdx = lineText.search(/\S/);
    if (startIdx === -1) return; // all spaces, no overflow
    const endIdx = lineText.trimEnd().length;
    this._setRowDivisionColor(rowIdx, '#ffffff', startIdx, endIdx - startIdx);
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
    const skills = this._getSkills(name);

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

    // Rows 2-3: skills (centered, may wrap)
    const skillsLines = this._formatSkillsLines(skills);
    this._setRowText(2, skillsLines[0], 0);
    this._setRowText(3, skillsLines[1], 0);
    // Color the "SKILLS:" label with division color
    this._colorSkillsLabel(2, skillsLines[0], '#ffffff');
    this._colorSkillsOverflow(3, skillsLines[1]);

    // Row 4: blank spacer
    this._setRowText(4, '', 0);
    // Rows 5-9: pre-formatted review lines (up to 5)
    const numQuoteLines = Math.min(quote.length, 5);
    for (let i = 0; i < numQuoteLines; i++) {
      this._setRowText(5 + i, quote[i] || '', 0);
    }
    // Clear remaining rows
    for (let i = numQuoteLines; i < this.ROWS - 5; i++) {
      this._setRowText(5 + i, '', 0);
    }

    // Dim review body for visual hierarchy
    this._dimReviewRows();

    this._currentBadge = badge;
    if (this._badgePanel) this._badgePanel.setAttribute('aria-label', `Headshot mosaic of ${badge.name}`);

    // Update screen reader text with readable review content
    if (this._srText) {
      this._srText.textContent = `Performance review for ${name}, ${title}. Skills: ${skills.join(', ')}. Review: ${quote.join(' ')}`;
    }

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
      // Badge panel glow in division color
      this._setBadgePanelGlow(divColor);
    });
  },

  async _displayBadgeAnimated(badge) {
    const name = (badge.name || 'UNKNOWN').toUpperCase();
    const title = (badge.title || 'EMPLOYEE').toUpperCase();
    const div = this._getDivision(badge);
    const divColor = this.DIVISION_COLORS[div] || '#F5E6C8';
    const quote = this._getReviewQuote(name);
    const skills = this._getSkills(name);

    // Show AI indicator
    if (this._aiIndicator) this._aiIndicator.classList.add('active');

    // Pre-sample badge colors before animation starts
    const imgSrc = '/api/badge/' + encodeURIComponent(badge.employeeId || '') + '/headshot';
    const badgeColorsPromise = this._sampleBadgeColors(imgSrc);

    // Hide previous reveal image before new animation
    this._hideBadgeReveal();
    this._clearBadgePanelGlow();

    // Phase A: Badge tiles flip to dark (text colors cleared per-cell during animation)
    const badgeDarkPromise = this._animateBadgeTilesToDark();

    // Prepare target text for all 10 rows
    const nameStart = this._centerCol(name);
    const titleStart = this._centerCol(title);

    // Row layout: 0=name, 1=title, 2-3=skills, 4=blank, 5-9=review
    const nameText = (' '.repeat(nameStart) + name).padEnd(this.COLS, ' ').substring(0, this.COLS);
    const titleText = (' '.repeat(titleStart) + title).padEnd(this.COLS, ' ').substring(0, this.COLS);
    const skillsLines = this._formatSkillsLines(skills);

    const reviewTexts = [];
    const numQuoteLines = Math.min(quote.length, 5);
    for (let i = 0; i < numQuoteLines; i++) {
      reviewTexts.push((quote[i] || '').padEnd(this.COLS, ' ').substring(0, this.COLS));
    }
    while (reviewTexts.length < 5) {
      reviewTexts.push(' '.repeat(this.COLS));
    }
    // Row 4 is blank spacer between skills and review

    // ── Phase B: Name + Title sweep left-to-right (rows 0-1) ──
    // Color is set per-cell at animation start so characters flip in already colored
    const nameRange = [nameStart, nameStart + name.length];
    const titleRange = [titleStart, titleStart + title.length];
    const headerStagger = 50;
    const headerPromises = [];
    for (let c = 0; c < this.COLS; c++) {
      for (let r = 0; r < 2; r++) {
        const targetChar = (r === 0 ? nameText : titleText)[c];
        const currentChar = this._cells[r][c].querySelector('.static-top').textContent || ' ';
        const col = c;
        const row = r;
        const range = row === 0 ? nameRange : titleRange;
        const inRange = col >= range[0] && col < range[1];
        if (targetChar === currentChar) {
          // No animation needed — just update color to match new badge
          const flaps = this._cells[row][col].querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
          flaps.forEach(el => { el.style.color = inRange ? divColor : '#ffffff'; });
          continue;
        }
        headerPromises.push(
          new Promise(resolve => {
            setTimeout(() => {
              const flaps = this._cells[row][col].querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
              // Intermediate chars cycle in white; division color applied after landing
              flaps.forEach(el => { el.style.color = '#ffffff'; });
              if (inRange) this._flashTileColor(this._cells[row][col], divColor);
              this._cycleToChar(this._cells[row][col], targetChar, currentChar).then(() => {
                // Name/title chars get division color, others stay white
                flaps.forEach(el => { el.style.color = inRange ? divColor : '#ffffff'; });
                resolve();
              });
            }, col * headerStagger);
          })
        );
      }
    }
    await Promise.all(headerPromises);

    // ── Phase B2: Skills sweep left-to-right (rows 2-3) ──
    const skillsPromises = [];
    for (let sr = 0; sr < 2; sr++) {
      const rowIdx = 2 + sr;
      const lineText = skillsLines[sr];
      for (let c = 0; c < this.COLS; c++) {
        const targetChar = lineText[c];
        const currentChar = this._cells[rowIdx][c].querySelector('.static-top').textContent || ' ';
        const col = c;
        const row = rowIdx;
        // Determine target color for this cell
        const cellColor = targetChar.trim() ? '#ffffff' : '';
        if (targetChar === currentChar) {
          // No animation needed — just update color
          const flaps = this._cells[row][col].querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
          flaps.forEach(el => { el.style.color = cellColor; });
          continue;
        }
        skillsPromises.push(
          new Promise(resolve => {
            setTimeout(() => {
              const flaps = this._cells[row][col].querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
              // Cycle in white, apply target color after landing
              flaps.forEach(el => { el.style.color = '#ffffff'; });
              this._cycleToChar(this._cells[row][col], targetChar, currentChar).then(() => {
                flaps.forEach(el => { el.style.color = cellColor; });
                resolve();
              });
            }, col * 30);
          })
        );
      }
    }
    await Promise.all(skillsPromises);

    // ── Phase C: Progressive reveal — review rows resolve from blank ──
    // Clear spacer + review rows to blank first
    for (let r = 4; r <= 9; r++) {
      this._setRowText(r, '', 0);
    }

    // Badge tiles start animating to sampled colors
    const badgeColors = await badgeColorsPromise;
    await badgeDarkPromise;
    const badgeColorPromise = this._animateBadgeTilesToColors(badgeColors);

    // Reveal each row top-to-bottom with stagger between rows
    // Each row: cells flip from blank → correct char in randomized order
    const rowRevealDelay = 600; // ms between each row starting
    for (let ri = 0; ri < reviewTexts.length; ri++) {
      const rowIdx = 5 + ri;

      // Build shuffled cell list for this row (skip spaces at end)
      const rowCells = [];
      for (let c = 0; c < this.COLS; c++) {
        rowCells.push({ c, char: reviewTexts[ri][c] });
      }
      // Fisher-Yates shuffle
      for (let i = rowCells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rowCells[i], rowCells[j]] = [rowCells[j], rowCells[i]];
      }

      // Resolve cells with staggered timing (~500ms per row)
      const dimColor = '#c8baa0';
      const cellDelay = Math.max(2, Math.floor(500 / rowCells.length));
      const rowPromises = [];
      rowCells.forEach((item, idx) => {
        rowPromises.push(new Promise(resolve => {
          setTimeout(() => {
            const cell = this._cells[rowIdx][item.c];
            // Set dim color before character appears
            const flaps = cell.querySelectorAll('.static-top, .static-bottom, .flap-top, .flap-bottom');
            flaps.forEach(el => { el.style.color = dimColor; });
            this._setChar(cell, item.char);
            // Flip animation on non-space characters
            if (item.char !== ' ') {
              const ft = cell.querySelector('.flap-top');
              const fb = cell.querySelector('.flap-bottom');
              if (ft && fb) {
                ft.classList.add('flipping');
                fb.classList.add('flipping');
                setTimeout(() => { ft.classList.remove('flipping'); fb.classList.remove('flipping'); }, 80);
              }
            }
            resolve();
          }, idx * cellDelay);
        }));
      });
      await Promise.all(rowPromises);

      // Pause between rows (except after last)
      if (ri < reviewTexts.length - 1) {
        await this._delay(rowRevealDelay);
      }
    }

    await badgeColorPromise;

    // Crossfade: sharp PNG fades in over the tiles
    this._revealBadgeImage(imgSrc);

    // Badge panel glow in division color
    this._setBadgePanelGlow(divColor);

    // Hide AI indicator after reveal
    if (this._aiIndicator) this._aiIndicator.classList.remove('active');

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

    // Animation takes ~5-6s, then hold 6s for reading = ~12s between rotations
    const holdTime = this._allBadges.length < 3 ? 20000 : 14000;

    this._rotationTimer = setInterval(() => {
      if (this._isArrivalActive) return;
      this._rotationIndex++;
      if (this._rotationIndex >= this._shuffledBadges.length) {
        this._shuffledBadges = this._shuffle(this._allBadges);
        this._rotationIndex = 0;
      }
      if (animationsEnabled()) {
        this._displayBadgeAnimated(this._shuffledBadges[this._rotationIndex]);
      } else {
        this._displayBadgeInstant(this._shuffledBadges[this._rotationIndex]);
      }
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
    const holdTime = this._allBadges.length < 3 ? 20000 : 14000;
    this._rotationTimer = setInterval(() => {
      if (this._isArrivalActive) return;
      this._rotationIndex++;
      if (this._rotationIndex >= this._shuffledBadges.length) {
        this._shuffledBadges = this._shuffle(this._allBadges);
        this._rotationIndex = 0;
      }
      if (animationsEnabled()) {
        this._displayBadgeAnimated(this._shuffledBadges[this._rotationIndex]);
      } else {
        this._displayBadgeInstant(this._shuffledBadges[this._rotationIndex]);
      }
    }, holdTime);
  },

  // ─── Arrival Interruption ──────────────────────────────

  async _processArrival(badge) {
    this._isArrivalActive = true;
    this._stopRotation();

    // FX off: skip all animation, just show instantly
    if (!animationsEnabled()) {
      this._displayBadgeInstant(badge);
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
      return;
    }

    // Show AI indicator
    if (this._aiIndicator) this._aiIndicator.classList.add('active');

    const div = this._getDivision(badge);
    const divColor = this.DIVISION_COLORS[div] || '#F5E6C8';

    // Hide previous reveal image + clear glow
    this._hideBadgeReveal();
    this._clearBadgePanelGlow();

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
    const skills = this._getSkills(name);

    const nameStart = this._centerCol(name);
    const titleStart = this._centerCol(title);
    const skillsLines = this._formatSkillsLines(skills);
    const rowTexts = [];
    rowTexts.push((' '.repeat(nameStart) + name).padEnd(this.COLS, ' ').substring(0, this.COLS));
    rowTexts.push((' '.repeat(titleStart) + title).padEnd(this.COLS, ' ').substring(0, this.COLS));
    rowTexts.push(skillsLines[0]);
    rowTexts.push(skillsLines[1]);
    rowTexts.push(' '.repeat(this.COLS)); // Row 4: blank spacer
    const numQuoteLines = Math.min(quote.length, 5);
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

    // Dim review body + badge panel glow
    this._dimReviewRows();
    this._setBadgePanelGlow(divColor);

    // Color skills after color wave clears
    this._colorSkillsLabel(2, skillsLines[0], '#ffffff');
    this._colorSkillsOverflow(3, skillsLines[1]);

    // Hide AI indicator after reveal
    if (this._aiIndicator) this._aiIndicator.classList.remove('active');

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

    // Screen reader text for split-flap board content
    this._srText = document.createElement('div');
    this._srText.className = 'sr-only';
    this._srText.setAttribute('aria-live', 'polite');
    this._srText.setAttribute('role', 'status');

    // Build stage (column: header row + content row)
    this._stage = document.createElement('div');
    this._stage.className = 'rb-stage';

    // Content row: board + badge panel
    const contentRow = document.createElement('div');
    contentRow.className = 'rb-content-row';

    // Board wrapper
    const board = document.createElement('div');
    board.className = 'rb-board';
    board.setAttribute('aria-live', 'polite');
    board.setAttribute('aria-label', 'AI Performance Review Board');
    this._boardEl = board;

    // Title centered above the board
    const titleDiv = document.createElement('div');
    titleDiv.className = 'rb-title';
    titleDiv.textContent = 'AI PERFORMANCE REVIEW';
    board.appendChild(titleDiv);

    const grid = this._buildGrid();
    board.appendChild(grid);

    // Click handler for badge card
    board.addEventListener('click', () => {
      if (this._currentBadge) {
        this._openPacket(this._currentBadge);
      }
    });

    contentRow.appendChild(board);

    // Badge tile panel
    const badgePanel = this._buildBadgePanel();

    // AI indicator (above badge panel)
    this._aiIndicator = document.createElement('div');
    this._aiIndicator.className = 'rb-ai-indicator';
    this._aiIndicator.innerHTML =
      '<span class="rb-ai-indicator-dot"></span>' +
      '<span class="rb-ai-indicator-dot"></span>' +
      '<span class="rb-ai-indicator-dot"></span>' +
      '<span class="rb-ai-indicator-label">AI ANALYZING</span>';
    this._badgeCol.insertBefore(this._aiIndicator, this._badgePanel);

    contentRow.appendChild(badgePanel);

    this._stage.appendChild(contentRow);
    this._stage.appendChild(this._srText);

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
    this._badgeCol = null;
    this._boardEl = null;
    this._aiIndicator = null;
    this._srText = null;
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
