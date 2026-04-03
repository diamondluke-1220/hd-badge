// Help Desk Badge App — Live Visualization & Animations
// Extracted from app.js — SSE, ticker, animations, stats panel

// ─── Nav Headcount Badge ──────────────────────────────────

(function initHeadcount() {
  const el = document.getElementById('navHeadcount');
  if (!el) return;
  // Fetch initial count
  fetch('/api/orgchart?page=1&limit=1')
    .then(r => r.json())
    .then(d => { if (d.total != null) el.textContent = d.total; })
    .catch(() => {});
})();

function incrementHeadcount() {
  const el = document.getElementById('navHeadcount');
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  el.textContent = current + 1;
  // Brief green pulse on increment
  el.classList.add('pulse');
  setTimeout(() => el.classList.remove('pulse'), 1500);
}

// ─── Live Org Chart Visualizations ─────────────────────────

// --- SSE Connection ---
let sseSource = null;
let sseRetryDelay = 1000;
const SSE_MAX_RETRY = 30000;
const liveAnimationQueue = [];
let liveIsAnimating = false;

function connectSSE() {
  if (sseSource) { sseSource.close(); }
  sseSource = new EventSource('/api/badges/stream');

  sseSource.onopen = () => {
    sseRetryDelay = 1000; // reset backoff on successful connection
  };

  sseSource.addEventListener('new-badge', (e) => {
    try {
      const badge = JSON.parse(e.data);
      incrementHeadcount();
      queueLiveAnimation(badge);
    } catch (err) {
      console.error('[SSE] Failed to process badge event:', err);
    }
  });

  // Silent in-place update (no animation — just refresh card data)
  sseSource.addEventListener('badge-updated', (e) => {
    try {
      const badge = JSON.parse(e.data);
      if (currentRenderer && currentRenderer.updateBadge) {
        currentRenderer.updateBadge(badge);
      }
    } catch (err) {
      console.error('[SSE] Failed to process badge-updated event:', err);
    }
  });

  sseSource.onerror = () => {
    sseSource.close();
    console.log(`[SSE] Connection lost — retrying in ${sseRetryDelay / 1000}s`);
    setTimeout(connectSSE, sseRetryDelay);
    sseRetryDelay = Math.min(sseRetryDelay * 2, SSE_MAX_RETRY);
  };
}

function queueLiveAnimation(badge) {
  liveAnimationQueue.push({ ...badge });
  if (!liveIsAnimating) processLiveQueue();
}

function getCurrentViewMode() {
  if (currentRenderer === window.ReviewBoardRenderer) return 'reviewboard';
  if (currentRenderer === window.ArcadeRenderer) return 'arcade';
  if (currentRenderer === window.RackRenderer) return 'rack';
  return 'grid';
}

// Preload headshot image so it's cached before animations start
function preloadHeadshot(employeeId) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const img = new Image();
    img.onload = finish;
    img.onerror = finish; // Don't block on failure
    img.src = `/api/badge/${employeeId}/headshot`;
    // Safety timeout — don't wait longer than 4s
    setTimeout(finish, 4000);
  });
}

async function processLiveQueue() {
  liveIsAnimating = true;
  while (liveAnimationQueue.length > 0) {
    const badge = liveAnimationQueue.shift();

    // Preload headshot before any view animation
    if (badge.employeeId) await preloadHeadshot(badge.employeeId);

    updateTicker(badge);
    updateDonut(badge);

    const mode = getCurrentViewMode();

    if (mode === 'grid') {
      await playTerminalAnimation(badge);
      const card = currentRenderer ? currentRenderer.addBadge(badge) : null;
      if (card) await playSpotlight(card);
    } else if (mode === 'arcade') {
      if (currentRenderer) await currentRenderer.addBadge(badge);
    } else if (mode === 'rack') {
      const portEl = currentRenderer ? currentRenderer.addBadge(badge) : null;
    } else {
      const card = currentRenderer ? currentRenderer.addBadge(badge) : null;
    }
  }
  liveIsAnimating = false;
}

// --- Stock Ticker Banner ---

const TICKER_QUIPS = [
  'MARKET: OPEN', 'SYNERGY LEVELS: CRITICAL', 'MORALE: MANDATORY',
  'COFFEE SUPPLY: LOW', 'TICKETS: OVERFLOWING', 'BANDWIDTH: ZERO',
  'MEETINGS: EXCESSIVE', 'UPTIME: QUESTIONABLE', 'PRODUCTIVITY: TBD',
  'MEMO STATUS: UNREAD', 'PRINTER: JAMMED', 'REPLY-ALL: DETECTED',
];

