// Help Desk Badge App — Presentation Mode Client
// Runs on /presentation route only (big screen display)

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────

  const pres = {
    active: false,
    phase: 'inactive', // 'inactive' | 'band_intro' | 'rotation'
    currentView: null,
    currentRenderer: null,
    chyronMessages: [],
    chyronIndex: 0,
    chyronTimer: null,
    sseSource: null,
    audioEnabled: false,
  };

  // ─── DOM refs ───────────────────────────────────────────

  const overlay = document.getElementById('presentationOverlay');
  const waitingScreen = document.getElementById('presentationWaiting');
  const introScreen = document.getElementById('bandIntroScreen');
  const introImg = document.getElementById('bandIntroImg');
  const introGlow = document.getElementById('bandIntroGlow');
  const introTerminal = document.getElementById('bandIntroTerminal');
  const viewContainer = document.getElementById('viewContainer');
  const chyronOverlay = document.getElementById('chyronOverlay');
  const chyronText = document.getElementById('chyronText');

  // ─── Band Member Data ───────────────────────────────────

  const BAND_MEMBERS = [
    { id: 'HD-00001', name: 'LUKE', title: 'Chief Escalation Officer', dept: 'TICKET ESCALATION BUREAU', instrument: 'Vocals', color: '#22C55E' },
    { id: 'HD-00002', name: 'DREW', title: 'Senior Audio Engineer', dept: 'AUDIO ENGINEERING DIVISION', instrument: 'Lead Guitar', color: '#5B8DEF' },
    { id: 'HD-00003', name: 'HENRY', title: 'Rhythm Infrastructure Lead', dept: 'DEPT. OF PERCUSSIVE MAINTENANCE', instrument: 'Drums', color: '#E74C3C' },
    { id: 'HD-00004', name: 'TODD', title: 'Redundancy Dept. Manager', dept: 'INFRASTRUCTURE & POWER CHORDS', instrument: 'Rhythm Guitar', color: '#D4A843' },
    { id: 'HD-00005', name: 'ADAM', title: 'Low-End Specialist', dept: 'LOW FREQUENCY OPERATIONS', instrument: 'Bass', color: '#9B59B6' },
  ];

  // ─── Renderers ──────────────────────────────────────────

  const RENDERERS = {
    grid: window.GridRenderer,
    dendro: window.DendroRenderer,
    arcade: window.ArcadeRenderer,
  };

  // ─── Init ───────────────────────────────────────────────

  function init() {
    // Mute arcade sound effects in presentation mode (band is playing live)
    if (window.ArcadeSFX) ArcadeSFX.setMuted(true);
    connectSSE();
    // Check if presentation is already in progress (page refresh / reconnect)
    fetchCurrentState();
  }

  async function fetchCurrentState() {
    try {
      const res = await fetch('/api/presentation/status');
      const data = await res.json();
      if (data.active) {
        handleStateChange(data);
      }
    } catch { /* server not reachable */ }
  }

  // ─── SSE Connection ─────────────────────────────────────

  let sseRetryDelay = 1000;
  const SSE_MAX_RETRY = 30000;

  function connectSSE() {
    if (pres.sseSource) {
      pres.sseSource.close();
    }

    pres.sseSource = new EventSource('/api/badges/stream');

    pres.sseSource.addEventListener('connected', () => {
      console.log('[Presentation] SSE connected');
      sseRetryDelay = 1000; // reset backoff on successful connection
    });

    pres.sseSource.addEventListener('presentation-state', (e) => {
      const data = JSON.parse(e.data);
      handleStateChange(data);
    });

    pres.sseSource.addEventListener('presentation-band-member', (e) => {
      const data = JSON.parse(e.data);
      handleBandMember(data);
    });

    pres.sseSource.addEventListener('presentation-chyron', (e) => {
      const data = JSON.parse(e.data);
      pres.chyronMessages = data.messages;
      pres.chyronIndex = 0;
    });

    pres.sseSource.addEventListener('presentation-view-change', (e) => {
      const data = JSON.parse(e.data);
      handleViewChange(data.view);
    });

    pres.sseSource.addEventListener('new-badge', (e) => {
      const badge = JSON.parse(e.data);
      handleNewBadge(badge);
    });

    pres.sseSource.onerror = () => {
      pres.sseSource.close();
      console.log(`[Presentation] SSE lost — retrying in ${sseRetryDelay / 1000}s`);
      setTimeout(connectSSE, sseRetryDelay);
      sseRetryDelay = Math.min(sseRetryDelay * 2, SSE_MAX_RETRY);
    };
  }

  // ─── State Handlers ─────────────────────────────────────

  function handleStateChange(data) {
    const wasActive = pres.active;
    pres.active = data.active;
    pres.phase = data.phase;

    if (data.active && data.phase === 'band_intro') {
      // Show intro screen
      overlay.style.display = 'flex';
      waitingScreen.style.display = 'none';
      introScreen.style.display = 'flex';
      viewContainer.style.display = 'none';
      chyronOverlay.style.display = 'none';
    } else if (data.active && data.phase === 'rotation') {
      // Hide overlay, show view container + chyron
      overlay.style.display = 'none';
      viewContainer.style.display = 'block';
      startChyron();
      if (!wasActive || pres.currentView !== data.currentView) {
        handleViewChange(data.currentView);
      }
    } else {
      // Inactive — show waiting screen
      stopPresentation();
    }
  }

  function stopPresentation() {
    pres.active = false;
    pres.phase = 'inactive';

    // Destroy current renderer
    if (pres.currentRenderer && pres.currentRenderer.destroy) {
      pres.currentRenderer.destroy();
    }
    pres.currentRenderer = null;
    pres.currentView = null;

    // Reset UI
    overlay.style.display = 'flex';
    waitingScreen.style.display = 'block';
    introScreen.style.display = 'none';
    viewContainer.style.display = 'none';
    viewContainer.innerHTML = '';

    // Stop chyron
    stopChyron();
  }

  // ─── Band Intro ─────────────────────────────────────────

  let introAnimationTimer = null;

  function handleBandMember(data) {
    const member = BAND_MEMBERS[data.index];
    if (!member) return;

    console.log(`[Presentation] Band intro: ${member.name} (${data.index + 1}/${data.total})`);

    // Clear previous animation
    if (introAnimationTimer) clearTimeout(introAnimationTimer);

    // Fade out previous content
    introScreen.classList.add('band-intro-fadeout');

    setTimeout(() => {
      introScreen.classList.remove('band-intro-fadeout');

      // Reset scanline
      const scanline = introScreen.querySelector('.band-intro-scanline');
      if (scanline) {
        scanline.style.animation = 'none';
        scanline.offsetHeight; // force reflow
        scanline.style.animation = '';
      }

      // Set photo
      introImg.src = `/api/badge/${member.id}/headshot`;
      introImg.alt = member.name;
      introImg.style.animation = 'none';
      introImg.offsetHeight;
      introImg.style.animation = '';

      // Set glow color
      introGlow.style.setProperty('--glow-color', member.color);
      introGlow.style.animation = 'none';
      introGlow.offsetHeight;
      introGlow.style.animation = '';

      // Typewriter terminal
      introTerminal.innerHTML = '';
      const lines = [
        { prompt: '> ', text: 'ACCESSING PERSONNEL FILE...' },
        { prompt: '> NAME: ', text: member.name, cls: 'intro-value' },
        { prompt: '> TITLE: ', text: member.title, cls: 'intro-value' },
        { prompt: '> DEPT: ', text: member.dept, cls: 'intro-value' },
        { prompt: '> INSTRUMENT: ', text: member.instrument, cls: 'intro-value' },
        { prompt: '> CLEARANCE: ', text: 'ALL ACCESS', cls: 'intro-value' },
        { prompt: '> STATUS: ', text: '████████████ VERIFIED', cls: 'intro-status-bar' },
      ];

      lines.forEach((line, i) => {
        const div = document.createElement('div');
        div.className = 'intro-line';
        div.style.animationDelay = `${1.5 + i * 0.6}s`;
        div.innerHTML = `<span class="intro-prompt">${esc(line.prompt)}</span><span class="${line.cls || ''}">${esc(line.text)}</span>`;
        introTerminal.appendChild(div);
      });
    }, 800); // 800ms fade-out before new member
  }

  // ─── View Rotation ──────────────────────────────────────

  async function handleViewChange(view) {
    console.log(`[Presentation] View change: ${view}`);

    // Destroy current
    if (pres.currentRenderer && pres.currentRenderer.destroy) {
      pres.currentRenderer.destroy();
    }
    viewContainer.innerHTML = '';
    pres.currentView = view;

    // Brief blank pause
    await sleep(400);

    // Select renderer
    const Renderer = RENDERERS[view];
    if (!Renderer) {
      console.warn(`[Presentation] No renderer for view: ${view}`);
      return;
    }

    pres.currentRenderer = Renderer;

    // Fetch stats
    let stats = {};
    try {
      const res = await fetch('/api/orgchart/stats');
      stats = await res.json();
    } catch { /* use empty stats */ }

    // Init with presentation mode
    viewContainer.classList.remove('presentation-view-entering');
    viewContainer.offsetHeight;
    viewContainer.classList.add('presentation-view-entering');

    await Renderer.init(viewContainer, stats);

    // Stagger in recent badges
    await staggerBadges(view);
  }

  async function staggerBadges(view) {
    // Fetch badge pool: recent first, capped at 30
    let badges = [];
    try {
      badges = await BadgePool.fetchAll({ limit: 50, recentFirst: true, maxBadges: 30 });
    } catch {
      console.warn('[Presentation] Failed to fetch badges for stagger');
      return;
    }

    if (!badges.length || !pres.currentRenderer) return;

    // Stagger delay depends on view
    const delays = { grid: 2500, dendro: 2000, arcade: 2000 };
    const delay = delays[view] || 2000;

    for (const badge of badges) {
      if (pres.currentView !== view) break; // view changed, stop staggering
      if (!pres.active) break;

      try {
        if (pres.currentRenderer && pres.currentRenderer.addBadge) {
          pres.currentRenderer.addBadge(badge);
        }
      } catch (err) {
        console.warn('[Presentation] addBadge error:', err);
      }

      await sleep(delay);
    }
  }

  // ─── New Badge (SSE live arrival) ───────────────────────

  function handleNewBadge(badge) {
    if (!pres.active || pres.phase !== 'rotation') return;

    // Flash chyron
    flashChyron(`★ NEW HIRE: ${badge.name}`);

    // Add to current view
    if (pres.currentRenderer && pres.currentRenderer.addBadge) {
      try {
        pres.currentRenderer.addBadge(badge);
      } catch (err) {
        console.warn('[Presentation] Live addBadge error:', err);
      }
    }
  }

  // ─── Chyron ─────────────────────────────────────────────

  function startChyron() {
    chyronOverlay.style.display = 'block';
    pres.chyronIndex = 0;
    rotateChyronMessage();
    pres.chyronTimer = setInterval(rotateChyronMessage, 8000);
  }

  function stopChyron() {
    chyronOverlay.style.display = 'none';
    if (pres.chyronTimer) {
      clearInterval(pres.chyronTimer);
      pres.chyronTimer = null;
    }
  }

  function rotateChyronMessage() {
    const messages = pres.chyronMessages.length ? pres.chyronMessages : [
      'GET YOUR BADGE → hdbadge.nav.computer',
      'HELP DESK — Live in Madison, WI',
      'Join the org chart — scan the QR code',
    ];

    // Fade out
    chyronText.classList.remove('chyron-text-enter');
    chyronText.classList.add('chyron-text-exit');

    setTimeout(() => {
      chyronText.textContent = messages[pres.chyronIndex % messages.length];
      pres.chyronIndex++;
      chyronText.classList.remove('chyron-text-exit', 'chyron-flash');
      chyronText.classList.add('chyron-text-enter');
    }, 400);
  }

  function flashChyron(message) {
    // Temporarily show a special message
    const prevTimer = pres.chyronTimer;
    if (prevTimer) clearInterval(prevTimer);

    chyronText.classList.remove('chyron-text-enter', 'chyron-text-exit');
    chyronText.textContent = message;
    chyronText.classList.add('chyron-flash');

    // Resume normal rotation after 5s
    setTimeout(() => {
      chyronText.classList.remove('chyron-flash');
      pres.chyronTimer = setInterval(rotateChyronMessage, 8000);
      rotateChyronMessage();
    }, 5000);
  }

  // ─── Helpers ────────────────────────────────────────────

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Start ──────────────────────────────────────────────

  init();
})();
