// Help Desk Badge App — Live Visualization & Animations
// Extracted from app.js — SSE, ticker, animations, stats panel

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
  if (currentRenderer === window.DendroRenderer) return 'dendro';
  if (currentRenderer === window.ArcadeRenderer) return 'arcade';
  return 'grid';
}

async function processLiveQueue() {
  liveIsAnimating = true;
  while (liveAnimationQueue.length > 0) {
    const badge = liveAnimationQueue.shift();

    updateTicker(badge);
    updateDonut(badge);

    const mode = getCurrentViewMode();

    if (mode === 'grid') {
      await playTerminalAnimation(badge);
      const card = currentRenderer ? currentRenderer.addBadge(badge) : null;
      if (card) await playSpotlight(card);
    } else if (mode === 'dendro') {
      const nodeEl = currentRenderer ? currentRenderer.addBadge(badge) : null;
      if (nodeEl) await playPingTrace(nodeEl);
    } else if (mode === 'arcade') {
      if (currentRenderer) await currentRenderer.addBadge(badge);
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
    btn.title = enabled ? 'Animations On (A)' : 'Animations Off (A)';
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

// --- Dendro Ping Trace Animation ---

function playPingTrace(nodeEl) {
  return new Promise((resolve) => {
    if (!animationsEnabled() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Still mark as arrived so photo shows immediately
      const empId = nodeEl.getAttribute('data-emp-id');
      if (empId && window.DendroRenderer) window.DendroRenderer._arrived.add(empId);
      resolve();
      return;
    }

    const svg = nodeEl.closest('svg');
    if (!svg) { resolve(); return; }
    const g = svg.querySelector('g');
    if (!g) { resolve(); return; }

    const empId = nodeEl.getAttribute('data-emp-id');
    if (!empId) { resolve(); return; }

    // Find links using data attributes (tagged during _renderTree)
    // 4-level tree: Root → Division → Department → Employee
    // Chain: root→div link, div→dept link, dept→emp link (3 segments)
    const empLink = g.querySelector(`path.dendro-link[data-target-id="${empId}"]`);
    const chain = [];

    if (empLink) {
      // Walk backward: emp link → dept link → div link
      const deptKey = empLink.getAttribute('data-source-id');
      if (deptKey) {
        const deptLink = g.querySelector(`path.dendro-link[data-target-id="${CSS.escape(deptKey)}"]`);
        if (deptLink) {
          const divTheme = deptLink.getAttribute('data-source-id');
          if (divTheme) {
            const divLink = g.querySelector(`path.dendro-link[data-target-id="${CSS.escape(divTheme)}"]`);
            if (divLink) chain.push(divLink);
          }
          chain.push(deptLink);
        }
      }
      chain.push(empLink);
    }

    if (chain.length === 0) {
      // No path found — subtle glow only
      nodeEl.classList.add('dendro-arrival-glow');
      setTimeout(() => { nodeEl.classList.remove('dendro-arrival-glow'); resolve(); }, 2000);
      return;
    }

    // Get division color for arrival glow
    const divColor = empLink ? (empLink.getAttribute('stroke') || '#D4A843') : '#D4A843';

    // --- Subtle zoom toward the destination node ---
    const dendroRenderer = window.DendroRenderer;
    let origTransform = null;
    if (dendroRenderer && dendroRenderer._zoom && dendroRenderer._svg && typeof d3 !== 'undefined') {
      try {
        origTransform = d3.zoomTransform(dendroRenderer._svg.node());
        // Get destination node position
        const nodeTransform = nodeEl.getAttribute('transform');
        const nodeMatch = nodeTransform && nodeTransform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
        if (nodeMatch) {
          const nx = parseFloat(nodeMatch[1]);
          const ny = parseFloat(nodeMatch[2]);
          const zoomIn = 1.25; // 25% zoom boost
          const newScale = origTransform.k * zoomIn;
          const svgRect = dendroRenderer._svg.node().getBoundingClientRect();
          const cx = svgRect.width / 2;
          const cy = svgRect.height / 2;
          // Center on destination with zoom boost
          const tx = cx - nx * newScale;
          const ty = cy - ny * newScale;
          const targetTransform = d3.zoomIdentity.translate(tx, ty).scale(newScale);
          dendroRenderer._svg.transition().duration(1800).ease(d3.easeCubicInOut)
            .call(dendroRenderer._zoom.transform, targetTransform);
        }
      } catch { /* zoom is best-effort */ }
    }

    // Create circular-clipped badge photo that travels along the path
    const clipId = `ping-clip-${empId}`;
    const defs = svg.querySelector('defs');

    const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clipPath.setAttribute('id', clipId);
    const clipCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    clipCircle.setAttribute('r', '14');
    clipCircle.setAttribute('cx', '14');
    clipCircle.setAttribute('cy', '14');
    clipPath.appendChild(clipCircle);
    defs.appendChild(clipPath);

    // Photo group: image + glow border circle
    const photoGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    photoGroup.classList.add('ping-photo');
    photoGroup.setAttribute('filter', 'url(#dendro-glow)');

    const photoImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    photoImg.setAttribute('href', `/api/badge/${empId}/headshot`);
    photoImg.setAttribute('width', '28');
    photoImg.setAttribute('height', '28');
    photoImg.setAttribute('x', '-14');
    photoImg.setAttribute('y', '-14');
    photoImg.setAttribute('clip-path', `url(#${clipId})`);
    photoImg.addEventListener('error', () => { photoImg.remove(); }); // graceful fallback on 404
    photoImg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    // Adjust clipPath center to match negative offset
    clipCircle.setAttribute('cx', '0');
    clipCircle.setAttribute('cy', '0');

    const photoBorder = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    photoBorder.setAttribute('r', '14');
    photoBorder.setAttribute('fill', 'none');
    photoBorder.setAttribute('stroke', divColor);
    photoBorder.setAttribute('stroke-width', '2.5');

    photoGroup.appendChild(photoImg);
    photoGroup.appendChild(photoBorder);

    // Append to animation layer (survives _renderTree re-renders)
    const animLayer = dendroRenderer && dendroRenderer._animLayer
      ? dendroRenderer._animLayer.node()
      : g;
    animLayer.appendChild(photoGroup);

    let linkIdx = 0;

    function animateLink() {
      if (linkIdx >= chain.length) {
        // Arrival — remove traveling photo
        photoGroup.remove();
        clipPath.remove();

        // Find the LIVE DOM element (original nodeEl may be detached by re-render)
        const liveNodeEl = g.querySelector(`[data-emp-id="${empId}"]`);
        const targetNode = liveNodeEl || nodeEl;

        // Mark as arrived — all future re-renders will show the photo
        if (window.DendroRenderer) {
          window.DendroRenderer._arrived.add(empId);
        }

        // Reveal the badge photo on the LIVE element (swap placeholder → thumbnail)
        const awaitingCircle = targetNode.querySelector('circle.dendro-awaiting');
        if (awaitingCircle) {
          const patId = awaitingCircle.getAttribute('data-pat-id');
          awaitingCircle.setAttribute('fill', patId ? `url(#${patId})` : divColor);
          awaitingCircle.setAttribute('stroke-dasharray', 'none');
          awaitingCircle.setAttribute('stroke-opacity', '1');
          awaitingCircle.classList.remove('dendro-awaiting');
        }

        // Subtle arrival glow on the employee node (division-colored)
        const empCircle = targetNode.querySelector('circle');
        if (empCircle) {
          empCircle.setAttribute('data-orig-stroke', empCircle.getAttribute('stroke') || divColor);
          empCircle.setAttribute('data-orig-stroke-width', empCircle.getAttribute('stroke-width') || '2');
        }
        targetNode.classList.add('dendro-arrival-glow');

        // Expanding glow ring at destination
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring.setAttribute('r', '18');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', divColor);
        ring.setAttribute('stroke-width', '2');
        ring.setAttribute('opacity', '0.8');
        ring.classList.add('ping-ring');
        targetNode.appendChild(ring);

        // Ripple effect — pulse all branches outward from this node
        playBranchRipple(g, targetNode, divColor);

        // Ease zoom back to original after arrival
        if (origTransform && dendroRenderer && dendroRenderer._zoom && dendroRenderer._svg) {
          try {
            dendroRenderer._svg.transition().duration(2000).ease(d3.easeCubicInOut)
              .call(dendroRenderer._zoom.transform, origTransform);
          } catch { /* best-effort */ }
        }

        setTimeout(() => {
          targetNode.classList.remove('dendro-arrival-glow');
          ring.remove();
        }, 2500);

        setTimeout(resolve, 2500);
        return;
      }

      const path = chain[linkIdx];
      const len = path.getTotalLength();
      // Scale duration by link type: root→div slower (dramatic), dept→emp faster
      const linkType = path.getAttribute('data-link-type') || '';
      const duration = linkType === 'root-div' ? 2200 : linkType === 'div-dept' ? 1800 : 1500;
      const startTime = performance.now();

      // Thicken the active branch segment during travel
      const origOpacity = path.getAttribute('stroke-opacity') || '0.3';
      const origWidth = path.getAttribute('stroke-width') || '1.5';
      path.setAttribute('stroke-opacity', '0.9');
      path.setAttribute('stroke-width', parseFloat(origWidth) + 2);

      function step(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        const pt = path.getPointAtLength(eased * len);
        photoGroup.setAttribute('transform', `translate(${pt.x},${pt.y})`);

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          setTimeout(() => {
            path.setAttribute('stroke-opacity', origOpacity);
            path.setAttribute('stroke-width', origWidth);
          }, 300);
          linkIdx++;
          animateLink();
        }
      }

      requestAnimationFrame(step);
    }

    animateLink();
  });
}

// --- Branch Ripple Effect ---
// Organic multi-wave ripple radiating from a source node

function playBranchRipple(g, sourceNode, color) {
  // Get source position from the node's transform
  const sourceTransform = sourceNode.getAttribute('transform');
  let sx = 0, sy = 0;
  if (sourceTransform) {
    const match = sourceTransform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
    if (match) { sx = parseFloat(match[1]); sy = parseFloat(match[2]); }
  }

  const allLinks = Array.from(g.querySelectorAll('path.dendro-link'));
  if (allLinks.length === 0) return;

  // Classify links: root→division vs division→employee
  const rootLinks = [];
  const empLinks = [];
  const linkMeta = [];

  allLinks.forEach(link => {
    try {
      const len = link.getTotalLength();
      const mid = link.getPointAtLength(len / 2);
      const dx = mid.x - sx;
      const dy = mid.y - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const sourceId = link.getAttribute('data-source-id') || '';
      const isRootLink = sourceId === 'root';
      const meta = { link, dist, isRootLink };
      linkMeta.push(meta);
      if (isRootLink) rootLinks.push(meta);
      else empLinks.push(meta);
    } catch { /* skip */ }
  });

  const maxDist = Math.max(...linkMeta.map(m => m.dist), 1);

  // --- Wave 1: Initial outward ripple with randomized jitter ---
  linkMeta.forEach(({ link, dist, isRootLink }) => {
    const baseDelay = (dist / maxDist) * 1200;
    const jitter = (Math.random() - 0.3) * 400; // asymmetric jitter, slightly forward-biased
    const delay = Math.max(0, baseDelay + jitter);
    const origOpacity = link.getAttribute('stroke-opacity') || '0.25';
    const origWidth = link.getAttribute('stroke-width') || '1.5';
    const peakOpacity = isRootLink ? '1' : '0.8';
    const widthBoost = isRootLink ? 2.5 : 1;

    setTimeout(() => {
      link.setAttribute('stroke-opacity', peakOpacity);
      link.setAttribute('stroke-width', parseFloat(origWidth) + widthBoost);
      setTimeout(() => {
        link.setAttribute('stroke-opacity', origOpacity);
        link.setAttribute('stroke-width', origWidth);
      }, isRootLink ? 800 : 500);
    }, delay);
  });

  // --- Wave 2: Secondary echo ripple (reverse direction, softer) ---
  setTimeout(() => {
    linkMeta.forEach(({ link, dist }) => {
      const reverseDelay = ((maxDist - dist) / maxDist) * 1000;
      const jitter = Math.random() * 300;
      const origOpacity = link.getAttribute('stroke-opacity') || '0.25';

      setTimeout(() => {
        link.setAttribute('stroke-opacity', '0.55');
        setTimeout(() => {
          link.setAttribute('stroke-opacity', origOpacity);
        }, 400);
      }, reverseDelay + jitter);
    });
  }, 1400);

  // --- Root→Division links: extra pulsing glow effect ---
  rootLinks.forEach(({ link }, i) => {
    const origOpacity = link.getAttribute('stroke-opacity') || '0.6';
    const origWidth = link.getAttribute('stroke-width') || '2';

    // Staggered triple-pulse on trunk links
    [0, 600, 1200].forEach((offset, pulseIdx) => {
      const delay = 200 + (i * 150) + offset;
      setTimeout(() => {
        const intensity = 1 - (pulseIdx * 0.2); // decreasing intensity
        link.setAttribute('stroke-opacity', String(Math.min(1, intensity)));
        link.setAttribute('stroke-width', String(parseFloat(origWidth) + 3 - pulseIdx));
        setTimeout(() => {
          link.setAttribute('stroke-opacity', origOpacity);
          link.setAttribute('stroke-width', origWidth);
        }, 350);
      }, delay);
    });
  });

  // --- Scattered sparkle: random individual links flash independently ---
  const sparkleCount = Math.min(allLinks.length, Math.floor(allLinks.length * 0.4));
  const shuffled = [...linkMeta].sort(() => Math.random() - 0.5).slice(0, sparkleCount);
  shuffled.forEach(({ link }, i) => {
    const delay = 2200 + Math.random() * 1200;
    const origOpacity = link.getAttribute('stroke-opacity') || '0.25';

    setTimeout(() => {
      link.setAttribute('stroke-opacity', '0.7');
      setTimeout(() => {
        link.setAttribute('stroke-opacity', origOpacity);
      }, 250 + Math.random() * 200);
    }, delay);
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

  panel.innerHTML = `
    <div class="stats-donut-section${animClass}">
      <div class="orgchart-donut" style="background: ${gradient}" data-total="${donutTotal}"></div>
      <div class="donut-legend">
        ${legend.map(l => `<div class="donut-legend-item"><span class="donut-legend-dot" style="background:${l.color}"></span><span class="donut-legend-name">${esc(l.name)}</span> <span class="donut-legend-count">${l.count}</span></div>`).join('')}
      </div>
    </div>
    ${newestHtml}
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
