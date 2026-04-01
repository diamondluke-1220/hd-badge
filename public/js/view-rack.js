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

      // Division switch (1U)
      rack.push({
        type: 'switch',
        name: divInfo.name,
        theme: theme,
        color: color,
        portCount: Object.keys(depts).length,
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

    // Storage array (2U) — under core switch in Rack A
    rackA.unshift({ type: 'storage' });

    // Cable management between infra (storage) and access (division switches) tiers
    // unshift puts it at position 0, then storage at 1, then divisions at 2+
    // But we want: storage → cable → divisions, so insert cable AFTER storage
    rackA.splice(1, 0, { type: 'cable' });

    // VPN Concentrator (1U) — top of Rack B, before divisions
    rackB.unshift({ type: 'vpn' });

    // Contractors — always Rack B (routed through VPN concentrator)
    const customDepts = byDiv['_custom'];
    if (customDepts) {
      const customEmployees = [];
      Object.values(customDepts).forEach(emps => customEmployees.push(...emps));

      // Contractor switch (1U)
      rackB.push({
        type: 'switch',
        name: 'INDEPENDENT CONTRACTORS',
        theme: '_custom',
        color: DIVISION_ACCENT_COLORS['_custom'] || '#ffd700',
        portCount: Object.keys(customDepts).length,
      });

      // Contractor patch panel (2U — extra space for contractor headcount)
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

    // WLC goes in Rack A's device list (before height matching)
    rackA.push({ type: 'wlc' });

    // Match rack heights — add blanks so both racks are the same total U
    const coreU = 2;  // core switch
    const fwU = 1;    // firewall (rendered separately but counts for height)
    const bottomU = 3; // cable (1U) + UPS (2U)
    const devicesA = this._usedU(rackA);
    const devicesB = this._usedU(rackB);
    const totalA = fwU + coreU + devicesA + bottomU;
    const totalB = fwU + coreU + devicesB + bottomU;
    const maxU = Math.max(totalA, totalB);

    // Fill shorter rack with blanks to match taller rack
    const blanksA = maxU - totalA;
    const blanksB = maxU - totalB;
    for (let i = 0; i < blanksA; i++) rackA.push({ type: 'blank' });
    for (let i = 0; i < blanksB; i++) rackB.push({ type: 'blank' });

    // Cable management before UPS
    rackA.push({ type: 'cable' });
    rackB.push({ type: 'cable' });
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
      if (d.type === 'vpn') return sum + 1;
      if (d.type === 'wlc') return sum + 1;
      if (d.type === 'cable') return sum + 1;
      if (d.type === 'blank') return sum + 1;
      if (d.type === 'ups') return sum + 2;
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
      <div class="rack-fw-fan rack-fw-fan-1"></div>
      <div class="rack-fw-fan rack-fw-fan-2"></div>
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
        <svg class="rack-wifi-icon" viewBox="0 0 24 24" width="14" height="14">
          <path fill="currentColor" d="M12 18c-.89 0-1.74.35-2.37.98a3.3 3.3 0 0 0 4.74 0A3.35 3.35 0 0 0 12 18zm0-4c-1.98 0-3.82.78-5.21 2.17l1.42 1.42A5.46 5.46 0 0 1 12 16c1.47 0 2.84.57 3.79 1.59l1.42-1.42A7.46 7.46 0 0 0 12 14zm0-4c-3.07 0-5.9 1.18-8.07 3.35l1.42 1.42A9.44 9.44 0 0 1 12 12c2.53 0 4.92.98 6.65 2.77l1.42-1.42A11.44 11.44 0 0 0 12 10zm0-4C7.31 6 3.07 7.9 0 11l1.42 1.42C4.05 9.78 7.75 8 12 8s7.95 1.78 10.58 4.42L24 11c-3.07-3.1-7.31-5-12-5z"/>
        </svg>
        <span class="rack-wifi-ssid">HELPDESK-GUEST-5G</span>
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
    el.className = 'rack-device rack-device-core rack-device-2u';
    el.setAttribute('data-device-type', 'core');
    el.setAttribute('data-core-side', side);

    const coreLabel = side === 'A' ? 'CORE A' : 'CORE B';
    const model = side === 'A' ? 'Crisco 9500-24Y4C' : 'Crisco 9500-24Y4C';

    let portsHtml = '';
    if (execBadges && execBadges.length > 0) {
      // Split band members across cores: first half on A, second half on B
      const half = Math.ceil(execBadges.length / 2);
      const myMembers = side === 'A' ? execBadges.slice(0, half) : execBadges.slice(half);

      portsHtml = '<div class="rack-core-ports">';
      myMembers.forEach((b, i) => {
        if (i > 0) portsHtml += '<div class="rack-core-separator"></div>';
        portsHtml += `
          <div class="rack-core-member">
            <div class="rack-core-port" data-employee-id="${esc(b.employeeId)}">
              <img src="/api/badge/${esc(b.employeeId)}/headshot" alt="${esc(b.name)}" loading="lazy"
                onerror="this.style.display='none'">
            </div>
            <span class="rack-core-port-label">${esc(b.name.split(' ')[0])}</span>
          </div>
        `;
      });
      portsHtml += `
        <div class="rack-core-separator"></div>
        <div class="rack-switch-leds">
          <div class="rack-switch-led"></div>
          <div class="rack-switch-led"></div>
          <div class="rack-switch-led"></div>
        </div>
      `;
      portsHtml += '</div>';
    }

    // Trunk SFP ports + a few generic ports (cosmetic)
    let connHtml = '<div class="rack-switch-ports">';
    connHtml += '<div class="rack-conn-port rack-conn-port-active rack-conn-port-trunk"></div>';
    connHtml += '<div class="rack-conn-port rack-conn-port-active rack-conn-port-trunk"></div>';
    for (let i = 0; i < 8; i++) {
      connHtml += `<div class="rack-conn-port ${i < 4 ? 'rack-conn-port-active' : ''}"></div>`;
    }
    connHtml += '</div>';

    el.innerHTML = `
      <div class="rack-device-accent"></div>
      <div class="rack-device-header">
        <span class="rack-device-name">${coreLabel}</span>
        <span class="rack-device-model">${model}</span>
      </div>
      ${portsHtml}
      ${connHtml}
    `;

    return el;
  },

  _renderSwitch(device) {
    const el = document.createElement('div');
    el.className = 'rack-device rack-device-switch rack-device-1u';
    el.setAttribute('data-device-type', 'switch');
    el.setAttribute('data-theme', device.theme);

    // Row of switch ports with divider every 6 — some active, some empty
    const totalPorts = 12;
    const activePorts = Math.min(device.portCount + 1, totalPorts);
    let portsHtml = '<div class="rack-switch-ports">';
    for (let i = 0; i < totalPorts; i++) {
      if (i === 6) portsHtml += '<div class="rack-switch-port-divider"></div>';
      portsHtml += `<div class="rack-conn-port ${i < activePorts ? 'rack-conn-port-active' : ''}"></div>`;
    }
    portsHtml += '</div>';

    el.innerHTML = `
      <div class="rack-device-accent" style="background:${device.color}"></div>
      <div class="rack-device-header">
        <span class="rack-device-name" style="color:${device.color}">${esc(device.name)}</span>
        <span class="rack-device-model">Crisco 2960X</span>
        <div class="rack-switch-leds">
          <div class="rack-switch-led" style="background:${device.color}"></div>
          <div class="rack-switch-led" style="background:${device.color}"></div>
          <div class="rack-switch-led" style="background:${device.color}"></div>
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
          <div class="rack-switch-led" style="background:var(--accent-green)"></div>
          <div class="rack-switch-led" style="background:var(--accent-green)"></div>
          <div class="rack-switch-led" style="background:var(--accent-blue)"></div>
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

    // 24 drive bays (2 rows of 12)
    let baysHtml = '<div class="rack-storage-bay-grid">';
    for (let i = 0; i < 24; i++) {
      const active = i < 18; // first 18 bays occupied, rest empty
      const bayClass = active ? 'rack-storage-bay-occupied' : 'rack-storage-bay-empty';
      const actLed = active ? 'active' : '';
      baysHtml += `
        <div class="rack-storage-bay ${bayClass}" data-bay="${i}">
          <div class="rack-storage-bay-leds">
            <div class="rack-storage-led-activity ${actLed}"></div>
            <div class="rack-storage-led-fault"></div>
          </div>
        </div>
      `;
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
          <div class="rack-switch-led" style="background:var(--accent-blue)"></div>
          <div class="rack-switch-led" style="background:var(--accent-blue)"></div>
          <div class="rack-switch-led" style="background:var(--accent-green)"></div>
        </div>
      </div>
      <div class="rack-storage-body">
        <div class="rack-storage-lcd">
          <div class="rack-storage-lcd-line">${iops.toLocaleString()} IOPS</div>
          <div class="rack-storage-lcd-line">${usedTB}/${totalTB} TB</div>
          <div class="rack-storage-lcd-line rack-storage-lcd-line-dim">CLUSTER: HEALTHY</div>
        </div>
        ${baysHtml}
      </div>
    `;

    return el;
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
          <div class="rack-switch-led" style="background:#2563EB"></div>
          <div class="rack-switch-led" style="background:#2563EB"></div>
          <div class="rack-switch-led" style="background:var(--accent-green)"></div>
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
    el.className = 'rack-device rack-device-ups rack-device-2u';
    el.setAttribute('data-device-type', 'ups');

    const load = 15 + Math.floor(Math.random() * 25);
    const voltage = 120 + Math.floor(Math.random() * 3);

    el.innerHTML = `
      <div class="rack-device-header">
        <span class="rack-device-name">EATEN 5PX</span>
        <span class="rack-ups-status">&#9679; ONLINE</span>
      </div>
      <div class="rack-ups-body">
        <div class="rack-ups-lcd">
          <div class="rack-ups-lcd-line">${voltage}V ${load}% LOAD</div>
          <div class="rack-ups-lcd-line rack-ups-lcd-line-dim">BAT: ${device.pct}% ${device.runtime}min</div>
        </div>
        <div class="rack-ups-info">
          <div class="rack-ups-bar">
            <div class="rack-ups-track">
              <div class="rack-ups-fill" style="width:${device.pct}%"></div>
            </div>
            <span class="rack-ups-pct">${device.pct}%</span>
          </div>
          <div class="rack-ups-meta">
            <span>Runtime: ${device.runtime}min</span>
            <span>Load: ${load}%</span>
          </div>
          <div class="rack-ups-leds">
            <div class="rack-ups-led rack-ups-led-on" title="Online"></div>
            <div class="rack-ups-led rack-ups-led-bat" title="Battery"></div>
            <div class="rack-ups-led rack-ups-led-fault" title="Fault"></div>
          </div>
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
