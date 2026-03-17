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
    // Bosses and creatures: 50/50
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
      const opponentColor = opponent.type === 'creature' ? '#ff0040' : opponent.type === 'intern' ? '#888' : '#D4A843';

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
      // TIMELINE — 30s total
      //    0ms  BG reveal (bright)
      //  1500   BG darkens
      //  3000   Employee slides in from left
      //  5000   Slash wipe + VS text slam
      //  6500   Opponent slides in (3.5s after employee)
      //  7500   VS text + divider line fade out
      //  8500   Typewriter quote bubble (~3s to read)
      // 11500   FIGHT!! flash
      // 12000   Fight sequence (~14s)
      // 26000   Winner reveal + confetti
      // 28000   Second confetti burst
      // 30000   Dissolve
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
            this._spawnFireworks(overlay.querySelector('.arcade-vs-left .arcade-vs-portrait-wrap'));
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

      beat(26000, () => {
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
          this._highlightWinnerBadge(badge.employeeId);
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
        }

        setVSAnnouncer(winner === 'employee'
          ? `${badge.name.toUpperCase()} WINS!`
          : `${opponent.name.toUpperCase()} WINS!`);
      });

      // Second confetti burst for extended celebration
      beat(28000, () => {
        const winnerSide = winner === 'employee'
          ? overlay.querySelector('.arcade-vs-left')
          : overlay.querySelector('.arcade-vs-right');
        const winColor = winner === 'employee' ? employeeColor : opponentColor;
        if (winnerSide) this._spawnConfetti(winnerSide, winColor);
      });

      beat(30000, () => {
        overlay.classList.add('dissolve');
        // Resolve immediately when dissolve starts so breather text shows during fade
        resolve();
        beat(30600, () => {
          overlay.remove();
          beat(32600, () => {
            this._container.querySelectorAll('.arcade-slot.winner-glow').forEach(s => s.classList.remove('winner-glow'));
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

    const beat = this._createBeat();
    let hitColorToggle = false; // alternates between accent color and white

    const doHit = (spark, shakeIntensity) => {
      // Randomize flash position within portrait bounds
      const randX = 10 + Math.floor(Math.random() * 80); // 10-90%
      const randY = 10 + Math.floor(Math.random() * 80); // 10-90%
      spark.style.setProperty('--spark-x', randX + '%');
      spark.style.setProperty('--spark-y', randY + '%');

      // Alternate flash color between accent color and white
      const isLeft = (spark === leftSpark);
      const accentColor = isLeft ? empColor : oppColor;
      const flashColor = hitColorToggle ? '#ffffff' : accentColor;
      spark.style.setProperty('--spark-color', flashColor);
      hitColorToggle = !hitColorToggle;

      spark.classList.add('flash');
      beat(150, () => spark.classList.remove('flash'));

      const track = (spark === loserSpark ? loserFill : winnerFill).parentElement;
      if (track) {
        track.classList.add('hit-flash');
        beat(150, () => track.classList.remove('hit-flash'));
      }

      if (shakeIntensity !== false) {
        overlay.classList.add('hit-shake');
        beat(120, () => overlay.classList.remove('hit-shake'));
      }
    };

    const pickLine = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // ═══════════════════════════════════════════════════════════
    // Extended fight choreography (~14s)
    //
    // Both fighters start at 100%. The fight has 3 acts:
    //   Act 1 (0-5.0s):    Even exchange — both drop to ~65-75%
    //   Act 2 (5.0-9.0s):  Winner pushes, special move, loser rallies
    //   Act 3 (9.0-14.0s): Final sequence — loser collapses, K.O.
    //
    // Winner ends at 15-40% HP for drama. Loser hits 0.
    // ═══════════════════════════════════════════════════════════

    let winnerHP = 100;
    let loserHP = 100;
    const winnerFinalHP = 15 + Math.floor(Math.random() * 25); // 15-40%

    const allHits = [
      // Act 1: Even exchange (0-5.0s)
      { delay: 700,  target: 'loser',  dmg: 10 },
      { delay: 1700, target: 'winner', dmg: 12 },
      { delay: 2700, target: 'loser',  dmg: 8 },
      { delay: 3500, target: 'winner', dmg: 10 },
      { delay: 4400, target: 'loser',  dmg: 7 },
      // Act 2: Winner pushes, loser rallies (5.0-9.0s)
      { delay: 5200, target: 'loser',  dmg: 12 },
      { delay: 6100, target: 'loser',  dmg: 15 },
      { delay: 7000, target: 'winner', dmg: 8 },
      { delay: 7800, target: 'winner', dmg: 12 },
      { delay: 8600, target: 'loser',  dmg: 5 },
      // Act 3: Finish (9.0-14.0s)
      { delay: 9800,  target: 'loser',  dmg: 10 },
      { delay: 10800, target: 'winner', dmg: 5 },
      { delay: 11800, target: 'loser',  dmg: 12 },
      { delay: 12900, target: 'loser',  dmg: 999, final: true },
    ];

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
      [1000, pickLine(this._FIGHT_LINES_EVEN)],
      [3800, pickLine(this._FIGHT_LINES_EVEN)],
      [6200, `${winnerName.toUpperCase()} ${pickLine(this._FIGHT_LINES_WINNING)}`],
      [8000, `${loserName.toUpperCase()} ${pickLine(this._FIGHT_LINES_RALLY)}`],
      [11000, pickLine(this._FIGHT_LINES_FINISH)],
    ].forEach(([delay, line]) => beat(delay, () => setVSAnnouncer(line)));

    // Special move — charge buildup (1.6s) then release with lightning (bosses + creatures, not interns)
    if (opponent.type !== 'intern' && opponent.move) {
      // Phase 1: Charging buildup at beat 4200 (transition to Act 2)
      beat(4200, () => {
        this._startSpecialMoveCharge(overlay);
        setVSAnnouncer(`${opponent.name.toUpperCase()} IS CHARGING UP...`);
      });
      // Phase 2: Release at beat 5800 (1.6s buildup — dramatic)
      beat(5800, () => {
        this._triggerSpecialMove(overlay, oppColor, opponent.type);
        setVSAnnouncer(`${opponent.name.toUpperCase()} USES ${opponent.move}!`);
      });
    }

    // Schedule all hits
    allHits.forEach(hit => {
      beat(hit.delay, () => {
        if (hit.final) {
          loserHP = 0;
          setHP(loserFill, 0);
          doHit(loserSpark, true);
          // Append K.O. to the side element (not portrait-wrap) so it isn't dimmed by .defeated
          const loserSide = loserSpark.closest('.arcade-vs-side');
          if (loserSide) {
            const koEl = document.createElement('div');
            koEl.className = 'arcade-vs-ko-text';
            koEl.textContent = 'K.O.';
            loserSide.appendChild(koEl);
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
          loserHP = Math.max(5, loserHP);
          setHP(loserFill, loserHP);
          doHit(loserSpark, hit.dmg > 10);
        }
      });
    });

    // Loser portrait dims after K.O.
    beat(13400, () => {
      const loserSide = winner === 'employee'
        ? overlay.querySelector('.arcade-vs-right')
        : overlay.querySelector('.arcade-vs-left');
      if (loserSide) loserSide.classList.add('defeated');
    });
  },

  // ─── Winner Badge Highlight ─────────────────────────────────

  _highlightWinnerBadge(employeeId) {
    const slot = this._container.querySelector(`[data-employee-id="${employeeId}"]`);
    if (slot) {
      slot.classList.add('winner-glow');
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
  },

  _triggerSpecialMove(overlay, color, opponentType) {
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

    const bossPortrait = overlay.querySelector('.arcade-vs-right .arcade-vs-portrait-wrap');
    const empPortrait = overlay.querySelector('.arcade-vs-left .arcade-vs-portrait-wrap');
    if (!bossPortrait || !empPortrait) return;

    if (opponentType === 'boss') {
      // Band members: music note barrage
      this._launchMusicNotes(overlay, bossPortrait, empPortrait, color);
    } else {
      // Creatures: lightning bolts
      this._launchLightning(overlay, bossPortrait, empPortrait, color);
    }
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