function initTicker() {
  const bar = document.createElement('div');
  bar.className = 'ticker-bar';
  bar.id = 'tickerBar';
  bar.innerHTML = '<div class="ticker-track" id="tickerTrack"></div>';
  document.body.appendChild(bar);
  buildTickerContent();
}

function buildTickerContent() {
  const track = document.getElementById('tickerTrack');
  if (!track) return;

  const items = [];

  // Corporate quips
  TICKER_QUIPS.forEach(q => {
    items.push(`<span class="ticker-item"><span class="ticker-label">${q}</span></span>`);
    items.push('<span class="ticker-sep"></span>');
  });

  // Department stats
  Object.entries(window.HD.state.tickerStats).forEach(([dept, count]) => {
    items.push(`<span class="ticker-item" data-ticker-dept="${esc(dept)}"><span class="ticker-value">${esc(dept)}</span> <span class="ticker-label">×</span> <span class="ticker-highlight" data-ticker-dept-count="${esc(dept)}">${count}</span></span>`);
    items.push('<span class="ticker-sep"></span>');
  });

  if (window.HD.state.tickerTotalHires > 0) {
    items.push(`<span class="ticker-item" data-ticker-total><span class="ticker-new">$HELP</span> <span class="ticker-up" data-ticker-total-count>▲ ${window.HD.state.tickerTotalHires}</span> <span class="ticker-label">TOTAL HIRES</span></span>`);
    items.push('<span class="ticker-sep"></span>');
  }

  // Duplicate for seamless loop
  const content = items.join('');
  track.innerHTML = content + content;
}

function updateTicker(badge) {
  window.HD.state.tickerTotalHires++;
  window.HD.state.tickerStats[badge.department] = (window.HD.state.tickerStats[badge.department] || 0) + 1;

  const track = document.getElementById('tickerTrack');
  if (!track) return;

  // Try in-place update for existing departments
  const deptCountEls = track.querySelectorAll(`[data-ticker-dept-count="${CSS.escape(badge.department)}"]`);
  const totalCountEls = track.querySelectorAll('[data-ticker-total-count]');

  if (deptCountEls.length > 0) {
    // Department already in ticker — update counts in-place
    deptCountEls.forEach(el => { el.textContent = window.HD.state.tickerStats[badge.department]; });
    totalCountEls.forEach(el => { el.textContent = '▲ ' + window.HD.state.tickerTotalHires; });
  } else {
    // New department — full rebuild needed to add it
    buildTickerContent();
  }
}

// --- Animation Toggle ---

function animationsEnabled() {
  const stored = localStorage.getItem('hd-animations');
  if (stored !== null) return stored === '1';
  // Default: OFF on mobile, ON on desktop
  return !window.matchMedia('(max-width: 768px)').matches;
}

function setAnimationsEnabled(enabled) {
  localStorage.setItem('hd-animations', enabled ? '1' : '0');
  document.body.classList.toggle('fx-off', !enabled);
  const btn = document.getElementById('animToggleBtn');
  if (btn) {
    btn.classList.toggle('anim-on', enabled);
    btn.classList.toggle('fx-on', enabled);
    btn.title = enabled ? 'Animations On (A)' : 'Animations Off (A)';
    const desc = btn.querySelector('.view-dropdown-item-desc');
    if (desc) desc.textContent = enabled ? 'Animations on' : 'Animations off';
  }

  // When disabling, kill all in-flight animations immediately
  if (!enabled) {
    // Abort arcade renderer's pending timeout/interval chains
    const ar = window.ArcadeRenderer;
    if (ar) {
      (ar._timeouts || []).forEach(id => clearTimeout(id));
      (ar._intervals || []).forEach(id => clearInterval(id));
      ar._timeouts = [];
      ar._intervals = [];
      ar._isVSActive = false;
      ar._locked = false;
      // Remove VS overlay if mid-fight
      const overlay = document.querySelector('.arcade-vs-overlay');
      if (overlay) overlay.remove();
    }
    // Strip inline animation styles so .fx-off CSS rules take effect
    document.querySelectorAll('[style*="animation"]').forEach(el => {
      el.style.animation = '';
      el.style.animationDelay = '';
    });
  }
}

function toggleAnimations() {
  setAnimationsEnabled(!animationsEnabled());
}

// --- Terminal Onboarding Animation ---

