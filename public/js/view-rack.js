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

    // Add port to the first row with an empty slot
    const row = panel.querySelector('.rack-port-row');
    if (!row) return null;

    // Remove an empty port if one exists
    const emptyPort = row.querySelector('.rack-port-empty');
    if (emptyPort) emptyPort.remove();

    const portEl = this._createPort(badge);
    row.appendChild(portEl);

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

  // ─── Rendering ──────────────────────────────────────────

  _render() {
    const container = this._container;
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'rack-container';

    // Single centered internet cloud
    const cloudsRow = document.createElement('div');
    cloudsRow.className = 'rack-clouds-row';
    cloudsRow.appendChild(this._renderInternetCloud('A'));
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

    // Randomize device LED animation offsets so they don't blink in sync
    wrapper.querySelectorAll('.rack-led-blink-gold, .rack-led-slow-blink, .rack-led-blink-blue, .rack-ups-led-bat, .rack-fw-led-act').forEach(led => {
      led.style.animationDelay = `-${(Math.random() * 6).toFixed(1)}s`;
    });

    // SVG cable overlay (after racks are in DOM)
    if (this._dualMode) {
      requestAnimationFrame(() => this._renderCables(wrapper));
    }

    // Resize observer — recalculate cable paths
    this._resizeObserver = new ResizeObserver(() => {
      if (this._cableSvg && this._dualMode) {
        this._updateCablePaths(wrapper);
      }
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
    const sideL = side.toLowerCase();
    let portsHtml = '<div class="rack-switch-ports">';
    portsHtml += '<div class="rack-fw-port-group">';
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-fw-port-wan" data-port-id="fw-${sideL}-wan" title="WAN"></div>`;
    portsHtml += '</div>';
    portsHtml += '<div class="rack-fw-port-divider"></div>';
    portsHtml += '<div class="rack-fw-port-group">';
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-fw-port-core" data-port-id="fw-${sideL}-core" title="Core ${side}" style="--port-delay:-${(Math.random() * 24).toFixed(1)}s;--port-speed:${(16 + Math.random() * 6).toFixed(1)}s"></div>`;
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

    // Port assignments per core switch side
    // Core A left: WLC(1), spare, BRS(3), FW-A(4) | right: IT(1), Punk(2), spare, cross-rack(4)
    // Core B left: cross-rack(1), spare, spare, FW-B(4) | right: spare, Office(2), Corporate(3), VPN(4)
    const portMap = side === 'A'
      ? { left: ['wlc-uplink', 'spare', 'brs-uplink', 'fw-a-uplink'], right: ['it-uplink', 'punk-uplink', 'spare', 'cross-rack'] }
      : { left: ['cross-rack', 'vpn-uplink', 'spare', 'fw-b-uplink'], right: ['spare', 'office-uplink', 'corporate-uplink', 'spare'] };

    // Left trunk ports (4) — connected ports get dual LEDs with animation
    let leftPortsHtml = '<div class="rack-switch-ports rack-core-ports-left">';
    portMap.left.forEach(id => {
      const connected = id !== 'spare';
      const cls = connected ? 'rack-conn-port-active rack-conn-port-dual' : '';
      const anim = connected ? `style="--port-delay:-${(Math.random() * 24).toFixed(1)}s;--port-speed:${(16 + Math.random() * 6).toFixed(1)}s"` : '';
      leftPortsHtml += `<div class="rack-conn-port rack-conn-port-trunk ${cls}" data-port-id="core-${side.toLowerCase()}-${id}" ${anim}></div>`;
    });
    leftPortsHtml += '</div>';

    // Right trunk ports (4)
    let rightPortsHtml = '<div class="rack-switch-ports rack-core-ports-right">';
    portMap.right.forEach(id => {
      const connected = id !== 'spare';
      const cls = connected ? 'rack-conn-port-active rack-conn-port-dual' : '';
      const anim = connected ? `style="--port-delay:-${(Math.random() * 24).toFixed(1)}s;--port-speed:${(16 + Math.random() * 6).toFixed(1)}s"` : '';
      rightPortsHtml += `<div class="rack-conn-port rack-conn-port-trunk ${cls}" data-port-id="core-${side.toLowerCase()}-${id}" ${anim}></div>`;
    });
    rightPortsHtml += '</div>';

    el.innerHTML = `
      <div class="rack-device-accent"></div>
      <div class="rack-core-layout">
        <div class="rack-core-left">
          <div class="rack-device-header">
            <span class="rack-device-name">${coreLabel}</span>
            <span class="rack-device-model">Crisco 9500-24Y4C</span>
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

    // Row of switch ports — port 0 is uplink (always active), remaining match patch panel employees
    const totalPorts = device.totalPorts || 12;
    // Port 0 = uplink to core (always lit), ports 1+ = one per employee in patch panel below
    const employeePorts = device.portCount; // already capped at 12
    const themeSlug = device.theme.replace('_', '');
    let portsHtml = '<div class="rack-switch-ports">';
    for (let i = 0; i < totalPorts; i++) {
      if (i > 0 && i % 4 === 0) portsHtml += '<div class="rack-switch-port-divider"></div>';
      // Port 0 = uplink, ports 1 through employeePorts = connected employees
      const isActive = i === 0 || i <= employeePorts;
      const style = isActive ? `style="--port-delay:-${(Math.random() * 24).toFixed(1)}s;--port-speed:${(16 + Math.random() * 6).toFixed(1)}s"` : '';
      portsHtml += `<div class="rack-conn-port ${isActive ? 'rack-conn-port-active rack-conn-port-dual' : ''}" data-switch-port="${i}" ${style}></div>`;
    }
    // SFP trunk ports (right side, separated by divider) — first is unused, second carries the uplink cable
    const sfpStyle = `style="--port-delay:-${(Math.random() * 24).toFixed(1)}s;--port-speed:${(16 + Math.random() * 6).toFixed(1)}s"`;
    portsHtml += '<div class="rack-switch-port-divider rack-switch-sfp-divider"></div>';
    portsHtml += `<div class="rack-conn-port rack-conn-port-trunk rack-switch-sfp" data-port-id="sw-${themeSlug}-core-uplink" title="Core Uplink"></div>`;
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-conn-port-trunk rack-switch-sfp" data-port-id="sw-${themeSlug}-spare" title="Spare" ${sfpStyle}></div>`;
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
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-conn-port-trunk" data-port-id="wlc-core-uplink" title="Core Uplink" style="--port-delay:-${(Math.random() * 24).toFixed(1)}s;--port-speed:${(16 + Math.random() * 6).toFixed(1)}s"></div>`;
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-wlc-port-ap" data-port-id="wlc-ap-uplink" title="AP Mgmt" style="--port-delay:-${(Math.random() * 24).toFixed(1)}s;--port-speed:${(16 + Math.random() * 6).toFixed(1)}s"></div>`;
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
              <div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-conn-port-trunk" data-port-id="brs-core-uplink" title="Core Uplink" style="--port-delay:-12.3s;--port-speed:18.7s"></div>
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
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual rack-conn-port-trunk" data-port-id="vpn-core-uplink" title="Core Uplink" style="--port-delay:-${(Math.random() * 24).toFixed(1)}s;--port-speed:${(16 + Math.random() * 6).toFixed(1)}s"></div>`;
    portsHtml += '<div class="rack-conn-port rack-conn-port-active rack-vpn-port-tunnel" title="IPsec Tunnel"></div>';
    portsHtml += `<div class="rack-conn-port rack-conn-port-active rack-conn-port-dual" data-port-id="vpn-contractor-downlink" title="SW-CTR" style="--port-delay:-${(Math.random() * 24).toFixed(1)}s;--port-speed:${(16 + Math.random() * 6).toFixed(1)}s"></div>`;
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

  // ─── SVG Cable Overlay ──────────────────────────────────

  // Cable definitions: [fromPortId, toPortId, color, width, routeType]
  // routeTypes: 'cross-rack', 'drop-left' (vertical drop nudged left of silkscreen),
  //   'arc-right' (swing outside right edge), 'arc-left' (swing outside left edge),
  //   'margin-right' (right gutter routing), 'margin-right-stagger' (staggered vertical entry)
  _CABLE_DEFS: [
    // Cross-rack trunk (gold, 5px)
    ['core-a-cross-rack', 'core-b-cross-rack', '#D4A843', 3, 'cross-rack'],
    // FW → Core: short vertical drop, nudged left to avoid CRISCO silkscreen
    ['fw-a-core', 'core-a-fw-a-uplink', '#3B82F6', 2.5, 'drop-left'],
    ['fw-b-core', 'core-b-fw-b-uplink', '#3B82F6', 2.5, 'drop-left'],
    // BRS → Core A: left gutter routing to 3rd left port (entry at 24px below port)
    ['core-a-brs-uplink', 'brs-core-uplink', '#3B82F6', 2.5, 'margin-left-24'],
    // WLC → Core A: arc up left outside of rack
    ['wlc-core-uplink', 'core-a-wlc-uplink', '#3B82F6', 2.5, 'arc-left'],
    // WLC AP mgmt → WiFi AP: solid line, exit down first then up left gutter
    ['wlc-ap-uplink', 'wifi-ap-eth', '#22C55E', 2, 'margin-left-down'],
    // Rack A division switches → Core A right: nested routing (inner cable first, outer wraps around)
    // IT first = inner lane, lower entry. Punk second = outer lane, higher entry. No crossing.
    ['core-a-it-uplink', 'sw-IT-spare', '#3B82F6', 2.5, 'margin-right-stagger'],
    ['core-a-punk-uplink', 'sw-Punk-spare', '#3B82F6', 2.5, 'margin-right-stagger'],
    // VPN → Core B left port 2: route through inter-rack gap, enter at same height as Office
    ['vpn-core-uplink', 'core-b-vpn-uplink', '#3B82F6', 2.5, 'margin-left-42'],
    // Rack B division switches → Core B right: nested routing (inner first, outer wraps around)
    // Office (closer switch, port 2) = inner, Corporate (further switch, port 3) = outer
    ['core-b-office-uplink', 'sw-Office-spare', '#3B82F6', 2.5, 'margin-right-stagger'],
    ['core-b-corporate-uplink', 'sw-Corporate-spare', '#3B82F6', 2.5, 'margin-right-stagger'],
    // VPN → Contractors: down from VPN, right gutter between UPS/switch, curve up to SFP
    ['vpn-contractor-downlink', 'sw-custom-spare', '#3B82F6', 2.5, 'under-and-up'],
  ],

  _cableSvg: null,

  _renderCables(container) {
    // Create SVG element sized to the rack container
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('rack-cable-svg');
    svg.setAttribute('aria-hidden', 'true');

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

    const containerRect = framesRow.getBoundingClientRect();
    svg.setAttribute('width', containerRect.width);
    svg.setAttribute('height', containerRect.height);
    svg.setAttribute('viewBox', `0 0 ${containerRect.width} ${containerRect.height}`);

    // Clear existing paths
    svg.innerHTML = '';

    // Get rack frame edges for cable routing gutters
    const frames = container.querySelectorAll('.rack-frame');
    const frameEdges = {};
    frames.forEach(f => {
      const id = f.getAttribute('data-rack-id');
      const fr = f.getBoundingClientRect();
      frameEdges[id] = {
        right: fr.right - containerRect.left,
        left: fr.left - containerRect.left,
      };
    });

    // Lane counters for staggering parallel cables in the same gutter
    const rightLanes = { A: 0, B: 0 };
    const staggerIdxByRack = { A: 0, B: 0 };
    let leftLane = 0;

    // Draw each cable
    this._CABLE_DEFS.forEach(([fromId, toId, color, width, routeType, style]) => {
      const fromEl = container.querySelector(`[data-port-id="${fromId}"]`);
      const toEl = container.querySelector(`[data-port-id="${toId}"]`);
      if (!fromEl || !toEl) return;

      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      // Center points relative to framesRow
      const x1 = fromRect.left + fromRect.width / 2 - containerRect.left;
      const y1 = fromRect.top + fromRect.height / 2 - containerRect.top;
      const x2 = toRect.left + toRect.width / 2 - containerRect.left;
      const y2 = toRect.top + toRect.height / 2 - containerRect.top;

      // Find parent rack frame for edge calculations
      const fromFrame = fromEl.closest('.rack-frame');
      const toFrame = toEl.closest('.rack-frame');
      const rackId = fromFrame ? fromFrame.getAttribute('data-rack-id') : null;
      const rackSide = rackId && rackId.includes('101') ? 'A' : 'B';
      const edges = rackId && frameEdges[rackId] ? frameEdges[rackId] : { right: Math.max(x1, x2) + 40, left: Math.min(x1, x2) - 40 };

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let d;

      switch (routeType) {
        case 'cross-rack':
          d = this._crossRackPath(x1, y1, x2, y2);
          break;
        case 'drop-left':
          // Vertical drop nudged left to avoid CRISCO silkscreen
          d = this._dropLeftPath(x1, y1, x2, y2);
          break;
        case 'arc-left':
          // Left gutter routing — WLC uses this
          d = this._arcLeftPath(x1, y1, x2, y2, edges.left - 18 - (leftLane * 6));
          leftLane++;
          break;
        case 'margin-left-down': {
          // Exit down first to clear adjacent ports, then left gutter up to target
          const gutterX = edges.left - 18 - (leftLane * 6);
          d = this._marginLeftDownPath(x1, y1, x2, y2, gutterX);
          leftLane++;
          break;
        }
        case 'margin-right': {
          // Right gutter routing for Rack A switches, nudge entry down to clear cross-rack
          const gutterX = edges.right + 18 + (rightLanes[rackSide] * 6);
          d = this._marginRoutedPath(x1, y1, x2, y2, gutterX, 10);
          rightLanes[rackSide]++;
          break;
        }
        case 'margin-right-stagger': {
          // Right gutter with staggered vertical entry into core port
          const gutterX = edges.right + 18 + (rightLanes[rackSide] * 6);
          d = this._marginStaggerPath(x1, y1, x2, y2, gutterX, staggerIdxByRack[rackSide]);
          rightLanes[rackSide]++;
          staggerIdxByRack[rackSide]++;
          break;
        }
        case 'under-and-up': {
          // Down from port → right gutter between UPS and device → curve up to target above
          const gutterX = edges.right + 14;
          d = this._underAndUpPath(x1, y1, x2, y2, gutterX);
          break;
        }
        default:
          if (routeType && routeType.startsWith('margin-left-')) {
            const offset = parseInt(routeType.split('-')[2], 10) || 24;
            const gutterX = edges.left - 6 - (leftLane * 6);
            d = this._marginLeftPath(x1, y1, x2, y2, gutterX, offset);
            leftLane++;
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

      svg.appendChild(path);
    });
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

    return `M ${botX} ${botY} `
      + `L ${botX} ${loopY - r} `
      + `Q ${botX} ${loopY}, ${botX - r} ${loopY} `
      + `L ${gutterX + r} ${loopY} `
      + `Q ${gutterX} ${loopY}, ${gutterX} ${loopY - r} `
      + `L ${gutterX} ${topY + r} `
      + `Q ${gutterX} ${topY}, ${gutterX + r} ${topY} `
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

  _marginStaggerPath(x1, y1, x2, y2, gutterX, staggerIdx) {
    // Right gutter with staggered entry into core ports
    // Each cable enters at a different height below the port, then goes straight up
    // This creates clean, non-overlapping vertical connections into Core B
    const r = 8;
    const staggerStep = 6; // vertical spacing between staggered cables
    const topY = Math.min(y1, y2);
    const botY = Math.max(y1, y2);
    const topX = y1 < y2 ? x1 : x2;
    const botX = y1 < y2 ? x2 : x1;

    // Entry point: outer cables (higher index) enter closer to port, inner cables enter lower
    // This nests cables cleanly — outer wraps around inner without crossing
    const entryY = topY + 42 - (staggerIdx * staggerStep);

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

  _crossRackPath(x1, y1, x2, y2) {
    // Arc across the gap between racks
    const midY = Math.min(y1, y2) - 20;
    return `M ${x1} ${y1} C ${x1 + 30} ${midY}, ${x2 - 30} ${midY}, ${x2} ${y2}`;
  },
};
