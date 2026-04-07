// ─── Arcade Cinematic Module ─────────────────────────────
// VS screen, fight sequence, effects, and announcer lines.
// Mixed into ArcadeRenderer after view-arcade.js loads.
// Depends on: shared.js (esc, DIVISION_ACCENT_COLORS), view-arcade.js (ArcadeRenderer base)

(function() {
  const cinematic = {

  // ─── Pick Opponent ──────────────────────────────────────────

  // Track recent opponents to prevent repeats
  _recentOpponents: [],
  // Separate boss cooldown — must see 3 other bosses before repeat
  _recentBosses: [],
  // Track last 2 backgrounds to prevent repeats
  _recentBackgrounds: [],

  // Honor OS-level reduced-motion preference for elaborate FX spawns
  _motionReduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  },

  _pickOpponent() {
    const t = window._testFight || {};
    const roll = t.opponent === 'boss' ? 0 : t.opponent === 'creature' ? 0.5 : t.opponent === 'intern' ? 0.95 : Math.random();

    // 20% boss, 70% creature, 10% intern
    if (roll < 0.20 && this._bossBadges.length > 0) {
      let boss;
      if (t.bossId) {
        boss = this._bossBadges.find(b => b.employeeId === t.bossId) || this._bossBadges[0];
      } else {
        // Filter out bosses on cooldown (must see 3 other bosses before repeat)
        const eligible = this._bossBadges.filter(b => !this._recentBosses.includes(b.employeeId));
        const pool = eligible.length > 0 ? eligible : this._bossBadges;
        boss = pool[Math.floor(Math.random() * pool.length)];
      }
      const snesPortrait = this._BOSS_PORTRAITS[boss.employeeId];
      const fallbackUrl = `/api/badge/${boss.employeeId}/headshot`;
      opponent = {
        type: 'boss',
        name: boss.name,
        _bossId: boss.employeeId,
        photoUrl: snesPortrait || fallbackUrl,
        fallbackPhotoUrl: snesPortrait ? fallbackUrl : null,
        className: boss.title || 'BOSS',
        tagline: this._pickBossTagline(boss.employeeId),
        move: this._BOSS_MOVES[boss.employeeId] || 'EXECUTIVE ORDER',
      };
    } else if (roll < 0.90) {
      // Pick creature, reroll if same as last 2
      let creature;
      if (t.creatureName) {
        creature = this._CREATURES.find(c => c.name === t.creatureName) || this._CREATURES[0];
      } else {
        for (let attempt = 0; attempt < 3; attempt++) {
          creature = this._CREATURES[Math.floor(Math.random() * this._CREATURES.length)];
          if (!this._recentOpponents.includes(creature.name)) break;
        }
      }
      opponent = {
        type: 'creature',
        name: creature.name,
        imageUrl: creature.imageUrl,
        className: 'CORPORATE DREAD',
        tagline: creature.tagline,
        move: creature.move,
      };
    } else {
      const intern = this._INTERNS[Math.floor(Math.random() * this._INTERNS.length)];
      opponent = {
        type: 'intern',
        name: intern.name,
        imageUrl: intern.imageUrl,
        className: intern.className,
        tagline: intern.tagline,
        move: intern.move,
      };
    }

    // Track last 2 opponents (general) + last 3 bosses (separate cooldown)
    this._recentOpponents.push(opponent.name);
    if (this._recentOpponents.length > 2) this._recentOpponents.shift();
    if (opponent.type === 'boss' && opponent._bossId) {
      this._recentBosses.push(opponent._bossId);
      if (this._recentBosses.length > 3) this._recentBosses.shift();
    }

    return opponent;
  },

  // ─── Determine Winner ───────────────────────────────────────

  _determineWinner(opponent) {
    const t = window._testFight || {};
    if (t.winner) return t.winner;
    // Interns win 20% — rare upset
    if (opponent.type === 'intern') return Math.random() < 0.2 ? 'opponent' : 'employee';
    // Band member bosses win 65% — they're harder to beat
    if (opponent.type === 'boss') return Math.random() < 0.65 ? 'opponent' : 'employee';
    // Creatures: 50/50
    return Math.random() < 0.5 ? 'employee' : 'opponent';
  },

  // ─── Beat Sequence Helper ──────────────────────────────────
  // Schedules timed callbacks and auto-tracks timeout IDs for cleanup.
  // Returns a `beat(delay, fn)` function scoped to this renderer's _timeouts.

  _createBeat() {
    return (delay, fn) => {
      const tid = setTimeout(fn, delay);
      this._timeouts.push(tid);
      return tid;
    };
  },

  // ─── VS Screen — Full Cinematic Sequence (~25s) ────────────

  _animateVS(badge, div, isNewHire) {
    return new Promise(resolve => {
      const beat = this._createBeat();
      const opponent = this._pickOpponent();
      const isPresentation = window.location.pathname.startsWith('/presentation');
      const baseWinner = this._determineWinner(opponent);
      const fightState = {
        baseWinner,
        winner: null,        // set after QTE 3 (or immediately in presentation mode)
        qteSuccesses: 0,
      };
      // Presentation mode: winner determined immediately, no QTEs
      if (isPresentation) fightState.winner = baseWinner;
      // QTE time offset for post-fight beats (0 in presentation, 6500ms with QTEs)
      const postFightOffset = isPresentation ? 0 : 6500;

      const employeeColor = DIVISION_ACCENT_COLORS[div] || '#ffd700';
      const opponentColor = opponent.type === 'creature' ? '#ff0040' : opponent.type === 'intern' ? '#ffffff' : '#D4A843';

      // Log test override info (actual deletion happens in _animateFight after mechanics read it)
      const _tf = window._testFight;
      if (_tf) {
        console.log('[FIGHT TEST]', { opponent: opponent.type, name: opponent.name, move: opponent.move, baseWinner });
      }

      // Pick background: bosses get corner-office (80%) or random, creatures pick from their pool
      // Avoids last 2 backgrounds for variety
      const pickFromPool = (pool) => {
        const filtered = pool.filter(bg => !this._recentBackgrounds.includes(bg));
        const choices = filtered.length > 0 ? filtered : pool;
        return choices[Math.floor(Math.random() * choices.length)];
      };

      let bgName = _tf && _tf.background ? _tf.background : null;
      if (!bgName) {
        if (opponent.type === 'boss') {
          bgName = Math.random() < 0.8
            ? this._BOSS_BACKGROUNDS._default
            : pickFromPool(this._BOSS_BACKGROUNDS._others);
        } else if (this._CREATURE_BACKGROUNDS[opponent.name]) {
          const pool = this._CREATURE_BACKGROUNDS[opponent.name];
          bgName = Array.isArray(pool) ? pickFromPool(pool) : pool;
        } else {
          bgName = pickFromPool(this._BACKGROUNDS);
        }
      }

      // Track last 2 backgrounds
      this._recentBackgrounds.push(bgName);
      if (this._recentBackgrounds.length > 2) this._recentBackgrounds.shift();

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
        <div class="arcade-vs-bg-darken" data-stage="${bgName}"></div>

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

        <div class="arcade-vs-opponent-pending">
          <div class="arcade-vs-opponent-pending-icon">?</div>
          <div class="arcade-vs-opponent-pending-text">AWAITING OPPONENT</div>
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
            <div class="arcade-vs-hp-track"><div class="arcade-vs-hp-trail"></div><div class="arcade-vs-hp-fill" style="--hp-color: ${employeeColor}"></div></div>
          </div>
          <div class="arcade-vs-hp-bar arcade-vs-hp-right">
            <div class="arcade-vs-hp-label">${esc(opponent.name)}</div>
            <div class="arcade-vs-hp-track"><div class="arcade-vs-hp-trail"></div><div class="arcade-vs-hp-fill" style="--hp-color: ${opponentColor}"></div></div>
          </div>
        </div>

        <div class="arcade-vs-speed-lines"></div>
        <div class="arcade-vs-darken-overlay"></div>

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
      // TIMELINE — ~36s total
      //    0ms  BG reveal (bright)
      //  1500   BG darkens
      //  3000   Employee slides in from left
      //  5000   Slash wipe + VS text slam
      //  6500   Opponent slides in (3.5s after employee)
      //  7500   VS text + divider line fade out
      //  8500   Typewriter quote bubble (~3s to read)
      // 11500   FIGHT!! flash
      // 12000   Fight sequence (~20s)
      // 32000   Winner reveal + confetti
      // 34000   Second confetti burst
      // 36000   Dissolve
      // ═══════════════════════════════════════════════════════════

      requestAnimationFrame(() => {
        overlay.classList.add('bg-reveal');
        setVSAnnouncer('A CHALLENGER APPROACHES...');
      });

      beat(1500, () => {
        overlay.classList.add('bg-darken');
      });

      // New hire: herald burst before slide-in, celebration burst after landing
      if (isNewHire) {
        const fwTarget = () => overlay.querySelector('.arcade-vs-left .arcade-vs-portrait-wrap') || overlay;
        beat(2600, () => {
          this._spawnFireworks(fwTarget());
        });
        beat(3600, () => {
          this._spawnFireworks(fwTarget());
        });
      }

      beat(3000, () => {
        overlay.classList.add('left-enter');
        setVSAnnouncer(isNewHire
          ? `NEW HIRE ${badge.name.toUpperCase()} REPORTS FOR DUTY!`
          : `${badge.name.toUpperCase()} ENTERS THE RING`);
      });

      beat(5000, () => {
        overlay.classList.add('slash-fire');
        const vsText = overlay.querySelector('.arcade-vs-text');
        if (vsText) vsText.classList.add('slam');
        if (window.ArcadeSFX) {
          ArcadeSFX.play('vsSlam');
          ArcadeSFX.playDelayed('vsSlamAlt', 350);
        }
      });

      beat(6500, () => {
        overlay.classList.add('right-enter');
        setVSAnnouncer(`${opponent.name.toUpperCase()} APPEARS!`);

        // Boss entrance effect — electrified border, lasts through the quote until fight starts
        if (opponent.type === 'boss') {
          const bossWrap = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait-wrap');
          if (bossWrap) {
            bossWrap.classList.add('boss-electric-entrance');
            if (window.ArcadeSFX) {
              ArcadeSFX.play('bossEntrance');
              ArcadeSFX.playDelayed('bandEntrance', 300);
            }
            // Continuous lightning from slide-in until quote ends (~4s duration)
            this._spawnBossArcSparks(overlay, bossWrap, '#2E7DFF', 4000);
            // Remove electric effect before FIGHT!! flash
            beat(10500, () => {
              bossWrap.classList.remove('boss-electric-entrance');
            });
          }
        }
      });

      beat(7500, () => {
        const vsText = overlay.querySelector('.arcade-vs-text');
        if (vsText) {
          vsText.style.animation = 'none';
          vsText.style.transition = 'opacity 0.4s ease';
          vsText.style.opacity = '0';
        }
        const slash = overlay.querySelector('.arcade-vs-slash');
        if (slash) {
          slash.style.animation = 'none';
          slash.style.transition = 'opacity 0.4s ease';
          slash.style.opacity = '0';
        }
      });

      beat(8500, () => {
        const bubble = overlay.querySelector('.arcade-vs-quote-bubble');
        if (bubble && quote) {
          bubble.classList.add('visible');
          this._typewriterEffect(bubble, `"${quote}"`, 55);
          if (window.ArcadeSFX) ArcadeSFX.play('quoteTaunt');
        }
      });

      beat(11500, () => {
        const fightEl = document.createElement('div');
        fightEl.className = 'arcade-vs-fight-flash';
        fightEl.textContent = 'FIGHT!!';
        overlay.appendChild(fightEl);
        fightEl.getBoundingClientRect();
        fightEl.classList.add('active');
        if (window.ArcadeSFX) ArcadeSFX.play('fightStart');
        setVSAnnouncer('FIGHT!');
        beat(13000, () => fightEl.remove());
      });

      beat(12000, () => {
        const bubble = overlay.querySelector('.arcade-vs-quote-bubble');
        if (bubble) {
          bubble.style.transition = 'opacity 0.3s ease';
          bubble.style.opacity = '0';
        }
        this._animateFight(overlay, fightState, badge, opponent, employeeColor, opponentColor, setVSAnnouncer);
      });

      beat(32000 + postFightOffset, () => {
        const bubbleCleanup = overlay.querySelector('.arcade-vs-quote-bubble');
        if (bubbleCleanup) bubbleCleanup.style.display = 'none';

        const leftSide = overlay.querySelector('.arcade-vs-left');
        const rightSide = overlay.querySelector('.arcade-vs-right');
        const w = fightState.winner;

        if (window.ArcadeSFX) ArcadeSFX.play('winner');

        if (w === 'employee') {
          if (leftSide) {
            const winResult = document.createElement('div');
            winResult.className = 'arcade-vs-side-result arcade-vs-side-result-win';
            winResult.innerHTML = `
              <div class="arcade-vs-winner-label">WINNER</div>
              <div class="arcade-vs-victory-text">${this._getVictoryText(opponent)}</div>
            `;
            leftSide.appendChild(winResult);
            requestAnimationFrame(() => winResult.classList.add('reveal'));
            this._spawnConfetti(leftSide, employeeColor);
          }
          if (rightSide) {
            const loseResult = document.createElement('div');
            loseResult.className = 'arcade-vs-side-result arcade-vs-side-result-lose';
            loseResult.innerHTML = `
              <div class="arcade-vs-defeat-label">DEFEATED</div>
              <div class="arcade-vs-victory-text arcade-vs-defeat-text">${this._getDefeatText(opponent)}</div>
            `;
            rightSide.appendChild(loseResult);
            requestAnimationFrame(() => loseResult.classList.add('reveal'));
          }
          this._markFightResult(badge.employeeId, 'winner');
        } else {
          if (rightSide) {
            const winResult = document.createElement('div');
            winResult.className = 'arcade-vs-side-result arcade-vs-side-result-win';
            winResult.innerHTML = `
              <div class="arcade-vs-winner-label">WINNER</div>
              <div class="arcade-vs-victory-text">${this._getVictoryText({ type: 'employee' })}</div>
            `;
            rightSide.appendChild(winResult);
            requestAnimationFrame(() => winResult.classList.add('reveal'));
            this._spawnConfetti(rightSide, opponentColor);
          }
          if (leftSide) {
            const loseResult = document.createElement('div');
            loseResult.className = 'arcade-vs-side-result arcade-vs-side-result-lose';
            loseResult.innerHTML = `
              <div class="arcade-vs-defeat-label">DEFEATED</div>
              <div class="arcade-vs-victory-text arcade-vs-defeat-text">${this._getDefeatText()}</div>
            `;
            leftSide.appendChild(loseResult);
            requestAnimationFrame(() => loseResult.classList.add('reveal'));
          }
          this._markFightResult(badge.employeeId, 'loser');
        }

        setVSAnnouncer(w === 'employee'
          ? `${badge.name.toUpperCase()} WINS!`
          : `${opponent.name.toUpperCase()} WINS!`);
      });

      // Second confetti burst for extended celebration
      beat(34000 + postFightOffset, () => {
        const w = fightState.winner;
        const winnerSide = w === 'employee'
          ? overlay.querySelector('.arcade-vs-left')
          : overlay.querySelector('.arcade-vs-right');
        const winColor = w === 'employee' ? employeeColor : opponentColor;
        if (winnerSide) this._spawnConfetti(winnerSide, winColor);
      });

      beat(36000 + postFightOffset, () => {
        overlay.classList.add('dissolve');
        resolve();
        beat(36600 + postFightOffset, () => {
          overlay.remove();
          beat(38600 + postFightOffset, () => {
            // Fight result markers persist on slots — no cleanup needed
          });
        });
      });
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
    const count = 24;
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.className = 'arcade-vs-firework';
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const dist = 160 + Math.random() * 240;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      particle.style.cssText = `
        left: ${cx}px; top: ${cy}px;
        width: ${10 + Math.random() * 10}px;
        height: ${10 + Math.random() * 10}px;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        --fw-trajectory: translate(${dx}px, ${dy}px);
        animation-delay: ${Math.random() * 0.12}s;
        animation-duration: ${0.9 + Math.random() * 0.5}s;
      `;
      container.appendChild(particle);
      const tid = setTimeout(() => particle.remove(), 1600);
      this._timeouts.push(tid);
    }

    // Second burst slightly delayed for layered effect
    const t2 = setTimeout(() => {
      for (let i = 0; i < 14; i++) {
        const particle = document.createElement('div');
        particle.className = 'arcade-vs-firework';
        const angle = (Math.PI * 2 * i) / 14 + (Math.random() - 0.5) * 0.5;
        const dist = 100 + Math.random() * 180;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        particle.style.cssText = `
          left: ${cx}px; top: ${cy}px;
          width: ${8 + Math.random() * 8}px;
          height: ${8 + Math.random() * 8}px;
          background: ${colors[Math.floor(Math.random() * colors.length)]};
          --fw-trajectory: translate(${dx}px, ${dy}px);
          animation-duration: ${0.7 + Math.random() * 0.5}s;
        `;
        container.appendChild(particle);
        const tid = setTimeout(() => particle.remove(), 1400);
        this._timeouts.push(tid);
      }
    }, 250);
    this._timeouts.push(t2);
  },

  // ─── Fight Sequence (HP bars + hit sparks) ──────────────────

  // ─── Fight Announcer Lines ──────────────────────────────────

  // ─── Stun Quotes (employee one-liners) ─────────────────────
  _STUN_QUOTES: [
    'Have you tried turning it off and on again?',
    'Per my last email...',
    "Let's take this offline",
    "I'm going to need that in writing",
    "That's not in my job description",
    'New ticket: submitted',
    'PLEASE HOLD!',
    'Have you read the documentation?',
    'Works on my machine',
    'Reply all: unsubscribe',
    'Ctrl+Z that decision',
    'Your password has expired',
    'Did you check the FAQ?',
    'Escalating to level 2',
  ],

  _FIGHT_LINES_EVEN: [
    'TRADING BLOWS!',
    'NEITHER WILL BACK DOWN!',
    'WHAT A BATTLE!',
    "THEY'RE CC'ING EVERYONE!",
    'PASSIVE-AGGRESSIVE EMAILS FLYING!',
    'DUELING CALENDAR INVITES!',
  ],

  _FIGHT_LINES_WINNING: [
    'TAKING CONTROL!',
    'GAINING THE UPPER HAND!',
    'ESCALATING TO MANAGEMENT!',
    'FILING A COUNTER-COMPLAINT!',
    'REPLY-ALL OF DOOM!',
  ],

  _FIGHT_LINES_RALLY: [
    'WAIT... A COMEBACK?!',
    'NOT DONE YET!',
    'SUBMITTED A REBUTTAL!',
    'CITING THE EMPLOYEE HANDBOOK!',
    'EMERGENCY PTO DENIED!',
  ],

  _FIGHT_LINES_FINISH: [
    'THIS IS IT!',
    'THE FINAL BLOW!',
    "IT'S OVER!",
    'MEETING ADJOURNED!',
    'TICKET CLOSED!',
  ],

  _FIGHT_LINES_COMEBACK_SHOCK: [
    "IT'S OVER... WAIT!",
    'IMPOSSIBLE!',
    'DOWN BUT NOT OUT?!',
    'THAT SHOULD HAVE ENDED IT!',
    'HOW ARE THEY STILL STANDING?!',
  ],

  _FIGHT_LINES_COMEBACK_RALLY: [
    'FROM THE BRINK!',
    'AN INCREDIBLE COMEBACK!',
    'THEY JUST CITED THE EMPLOYEE HANDBOOK!',
    'EMERGENCY OVERTIME ACTIVATED!',
    'SECOND WIND FROM THE BREAK ROOM!',
  ],

  _CREATURE_FIGHT_LINES: {
    'The Phantom Printer': ['PAPER FLYING EVERYWHERE!', 'TONER LEVELS CRITICAL!', 'PC LOAD LETTER INTENSIFIES!'],
    'The Network Wizard': ['PACKETS DROPPING!', 'LATENCY SPIKING!', 'DNS IS DEFINITELY THE PROBLEM!'],
    'Watercooler Will': ['STILL TALKING!', 'NOBODY ASKED, WILL!', 'THE ANECDOTE CONTINUES!'],
    'HR Nancy': ['MANDATORY TRAINING IN PROGRESS!', 'COMPLIANCE VIOLATION DETECTED!', 'FORM 27B REQUIRED!'],
    'The Dirty Microwave': ['SOMETHING IS DEFINITELY BURNING!', 'THE SMELL IS SPREADING!', 'WHO MICROWAVED FISH?!'],
    'The MFA Guardian': ['CODE EXPIRED! ENTER A NEW ONE!', 'AUTHENTICATING... DENIED!', 'TOO MANY ATTEMPTS!'],
    'The Consultant': ['BILLABLE HOURS INCREASING!', "THAT'LL COST EXTRA!", 'SCOPE CREEP DETECTED!'],
    'Sally in Accounting': ['RECEIPT REQUIRED!', 'SUBMIT YOUR TIME!', 'OVER BUDGET!', 'THAT LINE ITEM IS FLAGGED!'],
  },

  _animateFight(overlay, fightState, badge, opponent, empColor, oppColor, setVSAnnouncer) {
    const hpContainer = overlay.querySelector('.arcade-vs-hp-container');
    if (!hpContainer) return;

    // Show HP bars with slide-in
    hpContainer.style.display = '';
    hpContainer.classList.add('visible');

    const leftPortrait = overlay.querySelector('.arcade-vs-left .arcade-vs-portrait');
    const rightPortrait = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait');
    const leftWrap = overlay.querySelector('.arcade-vs-left .arcade-vs-portrait-wrap');
    const rightWrap = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait-wrap');

    // Direct element refs needed by doHit for color logic
    const leftSpark = overlay.querySelector('.arcade-vs-left .arcade-vs-hit-spark');

    // Use baseWinner for Acts 1-2 choreography (mechanics, side assignments)
    let winner = fightState.baseWinner;
    let sides = this._assignFighterSides(overlay, winner);
    let { loserFill, loserTrail, loserSpark, winnerFill, winnerTrail, winnerSpark } = sides;
    const winnerName = winner === 'employee' ? badge.name : opponent.name;
    const loserName = winner === 'employee' ? opponent.name : badge.name;

    // HP color helper
    const hpColor = (pct) => {
      if (pct > 60) return '#00ff41';
      if (pct > 30) return '#ffcc00';
      return '#ff3333';
    };

    const setHP = (fill, trail, pct) => {
      fill.style.width = Math.max(0, pct) + '%';
      const c = hpColor(pct);
      fill.style.backgroundColor = c;
      fill.style.boxShadow = `0 0 6px ${c}`;
      // Trail follows with CSS transition delay (0.8s ease-out in CSS)
      if (trail) trail.style.width = Math.max(0, pct) + '%';
    };

    const beat = this._createBeat();
    let hitColorToggle = false;

    // Combo counter tracking
    let comboCount = 0;
    let comboTarget = null; // which side is being hit consecutively
    let comboEl = null;     // current combo counter DOM element

    const updateCombo = (target) => {
      if (target === comboTarget) {
        comboCount++;
      } else {
        comboCount = 1;
        comboTarget = target;
      }
      // Show counter at x2 and above
      if (comboCount >= 2) {
        // Remove previous counter
        if (comboEl) comboEl.remove();
        // Place counter on the ATTACKER's side (opposite of target)
        const attackerSide = target === 'winner'
          ? (winner === 'employee' ? overlay.querySelector('.arcade-vs-right') : overlay.querySelector('.arcade-vs-left'))
          : (winner === 'employee' ? overlay.querySelector('.arcade-vs-left') : overlay.querySelector('.arcade-vs-right'));
        if (attackerSide) {
          comboEl = document.createElement('div');
          comboEl.className = 'arcade-vs-combo-counter';
          comboEl.textContent = `x${comboCount}`;
          // Scale up for higher combos
          if (comboCount >= 5) comboEl.classList.add('combo-hot');
          attackerSide.appendChild(comboEl);
          // Auto-fade after 800ms if no new hit
          const fadeTimer = setTimeout(() => {
            if (comboEl) { comboEl.classList.add('combo-fade'); }
          }, 800);
          this._timeouts.push(fadeTimer);
        }
      } else if (comboEl) {
        comboEl.remove();
        comboEl = null;
      }
    };

    // Hitstop tracking — medium gets a brief pause for punch variation
    const HITSTOP = { light: 0, medium: 50, heavy: 150, ko: 280 };

    const doHit = (spark, portrait, weight) => {
      // Sound effect based on hit weight
      if (window.ArcadeSFX) {
        if (weight === 'ko') ArcadeSFX.play('koImpact');
        else if (weight === 'heavy') ArcadeSFX.play('heavyHit');
        else ArcadeSFX.play('lightHit');
      }
      // Randomize flash position within portrait bounds
      const randX = 10 + Math.floor(Math.random() * 80);
      const randY = 10 + Math.floor(Math.random() * 80);
      spark.style.setProperty('--spark-x', randX + '%');
      spark.style.setProperty('--spark-y', randY + '%');

      // Alternate flash color — attacker's color (opposite side from the spark being hit)
      const isLeft = (spark === leftSpark);
      const accentColor = isLeft ? oppColor : empColor;
      const flashColor = hitColorToggle ? '#ffffff' : accentColor;
      spark.style.setProperty('--spark-color', flashColor);
      hitColorToggle = !hitColorToggle;

      spark.classList.add('flash');
      beat(150, () => spark.classList.remove('flash'));

      // Portrait brightness flash
      if (portrait) {
        portrait.classList.add('hit-flash-bright');
        beat(80, () => portrait.classList.remove('hit-flash-bright'));
      }

      // HP track flash
      const track = (spark === loserSpark ? loserFill : winnerFill).parentElement;
      if (track) {
        track.classList.add('hit-flash');
        beat(150, () => track.classList.remove('hit-flash'));
      }

      // Hitstop: freeze + vibrate on heavy/ko hits
      const hitstopDuration = HITSTOP[weight] || 0;
      if (hitstopDuration > 0) {
        if (leftWrap) leftWrap.classList.add('hitstop-vibrate');
        if (rightWrap) rightWrap.classList.add('hitstop-vibrate');
        beat(hitstopDuration, () => {
          if (leftWrap) leftWrap.classList.remove('hitstop-vibrate');
          if (rightWrap) rightWrap.classList.remove('hitstop-vibrate');
        });
      }

      // Screen shake on medium+ hits
      if (weight !== 'light') {
        overlay.classList.add('hit-shake');
        beat(120, () => overlay.classList.remove('hit-shake'));
      }
    };

    const pickLine = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // ═══════════════════════════════════════════════════════════
    // Extended fight choreography (~20s)
    //
    // Both fighters start at 100%. The fight has 3 acts:
    //   Act 1 (0-5s):     Even exchange — both drop to ~70%
    //   Act 2 (5-11s):    Stun quote (50%) → combo, special move, rally
    //   Act 3 (11-18.5s): Escalation → slowdown → KO
    //
    // Winner ends at 15-40% HP for drama. Loser hits 0.
    // ═══════════════════════════════════════════════════════════

    let winnerHP = 100;
    let loserHP = 100;
    const winnerFinalHP = 15 + Math.floor(Math.random() * 25);
    const empTarget = winner === 'employee' ? 'winner' : 'loser';
    const oppTarget = winner === 'employee' ? 'loser' : 'winner';
    const isBoss = opponent.type === 'boss';

    // QTE timing: presentation mode skips QTEs entirely
    const isPresentation = window.location.pathname.startsWith('/presentation');
    // Offset applied to Act 2 remainder, QTE 2-3, and Act 3 timings
    // QTE 1: 1.5s window (2 arrows), QTE 2: 1.5s window (3 arrows), QTE 3: 2.5s window (4-arrow stratagem)
    const QTE_OFFSET_1 = isPresentation ? 0 : 1700;  // after QTE 1 (1500ms + 200 margin)
    const QTE_OFFSET_3 = isPresentation ? 0 : 6500;  // after QTE 3 (Act 3 must start after 2.5s stratagem resolves)

    // ── Fight mechanic decisions ─────────────────────────────
    // Stun is now player-earned via QTEs (3/3 success), not random.
    const t = window._testFight || {};
    // Comeback: employee-only, 35% of employee wins
    const doComeback = t.doComeback != null ? t.doComeback : (winner === 'employee' && Math.random() < 0.35);
    // Boss finisher: boss wins + 30% chance — special move as killing blow
    const doBossFinisher = t.doBossFinisher != null ? t.doBossFinisher : (winner === 'opponent' && isBoss && !doComeback && Math.random() < 0.3);
    // Special move timing: vary between 8-9.5s (charge starts 1.2s before)
    const specialTime = 8000 + Math.floor(Math.random() * 1500);
    const chargeLeadTime = 1200;
    const chargeStart = specialTime - chargeLeadTime; // 6800-8300ms
    // Slugfest Act 3: 25% of non-comeback/non-finisher fights get rapid exchanges
    const doSlugfest = t.doSlugfest != null ? t.doSlugfest : (!doComeback && !doBossFinisher && Math.random() < 0.25);

    // Log test overrides (deletion deferred until after QTEs read from it)
    if (window._testFight) {
      console.log('[FIGHT TEST] Mechanics:', { doComeback, doBossFinisher, doSlugfest, specialTime });
    }

    // Jitter: ±150ms randomization per hit
    const jitter = () => Math.round((Math.random() - 0.5) * 300);

    // ── Act 1: Even exchange (0-5s) ──────────────────────────
    // Occasionally includes a momentum run (3 consecutive hits to one side)
    const doMomentum = t.doMomentum != null ? t.doMomentum : Math.random() < 0.35;
    const momentumTarget = Math.random() < 0.5 ? 'loser' : 'winner';
    let allHits;
    if (doMomentum) {
      // Momentum run: 3 hits to one side in the middle of Act 1
      allHits = [
        { delay: 500  + jitter(), target: 'loser',  dmg: 7,  weight: 'light' },
        { delay: 1100 + jitter(), target: 'winner', dmg: 8,  weight: 'light' },
        // Momentum run — 3 consecutive hits
        { delay: 1800 + jitter(), target: momentumTarget, dmg: 6, weight: 'light' },
        { delay: 2100 + jitter(), target: momentumTarget, dmg: 7, weight: 'medium' },
        { delay: 2400 + jitter(), target: momentumTarget, dmg: 8, weight: 'medium' },
        // Other side answers back
        { delay: 3200 + jitter(), target: momentumTarget === 'loser' ? 'winner' : 'loser', dmg: 9, weight: 'medium' },
        { delay: 3800 + jitter(), target: 'loser',  dmg: 6,  weight: 'light' },
        { delay: 4600 + jitter(), target: 'winner', dmg: 5,  weight: 'light' },
      ];
    } else {
      allHits = [
        { delay: 500  + jitter(), target: 'loser',  dmg: 7,  weight: 'light' },
        { delay: 1100 + jitter(), target: 'winner', dmg: 8,  weight: 'light' },
        { delay: 1700 + jitter(), target: 'loser',  dmg: 6,  weight: 'light' },
        { delay: 2300 + jitter(), target: 'winner', dmg: 7,  weight: 'light' },
        { delay: 2900 + jitter(), target: 'loser',  dmg: 8,  weight: 'medium' },
        { delay: 3500 + jitter(), target: 'winner', dmg: 6,  weight: 'light' },
        { delay: 4000 + jitter(), target: 'loser',  dmg: 7,  weight: 'light' },
        { delay: 4600 + jitter(), target: 'winner', dmg: 5,  weight: 'light' },
      ];
    }

    // Double-tap combos: ~20% of light hits get a follow-up 120ms later
    const doubleTaps = [];
    allHits.forEach(h => {
      if (h.weight === 'light' && Math.random() < 0.2) {
        doubleTaps.push({ delay: h.delay + 120, target: h.target, dmg: 3, weight: 'light' });
      }
    });
    allHits.push(...doubleTaps);

    // ── Act 2: Exchange + Special (5-11s) ─────────────────────
    // Stun removed — now player-earned via QTEs. Special always fires cleanly.
    const act2Hits = [
      { delay: 5300  + jitter(), target: 'loser',  dmg: 8,  weight: 'medium' },
      { delay: 5900  + jitter(), target: 'winner', dmg: 7,  weight: 'light' },
      { delay: 6500  + jitter(), target: 'loser',  dmg: 6,  weight: 'light' },
      { delay: 7100  + jitter(), target: 'loser',  dmg: 10, weight: 'medium' },
      { delay: specialTime, target: empTarget, dmg: 28, weight: 'heavy', isSpecial: true },
      { delay: specialTime + 800  + jitter(), target: 'winner', dmg: 5, weight: 'light' },
      { delay: specialTime + 1400 + jitter(), target: 'loser',  dmg: 7, weight: 'light' },
      { delay: specialTime + 2000 + jitter(), target: 'winner', dmg: 8, weight: 'medium' },
    ];

    // ── Act 3: Escalation + Finish (11-18.5s) ────────────────
    let act3Hits;
    if (doComeback) {
      // Near-death comeback (employee only): gradual beatdown → stun pause → rally
      act3Hits = [
        { delay: 11200 + jitter(), target: 'loser',  dmg: 8,  weight: 'medium' },
        { delay: 11900 + jitter(), target: 'winner', dmg: 12, weight: 'medium' },
        { delay: 12400 + jitter(), target: 'winner', dmg: 14, weight: 'heavy' },
        { delay: 12900 + jitter(), target: 'winner', dmg: 12, weight: 'medium' },
        { delay: 13400,           target: 'winner', dmg: 16, weight: 'heavy' },
        // ~1.5s pause — employee stun fires here
        { delay: 15000 + jitter(), target: 'loser',  dmg: 14, weight: 'heavy' },
        { delay: 15300 + jitter(), target: 'loser',  dmg: 10, weight: 'medium' },
        { delay: 15600 + jitter(), target: 'loser',  dmg: 12, weight: 'heavy' },
        { delay: 16800 + jitter(), target: 'loser',  dmg: 14, weight: 'heavy' },
        { delay: 18500, target: 'loser', dmg: 999, weight: 'ko', final: true },
      ];
    } else if (doBossFinisher) {
      // Boss finisher: escalation → boss charges special again → special KO
      act3Hits = [
        { delay: 11200 + jitter(), target: 'loser',  dmg: 8,  weight: 'medium' },
        { delay: 11900 + jitter(), target: 'winner', dmg: 6,  weight: 'light' },
        { delay: 12600 + jitter(), target: 'loser',  dmg: 10, weight: 'medium' },
        { delay: 13400 + jitter(), target: 'loser',  dmg: 7,  weight: 'light' },
        { delay: 14200 + jitter(), target: 'winner', dmg: 5,  weight: 'light' },
        { delay: 15000 + jitter(), target: 'loser',  dmg: 12, weight: 'heavy' },
        // Boss charges for finisher at 16.5s, fires at 17.5s
        // KO happens on finisher release (handled separately below)
        { delay: 18500, target: 'loser', dmg: 999, weight: 'ko', final: true, isFinisher: true },
      ];
    } else if (doSlugfest) {
      // Slugfest: rapid back-and-forth with increasing intensity
      act3Hits = [
        { delay: 11200 + jitter(), target: 'loser',  dmg: 6,  weight: 'light' },
        { delay: 11600 + jitter(), target: 'winner', dmg: 5,  weight: 'light' },
        { delay: 12000 + jitter(), target: 'loser',  dmg: 7,  weight: 'light' },
        { delay: 12400 + jitter(), target: 'winner', dmg: 6,  weight: 'light' },
        { delay: 12800 + jitter(), target: 'loser',  dmg: 8,  weight: 'medium' },
        { delay: 13200 + jitter(), target: 'winner', dmg: 7,  weight: 'medium' },
        { delay: 13600 + jitter(), target: 'loser',  dmg: 9,  weight: 'medium' },
        { delay: 14000 + jitter(), target: 'winner', dmg: 8,  weight: 'medium' },
        { delay: 14500 + jitter(), target: 'loser',  dmg: 10, weight: 'heavy' },
        { delay: 15000 + jitter(), target: 'winner', dmg: 5,  weight: 'light' },
        { delay: 15800 + jitter(), target: 'loser',  dmg: 12, weight: 'heavy' },
        { delay: 16800 + jitter(), target: 'loser',  dmg: 14, weight: 'heavy' },
        { delay: 18500, target: 'loser', dmg: 999, weight: 'ko', final: true },
      ];
    } else {
      // Standard Act 3
      act3Hits = [
        { delay: 11200 + jitter(), target: 'loser',  dmg: 8,  weight: 'medium' },
        { delay: 11900 + jitter(), target: 'winner', dmg: 6,  weight: 'light' },
        { delay: 12600 + jitter(), target: 'loser',  dmg: 10, weight: 'medium' },
        { delay: 13400 + jitter(), target: 'loser',  dmg: 7,  weight: 'light' },
        { delay: 14200 + jitter(), target: 'winner', dmg: 5,  weight: 'light' },
        { delay: 15000 + jitter(), target: 'loser',  dmg: 12, weight: 'heavy' },
        { delay: 15900 + jitter(), target: 'winner', dmg: 4,  weight: 'light' },
        { delay: 16800 + jitter(), target: 'loser',  dmg: 14, weight: 'heavy' },
        { delay: 18500, target: 'loser', dmg: 999, weight: 'ko', final: true },
      ];
    }

    // ── HP Scaling ─────────────────────────────────────────
    // Pre-calculate scales for the full fight (Acts 1+2+3).
    // After QTE 3, Act 3 scales get recalculated from current HP.
    const allCombined = [...allHits, ...act2Hits, ...act3Hits];
    let runWinnerDmg = 0;
    let runLoserDmg = 0;
    allCombined.forEach(h => {
      if (h.final) return;
      if (h.target === 'winner') runWinnerDmg += h.dmg;
      else runLoserDmg += h.dmg;
    });
    let winnerScale = (100 - winnerFinalHP) / (runWinnerDmg || 1);
    let loserScale = 100 / (runLoserDmg || 1);

    // Opponent-specific announcer lines (50% chance to use when available)
    const oppLines = this._CREATURE_FIGHT_LINES[opponent.name];
    const pickOppLine = () => oppLines && Math.random() < 0.5
      ? oppLines[Math.floor(Math.random() * oppLines.length)]
      : pickLine(this._FIGHT_LINES_EVEN);

    // Announcer beats — Acts 1-2 use neutral lines (winner not yet decided by QTEs)
    // Act 3 uses winner/loser names (resolved after QTE 3)
    const announcerBeats = [
      [800, pickOppLine()],
      [3000, pickOppLine()],
      [5500 + QTE_OFFSET_1, pickOppLine()],
      [7500 + QTE_OFFSET_1, (chargeStart <= 7500 && chargeStart + chargeLeadTime >= 7500) ? null : pickLine(this._FIGHT_LINES_EVEN)],
      [9800 + QTE_OFFSET_1, pickOppLine()],
      [12000 + QTE_OFFSET_1 + 2000, pickOppLine()],
    ];
    // Act 3 beats — scheduled via beat() closures so they read winner AFTER QTE 3 finalizes
    beat(15000 + QTE_OFFSET_3, () => {
      const wName = winner === 'employee' ? badge.name : opponent.name;
      setVSAnnouncer(`${wName.toUpperCase()} ${pickLine(this._FIGHT_LINES_WINNING)}`);
    });
    beat(17500 + QTE_OFFSET_3, () => setVSAnnouncer(pickLine(this._FIGHT_LINES_FINISH)));
    // Comeback announcer lines
    if (doComeback) {
      announcerBeats.push(
        [13600 + QTE_OFFSET_3, pickLine(this._FIGHT_LINES_COMEBACK_SHOCK)],
        [14800 + QTE_OFFSET_3, pickLine(this._FIGHT_LINES_COMEBACK_RALLY)]
      );
    }
    announcerBeats.filter(([, line]) => line !== null).forEach(([delay, line]) => beat(delay, () => setVSAnnouncer(line)));

    // ── Stun Helper ────────────────────────────────────────
    let _stunActive = false;
    const _STUN_ANNOUNCER = [
      'DROPS A ONE-LINER!', 'WHAT A BURN!', 'CRITICAL HIT TO THE EGO!',
      'THE CROWD GOES WILD!', 'DEVASTATING VERBAL ATTACK!',
    ];
    const fireStun = (duration) => {
      _stunActive = true;
      const stunQuote = this._STUN_QUOTES[Math.floor(Math.random() * this._STUN_QUOTES.length)];
      setVSAnnouncer(`${badge.name.toUpperCase()} ${_STUN_ANNOUNCER[Math.floor(Math.random() * _STUN_ANNOUNCER.length)]}`);
      if (window.ArcadeSFX) ArcadeSFX.play('quoteTaunt');

      const stunBubble = document.createElement('div');
      stunBubble.className = 'arcade-vs-stun-bubble';
      overlay.appendChild(stunBubble);
      this._typewriterEffect(stunBubble, stunQuote, 40);
      requestAnimationFrame(() => stunBubble.classList.add('visible'));

      const oppWrap = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait-wrap');
      if (oppWrap) {
        oppWrap.classList.add('stunned');
        if (window.ArcadeSFX) ArcadeSFX.play('stun');
        const stars = document.createElement('div');
        stars.className = 'arcade-vs-stun-stars';
        stars.innerHTML = '<span class="arcade-vs-stun-stars-icons">\u2B50\u{1F4AB}\u2B50</span><span class="arcade-vs-stun-stars-label">STUNNED</span>';
        oppWrap.appendChild(stars);
      }

      // Use setTimeout (relative to now), not beat (relative to fight start)
      const cleanupTid = setTimeout(() => {
        _stunActive = false;
        const oppWrap2 = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait-wrap');
        if (oppWrap2) oppWrap2.classList.remove('stunned');
        const stars2 = oppWrap2?.querySelector('.arcade-vs-stun-stars');
        if (stars2) stars2.remove();
        stunBubble.classList.remove('visible');
        setTimeout(() => stunBubble.remove(), 300);
      }, duration);
      this._timeouts.push(cleanupTid);
    };

    // Comeback stun: employee fires stun during the near-death pause (Act 3 timing)
    if (doComeback) {
      beat(13800 + QTE_OFFSET_3, () => fireStun(2500));
    }

    // Special move — charge buildup then release (Act 2 timing)
    // No stun overlap possible — stun is now QTE-earned and fires between Acts 2-3
    if (opponent.type !== 'intern' && opponent.move) {
      beat(chargeStart + QTE_OFFSET_1, () => {
        this._startSpecialMoveCharge(overlay);
        setVSAnnouncer(`${opponent.name.toUpperCase()} IS CHARGING UP...`);
      });
      beat(specialTime + QTE_OFFSET_1, () => {
        this._triggerSpecialMove(overlay, oppColor, opponent);
        setVSAnnouncer(`${opponent.name.toUpperCase()} USES ${opponent.move}!`);
      });
    }

    // Boss finisher — second special move as killing blow (Act 3 timing)
    if (doBossFinisher && opponent.move) {
      beat(16500 + QTE_OFFSET_3, () => {
        this._startSpecialMoveCharge(overlay);
        setVSAnnouncer(`${opponent.name.toUpperCase()} IS CHARGING... FINISHING MOVE!`);
      });
      beat(17800 + QTE_OFFSET_3, () => {
        this._triggerSpecialMove(overlay, oppColor, opponent);
        setVSAnnouncer(pickLine([
          'FINISHING MOVE!', 'EXECUTIVE DECISION!', 'NO APPEALS!', 'MEETING ADJOURNED... PERMANENTLY!'
        ]));
      });
    }

    // Slowdown visual cue before KO (Act 3 timing)
    beat(18000 + QTE_OFFSET_3, () => {
      overlay.classList.add('ko-slowdown');
    });

    // ── Hit Processing Helper ───────────────────────────────
    const processHit = (hit) => {
      if (hit.final) {
        loserHP = 0;
        setHP(loserFill, loserTrail, 0);

        if (!hit.isFinisher) {
          const spark = loserSpark;
          const portrait = winner === 'employee' ? rightPortrait : leftPortrait;
          doHit(spark, portrait, 'ko');
        } else {
          if (window.ArcadeSFX) ArcadeSFX.play('koImpact');
        }

        overlay.classList.remove('ko-slowdown');
        overlay.classList.add('ko-zoom');

        const koSpark = loserSpark;
        const loserSide = koSpark.closest('.arcade-vs-side');
        if (loserSide) {
          const koEl = document.createElement('div');
          koEl.className = 'arcade-vs-ko-text';
          koEl.textContent = 'K.O.';
          loserSide.appendChild(koEl);
        }
        return;
      }

      let spark, portrait;
      if (hit.target === 'winner') {
        spark = winnerSpark;
        portrait = winner === 'employee' ? leftPortrait : rightPortrait;
        winnerHP -= hit.dmg * winnerScale;
        winnerHP = Math.max(winnerFinalHP, winnerHP);
        setHP(winnerFill, winnerTrail, winnerHP);
      } else {
        spark = loserSpark;
        portrait = winner === 'employee' ? rightPortrait : leftPortrait;
        loserHP -= hit.dmg * loserScale;
        loserHP = Math.max(5, loserHP);
        setHP(loserFill, loserTrail, loserHP);
      }
      doHit(spark, portrait, hit.weight || 'light');
      updateCombo(hit.target);
    };

    // ── Schedule Hits — Act 1 (no offset), Act 2 (+QTE_OFFSET_1), Act 3 (+QTE_OFFSET_3)
    allHits.forEach(hit => beat(hit.delay, () => processHit(hit)));
    act2Hits.forEach(hit => beat(hit.delay + QTE_OFFSET_1, () => processHit(hit)));
    act3Hits.forEach(hit => beat(hit.delay + QTE_OFFSET_3, () => processHit(hit)));

    // ── QTE Power Meter + Scheduling ──────────────────────────
    let meterSegs = [];
    let meterEl = null;

    if (!isPresentation) {
      // Create power meter DOM (3 empty segments, left of employee portrait)
      meterEl = document.createElement('div');
      meterEl.className = 'arcade-qte-meter';
      for (let i = 0; i < 3; i++) {
        const seg = document.createElement('div');
        seg.className = 'arcade-qte-meter-seg';
        meterEl.appendChild(seg);
        meterSegs.push(seg);
      }
      const meterLabel = document.createElement('div');
      meterLabel.className = 'arcade-qte-meter-label';
      meterLabel.textContent = 'PWR';
      meterEl.appendChild(meterLabel);
      // Append to left side container (not portrait-wrap which has overflow:hidden)
      const empSide = overlay.querySelector('.arcade-vs-left');
      if (empSide) empSide.appendChild(meterEl);

      // Show meter when fight starts
      beat(500, () => meterEl.classList.add('visible'));

      // Meter fill/fail helper
      const fillMeterSeg = (qteIndex, success) => {
        const seg = meterSegs[qteIndex];
        if (!seg) return;
        if (success) {
          seg.classList.add('filled');
          if (window.ArcadeSFX) ArcadeSFX.play('lightHit');
          // Check if meter is full
          if (qteIndex === 2 && fightState.qteSuccesses === 3) {
            meterEl.classList.add('full');
          }
        } else {
          seg.classList.add('failed');
        }
      };

      // QTE bonus damage — drops opponent HP bar on success (visual feedback)
      const qteHitDamage = (level) => {
        // Damage the opponent (loser if employee is winning, winner if not)
        const dmg = level === 3 ? 8 : level === 2 ? 5 : 3;
        if (winner === 'employee') {
          loserHP = Math.max(5, loserHP - dmg * loserScale);
          setHP(loserFill, loserTrail, loserHP);
        } else {
          winnerHP = Math.max(winnerFinalHP, winnerHP - dmg * winnerScale);
          setHP(winnerFill, winnerTrail, winnerHP);
        }
      };

      // QTE 1: 2-arrow sequence (1.5s window) — light hit
      beat(4800, () => {
        const seq = this._generateSequence(2);
        this._fireQTE(overlay, empColor, setVSAnnouncer, seq, 1500, 1).then(success => {
          if (success) { fightState.qteSuccesses++; qteHitDamage(1); }
          fillMeterSeg(0, success);
        });
      });

      // QTE 2: 3-arrow sequence (1.5s window) — medium hit
      beat(11400, () => {
        const seq = this._generateSequence(3);
        this._fireQTE(overlay, empColor, setVSAnnouncer, seq, 1500, 2).then(success => {
          if (success) { fightState.qteSuccesses++; qteHitDamage(2); }
          fillMeterSeg(1, success);
        });
      });

      // QTE 3: 4-arrow stratagem (2.5s window) — heavy hit + stun if 3/3
      beat(15000, () => {
        const seq = this._generateSequence(4);
        this._fireQTE(overlay, empColor, setVSAnnouncer, seq, 2500, 3).then(success => {
          if (success) { fightState.qteSuccesses++; qteHitDamage(3); }
          fillMeterSeg(2, success);

          // Finalize winner with QTE bonuses
          const newWinner = this._finalizeWinner(fightState, opponent);
          fightState.winner = newWinner;

          if (newWinner !== winner) {
            // Winner flipped — swap HP and re-assign sides
            const tmpHP = winnerHP;
            winnerHP = loserHP;
            loserHP = tmpHP;

            winner = newWinner;
            const newSides = this._assignFighterSides(overlay, winner);
            loserFill = newSides.loserFill;
            loserTrail = newSides.loserTrail;
            loserSpark = newSides.loserSpark;
            winnerFill = newSides.winnerFill;
            winnerTrail = newSides.winnerTrail;
            winnerSpark = newSides.winnerSpark;

            // Update HP bar visuals to match swapped sides
            setHP(winnerFill, winnerTrail, winnerHP);
            setHP(loserFill, loserTrail, loserHP);
          } else {
            fightState.winner = winner;
          }

          // Recalculate Act 3 scales from current HP
          let act3WinDmg = 0, act3LoseDmg = 0;
          act3Hits.forEach(h => {
            if (h.final) return;
            if (h.target === 'winner') act3WinDmg += h.dmg;
            else act3LoseDmg += h.dmg;
          });
          winnerScale = Math.max(0, winnerHP - winnerFinalHP) / (act3WinDmg || 1);
          loserScale = loserHP / (act3LoseDmg || 1);

          // 3/3 QTE success: fire player-earned stun + combo hits (skip if comeback has its own stun)
          if (fightState.qteSuccesses === 3 && !doComeback) {
            const perfectLines = ['PERFECT COMBO!', 'FLAWLESS EXECUTION!', 'ALL STRATAGEMS COMPLETE!', 'MAXIMUM EMPLOYEE ENGAGEMENT!'];
            setVSAnnouncer(perfectLines[Math.floor(Math.random() * perfectLines.length)]);
            fireStun(2500);
            // Rapid combo hits on stunned opponent — visual + HP damage
            const stunSpark = overlay.querySelector('.arcade-vs-right .arcade-vs-hit-spark');
            const stunPortrait = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait');
            const comboDelays = [400, 700, 1000, 1400];
            comboDelays.forEach(d => {
              const tid = setTimeout(() => {
                // HP damage per combo hit
                loserHP = Math.max(5, loserHP - 3 * loserScale);
                setHP(loserFill, loserTrail, loserHP);

                if (stunSpark) {
                  const rx = 10 + Math.floor(Math.random() * 80);
                  const ry = 10 + Math.floor(Math.random() * 80);
                  stunSpark.style.setProperty('--spark-x', rx + '%');
                  stunSpark.style.setProperty('--spark-y', ry + '%');
                  stunSpark.style.setProperty('--spark-color', empColor);
                  stunSpark.classList.add('flash');
                  setTimeout(() => stunSpark.classList.remove('flash'), 150);
                }
                if (stunPortrait) {
                  stunPortrait.classList.add('hit-flash-bright');
                  setTimeout(() => stunPortrait.classList.remove('hit-flash-bright'), 80);
                }
                if (window.ArcadeSFX) ArcadeSFX.play('lightHit');
                overlay.classList.add('hit-shake');
                setTimeout(() => overlay.classList.remove('hit-shake'), 100);
              }, d);
              this._timeouts.push(tid);
            });
          }

          // Clean up test overrides now that all QTEs have resolved
          if (window._testFight) delete window._testFight;
        });
      });
    } else {
      // Presentation mode: no QTEs, set winner immediately
      fightState.winner = fightState.baseWinner;
      if (window._testFight) delete window._testFight;
    }

    // Clean up combo counter before KO result (Act 3 timing)
    beat(18400 + QTE_OFFSET_3, () => { if (comboEl) { comboEl.remove(); comboEl = null; } });

    // Loser portrait dims after K.O. (Act 3 timing)
    beat(19000 + QTE_OFFSET_3, () => {
      const loserSide = winner === 'employee'
        ? overlay.querySelector('.arcade-vs-right')
        : overlay.querySelector('.arcade-vs-left');
      if (loserSide) loserSide.classList.add('defeated');
    });
  },

  // ─── QTE Prompt — Arrow Sequence ────────────────────────────
  // Returns Promise<boolean>: true = full sequence correct, false = miss/wrong/timeout.
  // `sequence`: array of directions ['up','down','left','right']
  // `window_ms`: time allowed to complete the sequence

  _fireQTE(overlay, empColor, setVSAnnouncer, sequence, window_ms, qteNumber) {
    return new Promise(resolve => {
      // Test override: skip entirely
      const t = window._testFight || {};
      if (t.skipQTE) return resolve(false);

      // Test override: use pre-set result array
      if (Array.isArray(t.qteResults)) {
        const result = t.qteResults.shift();
        if (result) {
          this._qteSuccessEffects(overlay, empColor, setVSAnnouncer, qteNumber);
        } else {
          const missLines = ['MISSED IT!', 'WRONG KEY!', 'TOO SLOW!', 'TIMEOUT!', 'REQUEST DENIED!'];
          setVSAnnouncer(missLines[Math.floor(Math.random() * missLines.length)]);
        }
        return resolve(!!result);
      }

      let resolved = false;
      let step = 0;

      const ARROW_CHARS = { up: '↑', down: '↓', left: '←', right: '→' };
      const KEY_MAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

      // Build DOM
      const prompt = document.createElement('div');
      prompt.className = 'arcade-qte-prompt';

      const arrowsDiv = document.createElement('div');
      arrowsDiv.className = 'arcade-qte-arrows';

      const arrowEls = sequence.map((dir, i) => {
        const el = document.createElement('div');
        el.className = 'arcade-qte-arrow' + (i === 0 ? ' active' : '');
        el.dataset.dir = dir;
        el.textContent = ARROW_CHARS[dir];
        arrowsDiv.appendChild(el);
        return el;
      });

      const timerDiv = document.createElement('div');
      timerDiv.className = 'arcade-qte-timer';
      const timerFill = document.createElement('div');
      timerFill.className = 'arcade-qte-timer-fill';
      timerFill.style.setProperty('--qte-window', window_ms + 'ms');
      timerDiv.appendChild(timerFill);

      const hint = document.createElement('div');
      hint.className = 'arcade-qte-hint';
      hint.textContent = ('ontouchstart' in window) ? 'SWIPE!' : '';

      prompt.appendChild(arrowsDiv);
      prompt.appendChild(timerDiv);
      if (hint.textContent) prompt.appendChild(hint);
      overlay.appendChild(prompt);

      const cleanup = () => {
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('touchstart', onTouchStart);
        document.removeEventListener('touchend', onTouchEnd);
      };

      const succeed = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        clearTimeout(missTimer);
        prompt.classList.add('qte-success');
        this._qteSuccessEffects(overlay, empColor, setVSAnnouncer, qteNumber);
        resolve(true);
        const tid = setTimeout(() => prompt.remove(), 400);
        this._timeouts.push(tid);
      };

      const fail = (wrongIndex) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        clearTimeout(missTimer);
        // Mark the wrong arrow
        if (wrongIndex != null && arrowEls[wrongIndex]) {
          arrowEls[wrongIndex].classList.remove('active');
          arrowEls[wrongIndex].classList.add('wrong');
        }
        prompt.classList.add('qte-miss');
        const missLines = ['MISSED IT!', 'WRONG KEY!', 'TOO SLOW!', 'TIMEOUT!', 'REQUEST DENIED!'];
        setVSAnnouncer(missLines[Math.floor(Math.random() * missLines.length)]);
        resolve(false);
        const tid = setTimeout(() => prompt.remove(), 500);
        this._timeouts.push(tid);
      };

      const miss = () => fail(step < sequence.length ? step : null);

      const advanceStep = (dir) => {
        if (resolved) return;
        if (dir === sequence[step]) {
          // Correct input
          arrowEls[step].classList.remove('active');
          arrowEls[step].classList.add('correct');
          if (window.ArcadeSFX) ArcadeSFX.play('lightHit');
          step++;
          if (step >= sequence.length) {
            // All correct — success
            succeed();
          } else {
            // Advance to next arrow
            arrowEls[step].classList.add('active');
          }
        } else {
          // Wrong input — immediate fail
          fail(step);
        }
      };

      const onKey = (e) => {
        const dir = KEY_MAP[e.code];
        if (dir) {
          e.preventDefault();
          advanceStep(dir);
        }
      };

      // Swipe detection for mobile
      let touchStartX = 0, touchStartY = 0;
      const SWIPE_THRESHOLD = 30;

      const onTouchStart = (e) => {
        if (resolved) return;
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
      };

      const onTouchEnd = (e) => {
        if (resolved) return;
        const touch = e.changedTouches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        // Need minimum swipe distance
        if (absDx < SWIPE_THRESHOLD && absDy < SWIPE_THRESHOLD) return;

        let dir;
        if (absDx > absDy) {
          dir = dx > 0 ? 'right' : 'left';
        } else {
          dir = dy > 0 ? 'down' : 'up';
        }
        e.preventDefault();
        advanceStep(dir);
      };

      document.addEventListener('keydown', onKey);
      document.addEventListener('touchstart', onTouchStart, { passive: true });
      document.addEventListener('touchend', onTouchEnd);

      const missTimer = setTimeout(miss, window_ms);
      this._timeouts.push(missTimer);
    });
  },

  // Generate a random arrow sequence of given length
  _generateSequence(length) {
    const dirs = ['up', 'down', 'left', 'right'];
    const t = window._testFight || {};
    // Test override for deterministic sequences
    if (Array.isArray(t.qteSequences)) {
      const seq = t.qteSequences.shift();
      if (seq) return seq;
    }
    const seq = [];
    for (let i = 0; i < length; i++) {
      seq.push(dirs[Math.floor(Math.random() * dirs.length)]);
    }
    return seq;
  },

  // QTE success visual/audio effects — escalates by qteNumber (1=light, 2=medium, 3=heavy)
  _qteSuccessEffects(overlay, empColor, setVSAnnouncer, qteNumber) {
    const level = qteNumber || 1;

    // Gold outline glow on employee portrait (power-up, not damage)
    const empWrap = overlay.querySelector('.arcade-vs-left .arcade-vs-portrait-wrap');
    if (empWrap) {
      empWrap.classList.add('qte-power-surge');
      const tid = setTimeout(() => empWrap.classList.remove('qte-power-surge'), 800);
      this._timeouts.push(tid);
    }

    // Bonus hit on opponent — escalating intensity
    const oppSpark = overlay.querySelector('.arcade-vs-right .arcade-vs-hit-spark');
    const oppPortrait = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait');
    const oppWrap = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait-wrap');
    if (oppSpark) {
      const randX = 10 + Math.floor(Math.random() * 80);
      const randY = 10 + Math.floor(Math.random() * 80);
      oppSpark.style.setProperty('--spark-x', randX + '%');
      oppSpark.style.setProperty('--spark-y', randY + '%');
      oppSpark.style.setProperty('--spark-color', empColor);
      oppSpark.classList.add('flash');
      const sparkTid = setTimeout(() => oppSpark.classList.remove('flash'), 150);
      this._timeouts.push(sparkTid);
    }
    if (oppPortrait) {
      oppPortrait.classList.add('hit-flash-bright');
      const hitTid = setTimeout(() => oppPortrait.classList.remove('hit-flash-bright'), 100);
      this._timeouts.push(hitTid);
    }

    // Hitstop vibrate — opponent only, duration scales with level
    if (oppWrap) {
      oppWrap.classList.add('hitstop-vibrate');
      const stopDur = level === 3 ? 200 : level === 2 ? 150 : 80;
      const stopTid = setTimeout(() => oppWrap.classList.remove('hitstop-vibrate'), stopDur);
      this._timeouts.push(stopTid);
    }

    // Screen shake — medium+ only
    if (level >= 2) {
      overlay.classList.add('hit-shake');
      const shakeTid = setTimeout(() => overlay.classList.remove('hit-shake'), 120);
      this._timeouts.push(shakeTid);
    }

    // Announcer — office-themed, escalating intensity
    const lines = level === 3
      ? ['PERFORMANCE REVIEW: EXCEEDS ALL EXPECTATIONS!', 'UNLIMITED PTO ACTIVATED!', 'CORNER OFFICE ENERGY!']
      : level === 2
        ? ['PROMOTED TO SENIOR!', 'EXPENSE REPORT APPROVED!', 'ABOVE AND BEYOND!']
        : ['SOLID WORK!', 'NOTED IN THE MINUTES!', 'MEETING CONTRIBUTION!'];
    setVSAnnouncer(lines[Math.floor(Math.random() * lines.length)]);

    // SFX — escalating
    if (window.ArcadeSFX) {
      if (level === 3) ArcadeSFX.play('koImpact');
      else if (level === 2) ArcadeSFX.play('heavyHit');
      else ArcadeSFX.play('lightHit');
    }
  },

  // ─── Finalize Winner After QTEs ──────────────────────────────
  // Re-rolls winner based on base probability + QTE bonus.

  _finalizeWinner(fightState, opponent) {
    // Respect test override
    const t = window._testFight || {};
    if (t.winner) return t.winner;

    // Base probability (employee wins)
    let prob;
    if (opponent.type === 'intern') prob = 0.80;
    else if (opponent.type === 'boss') prob = 0.35;
    else prob = 0.50; // creature

    // QTE bonus: +15% per success, capped at 95%
    prob = Math.min(0.95, prob + fightState.qteSuccesses * 0.15);

    return Math.random() < prob ? 'employee' : 'opponent';
  },

  // ─── Fighter Side Assignments ─────────────────────────────────
  // Extracts the winner/loser element mapping. Called once for Acts 1-2,
  // then again after QTE 3 if winner changes.

  _assignFighterSides(overlay, winner) {
    const leftFill = overlay.querySelector('.arcade-vs-hp-left .arcade-vs-hp-fill');
    const rightFill = overlay.querySelector('.arcade-vs-hp-right .arcade-vs-hp-fill');
    const leftTrail = overlay.querySelector('.arcade-vs-hp-left .arcade-vs-hp-trail');
    const rightTrail = overlay.querySelector('.arcade-vs-hp-right .arcade-vs-hp-trail');
    const leftSpark = overlay.querySelector('.arcade-vs-left .arcade-vs-hit-spark');
    const rightSpark = overlay.querySelector('.arcade-vs-right .arcade-vs-hit-spark');
    return {
      loserFill:   winner === 'employee' ? rightFill : leftFill,
      loserTrail:  winner === 'employee' ? rightTrail : leftTrail,
      loserSpark:  winner === 'employee' ? rightSpark : leftSpark,
      winnerFill:  winner === 'employee' ? leftFill : rightFill,
      winnerTrail: winner === 'employee' ? leftTrail : rightTrail,
      winnerSpark: winner === 'employee' ? leftSpark : rightSpark,
    };
  },

  // ─── Fight Result Slot Marking ──────────────────────────────

  _markFightResult(employeeId, result) {
    const slot = this._container.querySelector(`[data-employee-id="${employeeId}"]`);
    if (!slot) return;
    const cls = result === 'winner' ? 'fight-winner' : 'fight-loser';
    slot.classList.add(cls);
    // Add result overlay text if not already present
    if (!slot.querySelector('.arcade-slot-result')) {
      const label = document.createElement('div');
      label.className = 'arcade-slot-result';
      label.textContent = result === 'winner' ? 'WIN' : 'LOSS';
      slot.appendChild(label);
    }
    if (result === 'winner') {
      slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  },

  // ─── Winner Confetti ────────────────────────────────────

  _spawnConfetti(container, color) {
    const count = 30;
    const shapes = ['square', 'rect', 'circle'];
    // Generate a palette: main color + white + gold variants
    const colors = [color, color, color, '#ffffff', '#ffcc00'];
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'arcade-confetti-particle';
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      const c = colors[Math.floor(Math.random() * colors.length)];
      // Bigger particles, wider spread, longer travel
      const x = 10 + Math.random() * 80; // 10-90% horizontal
      const size = 6 + Math.random() * 12; // 6-18px
      const delay = Math.random() * 0.5; // 0-500ms stagger
      const duration = 2.0 + Math.random() * 1.0; // 2-3s
      const drift = -100 + Math.random() * 200; // wider horizontal drift
      const spin = Math.random() * 1080 - 540; // more rotation

      el.style.cssText = `
        left: ${x}%;
        bottom: 40%;
        width: ${shape === 'rect' ? size * 2.5 : size}px;
        height: ${size}px;
        background: ${c};
        border-radius: ${shape === 'circle' ? '50%' : '2px'};
        animation-delay: ${delay}s;
        animation-duration: ${duration}s;
        --confetti-drift: ${drift}px;
        --confetti-spin: ${spin}deg;
      `;
      container.appendChild(el);
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }
  },

  // ─── Boss Special Move ──────────────────────────────────

  // ─── Boss Entrance Arc Sparks ──────────────────────────────
  _spawnBossArcSparks(overlay, wrapEl, color, duration) {
    duration = duration || 1200;
    const w = wrapEl.offsetWidth || 200;
    const h = wrapEl.offsetHeight || 200;

    // Spread bolts evenly across the duration
    const boltCount = Math.max(6, Math.round(duration / 200));
    const boltInterval = duration / boltCount;
    for (let i = 0; i < boltCount; i++) {
      const tid = setTimeout(() => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'arcade-fx-border-bolt');
        svg.style.cssText = `left:0;top:0;width:${w}px;height:${h}px;`;

        const side = Math.floor(Math.random() * 4);
        let sx, sy;
        if (side === 0) { sx = Math.random() * w; sy = 0; }
        else if (side === 1) { sx = w; sy = Math.random() * h; }
        else if (side === 2) { sx = Math.random() * w; sy = h; }
        else { sx = 0; sy = Math.random() * h; }

        const segments = 4 + Math.floor(Math.random() * 3);
        let px = sx, py = sy;
        const points = [[px, py]];
        for (let s = 0; s < segments; s++) {
          const outward = s >= segments - 2;
          const jx = (Math.random() - 0.5) * (outward ? 60 : 30);
          const jy = (Math.random() - 0.5) * (outward ? 60 : 30);
          if (side === 0 || side === 2) px += 15 + Math.random() * 25;
          else py += 15 + Math.random() * 25;
          if (outward) { px += jx; py += jy; }
          else { px += jx * 0.3; py += jy * 0.3; }
          points.push([px, py]);
        }

        for (let p = 0; p < points.length - 1; p++) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', points[p][0]);
          line.setAttribute('y1', points[p][1]);
          line.setAttribute('x2', points[p+1][0]);
          line.setAttribute('y2', points[p+1][1]);
          svg.appendChild(line);
          const core = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          core.setAttribute('class', 'bolt-core');
          core.setAttribute('x1', points[p][0]);
          core.setAttribute('y1', points[p][1]);
          core.setAttribute('x2', points[p+1][0]);
          core.setAttribute('y2', points[p+1][1]);
          svg.appendChild(core);
        }
        wrapEl.appendChild(svg);
        setTimeout(() => svg.remove(), 250);
      }, i * boltInterval);
      this._timeouts.push(tid);
    }

    // Spread sparks evenly across the duration
    const sparkCount = Math.max(12, Math.round(duration / 100));
    const sparkInterval = duration / sparkCount;
    for (let i = 0; i < sparkCount; i++) {
      const tid = setTimeout(() => {
        const spark = document.createElement('div');
        spark.className = 'arcade-fx-arc-spark';
        const side = Math.floor(Math.random() * 4);
        let x, y;
        if (side === 0) { x = Math.random() * 100; y = 0; }
        else if (side === 1) { x = 100; y = Math.random() * 100; }
        else if (side === 2) { x = Math.random() * 100; y = 100; }
        else { x = 0; y = Math.random() * 100; }
        const arcDist = 35 + Math.random() * 65;
        const arcAngle = (side === 0 ? -Math.PI/2 : side === 1 ? 0 : side === 2 ? Math.PI/2 : Math.PI) + (Math.random() - 0.5) * 1.2;
        const dx = Math.cos(arcAngle) * arcDist;
        const dy = Math.sin(arcAngle) * arcDist;
        spark.style.cssText = `
          left: ${x}%; top: ${y}%;
          --arc-dx: ${dx}px; --arc-dy: ${dy}px;
          background: ${color};
          box-shadow: 0 0 6px ${color}, 0 0 14px ${color}, 0 0 22px ${color};
        `;
        wrapEl.appendChild(spark);
        spark.addEventListener('animationend', () => spark.remove(), { once: true });
      }, i * sparkInterval);
      this._timeouts.push(tid);
    }
  },

  _startSpecialMoveCharge(overlay) {
    // Text starts pulsing
    const classEl = overlay.querySelector('.arcade-vs-right .arcade-vs-fighter-class');
    if (classEl) {
      classEl.classList.add('special-move-charging');
    }
    // Portrait gets charging aura glow
    const portrait = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait-wrap');
    if (portrait) {
      portrait.classList.add('special-move-charge-aura');
    }
    // Screen darken for dramatic isolation
    const darken = overlay.querySelector('.arcade-vs-darken-overlay');
    if (darken) darken.classList.add('active');
    // Charge whoosh sound
    if (window.ArcadeSFX) ArcadeSFX.play('whoosh');
  },

  _triggerSpecialMove(overlay, color, opponent) {
    const opponentType = opponent.type || opponent;
    // Remove charging phase
    const classEl = overlay.querySelector('.arcade-vs-right .arcade-vs-fighter-class');
    if (classEl) {
      classEl.classList.remove('special-move-charging');
      classEl.classList.add('special-move-highlight');
      setTimeout(() => classEl.classList.remove('special-move-highlight'), 1500);
    }

    // Remove charge aura, add shake
    const rightSide = overlay.querySelector('.arcade-vs-right');
    if (rightSide) {
      const portrait = rightSide.querySelector('.arcade-vs-portrait-wrap');
      if (portrait) portrait.classList.remove('special-move-charge-aura');
      rightSide.classList.add('special-move-windup');
      setTimeout(() => rightSide.classList.remove('special-move-windup'), 600);
    }

    // Boom sound on release
    if (window.ArcadeSFX) ArcadeSFX.play('boom');
    // Speed lines on release
    const speedLines = overlay.querySelector('.arcade-vs-speed-lines');
    if (speedLines) {
      speedLines.classList.add('active');
      setTimeout(() => speedLines.classList.remove('active'), 400);
    }
    // Remove screen darken
    const darken = overlay.querySelector('.arcade-vs-darken-overlay');
    if (darken) {
      setTimeout(() => darken.classList.remove('active'), 300);
    }

    const bossPortrait = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait-wrap');
    const empPortrait = overlay.querySelector('.arcade-vs-left .arcade-vs-portrait-wrap');
    if (!bossPortrait || !empPortrait) return;

    // prefers-reduced-motion: skip the elaborate particle/SVG spawn loops,
    // but still register the impact so the fight progresses normally.
    if (this._motionReduced()) {
      this._specialImpact(overlay, empPortrait, 300);
      return;
    }

    // Move-specific SFX mapping
    const SPECIAL_SFX = {
      'BUDGET SLASH': 'specialSlash',
      'HAZMAT EXPLOSION': 'specialMicrowave',
      'PAPER FEED FRENZY': 'specialPaper',
      'PACKET STORM': 'specialPacket',
      'ENDLESS ANECDOTE': 'specialAnecdote',
      'COMPLIANCE LOCKDOWN': 'specialLockdown',
      'CODE SWITCH': 'specialCode',
      'EXPENSE DENIED': 'specialLockdown',
    };
    const BOSS_SFX = {
      'HD-00002': 'specialFeedback',   // Drew — Feedback Loop
      'HD-00003': 'specialDrumhit',    // Henry — Click Track of Doom
      'HD-00004': 'laserFire',         // Todd — 1000 Yard Stare
    };

    // Impact timing per special type (ms after FX launch when projectiles reach employee)
    const BOSS_IMPACT_DELAY = {
      'HD-00002': 400,  // Drew — feedback waves 0.6s flight
      'HD-00003': 250,  // Henry — drum strikes 0.3s fall
      // HD-00004 (Todd) omitted — has bespoke sparks + flames
    };

    if (opponentType === 'boss') {
      // Band members: check for boss-specific effects, default to music notes
      const bossLauncher = opponent._bossId && this._BOSS_SPECIAL_FX[opponent._bossId];
      if (bossLauncher) {
        bossLauncher.call(this, overlay, bossPortrait, empPortrait, color);
        // Boss-specific SFX
        const bossSfx = BOSS_SFX[opponent._bossId];
        if (bossSfx && window.ArcadeSFX) {
          ArcadeSFX.play(bossSfx);
          // Todd laser: delayed impact sound
          if (opponent._bossId === 'HD-00004') ArcadeSFX.playDelayed('laserImpact', 600);
        }
        // Impact on employee portrait (skip Todd — has own impact)
        const impactDelay = BOSS_IMPACT_DELAY[opponent._bossId];
        if (impactDelay) this._specialImpact(overlay, empPortrait, impactDelay);
      } else {
        this._launchMusicNotes(overlay, bossPortrait, empPortrait, color);
        // Music notes impact
        this._specialImpact(overlay, empPortrait, 500);
      }
    } else {
      // Creatures: move-specific effects (lightning as fallback)
      const moveName = opponent.move || '';
      const launcher = this._CREATURE_SPECIAL_FX[moveName];
      if (launcher) {
        launcher.call(this, overlay, bossPortrait, empPortrait, color);
        // Creature-specific SFX
        const creatureSfx = SPECIAL_SFX[moveName];
        if (creatureSfx && window.ArcadeSFX) ArcadeSFX.play(creatureSfx);
      } else {
        this._launchLightning(overlay, bossPortrait, empPortrait, color);
      }
      // Creature special impact — timing varies by move animation duration
      const CREATURE_IMPACT_DELAY = {
        'ENDLESS ANECDOTE': 550,  // bubbles fly 0.9s
        'BUDGET SLASH': 350,      // slashes sweep 0.5s
        'HAZMAT EXPLOSION': 400,  // gas clouds 0.7s
        'PAPER FEED FRENZY': 350, // papers fly 0.5s
        'PACKET STORM': 400,      // packets fly 0.6s
        'COMPLIANCE LOCKDOWN': 300, // bars slide 0.4s
        'CODE SWITCH': 400,       // symbols fly 0.6s
        'EXPENSE DENIED': 350,    // stamps slam 0.4s
      };
      this._specialImpact(overlay, empPortrait, CREATURE_IMPACT_DELAY[moveName] || 400);
    }
  },

  // ─── Creature-Specific Special Move Effects ────────────────
  // Each launcher follows the music notes pattern: 20-24 particles,
  // 32-56px, 60ms stagger, flying from opponent toward employee.

  _CREATURE_SPECIAL_FX: {
    'BUDGET SLASH': function(overlay, fromEl, toEl, color) {
      // Diagonal slash lines sweeping across the screen
      const count = 5;
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const el = document.createElement('div');
          el.className = 'arcade-fx-slash';
          const yOff = -40 + i * 30 + (Math.random() - 0.5) * 20;
          el.style.cssText = `top: calc(50% + ${yOff}px); --slash-color: ${color};`;
          overlay.appendChild(el);
          if (i === 0) {
            overlay.classList.add('lightning-flash');
            setTimeout(() => overlay.classList.remove('lightning-flash'), 150);
          }
          el.addEventListener('animationend', () => el.remove(), { once: true });
        }, i * 100);
      }
    },

    'HAZMAT EXPLOSION': function(overlay, fromEl, toEl, color) {
      // Toxic green gas clouds expanding outward — BIG clouds
      const overlayRect = overlay.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const cx = fromRect.left - overlayRect.left + fromRect.width / 2;
      const cy = fromRect.top - overlayRect.top + fromRect.height / 2;
      const count = 22;
      overlay.classList.add('lightning-flash');
      setTimeout(() => overlay.classList.remove('lightning-flash'), 150);
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const el = document.createElement('div');
          el.className = 'arcade-fx-gas';
          const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
          const dist = 180 + Math.random() * 350;
          const dx = Math.cos(angle) * dist;
          const dy = Math.sin(angle) * dist;
          const size = 90 + Math.random() * 120;
          el.style.cssText = `
            left: ${cx}px; top: ${cy}px;
            width: ${size}px; height: ${size}px;
            --gas-x: ${dx}px; --gas-y: ${dy}px;
          `;
          overlay.appendChild(el);
          el.addEventListener('animationend', () => el.remove(), { once: true });
        }, i * 50);
      }
    },

    'PAPER FEED FRENZY': function(overlay, fromEl, toEl, color) {
      // Paper sheets flying from right to left, tumbling — big and far
      const overlayRect = overlay.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const x1 = fromRect.left - overlayRect.left + fromRect.width / 2;
      const y1 = fromRect.top - overlayRect.top + fromRect.height / 2;
      const count = 30;
      overlay.classList.add('lightning-flash');
      setTimeout(() => overlay.classList.remove('lightning-flash'), 150);
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const el = document.createElement('div');
          el.className = 'arcade-fx-paper';
          const ySpread = (Math.random() - 0.5) * 160;
          const spin = -360 + Math.random() * 720;
          const travelX = -(350 + Math.random() * 400);
          const drift = (Math.random() - 0.5) * 120;
          el.style.cssText = `
            left: ${x1}px; top: ${y1 + ySpread}px;
            --paper-x: ${travelX}px; --paper-y: ${drift}px; --paper-spin: ${spin}deg;
          `;
          overlay.appendChild(el);
          el.addEventListener('animationend', () => el.remove(), { once: true });
        }, i * 55);
      }
    },

    'PACKET STORM': function(overlay, fromEl, toEl, color) {
      // Data packets with electricity — it's a STORM
      const overlayRect = overlay.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const x1 = fromRect.left - overlayRect.left + fromRect.width / 2;
      const y1 = fromRect.top - overlayRect.top + fromRect.height / 2;
      const travelX = (toRect.left - overlayRect.left + toRect.width / 2) - x1;
      const packets = ['01', '10', '11', 'FF', 'SYN', 'ACK', 'TCP', 'UDP', '404', '500', 'DNS', 'ARP', 'GET', 'POST', 'ERR', 'NAK'];
      const count = 36;
      overlay.classList.add('lightning-flash');
      setTimeout(() => overlay.classList.remove('lightning-flash'), 150);
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const el = document.createElement('div');
          // Alternate between packet and electric spark
          const isElectric = Math.random() < 0.3;
          el.className = isElectric ? 'arcade-fx-packet arcade-fx-packet-electric' : 'arcade-fx-packet';
          const ySpread = (Math.random() - 0.5) * 180;
          const drift = (Math.random() - 0.5) * 80;
          el.textContent = isElectric ? '⚡' : packets[Math.floor(Math.random() * packets.length)];
          el.style.cssText = `
            left: ${x1}px; top: ${y1 + ySpread}px;
            --pkt-x: ${travelX}px; --pkt-y: ${drift}px;
            color: ${color};
          `;
          overlay.appendChild(el);
          el.addEventListener('animationend', () => el.remove(), { once: true });
        }, i * 40);
      }
      // Fire 3 lightning bolts through the storm for extra drama
      this._launchLightning(overlay, fromEl, toEl, color);
    },

    'ENDLESS ANECDOTE': function(overlay, fromEl, toEl, color) {
      // Speech bubbles flooding from boss toward employee (full distance)
      const overlayRect = overlay.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const x1 = fromRect.left - overlayRect.left + fromRect.width / 2;
      const y1 = fromRect.top - overlayRect.top + fromRect.height / 2;
      const x2 = toRect.left - overlayRect.left + toRect.width / 2;
      const travelX = x2 - x1;
      const bubbles = ['\uD83D\uDCAC', '\uD83D\uDCAD', '\uD83D\uDDE3\uFE0F', '\u2753', '\u2755', '\uD83D\uDCA4'];
      const count = 26;
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const el = document.createElement('div');
          el.className = 'arcade-fx-bubble';
          const ySpread = (Math.random() - 0.5) * 240;
          const drift = (Math.random() - 0.5) * 100;
          const size = 48 + Math.random() * 32;
          el.textContent = bubbles[Math.floor(Math.random() * bubbles.length)];
          el.style.cssText = `
            left: ${x1}px; top: ${y1 + ySpread}px;
            font-size: ${size}px;
            --bubble-x: ${travelX + (Math.random() - 0.5) * 120}px; --bubble-y: ${drift}px;
          `;
          overlay.appendChild(el);
          el.addEventListener('animationend', () => el.remove(), { once: true });
        }, i * 60);
      }
    },

    'COMPLIANCE LOCKDOWN': function(overlay, fromEl, toEl, color) {
      // Red horizontal bars sliding across like security shutters
      const count = 6;
      overlay.classList.add('lightning-flash');
      setTimeout(() => overlay.classList.remove('lightning-flash'), 150);
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const el = document.createElement('div');
          el.className = 'arcade-fx-lockdown';
          const y = 15 + (i * 14); // spread vertically across the screen %
          el.style.cssText = `top: ${y}%;`;
          overlay.appendChild(el);
          el.addEventListener('animationend', () => el.remove(), { once: true });
        }, i * 80);
      }
    },

    'CODE SWITCH': function(overlay, fromEl, toEl, color) {
      // Spinning digits falling from top, matrix-style
      const overlayRect = overlay.getBoundingClientRect();
      const digits = '0123456789ABCDEF';
      const count = 28;
      overlay.classList.add('lightning-flash');
      setTimeout(() => overlay.classList.remove('lightning-flash'), 150);
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const el = document.createElement('div');
          el.className = 'arcade-fx-code';
          const x = 10 + Math.random() * 80; // 10-90% horizontal
          const ch = digits[Math.floor(Math.random() * digits.length)];
          const size = 32 + Math.random() * 24;
          const speed = 0.6 + Math.random() * 0.5;
          el.textContent = ch;
          el.style.cssText = `
            left: ${x}%; top: -5%;
            font-size: ${size}px;
            animation-duration: ${speed}s;
            color: ${color};
          `;
          overlay.appendChild(el);
          el.addEventListener('animationend', () => el.remove(), { once: true });
        }, i * 45);
      }
    },

    'EXPENSE DENIED': function(overlay, fromEl, toEl, color) {
      // Red "DENIED" stamps slamming across the screen
      const stamps = ['DENIED', 'REJECTED', 'OVER BUDGET', 'SEE ME', 'NO', 'FLAGGED'];
      const count = 10;
      overlay.classList.add('lightning-flash');
      setTimeout(() => overlay.classList.remove('lightning-flash'), 150);
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const el = document.createElement('div');
          el.className = 'arcade-fx-denied-stamp';
          el.textContent = stamps[Math.floor(Math.random() * stamps.length)];
          const x = 10 + Math.random() * 80;
          const y = 10 + Math.random() * 80;
          const rot = -25 + Math.random() * 50;
          const size = 28 + Math.random() * 20;
          el.style.cssText = `
            left: ${x}%; top: ${y}%;
            font-size: ${size}px;
            --stamp-rot: ${rot}deg;
          `;
          overlay.appendChild(el);
          el.addEventListener('animationend', () => el.remove(), { once: true });
        }, i * 100);
      }
    },
  },

  // ─── Boss-Specific Special Move Effects ────────────────────
  // Keyed by employee ID. Default for all bosses is music notes.

  _BOSS_SPECIAL_FX: {
    // Drew — FEEDBACK LOOP: amp drops between fighters, feedback waves + picks fly at employee
    'HD-00002': function(overlay, fromEl, toEl, color) {
      const overlayRect = overlay.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      // Amp positioned between fighters, closer to employee side
      const fromCx = fromRect.left - overlayRect.left + fromRect.width / 2;
      const toCx = toRect.left - overlayRect.left + toRect.width / 2;
      const ampX = fromCx + (toCx - fromCx) * 0.35; // 35% of the way toward employee
      const ampY = fromRect.top - overlayRect.top + fromRect.height * 0.6;
      const targetX = toCx;

      overlay.classList.add('lightning-flash');
      setTimeout(() => overlay.classList.remove('lightning-flash'), 150);

      // Drop in the guitar sprite
      const amp = document.createElement('div');
      amp.className = 'arcade-fx-amp';
      amp.innerHTML = '<img src="/images/arcade/drew-guitar.png" alt="" style="width:140px;height:auto;transform:scaleX(-1) rotate(-15deg);filter:drop-shadow(0 0 12px rgba(91,141,239,0.8));">';
      amp.style.cssText = `left: ${ampX}px; top: ${ampY}px;`;
      overlay.appendChild(amp);

      // Fire feedback waves toward employee
      const waveCount = 16;
      for (let i = 0; i < waveCount; i++) {
        setTimeout(() => {
          const wave = document.createElement('div');
          wave.className = 'arcade-fx-feedback-wave';
          const yOff = (Math.random() - 0.5) * 100;
          const travelX = targetX - ampX;
          wave.style.cssText = `
            left: ${ampX}px; top: ${ampY + yOff}px;
            --wave-travel: ${travelX}px;
          `;
          overlay.appendChild(wave);
          wave.addEventListener('animationend', () => wave.remove(), { once: true });

          // Guitar pick projectiles every 2nd wave
          if (i % 2 === 0) {
            const pick = document.createElement('div');
            pick.className = 'arcade-fx-guitar-pick';
            const pickY = (Math.random() - 0.5) * 140;
            const spin = -540 + Math.random() * 1080;
            pick.style.cssText = `
              left: ${ampX}px; top: ${ampY + pickY}px;
              --pick-travel: ${travelX}px;
              --pick-drift: ${(Math.random() - 0.5) * 80}px;
              --pick-spin: ${spin}deg;
            `;
            overlay.appendChild(pick);
            pick.addEventListener('animationend', () => pick.remove(), { once: true });
          }
        }, 150 + i * 80);
      }

      // Remove amp after waves finish
      setTimeout(() => amp.remove(), 2200);
    },

    // Henry — CLICK TRACK OF DOOM: rhythmic drumstick strikes raining down
    'HD-00003': function(overlay, fromEl, toEl, color) {
      const overlayRect = overlay.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const targetX = toRect.left - overlayRect.left + toRect.width / 2;
      const targetY = toRect.top - overlayRect.top + toRect.height / 2;
      const sticks = ['🥁', '🪘', '💥', '✖', '╳', '⚡', '🎵', '🔔'];
      const count = 28;

      overlay.classList.add('lightning-flash');
      setTimeout(() => overlay.classList.remove('lightning-flash'), 150);

      // Rhythmic strikes — alternating fast/slow like a click track tempo
      for (let i = 0; i < count; i++) {
        // Every 4th hit is a hard downbeat (accented)
        const isDownbeat = i % 4 === 0;
        const stagger = isDownbeat ? i * 50 : i * 50 + 15; // slight swing feel
        setTimeout(() => {
          const el = document.createElement('div');
          el.className = isDownbeat ? 'arcade-fx-drumhit arcade-fx-drumhit-accent' : 'arcade-fx-drumhit';
          const xSpread = targetX + (Math.random() - 0.5) * 200;
          const yStart = -20;
          const size = isDownbeat ? 36 + Math.random() * 16 : 24 + Math.random() * 16;
          el.textContent = isDownbeat ? sticks[Math.floor(Math.random() * 2)] : sticks[2 + Math.floor(Math.random() * (sticks.length - 2))];
          el.style.cssText = `
            left: ${xSpread}px; top: ${yStart}px;
            font-size: ${size}px;
            --drum-target-y: ${targetY + (Math.random() - 0.5) * 60}px;
            animation-duration: ${isDownbeat ? '0.3s' : '0.35s'};
          `;
          overlay.appendChild(el);
          el.addEventListener('animationend', () => el.remove(), { once: true });

          // Screen flash on downbeats
          if (isDownbeat) {
            overlay.classList.add('lightning-flash');
            setTimeout(() => overlay.classList.remove('lightning-flash'), 80);
          }
        }, stagger);
      }
    },

    // Todd — 1000 YARD STARE: laser beams from eyes
    'HD-00004': function(overlay, fromEl, toEl, color) {
      const overlayRect = overlay.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      // Beam origins: Todd's actual eye positions from SNES portrait
      // Left eye: ~38% from left, ~42% from top
      // Right eye: ~62% from left, ~42% from top
      const eyePositions = [
        { x: fromRect.left - overlayRect.left + fromRect.width * 0.38,
          y: fromRect.top - overlayRect.top + fromRect.height * 0.42 },
        { x: fromRect.left - overlayRect.left + fromRect.width * 0.62,
          y: fromRect.top - overlayRect.top + fromRect.height * 0.42 },
      ];
      // Target: employee center
      const targetX = toRect.left - overlayRect.left + toRect.width / 2;
      const targetY = toRect.top - overlayRect.top + toRect.height / 2;

      overlay.classList.add('lightning-flash');
      setTimeout(() => overlay.classList.remove('lightning-flash'), 150);

      // Fire two beams — one from each eye
      for (let b = 0; b < 2; b++) {
        const eyeX = eyePositions[b].x;
        const beamY = eyePositions[b].y;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:25;pointer-events:none;';
        svg.setAttribute('class', 'arcade-fx-laser-svg');

        const filterId = `laser-glow-${Date.now()}-${b}`;
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `<filter id="${filterId}"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

        // Main beam
        const beam = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        beam.setAttribute('x1', eyeX);
        beam.setAttribute('y1', beamY);
        beam.setAttribute('x2', targetX);
        beam.setAttribute('y2', targetY);
        beam.setAttribute('stroke', '#ff0000');
        beam.setAttribute('stroke-width', '18');
        beam.setAttribute('filter', `url(#${filterId})`);
        beam.setAttribute('stroke-linecap', 'round');

        // White-hot core
        const core = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        core.setAttribute('x1', eyeX);
        core.setAttribute('y1', beamY);
        core.setAttribute('x2', targetX);
        core.setAttribute('y2', targetY);
        core.setAttribute('stroke', '#ffffff');
        core.setAttribute('stroke-width', '8');
        core.setAttribute('stroke-linecap', 'round');

        svg.appendChild(defs);
        svg.appendChild(beam);
        svg.appendChild(core);
        overlay.appendChild(svg);
      }

      // Add eye glow origin points at Todd's actual eye positions
      for (let e = 0; e < 2; e++) {
        const eyeGlow = document.createElement('div');
        eyeGlow.className = 'arcade-fx-laser-eye-glow';
        eyeGlow.style.cssText = `left: ${eyePositions[e].x}px; top: ${eyePositions[e].y}px;`;
        overlay.appendChild(eyeGlow);
      }

      // Add eye glow to Todd's portrait
      fromEl.classList.add('laser-eyes-active');

      // Flicker the beams 3 times then remove
      const svgs = overlay.querySelectorAll('.arcade-fx-laser-svg');
      let flicker = 0;
      const flickerInterval = setInterval(() => {
        svgs.forEach(s => s.style.opacity = s.style.opacity === '0.3' ? '1' : '0.3');
        flicker++;
        if (flicker >= 6) {
          clearInterval(flickerInterval);
          svgs.forEach(s => s.remove());
          overlay.querySelectorAll('.arcade-fx-laser-eye-glow').forEach(g => g.remove());
          fromEl.classList.remove('laser-eyes-active');
        }
      }, 80);

      // Spawn impact sparks at target
      for (let i = 0; i < 16; i++) {
        setTimeout(() => {
          const spark = document.createElement('div');
          spark.className = 'arcade-fx-laser-spark';
          const angle = (Math.PI * 2 * i) / 16 + (Math.random() - 0.5) * 0.3;
          const dist = 40 + Math.random() * 80;
          const dx = Math.cos(angle) * dist;
          const dy = Math.sin(angle) * dist;
          spark.style.cssText = `
            left: ${targetX}px; top: ${targetY}px;
            --spark-dx: ${dx}px; --spark-dy: ${dy}px;
          `;
          overlay.appendChild(spark);
          spark.addEventListener('animationend', () => spark.remove(), { once: true });
        }, 100 + i * 30);
      }

      // Flames on the employee portrait — fire rising from impact point
      const flameEmojis = ['🔥', '🔥', '🔥', '💥', '🔥'];
      for (let i = 0; i < 12; i++) {
        setTimeout(() => {
          const flame = document.createElement('div');
          flame.className = 'arcade-fx-laser-flame';
          flame.textContent = flameEmojis[Math.floor(Math.random() * flameEmojis.length)];
          const xSpread = targetX + (Math.random() - 0.5) * 80;
          const yBase = targetY + (Math.random() - 0.5) * 40;
          const rise = -(60 + Math.random() * 80);
          const drift = (Math.random() - 0.5) * 30;
          const size = 20 + Math.random() * 20;
          flame.style.cssText = `
            left: ${xSpread}px; top: ${yBase}px;
            font-size: ${size}px;
            --flame-rise: ${rise}px;
            --flame-drift: ${drift}px;
          `;
          overlay.appendChild(flame);
          flame.addEventListener('animationend', () => flame.remove(), { once: true });
        }, 200 + i * 80);
      }
    },
  },

  _launchLightning(overlay, fromEl, toEl, color) {
    if (this._motionReduced()) return;
    const overlayRect = overlay.getBoundingClientRect();
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();

    // Start from boss center, end at employee center (relative to overlay)
    const x1 = fromRect.left - overlayRect.left + fromRect.width / 2;
    const y1 = fromRect.top - overlayRect.top + fromRect.height / 2;
    const x2 = toRect.left - overlayRect.left + toRect.width / 2;
    const y2 = toRect.top - overlayRect.top + toRect.height / 2;

    // Fire 5 staggered bolts for a crackling effect
    for (let b = 0; b < 5; b++) {
      setTimeout(() => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'arcade-lightning');
        svg.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;z-index:25;pointer-events:none;`;

        // Build jagged lightning path
        const segments = 8 + Math.floor(Math.random() * 5);
        let d = `M ${x1} ${y1}`;
        for (let i = 1; i < segments; i++) {
          const t = i / segments;
          const mx = x1 + (x2 - x1) * t;
          const my = y1 + (y2 - y1) * t;
          // Jagged offsets — bigger in the middle, tighter at ends
          const jag = Math.sin(t * Math.PI) * (30 + Math.random() * 50);
          const ox = (Math.random() - 0.5) * jag * 0.3;
          const oy = (Math.random() - 0.5) * jag;
          d += ` L ${mx + ox} ${my + oy}`;
        }
        d += ` L ${x2} ${y2}`;

        // Main bolt
        const bolt = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        bolt.setAttribute('d', d);
        bolt.setAttribute('fill', 'none');
        bolt.setAttribute('stroke', color);
        bolt.setAttribute('stroke-width', '5');
        const filterId = `lightning-glow-${Date.now()}-${b}`;
        bolt.setAttribute('filter', `url(#${filterId})`);
        bolt.setAttribute('stroke-linecap', 'round');

        // White-hot core
        const core = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        core.setAttribute('d', d);
        core.setAttribute('fill', 'none');
        core.setAttribute('stroke', '#ffffff');
        core.setAttribute('stroke-width', '2.5');
        core.setAttribute('stroke-linecap', 'round');

        // SVG filter for glow (unique ID per bolt to avoid collisions)
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `<filter id="${filterId}"><feGaussianBlur stdDeviation="6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

        svg.appendChild(defs);
        svg.appendChild(bolt);
        svg.appendChild(core);
        overlay.appendChild(svg);

        // Flash the whole overlay briefly
        if (b === 0) {
          overlay.classList.add('lightning-flash');
          setTimeout(() => overlay.classList.remove('lightning-flash'), 150);
        }

        // Remove after animation
        setTimeout(() => svg.remove(), 250 + Math.random() * 100);
      }, b * 120);
    }
  },

  // ─── Special Move Impact on Employee Portrait ──────────────
  // Timed damage flash on the employee portrait when projectiles arrive.
  // Skipped for Todd (HD-00004) who has bespoke sparks + flames.
  _specialImpact(overlay, toEl, delay) {
    setTimeout(() => {
      // Portrait red flash + shake
      if (toEl) {
        toEl.classList.add('special-hit-impact');
        setTimeout(() => toEl.classList.remove('special-hit-impact'), 400);
      }
      // Screen shake
      overlay.classList.add('hit-shake');
      setTimeout(() => overlay.classList.remove('hit-shake'), 150);
      // Impact sound
      if (window.ArcadeSFX) ArcadeSFX.play('heavyHit');
    }, delay);
  },

  _launchMusicNotes(overlay, fromEl, toEl, color) {
    if (this._motionReduced()) return;
    const overlayRect = overlay.getBoundingClientRect();
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();

    const x1 = fromRect.left - overlayRect.left + fromRect.width / 2;
    const y1 = fromRect.top - overlayRect.top + fromRect.height / 2;
    const x2 = toRect.left - overlayRect.left + toRect.width / 2;
    const y2 = toRect.top - overlayRect.top + toRect.height / 2;

    const notes = ['\u266A', '\u266B', '\u266C', '\u2669']; // ♪ ♫ ♬ ♩
    const count = 24;

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'arcade-music-note';
        el.textContent = notes[Math.floor(Math.random() * notes.length)];

        // Arc path: start near boss, fly toward employee with vertical spread
        const ySpread = (Math.random() - 0.5) * 120;
        const scale = 0.8 + Math.random() * 0.6;
        const drift = -20 + Math.random() * 40; // slight vertical drift during flight
        const travelX = x2 - x1;

        el.style.cssText = `
          left: ${x1}px;
          top: ${y1 + ySpread}px;
          color: ${color};
          font-size: ${32 + Math.random() * 24}px;
          --travel-x: ${travelX}px;
          --drift-y: ${drift}px;
          --note-scale: ${scale};
        `;
        overlay.appendChild(el);

        // Screen flash on first note
        if (i === 0) {
          overlay.classList.add('lightning-flash');
          setTimeout(() => overlay.classList.remove('lightning-flash'), 150);
        }

        el.addEventListener('animationend', () => el.remove(), { once: true });
      }, i * 60);
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

  _pickBossTagline(employeeId) {
    const pool = this._BOSS_TAGLINES[employeeId] || this._BOSS_TAGLINES_FALLBACK;
    return pool[Math.floor(Math.random() * pool.length)];
  },

  _getVictoryText(opponent) {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    if (opponent.type === 'boss') return pick([
      'PROMOTION INCOMING',
      'CORNER OFFICE UNLOCKED',
      'YOU JUST MADE PARTNER',
      'EXPENSE ACCOUNT APPROVED',
    ]);
    if (opponent.type === 'creature') return pick([
      'INCIDENT TICKET CLOSED',
      'HELP DESK: 1, CHAOS: 0',
      'PROBLEM RESOLVED',
      'SERVICE RESTORED',
    ]);
    if (opponent.type === 'employee') return pick([
      'MANAGEMENT WINS AGAIN',
      'BACK TO YOUR DESK',
      'HR HAS BEEN NOTIFIED',
    ]);
    return 'THE INTERN HAS BEEN DEFEATED. AGAIN.';
  },

  // Creature-specific defeat lines (when employee beats a creature)
  _CREATURE_DEFEAT_LINES: {
    'The Phantom Printer': ['OUT OF TONER', 'UNPLUGGED', 'PAPER JAMMED FOREVER'],
    'The Network Wizard': ['CONNECTION TERMINATED', 'PING TIMED OUT', 'CABLE UNPLUGGED'],
    'Watercooler Will': ['FINALLY STOPPED TALKING', 'MEETING ADJOURNED', 'PUT ON MUTE'],
    'HR Nancy': ['TRAINING CANCELLED', 'COMPLIANCE WAIVED', 'FORM REJECTED'],
    'The Dirty Microwave': ['SCRUBBED CLEAN', 'SENT TO HAZMAT', 'UNPLUGGED FOR GOOD'],
    'The MFA Guardian': ['CODE ACCEPTED', 'ACCESS GRANTED', 'AUTHENTICATION BYPASSED'],
    'The Consultant': ['CONTRACT TERMINATED', 'INVOICE DENIED', "YOUR JOB'S BEEN OUTSOURCED"],
    'Sally in Accounting': ['BUDGET APPROVED', 'EXPENSE REIMBURSED', 'AUDIT CLEARED'],
  },

  _getDefeatText(opponent) {
    // If a creature was defeated by the employee, use creature-specific lines
    if (opponent && opponent.type === 'creature' && this._CREATURE_DEFEAT_LINES[opponent.name]) {
      const pool = this._CREATURE_DEFEAT_LINES[opponent.name];
      return pool[Math.floor(Math.random() * pool.length)];
    }
    // Employee defeat (boss/creature won)
    return this._EMPLOYEE_DEFEAT_LINES[Math.floor(Math.random() * this._EMPLOYEE_DEFEAT_LINES.length)];
  },

  }; // end cinematic

  // Mix cinematic methods into ArcadeRenderer
  Object.assign(window.ArcadeRenderer, cinematic);
})();