const WARNING_MESSAGES = [
  '> WARNING: Employee has opinions. Proceed with caution.',
  '> WARNING: Subject has been known to reply-all. Quarantine recommended.',
  '> WARNING: Clearance level does not include the good coffee.',
  '> WARNING: Employee claims to "know a little Excel." Threat level: SEVERE.',
  '> WARNING: Subject has strong feelings about open-plan offices.',
  '> WARNING: Badge holder may attempt to "fix" the printer. Do not engage.',
  '> WARNING: Employee insists their password is "very secure." It is not.',
  '> WARNING: Subject has 47 unread emails. And counting.',
  '> WARNING: This employee will ask you to restart your computer.',
  '> WARNING: Detected residual energy from previous meeting. Proceed carefully.',
  '> WARNING: Employee has submitted 14 VPN tickets this quarter. Alone.',
  '> WARNING: Subject keeps saying "it worked on my machine."',
  '> WARNING: Employee claims to love Mondays. Trust level: ZERO.',
];

const COMPLETE_MESSAGES = [
  '> ONBOARDING COMPLETE. Welcome to the nightmare.',
  '> ONBOARDING COMPLETE. Your ticket has been closed without resolution.',
  '> ONBOARDING COMPLETE. Please do not contact IT about this.',
  '> ONBOARDING COMPLETE. Badge activated. Expectations deactivated.',
  '> ONBOARDING COMPLETE. You are now someone else\'s problem.',
  '> ONBOARDING COMPLETE. The Wi-Fi password is "Stop Asking."',
  '> ONBOARDING COMPLETE. Your first meeting starts 5 minutes ago.',
  '> ONBOARDING COMPLETE. Please submit a ticket to celebrate.',
  '> ONBOARDING COMPLETE. Have you tried turning yourself off and on again?',
  '> ONBOARDING COMPLETE. Welcome aboard. The printer is already broken.',
  '> ONBOARDING COMPLETE. Added to 37 distribution lists. You\'re welcome.',
  '> ONBOARDING COMPLETE. Your "temporary" desk is now permanent.',
  '> ONBOARDING COMPLETE. Basically, they\'re Keanu Reeves.',
];

let _lastWarningIdx = -1;
let _lastCompleteIdx = -1;

function _pickRandom(arr, lastIdx) {
  let idx;
  do { idx = Math.floor(Math.random() * arr.length); } while (idx === lastIdx && arr.length > 1);
  return idx;
}

function buildTerminalLines() {
  const wIdx = _pickRandom(WARNING_MESSAGES, _lastWarningIdx);
  const cIdx = _pickRandom(COMPLETE_MESSAGES, _lastCompleteIdx);
  _lastWarningIdx = wIdx;
  _lastCompleteIdx = cIdx;

  return [
    { type: 'prompt', text: '> INITIATING EMPLOYEE ONBOARDING PROTOCOL...' },
    { type: 'scan' },
    { type: 'progress' },
    { type: 'data',   key: 'EMPLOYEE IDENTIFIED', field: 'name' },
    { type: 'data',   key: 'TITLE',               field: 'title' },
    { type: 'data',   key: 'DEPARTMENT',           field: 'department' },
    { type: 'data',   key: 'CLEARANCE LEVEL',      field: 'accessLevel' },
    { type: 'data',   key: 'EMPLOYEE ID',          field: 'employeeId' },
    { type: 'warn',   text: WARNING_MESSAGES[wIdx] },
    { type: 'success', text: COMPLETE_MESSAGES[cIdx] },
  ];
}

