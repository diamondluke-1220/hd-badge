// ─── Network Rack Renderer ─────────────────────────────────
// Implements the renderer interface: { init, addBadge, updateBadge, destroy }
// Dual server rack layout: Root (Core A/B) → Division Switches → Patch Panels → Ports (employees).

window.RackRenderer = {
  _container: null,
  _stats: null,
  _allBadges: [],
  _badgeIndex: {},      // employeeId → badge
  _rackData: null,      // computed layout { rackA: Device[], rackB: Device[] }
  _cssLink: null,
  _resizeObserver: null,
  _dualMode: false,     // true when ≥3 active divisions
  _introPlayed: false,  // door open animation plays once per session
  _reducedMotion: false, // true when prefers-reduced-motion: reduce

  // ─── Phase 3: Pool State ───────────────────────────────────
  _badgePool: [],         // all non-exec badges, grouped by divTheme
  _divInFlight: {},       // divTheme → count of concurrent animations (max _MAX_PER_DIV)
  _MAX_PER_DIV: 2,       // max concurrent ingress per division

  // ─── WFQ Scheduler State ─────────────────────────────────
  // Weighted Fair Queuing with tick-driven eviction. No state machine, no TTL timers.
  // Each tick picks 1 random badge to evict from the lowest-virtual-time division.
  // Rotation rate = tick interval. Panels stay mostly full.
  _wfqRunning: false,              // true while scheduler loop is active
  _wfqVirtualTime: {},             // divTheme → number (WFQ scheduling credit)
  _wfqWeight: {},                  // divTheme → number (poolSize / totalPoolSize)
  _wfqInitialFillComplete: {},     // divTheme → boolean (first-pass priority tracking)
  _wfqDivPools: {},               // divTheme → [{ badge, divTheme }] (per-div pool index)
  _WFQ_TICK_MS: 8000,             // scheduler tick interval (matched to pre-WFQ rotation cadence)

  // Rack assignment: which division themes go where
  _RACK_A_THEMES: ['IT', 'Punk'],
  _RACK_B_THEMES: ['Office', 'Corporate'],
  _TARGET_U: 20,        // target rack height in U
  _PORTS_PER_ROW: 12,

  async init(container, stats) {
    this._container = container;
    this._stats = stats;
    this._badgeIndex = {};
    this._reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Pause all animations when tab is not visible (save CPU/battery)
    this._onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        this._stopWfq();
        this._stopCloudRain();
        this._stopThreatTraffic();
        this._stopIdleAnimations();
        this._cancelAllPackets();
      } else if (document.visibilityState === 'visible' && this._container) {
        this._startCloudRain();
        this._startThreatTraffic();
        this._startIdleAnimations();
        if (this._badgePool.length > 0 && !this._wfqRunning) {
          this._seedWfqFromDOM();
          this._startWfq();
        }
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    // Load CSS
    this._cssLink = document.createElement('link');
    this._cssLink.rel = 'stylesheet';
    this._cssLink.href = '/css/rack.css';
    document.head.appendChild(this._cssLink);

    // Fetch all badges
    let allBadges = [];
    try {
      allBadges = await BadgePool.fetchAll({ limit: 100 });
    } catch {
      container.innerHTML = '<div class="rack-fallback">Failed to load employee data.</div>';
      return;
    }

    // Initialize shared stats (ticker, donut)
    initRendererStats(stats);

    if (allBadges.length === 0) {
      container.innerHTML = '<div class="rack-fallback">No employees provisioned yet.<br><a href="/" style="color:var(--accent-blue);margin-top:8px;display:inline-block;">Be the first hire &rarr;</a></div>';
      return;
    }

    // Index badges
    this._allBadges = allBadges;
    allBadges.forEach(b => { this._badgeIndex[b.employeeId] = b; });

    // First rack init in this page load → empty panels, badges animate in
    // View switch back (same page load) → instant fill, skip to rotation
    this._animateFromEmpty = !this._hasInitialized;
    this._hasInitialized = true;

    this._rackData = this._computeLayout(allBadges, { emptyPanels: this._animateFromEmpty });
    this._render();

    // Initialize badge pool and WFQ scheduler
    this._initPool(allBadges);
    this._initWfq();

  },

  addBadge(badge) {
    if (!this._container || !this._rackData) return null;

    // Preserve scroll — SSE badge additions must not jump the page
    const scrollY = window.scrollY;

    // Dedup
    if (this._badgeIndex[badge.employeeId]) return null;

    this._badgeIndex[badge.employeeId] = badge;
    this._allBadges.push(badge);

    const divTheme = getDivisionForDept(badge.department, badge.isBandMember);

    // Exec/band members go directly to core portraits, no animation
    if (divTheme === '_exec') return null;

    // Add to badge pool and WFQ per-division pool
    const entry = { badge, divTheme };
    this._badgePool.push(entry);
    if (this._wfqDivPools[divTheme]) {
      this._wfqDivPools[divTheme].push(entry);
      // Recompute WFQ weights (O(5) — trivial)
      const totalSize = this._badgePool.length || 1;
      for (const d of Object.keys(this._DIV_TOPOLOGY)) {
        this._wfqWeight[d] = (this._wfqDivPools[d]?.length || 0) / totalSize;
      }
    }

    // WFQ scheduler picks it up on next tick (within 2s)
    // If dual mode with cables, just let the scheduler handle it
    if (this._dualMode && this._cableSvg) {
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
      return null;
    }

    // Fallback: place directly (non-dual mode or no cables)
    const result = this._placeBadgePort(badge);
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
    return result;
  },

  _placeBadgePort(badge) {
    if (!this._container) return null;
    const scrollY = window.scrollY;

    // Dedup — skip if this badge is already rendered in a panel
    if (this._container.querySelector(`.rack-port[data-employee-id="${CSS.escape(badge.employeeId)}"]`)) {
      return null;
    }

    const divTheme = getDivisionForDept(badge.department, badge.isBandMember);

    // Panel key is just the division theme (all departments merged into one panel per division)
    const panelKey = divTheme;
    let panel = this._container.querySelector(`[data-panel-key="${CSS.escape(panelKey)}"]`);

    if (!panel) {
      // Department not yet rendered — if packets are in flight, skip the full re-render
      // and just drop this badge. It'll get picked up on next view init.
      if (this._activePackets.length > 0 || this._inFlightCount > 0) {
        return null;
      }
      // No animations active — safe to rebuild layout
      const scrollY = window.scrollY;
      this._rackData = this._computeLayout(this._allBadges);
      this._render();
      window.scrollTo(0, scrollY);
      panel = this._container.querySelector(`[data-panel-key="${CSS.escape(panelKey)}"]`);
      if (!panel) return null;
    }

    // Find the first empty port across all rows in this panel
    const emptyPort = panel.querySelector('.rack-port-empty');
    if (!emptyPort) return null; // panel completely full

    const portEl = this._createPort(badge);
    emptyPort.replaceWith(portEl);
    // Panel contents derived from DOM — no manual tracking needed

    // Update port count
    const countEl = panel.querySelector('.rack-port-count');
    if (countEl) {
      const ports = panel.querySelectorAll('.rack-port:not(.rack-port-empty)');
      countEl.textContent = `${ports.length}`;
    }

    // Light up corresponding switch port above the patch panel
    const divThemeEsc = CSS.escape(divTheme);
    const sw = this._container.querySelector(`.rack-device-switch[data-theme="${divThemeEsc}"]`);
    if (sw) {
      const filledPorts = panel.querySelectorAll('.rack-port:not(.rack-port-empty)').length;
      // Ports are 0-indexed (port 0 = first employee). Badge N maps to switch port N-1.
      const switchPort = sw.querySelector(`[data-switch-port="${filledPorts - 1}"]`);
      if (switchPort && !switchPort.classList.contains('rack-conn-port-active')) {
        switchPort.classList.add('rack-conn-port-active', 'rack-conn-port-dual');
        // Assign to a port animation group based on existing data attribute
        const portIdx = parseInt(switchPort.dataset.switchPort || '0', 10);
        const seed = Array.from(divThemeEsc).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
        switchPort.classList.add(`rack-port-group-${((Math.abs(seed) * 7 + portIdx * 3) % 8)}`);
      }
    }

    // Update WLC AP count (3 APs per employee)
    const wlcCount = this._container.querySelector('[data-wlc-aps]');
    if (wlcCount) {
      wlcCount.textContent = `${this._allBadges.length * 3} APs`;
    }

    // Restore scroll — badge placement must not jump the page
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
    return portEl;
  },

  updateBadge(badge) {
    if (!this._container) return;
    const portEl = this._container.querySelector(`[data-employee-id="${badge.employeeId}"]`);
    if (!portEl) return;

    const img = portEl.querySelector('img');
    if (img && badge.employeeId) {
      img.src = `/api/badge/${badge.employeeId}/headshot?t=${Date.now()}`;
    }

    const nameEl = portEl.querySelector('.rack-port-tooltip-name');
    if (nameEl && badge.name) nameEl.textContent = badge.name;

    const titleEl = portEl.querySelector('.rack-port-tooltip-title');
    if (titleEl && badge.title) titleEl.textContent = badge.title;
  },

  destroy() {
    // Stop WFQ scheduler (async loop exits at next await)
    this._stopWfq();
    // Safe to reset in-flight flags on full destroy — everything is being torn down
    for (const div of Object.keys(this._divInFlight)) {
      this._divInFlight[div] = 0;
    }
    this._stopCloudRain();
    this._stopThreatTraffic();
    this._stopIdleAnimations();
    this._cancelAllPackets();
    if (this._onVisibilityChange) { document.removeEventListener('visibilitychange', this._onVisibilityChange); this._onVisibilityChange = null; }
    if (this._cssLink) { this._cssLink.remove(); this._cssLink = null; }
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this._onWindowResize) { window.removeEventListener('resize', this._onWindowResize); this._onWindowResize = null; }
    if (this._resizeDebounce) { clearTimeout(this._resizeDebounce); this._resizeDebounce = null; }
    if (this._container) this._container.innerHTML = '';
    this._container = null;
    this._stats = null;
    this._allBadges = [];
    this._badgeIndex = {};
    this._rackData = null;
    this._graph = null;
    this._cableSvg = null;
    this._cablePaths = null;
    this._cableBusy = null;
    this._virtualCoords = null;
    this._coreCliPopup = { A: null, B: null };
    this._threatCounts = { A: 0, B: 0 };
    this._vpnSessions = 0;
    // WFQ cleanup
    this._wfqDivPools = {};
    this._wfqVirtualTime = {};
    this._wfqWeight = {};
    this._wfqInitialFillComplete = {};
  },

  // ─── Layout Computation ─────────────────────────────────

  _computeLayout(badges, options = {}) {
    const emptyPanels = options.emptyPanels || false;
    // Group badges by division theme
    const byDiv = {};
    const execBadges = [];

    badges.forEach(b => {
      const theme = getDivisionForDept(b.department, b.isBandMember);
      if (theme === '_exec') {
        execBadges.push(b);
        return;
      }
      if (!byDiv[theme]) byDiv[theme] = {};
      if (!byDiv[theme][b.department]) byDiv[theme][b.department] = [];
      byDiv[theme][b.department].push(b);
    });

    // Always render dual racks — the infrastructure exists regardless of badge population
    this._dualMode = true;

    // Build device lists for each rack
    const rackA = [];
    const rackB = [];

    // Add division switch + single patch panel per division (all dept employees merged)
    const addDivision = (theme, rack) => {
      const divInfo = PUBLIC_DIVISIONS.find(d => d.theme === theme);
      if (!divInfo) return;

      const depts = byDiv[theme];
      const color = DIVISION_ACCENT_COLORS[theme] || '#4b5563';

      // Merge all department employees into one division pool (may be empty)
      const allEmployees = [];
      if (depts) Object.values(depts).forEach(emps => allEmployees.push(...emps));

      // Division switch (1U) — active ports match employee count in patch panel below
      rack.push({
        type: 'switch',
        name: divInfo.name,
        theme: theme,
        color: color,
        portCount: emptyPanels ? 0 : Math.min(allEmployees.length, 12),
      });

      // Division patch panel (1U, 12 ports — empty on init, badges animate in)
      rack.push({
        type: 'patch',
        name: divInfo.name,
        theme: theme,
        color: color,
        employees: emptyPanels ? [] : allEmployees,
        uSize: 1,
        panelKey: theme,
      });
    };

    // Assign divisions to racks
    this._RACK_A_THEMES.forEach(t => addDivision(t, rackA));
    this._RACK_B_THEMES.forEach(t => addDivision(t, rackB));

    // Rack A infra block: Storage (2U) → BRS (1U) → Cable Mgmt
    rackA.unshift({ type: 'cable' });
    rackA.unshift({ type: 'brs' });
    rackA.unshift({ type: 'storage' });

    // Rack B: BRS-02 at top of division block (replaces cable mgmt)
    rackB.unshift({ type: 'brs', id: 'brs-02' });

    // Bottom-of-rack devices (before height matching)
    // Rack A: WLC above UPS
    rackA.push({ type: 'wlc' });

    // Rack B: Contractors + VPN above UPS
    const customDepts = byDiv['_custom'];
    {
      const customEmployees = [];
      if (customDepts) Object.values(customDepts).forEach(emps => customEmployees.push(...emps));

      rackB.push({
        type: 'switch',
        name: 'INDEPENDENT CONTRACTORS',
        theme: '_custom',
        color: DIVISION_ACCENT_COLORS['_custom'] || '#ffd700',
        portCount: emptyPanels ? 0 : Math.min(customEmployees.length, 24),
        totalPorts: 24,
      });

      rackB.push({
        type: 'patch',
        name: 'INDEPENDENT CONTRACTORS',
        theme: '_custom',
        color: DIVISION_ACCENT_COLORS['_custom'] || '#ffd700',
        employees: emptyPanels ? [] : customEmployees,
        uSize: 2,
        panelKey: '_custom',
      });
    }

    // VPN just above UPS — adjacent to contractors it serves
    rackB.push({ type: 'vpn' });

    // Match rack heights — add blanks so both racks are the same total U
    const coreU = 1;
    const fwU = 1;
    const bottomU = 1; // UPS only (no cable mgmt before UPS now)
    const devicesA = this._usedU(rackA);
    const devicesB = this._usedU(rackB);
    const totalA = fwU + coreU + devicesA + bottomU;
    const totalB = fwU + coreU + devicesB + bottomU;
    const maxU = Math.max(totalA, totalB);

    const blanksA = maxU - totalA;
    const blanksB = maxU - totalB;
    for (let i = 0; i < blanksA; i++) rackA.push({ type: 'blank' });
    for (let i = 0; i < blanksB; i++) rackB.push({ type: 'blank' });

    // UPS at the bottom
    rackA.push({ type: 'ups', pct: 80 + Math.floor(Math.random() * 15), runtime: 42 + Math.floor(Math.random() * 20) });
    rackB.push({ type: 'ups', pct: 65 + Math.floor(Math.random() * 25), runtime: 28 + Math.floor(Math.random() * 30) });

    return { rackA, rackB, execBadges };
  },

  // Empty departments are not rendered — they install dynamically when first employee joins

  _usedU(rack) {
    return rack.reduce((sum, d) => {
      if (d.type === 'switch') return sum + 1;
      if (d.type === 'patch') return sum + (d.uSize || 1);
      if (d.type === 'storage') return sum + 2;
      if (d.type === 'brs') return sum + 1;
      if (d.type === 'vpn') return sum + 1;
      if (d.type === 'wlc') return sum + 1;
      if (d.type === 'cable') return sum + 1;
      if (d.type === 'blank') return sum + 1;
      if (d.type === 'ups') return sum + 1;
      return sum;
    }, 0);
  },

  // ─── Zoom to Fit ────────────────────────────────────────

  _applyZoomToFit(wrapper) {
    if (!wrapper) return;

    // The inner content div gets scaled; the outer .rack-container clips
    let inner = wrapper.querySelector('.rack-zoom-inner');
    if (!inner) {
      // Wrap all children in an inner div (once)
      inner = document.createElement('div');
      inner.className = 'rack-zoom-inner';
      while (wrapper.firstChild) inner.appendChild(wrapper.firstChild);
      wrapper.appendChild(inner);
    }

    // Reset scale to measure natural size
    inner.style.transform = '';

    requestAnimationFrame(() => {
      const contentH = inner.scrollHeight;
      const contentW = inner.scrollWidth;
      // Available space = wrapper's box minus its padding
      const style = getComputedStyle(wrapper);
      const padTop = parseFloat(style.paddingTop) || 0;
      const padBot = parseFloat(style.paddingBottom) || 0;
      const padL = parseFloat(style.paddingLeft) || 0;
      const padR = parseFloat(style.paddingRight) || 0;
      const viewportH = wrapper.clientHeight - padTop - padBot;
      const viewportW = wrapper.clientWidth - padL - padR;

      if (!contentH || !viewportH) return;

      const scaleH = viewportH / contentH;
      const scaleW = viewportW / contentW;
      const scale = Math.min(1, scaleH, scaleW);

      inner.style.transformOrigin = 'top center';
      inner.style.transform = `scale(${scale.toFixed(4)})`;
      this._zoomScale = scale;
      // Lock the container — no scrollbar
      wrapper.style.overflow = 'hidden';
      // Strip padding to maximize viewport for content
      if (scale < 0.95) {
        wrapper.style.paddingTop = '4px';
        wrapper.style.paddingBottom = '0';
      }
      // Recalculate with reduced padding to use reclaimed space
      const newViewportH = wrapper.clientHeight - (parseFloat(wrapper.style.paddingTop) || 0);
      const finalScale = Math.min(1, newViewportH / contentH, scaleW);
      if (finalScale !== scale) {
        inner.style.transform = `scale(${finalScale.toFixed(4)})`;
        this._zoomScale = finalScale;
      }
    });
  },

  // ─── Rendering ──────────────────────────────────────────

  _render() {
    const container = this._container;
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'rack-container';

    // Dual internet clouds — one per rack, aligned with rack columns
    const cloudsRow = document.createElement('div');
    cloudsRow.className = 'rack-clouds-row';
    if (this._dualMode) {
      const colA = document.createElement('div');
      colA.className = 'rack-cloud-col';
      colA.setAttribute('data-cloud-col', 'A');
      colA.appendChild(this._renderInternetCloud('A'));
      cloudsRow.appendChild(colA);

      const colB = document.createElement('div');
      colB.className = 'rack-cloud-col';
      colB.setAttribute('data-cloud-col', 'B');
      colB.appendChild(this._renderInternetCloud('B'));
      cloudsRow.appendChild(colB);
    } else {
      cloudsRow.appendChild(this._renderInternetCloud('A'));
    }
    wrapper.appendChild(cloudsRow);

    // Rack columns with above-rack devices
    const racksRow = document.createElement('div');
    racksRow.className = 'rack-frames-row';

    if (this._dualMode) {
      // Rack A column: WiFi AP (perched) → rack frame
      const colA = document.createElement('div');
      colA.className = 'rack-column';
      colA.appendChild(this._renderWiFiAP());
      const frameA = this._renderRack(this._rackData.rackA, 'IDF-101-PROD', 'RACK A', this._rackData.execBadges, 'A');
      colA.appendChild(frameA);
      racksRow.appendChild(colA);

      // Rack B column: rack frame only
      const colB = document.createElement('div');
      colB.className = 'rack-column';
      const frameB = this._renderRack(this._rackData.rackB, 'IDF-102-OFFICE', 'RACK B', this._rackData.execBadges, 'B');
      colB.appendChild(frameB);
      racksRow.appendChild(colB);
    } else {
      const colA = document.createElement('div');
      colA.className = 'rack-column';
      colA.appendChild(this._renderWiFiAP());
      const merged = [...this._rackData.rackA, ...this._rackData.rackB];
      const frame = this._renderRack(merged, 'IDF-101', 'RACK A', this._rackData.execBadges, 'A');
      colA.appendChild(frame);
      racksRow.appendChild(colA);
    }

    wrapper.appendChild(racksRow);
    container.appendChild(wrapper);

    // Door open intro animation (once per session, skip in presentation mode)
    const isPresentation = document.body.classList.contains('presentation-mode');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const introKey = 'rack-intro-played';
    const sessionPlayed = sessionStorage.getItem(introKey);
    if (!sessionPlayed && !this._introPlayed && !isPresentation) {
      this._introPlayed = true;
      sessionStorage.setItem(introKey, '1');
      wrapper.classList.add('rack-behind-doors');

      const overlay = document.createElement('div');
      overlay.className = 'rack-door-overlay';
      overlay.innerHTML = `
        <div class="rack-door rack-door-left">
          <div class="rack-door-handle"></div>
        </div>
        <div class="rack-door-text">ACCESSING IDF-101...</div>
        <div class="rack-door rack-door-right">
          <div class="rack-door-handle"></div>
        </div>
      `;
      container.appendChild(overlay);

      if (reducedMotion) {
        // Instant reveal
        overlay.remove();
        wrapper.classList.remove('rack-behind-doors');
      } else {
        // Text shows for 800ms, then doors swing open
        setTimeout(() => {
          overlay.classList.add('rack-doors-opening');
          wrapper.classList.add('rack-reveal');
        }, 800);

        // Clean up after animation completes
        setTimeout(() => {
          overlay.remove();
          wrapper.classList.remove('rack-behind-doors', 'rack-reveal');
        }, 2200);
      }
    }

    // (LED animation offsets removed — all LEDs are now JS-driven, no CSS animations)

    // Build topology graph (always, needed for packet pathfinding)
    this._graph = this._buildGraph();

    // Zoom to fit first, then render cables (cables need final scaled positions)
    if (this._dualMode) {
      requestAnimationFrame(() => {
        this._applyZoomToFit(wrapper);
        // Cables render after zoom so getBoundingClientRect is in final space
        requestAnimationFrame(() => {
          this._renderCables(wrapper);
          if (!this._reducedMotion) {
            this._startCloudRain();
            this._startThreatTraffic();
            this._startIdleAnimations();
            if (this._badgePool.length > 0 && !this._wfqRunning) {
              if (!this._animateFromEmpty) {
                // Returning from view switch — seed TTLs from existing DOM panels
                this._seedWfqFromDOM();
              }
              this._startWfq();
            }
          }
        });
      });
    }

    // Resize observer — debounced, only act on significant size changes
    // Small changes (badge port added) should NOT cancel in-flight packets
    this._lastResizeWidth = 0;
    this._lastResizeHeight = 0;
    this._resizeDebounce = null;
    this._resizeObserver = new ResizeObserver((entries) => {
      if (!this._cableSvg || !this._dualMode) return;
      const entry = entries[0];
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      // Ignore small height changes (< 20px) caused by badge placement
      const dw = Math.abs(w - this._lastResizeWidth);
      const dh = Math.abs(h - this._lastResizeHeight);
      if (dw < 5 && dh < 20) return;
      this._lastResizeWidth = w;
      this._lastResizeHeight = h;
      // Debounce: wait 500ms for resize to settle
      clearTimeout(this._resizeDebounce);
      this._resizeDebounce = setTimeout(() => {
        this._cancelAllPackets();
        this._updateCablePaths(wrapper);
      }, 500);
    });
    this._resizeObserver.observe(wrapper);

    // Window resize → recalc zoom-to-fit, then recalc cable positions
    this._zoomWrapper = wrapper;
    this._onWindowResize = () => {
      this._applyZoomToFit(wrapper);
      // Cables need recalc after zoom settles
      requestAnimationFrame(() => {
        if (this._cableSvg) {
          this._cancelAllPackets();
          this._updateCablePaths(wrapper);
        }
      });
    };
    window.addEventListener('resize', this._onWindowResize);
  },

  _addRackEars(el) {
    const is2U = el.classList.contains('rack-device-2u');
    ['left', 'right'].forEach(side => {
      const ear = document.createElement('div');
      ear.className = `rack-ear rack-ear-${side}${is2U ? ' rack-ear-2u' : ''}`;
      if (is2U) {
        // U-shaped bracket: screw → slot → screw
        ear.innerHTML = '<div class="rack-ear-screw"></div><div class="rack-ear-slot"></div><div class="rack-ear-screw"></div>';
      } else {
        // Simple L-ear: single screw
        ear.innerHTML = '<div class="rack-ear-screw"></div>';
      }
      el.appendChild(ear);
    });
  },

  _renderRack(devices, locationId, label, execBadges, coreSide) {
    const frame = document.createElement('div');
    frame.className = 'rack-frame';
    frame.setAttribute('data-rack-id', locationId);

    // Rails
    frame.innerHTML = `
      <div class="rack-rail rack-rail-left"></div>
      <div class="rack-rail rack-rail-right"></div>
    `;

    // Label
    const labelEl = document.createElement('div');
    labelEl.className = 'rack-frame-label';
    labelEl.innerHTML = `
      <span class="rack-frame-label-name">${esc(label)}</span>
      <span>${esc(locationId)}</span>
    `;
    frame.appendChild(labelEl);

    // Firewall (above core switch)
    frame.appendChild(this._renderFirewall(coreSide));

    // Core switch
    frame.appendChild(this._renderCoreSwitch(execBadges, coreSide));

    // Devices
    devices.forEach(device => {
      switch (device.type) {
        case 'switch':
          frame.appendChild(this._renderSwitch(device));
          break;
        case 'patch':
          frame.appendChild(this._renderPatchPanel(device));
          break;
        case 'storage':
          frame.appendChild(this._renderStorageArray());
          break;
        case 'brs':
          frame.appendChild(this._renderBRS(device.id || 'brs-01'));
          break;
        case 'vpn':
          frame.appendChild(this._renderVPN());
          break;
        case 'cable':
          frame.appendChild(this._renderCableMgmt());
          break;
        case 'blank':
          frame.appendChild(this._renderBlank());
          break;
        case 'wlc':
          frame.appendChild(this._renderWLC());
          break;
        case 'ups':
          frame.appendChild(this._renderUPS(device));
          break;
      }
    });

    // Add rack ears to all devices (except blanks and cable mgmt)
    frame.querySelectorAll('.rack-device').forEach(d => {
      if (!d.classList.contains('rack-device-blank') && !d.classList.contains('rack-device-cable-mgmt')) {
        this._addRackEars(d);
      }
    });

    return frame;
  },

  // ─── Above-Rack Devices ─────────────────────────────────

  _renderInternetCloud(side) {
    const el = document.createElement('div');
    el.className = 'rack-internet-cloud';
    el.setAttribute('data-device-type', 'cloud');
    el.setAttribute('data-cloud-side', side);
    // SVG cloud shape — proper bumpy silhouette
    el.innerHTML = `
      <svg class="rack-cloud-svg" viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg">
        <path class="rack-cloud-fill" d="M30,50 Q10,50 10,38 Q10,28 20,25 Q18,15 28,12 Q38,5 50,10 Q55,3 68,6 Q78,2 88,10 Q100,8 105,20 Q115,22 112,35 Q115,48 100,50 Z"/>
        <text x="60" y="36" text-anchor="middle" class="rack-cloud-text">INTERNET</text>
      </svg>
      <div class="rack-cloud-anchor" data-port-id="cloud-${side.toLowerCase()}-out"></div>
    `;
    return el;
  },

  _renderFirewall(side) {
    const el = document.createElement('div');
    el.className = 'rack-device rack-device-firewall rack-device-1u';
    el.setAttribute('data-device-type', 'firewall');
    el.setAttribute('data-fw-side', side);

    const label = side === 'A' ? 'FW-A' : 'FW-B';

    // Port groups: WAN | Core cross-connects + HA | empties
    const sideL = side.toLowerCase();
    let portsHtml = '<div class="rack-switch-ports">';
    portsHtml += '<div class="rack-fw-port-group">';
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-fw-port-wan" data-port-id="fw-${sideL}-wan" title="WAN"></div>`;
    portsHtml += '</div>';
    portsHtml += '<div class="rack-fw-port-divider"></div>';
    portsHtml += '<div class="rack-fw-port-group">';
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-fw-port-core rack-port-group-${side === 'A' ? 2 : 5}" data-port-id="fw-${sideL}-core" title="Core ${side}"></div>`;
    portsHtml += '<div class="rack-conn-port rack-conn-port-active rack-fw-port-core" title="Core B"></div>';
    portsHtml += '<div class="rack-conn-port rack-conn-port-active rack-fw-port-ha" title="HA Link"></div>';
    portsHtml += '</div>';
    portsHtml += '<div class="rack-fw-port-divider"></div>';
    portsHtml += '<div class="rack-fw-port-group">';
    for (let i = 0; i < 4; i++) {
      portsHtml += '<div class="rack-conn-port"></div>';
    }
    portsHtml += '</div>';
    portsHtml += '</div>';

    el.innerHTML = `
      <div class="rack-device-accent rack-fw-accent"></div>
      <div class="rack-fw-fans">
        <div class="rack-fw-fan rack-fw-fan-1"></div>
        <div class="rack-fw-fan rack-fw-fan-2"></div>
      </div>
      <div class="rack-device-header">
        <span class="rack-device-name rack-fw-name">${label}</span>
        <span class="rack-device-model">CatchFire ASA-5525</span>
        <div class="rack-fw-threat">
          <span class="rack-fw-threat-icon">&#9888;</span>
          <span class="rack-fw-threat-count" data-fw-threats="${side}">0</span>
        </div>
        <div class="rack-switch-leds">
          <div class="rack-switch-led rack-fw-led-pwr"></div>
          <div class="rack-switch-led rack-fw-led-act"></div>
          <div class="rack-switch-led rack-fw-led-ha"></div>
        </div>
      </div>
      ${portsHtml}
    `;

    return el;
  },

  _renderWiFiAP() {
    const el = document.createElement('div');
    el.className = 'rack-device-wifi';
    el.setAttribute('data-device-type', 'wifi');

    // WiFi icon + SSID above, Linksys body sits on rack
    el.innerHTML = `
      <div class="rack-wifi-label">
        <svg class="rack-wifi-icon" viewBox="0 0 100 60" width="100" height="60">
          <!-- Outer arc -->
          <path class="rack-wifi-arc rack-wifi-arc-3" d="M10 48 A45 45 0 0 1 90 48" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
          <!-- Middle arc -->
          <path class="rack-wifi-arc rack-wifi-arc-2" d="M24 50 A30 30 0 0 1 76 50" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
          <!-- Inner arc -->
          <path class="rack-wifi-arc rack-wifi-arc-1" d="M37 52 A16 16 0 0 1 63 52" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="rack-wifi-router">
        <div class="rack-wifi-antennas">
          <div class="rack-wifi-antenna rack-wifi-ant-l"></div>
          <div class="rack-wifi-antenna rack-wifi-ant-c"></div>
          <div class="rack-wifi-antenna rack-wifi-ant-r"></div>
        </div>
        <div class="rack-wifi-body-box">
          <div class="rack-wifi-top-half">
            <div class="rack-wifi-led-row">
              <div class="rack-wifi-led rack-wifi-led-pwr"></div>
              <div class="rack-wifi-led rack-wifi-led-wlan"></div>
              <div class="rack-wifi-led rack-wifi-led-eth"></div>
              <div class="rack-wifi-led rack-wifi-led-act"></div>
            </div>
          </div>
          <div class="rack-wifi-bottom-half">
            <span class="rack-wifi-brand">LINKSYS</span>
          </div>
        </div>
        <div class="rack-wifi-cable-anchor" data-port-id="wifi-ap-eth"></div>
      </div>
    `;

    return el;
  },

  // ─── Rack Device Renderers ─────────────────────────────

  _renderCoreSwitch(execBadges, side) {
    const el = document.createElement('div');
    el.className = 'rack-device rack-device-core rack-device-1u';
    el.setAttribute('data-device-type', 'core');
    el.setAttribute('data-core-side', side);

    const coreLabel = side === 'A' ? 'CORE A' : 'CORE B';

    // Band member portraits (center, horizontal) — both cores get same slot count for alignment
    let membersHtml = '';
    if (execBadges && execBadges.length > 0) {
      const slotCount = Math.ceil(execBadges.length / 2); // 3 slots per core
      const myMembers = side === 'A' ? execBadges.slice(0, slotCount) : execBadges.slice(slotCount);

      membersHtml = '<div class="rack-core-ports">';
      for (let i = 0; i < slotCount; i++) {
        if (i < myMembers.length) {
          const b = myMembers[i];
          membersHtml += `
            <div class="rack-core-port" data-employee-id="${esc(b.employeeId)}" title="${esc(b.name)}">
              <img src="/api/badge/${esc(b.employeeId)}/headshot" alt="${esc(b.name)}" loading="lazy"
                onerror="this.style.display='none'">
            </div>
          `;
        } else {
          membersHtml += '<div class="rack-core-port rack-core-port-empty"></div>';
        }
      }
      membersHtml += '</div>';
    }

    // Port assignments per core switch side (8 ports each, 16 total — Crisco 9500-24Y4C)
    // Trunks at inner edges (Core A right 6-8, Core B left 1-3) for clean cross-rack cabling
    // Core A left:  WLC(1), BRS-out(2), BRS-in(3), FW-A(4), spare(5-8)
    // Core A right: spare(1-3), IT(4), Punk(5), trunk-3(6), trunk-BA(7), trunk-AB(8)
    // Core B left:  trunk-AB(1), trunk-BA(2), trunk-3(3), VPN(4), FW-B(5), BRS02-in(6), BRS02-out(7), spare(8)
    // Core B right: spare(1-6), Office(7), Corporate(8)
    const portMap = side === 'A'
      ? { left: ['wlc-uplink', 'brs-outbound', 'brs-inbound', 'fw-a-uplink', 'spare', 'spare', 'spare', 'spare'], right: ['spare', 'spare', 'spare', 'it-uplink', 'punk-uplink', 'trunk-3', 'trunk-ba', 'trunk-ab'] }
      : { left: ['trunk-ab', 'trunk-ba', 'trunk-3', 'vpn-uplink', 'fw-b-uplink', 'brs02-inbound', 'brs02-outbound', 'spare'], right: ['spare', 'spare', 'spare', 'spare', 'spare', 'spare', 'office-uplink', 'corporate-uplink'] };

    // Left trunk ports (8) — connected ports get dual LEDs with group animation
    let leftPortsHtml = '<div class="rack-switch-ports rack-core-ports-left">';
    const coreSeed = side === 'A' ? 0 : 4;
    portMap.left.forEach((id, idx) => {
      const connected = id !== 'spare';
      const cls = connected ? 'rack-conn-port-active rack-conn-port-dual' : '';
      const group = connected ? ` rack-port-group-${(coreSeed + idx * 3) % 8}` : '';
      leftPortsHtml += `<div class="rack-conn-port rack-conn-port-trunk ${cls}${group}" data-port-id="core-${side.toLowerCase()}-${id}"></div>`;
    });
    leftPortsHtml += '</div>';

    // Right trunk ports (8)
    let rightPortsHtml = '<div class="rack-switch-ports rack-core-ports-right">';
    portMap.right.forEach((id, idx) => {
      const connected = id !== 'spare';
      const cls = connected ? 'rack-conn-port-active rack-conn-port-dual' : '';
      const group = connected ? ` rack-port-group-${(coreSeed + 2 + idx * 3) % 8}` : '';
      rightPortsHtml += `<div class="rack-conn-port rack-conn-port-trunk ${cls}${group}" data-port-id="core-${side.toLowerCase()}-${id}"></div>`;
    });
    rightPortsHtml += '</div>';

    el.innerHTML = `
      <div class="rack-device-accent"></div>
      <div class="rack-core-layout">
        <div class="rack-core-left">
          <div class="rack-device-header">
            <span class="rack-device-name">${coreLabel}</span>
            <span class="rack-device-model">Crisco 9500-16X</span>
          </div>
          ${leftPortsHtml}
        </div>
        ${membersHtml}
        <div class="rack-core-right">
          ${rightPortsHtml}
        </div>
        <span class="rack-core-silkscreen">CRISCO</span>
        <div class="rack-switch-leds rack-core-leds">
          <div class="rack-switch-led rack-led-solid-green" title="SYST"></div>
          <div class="rack-switch-led rack-led-blink-gold" title="ACT"></div>
          <div class="rack-switch-led rack-led-solid-green" title="STCK"></div>
        </div>
      </div>
    `;

    return el;
  },

  _renderSwitch(device) {
    const el = document.createElement('div');
    const isHighDensity = (device.totalPorts || 12) > 12;
    el.className = `rack-device rack-device-switch rack-device-1u${isHighDensity ? ' rack-switch-hd' : ''}`;
    el.setAttribute('data-device-type', 'switch');
    el.setAttribute('data-theme', device.theme);

    // Row of switch ports — all start dark, light up as badges arrive (or pre-lit for existing badges)
    const totalPorts = device.totalPorts || 12;
    const employeePorts = device.portCount; // already capped at 12
    const themeSlug = device.theme.replace('_', '');
    // Seed from theme name for deterministic cross-switch group distribution
    const switchSeed = Array.from(device.theme).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
    let portsHtml = '<div class="rack-switch-ports">';
    for (let i = 0; i < totalPorts; i++) {
      if (i > 0 && i % 4 === 0) portsHtml += '<div class="rack-switch-port-divider"></div>';
      const isActive = i < employeePorts;
      const patternB = i % 2 === 1 ? ' rack-led-pattern-b' : '';
      const group = isActive ? ` rack-port-group-${((Math.abs(switchSeed) * 7 + i * 3) % 8)}` : '';
      portsHtml += `<div class="rack-conn-port ${isActive ? 'rack-conn-port-active rack-conn-port-dual' : ''}${patternB}${group}" data-switch-port="${i}"></div>`;
    }
    // SFP trunk ports (right side, separated by divider)
    const sfpGroup = `rack-port-group-${((Math.abs(switchSeed) * 7 + 13) % 8)}`;
    portsHtml += '<div class="rack-switch-port-divider rack-switch-sfp-divider"></div>';
    portsHtml += `<div class="rack-conn-port rack-conn-port-trunk rack-switch-sfp" data-port-id="sw-${themeSlug}-core-uplink" title="Core Uplink"></div>`;
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-conn-port-trunk rack-switch-sfp ${sfpGroup}" data-port-id="sw-${themeSlug}-spare" title="Spare"></div>`;
    portsHtml += '</div>';

    el.innerHTML = `
      <div class="rack-device-accent" style="background:${device.color}"></div>
      <div class="rack-device-header">
        <span class="rack-device-name" style="color:${device.color}">${esc(device.name)}</span>
        <span class="rack-device-model">Crisco 2960X</span>
        <div class="rack-switch-leds">
          <div class="rack-switch-led rack-led-solid" style="background:${device.color}" title="SYST"></div>
          <div class="rack-switch-led rack-led-slow-blink" style="background:${device.color}" title="STAT"></div>
          <div class="rack-switch-led rack-led-solid-green" title="SPD"></div>
        </div>
      </div>
      ${portsHtml}
    `;

    return el;
  },

  _renderWLC() {
    const el = document.createElement('div');
    el.className = 'rack-device rack-device-wlc rack-device-1u';
    el.setAttribute('data-device-type', 'wlc');

    // Dynamic AP count: 3 APs per employee
    const apCount = Math.max(1, this._allBadges.length * 3);

    let portsHtml = '<div class="rack-switch-ports">';
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-conn-port-trunk rack-port-group-1" data-port-id="wlc-core-uplink" title="Core Uplink"></div>`;
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-wlc-port-ap rack-port-group-4" data-port-id="wlc-ap-uplink" title="AP Mgmt"></div>`;
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-wlc-port-ap rack-port-group-6" title="AP Mgmt"></div>`;
    for (let i = 0; i < 5; i++) {
      portsHtml += '<div class="rack-conn-port"></div>';
    }
    portsHtml += '</div>';

    el.innerHTML = `
      <div class="rack-device-accent rack-wlc-accent"></div>
      <div class="rack-device-header">
        <span class="rack-device-name rack-wlc-name">WIRELESS CONTROLLER</span>
        <span class="rack-device-model">Crisco AIR-CT5520</span>
        <div class="rack-wlc-status">
          <span class="rack-wlc-ap-count" data-wlc-aps>${apCount} APs</span>
        </div>
        <div class="rack-switch-leds">
          <div class="rack-switch-led rack-led-solid-green" title="PWR"></div>
          <div class="rack-switch-led rack-led-solid-green" title="RADIO"></div>
          <div class="rack-switch-led rack-led-off" title="ALM"></div>
        </div>
      </div>
      ${portsHtml}
    `;

    return el;
  },

  _renderPatchPanel(device) {
    // 1U = 12 ports. Show first 12 employees, rest handled by pool rotation (Phase 3).
    const totalPorts = 12;
    const filledCount = Math.min(device.employees.length, totalPorts);
    const el = document.createElement('div');
    el.className = `rack-device rack-device-patch rack-device-${device.uSize}u`;
    el.setAttribute('data-device-type', 'patch');
    el.setAttribute('data-panel-key', device.panelKey);
    el.setAttribute('data-theme', device.theme);

    // Build rows of 12 ports each
    let rowsHtml = '';
    for (let row = 0; row < device.uSize; row++) {
      rowsHtml += '<div class="rack-port-row">';
      for (let col = 0; col < 12; col++) {
        const idx = row * 12 + col;
        if (idx < filledCount) {
          rowsHtml += this._createPortHtml(device.employees[idx]);
        } else {
          rowsHtml += '<div class="rack-port rack-port-empty"></div>';
        }
      }
      rowsHtml += '</div>';
    }

    el.innerHTML = `
      <div class="rack-device-accent" style="background:${device.color}"></div>
      <div class="rack-patch-label">${esc(device.name)}</div>
      ${rowsHtml}
    `;

    return el;
  },


  _renderStorageArray() {
    const el = document.createElement('div');
    el.className = 'rack-device rack-device-storage rack-device-2u';
    el.setAttribute('data-device-type', 'storage');

    // 24 drive bays (2 rows of 12) with long-cycle LED animation at random phase
    let baysHtml = '<div class="rack-storage-bay-grid">';
    for (let col = 0; col < 4; col++) {
      baysHtml += '<div class="rack-storage-bay-col">';
      for (let row = 0; row < 4; row++) {
        const i = col * 4 + row;
        const actLed = 'active';
        baysHtml += `
          <div class="rack-storage-bay rack-storage-bay-occupied" data-bay="${i}">
            <div class="rack-storage-bay-leds">
              <div class="rack-storage-led-activity ${actLed}"></div>
              <div class="rack-storage-led-fault"></div>
            </div>
            <div class="rack-storage-bay-tab"></div>
          </div>
        `;
      }
      baysHtml += '</div>';
    }
    baysHtml += '</div>';

    // Dynamic stats
    const iops = 12400 + Math.floor(Math.random() * 8000);
    const usedTB = (14.2 + Math.random() * 6).toFixed(1);
    const totalTB = '38.4';

    el.innerHTML = `
      <div class="rack-device-accent rack-storage-accent"></div>
      <div class="rack-device-header">
        <span class="rack-device-name rack-storage-name">NEWBTANIX</span>
        <span class="rack-device-model">NX-3060-G7</span>
        <div class="rack-switch-leds">
          <div class="rack-switch-led rack-led-solid-green" title="PWR"></div>
          <div class="rack-switch-led rack-led-solid-green" title="HEALTH"></div>
          <div class="rack-switch-led rack-led-blink-blue" title="LOC"></div>
        </div>
      </div>
      <div class="rack-storage-body">
        ${baysHtml}
      </div>
    `;

    return el;
  },

  _brsDevices: new Map(),

  _renderBRS(id = 'brs-01') {
    const el = document.createElement('div');
    el.className = `rack-device rack-device-brs rack-device-${id} rack-device-1u`;
    el.setAttribute('data-device-type', 'brs');
    el.setAttribute('data-brs-id', id);

    const label = id.toUpperCase();
    const uplinkId = id === 'brs-01' ? 'brs-core-uplink' : 'brs-02-core-uplink';
    const outboundId = id === 'brs-01' ? 'brs-core-outbound' : 'brs-02-core-outbound';

    const barCount = 40;
    let barsHtml = '<div class="rack-brs-bars">';
    for (let i = 0; i < barCount; i++) {
      barsHtml += '<div class="rack-brs-bar" style="height:4%"></div>';
    }
    barsHtml += '</div>';

    el.innerHTML = `
      <div class="rack-device-accent rack-brs-accent"></div>
      <div class="rack-brs-layout">
        <div class="rack-brs-left">
          <div class="rack-device-header">
            <span class="rack-device-name rack-brs-name">${label}</span>
            <span class="rack-device-model">Mediocore RX-1000</span>
          </div>
          <div class="rack-brs-controls">
            <div class="rack-switch-ports">
              <div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-conn-port-trunk rack-port-group-3" data-port-id="${uplinkId}" title="Core Inbound"></div>
              <div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-conn-port-trunk rack-port-group-7" data-port-id="${outboundId}" title="Core Outbound"></div>
            </div>
            <div class="rack-switch-leds rack-brs-leds">
              <div class="rack-switch-led rack-led-solid-green" title="PWR"></div>
              <div class="rack-switch-led rack-brs-led-render" title="RENDER"></div>
              <div class="rack-switch-led rack-brs-led-queue" title="QUEUE"></div>
            </div>
            <span class="rack-brs-throughput">0 j/m</span>
          </div>
        </div>
        <div class="rack-brs-lcd">
          <div class="rack-brs-lcd-header">IDLE</div>
          ${barsHtml}
          <div class="rack-brs-lcd-scanlines"></div>
        </div>
      </div>
    `;

    // Store refs per-device
    this._brsDevices.set(id, {
      el,
      bars: el.querySelectorAll('.rack-brs-bar'),
      header: el.querySelector('.rack-brs-lcd-header'),
      throughput: el.querySelector('.rack-brs-throughput'),
      renderLed: el.querySelector('.rack-brs-led-render'),
      queueLed: el.querySelector('.rack-brs-led-queue'),
      rendering: false,
      jobCount: 0,
    });

    // Backward compat — keep single-device refs for BRS-01
    if (id === 'brs-01') {
      this._brsEl = el;
      this._brsBars = el.querySelectorAll('.rack-brs-bar');
      this._brsHeader = el.querySelector('.rack-brs-lcd-header');
      this._brsThroughput = el.querySelector('.rack-brs-throughput');
      this._brsRenderLed = el.querySelector('.rack-brs-led-render');
      this._brsQueueLed = el.querySelector('.rack-brs-led-queue');
      this._brsRendering = false;
      this._brsJobCount = 0;
    }

    return el;
  },

  /**
   * Trigger a badge render on the BRS LCD.
   * Called by Phase 2c packet routing, or demo mode.
   * @param {object} badge - { employeeId, song }
   */
  /**
   * Trigger a badge render on the BRS LCD.
   * Shows full waveform instantly, sweeps a playhead cursor across.
   * @param {object} badge - { employeeId, song }
   * @param {number} [duration=3000] - Render duration in ms (2000-5000)
   */
  triggerBRSRender(badge, duration, brsId = 'brs-01') {
    const dev = this._brsDevices.get(brsId);
    if (!dev || !dev.bars || dev.rendering) return;
    dev.rendering = true;
    dev.jobCount++;

    const renderMs = duration || 3000;
    const song = badge.song || 'PLEASE HOLD';
    const empId = badge.employeeId || 'HD-00000';
    const wf = (typeof WAVEFORMS !== 'undefined' && WAVEFORMS[song]) || null;
    const barCount = dev.bars.length;

    // Resample 60-bar waveform data to our bar count
    let targetHeights;
    if (wf && wf.data) {
      targetHeights = [];
      for (let i = 0; i < barCount; i++) {
        const srcIdx = (i / barCount) * wf.data.length;
        const lo = Math.floor(srcIdx);
        const hi = Math.min(lo + 1, wf.data.length - 1);
        const frac = srcIdx - lo;
        const val = wf.data[lo] * (1 - frac) + wf.data[hi] * frac;
        targetHeights.push(Math.max(6, val * 92));
      }
    } else {
      targetHeights = [];
      for (let i = 0; i < barCount; i++) {
        targetHeights.push(20 + Math.sin(i * 0.4) * 30 + Math.random() * 25);
      }
    }

    // Update header + LEDs
    dev.header.textContent = `${empId} ► ${song}`;
    dev.renderLed.classList.add('rack-brs-led-active');
    dev.throughput.textContent = `${dev.jobCount} j/m`;

    // Show full waveform instantly
    dev.bars.forEach((bar, i) => {
      bar.style.height = `${targetHeights[i]}%`;
    });

    // Add playhead element
    const lcd = dev.el.querySelector('.rack-brs-bars');
    let playhead = lcd.querySelector('.rack-brs-playhead');
    if (!playhead) {
      playhead = document.createElement('div');
      playhead.className = 'rack-brs-playhead';
      lcd.appendChild(playhead);
    }

    // Animate playhead sweep
    playhead.style.transition = 'none';
    playhead.style.left = '0%';
    playhead.classList.add('rack-brs-playhead-active');
    // Force reflow to reset animation
    playhead.offsetWidth;
    playhead.style.transition = `left ${renderMs}ms linear`;
    playhead.style.left = '100%';

    // When sweep completes, fade to idle
    setTimeout(() => this._brsToIdle(playhead, brsId), renderMs + 200);
  },

  _brsToIdle(playhead, brsId = 'brs-01') {
    const dev = this._brsDevices.get(brsId);
    if (!dev || !dev.bars) return;

    // Hide playhead
    if (playhead) playhead.classList.remove('rack-brs-playhead-active');

    // Fade bars down
    dev.bars.forEach((bar, i) => {
      setTimeout(() => { bar.style.height = '4%'; }, i * 15);
    });

    setTimeout(() => {
      dev.header.textContent = 'IDLE';
      dev.renderLed.classList.remove('rack-brs-led-active');
      dev.rendering = false;
    }, dev.bars.length * 15 + 200);
  },

  _renderVPN() {
    const el = document.createElement('div');
    el.className = 'rack-device rack-device-vpn rack-device-1u';
    el.setAttribute('data-device-type', 'vpn');

    let portsHtml = '<div class="rack-switch-ports">';
    // 2 uplink ports (to core) + 1 tunnel port + 1 downlink (to contractor switch) + empties
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-conn-port-trunk rack-port-group-0" data-port-id="vpn-core-uplink" title="Core Uplink"></div>`;
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-vpn-port-tunnel rack-port-group-5" title="IPsec Tunnel"></div>`;
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-port-group-2" data-port-id="vpn-contractor-downlink" title="SW-CTR"></div>`;
    for (let i = 0; i < 5; i++) {
      portsHtml += '<div class="rack-conn-port"></div>';
    }
    portsHtml += '</div>';

    el.innerHTML = `
      <div class="rack-device-accent" style="background:#2563EB"></div>
      <div class="rack-device-header">
        <span class="rack-device-name" style="color:#2563EB">VPN CONCENTRATOR</span>
        <span class="rack-device-model">CatchFire VPN-3030</span>
        <div class="rack-vpn-status">
          <span class="rack-vpn-tunnel-icon">&#128274;</span>
          <span class="rack-vpn-tunnel-label">TUNNEL UP</span>
        </div>
        <div class="rack-switch-leds">
          <div class="rack-switch-led rack-led-solid-green" title="PWR"></div>
          <div class="rack-switch-led rack-led-solid" style="background:#2563EB" title="VPN"></div>
          <div class="rack-switch-led rack-led-slow-blink" style="background:var(--accent-green)" title="ETH"></div>
        </div>
      </div>
      ${portsHtml}
    `;

    return el;
  },

  _renderCableMgmt() {
    const el = document.createElement('div');
    el.className = 'rack-device rack-device-cable-mgmt rack-device-1u';
    el.setAttribute('data-device-type', 'cable');

    // Cable management fingers with center D-ring
    let fingersHtml = '<div class="rack-cable-fingers">';
    for (let i = 0; i < 20; i++) {
      if (i === 10) {
        fingersHtml += '<div class="rack-cable-ring"></div>';
      }
      fingersHtml += '<div class="rack-cable-finger"></div>';
    }
    fingersHtml += '</div>';

    el.innerHTML = fingersHtml;
    return el;
  },

  _renderBlank() {
    const el = document.createElement('div');
    el.className = 'rack-device rack-device-blank rack-device-1u';
    el.innerHTML = `
      <div class="rack-blank-screws">
        <div class="rack-blank-screw"></div>
        <div class="rack-blank-screw"></div>
      </div>
    `;
    return el;
  },

  _renderUPS(device) {
    const el = document.createElement('div');
    el.className = 'rack-device rack-device-ups rack-device-1u';
    el.setAttribute('data-device-type', 'ups');

    const load = 15 + Math.floor(Math.random() * 25);
    const voltage = 120 + Math.floor(Math.random() * 3);
    const freq = (59.9 + Math.random() * 0.2).toFixed(1);
    const temp = (22 + Math.floor(Math.random() * 6));

    const ipOctet = 100 + (device.pct % 50);
    const ip = `10.0.1.${ipOctet}`;
    const macSuffix = device.pct.toString(16).padStart(2, '0').toUpperCase();
    const mac = `00:1B:44:11:3A:${macSuffix}`;

    const lcdOffset = (Math.random() * 12).toFixed(1);


    el.innerHTML = `
      <div class="rack-device-header">
        <span class="rack-device-name">EATEN 5PX</span>
        <span class="rack-device-model">Eaten 5PX-UPS</span>
      </div>
      <div class="rack-ups-body">
        <div class="rack-ups-lcd">
          <div class="rack-ups-lcd-screen" style="--lcd-offset:-${lcdOffset}s">
            <div class="rack-ups-lcd-page rack-ups-lcd-page-1">${voltage}V &nbsp; ${load}% LOAD</div>
            <div class="rack-ups-lcd-page rack-ups-lcd-page-2">BAT: ${device.pct}% &nbsp; ${device.runtime}min</div>
            <div class="rack-ups-lcd-page rack-ups-lcd-page-3">${freq}Hz &nbsp; ${temp}&deg;C</div>
            <div class="rack-ups-lcd-page rack-ups-lcd-page-4">${ip} &nbsp; ${mac}</div>
          </div>
        </div>
        <div class="rack-ups-leds">
          <div class="rack-ups-led rack-ups-led-on" title="Online"></div>
          <div class="rack-ups-led rack-ups-led-bat" title="Battery"></div>
          <div class="rack-ups-led rack-ups-led-fault" title="Fault"></div>
        </div>
      </div>
    `;

    return el;
  },

  // ─── Port Creation ──────────────────────────────────────

  _createPort(badge) {
    const el = document.createElement('div');
    el.className = 'rack-port';
    el.setAttribute('data-employee-id', badge.employeeId);
    el.innerHTML = this._portInnerHtml(badge);
    el.addEventListener('click', () => {
      if (typeof showBadgeDetail === 'function') {
        showBadgeDetail(badge.employeeId, badge.name);
      }
    });
    return el;
  },

  _createPortHtml(badge) {
    return `
      <div class="rack-port" data-employee-id="${esc(badge.employeeId)}"
           onclick="if(typeof showBadgeDetail==='function')showBadgeDetail('${esc(badge.employeeId)}','${esc(badge.name)}')">
        ${this._portInnerHtml(badge)}
      </div>
    `;
  },

  _portInnerHtml(badge) {
    return `
      <img src="/api/badge/${esc(badge.employeeId)}/headshot" alt="${esc(badge.name)}" loading="lazy"
        onerror="this.style.display='none'">
      <div class="rack-port-tooltip">
        <div class="rack-port-tooltip-name">${esc(badge.name)}</div>
        <div class="rack-port-tooltip-title">${esc(badge.title || '')}</div>
      </div>
    `;
  },

  // ─── SVG Cable Overlay ──────────────────────────────────

  // Cable definitions: [fromPortId, toPortId, color, width, routeType]
  // routeTypes: 'cross-rack', 'drop-left' (vertical drop nudged left of silkscreen),
  //   'arc-right' (swing outside right edge), 'arc-left' (swing outside left edge),
  //   'margin-right' (right gutter routing), 'margin-right-stagger' (staggered vertical entry)
  _CABLE_DEFS: [
    // Cross-rack trunks — 3 gold cables in the inter-rack gap, staggered by lane
    // A→B: Core A right trunk-AB → Core B left trunk-AB
    ['core-a-trunk-ab', 'core-b-trunk-ab', '#D4A843', 3, 'cross-rack'],
    // B→A: Core B left trunk-BA → Core A right trunk-BA
    ['core-b-trunk-ba', 'core-a-trunk-ba', '#D4A843', 3, 'cross-rack'],
    // Trunk 3 (bidirectional): Core A right trunk-3 → Core B left trunk-3
    ['core-a-trunk-3', 'core-b-trunk-3', '#D4A843', 3, 'cross-rack'],
    // FW → Core: short vertical drop, nudged left to avoid CRISCO silkscreen
    ['fw-a-core', 'core-a-fw-a-uplink', '#3B82F6', 2.5, 'drop-left'],
    ['fw-b-core', 'core-b-fw-b-uplink', '#3B82F6', 2.5, 'drop-left'],
    // BRS — dedicated inbound (Core port 3, inner) and outbound (Core port 2, outer)
    // Inbound: Core A port 3 → BRS, direct left-gutter route (inner, longer run)
    ['core-a-brs-inbound', 'brs-core-uplink', '#3B82F6', 2.5, 'margin-left-24'],
    // Outbound: BRS → Core A port 2, drops down into cable mgmt then left to gutter (outer, wider route)
    ['brs-core-outbound', 'core-a-brs-outbound', '#3B82F6', 2.5, 'margin-left-down'],
    // WLC → Core A: arc up left outside of rack
    ['wlc-core-uplink', 'core-a-wlc-uplink', '#3B82F6', 2.5, 'arc-left'],
    // WLC AP mgmt → WiFi AP: solid line, exit down first then up left gutter
    ['wlc-ap-uplink', 'wifi-ap-eth', '#22C55E', 2, 'margin-left-down'],
    // Rack A division switches → Core A right: nested routing (inner cable first, outer wraps around)
    ['core-a-it-uplink', 'sw-IT-spare', '#3B82F6', 2.5, 'margin-right-stagger', null, 42],
    ['core-a-punk-uplink', 'sw-Punk-spare', '#3B82F6', 2.5, 'margin-right-stagger'],
    // VPN → Core B left port 3: route through inter-rack gap
    ['vpn-core-uplink', 'core-b-vpn-uplink', '#3B82F6', 2.5, 'margin-left-24'],
    // Rack B division switches → Core B right: nested routing (inner first, outer wraps around)
    ['core-b-office-uplink', 'sw-Office-spare', '#3B82F6', 2.5, 'margin-right-stagger'],
    ['core-b-corporate-uplink', 'sw-Corporate-spare', '#3B82F6', 2.5, 'margin-right-stagger'],
    // VPN → Contractors: down from VPN, right gutter between UPS/switch, curve up to SFP
    ['vpn-contractor-downlink', 'sw-custom-spare', '#3B82F6', 2.5, 'under-and-up'],
    // Cloud → Firewalls: each rack has its own internet cloud
    ['cloud-a-out', 'fw-a-wan', '#5B8DEF', 1.5, 'cloud-drop', 'dashed'],
    ['cloud-b-out', 'fw-b-wan', '#5B8DEF', 1.5, 'cloud-drop', 'dashed'],
    // BRS-02 on Rack B — short straight drops (BRS-02 sits directly below Core B)
    ['core-b-brs02-inbound', 'brs-02-core-uplink', '#3B82F6', 2.5, 'drop-straight'],
    ['brs-02-core-outbound', 'core-b-brs02-outbound', '#3B82F6', 2.5, 'drop-straight'],
  ],

  // ─── Topology Graph ─────────────────────────────────────
  // Directed graph built from _CABLE_DEFS for packet pathfinding.
  // Nodes = devices, edges = cables (or virtual links for cloud/switch→patch).

  _TOPOLOGY_NODES: [
    'cloud-a', 'cloud-b', 'fw-a', 'fw-b', 'core-a', 'core-b', 'brs', 'brs-02', 'wlc', 'wifi-ap', 'vpn',
    'sw-IT', 'sw-Punk', 'sw-Office', 'sw-Corporate', 'sw-custom',
    'patch-IT', 'patch-Punk', 'patch-Office', 'patch-Corporate', 'patch-custom',
  ],

  // Map every data-port-id to its parent device node
  _PORT_TO_NODE: {
    'fw-a-wan': 'fw-a', 'fw-a-core': 'fw-a',
    'fw-b-wan': 'fw-b', 'fw-b-core': 'fw-b',
    'core-a-wlc-uplink': 'core-a', 'core-a-brs-outbound': 'core-a',
    'core-a-brs-inbound': 'core-a', 'core-a-fw-a-uplink': 'core-a',
    'core-a-it-uplink': 'core-a', 'core-a-punk-uplink': 'core-a',
    'core-a-trunk-ab': 'core-a', 'core-a-trunk-ba': 'core-a', 'core-a-trunk-3': 'core-a',
    'core-b-brs02-outbound': 'core-b', 'core-b-brs02-inbound': 'core-b',
    'core-b-vpn-uplink': 'core-b', 'core-b-fw-b-uplink': 'core-b',
    'core-b-office-uplink': 'core-b', 'core-b-corporate-uplink': 'core-b',
    'core-b-trunk-ab': 'core-b', 'core-b-trunk-ba': 'core-b', 'core-b-trunk-3': 'core-b',
    'sw-IT-core-uplink': 'sw-IT', 'sw-IT-spare': 'sw-IT',
    'sw-Punk-core-uplink': 'sw-Punk', 'sw-Punk-spare': 'sw-Punk',
    'sw-Office-core-uplink': 'sw-Office', 'sw-Office-spare': 'sw-Office',
    'sw-Corporate-core-uplink': 'sw-Corporate', 'sw-Corporate-spare': 'sw-Corporate',
    'sw-custom-core-uplink': 'sw-custom', 'sw-custom-spare': 'sw-custom',
    'wlc-core-uplink': 'wlc', 'wlc-ap-uplink': 'wlc',
    'brs-core-uplink': 'brs', 'brs-core-outbound': 'brs',
    'brs-02-core-uplink': 'brs-02', 'brs-02-core-outbound': 'brs-02',
    'core-b-brs02-inbound': 'core-b', 'core-b-brs02-outbound': 'core-b',
    'vpn-core-uplink': 'vpn', 'vpn-contractor-downlink': 'vpn',
    'wifi-ap-eth': 'wifi-ap',
    'cloud-a-out': 'cloud-a', 'cloud-b-out': 'cloud-b',
  },

  // Cable indices that are strictly one-way (cross-rack trunks + BRS in/out)
  _DIRECTIONAL_CABLES: new Set([0, 1, 5, 6, 17, 18]),

  // Per-cable speed overrides for dramatic pacing (display piece, not throughput)
  // Default is 0.4 (150px/sec). Lower = slower crawl.
  _CABLE_SPEEDS: {
    0: 0.2,   // cross-rack A→B — slow dramatic crawl
    1: 0.2,   // cross-rack B→A
    2: 0.2,   // cross-rack trunk 3 — same pacing as other trunks
    3: 0.3,   // FW-A → Core A — let FW inspect sink in
    4: 0.3,   // FW-B → Core B
    5: 0.35,  // Core A → BRS inbound — slight linger
    6: 0.35,  // BRS → Core A outbound
    9: 0.25,  // Core A → IT switch — let routing breathe
    10: 0.25, // Core A → Punk switch
    11: 0.4,  // Core B → VPN — faster handoff to concentrator
    12: 0.25, // Core B → Office switch
    13: 0.25, // Core B → Corporate switch
    14: 0.35, // VPN → Contractors — was 0.2 (scenic), sped up to reduce fill time
    17: 0.35, // Core B → BRS-02 inbound
    18: 0.35, // BRS-02 → Core B outbound
  },

  // Virtual edges: no physical cable, animated as short drops or invisible paths
  _VIRTUAL_EDGES: [
    // Cloud→FW and cloud→WiFi are now real cables (indices 14-16), no longer virtual
    { from: 'sw-IT', to: 'patch-IT', type: 'switch-drop' },
    { from: 'sw-Punk', to: 'patch-Punk', type: 'switch-drop' },
    { from: 'sw-Office', to: 'patch-Office', type: 'switch-drop' },
    { from: 'sw-Corporate', to: 'patch-Corporate', type: 'switch-drop' },
    { from: 'sw-custom', to: 'patch-custom', type: 'switch-drop' },
  ],

  _graph: null, // built on render, Map<nodeId, Edge[]>

  _buildGraph() {
    const graph = new Map();
    // Initialize all nodes
    this._TOPOLOGY_NODES.forEach(n => graph.set(n, []));

    // Add cable edges
    this._CABLE_DEFS.forEach(([fromPortId, toPortId], idx) => {
      const fromNode = this._PORT_TO_NODE[fromPortId];
      const toNode = this._PORT_TO_NODE[toPortId];
      if (!fromNode || !toNode) return;

      const edge = { from: fromNode, to: toNode, cableIndex: idx, type: 'cable' };
      graph.get(fromNode).push(edge);

      // Bidirectional cables get a reverse edge
      if (!this._DIRECTIONAL_CABLES.has(idx)) {
        graph.get(toNode).push({ from: toNode, to: fromNode, cableIndex: idx, type: 'cable' });
      }
    });

    // Add virtual edges (cloud→FW, switch→patch)
    this._VIRTUAL_EDGES.forEach(ve => {
      graph.get(ve.from).push({ from: ve.from, to: ve.to, cableIndex: null, type: ve.type });
    });

    return graph;
  },

  _findPath(graph, source, dest) {
    if (source === dest) return [];
    const visited = new Set([source]);
    // BFS queue: each entry is [currentNode, pathOfEdges]
    const queue = [[source, []]];

    while (queue.length > 0) {
      const [node, path] = queue.shift();
      const neighbors = graph.get(node);
      if (!neighbors) continue;

      for (const edge of neighbors) {
        if (visited.has(edge.to)) continue;
        const newPath = [...path, edge];
        if (edge.to === dest) return newPath;
        visited.add(edge.to);
        queue.push([edge.to, newPath]);
      }
    }

    return null; // no path found
  },

  _cableSvg: null,
  _cablePaths: null,     // Map<cableIndex, SVGPathElement>
  _cableBusy: null,      // Map<cableIndex, boolean>
  _activePackets: [],     // in-flight packet objects
  _animFrameId: null,     // requestAnimationFrame handle
  _lastAnimTime: 0,       // timestamp of last animation frame

  // ─── Packet Animation Engine ───────────────────────────

  _packetClipId: 0, // incrementing ID for unique clip-path references

  _createBadgePacket(badge, radius = 20) {
    // Round portrait photo with division-colored ring — travels along cables
    if (!this._cableSvg) return null;
    const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
    const ringColor = DIVISION_ACCENT_COLORS[divTheme] || '#ffffff';
    const id = `pkt-clip-${this._packetClipId++}`;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('rack-packet', 'rack-packet-badge');
    g.setAttribute('data-packet-type', 'badge');

    // Clip path for circular crop
    const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clipPath.setAttribute('id', id);
    const clipCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    clipCircle.setAttribute('r', radius);
    clipPath.appendChild(clipCircle);
    g.appendChild(clipPath);

    // Headshot image
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('href', `/api/badge/${badge.employeeId}/headshot`);
    img.setAttribute('x', -radius);
    img.setAttribute('y', -radius);
    img.setAttribute('width', radius * 2);
    img.setAttribute('height', radius * 2);
    img.setAttribute('clip-path', `url(#${id})`);
    img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    g.appendChild(img);

    // Glow layer — larger semi-transparent circle behind the ring (no filter needed)
    const glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    glow.setAttribute('r', radius + 4);
    glow.setAttribute('fill', 'none');
    glow.setAttribute('stroke', ringColor);
    glow.setAttribute('stroke-width', '3');
    glow.setAttribute('opacity', '0.3');
    g.appendChild(glow);

    // Ring border
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('r', radius);
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', ringColor);
    ring.setAttribute('stroke-width', '1.5');
    g.appendChild(ring);

    // Start hidden for materialization
    g.setAttribute('opacity', '0');
    this._cableSvg.appendChild(g);
    return g;
  },

  _createDotPacket(color = '#3B82F6', radius = 3.5, opacity = 0.5) {
    // Small anonymous dot for idle traffic
    if (!this._cableSvg) return null;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', radius);
    circle.setAttribute('fill', color);
    circle.setAttribute('opacity', String(opacity));
    circle.classList.add('rack-packet', 'rack-packet-dot');
    this._cableSvg.appendChild(circle);
    return circle;
  },

  _completeMove(packet) {
    // Move segment finished — resolve promise, clear busy, wake waiters
    if (packet.cableIndex != null && this._cableBusy) {
      this._cableBusy.set(packet.cableIndex, false);
      // Wake any packet waiting for this cable
      const waiter = this._cableWaiters?.get(packet.cableIndex);
      if (waiter) { waiter(); this._cableWaiters.delete(packet.cableIndex); }
    }
    const idx = this._activePackets.indexOf(packet);
    if (idx !== -1) this._activePackets.splice(idx, 1);
    if (packet.resolve) { packet.resolve(); packet.resolve = null; }
  },

  _removePacket(packet) {
    // Full cleanup — destroy SVG element and all state
    if (packet.el && packet.el.parentNode) {
      packet.el.remove();
    }
    // Clear cable busy flag + wake waiters
    if (packet.cableIndex != null && this._cableBusy) {
      this._cableBusy.set(packet.cableIndex, false);
      const waiter = this._cableWaiters?.get(packet.cableIndex);
      if (waiter) { waiter(); this._cableWaiters.delete(packet.cableIndex); }
    }
    // Remove from active list
    const idx = this._activePackets.indexOf(packet);
    if (idx !== -1) this._activePackets.splice(idx, 1);
    // Resolve promise if pending
    if (packet.resolve) packet.resolve();
  },

  // Wait for a cable to become free (promise-based, woken by _completeMove/_removePacket)
  async _waitForCable(cableIndex) {
    if (!this._cableBusy || !this._cableBusy.get(cableIndex)) return;
    if (!this._cableWaiters) this._cableWaiters = new Map();
    await Promise.race([
      new Promise(resolve => { this._cableWaiters.set(cableIndex, resolve); }),
      this._delay(10000), // timeout fallback
    ]);
    this._cableWaiters?.delete(cableIndex);
  },

  // One-way cables: only used in a single direction for badge ingress.
  // No collision risk, so skip busy-flag blocking to avoid unnecessary wait.
  _ONE_WAY_CABLES: new Set([
    9,  // core-a → sw-IT
    10, // core-a → sw-Punk
    11, // core-b → vpn
    12, // core-b → sw-Office
    13, // core-b → sw-Corporate
    14, // vpn → sw-custom
    15, // cloud-a → fw-a
    16, // cloud-b → fw-b
  ]),

  async _movePacketAlongCable(packet, cableIndex, fromNode, speed = 0.3) {
    // Skip busy-wait for one-way cables (no collision risk)
    if (!this._ONE_WAY_CABLES.has(cableIndex)) {
      await this._waitForCable(cableIndex);
    }

    // Moves packet along cable from fromNode toward the other end.
    // Direction is auto-detected by comparing SVG path start/end to cable def ports.
    const path = this._cablePaths && this._cablePaths.get(cableIndex);
    if (!path) return Promise.resolve();

    const def = this._CABLE_DEFS[cableIndex];
    const fromPortNode = this._PORT_TO_NODE[def[0]];
    const sampled = this._cablePathSamples?.get(cableIndex);
    const pathLen = sampled ? sampled.totalLen : path.getTotalLength();
    // Use pre-sampled start/end points instead of getPointAtLength
    const startPt = sampled
      ? { x: sampled.samples[0], y: sampled.samples[1] }
      : path.getPointAtLength(0);
    const endPt = sampled
      ? { x: sampled.samples[sampled.samples.length - 2], y: sampled.samples[sampled.samples.length - 1] }
      : path.getPointAtLength(pathLen);

    // Auto-detect direction
    const fromPortId = fromNode === fromPortNode ? def[0] : def[1];
    const fromEl = this._container && this._container.querySelector(`[data-port-id="${fromPortId}"]`);
    let direction = 1;
    if (fromEl) {
      const framesRow = this._container.querySelector('.rack-frames-row');
      if (framesRow) {
        const ref = framesRow.getBoundingClientRect();
        const port = this._toSvgCoords(fromEl.getBoundingClientRect(), ref);
        const distToStart = Math.hypot(startPt.x - port.x, startPt.y - port.y);
        const distToEnd = Math.hypot(endPt.x - port.x, endPt.y - port.y);
        direction = distToStart <= distToEnd ? 1 : -1;
      }
    }

    return new Promise(resolve => {
      packet.cableIndex = cableIndex;
      packet.progress = direction === 1 ? 0 : 1;
      const pxPerSec = 150 * speed / 0.4;
      packet.speed = pxPerSec / pathLen;
      packet.direction = direction;
      packet.resolve = resolve;
      packet.type = 'cable';
      packet.pathEl = path;
      packet.pathLength = pathLen;

      if (this._cableBusy && !this._ONE_WAY_CABLES.has(cableIndex)) {
        this._cableBusy.set(cableIndex, true);
      }

      if (!this._activePackets.includes(packet)) {
        this._activePackets.push(packet);
      }
      this._startAnimLoop();
    });
  },

  _movePacketVirtual(packet, x1, y1, x2, y2, duration = 1000) {
    // Linear interpolation between two points (for cloud drops, switch→patch)
    return new Promise(resolve => {
      packet.cableIndex = null;
      packet.type = 'virtual';
      packet.resolve = resolve;
      packet.vx1 = x1; packet.vy1 = y1;
      packet.vx2 = x2; packet.vy2 = y2;
      packet.progress = 0;
      packet.speed = 1000 / duration; // progress per second
      packet.direction = 1;

      // Set initial position
      packet.el.setAttribute('cx', x1);
      packet.el.setAttribute('cy', y1);

      if (!this._activePackets.includes(packet)) {
        this._activePackets.push(packet);
      }
      this._startAnimLoop();
    });
  },

  _startAnimLoop() {
    if (this._animFrameId) return; // already running
    this._lastAnimTime = 0;
    this._animFrameId = requestAnimationFrame(t => this._animLoop(t));
  },

  _animLoop(timestamp) {
    if (this._activePackets.length === 0) {
      this._animFrameId = null;
      return;
    }

    // Throttle to ~30fps — even with cheap lerp, halving frame count saves GPU compositing
    const elapsed = this._lastAnimTime ? (timestamp - this._lastAnimTime) : 16;
    if (this._lastAnimTime && elapsed < 33) {
      this._animFrameId = requestAnimationFrame(t => this._animLoop(t));
      return;
    }

    const dt = elapsed / 1000;
    this._lastAnimTime = timestamp;

    // Cap delta to prevent jumps after tab switch
    const clampedDt = Math.min(dt, 0.1);

    // Process packets in reverse so splice during removal is safe
    for (let i = this._activePackets.length - 1; i >= 0; i--) {
      const pkt = this._activePackets[i];
      pkt.progress += pkt.speed * pkt.direction * clampedDt;

      // Check completion — resolve the move promise but keep the SVG element alive
      const done = pkt.direction === 1 ? pkt.progress >= 1 : pkt.progress <= 0;
      if (done) {
        pkt.progress = pkt.direction === 1 ? 1 : 0;
        this._updatePacketPosition(pkt);
        this._completeMove(pkt);
        continue;
      }

      this._updatePacketPosition(pkt);
    }

    this._animFrameId = requestAnimationFrame(t => this._animLoop(t));
  },

  _updatePacketPosition(pkt) {
    let x, y;
    if (pkt.type === 'cable') {
      // Use pre-sampled path points with linear interpolation (no getPointAtLength)
      const sampled = this._cablePathSamples?.get(pkt.cableIndex);
      if (sampled) {
        const { samples } = sampled;
        const sampleCount = samples.length / 2;
        const t = Math.max(0, Math.min(1, pkt.progress)) * (sampleCount - 1);
        const idx = Math.floor(t);
        const frac = t - idx;
        const i0 = Math.min(idx, sampleCount - 1) * 2;
        const i1 = Math.min(idx + 1, sampleCount - 1) * 2;
        x = samples[i0] + (samples[i1] - samples[i0]) * frac;
        y = samples[i0 + 1] + (samples[i1 + 1] - samples[i0 + 1]) * frac;
      } else if (pkt.pathEl) {
        // Fallback if samples missing
        const pt = pkt.pathEl.getPointAtLength(pkt.progress * pkt.pathLength);
        x = pt.x; y = pt.y;
      } else return;
    } else if (pkt.type === 'virtual') {
      const t = pkt.progress;
      x = pkt.vx1 + (pkt.vx2 - pkt.vx1) * t;
      y = pkt.vy1 + (pkt.vy2 - pkt.vy1) * t;
    } else return;

    // Badge packets use <g> with transform, dot packets use <circle> with cx/cy
    if (pkt.el.tagName === 'g') {
      pkt.el.setAttribute('transform', `translate(${x},${y})`);
    } else {
      pkt.el.setAttribute('cx', x);
      pkt.el.setAttribute('cy', y);
    }
  },

  _cancelAllPackets() {
    // Remove all packet SVG elements and mark as cancelled
    for (const pkt of this._activePackets) {
      pkt._cancelled = true;
      if (pkt.el && pkt.el.parentNode) pkt.el.remove();
      if (pkt.resolve) pkt.resolve();
    }
    this._activePackets = [];
    // Clear all busy flags + wake all waiters
    if (this._cableBusy) {
      for (const key of this._cableBusy.keys()) {
        this._cableBusy.set(key, false);
      }
    }
    if (this._cableWaiters) {
      for (const resolve of this._cableWaiters.values()) resolve();
      this._cableWaiters.clear();
    }
    // Stop animation loop
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    this._lastAnimTime = 0;
  },

  // ─── Virtual Edge Coordinates ──────────────────────────
  // Cached positions for cloud drops and switch→patch drops, relative to framesRow.
  // Recalculated on render and resize.

  _virtualCoords: null, // { cloudA: {x,y}, cloudB: {x,y}, fwWan: {a:{x,y}, b:{x,y}}, wifiAp: {x,y}, switchBottom: {theme:{x,y}} }

  _computeVirtualCoords(container) {
    const framesRow = container.querySelector('.rack-frames-row');
    if (!framesRow) return;
    const ref = framesRow.getBoundingClientRect();

    const coords = { cloudA: null, cloudB: null, fwWan: {}, wifiAp: null, switchBottom: {} };

    const s = this._zoomScale || 1;

    // Per-cloud bottom-center coords (clouds are above framesRow, so y will be negative)
    ['A', 'B'].forEach(side => {
      const cloud = container.querySelector(`[data-cloud-side="${side}"]`);
      if (cloud) {
        const cr = cloud.getBoundingClientRect();
        coords[`cloud${side}`] = {
          x: (cr.left + cr.width / 2 - ref.left) / s,
          y: (cr.bottom - ref.top) / s,
        };
      }
    });

    // Firewall WAN ports
    ['a', 'b'].forEach(side => {
      const wan = container.querySelector(`[data-port-id="fw-${side}-wan"]`);
      if (wan) coords.fwWan[side] = this._toSvgCoords(wan.getBoundingClientRect(), ref);
    });

    // WiFi AP anchor
    const wifiAnchor = container.querySelector('[data-port-id="wifi-ap-eth"]');
    if (wifiAnchor) coords.wifiAp = this._toSvgCoords(wifiAnchor.getBoundingClientRect(), ref);

    // Switch bottom edges (for switch→patch virtual drops)
    const switches = container.querySelectorAll('.rack-device-switch[data-theme]');
    switches.forEach(sw => {
      const theme = sw.getAttribute('data-theme');
      const sr = sw.getBoundingClientRect();
      coords.switchBottom[theme] = {
        x: (sr.left + sr.width / 2 - ref.left) / s,
        y: (sr.bottom - ref.top) / s,
      };
    });

    this._virtualCoords = coords;
  },

  _zoomScale: 1,

  // Convert a getBoundingClientRect result to unscaled SVG coordinates relative to framesRow
  _toSvgCoords(rect, refRect) {
    const s = this._zoomScale || 1;
    return {
      x: (rect.left + rect.width / 2 - refRect.left) / s,
      y: (rect.top + rect.height / 2 - refRect.top) / s,
    };
  },

  _toSvgRect(rect, refRect) {
    const s = this._zoomScale || 1;
    return {
      left: (rect.left - refRect.left) / s,
      right: (rect.right - refRect.left) / s,
      top: (rect.top - refRect.top) / s,
      bottom: (rect.bottom - refRect.top) / s,
      width: rect.width / s,
      height: rect.height / s,
    };
  },

  _getPortCoords(container, portSelector) {
    const framesRow = container.querySelector('.rack-frames-row');
    if (!framesRow) return null;
    const ref = framesRow.getBoundingClientRect();
    const el = container.querySelector(portSelector);
    if (!el) return null;
    return this._toSvgCoords(el.getBoundingClientRect(), ref);
  },

  // ─── Route Resolution ───────────────────────────────────
  // Deterministic routing: given (entry, destination, options) → complete step sequence.
  // Each step has: { type, cable?, from?, trigger?, pause?, mode?, node? }
  // The animation layer just walks the steps. No routing logic in _playIngress.

  // Core CLI popup — Cisco interface name mapping from data-port-id
  _CLI_PORT_NAMES: {
    // Core A left (Te1/0/1-8): WLC, BRS-out, BRS-in, FW-A, spare(5-8)
    'core-a-wlc-uplink': 'Te1/0/1', 'core-a-brs-outbound': 'Te1/0/2',
    'core-a-brs-inbound': 'Te1/0/3', 'core-a-fw-a-uplink': 'Te1/0/4',
    // Core A right (Te2/0/1-8): spare(1-3), IT(4), Punk(5), trunk-3(6), trunk-BA(7), trunk-AB(8)
    'core-a-it-uplink': 'Te2/0/4', 'core-a-punk-uplink': 'Te2/0/5',
    'core-a-trunk-3': 'Te2/0/6', 'core-a-trunk-ba': 'Te2/0/7', 'core-a-trunk-ab': 'Te2/0/8',
    // Core B left (Te1/0/1-8): trunk-AB(1), trunk-BA(2), trunk-3(3), VPN(4), FW-B(5), BRS02-in(6), BRS02-out(7), spare(8)
    'core-b-trunk-ab': 'Te1/0/1', 'core-b-trunk-ba': 'Te1/0/2', 'core-b-trunk-3': 'Te1/0/3',
    'core-b-vpn-uplink': 'Te1/0/4', 'core-b-fw-b-uplink': 'Te1/0/5',
    'core-b-brs02-inbound': 'Te1/0/6', 'core-b-brs02-outbound': 'Te1/0/7',
    // Core B right (Te2/0/1-8): spare(1-6), Office(7), Corporate(8)
    'core-b-office-uplink': 'Te2/0/7', 'core-b-corporate-uplink': 'Te2/0/8',
  },
  _CLI_VLANS: { IT: 10, Punk: 20, Office: 30, Corporate: 40, _custom: 99 },
  _CLI_TEMPLATES: [
    (d) => `${d.name}# show mac address-table int ${d.intf}`,
    (d) => `${d.name}# show int ${d.intf} status`,
    (d) => `${d.name}# show vlan id ${d.vlanId} brief`,
    (d) => `${d.name}# ping ${d.vlan} source ${d.intf} !!!!!`,
    (d) => `${d.name}# conf t ; int ${d.intf} switchport access vlan ${d.vlanId}`,
    (d) => `${d.name}# show cdp neighbors ${d.intf}`,
    (d) => `${d.name}# show ip route ${d.vlan}`,
    (d) => `${d.name}# show spanning-tree int ${d.intf}`,
    (d) => `${d.name}# clear mac address-table dynamic int ${d.intf}`,
    (d) => `${d.name}# show arp | inc ${d.vlan}`,
  ],
  _coreCliPopup: { A: null, B: null },

  // Division → network topology mapping
  _DIV_TOPOLOGY: {
    'IT':         { fw: 'fw-a', core: 'core-a', switchCable: 9, rackSide: 'A', panelCap: 12 },
    'Punk':       { fw: 'fw-a', core: 'core-a', switchCable: 10, rackSide: 'A', panelCap: 12 },
    'Office':     { fw: 'fw-b', core: 'core-b', switchCable: 12, rackSide: 'B', panelCap: 12 },
    'Corporate':  { fw: 'fw-b', core: 'core-b', switchCable: 13, rackSide: 'B', panelCap: 12 },
    '_custom':    { fw: 'fw-b', core: 'core-b', switchCable: 14, rackSide: 'B', viaVpn: true, panelCap: 24 },
  },

  // Cable lookup: which cable connects two adjacent nodes?
  _ADJACENCY_CABLES: {
    'cloud-a→fw-a': 15, 'cloud-b→fw-b': 16,
    'fw-a→core-a': 3, 'fw-b→core-b': 4,
    'wifi-ap→wlc': 8, 'wlc→core-a': 7,
    'core-a→core-b': 0, 'core-b→core-a': 1,
    'core-a→brs': 5, 'brs→core-a': 6,
    'core-b→brs-02': 17, 'brs-02→core-b': 18,
    'core-b→vpn': 11, 'vpn→sw-custom': 14,
    'core-a→sw-IT': 9, 'core-a→sw-Punk': 10,
    'core-b→sw-Office': 12, 'core-b→sw-Corporate': 13,
  },

  _getCable(fromNode, toNode) {
    // Port-channel: cross-rack hops randomly pick one of three trunk cables (LACP)
    if ((fromNode === 'core-a' && toNode === 'core-b') ||
        (fromNode === 'core-b' && toNode === 'core-a')) {
      const r = Math.random();
      return r < 0.33 ? 0 : r < 0.66 ? 1 : 2;
    }
    return this._ADJACENCY_CABLES[`${fromNode}→${toNode}`] ?? null;
  },

  // Resolve a complete route: entry point → destination panel, with all hops and triggers
  _resolveRoute(entryType, divTheme, options = {}) {
    const topo = this._DIV_TOPOLOGY[divTheme];
    if (!topo) return null;

    const brs = options.brs !== false; // default: attempt BRS
    const steps = [];
    const isWifi = (entryType === 'wifi');

    // Determine entry side: dual-cloud model with 70% home-side bias
    // WiFi always enters via AP on Rack A. Internet badges randomly pick a cloud.
    let entrySide;
    if (isWifi) {
      entrySide = 'A';
    } else {
      const homeSide = topo.rackSide;
      entrySide = Math.random() < this._ENTRY_HOMESIDE_BIAS ? homeSide : (homeSide === 'A' ? 'B' : 'A');
    }
    const entryCloud = entrySide === 'A' ? 'cloud-a' : 'cloud-b';
    const entryFw = entrySide === 'A' ? 'fw-a' : 'fw-b';
    const entryCore = entrySide === 'A' ? 'core-a' : 'core-b';

    // Step 1: Materialize at entry point
    steps.push({
      type: 'materialize',
      mode: isWifi ? 'wifi' : 'cloud',
      node: isWifi ? 'wifi-ap' : entryCloud,
    });

    // Step 2: Entry cables to first core
    const cliRoll = options.cli === true ? true : options.cli === false ? false : Math.random() < 0.3;
    if (isWifi) {
      // WiFi: AP → WLC → Core A
      steps.push({ type: 'cable', cable: this._getCable('wifi-ap', 'wlc'), from: 'wifi-ap', trigger: 'wlc-bump' });
      steps.push({ type: 'cable', cable: this._getCable('wlc', 'core-a'), from: 'wlc' });
    } else {
      // Internet: Cloud → FW → Core (entry side, may differ from destination)
      steps.push({
        type: 'cable', cable: this._getCable(entryCloud, entryFw), from: entryCloud,
        trigger: 'fw-inspect', triggerNode: entryFw, pause: 1200,
      });
      steps.push({ type: 'cable', cable: this._getCable(entryFw, entryCore), from: entryFw });
    }

    // Current position after entry cables
    let currentCore = isWifi ? 'core-a' : entryCore;

    // Step 3: BRS side trip — load-balance across both BRS units
    // Prefer the entry side's BRS, but cross-rack to the other if ours is busy
    if (brs) {
      const localBrsCore = currentCore;
      const remoteBrsCore = currentCore === 'core-a' ? 'core-b' : 'core-a';
      const localBrsId = localBrsCore === 'core-a' ? 'brs-01' : 'brs-02';
      const remoteBrsId = remoteBrsCore === 'core-a' ? 'brs-01' : 'brs-02';

      // Pick BRS: prefer local, cross-rack if local is busy
      let brsCore, brsNode, brsId;
      if (!this._brsBusy[localBrsId]) {
        brsCore = localBrsCore;
        brsNode = localBrsCore === 'core-a' ? 'brs' : 'brs-02';
        brsId = localBrsId;
      } else if (!this._brsBusy[remoteBrsId]) {
        brsCore = remoteBrsCore;
        brsNode = remoteBrsCore === 'core-a' ? 'brs' : 'brs-02';
        brsId = remoteBrsId;
      } else {
        // Both busy — use local, will wait at BRS render step
        brsCore = localBrsCore;
        brsNode = localBrsCore === 'core-a' ? 'brs' : 'brs-02';
        brsId = localBrsId;
      }

      // Cross-rack to BRS core if needed
      if (currentCore !== brsCore) {
        const xStep = { type: 'cable', cable: this._getCable(currentCore, brsCore), from: currentCore };
        if (cliRoll) xStep.coreTrigger = 'core-cli';
        steps.push(xStep);
        currentCore = brsCore;
      }

      const inboundStep = { type: 'cable', cable: this._getCable(brsCore, brsNode), from: brsCore };
      if (cliRoll) inboundStep.coreTrigger = 'core-cli';
      steps.push(inboundStep);
      steps.push({ type: 'brs-render', pause: 1500, brsId });
      const outboundStep = { type: 'cable', cable: this._getCable(brsNode, brsCore), from: brsNode, cliCore: brsCore === 'core-a' ? 'A' : 'B' };
      if (cliRoll) outboundStep.coreTrigger = 'core-cli';
      steps.push(outboundStep);
      currentCore = brsCore;
    }

    // Step 4: Route to destination switch
    if (currentCore !== topo.core) {
      // Cross-rack to destination's core — CLI on cross-rack
      const xStep = { type: 'cable', cable: this._getCable(currentCore, topo.core), from: currentCore };
      if (cliRoll) xStep.coreTrigger = 'core-cli';
      steps.push(xStep);
    }

    // VPN detour for contractors — CLI on egress to VPN
    if (topo.viaVpn) {
      const vpnStep = {
        type: 'cable', cable: this._getCable('core-b', 'vpn'), from: 'core-b',
        trigger: 'vpn-tunnel', triggerNode: 'vpn',
      };
      if (cliRoll) vpnStep.coreTrigger = 'core-cli';
      steps.push(vpnStep);
      steps.push({ type: 'cable', cable: this._getCable('vpn', 'sw-custom'), from: 'vpn' });
    } else {
      // Egress to division switch — CLI on routing decision
      const egressStep = { type: 'cable', cable: topo.switchCable, from: topo.core };
      if (cliRoll) egressStep.coreTrigger = 'core-cli';
      steps.push(egressStep);
    }

    // Step 5: Beam down to patch panel
    steps.push({ type: 'beam-down', divTheme });

    // Step 6: Place badge
    steps.push({ type: 'place-badge' });

    // Attach metadata for debugging / Core CLI display
    return {
      steps,
      entry: entryType,
      entrySide,
      divTheme,
      rackSide: topo.rackSide,
      fw: isWifi ? topo.fw : entryFw,
    };
  },

  // Resolve a probe route (idle traffic): random short hop, no triggers
  _resolveProbeRoute() {
    const adj = this._ADJACENCY_CABLES;
    const hops = [
      // Short intra-rack hops
      { cables: [{ cable: adj['core-a→sw-IT'], from: 'core-a' }] },
      { cables: [{ cable: adj['core-a→sw-Punk'], from: 'core-a' }] },
      { cables: [{ cable: adj['core-b→sw-Office'], from: 'core-b' }] },
      { cables: [{ cable: adj['core-b→sw-Corporate'], from: 'core-b' }] },
      { cables: [{ cable: adj['fw-a→core-a'], from: 'fw-a' }] },
      { cables: [{ cable: adj['fw-b→core-b'], from: 'fw-b' }] },
      // Cross-rack (use _getCable for port-channel distribution)
      { cables: [{ cable: this._getCable('core-a', 'core-b'), from: 'core-a' }] },
      { cables: [{ cable: this._getCable('core-b', 'core-a'), from: 'core-b' }] },
      // BRS ping
      { cables: [{ cable: adj['core-a→brs'], from: 'core-a' }, { cable: adj['brs→core-a'], from: 'brs' }] },
    ];
    return hops[Math.floor(Math.random() * hops.length)];
  },

  // ─── Phase 3: Pool Management ────────────────────────────

  _initPool(allBadges) {
    this._badgePool = [];
    this._divInFlight = {};

    for (const div of Object.keys(this._DIV_TOPOLOGY)) {
      this._divInFlight[div] = 0;
    }

    // Separate exec badges from pool — they live on core switch portraits
    // Sort newest first (by created_at descending) so newest badges animate in first
    const nonExec = allBadges
      .filter(b => getDivisionForDept(b.department, b.isBandMember) !== '_exec')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    for (const badge of nonExec) {
      const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
      this._badgePool.push({ badge, divTheme });
    }
  },

  // ─── WFQ: Initialize per-division pools and weights ────────
  _initWfq() {
    const divs = Object.keys(this._DIV_TOPOLOGY);
    this._wfqDivPools = {};
    this._wfqVirtualTime = {};
    this._wfqInitialFillComplete = {};
    for (const div of divs) {
      this._wfqDivPools[div] = [];
      this._wfqVirtualTime[div] = 0;
      this._wfqInitialFillComplete[div] = false;
    }

    // Partition badge pool into per-division pools
    for (const entry of this._badgePool) {
      if (this._wfqDivPools[entry.divTheme]) {
        this._wfqDivPools[entry.divTheme].push(entry);
      }
    }

    // Compute WFQ weights: weight = divPoolSize / totalPoolSize
    // Larger pool = higher weight = lower cost per request = proportionally more bandwidth
    const totalSize = this._badgePool.length || 1;
    this._wfqWeight = {};
    for (const div of divs) {
      this._wfqWeight[div] = (this._wfqDivPools[div]?.length || 0) / totalSize;
    }
  },

  // ─── WFQ: Scheduler lifecycle ───────────────────────────────

  async _startWfq() {
    if (this._wfqRunning) return;
    this._wfqRunning = true;

    while (this._wfqRunning && this._container && this._cableSvg) {
      this._wfqTick();
      await this._delay(this._WFQ_TICK_MS);
    }
  },

  _stopWfq() {
    this._wfqRunning = false;
  },

  // Seed TTL tracking from existing DOM panel contents (view-switch return).
  // Panels are already populated from a prior session — give each badge a
  // staggered TTL so eviction cycling resumes naturally without a burst.
  // Mark divisions as filled based on current DOM state (view-switch return).
  _seedWfqFromDOM() {
    for (const div of Object.keys(this._DIV_TOPOLOGY)) {
      if (this._wfqInitialFillComplete[div]) continue;
      const contents = this._getPanelContents(div);
      const poolSize = (this._wfqDivPools[div] || []).length;
      const cap = this._DIV_TOPOLOGY[div]?.panelCap || 12;
      if (contents.length >= Math.min(cap, poolSize)) {
        this._wfqInitialFillComplete[div] = true;
      }
    }
  },

  // ─── WFQ: Core scheduler tick ───────────────────────────────
  // One tick does: (1) pick 1 random badge to evict per eligible division, (2) fill empty slots.
  // No TTL timers — the tick interval IS the rotation clock. At most 1 eviction per division per tick.
  _wfqTick() {
    if (!this._wfqRunning || !this._container || !this._cableSvg) return;

    const divs = Object.keys(this._DIV_TOPOLOGY);

    // ── Step 1: Pick one badge to evict from one eligible division ──
    // Only divisions that have completed initial fill can evict.
    // WFQ ordering: division with lowest virtual time goes first.
    const filledDivs = divs
      .filter(d => this._wfqInitialFillComplete[d])
      .sort((a, b) => this._wfqVirtualTime[a] - this._wfqVirtualTime[b]);

    for (const div of filledDivs) {
      if (this._inFlightCount >= this._MAX_IN_FLIGHT) break;
      // Skip if this division already has ANY in-flight work (eviction or ingress).
      // This prevents cascading evictions while a replacement is still animating.
      if (this._divInFlight[div] > 0) continue;

      // Only evict if this division has pool badges waiting (more badges than panel cap)
      const panelContents = this._getPanelContents(div);
      const divPool = this._wfqDivPools[div] || [];
      const onPanel = new Set(panelContents);
      const hasWaiting = divPool.some(e => !onPanel.has(e.badge.employeeId));
      if (!hasWaiting) continue;

      // Only evict if panel is at capacity — don't evict from a panel that has empty slots
      const cap = this._DIV_TOPOLOGY[div]?.panelCap || 12;
      if (panelContents.length < cap) continue;

      // Pick one random badge from the panel to evict
      const evictId = panelContents[Math.floor(Math.random() * panelContents.length)];

      this._divInFlight[div]++;
      this._inFlightCount++;

      this._executeRemoval(div, evictId).finally(() => {
        this._inFlightCount--;
        this._divInFlight[div]--;
      });

      break; // one eviction per tick globally — keeps rotation gentle
    }

    // ── Step 2: Determine division order (WFQ + first-pass priority) ──
    const unfilled = divs.filter(d => !this._wfqInitialFillComplete[d]);
    const filled = divs.filter(d => this._wfqInitialFillComplete[d]);
    unfilled.sort((a, b) => this._wfqVirtualTime[a] - this._wfqVirtualTime[b]);
    filled.sort((a, b) => this._wfqVirtualTime[a] - this._wfqVirtualTime[b]);
    const ordered = [...unfilled, ...filled];

    // ── Step 3: Fill empty panel slots ────────────────────────
    for (const div of ordered) {
      if (this._inFlightCount >= this._MAX_IN_FLIGHT) break;
      if (this._divInFlight[div] >= this._MAX_PER_DIV) continue;

      const panelContents = this._getPanelContents(div);
      const cap = this._DIV_TOPOLOGY[div]?.panelCap || 12;
      if (panelContents.length >= cap) continue;

      // Find a badge from this div's pool not currently on panel
      const divPool = this._wfqDivPools[div] || [];
      const onPanel = new Set(panelContents);
      const candidate = divPool.find(e => !onPanel.has(e.badge.employeeId));
      if (!candidate) continue;

      // Dispatch ingress animation
      this._divInFlight[div]++;
      this._inFlightCount++;
      const weight = this._wfqWeight[div] || 0.1;
      this._wfqVirtualTime[div] += 1 / weight;

      const badge = candidate.badge;
      const fillDiv = div; // capture for closure
      this._executeCoreDownloadCli(div).then(() => {
        return this._playIngress(badge);
      }).then(() => {
        // Check initial fill completion
        if (!this._wfqInitialFillComplete[fillDiv]) {
          const currentPanel = this._getPanelContents(fillDiv);
          const poolSize = (this._wfqDivPools[fillDiv] || []).length;
          if (currentPanel.length >= Math.min(cap, poolSize)) {
            this._wfqInitialFillComplete[fillDiv] = true;
          }
        }
      }).finally(() => {
        this._inFlightCount--;
        this._divInFlight[div]--;
      });
    }
  },

  // Verify panel integrity: check for duplicates and orphaned badges
  _verifyPanelIntegrity() {
    for (const div of Object.keys(this._DIV_TOPOLOGY)) {
      const contents = this._getPanelContents(div);
      const cap = this._DIV_TOPOLOGY[div]?.panelCap || 12;

      // Check for duplicates
      const seen = new Set();
      for (const eid of contents) {
        if (seen.has(eid)) {
          console.warn(`[rack] Panel integrity: duplicate badge ${eid} in ${div}`);
        }
        seen.add(eid);
      }

      // Check for over-capacity
      if (contents.length > cap) {
        console.warn(`[rack] Panel integrity: ${div} has ${contents.length}/${cap} badges (over capacity)`);
      }
    }
  },

  // Derive panel contents from DOM — single source of truth, no manual tracking
  _getPanelContents(divTheme) {
    const panel = this._container?.querySelector(`[data-panel-key="${CSS.escape(divTheme)}"]`);
    if (!panel) return [];
    return Array.from(panel.querySelectorAll('.rack-port[data-employee-id]'))
      .map(el => el.getAttribute('data-employee-id'));
  },

  // Remove a badge from pool entirely (badge-deleted SSE)
  _removeFromPool(employeeId) {
    // Remove from global pool
    const removed = this._badgePool.find(p => p.badge.employeeId === employeeId);
    this._badgePool = this._badgePool.filter(p => p.badge.employeeId !== employeeId);
    // Remove from WFQ per-division pool
    if (removed && this._wfqDivPools[removed.divTheme]) {
      this._wfqDivPools[removed.divTheme] = this._wfqDivPools[removed.divTheme].filter(
        p => p.badge.employeeId !== employeeId
      );
    }
  },

  // Phase A: Port shutdown + degauss removal
  async _executeRemoval(divTheme, employeeId) {
    const topo = this._DIV_TOPOLOGY[divTheme];
    if (!topo) return;

    // Find the port element and its switch
    const portEl = this._container?.querySelector(`.rack-port[data-employee-id="${CSS.escape(employeeId)}"]`);
    const switchEl = this._container?.querySelector(`.rack-device-switch[data-theme="${CSS.escape(divTheme)}"]`);

    // 1. Division switch CLI popup
    if (switchEl) {
      this._triggerSwitchCli(switchEl, divTheme, 'shutdown');
    }
    await this._delay(1500);

    // 2. Switch port LED → amber → red
    if (portEl) {
      const portIdx = Array.from(portEl.parentNode.children).filter(c => !c.classList.contains('rack-port-empty')).indexOf(portEl);
      const switchPort = switchEl?.querySelector(`[data-switch-port="${portIdx}"]`);
      if (switchPort) {
        switchPort.classList.add('rack-conn-port-shutdown');
      }
    }
    await this._delay(800);

    // 3. Degauss animation
    if (portEl) {
      portEl.classList.add('rack-degauss');
    }
    await this._delay(900);

    // 4. Remove port, replace with empty
    if (portEl) {
      const emptyPort = document.createElement('div');
      emptyPort.className = 'rack-port rack-port-empty';
      portEl.replaceWith(emptyPort);
    }

    // 5. No shutdown CLI + LED dim
    if (switchEl) {
      this._triggerSwitchCli(switchEl, divTheme, 'noshutdown');
      // Reset switch port LED
      const switchPort = switchEl?.querySelector('.rack-conn-port-shutdown');
      if (switchPort) {
        switchPort.classList.remove('rack-conn-port-shutdown', 'rack-conn-port-active', 'rack-conn-port-dual');
      }
    }
    await this._delay(1000);
  },

  // Division switch CLI popup — positioned above the switch
  _SWITCH_CLI_SHUTDOWN: [
    (sw, port) => `${sw}# conf t ; int ${port} shutdown`,
    (sw, port) => `${sw}# clear mac address-table dynamic int ${port}`,
    (sw, port) => `${sw}# clear nac session int ${port}`,
    (sw, port) => `${sw}# clear authentication session int ${port}`,
  ],

  _triggerSwitchCli(switchEl, divTheme, action) {
    const divInfo = typeof PUBLIC_DIVISIONS !== 'undefined'
      ? PUBLIC_DIVISIONS.find(d => d.theme === divTheme)
      : null;
    const swName = `SW-${(divInfo?.label || divTheme).split(' ')[0].toUpperCase()}`;
    const portName = `Gi1/0/${Math.floor(Math.random() * 12) + 1}`;

    let text;
    if (action === 'shutdown') {
      const tmpl = this._SWITCH_CLI_SHUTDOWN[Math.floor(Math.random() * this._SWITCH_CLI_SHUTDOWN.length)];
      text = tmpl(swName, portName);
    } else {
      text = `${swName}# no shutdown int ${portName}`;
    }

    const popup = document.createElement('div');
    popup.className = 'rack-cli-popup rack-switch-cli-popup';
    popup.textContent = text;
    switchEl.style.position = 'relative';
    switchEl.appendChild(popup);
    setTimeout(() => popup.remove(), 4500);
  },

  // Core switch "download badge.pkg" CLI
  async _executeCoreDownloadCli(divTheme) {
    const topo = this._DIV_TOPOLOGY[divTheme];
    if (!topo) return;

    const coreSide = topo.core === 'core-a' ? 'A' : 'B';
    const coreEl = this._container?.querySelector(`[data-core-side="${coreSide}"]`);
    if (!coreEl) return;

    // Pick band member name from core portraits
    const portraits = coreEl.querySelectorAll('.rack-core-port[data-employee-id]');
    const names = Array.from(portraits).map(p => p.getAttribute('title')).filter(Boolean);
    const name = names.length > 0 ? names[Math.floor(Math.random() * names.length)].split(' ')[0] : 'Core';

    const divLabel = divTheme.replace('_', '').toUpperCase();
    const portName = `Te2/0/${Math.floor(Math.random() * 4) + 5}`;
    const text = `${name}# download badge.pkg → ${portName} vlan ${divLabel}`;

    const popup = document.createElement('div');
    popup.className = 'rack-cli-popup rack-core-download-popup';
    popup.textContent = text;
    coreEl.style.position = 'relative';
    coreEl.appendChild(popup);
    setTimeout(() => popup.remove(), 4500);

    await this._delay(2500);
  },

  // Scheduler state (shared by WFQ scheduler)
  _inFlightCount: 0,
  _MAX_IN_FLIGHT: 5,
  _ENTRY_HOMESIDE_BIAS: 0.7, // probability badge enters from its destination rack's cloud
  _brsBusy: { 'brs-01': false, 'brs-02': false }, // BRS render busy tracking (used by _playIngress)

  // ─── Device Trigger Effects ────────────────────────────

  _triggerFlash(el, className, duration = 500) {
    if (!el) return;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), duration);
  },

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  _triggerFWInspect(fwEl, duration = 1200) {
    if (!fwEl || !this._cableSvg) return;
    // Green glow on the device
    this._triggerFlash(fwEl, 'rack-trigger-fw-inspect', duration);

    // "✓ PASS" text in SVG overlay — guaranteed visible above all rack elements
    const framesRow = this._container.querySelector('.rack-frames-row');
    if (!framesRow) return;
    const ref = framesRow.getBoundingClientRect();
    const pt = this._toSvgCoords(fwEl.getBoundingClientRect(), ref);
    const cx = pt.x;
    const cy = pt.y;

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', cx);
    text.setAttribute('y', cy + 4); // slight baseline adjust
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'monospace');
    text.setAttribute('font-size', '14');
    text.setAttribute('font-weight', '700');
    text.setAttribute('fill', '#22C55E');
    text.setAttribute('filter', 'url(#packet-glow)');
    text.setAttribute('opacity', '0');
    text.textContent = '✓ PASS';
    this._cableSvg.appendChild(text);

    // Animate: pop in, hold, fade out
    const start = performance.now();
    const animate = (now) => {
      const t = (now - start) / duration;
      if (t >= 1) { text.remove(); return; }
      if (t < 0.2) {
        // Pop in
        const s = t / 0.2;
        text.setAttribute('opacity', String(s));
        text.setAttribute('font-size', String(10 + s * 4));
      } else if (t < 0.7) {
        // Hold
        text.setAttribute('opacity', '1');
        text.setAttribute('font-size', '13');
      } else {
        // Fade out
        text.setAttribute('opacity', String(1 - (t - 0.7) / 0.3));
      }
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  },

  // ─── Core CLI Popup ────────────────────────────────────
  // Fire-and-forget Cisco IOS-style popup centered below core switch.
  // A random band member on that core "directs" the traffic.

  // Band members are static: Core A = Luke, Drew, Henry | Core B = Todd, Adam
  _CLI_CORE_NAMES: { A: ['Luke', 'Drew', 'Henry'], B: ['Todd', 'Adam'] },

  _triggerCoreCli(coreSide, route) {
    const coreEl = this._container?.querySelector(`[data-core-side="${coreSide}"]`);
    if (!coreEl) return;

    const names = this._CLI_CORE_NAMES[coreSide];
    const firstName = names[Math.floor(Math.random() * names.length)];

    // Build CLI context from route data
    const div = route.divTheme || 'IT';
    const vlanId = this._CLI_VLANS[div] || 10;
    const vlan = `10.${vlanId}.0.1`;
    // Pick a relevant port on this core
    const prefix = `core-${coreSide.toLowerCase()}-`;
    const portKeys = Object.keys(this._CLI_PORT_NAMES).filter(k => k.startsWith(prefix));
    const portKey = portKeys[Math.floor(Math.random() * portKeys.length)] || portKeys[0];
    const intf = this._CLI_PORT_NAMES[portKey] || 'Te1/0/1';

    // Pick random template
    const tpl = this._CLI_TEMPLATES[Math.floor(Math.random() * this._CLI_TEMPLATES.length)];
    const text = tpl({ name: firstName, intf, vlan, vlanId, badgeName: '' });

    // Remove existing popup on this core
    if (this._coreCliPopup[coreSide]) {
      this._coreCliPopup[coreSide].remove();
      this._coreCliPopup[coreSide] = null;
    }

    // Create DOM popup
    const popup = document.createElement('div');
    popup.className = 'rack-core-cli-popup';
    popup.textContent = text;
    popup.style.opacity = '0';
    coreEl.appendChild(popup);
    this._coreCliPopup[coreSide] = popup;

    // Animate: 4.5s total — pop-in (0-8%), hold (8-65%), fade-out (65-100%)
    const duration = 4500;
    const start = performance.now();
    const animate = (now) => {
      if (!popup.parentNode) return;
      const t = (now - start) / duration;
      if (t >= 1) { popup.remove(); if (this._coreCliPopup[coreSide] === popup) this._coreCliPopup[coreSide] = null; return; }
      if (t < 0.08) {
        const s = t / 0.08;
        popup.style.opacity = String(s);
        popup.style.transform = `translate(-50%, -50%) scale(${0.9 + 0.1 * s})`;
      } else if (t < 0.65) {
        popup.style.opacity = '1';
        popup.style.transform = 'translate(-50%, -50%) scale(1)';
      } else {
        popup.style.opacity = String(1 - (t - 0.65) / 0.35);
      }
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  },

  // ─── Cloud Binary Rain (recycled pool) ──────────────────
  // Matrix-style digits fall from clouds. Fixed pool of SVG text elements
  // recycled on a timer — no DOM create/destroy, no animation count growth.
  // Each tick repositions the next element and restarts its CSS animation.

  _cloudRainTimer: null,
  _cloudRainPool: [],
  _CLOUD_RAIN_POOL_SIZE: 8,

  _startCloudRain() {
    if (this._cloudRainTimer) return;
    if (!this._cableSvg) return;
    const cloudA = this._virtualCoords?.cloudA;
    const cloudB = this._virtualCoords?.cloudB;
    if (!cloudA && !cloudB) return;

    const svg = this._cableSvg;
    const clouds = [];
    if (cloudA) clouds.push(cloudA);
    if (cloudB) clouds.push(cloudB);
    const colors = ['#5B8DEF', '#93C5FD', '#B4D4FF', '#FFFFFF', '#3B6FCF'];

    const cloudW = 75;  // half-width of rain zone
    const cloudH = 70;  // height of cloud above bottom edge
    const fallDist = cloudH - 5;

    // Pre-create pool of SVG text elements (never added/removed from DOM after this)
    this._cloudRainPool = [];
    for (let i = 0; i < this._CLOUD_RAIN_POOL_SIZE; i++) {
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('font-family', 'monospace');
      txt.setAttribute('text-anchor', 'middle');
      txt.classList.add('rack-cloud-rain-digit');
      txt.style.opacity = '0'; // start hidden
      svg.appendChild(txt);
      this._cloudRainPool.push(txt);
    }

    let poolIdx = 0;
    let spawnIdx = 0;
    this._cloudRainTimer = setInterval(() => {
      const cloud = clouds[spawnIdx % clouds.length];
      spawnIdx++;

      // Recycle next element from pool
      const txt = this._cloudRainPool[poolIdx % this._CLOUD_RAIN_POOL_SIZE];
      poolIdx++;

      const cloudTop = cloud.y - cloudH;
      txt.textContent = Math.random() < 0.5 ? '0' : '1';
      txt.setAttribute('font-size', `${8 + Math.random() * 5}`);
      txt.setAttribute('fill', colors[Math.floor(Math.random() * colors.length)]);
      txt.setAttribute('x', cloud.x + (Math.random() - 0.5) * cloudW * 1.4);
      txt.setAttribute('y', cloudTop + Math.random() * 10);

      const speed = 12 + Math.random() * 20;
      const duration = fallDist / speed;
      const opacity = 0.3 + Math.random() * 0.4;
      txt.style.setProperty('--rain-duration', `${duration.toFixed(2)}s`);
      txt.style.setProperty('--rain-dist', `${fallDist}px`);
      txt.style.setProperty('--rain-opacity', `${opacity}`);

      // Restart animation by removing/re-adding the class
      txt.classList.remove('rack-cloud-rain-digit');
      // Force reflow to restart animation (void is intentional)
      void txt.getBBox();
      txt.classList.add('rack-cloud-rain-digit');
      txt.style.opacity = '';
    }, 1500);
  },

  _stopCloudRain() {
    if (this._cloudRainTimer) {
      clearInterval(this._cloudRainTimer);
      this._cloudRainTimer = null;
    }
    // Hide pool elements (don't remove — they'll be cleaned up with the SVG)
    this._cloudRainPool.forEach(el => { el.style.opacity = '0'; el.classList.remove('rack-cloud-rain-digit'); });
    this._cloudRainPool = [];
  },

  // Red rain precursor — briefly contaminate the cloud rain with red digits before a threat drops.
  // Uses a recycled pool of 5 SVG text elements (never added/removed from DOM after init).
  _threatRainPool: [],
  _THREAT_RAIN_POOL_SIZE: 5,

  _ensureThreatRainPool() {
    if (this._threatRainPool.length) return;
    const svg = this._cableSvg;
    if (!svg) return;
    for (let i = 0; i < this._THREAT_RAIN_POOL_SIZE; i++) {
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('font-family', 'monospace');
      txt.setAttribute('text-anchor', 'middle');
      txt.style.opacity = '0';
      svg.appendChild(txt);
      this._threatRainPool.push(txt);
    }
  },

  _spawnThreatRain(side = 'A') {
    const cloud = side === 'A' ? this._virtualCoords?.cloudA : this._virtualCoords?.cloudB;
    if (!this._cableSvg || !cloud) return Promise.resolve();

    this._ensureThreatRainPool();

    const cloudW = 75;
    const cloudH = 70;
    const cloudTop = cloud.y - cloudH;
    const cloudBot = cloud.y - 5;
    const redColors = ['#EF4444', '#F87171', '#DC2626', '#FCA5A5'];

    return new Promise(resolve => {
      let spawned = 0;
      const spawnOne = () => {
        if (spawned >= this._THREAT_RAIN_POOL_SIZE) return;
        const txt = this._threatRainPool[spawned];
        txt.textContent = Math.random() < 0.5 ? '0' : '1';
        txt.setAttribute('font-size', `${9 + Math.random() * 5}`);
        txt.setAttribute('fill', redColors[Math.floor(Math.random() * redColors.length)]);

        const startX = cloud.x + (Math.random() - 0.5) * cloudW * 1.2;
        const startY = cloudTop + Math.random() * 10;
        txt.setAttribute('x', startX);
        txt.setAttribute('y', startY);

        const fallDist = cloudBot - startY;
        const speed = 15 + Math.random() * 15;
        const duration = fallDist / speed;
        const opacity = 0.6 + Math.random() * 0.3;
        txt.style.setProperty('--rain-duration', `${duration.toFixed(2)}s`);
        txt.style.setProperty('--rain-dist', `${fallDist}px`);
        txt.style.setProperty('--rain-opacity', `${opacity}`);

        // Restart animation by removing/re-adding the class
        txt.classList.remove('rack-cloud-rain-digit');
        void txt.getBBox();
        txt.classList.add('rack-cloud-rain-digit');
        txt.style.opacity = '';

        spawned++;
        if (spawned < this._THREAT_RAIN_POOL_SIZE) {
          setTimeout(spawnOne, 60);
        }
      };
      spawnOne();
      setTimeout(resolve, this._THREAT_RAIN_POOL_SIZE * 60 + 300);
    });
  },

  // ─── Firewall Threat Traffic ────────────────────────────
  // Background red packets that hit firewalls and get rejected. Separate from badge ingress.
  // Counter rolls over at 99 with "ALL CLEAR" flash.

  _THREAT_LABELS: ['PORT SCAN', 'BRUTE FORCE', 'SQL INJECT', 'MALWARE', 'C2 BEACON', 'DDoS FRAG', 'EXPLOIT KIT', 'PHISHING'],
  _threatTimer: null,
  _threatCounts: { A: 0, B: 0 },

  _startThreatTraffic() {
    if (this._threatTimer) return;
    const fire = () => {
      this._fireThreatPacket();
      // Next threat in 15-30s
      this._threatTimer = setTimeout(fire, 15000 + Math.random() * 15000);
    };
    // First threat after 8-15s
    this._threatTimer = setTimeout(fire, 8000 + Math.random() * 7000);
  },

  _stopThreatTraffic() {
    if (this._threatTimer) { clearTimeout(this._threatTimer); this._threatTimer = null; }
  },

  async _fireThreatPacket() {
    if (!this._container || !this._cableSvg || !this._virtualCoords) return;

    // Pick random firewall — threat comes from that side's cloud
    const side = Math.random() < 0.5 ? 'A' : 'B';
    const fwNode = side === 'A' ? 'fw-a' : 'fw-b';
    const cloudNode = side === 'A' ? 'cloud-a' : 'cloud-b';
    const cableIndex = this._getCable(cloudNode, fwNode);
    if (cableIndex == null) return;

    // Red rain precursor — inject red binary digits into the correct cloud
    await this._spawnThreatRain(side);

    // Create red threat dot (small, no portrait)
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('rack-packet', 'rack-packet-threat');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', '#EF4444');
    dot.setAttribute('filter', 'url(#packet-glow)');
    g.appendChild(dot);
    // Red glow ring
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('r', '7');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', '#EF4444');
    ring.setAttribute('stroke-width', '1');
    ring.setAttribute('opacity', '0.5');
    g.appendChild(ring);
    this._cableSvg.appendChild(g);

    // Position at correct cloud
    const cloud = side === 'A' ? this._virtualCoords.cloudA : this._virtualCoords.cloudB;
    if (!cloud) return;
    g.setAttribute('transform', `translate(${cloud.x},${cloud.y})`);
    g.setAttribute('opacity', '1');

    const pkt = { el: g };

    // Animate along cloud→FW cable
    await this._movePacketAlongCable(pkt, cableIndex, cloudNode, 0.5);

    // Reject at firewall
    const fwEl = this._container.querySelector(`[data-fw-side="${side}"]`);
    if (fwEl) {
      this._triggerFlash(fwEl, 'rack-trigger-fw-reject', 600);
      this._triggerFWReject(fwEl, side);
    }

    // Scatter particles then remove
    this._scatterThreat(pkt);
  },

  _triggerFWReject(fwEl, side) {
    if (!this._cableSvg) return;

    // Pick a threat label
    const label = this._THREAT_LABELS[Math.floor(Math.random() * this._THREAT_LABELS.length)];

    // Red "✗ DENY" + threat label in SVG
    const framesRow = this._container.querySelector('.rack-frames-row');
    if (!framesRow) return;
    const ref = framesRow.getBoundingClientRect();
    const pt = this._toSvgCoords(fwEl.getBoundingClientRect(), ref);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', pt.x);
    text.setAttribute('y', pt.y + 4);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'monospace');
    text.setAttribute('font-size', '14');
    text.setAttribute('font-weight', '700');
    text.setAttribute('fill', '#EF4444');
    text.setAttribute('filter', 'url(#packet-glow)');
    text.setAttribute('opacity', '0');
    text.textContent = `✗ ${label}`;
    this._cableSvg.appendChild(text);

    const duration = 2000;
    const start = performance.now();
    const animate = (now) => {
      const t = (now - start) / duration;
      if (t >= 1) { text.remove(); return; }
      if (t < 0.1) {
        const s = t / 0.1;
        text.setAttribute('opacity', String(s));
        text.setAttribute('font-size', String(10 + s * 4));
      } else if (t < 0.7) {
        text.setAttribute('opacity', '1');
        text.setAttribute('font-size', '13');
      } else {
        text.setAttribute('opacity', String(1 - (t - 0.7) / 0.3));
      }
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);

    // Increment threat counter
    this._threatCounts[side]++;
    const countEl = this._container.querySelector(`[data-fw-threats="${side}"]`);
    if (countEl) {
      countEl.textContent = String(this._threatCounts[side]);
      countEl.closest('.rack-fw-threat')?.classList.add('rack-fw-threat-active');
    }

    // Rollover at 99
    if (this._threatCounts[side] >= 99) {
      setTimeout(() => this._resetThreatCounter(side), 2000);
    }
  },

  _resetThreatCounter(side) {
    this._threatCounts[side] = 0;
    const countEl = this._container?.querySelector(`[data-fw-threats="${side}"]`);
    if (countEl) {
      countEl.textContent = '0';
      countEl.closest('.rack-fw-threat')?.classList.remove('rack-fw-threat-active');
    }
    // "ALL CLEAR" flash on the firewall
    const fwEl = this._container?.querySelector(`[data-fw-side="${side}"]`);
    if (fwEl) {
      this._triggerFlash(fwEl, 'rack-trigger-fw-clear', 1200);

      // SVG "ALL CLEAR" text
      if (this._cableSvg) {
        const framesRow = this._container.querySelector('.rack-frames-row');
        if (!framesRow) return;
        const ref = framesRow.getBoundingClientRect();
        const pt = this._toSvgCoords(fwEl.getBoundingClientRect(), ref);
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', pt.x);
        text.setAttribute('y', pt.y + 4);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-family', 'monospace');
        text.setAttribute('font-size', '11');
        text.setAttribute('font-weight', '700');
        text.setAttribute('fill', '#22C55E');
        text.setAttribute('filter', 'url(#packet-glow)');
        text.setAttribute('opacity', '0');
        text.textContent = '✓ ALL CLEAR';
        this._cableSvg.appendChild(text);

        const duration = 1200;
        const start = performance.now();
        const animate = (now) => {
          const t = (now - start) / duration;
          if (t >= 1) { text.remove(); return; }
          if (t < 0.15) {
            text.setAttribute('opacity', String(t / 0.15));
            text.setAttribute('font-size', String(9 + (t / 0.15) * 5));
          } else if (t < 0.7) {
            text.setAttribute('opacity', '1');
            text.setAttribute('font-size', '14');
          } else {
            text.setAttribute('opacity', String(1 - (t - 0.7) / 0.3));
          }
          requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      }
    }
  },

  _scatterThreat(pkt) {
    if (!pkt.el || !pkt.el.parentNode) return;
    const svg = this._cableSvg;
    const transform = pkt.el.getAttribute('transform');
    const match = transform?.match(/translate\(([\d.]+),([\d.]+)\)/);
    const cx = match ? parseFloat(match[1]) : 0;
    const cy = match ? parseFloat(match[2]) : 0;
    pkt.el.remove();

    // Spawn 6 red scatter particles
    const particles = [];
    for (let i = 0; i < 6; i++) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      p.setAttribute('cx', cx);
      p.setAttribute('cy', cy);
      p.setAttribute('r', '2');
      p.setAttribute('fill', '#EF4444');
      p.setAttribute('opacity', '1');
      svg.appendChild(p);
      const angle = (Math.PI * 2 / 6) * i + Math.random() * 0.5;
      const speed = 30 + Math.random() * 40;
      particles.push({ el: p, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
    }

    const start = performance.now();
    const scatter = (now) => {
      const t = (now - start) / 600;
      if (t >= 1) { particles.forEach(p => p.el.remove()); return; }
      particles.forEach(p => {
        const nx = cx + p.vx * t;
        const ny = cy + p.vy * t;
        p.el.setAttribute('cx', nx);
        p.el.setAttribute('cy', ny);
        p.el.setAttribute('opacity', String(1 - t));
      });
      requestAnimationFrame(scatter);
    };
    requestAnimationFrame(scatter);
  },

  // ─── VPN Session Counter ──────────────────────────────
  // Increments when contractor packets pass through VPN.

  _vpnSessions: 0,

  _triggerVPNSession() {
    this._vpnSessions++;
    const labelEl = this._container?.querySelector('.rack-vpn-tunnel-label');
    if (labelEl) {
      labelEl.textContent = `TUNNEL UP · ${this._vpnSessions}`;
      // Brief bright pulse
      labelEl.classList.add('rack-vpn-session-bump');
      setTimeout(() => labelEl.classList.remove('rack-vpn-session-bump'), 600);
    }
  },

  // ─── WLC AP Count Bump ────────────────────────────────
  // Briefly bumps AP count +1 when WiFi path packet passes through.

  _triggerWLCBump() {
    const countEl = this._container?.querySelector('[data-wlc-aps]');
    if (!countEl) return;
    const current = parseInt(countEl.textContent) || 0;
    countEl.textContent = `${current + 1} APs`;
    countEl.classList.add('rack-wlc-ap-bump');
    // ALM LED amber burst
    const almLed = this._container?.querySelector('.rack-device-wlc [title="ALM"]');
    if (almLed) {
      almLed.classList.add('rack-wlc-alm-burst');
      setTimeout(() => almLed.classList.remove('rack-wlc-alm-burst'), 1200);
    }
    setTimeout(() => {
      countEl.textContent = `${current} APs`;
      countEl.classList.remove('rack-wlc-ap-bump');
    }, 1500);
  },

  // ─── Idle Animations ──────────────────────────────────
  // WLC radio heartbeat + VPN keepalive pulse. CSS-driven with JS timers.

  _idleTimers: [],
  _idleActive: false,

  _startIdleAnimations() {
    if (!this._container) return;
    this._idleActive = true;

    // WLC radio heartbeat — RADIO LED flickers every 6-10s
    const wlcLed = this._container.querySelector('.rack-device-wlc [title="RADIO"]');
    if (wlcLed) {
      const wlcBeat = () => {
        if (!this._idleActive) return; // guard against zombie timers
        wlcLed.classList.add('rack-wlc-radio-heartbeat');
        setTimeout(() => wlcLed.classList.remove('rack-wlc-radio-heartbeat'), 400);
        this._idleTimers.push(setTimeout(wlcBeat, 6000 + Math.random() * 4000));
      };
      this._idleTimers.push(setTimeout(wlcBeat, 3000 + Math.random() * 3000));
    }

    // VPN keepalive — tunnel label subtle pulse every 8-12s
    const vpnLabel = this._container.querySelector('.rack-vpn-tunnel-label');
    if (vpnLabel) {
      const vpnPulse = () => {
        if (!this._idleActive) return; // guard against zombie timers
        vpnLabel.classList.add('rack-vpn-keepalive');
        setTimeout(() => vpnLabel.classList.remove('rack-vpn-keepalive'), 600);
        this._idleTimers.push(setTimeout(vpnPulse, 8000 + Math.random() * 4000));
      };
      this._idleTimers.push(setTimeout(vpnPulse, 5000 + Math.random() * 3000));
    }

    // Idle cable traffic — background dots on cables
    this._startIdleTraffic();

    // Single consolidated timer for all device effects — one wake-up instead of four.
    // Runs at 800ms, handles: port LED toggling, fan rotation, UPS LCD cycling.
    this._startDeviceEffectsTimer();
  },

  // ─── Consolidated Device Effects Timer ──────────────────
  // Single setInterval replaces 4 separate timers (port LEDs, storage LEDs,
  // device LEDs, fan rotation, UPS LCD cycling). One browser wake-up per tick.
  _deviceEffectsTimer: null,
  _deviceEffectsTick: 0,
  _portLedGroupCache: null,
  _storageLedCache: null,
  _deviceLedCache: null,
  _fanAngle: 0,
  _upsLcdPageIdx: 0,

  _startDeviceEffectsTimer() {
    if (this._deviceEffectsTimer) clearInterval(this._deviceEffectsTimer);

    // Cache port groups
    this._portLedGroupCache = [];
    for (let g = 0; g < 8; g++) {
      this._portLedGroupCache[g] = Array.from(
        this._container?.querySelectorAll(`.rack-port-group-${g}.rack-conn-port-dual`) || []
      );
    }
    // Cache storage bay LEDs
    this._storageLedCache = [];
    const storageLeds = Array.from(this._container?.querySelectorAll('.rack-storage-led-activity.active') || []);
    for (let g = 0; g < 8; g++) {
      this._storageLedCache[g] = storageLeds.filter((_, i) => i % 8 === g);
    }
    // Cache device status LEDs
    this._deviceLedCache = [];
    const deviceLeds = Array.from(this._container?.querySelectorAll(
      '.rack-led-blink-gold, .rack-led-blink-blue, .rack-led-slow-blink, ' +
      '.rack-wifi-led-wlan, .rack-wifi-led-eth, .rack-wifi-led-act, ' +
      '.rack-wifi-arc-1, .rack-wifi-arc-2, .rack-wifi-arc-3, ' +
      '.rack-brs-led-render.rack-brs-led-active, .rack-brs-led-queue, ' +
      '.rack-ups-led-bat'
    ) || []);
    for (let g = 0; g < 4; g++) {
      this._deviceLedCache[g] = deviceLeds.filter((_, i) => i % 4 === g);
    }
    // Cache fans and UPS screens
    this._fanEls = Array.from(this._container?.querySelectorAll('.rack-fw-fan-1, .rack-fw-fan-2') || []);
    this._upsScreens = Array.from(this._container?.querySelectorAll('.rack-ups-lcd-screen') || []);
    this._upsLcdPageIdx = 0;
    this._upsScreens.forEach(screen => {
      screen.querySelectorAll('.rack-ups-lcd-page').forEach((p, i) =>
        p.classList.toggle('rack-ups-lcd-page-active', i === 0));
    });

    this._deviceEffectsTick = 0;
    this._fanAngle = 0;

    // Single 2s timer handles everything — slow enough to let GPU idle between ticks
    this._deviceEffectsTimer = setInterval(() => {
      if (!this._idleActive) return;
      this._deviceEffectsTick++;

      // Port + storage LEDs: toggle 2 random groups
      const cache = this._portLedGroupCache;
      if (cache) {
        for (let t = 0; t < 2; t++) {
          const g = Math.floor(Math.random() * 8);
          const isDim = cache[g].length && cache[g][0].classList.contains('rack-port-led-dim');
          cache[g].forEach(p => p.classList.toggle('rack-port-led-dim', !isDim));
          this._storageLedCache[g]?.forEach(p => p.classList.toggle('rack-storage-led-dim', !isDim));
        }
      }

      // Device LEDs: toggle 1 group every other tick
      if (this._deviceEffectsTick % 2 === 0) {
        const dg = Math.floor(Math.random() * 4);
        const dDim = this._deviceLedCache[dg]?.length && this._deviceLedCache[dg][0].classList.contains('rack-device-led-dim');
        this._deviceLedCache[dg]?.forEach(p => p.classList.toggle('rack-device-led-dim', !dDim));
      }

      // Fan rotation: 15° per tick = full rotation in ~19s (subtle spin)
      this._fanAngle = (this._fanAngle + 15) % 360;
      this._fanEls.forEach(f => f.style.transform = `rotate(${this._fanAngle}deg)`);

      // UPS LCD page: cycle every 3 ticks (6s)
      if (this._deviceEffectsTick % 3 === 0) {
        this._upsLcdPageIdx = (this._upsLcdPageIdx + 1) % 4;
        const idx = this._upsLcdPageIdx;
        this._upsScreens.forEach(screen => {
          screen.querySelectorAll('.rack-ups-lcd-page').forEach((p, i) =>
            p.classList.toggle('rack-ups-lcd-page-active', i === idx));
        });
      }
    }, 2000);
  },

  _stopDeviceEffectsTimer() {
    if (this._deviceEffectsTimer) { clearInterval(this._deviceEffectsTimer); this._deviceEffectsTimer = null; }
    this._portLedGroupCache = null;
    this._storageLedCache = null;
    this._deviceLedCache = null;
    this._fanEls = null;
    this._upsScreens = null;
    this._container?.querySelectorAll('.rack-port-led-dim').forEach(p => p.classList.remove('rack-port-led-dim'));
    this._container?.querySelectorAll('.rack-storage-led-dim').forEach(p => p.classList.remove('rack-storage-led-dim'));
    this._container?.querySelectorAll('.rack-device-led-dim').forEach(p => p.classList.remove('rack-device-led-dim'));
  },

  _stopIdleAnimations() {
    this._idleActive = false;
    this._idleTimers.forEach(t => clearTimeout(t));
    this._idleTimers = [];
    this._stopIdleTraffic();
    this._stopDeviceEffectsTimer();
  },

  // ─── Idle Cable Traffic ─────────────────────────────────
  // Background packets on cables: dim blue intra-rack hops + gold cross-rack trunk dots.
  // Yields to badge ingress (skips busy cables). Respects reduced-motion and FX toggle.

  _idleTrafficTimers: [],

  _startIdleTraffic() {
    this._stopIdleTraffic();
    if (!this._cableSvg || !this._cablePaths) return;

    // Intra-rack hops: blue dots, 4-8s interval
    const intraHops = [
      { cable: 2, from: 'fw-a' },     // FW-A → Core A
      { cable: 3, from: 'fw-b' },     // FW-B → Core B
      { cable: 4, from: 'core-a' },   // Core A → BRS inbound
      { cable: 5, from: 'brs' },      // BRS → Core A outbound
      { cable: 6, from: 'wlc' },      // WLC → Core A
      { cable: 7, from: 'wlc' },      // WLC → WiFi AP
      { cable: 8, from: 'core-a' },   // Core A → IT switch
      { cable: 9, from: 'core-a' },   // Core A → Punk switch
      { cable: 10, from: 'vpn' },     // VPN → Core B
      { cable: 11, from: 'core-b' },  // Core B → Office switch
      { cable: 12, from: 'core-b' },  // Core B → Corporate switch
      { cable: 13, from: 'vpn' },     // VPN → Contractors switch
      { cable: 16, from: 'core-b' },  // Core B → BRS-02 inbound
      { cable: 17, from: 'brs-02' },  // BRS-02 → Core B outbound
    ];

    const fireIntra = () => {
      if (this._reducedMotion || document.body.classList.contains('fx-off')) {
        this._idleTrafficTimers.push(setTimeout(fireIntra, 4000 + Math.random() * 4000));
        return;
      }
      const hop = intraHops[Math.floor(Math.random() * intraHops.length)];
      if (!this._cableBusy?.get(hop.cable)) {
        const dot = this._createDotPacket('#E2E8F0', 5, 0.6);
        if (dot) {
          const pkt = { el: dot, type: 'dot' };
          this._movePacketAlongCable(pkt, hop.cable, hop.from, 0.6)
            .then(() => { dot.remove(); })
            .catch(() => { dot.remove(); });
        }
      }
      this._idleTrafficTimers.push(setTimeout(fireIntra, 12000 + Math.random() * 8000));
    };
    this._idleTrafficTimers.push(setTimeout(fireIntra, 5000 + Math.random() * 5000));

    // Cross-rack trunk: gold dots, 10-15s interval
    const fireTrunk = () => {
      if (this._reducedMotion || document.body.classList.contains('fx-off')) {
        this._idleTrafficTimers.push(setTimeout(fireTrunk, 10000 + Math.random() * 5000));
        return;
      }
      // Alternate direction: cable 0 (A→B) or cable 1 (B→A)
      const cableIdx = Math.random() < 0.5 ? 0 : 1;
      const fromNode = cableIdx === 0 ? 'core-a' : 'core-b';
      if (!this._cableBusy?.get(cableIdx)) {
        const dot = this._createDotPacket('#E2E8F0', 5.5, 0.65);
        if (dot) {
          const pkt = { el: dot, type: 'dot' };
          this._movePacketAlongCable(pkt, cableIdx, fromNode, 0.5)
            .then(() => { dot.remove(); })
            .catch(() => { dot.remove(); });
        }
      }
      this._idleTrafficTimers.push(setTimeout(fireTrunk, 20000 + Math.random() * 10000));
    };
    this._idleTrafficTimers.push(setTimeout(fireTrunk, 10000 + Math.random() * 5000));
  },

  _stopIdleTraffic() {
    this._idleTrafficTimers.forEach(t => clearTimeout(t));
    this._idleTrafficTimers = [];
  },

  // Resolve materialize step coords and fire visual trigger
  _getMaterializeCoords(node) {
    if (node === 'wifi-ap') return this._virtualCoords?.wifiAp;
    if (node === 'cloud-a') return this._virtualCoords?.cloudA;
    if (node === 'cloud-b') return this._virtualCoords?.cloudB;
    return null;
  },

  _fireMaterializeTrigger(node) {
    if (node === 'wifi-ap') {
      this._triggerFlash(this._container.querySelector('.rack-device-wifi'), 'rack-trigger-wifi-burst', 1200);
    } else {
      const cloudSide = node === 'cloud-a' ? 'A' : 'B';
      this._triggerFlash(this._container.querySelector(`[data-cloud-side="${cloudSide}"]`), 'rack-trigger-cloud-pulse', 1200);
    }
  },

  // Badge materialization — two modes:
  //   'cloud': blue/white binary rain from cloud, assembles portrait top-down
  //   'wifi':  green signal fragments radiate from antennas, get captured, assemble portrait top-down
  async _materializeBadge(pkt, x, y, duration = 1200, mode = 'cloud') {
    if (!this._cableSvg || !pkt.el) return;
    const svg = this._cableSvg;
    const r = 16;
    const particles = [];
    const particleCount = 32;
    const formY = y;

    // Mode-specific config
    const isWifi = mode === 'wifi';
    const scanColor = isWifi ? '#22C55E' : '#93C5FD';
    const particleColors = isWifi
      ? ['#22C55E', '#4ADE80', '#86EFAC', '#FFFFFF', '#16A34A', '#4ADE80']
      : ['#5B8DEF', '#93C5FD', '#B4D4FF', '#FFFFFF', '#5B8DEF', '#FFFFFF'];
    const particleChars = isWifi
      ? [')', '))', ')))', '~', '~', '▂', '▄', '▆', '█', '0', '1', '·']
      : ['0', '1'];

    // Position the badge at formation point, hidden via clip
    pkt.el.setAttribute('transform', `translate(${x},${formY})`);
    pkt.el.setAttribute('opacity', '1');

    // Growing clip-path to reveal badge top-to-bottom
    const clipId = `mat-clip-${this._packetClipId++}`;
    const clipEl = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clipEl.setAttribute('id', clipId);
    const clipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    clipRect.setAttribute('x', -r - 2);
    clipRect.setAttribute('y', -r - 2);
    clipRect.setAttribute('width', r * 2 + 4);
    clipRect.setAttribute('height', 0);
    clipEl.appendChild(clipRect);
    pkt.el.insertBefore(clipEl, pkt.el.firstChild);

    const img = pkt.el.querySelector('image');
    const ring = pkt.el.querySelector('circle[stroke]');
    const origImgClip = img ? img.getAttribute('clip-path') : '';
    if (img) img.setAttribute('clip-path', `url(#${clipId})`);
    if (ring) ring.setAttribute('clip-path', `url(#${clipId})`);

    // Scanline
    const scanline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    scanline.setAttribute('x', -r - 4);
    scanline.setAttribute('width', r * 2 + 8);
    scanline.setAttribute('height', 2);
    scanline.setAttribute('fill', scanColor);
    scanline.setAttribute('opacity', '0.9');
    scanline.setAttribute('filter', 'url(#packet-glow)');
    pkt.el.appendChild(scanline);

    // Spawn particles
    for (let i = 0; i < particleCount; i++) {
      const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.textContent = particleChars[Math.floor(Math.random() * particleChars.length)];
      txt.setAttribute('font-family', 'monospace');
      txt.setAttribute('font-size', `${9 + Math.random() * 5}`);
      txt.setAttribute('fill', particleColors[Math.floor(Math.random() * particleColors.length)]);
      txt.setAttribute('opacity', String(0.4 + Math.random() * 0.5));
      txt.setAttribute('text-anchor', 'middle');

      let px, py;
      if (isWifi) {
        // WiFi: radiate outward from antenna area, then converge inward
        // Start in a wide ring around the AP, like signals being captured
        const angle = Math.random() * Math.PI * 2;
        const dist = 25 + Math.random() * 40; // 25-65px out from center
        px = x + Math.cos(angle) * dist;
        py = y + Math.sin(angle) * dist * 0.6; // slightly flattened vertically
      } else {
        // Cloud: start inside cloud above, fall down
        px = x + (Math.random() - 0.5) * r * 6;
        py = y - 15 - Math.random() * 40;
      }

      txt.setAttribute('x', px);
      txt.setAttribute('y', py);
      svg.appendChild(txt);

      const arrivalT = 0.1 + (i / particleCount) * 0.75;
      particles.push({
        el: txt, startX: px, startY: py,
        targetX: x + (Math.random() - 0.5) * r * 0.8,
        arrivalT,
      });
    }

    // Cleanup helper — always call this, even on cancel
    const cleanup = () => {
      for (const p of particles) { if (p.el.parentNode) p.el.remove(); }
      if (scanline.parentNode) scanline.remove();
      if (clipEl.parentNode) clipEl.remove();
      if (img && origImgClip) img.setAttribute('clip-path', origImgClip);
      else if (img) img.removeAttribute('clip-path');
      if (ring) ring.removeAttribute('clip-path');
    };

    // Animate: clip reveal + particles converge
    const startTime = performance.now();
    try {
      await new Promise(resolve => {
        const animate = (now) => {
          // Bail if packet was cancelled (resize, destroy)
          if (pkt._cancelled || !pkt.el || !pkt.el.parentNode) { resolve(); return; }

          const elapsed = (now - startTime) / duration;
          const t = Math.max(0, Math.min(elapsed, 1));

          // Reveal badge top-to-bottom
          const revealH = t * (r * 2 + 4);
          clipRect.setAttribute('height', revealH);

          // Scanline position
          const scanY = -r - 2 + revealH;
          scanline.setAttribute('y', scanY);
          scanline.setAttribute('opacity', String(t < 0.9 ? 0.9 : (1 - t) * 9));

          // Scanline world-Y position (relative to SVG, not to the <g>)
          const scanWorldY = formY - r - 2 + revealH;

          // Animate particles flying into the scanline
          for (const p of particles) {
            if (p.done) continue;
            // Progress toward arrival: 0 = just started, 1 = reached scanline
            const pt = Math.max(0, Math.min(1, t / p.arrivalT));
            const ease = pt * pt; // ease-in: accelerate into the line

            // Fly toward the scanline's current position
            const targetY = scanWorldY;
            p.el.setAttribute('x', p.startX + (p.targetX - p.startX) * ease);
            p.el.setAttribute('y', p.startY + (targetY - p.startY) * ease);

            if (pt >= 1) {
              // Hit the scanline — bright flash then disappear
              p.el.setAttribute('fill', '#FFFFFF');
              p.el.setAttribute('opacity', '1');
              p.el.setAttribute('font-size', '14');
              setTimeout(() => { if (p.el.parentNode) p.el.setAttribute('opacity', '0'); }, 60);
              p.done = true;
            } else {
              // Approaching — get brighter as they get closer
              p.el.setAttribute('opacity', String(0.3 + pt * 0.5));
            }
          }

          if (t >= 1) { resolve(); return; }
          requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      });
    } finally {
      cleanup();
    }
  },

  // Beam down transport — cone of light from switch port to patch panel port
  // Narrow at source (switch port), widens to frame the destination (patch port)
  async _beamDown(pkt, fromX, fromY, toX, toY, duration = 2000) {
    if (!this._cableSvg || !pkt.el) return;
    const svg = this._cableSvg;
    const r = 20; // badge radius

    let beam = null;
    let scanline = null;
    let clipEl = null;
    const img = pkt.el.querySelector('image');
    const ring = pkt.el.querySelector('circle[stroke]');
    let origImgClip = null;

    try {
      // Phase 1: Shrink badge at switch port, then hide it (150ms)
      const shrinkDur = 150;
      const startTime = performance.now();
      await new Promise(resolve => {
        const animate = (now) => {
          if (pkt._cancelled || !pkt.el || !pkt.el.parentNode) { resolve(); return; }
          const t = Math.min((now - startTime) / shrinkDur, 1);
          const s = 1 - t;
          pkt.el.setAttribute('transform', `translate(${fromX},${fromY}) scale(${s})`);
          pkt.el.setAttribute('opacity', String(1 - t));
          if (t >= 1) { resolve(); return; }
          requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      });

      // Phase 2: Cone beam fires from switch to patch panel (300ms)
      beam = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      const narrowW = 2;
      const wideW = r + 4;
      beam.setAttribute('points',
        `${fromX - narrowW},${fromY} ${fromX + narrowW},${fromY} ${toX + wideW},${toY} ${toX - wideW},${toY}`
      );

      // Add gradient if not exists
      let defs = svg.querySelector('defs');
      if (defs && !svg.querySelector('#beam-gradient')) {
        const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        grad.setAttribute('id', 'beam-gradient');
        grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
        grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
        const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', '#93C5FD'); s1.setAttribute('stop-opacity', '0.8');
        const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', '#3B82F6'); s2.setAttribute('stop-opacity', '0.4');
        grad.appendChild(s1); grad.appendChild(s2);
        defs.appendChild(grad);
      }

      beam.setAttribute('fill', 'url(#beam-gradient)');
      beam.setAttribute('opacity', '0');
      beam.classList.add('rack-beam');
      svg.appendChild(beam);

      // Beam fade in
      const beamInStart = performance.now();
      await new Promise(resolve => {
        const animate = (now) => {
          if (pkt._cancelled) { resolve(); return; }
          const t = Math.min((now - beamInStart) / 300, 1);
          beam.setAttribute('opacity', String(t * 0.7));
          if (t >= 1) { resolve(); return; }
          requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      });

      // Phase 3: Badge materializes bottom-up at destination inside beam (800ms)
      // Move badge to destination, set up clip for bottom-up reveal
      pkt.el.setAttribute('transform', `translate(${toX},${toY})`);
      pkt.el.setAttribute('opacity', '1');

      const clipId = `beam-clip-${this._packetClipId++}`;
      clipEl = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
      clipEl.setAttribute('id', clipId);
      const clipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      clipRect.setAttribute('x', -r - 2);
      clipRect.setAttribute('width', r * 2 + 4);
      // Start at bottom, height 0
      clipRect.setAttribute('y', r + 2); // bottom of badge
      clipRect.setAttribute('height', 0);
      clipEl.appendChild(clipRect);
      pkt.el.insertBefore(clipEl, pkt.el.firstChild);

      origImgClip = img ? img.getAttribute('clip-path') : '';
      if (img) img.setAttribute('clip-path', `url(#${clipId})`);
      if (ring) ring.setAttribute('clip-path', `url(#${clipId})`);

      // Scanline — bright line at the reveal edge, moving upward
      scanline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      scanline.setAttribute('x', -r - 4);
      scanline.setAttribute('width', r * 2 + 8);
      scanline.setAttribute('height', 2);
      scanline.setAttribute('fill', '#93C5FD');
      scanline.setAttribute('opacity', '0.9');
      scanline.setAttribute('filter', 'url(#packet-glow)');
      pkt.el.appendChild(scanline);

      const revealDur = duration - 150 - 300 - 150; // ~800ms
      const revealStart = performance.now();
      const totalH = r * 2 + 4;
      await new Promise(resolve => {
        const animate = (now) => {
          if (pkt._cancelled || !pkt.el || !pkt.el.parentNode) { resolve(); return; }
          const t = Math.max(0, Math.min((now - revealStart) / revealDur, 1));

          // Reveal bottom-up: clip rect grows upward from bottom
          const revealH = t * totalH;
          clipRect.setAttribute('y', r + 2 - revealH);
          clipRect.setAttribute('height', revealH);

          // Scanline at the top edge of the reveal, moving up
          const scanY = r + 2 - revealH;
          scanline.setAttribute('y', scanY - 1);
          scanline.setAttribute('opacity', String(t < 0.9 ? 0.9 : (1 - t) * 9));

          // Beam fades out as badge forms
          beam.setAttribute('opacity', String(Math.max(0, 0.7 * (1 - t * 0.8))));

          if (t >= 1) { resolve(); return; }
          requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      });

      // Phase 4: Settle
      await this._delay(150);
    } finally {
      if (beam && beam.parentNode) beam.remove();
      if (scanline && scanline.parentNode) scanline.remove();
      if (clipEl && clipEl.parentNode) clipEl.remove();
      if (img && origImgClip) img.setAttribute('clip-path', origImgClip);
      else if (img) img.removeAttribute('clip-path');
      if (ring) ring.removeAttribute('clip-path');
    }
  },

  // ─── Ingress Orchestration ─────────────────────────────

  // Execute a resolved route — walks step array, fires triggers, handles all animation
  async _executeRoute(badge, route, pkt) {
    for (const step of route.steps) {
      if (pkt._cancelled) break;

      switch (step.type) {
        case 'materialize': {
          const coords = this._getMaterializeCoords(step.node);
          if (coords) {
            this._fireMaterializeTrigger(step.node);
            await this._materializeBadge(pkt, coords.x, coords.y, 1200, step.mode);
          }
          break;
        }

        case 'cable': {
          if (step.cable == null) break;
          // Core CLI fires BEFORE cable movement — core "decides" route, then packet departs
          if (step.coreTrigger === 'core-cli') {
            const coreSide = step.cliCore
              || (step.from === 'core-a' ? 'A' : step.from === 'core-b' ? 'B' : null);
            if (coreSide) this._triggerCoreCli(coreSide, route);
          }
          const cableSpeed = this._CABLE_SPEEDS[step.cable] ?? 0.4;
          await this._movePacketAlongCable(pkt, step.cable, step.from, cableSpeed);
          // Fire arrival triggers after cable movement
          if (step.trigger === 'fw-inspect') {
            const fwSide = step.triggerNode === 'fw-a' ? 'A' : 'B';
            this._triggerFWInspect(this._container.querySelector(`[data-fw-side="${fwSide}"]`), step.pause || 1200);
          } else if (step.trigger === 'vpn-tunnel') {
            this._triggerFlash(this._container.querySelector('[data-device-type="vpn"]'), 'rack-trigger-vpn-tunnel', 500);
            this._triggerVPNSession();
          } else if (step.trigger === 'wlc-bump') {
            this._triggerWLCBump();
          }
          if (step.pause) await this._delay(step.pause);
          break;
        }

        case 'brs-render': {
          const brsId = step.brsId || 'brs-01';
          const brsPause = step.pause || 1500;
          // Wait for BRS to become free (promise-based, woken when render completes)
          if (this._brsBusy[brsId]) {
            if (!this._brsWaiters) this._brsWaiters = {};
            await Promise.race([
              new Promise(resolve => { this._brsWaiters[brsId] = resolve; }),
              this._delay(brsPause + 500),
            ]);
            delete this._brsWaiters?.[brsId];
          }
          if (this._brsBusy[brsId]) break; // still busy after timeout — skip
          try {
            this._brsBusy[brsId] = true;
            this.triggerBRSRender(badge, brsPause, brsId);
            await this._delay(brsPause);
          } finally {
            this._brsBusy[brsId] = false;
            // Wake any packet waiting for this BRS
            if (this._brsWaiters?.[brsId]) { this._brsWaiters[brsId](); delete this._brsWaiters[brsId]; }
          }
          break;
        }

        case 'beam-down': {
          const dt = step.divTheme;
          const panel = this._container.querySelector(`[data-panel-key="${CSS.escape(dt)}"]`);
          const sw = this._container.querySelector(`.rack-device-switch[data-theme="${CSS.escape(dt)}"]`);
          const filled = panel?.querySelectorAll('.rack-port:not(.rack-port-empty)').length || 0;

          let srcCoords = null;
          if (sw) {
            const switchPort = sw.querySelector(`[data-switch-port="${filled}"]`);
            if (switchPort) {
              // Activate the switch port LED as the badge beams down
              if (!switchPort.classList.contains('rack-conn-port-active')) {
                switchPort.classList.add('rack-conn-port-active', 'rack-conn-port-dual');
                const pIdx = parseInt(switchPort.dataset.switchPort || '0', 10);
                const sSeed = Array.from(dt).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
                switchPort.classList.add(`rack-port-group-${((Math.abs(sSeed) * 7 + pIdx * 3) % 8)}`);
              }
              this._triggerFlash(switchPort, 'rack-trigger-switch-flash', 800);
              srcCoords = this._getPortCoords(this._container, `.rack-device-switch[data-theme="${CSS.escape(dt)}"] [data-switch-port="${filled}"]`);
            }
          }
          if (!srcCoords) srcCoords = this._virtualCoords?.switchBottom[dt];

          let destCoords = null;
          const empty = panel?.querySelector('.rack-port-empty');
          if (empty) {
            destCoords = this._getPortCoords(this._container, `[data-panel-key="${CSS.escape(dt)}"] .rack-port-empty`);
          }
          if (!destCoords && panel) {
            const pr = panel.getBoundingClientRect();
            const ref = this._container.querySelector('.rack-frames-row')?.getBoundingClientRect();
            if (ref) destCoords = { x: pr.left + pr.width / 2 - ref.left, y: pr.top + pr.height / 2 - ref.top };
          }

          if (srcCoords && destCoords) {
            await this._beamDown(pkt, srcCoords.x, srcCoords.y, destCoords.x, destCoords.y, 2000);
          }
          break;
        }

        case 'place-badge': {
          const portEl = this._placeBadgePort(badge);
          if (portEl) {
            portEl.classList.add('rack-trigger-arrival-burst');
            setTimeout(() => portEl.classList.remove('rack-trigger-arrival-burst'), 1500);
          }
          break;
        }
      }
    }
  },

  async _playIngress(badge) {
    if (!this._container || !this._cableSvg || !this._virtualCoords || this._reducedMotion) {
      this._placeBadgePort(badge);
      return;
    }

    const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
    const entryType = Math.random() < 0.15 ? 'wifi' : 'firewall';
    const route = this._resolveRoute(entryType, divTheme);

    if (!route) {
      this._placeBadgePort(badge);
      return;
    }

    const pkt = { el: this._createBadgePacket(badge) };
    if (!pkt.el) {
      this._placeBadgePort(badge);
      return;
    }

    try {
      await this._executeRoute(badge, route, pkt);
    } catch (err) {
      this._placeBadgePort(badge);
    } finally {
      this._removePacket(pkt);
    }
  },

  _renderCables(container) {
    // Create SVG element sized to the rack container
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('rack-cable-svg');
    svg.setAttribute('aria-hidden', 'true');

    // Add glow filter for packet visibility
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'packet-glow');
    filter.setAttribute('x', '-50%'); filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%'); filter.setAttribute('height', '200%');
    const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    blur.setAttribute('stdDeviation', '3');
    blur.setAttribute('result', 'glow');
    const merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
    const mn1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    mn1.setAttribute('in', 'glow');
    const mn2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    mn2.setAttribute('in', 'SourceGraphic');
    merge.appendChild(mn1); merge.appendChild(mn2);
    filter.appendChild(blur); filter.appendChild(merge);
    defs.appendChild(filter);
    svg.appendChild(defs);

    // Insert SVG into the frames row (between the two rack columns)
    const framesRow = container.querySelector('.rack-frames-row');
    if (!framesRow) return;
    framesRow.style.position = 'relative';
    framesRow.appendChild(svg);

    this._cableSvg = svg;
    this._updateCablePaths(container);
  },

  _updateCablePaths(container) {
    const svg = this._cableSvg;
    if (!svg) return;

    const framesRow = container.querySelector('.rack-frames-row');
    if (!framesRow) return;

    const rawRect = framesRow.getBoundingClientRect();
    const s = this._zoomScale || 1;
    // Unscale: getBoundingClientRect returns scaled screen pixels, SVG needs unscaled coords
    const containerRect = {
      left: rawRect.left, top: rawRect.top,
      width: rawRect.width / s, height: rawRect.height / s,
    };
    svg.setAttribute('width', containerRect.width);
    svg.setAttribute('height', containerRect.height);
    svg.setAttribute('viewBox', `0 0 ${containerRect.width} ${containerRect.height}`);

    // Clear existing cable paths (preserve <defs> for packet glow filter)
    svg.querySelectorAll('.rack-cable-path').forEach(p => p.remove());
    // Also clear any lingering packet circles
    svg.querySelectorAll('.rack-packet').forEach(p => p.remove());

    // Initialize cable path index and pre-sampled points
    this._cablePaths = new Map();
    this._cableBusy = new Map();
    this._cablePathSamples = new Map();

    // Get rack frame edges for cable routing gutters
    const frames = container.querySelectorAll('.rack-frame');
    const frameEdges = {};
    frames.forEach(f => {
      const id = f.getAttribute('data-rack-id');
      const fr = f.getBoundingClientRect();
      frameEdges[id] = {
        right: (fr.right - rawRect.left) / s,
        left: (fr.left - rawRect.left) / s,
      };
    });

    // Lane counters for staggering parallel cables in the same gutter
    const rightLanes = { A: 0, B: 0 };
    const leftLanes = { A: 0, B: 0 };
    const staggerIdxByRack = { A: 0, B: 0 };
    let crossRackLane = 0;

    // Draw each cable
    this._CABLE_DEFS.forEach((def, cableIdx) => {
      const [fromId, toId, color, width, routeType, style] = def;
      const fromEl = container.querySelector(`[data-port-id="${fromId}"]`);
      const toEl = container.querySelector(`[data-port-id="${toId}"]`);
      if (!fromEl || !toEl) return;

      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      // Center points relative to framesRow (unscaled)
      const x1 = (fromRect.left + fromRect.width / 2 - rawRect.left) / s;
      const y1 = (fromRect.top + fromRect.height / 2 - rawRect.top) / s;
      const x2 = (toRect.left + toRect.width / 2 - rawRect.left) / s;
      const y2 = (toRect.top + toRect.height / 2 - rawRect.top) / s;

      // Find parent rack frame for edge calculations
      const fromFrame = fromEl.closest('.rack-frame');
      const toFrame = toEl.closest('.rack-frame');
      const rackId = fromFrame ? fromFrame.getAttribute('data-rack-id') : null;
      const rackSide = rackId && rackId.includes('101') ? 'A' : 'B';
      const edges = rackId && frameEdges[rackId] ? frameEdges[rackId] : { right: Math.max(x1, x2) + 40, left: Math.min(x1, x2) - 40 };

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let d;

      switch (routeType) {
        case 'cloud-drop':
          // Gentle curve from cloud (above SVG, negative y) down to FW WAN or WiFi AP
          d = this._cloudDropPath(x1, y1, x2, y2);
          break;
        case 'cross-rack':
          d = this._crossRackPath(x1, y1, x2, y2, crossRackLane);
          crossRackLane++;
          break;
        case 'drop-left':
          // Vertical drop nudged left to avoid CRISCO silkscreen
          d = this._dropLeftPath(x1, y1, x2, y2);
          break;
        case 'drop-straight': {
          // Short vertical drop — slight rightward arc, parallel runs
          // Arc amount based on horizontal distance between endpoints
          const dxDrop = Math.abs(x2 - x1);
          const dropArcX = Math.max(x1, x2) + 6 + dxDrop * 0.5;
          d = `M ${x1} ${y1} Q ${dropArcX} ${(y1 + y2) / 2}, ${x2} ${y2}`;
          break;
        }
        case 'arc-left':
          // Left gutter routing — WLC uses this
          d = this._arcLeftPath(x1, y1, x2, y2, edges.left - 22 - (leftLanes[rackSide] * 10));
          leftLanes[rackSide]++;
          break;
        case 'margin-left-down': {
          // Exit down first to clear adjacent ports, then left gutter up to target
          const gutterX = edges.left - 22 - (leftLanes[rackSide] * 10);
          d = this._marginLeftDownPath(x1, y1, x2, y2, gutterX);
          leftLanes[rackSide]++;
          break;
        }
        case 'margin-right': {
          // Right gutter routing — keep tight to rack edge, especially Rack A (center-gap side)
          const gutterX = edges.right + 8 + (rightLanes[rackSide] * 14);
          d = this._marginRoutedPath(x1, y1, x2, y2, gutterX, 10);
          rightLanes[rackSide]++;
          break;
        }
        case 'margin-right-stagger': {
          // Right gutter with staggered vertical entry into core port
          const gutterX = edges.right + 8 + (rightLanes[rackSide] * 14);
          const staggerBase = def[6] != null ? def[6] : 30;
          d = this._marginStaggerPath(x1, y1, x2, y2, gutterX, staggerIdxByRack[rackSide], staggerBase);
          rightLanes[rackSide]++;
          staggerIdxByRack[rackSide]++;
          break;
        }
        case 'under-and-up': {
          // Down from port → right gutter close to rack edge → curve up to target above
          const gutterX = edges.right + 10;
          d = this._underAndUpPath(x1, y1, x2, y2, gutterX);
          break;
        }
        default:
          if (routeType && routeType.startsWith('margin-left-')) {
            const offset = parseInt(routeType.split('-')[2], 10) || 24;
            const gutterX = edges.left - 3 - (leftLanes[rackSide] * 8);
            d = this._marginLeftPath(x1, y1, x2, y2, gutterX, offset);
            leftLanes[rackSide]++;
          } else {
            d = `M ${x1} ${y1} L ${x2} ${y2}`;
          }
      }

      path.setAttribute('d', d);
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', width);
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', '0.85');
      if (style === 'dashed') path.setAttribute('stroke-dasharray', '6 4');
      path.classList.add('rack-cable-path');
      path.setAttribute('data-cable-index', cableIdx);
      path.id = `rack-cable-${cableIdx}`;

      svg.appendChild(path);

      // Index for packet animation
      this._cablePaths.set(cableIdx, path);
      this._cableBusy.set(cableIdx, false);

      // Pre-sample path points for fast lerp animation (avoids per-frame getPointAtLength)
      const totalLen = path.getTotalLength();
      const sampleCount = 60;
      const samples = new Float32Array(sampleCount * 2);
      for (let s = 0; s < sampleCount; s++) {
        const pt = path.getPointAtLength((s / (sampleCount - 1)) * totalLen);
        samples[s * 2] = pt.x;
        samples[s * 2 + 1] = pt.y;
      }
      this._cablePathSamples.set(cableIdx, { samples, totalLen });
    });

    // Cache virtual edge positions (cloud drops, switch→patch drops)
    this._computeVirtualCoords(container);
  },

  _cloudDropPath(x1, y1, x2, y2) {
    // Gentle S-curve from cloud (above SVG) down to FW WAN port or WiFi AP
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  },

  _dropLeftPath(x1, y1, x2, y2) {
    // FW → Core vertical drop, nudged left to avoid silkscreen
    const nudge = -3;
    const midY = (y1 + y2) / 2;
    const midX = Math.min(x1, x2) + nudge;
    return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  },

  _marginLeftPath(x1, y1, x2, y2, gutterX, entryOffset) {
    // Left gutter routing: port → left to gutter → vertical up → curve in below port height → up to port
    const r = 8;
    const topY = Math.min(y1, y2);
    const botY = Math.max(y1, y2);
    const topX = y1 < y2 ? x1 : x2;
    const botX = y1 < y2 ? x2 : x1;
    const entryY = topY + entryOffset;

    return `M ${botX} ${botY} `
      + `L ${gutterX + r} ${botY} `
      + `Q ${gutterX} ${botY}, ${gutterX} ${botY - r} `
      + `L ${gutterX} ${entryY + r} `
      + `Q ${gutterX} ${entryY}, ${gutterX + r} ${entryY} `
      + `L ${topX} ${entryY} `
      + `L ${topX} ${topY}`;
  },

  _marginLeftDownPath(x1, y1, x2, y2, gutterX) {
    // WLC AP port → drop down first to clear adjacent ports → left to gutter → up to WiFi AP
    const r = 8;
    const dropBelow = 20; // drop below WLC port before turning left
    // WLC is lower (from), WiFi AP is higher (to)
    const topY = Math.min(y1, y2); // WiFi AP
    const botY = Math.max(y1, y2); // WLC port
    const topX = y1 < y2 ? x1 : x2;
    const botX = y1 < y2 ? x2 : x1;
    const loopY = botY + dropBelow;

    // Entry between WLC run (direct at port height) and BRS inbound run (24px offset)
    const entryY = topY + 14;

    return `M ${botX} ${botY} `
      + `L ${botX} ${loopY - r} `
      + `Q ${botX} ${loopY}, ${botX - r} ${loopY} `
      + `L ${gutterX + r} ${loopY} `
      + `Q ${gutterX} ${loopY}, ${gutterX} ${loopY - r} `
      + `L ${gutterX} ${entryY + r} `
      + `Q ${gutterX} ${entryY}, ${gutterX + r} ${entryY} `
      + `L ${topX} ${entryY} `
      + `L ${topX} ${topY}`;
  },


  _arcLeftPath(x1, y1, x2, y2, gutterX) {
    // Curved exit → straight vertical run in left gutter → curved entry direct to port
    const r = 8;
    const topY = Math.min(y1, y2);
    const botY = Math.max(y1, y2);
    const topX = y1 < y2 ? x1 : x2;
    const botX = y1 < y2 ? x2 : x1;

    return `M ${botX} ${botY} `
      + `L ${gutterX + r} ${botY} `
      + `Q ${gutterX} ${botY}, ${gutterX} ${botY - r} `
      + `L ${gutterX} ${topY + r} `
      + `Q ${gutterX} ${topY}, ${gutterX + r} ${topY} `
      + `L ${topX} ${topY}`;
  },

  _marginRoutedPath(x1, y1, x2, y2, gutterX, entryNudge) {
    // Route from switch SFP → right gutter → up to core port
    // entryNudge pushes the core-side entry point down slightly to clear cross-rack cable
    const r = 8;
    const topY = Math.min(y1, y2) + (entryNudge || 0);
    const botY = Math.max(y1, y2);
    const topX = y1 < y2 ? x1 : x2;
    const botX = y1 < y2 ? x2 : x1;

    return `M ${botX} ${botY} `
      + `L ${gutterX - r} ${botY} `
      + `Q ${gutterX} ${botY}, ${gutterX} ${botY - r} `
      + `L ${gutterX} ${topY + r} `
      + `Q ${gutterX} ${topY}, ${gutterX - r} ${topY} `
      + `L ${topX} ${topY}`;
  },

  _marginStaggerPath(x1, y1, x2, y2, gutterX, staggerIdx, baseOffset = 30) {
    // Right gutter with staggered entry into core ports
    // Each cable enters at a different height below the port, then goes straight up
    // This creates clean, non-overlapping vertical connections
    const r = 8;
    const staggerStep = 6; // vertical spacing between staggered cables
    const topY = Math.min(y1, y2);
    const botY = Math.max(y1, y2);
    const topX = y1 < y2 ? x1 : x2;
    const botX = y1 < y2 ? x2 : x1;

    // Entry point: outer cables (higher index) enter closer to port, inner cables enter lower
    // This nests cables cleanly — outer wraps around inner without crossing
    const entryY = topY + baseOffset - (staggerIdx * staggerStep);

    return `M ${botX} ${botY} `
      + `L ${gutterX - r} ${botY} `
      + `Q ${gutterX} ${botY}, ${gutterX} ${botY - r} `
      + `L ${gutterX} ${entryY + r} `
      + `Q ${gutterX} ${entryY}, ${gutterX - r} ${entryY} `
      + `L ${topX} ${entryY} `
      + `L ${topX} ${topY}`;
  },

  _underAndUpPath(x1, y1, x2, y2, gutterX) {
    // VPN (lower) → down → right gutter → curve up → over to Contractors SFP (higher)
    // from = VPN port (lower), to = Contractors SFP (higher)
    const r = 8;
    const dropBelow = 30; // how far below the VPN port before turning right
    const topY = Math.min(y1, y2); // Contractors (target)
    const botY = Math.max(y1, y2); // VPN (source)
    const topX = y1 < y2 ? x1 : x2; // Contractors x
    const botX = y1 < y2 ? x2 : x1; // VPN x
    const loopY = botY + dropBelow; // lowest point of the cable

    return `M ${botX} ${botY} `
      + `L ${botX} ${loopY - r} `
      + `Q ${botX} ${loopY}, ${botX + r} ${loopY} `
      + `L ${gutterX - r} ${loopY} `
      + `Q ${gutterX} ${loopY}, ${gutterX} ${loopY - r} `
      + `L ${gutterX} ${topY + r} `
      + `Q ${gutterX} ${topY}, ${gutterX - r} ${topY} `
      + `L ${topX} ${topY}`;
  },

  _crossRackPath(x1, y1, x2, y2, lane) {
    // Arc across the gap between racks — stagger vertically for parallel trunks
    const laneOffset = (lane || 0) * 16;
    const midY = Math.min(y1, y2) - 8 - laneOffset;
    return `M ${x1} ${y1} C ${x1 + 30} ${midY}, ${x2 - 30} ${midY}, ${x2} ${y2}`;
  },

  // ─── Debug Step-Through Panel ──────────────────────────
  // Toggle with: RackRenderer._toggleDebug()

  _debugPanel: null,
  _debugPkt: null,
  _debugStepResolve: null,
  _debugActive: false,

  _CABLE_NAMES: {
    0: 'Trunk A→B', 1: 'Trunk B→A', 2: 'Trunk 3',
    3: 'FW-A → Core A', 4: 'FW-B → Core B',
    5: 'Core A → BRS (in)', 6: 'BRS → Core A (out)', 7: 'WLC → Core A', 8: 'WLC ↔ WiFi AP',
    9: 'Core A → IT Switch', 10: 'Core A → Punk Switch', 11: 'VPN ↔ Core B',
    12: 'Core B → Office Switch', 13: 'Core B → Corporate Switch', 14: 'VPN → Contractors',
    15: 'Cloud-A → FW-A', 16: 'Cloud-B → FW-B',
    17: 'Core B → BRS-02 (in)', 18: 'BRS-02 → Core B (out)',
  },

  _toggleDebug() {
    if (this._debugPanel) {
      this._debugPanel.remove();
      this._debugPanel = null;
      this._debugActive = false;
      if (this._debugMoveHandler) { document.removeEventListener('mousemove', this._debugMoveHandler); this._debugMoveHandler = null; }
      if (this._debugUpHandler) { document.removeEventListener('mouseup', this._debugUpHandler); this._debugUpHandler = null; }
      return;
    }
    this._debugActive = true;
    this._stopWfq();

    const panel = document.createElement('div');
    panel.className = 'rack-debug-panel';
    panel.innerHTML = `
      <div class="rack-debug-header">Ingress Debugger</div>
      <div class="rack-debug-row">
        <label>Name</label>
        <input type="text" id="rdbg-name" value="DEBUG USER" />
      </div>
      <div class="rack-debug-row">
        <label>Dept</label>
        <select id="rdbg-dept">
          <option value="PRINTER JAMS">PRINTER JAMS (IT)</option>
          <option value="MOSH PIT HR">MOSH PIT HR (Punk)</option>
          <option value="WATERCOOLER SERVICES">WATERCOOLER SERVICES (Office)</option>
          <option value="MANDATORY FUN COMMITTEE">MANDATORY FUN COMMITTEE (Corporate)</option>
          <option value="FREELANCE">FREELANCE (Contractors)</option>
        </select>
      </div>
      <div class="rack-debug-row">
        <label>Path</label>
        <select id="rdbg-path">
          <option value="firewall">Firewall (90%)</option>
          <option value="wifi">WiFi AP (10%)</option>
        </select>
      </div>
      <div class="rack-debug-row">
        <label>BRS</label>
        <select id="rdbg-brs">
          <option value="yes">Side trip</option>
          <option value="no">Skip</option>
        </select>
      </div>
      <div class="rack-debug-row">
        <label>CLI</label>
        <select id="rdbg-cli">
          <option value="yes">Core popup</option>
          <option value="no">Skip</option>
          <option value="random">Random (30%)</option>
        </select>
      </div>
      <div class="rack-debug-buttons">
        <button id="rdbg-start">▶ Start</button>
        <button id="rdbg-step" disabled>⏭ Next Step</button>
        <button id="rdbg-reset">↺ Reset</button>
      </div>
      <div class="rack-debug-status" id="rdbg-status">Ready</div>
      <div class="rack-debug-log" id="rdbg-log"></div>
    `;
    document.body.appendChild(panel);
    this._debugPanel = panel;

    panel.querySelector('#rdbg-start').addEventListener('click', () => this._debugStart());
    panel.querySelector('#rdbg-step').addEventListener('click', () => this._debugStep());
    panel.querySelector('#rdbg-reset').addEventListener('click', () => this._debugReset());

    // Draggable by header
    const header = panel.querySelector('.rack-debug-header');
    let dragging = false, dx = 0, dy = 0;
    header.style.cursor = 'grab';
    header.addEventListener('mousedown', (e) => {
      dragging = true;
      dx = e.clientX - panel.offsetLeft;
      dy = e.clientY - panel.offsetTop;
      header.style.cursor = 'grabbing';
      e.preventDefault();
    });
    this._debugMoveHandler = (e) => {
      if (!dragging) return;
      panel.style.left = (e.clientX - dx) + 'px';
      panel.style.top = (e.clientY - dy) + 'px';
    };
    this._debugUpHandler = () => {
      if (dragging) { dragging = false; header.style.cursor = 'grab'; }
    };
    document.addEventListener('mousemove', this._debugMoveHandler);
    document.addEventListener('mouseup', this._debugUpHandler);
  },

  _debugLog(msg) {
    const log = document.getElementById('rdbg-log');
    if (!log) return;
    const line = document.createElement('div');
    line.textContent = msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  },

  _debugStatus(msg) {
    const el = document.getElementById('rdbg-status');
    if (el) el.textContent = msg;
  },

  // Wait for user to click "Next Step"
  _debugWaitStep(label) {
    this._debugStatus(`⏸ ${label}`);
    this._debugLog(`→ ${label}`);
    const stepBtn = document.getElementById('rdbg-step');
    if (stepBtn) stepBtn.disabled = false;
    return new Promise(resolve => {
      this._debugStepResolve = () => {
        if (stepBtn) stepBtn.disabled = true;
        this._debugStatus(`▶ ${label}...`);
        resolve();
      };
    });
  },

  _debugStep() {
    if (this._debugStepResolve) {
      const resolve = this._debugStepResolve;
      this._debugStepResolve = null;
      resolve();
    }
  },

  _debugReset() {
    // Cancel any in-flight debug packet
    if (this._debugPkt) {
      this._debugPkt._cancelled = true;
      this._removePacket(this._debugPkt);
      this._debugPkt = null;
    }
    this._cancelAllPackets();
    this._brsBusy = { 'brs-01': false, 'brs-02': false };
    const log = document.getElementById('rdbg-log');
    if (log) log.innerHTML = '';
    this._debugStatus('Ready');
    const stepBtn = document.getElementById('rdbg-step');
    if (stepBtn) stepBtn.disabled = true;
    const startBtn = document.getElementById('rdbg-start');
    if (startBtn) startBtn.disabled = false;
    this._debugLog('Reset complete');
  },

  async _debugStart() {
    if (!this._container || !this._cableSvg || !this._virtualCoords) {
      this._debugLog('ERROR: Rack not ready');
      return;
    }

    const startBtn = document.getElementById('rdbg-start');
    if (startBtn) startBtn.disabled = true;

    const name = document.getElementById('rdbg-name')?.value || 'DEBUG USER';
    const dept = document.getElementById('rdbg-dept')?.value || 'PRINTER JAMS';
    const pathType = document.getElementById('rdbg-path')?.value || 'firewall';
    const doBrs = document.getElementById('rdbg-brs')?.value === 'yes';
    const cliVal = document.getElementById('rdbg-cli')?.value || 'random';
    const doCli = cliVal === 'yes' ? true : cliVal === 'no' ? false : null; // null = random 30%

    const songs = typeof SONG_LIST !== 'undefined' ? SONG_LIST : ['PLEASE HOLD', 'REPLY ALL', 'MANDATORY FUN'];
    const badge = {
      employeeId: `HD-DBG-${Date.now()}`,
      name,
      department: dept,
      title: 'Debug Test',
      song: songs[Math.floor(Math.random() * songs.length)],
      isBandMember: false,
    };

    const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
    const route = this._resolveRoute(pathType, divTheme, { brs: doBrs, cli: doCli });

    if (!route) {
      this._debugLog(`ERROR: No route for theme "${divTheme}"`);
      if (startBtn) startBtn.disabled = false;
      return;
    }

    // Log the full resolved route
    this._debugLog(`Badge: ${name} | Dept: ${dept} | Theme: ${divTheme}`);
    this._debugLog(`Entry: ${route.entry}${route.entrySide ? ` (${route.entrySide})` : ''} | Rack: ${route.rackSide} | Steps: ${route.steps.length}`);
    const stepSummary = route.steps
      .filter(s => s.type === 'cable')
      .map(s => this._CABLE_NAMES[s.cable] || `C${s.cable}`)
      .join(' → ');
    this._debugLog(`Route: ${stepSummary}`);

    const pkt = { el: this._createBadgePacket(badge) };
    this._debugPkt = pkt;
    if (!pkt.el) {
      this._debugLog('ERROR: Could not create packet');
      if (startBtn) startBtn.disabled = false;
      return;
    }

    try {
      // Walk the resolved route, pausing before each step
      for (const step of route.steps) {
        if (pkt._cancelled) break;

        switch (step.type) {
          case 'materialize': {
            const cloudLabel = step.node === 'cloud-a' ? 'Cloud-A' : step.node === 'cloud-b' ? 'Cloud-B' : step.node === 'wifi-ap' ? 'WiFi AP' : 'Cloud';
            await this._debugWaitStep(`Materialize on ${cloudLabel}`);
            const coords = this._getMaterializeCoords(step.node);
            if (coords) {
              this._fireMaterializeTrigger(step.node);
              await this._materializeBadge(pkt, coords.x, coords.y, 1200, step.mode);
            }
            this._debugLog('✓ Materialized');
            break;
          }

          case 'cable': {
            const cableName = this._CABLE_NAMES[step.cable] || `Cable ${step.cable}`;
            await this._debugWaitStep(`Cable: ${cableName} (from ${step.from})`);
            // Core CLI fires BEFORE cable movement — core "decides" route, then packet departs
            if (step.coreTrigger === 'core-cli') {
              const coreSide = step.cliCore
                || (step.from === 'core-a' ? 'A' : step.from === 'core-b' ? 'B' : null);
              if (coreSide) {
                this._triggerCoreCli(coreSide, route);
                this._debugLog(`  ⚡ Core ${coreSide} CLI popup`);
              }
            }
            const debugCableSpeed = this._CABLE_SPEEDS[step.cable] ?? 0.4;
            await this._movePacketAlongCable(pkt, step.cable, step.from, debugCableSpeed);
            this._debugLog(`✓ ${cableName}`);
            if (step.trigger === 'fw-inspect') {
              const fwSide = step.triggerNode === 'fw-a' ? 'A' : 'B';
              this._triggerFWInspect(this._container.querySelector(`[data-fw-side="${fwSide}"]`), step.pause || 1200);
              await this._delay(step.pause || 500);
              this._debugLog('  ⚡ FW inspection');
            } else if (step.trigger === 'vpn-tunnel') {
              this._triggerFlash(this._container.querySelector('[data-device-type="vpn"]'), 'rack-trigger-vpn-tunnel', 500);
              this._triggerVPNSession();
              this._debugLog('  ⚡ VPN tunnel + session');
            } else if (step.trigger === 'wlc-bump') {
              this._triggerWLCBump();
              this._debugLog('  ⚡ WLC AP bump');
            } else if (step.pause) {
              await this._delay(step.pause);
            }
            break;
          }

          case 'brs-render': {
            const debugBrsId = step.brsId || 'brs-01';
            await this._debugWaitStep(`${debugBrsId.toUpperCase()}: Render waveform`);
            try {
              this._brsBusy[debugBrsId] = true;
              this.triggerBRSRender(badge, step.pause || 2500, debugBrsId);
              await this._delay(step.pause || 2500);
            } finally {
              this._brsBusy[debugBrsId] = false;
            }
            this._debugLog(`✓ ${debugBrsId.toUpperCase()} render`);
            break;
          }

          case 'beam-down': {
            // Reuse _executeRoute logic for beam-down
            const dt = step.divTheme;
            const panel = this._container.querySelector(`[data-panel-key="${CSS.escape(dt)}"]`);
            const sw = this._container.querySelector(`.rack-device-switch[data-theme="${CSS.escape(dt)}"]`);
            const filled = panel?.querySelectorAll('.rack-port:not(.rack-port-empty)').length || 0;

            let srcCoords = null;
            if (sw) {
              const port = sw.querySelector(`[data-switch-port="${filled}"]`);
              if (port) {
                // Activate switch port LED during beam-down
                if (!port.classList.contains('rack-conn-port-active')) {
                  port.classList.add('rack-conn-port-active', 'rack-conn-port-dual');
                  const pI = parseInt(port.dataset.switchPort || '0', 10);
                  const sS = Array.from(dt).reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
                  port.classList.add(`rack-port-group-${((Math.abs(sS) * 7 + pI * 3) % 8)}`);
                }
                this._triggerFlash(port, 'rack-trigger-switch-flash', 800);
                srcCoords = this._getPortCoords(this._container, `.rack-device-switch[data-theme="${CSS.escape(dt)}"] [data-switch-port="${filled}"]`);
              }
            }
            if (!srcCoords) srcCoords = this._virtualCoords?.switchBottom[dt];

            let destCoords = null;
            const empty = panel?.querySelector('.rack-port-empty');
            if (empty) destCoords = this._getPortCoords(this._container, `[data-panel-key="${CSS.escape(dt)}"] .rack-port-empty`);
            if (!destCoords && panel) {
              const pr = panel.getBoundingClientRect();
              const ref = this._container.querySelector('.rack-frames-row')?.getBoundingClientRect();
              if (ref) destCoords = { x: pr.left + pr.width / 2 - ref.left, y: pr.top + pr.height / 2 - ref.top };
            }

            if (srcCoords && destCoords) {
              await this._debugWaitStep('Beam down: Switch Port → Patch Panel');
              await this._beamDown(pkt, srcCoords.x, srcCoords.y, destCoords.x, destCoords.y, 2000);
              this._debugLog('✓ Beam down');
            } else {
              this._debugLog(`⚠ No beam (src: ${!!srcCoords}, dest: ${!!destCoords})`);
            }
            break;
          }

          case 'place-badge': {
            await this._debugWaitStep('Place badge in patch panel');
            const portEl = this._placeBadgePort(badge);
            if (portEl) {
              portEl.classList.add('rack-trigger-arrival-burst');
              setTimeout(() => portEl.classList.remove('rack-trigger-arrival-burst'), 1500);
            }
            this._debugLog('✓ Badge placed');
            break;
          }
        }
      }

      this._debugStatus('✅ Complete');
    } catch (err) {
      this._debugLog(`ERROR: ${err.message}`);
      this._debugStatus('❌ Failed');
    } finally {
      this._removePacket(pkt);
      this._debugPkt = null;
      if (startBtn) startBtn.disabled = false;
    }
  },
};
