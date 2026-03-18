// ─── Arcade Cinematic Module ─────────────────────────────
// VS screen, fight sequence, effects, and announcer lines.
// Mixed into ArcadeRenderer after view-arcade.js loads.
// Depends on: shared.js (esc, DIVISION_ACCENT_COLORS), view-arcade.js (ArcadeRenderer base)

(function() {
  const cinematic = {

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
        _bossId: boss.employeeId,
        photoUrl: snesPortrait || fallbackUrl,
        fallbackPhotoUrl: snesPortrait ? fallbackUrl : null,
        className: boss.title || 'BOSS',
        tagline: this._pickBossTagline(boss.employeeId),
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
      const winner = this._determineWinner(opponent);

      const employeeColor = DIVISION_ACCENT_COLORS[div] || '#ffd700';
      const opponentColor = opponent.type === 'creature' ? '#ff0040' : opponent.type === 'intern' ? '#ffffff' : '#D4A843';

      // Pick background: use opponent-specific mapping if available, else cycle
      let bgName;
      if (opponent.type === 'boss' && opponent._bossId && this._BOSS_BACKGROUNDS[opponent._bossId]) {
        bgName = this._BOSS_BACKGROUNDS[opponent._bossId];
      } else if (this._CREATURE_BACKGROUNDS[opponent.name]) {
        bgName = this._CREATURE_BACKGROUNDS[opponent.name];
      } else {
        bgName = this._BACKGROUNDS[this._bgIndex];
        this._bgIndex = (this._bgIndex + 1) % this._BACKGROUNDS.length;
      }

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

      beat(3000, () => {
        overlay.classList.add('left-enter');
        setVSAnnouncer(isNewHire
          ? `NEW HIRE ${badge.name.toUpperCase()} REPORTS FOR DUTY!`
          : `${badge.name.toUpperCase()} ENTERS THE RING`);
        if (isNewHire) {
          beat(3900, () => {
            this._spawnFireworks(overlay);
            beat(4200, () => {
              this._spawnFireworks(overlay);
            });
          });
        }
      });

      beat(5000, () => {
        overlay.classList.add('slash-fire');
        const vsText = overlay.querySelector('.arcade-vs-text');
        if (vsText) vsText.classList.add('slam');
      });

      beat(6500, () => {
        overlay.classList.add('right-enter');
        setVSAnnouncer(`${opponent.name.toUpperCase()} APPEARS!`);

        // Boss entrance effect — electrified border, lasts through the quote until fight starts
        if (opponent.type === 'boss') {
          const bossWrap = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait-wrap');
          if (bossWrap) {
            bossWrap.classList.add('boss-electric-entrance');
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
        }
      });

      beat(11500, () => {
        const fightEl = document.createElement('div');
        fightEl.className = 'arcade-vs-fight-flash';
        fightEl.textContent = 'FIGHT!!';
        overlay.appendChild(fightEl);
        fightEl.getBoundingClientRect();
        fightEl.classList.add('active');
        setVSAnnouncer('FIGHT!');
        beat(13000, () => fightEl.remove());
      });

      beat(12000, () => {
        const bubble = overlay.querySelector('.arcade-vs-quote-bubble');
        if (bubble) {
          bubble.style.transition = 'opacity 0.3s ease';
          bubble.style.opacity = '0';
        }
        this._animateFight(overlay, winner, badge, opponent, employeeColor, opponentColor, setVSAnnouncer);
      });

      beat(32000, () => {
        const bubbleCleanup = overlay.querySelector('.arcade-vs-quote-bubble');
        if (bubbleCleanup) bubbleCleanup.style.display = 'none';

        const leftSide = overlay.querySelector('.arcade-vs-left');
        const rightSide = overlay.querySelector('.arcade-vs-right');

        if (winner === 'employee') {
          // Winner text under employee (left)
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
          // Defeat text under opponent (right)
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
          // Winner text under opponent (right)
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
          // Defeat text under employee (left)
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

        setVSAnnouncer(winner === 'employee'
          ? `${badge.name.toUpperCase()} WINS!`
          : `${opponent.name.toUpperCase()} WINS!`);
      });

      // Second confetti burst for extended celebration
      beat(34000, () => {
        const winnerSide = winner === 'employee'
          ? overlay.querySelector('.arcade-vs-left')
          : overlay.querySelector('.arcade-vs-right');
        const winColor = winner === 'employee' ? employeeColor : opponentColor;
        if (winnerSide) this._spawnConfetti(winnerSide, winColor);
      });

      beat(36000, () => {
        overlay.classList.add('dissolve');
        // Resolve immediately when dissolve starts so breather text shows during fade
        resolve();
        beat(36600, () => {
          overlay.remove();
          beat(38600, () => {
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
    const count = 20;
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.className = 'arcade-vs-firework';
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const dist = 120 + Math.random() * 180;
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
      for (let i = 0; i < 12; i++) {
        const particle = document.createElement('div');
        particle.className = 'arcade-vs-firework';
        const angle = (Math.PI * 2 * i) / 12 + (Math.random() - 0.5) * 0.5;
        const dist = 80 + Math.random() * 140;
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

  _animateFight(overlay, winner, badge, opponent, empColor, oppColor, setVSAnnouncer) {
    const hpContainer = overlay.querySelector('.arcade-vs-hp-container');
    if (!hpContainer) return;

    // Show HP bars with slide-in
    hpContainer.style.display = '';
    hpContainer.classList.add('visible');

    const leftFill = overlay.querySelector('.arcade-vs-hp-left .arcade-vs-hp-fill');
    const rightFill = overlay.querySelector('.arcade-vs-hp-right .arcade-vs-hp-fill');
    const leftTrail = overlay.querySelector('.arcade-vs-hp-left .arcade-vs-hp-trail');
    const rightTrail = overlay.querySelector('.arcade-vs-hp-right .arcade-vs-hp-trail');
    const leftSpark = overlay.querySelector('.arcade-vs-left .arcade-vs-hit-spark');
    const rightSpark = overlay.querySelector('.arcade-vs-right .arcade-vs-hit-spark');
    const leftPortrait = overlay.querySelector('.arcade-vs-left .arcade-vs-portrait');
    const rightPortrait = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait');
    const leftWrap = overlay.querySelector('.arcade-vs-left .arcade-vs-portrait-wrap');
    const rightWrap = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait-wrap');

    const loserFill = winner === 'employee' ? rightFill : leftFill;
    const loserTrail = winner === 'employee' ? rightTrail : leftTrail;
    const loserSpark = winner === 'employee' ? rightSpark : leftSpark;
    const winnerFill = winner === 'employee' ? leftFill : rightFill;
    const winnerTrail = winner === 'employee' ? leftTrail : rightTrail;
    const winnerSpark = winner === 'employee' ? leftSpark : rightSpark;
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

    // Hitstop tracking
    const HITSTOP = { light: 0, medium: 0, heavy: 150, ko: 280 };

    const doHit = (spark, portrait, weight) => {
      // Randomize flash position within portrait bounds
      const randX = 10 + Math.floor(Math.random() * 80);
      const randY = 10 + Math.floor(Math.random() * 80);
      spark.style.setProperty('--spark-x', randX + '%');
      spark.style.setProperty('--spark-y', randY + '%');

      // Alternate flash color
      const isLeft = (spark === leftSpark);
      const accentColor = isLeft ? empColor : oppColor;
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
    const doStun = Math.random() < 0.5; // 50% chance of employee stun quote
    // Map sides to winner/loser targets regardless of fight outcome
    const empTarget = winner === 'employee' ? 'winner' : 'loser';
    const oppTarget = winner === 'employee' ? 'loser' : 'winner';

    // Act 1: Even exchange (0-5s) — 8 hits, tighter spacing
    const allHits = [
      { delay: 500,  target: 'loser',  dmg: 7,  weight: 'light' },
      { delay: 1100, target: 'winner', dmg: 8,  weight: 'light' },
      { delay: 1700, target: 'loser',  dmg: 6,  weight: 'light' },
      { delay: 2300, target: 'winner', dmg: 7,  weight: 'light' },
      { delay: 2900, target: 'loser',  dmg: 8,  weight: 'medium' },
      { delay: 3500, target: 'winner', dmg: 6,  weight: 'light' },
      { delay: 4000, target: 'loser',  dmg: 7,  weight: 'light' },
      { delay: 4600, target: 'winner', dmg: 5,  weight: 'light' },
    ];

    // Act 2: depends on stun trigger
    const act2Hits = doStun ? [
      // Stun combo: employee hits opponent (5.6-7.0s) — 6 hits
      { delay: 5600, target: oppTarget, dmg: 5, weight: 'light' },
      { delay: 5870, target: oppTarget, dmg: 6, weight: 'light' },
      { delay: 6140, target: oppTarget, dmg: 7, weight: 'medium' },
      { delay: 6410, target: oppTarget, dmg: 6, weight: 'light' },
      { delay: 6680, target: oppTarget, dmg: 7, weight: 'light' },
      { delay: 6950, target: oppTarget, dmg: 8, weight: 'medium' },
      // Special move hit (8.5s) — always hits employee
      { delay: 8500, target: empTarget, dmg: 28, weight: 'heavy', isSpecial: true },
      // Rally (9.3-10.5s)
      { delay: 9300,  target: 'winner', dmg: 5, weight: 'light' },
      { delay: 9900,  target: 'loser',  dmg: 7, weight: 'light' },
      { delay: 10500, target: 'winner', dmg: 6, weight: 'medium' },
    ] : [
      // No stun: alternating exchange (5.3-10.5s) — 8 hits
      { delay: 5300,  target: 'loser',  dmg: 8,  weight: 'medium' },
      { delay: 5900,  target: 'winner', dmg: 7,  weight: 'light' },
      { delay: 6500,  target: 'loser',  dmg: 6,  weight: 'light' },
      { delay: 7100,  target: 'loser',  dmg: 10, weight: 'medium' },
      // Special move hit — always hits employee
      { delay: 8500,  target: empTarget, dmg: 28, weight: 'heavy', isSpecial: true },
      // Rally
      { delay: 9300,  target: 'winner', dmg: 5,  weight: 'light' },
      { delay: 9900,  target: 'loser',  dmg: 7,  weight: 'light' },
      { delay: 10500, target: 'winner', dmg: 8,  weight: 'medium' },
    ];

    // Act 3: Escalation + finish (11.2-18.5s) — 8 hits + KO
    const act3Hits = [
      { delay: 11200, target: 'loser',  dmg: 8,  weight: 'medium' },
      { delay: 11900, target: 'winner', dmg: 6,  weight: 'light' },
      { delay: 12600, target: 'loser',  dmg: 10, weight: 'medium' },
      { delay: 13400, target: 'loser',  dmg: 7,  weight: 'light' },
      { delay: 14200, target: 'winner', dmg: 5,  weight: 'light' },
      { delay: 15000, target: 'loser',  dmg: 12, weight: 'heavy' },
      { delay: 15900, target: 'winner', dmg: 4,  weight: 'light' },
      { delay: 16800, target: 'loser',  dmg: 14, weight: 'heavy' },
      // KO blow
      { delay: 18500, target: 'loser',  dmg: 999, weight: 'ko', final: true },
    ];

    allHits.push(...act2Hits, ...act3Hits);

    // Pre-calculate HP scaling so winner ends at winnerFinalHP and loser at 0
    let runWinnerDmg = 0;
    let runLoserDmg = 0;
    allHits.forEach(h => {
      if (h.final) return;
      if (h.target === 'winner') runWinnerDmg += h.dmg;
      else runLoserDmg += h.dmg;
    });
    const winnerScale = (100 - winnerFinalHP) / (runWinnerDmg || 1);
    const loserScale = 100 / (runLoserDmg || 1);

    // Announcer beats
    [
      [800, pickLine(this._FIGHT_LINES_EVEN)],
      [3000, pickLine(this._FIGHT_LINES_EVEN)],
      [5500, doStun ? `${badge.name.toUpperCase()} DROPS A ONE-LINER!` : pickLine(this._FIGHT_LINES_EVEN)],
      [7500, `${winnerName.toUpperCase()} ${pickLine(this._FIGHT_LINES_WINNING)}`],
      [9800, `${loserName.toUpperCase()} ${pickLine(this._FIGHT_LINES_RALLY)}`],
      [12000, pickLine(this._FIGHT_LINES_EVEN)],
      [15000, `${winnerName.toUpperCase()} ${pickLine(this._FIGHT_LINES_WINNING)}`],
      [17500, pickLine(this._FIGHT_LINES_FINISH)],
    ].forEach(([delay, line]) => beat(delay, () => setVSAnnouncer(line)));

    // Employee stun quote mechanic (50% chance)
    if (doStun) {
      beat(5000, () => {
        const stunQuote = this._STUN_QUOTES[Math.floor(Math.random() * this._STUN_QUOTES.length)];
        setVSAnnouncer(`${badge.name.toUpperCase()}: "${stunQuote}"`);

        // Show stun bubble (positioned via CSS, same style as opponent quote)
        {
          const stunBubble = document.createElement('div');
          stunBubble.className = 'arcade-vs-stun-bubble';
          overlay.appendChild(stunBubble);
          this._typewriterEffect(stunBubble, stunQuote, 40);
          requestAnimationFrame(() => stunBubble.classList.add('visible'));

          // Stun the opponent — centered in portrait with STUNNED label
          const oppWrap = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait-wrap');
          if (oppWrap) {
            oppWrap.classList.add('stunned');
            const stars = document.createElement('div');
            stars.className = 'arcade-vs-stun-stars';
            stars.innerHTML = '<span class="arcade-vs-stun-stars-icons">\u2B50\u{1F4AB}\u2B50</span><span class="arcade-vs-stun-stars-label">STUNNED</span>';
            oppWrap.appendChild(stars);
          }

          // Remove stun after 2.5s
          beat(2500, () => {
            const oppWrap2 = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait-wrap');
            if (oppWrap2) oppWrap2.classList.remove('stunned');
            const stars2 = oppWrap2?.querySelector('.arcade-vs-stun-stars');
            if (stars2) stars2.remove();
            stunBubble.classList.remove('visible');
            beat(300, () => stunBubble.remove());
          });
        }
      });
    }

    // Special move — charge buildup then release (bosses + creatures, not interns)
    if (opponent.type !== 'intern' && opponent.move) {
      const chargeTime = doStun ? 7300 : 6800;
      const releaseTime = 8200;
      beat(chargeTime, () => {
        this._startSpecialMoveCharge(overlay);
        setVSAnnouncer(`${opponent.name.toUpperCase()} IS CHARGING UP...`);
      });
      beat(releaseTime, () => {
        this._triggerSpecialMove(overlay, oppColor, opponent);
        setVSAnnouncer(`${opponent.name.toUpperCase()} USES ${opponent.move}!`);
      });
    }

    // Slowdown visual cue before KO
    beat(18000, () => {
      overlay.classList.add('ko-slowdown');
    });

    // Schedule all hits
    allHits.forEach(hit => {
      beat(hit.delay, () => {
        if (hit.final) {
          loserHP = 0;
          setHP(loserFill, loserTrail, 0);

          // Determine which portrait/spark to hit
          const spark = loserSpark;
          const portrait = winner === 'employee' ? rightPortrait : leftPortrait;
          doHit(spark, portrait, 'ko');

          // Camera zoom on KO
          overlay.classList.remove('ko-slowdown');
          overlay.classList.add('ko-zoom');

          // K.O. text
          const loserSide = spark.closest('.arcade-vs-side');
          if (loserSide) {
            const koEl = document.createElement('div');
            koEl.className = 'arcade-vs-ko-text';
            koEl.textContent = 'K.O.';
            loserSide.appendChild(koEl);
          }
          return;
        }

        // Determine spark and portrait targets
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
      });
    });

    // Loser portrait dims after K.O.
    beat(19000, () => {
      const loserSide = winner === 'employee'
        ? overlay.querySelector('.arcade-vs-right')
        : overlay.querySelector('.arcade-vs-left');
      if (loserSide) loserSide.classList.add('defeated');
    });
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

    if (opponentType === 'boss') {
      // Band members: check for boss-specific effects, default to music notes
      const bossLauncher = opponent._bossId && this._BOSS_SPECIAL_FX[opponent._bossId];
      if (bossLauncher) {
        bossLauncher.call(this, overlay, bossPortrait, empPortrait, color);
      } else {
        this._launchMusicNotes(overlay, bossPortrait, empPortrait, color);
      }
    } else {
      // Creatures: move-specific effects (lightning as fallback)
      const moveName = opponent.move || '';
      const launcher = this._CREATURE_SPECIAL_FX[moveName];
      if (launcher) {
        launcher.call(this, overlay, bossPortrait, empPortrait, color);
      } else {
        this._launchLightning(overlay, bossPortrait, empPortrait, color);
      }
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

    'PAPER JAM OF DOOM': function(overlay, fromEl, toEl, color) {
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
      // Speech bubbles flooding from right to left
      const overlayRect = overlay.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const x1 = fromRect.left - overlayRect.left + fromRect.width / 2;
      const y1 = fromRect.top - overlayRect.top + fromRect.height / 2;
      const travelX = -(450 + Math.random() * 300);
      const bubbles = ['\uD83D\uDCAC', '\uD83D\uDCAD', '\uD83D\uDDE3\uFE0F', '\u2753', '\u2755', '\uD83D\uDCA4'];
      const count = 26;
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const el = document.createElement('div');
          el.className = 'arcade-fx-bubble';
          const ySpread = (Math.random() - 0.5) * 180;
          const drift = (Math.random() - 0.5) * 70;
          const size = 36 + Math.random() * 28;
          el.textContent = bubbles[Math.floor(Math.random() * bubbles.length)];
          el.style.cssText = `
            left: ${x1}px; top: ${y1 + ySpread}px;
            font-size: ${size}px;
            --bubble-x: ${travelX + Math.random() * 100}px; --bubble-y: ${drift}px;
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
          const size = 24 + Math.random() * 20;
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

      // Drop in the amp
      const amp = document.createElement('div');
      amp.className = 'arcade-fx-amp';
      amp.innerHTML = '🎸';
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
        defs.innerHTML = `<filter id="${filterId}"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

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
    },
  },

  _launchLightning(overlay, fromEl, toEl, color) {
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
        defs.innerHTML = `<filter id="${filterId}"><feGaussianBlur stdDeviation="6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

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

  _launchMusicNotes(overlay, fromEl, toEl, color) {
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