function playTerminalAnimation(badge) {
  return new Promise((resolve) => {
    if (!animationsEnabled() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      resolve();
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'terminal-overlay';
    const box = document.createElement('div');
    box.className = 'terminal-box';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('active'));

    const termLines = buildTerminalLines();
    let lineIndex = 0;
    const lineDelay = 700;

    function addCursor(parentEl) {
      const oldCursor = box.querySelector('.terminal-cursor');
      if (oldCursor) oldCursor.remove();
      const cursor = document.createElement('span');
      cursor.className = 'terminal-cursor';
      parentEl.appendChild(cursor);
    }

    // --- Badge Scan Animation ---
    function playScanPhase() {
      return new Promise((scanResolve) => {
        const scanWrap = document.createElement('div');
        scanWrap.className = 'term-scan-wrap';

        const badgeImg = document.createElement('img');
        badgeImg.src = `/api/badge/${badge.employeeId}/headshot`;
        badgeImg.className = 'term-scan-badge';
        badgeImg.alt = 'Badge';

        const scanLine = document.createElement('div');
        scanLine.className = 'term-scanline';

        scanWrap.appendChild(badgeImg);
        scanWrap.appendChild(scanLine);
        box.appendChild(scanWrap);

        // Start scan animation
        requestAnimationFrame(() => {
          scanWrap.classList.add('scanning');
        });

        // Scan takes 2.8s, then fade out
        setTimeout(() => {
          scanWrap.classList.add('scan-done');
          setTimeout(() => {
            scanWrap.remove();
            scanResolve();
          }, 400);
        }, 2800);
      });
    }

    // --- Progress Bar Animation ---
    function playProgressBar() {
      return new Promise((barResolve) => {
        const line = document.createElement('div');
        const totalBlocks = 20;
        const duration = 2500; // 2.5 seconds
        const interval = duration / totalBlocks;
        let filled = 0;

        function renderBar() {
          const filledStr = '\u2588'.repeat(filled);
          const emptyStr = '\u2591'.repeat(totalBlocks - filled);
          const pct = Math.round((filled / totalBlocks) * 100);
          line.innerHTML = `<span class="term-prompt">&gt; SCANNING BADGE... [</span><span class="term-progress">${filledStr}${emptyStr}</span><span class="term-prompt">] ${pct}%</span>`;
          addCursor(line);
        }

        renderBar();
        box.appendChild(line);

        const timer = setInterval(() => {
          filled++;
          renderBar();
          if (filled >= totalBlocks) {
            clearInterval(timer);
            setTimeout(barResolve, 400);
          }
        }, interval);
      });
    }

    function typeLine() {
      if (lineIndex >= termLines.length) {
        // Remove cursor, let the final lines breathe
        const oldCursor = box.querySelector('.terminal-cursor');
        if (oldCursor) oldCursor.remove();
        setTimeout(() => {
          overlay.classList.remove('active');
          setTimeout(() => { overlay.remove(); resolve(); }, 300);
        }, 3500);
        return;
      }

      const def = termLines[lineIndex];

      if (def.type === 'scan') {
        lineIndex++;
        playScanPhase().then(typeLine);
        return;
      }

      if (def.type === 'progress') {
        lineIndex++;
        playProgressBar().then(typeLine);
        return;
      }

      const line = document.createElement('div');

      if (def.type === 'prompt') {
        line.innerHTML = `<span class="term-prompt">${def.text}</span>`;
      } else if (def.type === 'data') {
        const val = badge[def.field] || 'CLASSIFIED';
        line.innerHTML = `<span class="term-prompt">&gt; </span><span class="term-label">${def.key}:</span> <span class="term-value">${esc(val)}</span>`;
      } else if (def.type === 'warn') {
        line.innerHTML = `<span class="term-warn">${def.text}</span>`;
      } else if (def.type === 'success') {
        line.innerHTML = `<span class="term-success">${def.text}</span>`;
      }

      box.appendChild(line);
      addCursor(line);

      lineIndex++;
      setTimeout(typeLine, lineDelay);
    }

    typeLine();
  });
}

// --- Spotlight Mode ---

function playSpotlight(card) {
  return new Promise((resolve) => {
    if (!animationsEnabled() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      resolve();
      return;
    }

    const container = document.querySelector('.public-orgchart');
    if (!container) { resolve(); return; }

    // Scroll to card if off-screen
    const rect = card.getBoundingClientRect();
    const viewH = window.innerHeight;
    if (rect.top < 0 || rect.bottom > viewH - 48) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Dim grid, highlight card
    container.classList.add('orgchart-dimmed');
    card.classList.add('spotlight-active');

    // Revert after 5 seconds
    setTimeout(() => {
      container.classList.remove('orgchart-dimmed');
      card.classList.remove('spotlight-active');
      resolve();
    }, 5000);
  });
}

// --- Stats Panel (Donut + Newest Hire) ---

const DIVISION_COLORS = {
  '_exec':    '#4ADE80',
  'IT':       '#2E7DFF',
  'Office':   '#14B8A6',
  'Corporate':'#A855F7',
  'Punk':     '#EF4444',
  '_custom':  '#6B7280',
};

let donutCounts = {}; // { divisionTheme: count }
let donutTotal = 0;
let _donutAnimated = false;
let _currentNewestHire = null;
let _statsBySong = [];
function initStatsPanel(stats) {
  // Build initial donut counts
  donutTotal = stats.visible || 0;
  donutCounts = {};

  if (stats.byDepartment) {
    Object.entries(stats.byDepartment).forEach(([dept, count]) => {
      let theme;
      if (BAND_DEPTS.has(dept)) {
        theme = '_exec';
      } else {
        theme = KNOWN_DEPT_THEMES[dept] || '_custom';
      }
      donutCounts[theme] = (donutCounts[theme] || 0) + count;
    });
  }

  _currentNewestHire = stats.newestHire || null;
  _statsBySong = stats.bySong || [];

  _donutAnimated = false;

  renderStatsPanel();
}

