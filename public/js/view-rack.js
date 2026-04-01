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

  // Rack assignment: which division themes go where
  _RACK_A_THEMES: ['IT', 'Punk'],
  _RACK_B_THEMES: ['Office', 'Corporate'],
  _TARGET_U: 20,        // target rack height in U
  _PORTS_PER_ROW: 12,

  async init(container, stats) {
    this._container = container;
    this._stats = stats;
    this._badgeIndex = {};

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

    // Build layout and render
    this._rackData = this._computeLayout(allBadges);
    this._render();
  },

  addBadge(badge) {
    if (!this._container || !this._rackData) return null;

    // Dedup
    if (this._badgeIndex[badge.employeeId]) return null;

    this._badgeIndex[badge.employeeId] = badge;
    this._allBadges.push(badge);

    // Find or create the port in the correct patch panel
    const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
    const deptName = badge.department;

    // Find the patch panel element
    const panelKey = `${divTheme}::${deptName}`;
    let panel = this._container.querySelector(`[data-panel-key="${CSS.escape(panelKey)}"]`);

    if (!panel) {
      // Department not yet rendered — rebuild layout
      this._rackData = this._computeLayout(this._allBadges);
      this._render();
      panel = this._container.querySelector(`[data-panel-key="${CSS.escape(panelKey)}"]`);
      if (!panel) return null;
    }

    // Add port to the grid
    const grid = panel.querySelector('.rack-port-grid');
    if (!grid) return null;

    // Remove an empty port if one exists
    const emptyPort = grid.querySelector('.rack-port-empty');
    if (emptyPort) emptyPort.remove();

    const portEl = this._createPort(badge);
    grid.appendChild(portEl);

    // Update port count
    const countEl = panel.querySelector('.rack-port-count');
    if (countEl) {
      const ports = grid.querySelectorAll('.rack-port:not(.rack-port-empty)');
      countEl.textContent = `${ports.length}`;
    }

    // Light up corresponding switch port above the patch panel
    const divThemeEsc = CSS.escape(divTheme);
    const sw = this._container.querySelector(`.rack-device-switch[data-theme="${divThemeEsc}"]`);
    if (sw) {
      const filledPorts = panel.querySelectorAll('.rack-port:not(.rack-port-empty)').length;
      // Port 0 is uplink, so employee N maps to switch port N
      const switchPort = sw.querySelector(`[data-switch-port="${filledPorts}"]`);
      if (switchPort && !switchPort.classList.contains('rack-conn-port-active')) {
        switchPort.classList.add('rack-conn-port-active', 'rack-conn-port-dual');
        switchPort.style.setProperty('--port-delay', `-${(Math.random() * 24).toFixed(1)}s`);
        switchPort.style.setProperty('--port-speed', `${(16 + Math.random() * 6).toFixed(1)}s`);
      }
    }

    // Update WLC AP count (3 APs per employee)
    const wlcCount = this._container.querySelector('[data-wlc-aps]');
    if (wlcCount) {
      wlcCount.textContent = `${this._allBadges.length * 3} APs`;
    }

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
    if (this._cssLink) { this._cssLink.remove(); this._cssLink = null; }
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this._container) this._container.innerHTML = '';
    this._container = null;
    this._stats = null;
    this._allBadges = [];
    this._badgeIndex = {};
    this._rackData = null;
  },

  // ─── Layout Computation ─────────────────────────────────

  _computeLayout(badges) {
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

    // Count active divisions (excluding exec and custom)
    const activeThemes = Object.keys(byDiv).filter(t => t !== '_custom');
    this._dualMode = activeThemes.length >= 3;

    // Build device lists for each rack
    const rackA = [];
    const rackB = [];

    // Add division switch + single patch panel per division (all dept employees merged)
    const addDivision = (theme, rack) => {
      const depts = byDiv[theme];
      if (!depts) return;

      const divInfo = PUBLIC_DIVISIONS.find(d => d.theme === theme);
      if (!divInfo) return;

      const color = DIVISION_ACCENT_COLORS[theme] || '#4b5563';

      // Merge all department employees into one division pool
      const allEmployees = [];
      Object.values(depts).forEach(emps => allEmployees.push(...emps));

      // Division switch (1U) — active ports match employee count in patch panel below
      rack.push({
        type: 'switch',
        name: divInfo.name,
        theme: theme,
        color: color,
        portCount: Math.min(allEmployees.length, 12),
      });

      // Division patch panel (1U, 12 ports, pool rotation handles overflow)
      rack.push({
        type: 'patch',
        name: divInfo.name,
        theme: theme,
        color: color,
        employees: allEmployees,
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

    // Rack B: Cable Mgmt at top of division block
    rackB.unshift({ type: 'cable' });

    // Bottom-of-rack devices (before height matching)
    // Rack A: WLC above UPS
    rackA.push({ type: 'wlc' });

    // Rack B: Contractors + VPN above UPS
    const customDepts = byDiv['_custom'];
    if (customDepts) {
      const customEmployees = [];
      Object.values(customDepts).forEach(emps => customEmployees.push(...emps));

      rackB.push({
        type: 'switch',
        name: 'INDEPENDENT CONTRACTORS',
        theme: '_custom',
        color: DIVISION_ACCENT_COLORS['_custom'] || '#ffd700',
        portCount: Math.min(customEmployees.length, 24),
        totalPorts: 24,
      });

      rackB.push({
        type: 'patch',
        name: 'INDEPENDENT CONTRACTORS',
        theme: '_custom',
        color: DIVISION_ACCENT_COLORS['_custom'] || '#ffd700',
        employees: customEmployees,
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

  _countDevices(rack) {
    return rack.filter(d => d.type !== 'blank' && d.type !== 'ups' && d.type !== 'pdu').length;
  },

  _fillBlanks(rack) {
    this._fillBlanksTo(rack, this._TARGET_U);
  },

  _fillBlanksTo(rack, targetU) {
    const used = this._usedU(rack);
    const blanksNeeded = Math.max(0, targetU - used);
    for (let i = 0; i < blanksNeeded; i++) {
      rack.push({ type: 'blank' });
    }
  },

  // ─── Rendering ──────────────────────────────────────────

  _render() {
    const container = this._container;
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'rack-container';

    // Clouds row — separate from rack columns so they align independently
    const cloudsRow = document.createElement('div');
    cloudsRow.className = 'rack-clouds-row';
    cloudsRow.appendChild(this._renderInternetCloud('A'));
    if (this._dualMode) {
      cloudsRow.appendChild(this._renderInternetCloud('B'));
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

    // Resize observer
    this._resizeObserver = new ResizeObserver(() => {
      // Future: recalculate cable paths on resize
    });
    this._resizeObserver.observe(wrapper);
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
          frame.appendChild(this._renderBRS());
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
    let portsHtml = '<div class="rack-switch-ports">';
    portsHtml += '<div class="rack-fw-port-group">';
    portsHtml += '<div class="rack-conn-port rack-conn-port-active rack-fw-port-wan" title="WAN"></div>';
    portsHtml += '</div>';
    portsHtml += '<div class="rack-fw-port-divider"></div>';
    portsHtml += '<div class="rack-fw-port-group">';
    portsHtml += '<div class="rack-conn-port rack-conn-port-active rack-fw-port-core" title="Core A"></div>';
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

    // Band member portraits (right side, horizontal)
    let membersHtml = '';
    if (execBadges && execBadges.length > 0) {
      const half = Math.ceil(execBadges.length / 2);
      const myMembers = side === 'A' ? execBadges.slice(0, half) : execBadges.slice(half);

      membersHtml = '<div class="rack-core-ports">';
      myMembers.forEach(b => {
        membersHtml += `
          <div class="rack-core-port" data-employee-id="${esc(b.employeeId)}" title="${esc(b.name)}">
            <img src="/api/badge/${esc(b.employeeId)}/headshot" alt="${esc(b.name)}" loading="lazy"
              onerror="this.style.display='none'">
          </div>
        `;
      });
      membersHtml += '</div>';
    }

    // Trunk SFP ports + generic ports (left side)
    let connHtml = '<div class="rack-switch-ports">';
    connHtml += '<div class="rack-conn-port rack-conn-port-active rack-conn-port-trunk"></div>';
    connHtml += '<div class="rack-conn-port rack-conn-port-active rack-conn-port-trunk"></div>';
    connHtml += '<div class="rack-switch-port-divider"></div>';
    for (let i = 0; i < 8; i++) {
      if (i === 4) connHtml += '<div class="rack-switch-port-divider"></div>';
      connHtml += `<div class="rack-conn-port ${i < 4 ? 'rack-conn-port-active' : ''}"></div>`;
    }
    connHtml += '</div>';

    el.innerHTML = `
      <div class="rack-device-accent"></div>
      <div class="rack-core-layout">
        <div class="rack-core-left">
          <div class="rack-device-header">
            <span class="rack-device-name">${coreLabel}</span>
            <span class="rack-device-model">Crisco 9500-24Y4C</span>
          </div>
          ${connHtml}
        </div>
        ${membersHtml}
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

    // Row of switch ports — port 0 is uplink (always active), remaining match patch panel employees
    const totalPorts = device.totalPorts || 12;
    // Port 0 = uplink to core (always lit), ports 1+ = one per employee in patch panel below
    const employeePorts = device.portCount; // already capped at 12
    let portsHtml = '<div class="rack-switch-ports">';
    for (let i = 0; i < totalPorts; i++) {
      if (i > 0 && i % 4 === 0) portsHtml += '<div class="rack-switch-port-divider"></div>';
      // Port 0 = uplink, ports 1 through employeePorts = connected employees
      const isActive = i === 0 || i <= employeePorts;
      const style = isActive ? `style="--port-delay:-${(Math.random() * 24).toFixed(1)}s;--port-speed:${(16 + Math.random() * 6).toFixed(1)}s"` : '';
      portsHtml += `<div class="rack-conn-port ${isActive ? 'rack-conn-port-active rack-conn-port-dual' : ''}" data-switch-port="${i}" ${style}></div>`;
    }
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
    portsHtml += '<div class="rack-conn-port rack-conn-port-active rack-conn-port-trunk" title="Core Uplink"></div>';
    portsHtml += '<div class="rack-conn-port rack-conn-port-active rack-wlc-port-ap" title="AP Mgmt"></div>';
    portsHtml += '<div class="rack-conn-port rack-conn-port-active rack-wlc-port-ap" title="AP Mgmt"></div>';
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
        const delay = `style="animation-delay:-${(Math.random() * 24).toFixed(1)}s;animation-duration:${(14 + Math.random() * 8).toFixed(1)}s"`;
        baysHtml += `
          <div class="rack-storage-bay rack-storage-bay-occupied" data-bay="${i}">
            <div class="rack-storage-bay-leds">
              <div class="rack-storage-led-activity ${actLed}" ${delay}></div>
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

  _renderBRS() {
    const el = document.createElement('div');
    el.className = 'rack-device rack-device-brs rack-device-1u';
    el.setAttribute('data-device-type', 'brs');

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
            <span class="rack-device-name rack-brs-name">BRS-01</span>
            <span class="rack-device-model">Mediocore RX-1000</span>
          </div>
          <div class="rack-brs-controls">
            <div class="rack-switch-ports">
              <div class="rack-conn-port rack-conn-port-active rack-conn-port-trunk" title="Core Uplink"></div>
              <div class="rack-conn-port rack-conn-port-active" title="MGMT"></div>
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

    // Store refs for trigger API
    this._brsEl = el;
    this._brsBars = el.querySelectorAll('.rack-brs-bar');
    this._brsHeader = el.querySelector('.rack-brs-lcd-header');
    this._brsThroughput = el.querySelector('.rack-brs-throughput');
    this._brsRenderLed = el.querySelector('.rack-brs-led-render');
    this._brsQueueLed = el.querySelector('.rack-brs-led-queue');
    this._brsRendering = false;
    this._brsJobCount = 0;

    // Start demo mode — fires random renders every 4-8 seconds
    this._startBRSDemo();

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
  triggerBRSRender(badge, duration) {
    if (!this._brsBars || this._brsRendering) return;
    this._brsRendering = true;
    this._brsJobCount++;

    const renderMs = duration || 3000;
    const song = badge.song || 'PLEASE HOLD';
    const id = badge.employeeId || 'HD-00000';
    const wf = (typeof WAVEFORMS !== 'undefined' && WAVEFORMS[song]) || null;
    const barCount = this._brsBars.length;

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
    this._brsHeader.textContent = `${id} ► ${song}`;
    this._brsRenderLed.classList.add('rack-brs-led-active');
    this._brsThroughput.textContent = `${this._brsJobCount} j/m`;

    // Show full waveform instantly
    this._brsBars.forEach((bar, i) => {
      bar.style.height = `${targetHeights[i]}%`;
    });

    // Add playhead element
    const lcd = this._brsEl.querySelector('.rack-brs-bars');
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
    setTimeout(() => this._brsToIdle(playhead), renderMs + 200);
  },

  _brsToIdle(playhead) {
    if (!this._brsBars) return;

    // Hide playhead
    if (playhead) playhead.classList.remove('rack-brs-playhead-active');

    // Fade bars down
    this._brsBars.forEach((bar, i) => {
      setTimeout(() => { bar.style.height = '4%'; }, i * 15);
    });

    setTimeout(() => {
      this._brsHeader.textContent = 'IDLE';
      this._brsRenderLed.classList.remove('rack-brs-led-active');
      this._brsRendering = false;
    }, this._brsBars.length * 15 + 200);
  },

  _startBRSDemo() {
    const songs = typeof SONG_LIST !== 'undefined' ? SONG_LIST : ['PLEASE HOLD'];
    const fire = () => {
      if (!this._brsRendering) {
        const song = songs[Math.floor(Math.random() * songs.length)];
        const id = `HD-${String(Math.floor(10000 + Math.random() * 90000))}`;
        this.triggerBRSRender({ employeeId: id, song });
      }
      // Next render in 4-8 seconds
      setTimeout(fire, 4000 + Math.random() * 4000);
    };
    // First fire after 2 seconds
    setTimeout(fire, 2000);
  },

  _renderVPN() {
    const el = document.createElement('div');
    el.className = 'rack-device rack-device-vpn rack-device-1u';
    el.setAttribute('data-device-type', 'vpn');

    let portsHtml = '<div class="rack-switch-ports">';
    // 2 uplink ports (to core) + 1 tunnel port + 1 downlink (to contractor switch) + empties
    portsHtml += '<div class="rack-conn-port rack-conn-port-active rack-conn-port-trunk" title="Core Uplink"></div>';
    portsHtml += '<div class="rack-conn-port rack-conn-port-active rack-vpn-port-tunnel" title="IPsec Tunnel"></div>';
    portsHtml += '<div class="rack-conn-port rack-conn-port-active" title="SW-CTR"></div>';
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

  _renderPDU(device) {
    const el = document.createElement('div');
    el.className = 'rack-device rack-device-pdu rack-device-1u';
    el.setAttribute('data-device-type', 'pdu');

    const totalOutlets = Math.min(device.outlets + 2, 10);
    const amps = (1.2 + Math.random() * 3.5).toFixed(1);

    let outletsHtml = '<div class="rack-pdu-outlets">';
    for (let i = 0; i < totalOutlets; i++) {
      outletsHtml += `<div class="rack-pdu-outlet ${i < device.outlets ? 'rack-pdu-outlet-active' : ''}"></div>`;
    }
    outletsHtml += '</div>';

    el.innerHTML = `
      <div class="rack-device-header">
        <span class="rack-device-name">EATEN ePDU G3</span>
        <span class="rack-device-model">EMAB22</span>
      </div>
      <div class="rack-pdu-body">
        <div class="rack-pdu-breaker" title="Main breaker"></div>
        ${outletsHtml}
        <span class="rack-pdu-amps">${amps}A</span>
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
};