// --- Relative time helper ---
function timeAgo(dateStr) {
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  const weeks = Math.floor(days / 7);
  return weeks + 'w ago';
}

function renderStatsPanel() {
  const existing = document.querySelector('.stats-panel');
  if (existing) existing.remove();

  const header = document.querySelector('.org-header');
  if (!header) return;

  const panel = document.createElement('div');
  panel.className = 'stats-panel';

  // --- Donut section ---
  const segments = [];
  let offset = 0;
  const legend = [];

  PUBLIC_DIVISIONS.forEach(div => {
    const count = donutCounts[div.theme] || 0;
    if (count === 0) return;
    const pct = donutTotal > 0 ? (count / donutTotal) * 100 : 0;
    const color = DIVISION_COLORS[div.theme] || '#6B7280';
    segments.push(`${color} ${offset}% ${offset + pct}%`);
    legend.push({ name: div.name, color, count });
    offset += pct;
  });

  if (offset < 100 && segments.length > 0) {
    const lastSeg = segments[segments.length - 1];
    segments[segments.length - 1] = lastSeg.replace(/[\d.]+%$/, '100%');
  }

  const gradient = segments.length > 0
    ? `conic-gradient(${segments.join(', ')})`
    : 'conic-gradient(#3A3A44 0% 100%)';

  const animClass = !_donutAnimated ? ' donut-entrance' : '';

  // --- Newest hire section ---
  let newestHtml = '';
  if (_currentNewestHire) {
    newestHtml = `
      <div class="stats-card newest-hire-card">
        <div class="stats-card-label">LATEST HIRE</div>
        <div class="newest-hire-name">${esc(_currentNewestHire.name)}</div>
        <div class="newest-hire-dept">${esc(_currentNewestHire.department)}</div>
        <div class="newest-hire-time">${timeAgo(_currentNewestHire.createdAt)}</div>
      </div>
    `;
  } else {
    newestHtml = `
      <div class="stats-card newest-hire-card newest-hire-empty">
        <div class="stats-card-label">LATEST HIRE</div>
        <div class="newest-hire-name">Awaiting applicants...</div>
      </div>
    `;
  }

  // --- Most Requested songs ---
  const songData = _statsBySong || [];
  const topSongs = songData.slice(0, 3);
  const mostRequestedHtml = topSongs.length > 0 ? `
    <div class="stats-card most-requested-card">
      <div class="stats-card-label">MOST REQUESTED</div>
      <div class="most-requested-sub">by badge waveform</div>
      <div class="most-requested-list">
        ${topSongs.map((s, i) => `<div class="most-requested-row"><span class="most-requested-rank">${i + 1}.</span><span class="most-requested-song">${esc(s.song)}</span><span class="most-requested-count">${s.count}</span></div>`).join('')}
      </div>
    </div>
  ` : '';

  panel.innerHTML = `
    <div class="stats-donut-section${animClass}">
      <div class="orgchart-donut" style="background: ${gradient}" data-total="${donutTotal}"></div>
      <div class="donut-legend">
        ${legend.map(l => `<div class="donut-legend-item"><span class="donut-legend-dot" style="background:${l.color}"></span><span class="donut-legend-name">${esc(l.name)}</span> <span class="donut-legend-count">${l.count}</span></div>`).join('')}
      </div>
    </div>
    ${newestHtml}
    ${mostRequestedHtml}
  `;

  header.after(panel);
  _donutAnimated = true;

  // Animate count-up in donut center
  const donutEl = panel.querySelector('.orgchart-donut');
  if (donutEl && donutTotal > 0) {
    animateCountUp(donutEl, donutTotal);
  }
}

function animateCountUp(el, target) {
  const duration = 800;
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = Math.round(eased * target);
    el.setAttribute('data-total', current);
    if (progress < 1) requestAnimationFrame(step);
  }
  el.setAttribute('data-total', '0');
  requestAnimationFrame(step);
}

// Backward-compat wrapper
function initDonut(stats) {
  initStatsPanel(stats);
}

function updateDonut(badge) {
  const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
  donutCounts[divTheme] = (donutCounts[divTheme] || 0) + 1;
  donutTotal++;
  // Update newest hire to this badge
  _currentNewestHire = { name: badge.name, department: badge.department, createdAt: new Date().toISOString() };
  renderStatsPanel();
}
