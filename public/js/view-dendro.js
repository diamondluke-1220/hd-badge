// ─── Dendrogram Renderer (Org Tree View) ──────────────────
// Implements the renderer interface: { init, addBadge, destroy }
// D3 tree layout: Root → Divisions → Departments → Employees (4 levels).

window.DendroRenderer = {
  _container: null,
  _stats: null,
  _svg: null,
  _g: null,
  _zoom: null,
  _defs: null,
  _cssLink: null,
  _treeData: null,
  _width: 0,
  _height: 0,
  _resizeObserver: null,
  _animLayer: null, // separate SVG group for animations (survives _renderTree)
  _nodeIndex: {},  // employeeId → tree node data
  _collapsed: new Set(),      // division themes that are collapsed
  _collapsedDepts: new Set(), // department keys that are collapsed (format: "divTheme::deptName")
  _arrived: new Set(),        // empIds whose animation has completed (show photo)
  _pendingBadges: [],         // SSE badges awaiting batch render
  _debounceTimer: null,       // debounce timer for batch SSE renders
  _DEBOUNCE_MS: 2000,         // batch window for SSE re-renders
  _OTHER_THRESHOLD: 2,        // custom depts with ≤ this many employees → "OTHER" bucket
  _packetTimer: null,          // interval for spawning packet animations
  _cliTimer: null,             // interval for spawning CLI popup windows
  _isUserInteracting: false,   // tracks if user is actively panning/zooming
  _interactionTimeout: null,   // debounce for interaction end detection

  // Division accent colors — from shared.js DIVISION_ACCENT_COLORS

  async init(container, stats) {
    this._container = container;
    this._stats = stats;
    this._nodeIndex = {};
    this._collapsed = new Set();
    this._collapsedDepts = new Set();
    this._arrived = new Set();

    // Load CSS
    this._cssLink = document.createElement('link');
    this._cssLink.rel = 'stylesheet';
    this._cssLink.href = '/css/dendro.css';
    document.head.appendChild(this._cssLink);

    // Ensure D3 is loaded
    const d3Loaded = await this._loadD3();
    if (!d3Loaded) {
      container.innerHTML = '<div class="dendro-fallback">Failed to load visualization library.<br>Try refreshing the page.</div>';
      return;
    }

    // Fetch all badges (paginated to handle 500+)
    let allBadges = [];
    try {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const resp = await fetch(`/api/orgchart?page=${page}&limit=100`);
        const data = await resp.json();
        allBadges = allBadges.concat(data.badges || []);
        totalPages = data.pages;
        page++;
      }
    } catch {
      container.innerHTML = '<div class="dendro-fallback">Failed to load employee data.</div>';
      return;
    }

    // Initialize shared stats (ticker, donut)
    initRendererStats(stats);

    // Empty state — no badges yet
    if (allBadges.length === 0) {
      container.innerHTML = '<div class="dendro-fallback">No employees on the org chart yet.<br><a href="/" style="color:#5B8DEF;margin-top:8px;display:inline-block;">Be the first employee &rarr;</a></div>';
      return;
    }

    // Build tree hierarchy and render
    this._buildTree(allBadges);
    this._render();
  },

  addBadge(badge) {
    if (!this._svg || !this._treeData || typeof d3 === 'undefined') {
      return null;
    }

    const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
    const deptName = badge.department;
    const empKey = badge.employeeId;

    // Dedup
    if (this._nodeIndex[empKey]) {
      return null;
    }

    // Auto-expand division and department if collapsed so new badge is visible
    if (this._collapsed.has(divTheme)) {
      this._collapsed.delete(divTheme);
    }
    const deptKey = `${divTheme}::${deptName}`;
    if (this._collapsedDepts.has(deptKey)) {
      this._collapsedDepts.delete(deptKey);
    }

    // Find or create division node
    let divNode = this._treeData.children.find(c => c._divTheme === divTheme);
    if (!divNode) {
      const divInfo = PUBLIC_DIVISIONS.find(d => d.theme === divTheme);
      divNode = {
        name: divInfo ? divInfo.name : divTheme,
        _type: 'division',
        _divTheme: divTheme,
        _color: DIVISION_ACCENT_COLORS[divTheme] || '#ffd700',
        children: [],
      };
      this._treeData.children.push(divNode);
    }

    // Find or create department node within division
    if (!divNode.children) divNode.children = [];
    let deptNode = divNode.children.find(c => c._type === 'department' && c._deptName === deptName);
    if (!deptNode) {
      deptNode = {
        name: deptName,
        _type: 'department',
        _deptName: deptName,
        _divTheme: divTheme,
        _color: DIVISION_ACCENT_COLORS[divTheme] || '#ffd700',
        children: [],
      };
      divNode.children.push(deptNode);
    }

    // Add employee to department
    const empNode = {
      name: badge.name,
      _type: 'employee',
      _badge: badge,
      _divTheme: divTheme,
      _deptName: deptName,
      _color: DIVISION_ACCENT_COLORS[divTheme] || '#ffd700',
    };
    if (!deptNode.children) deptNode.children = [];
    deptNode.children.push(empNode);
    this._nodeIndex[empKey] = empNode;

    // Queue for debounced batch render instead of immediate re-render
    this._pendingBadges.push({ badge, empKey });

    // If only 1 pending badge (first in batch), render immediately for responsiveness
    if (this._pendingBadges.length === 1 && !this._debounceTimer) {
      this._flushPendingBadges();
    } else {
      // Additional badges within debounce window — defer render
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => this._flushPendingBadges(), this._DEBOUNCE_MS);
    }

    // Return the node element (will exist after flush for first badge, null for queued)
    return this._g.select(`[data-emp-id="${empKey}"]`).node();
  },

  _flushPendingBadges() {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = null;

    if (this._pendingBadges.length === 0) return;

    const flushed = this._pendingBadges.splice(0);

    // Single D3 re-render for all queued badges
    this._renderTree();

    // Queue ping trace animations sequentially for each flushed badge
    // (handled by processLiveQueue in app.js — the nodeEl lookup happens after render)
  },

  destroy() {
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this._cssLink) { this._cssLink.remove(); this._cssLink = null; }
    if (this._debounceTimer) { clearTimeout(this._debounceTimer); this._debounceTimer = null; }
    if (this._packetTimer) { clearInterval(this._packetTimer); this._packetTimer = null; }
    if (this._cliTimer) { clearInterval(this._cliTimer); this._cliTimer = null; }
    if (this._interactionTimeout) { clearTimeout(this._interactionTimeout); this._interactionTimeout = null; }
    if (this._container) { this._container.innerHTML = ''; }
    this._container = null;
    this._stats = null;
    this._svg = null;
    this._g = null;
    this._animLayer = null;
    this._zoom = null;
    this._defs = null;
    this._treeData = null;
    this._nodeIndex = {};
    this._collapsed = new Set();
    this._collapsedDepts = new Set();
    this._arrived = new Set();
    this._pendingBadges = [];
  },

  // ─── Private helpers ────────────────────────────────────

  _loadD3() {
    return new Promise((resolve) => {
      if (typeof d3 !== 'undefined') { resolve(true); return; }
      const script = document.createElement('script');
      script.src = '/lib/d3.min.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  },

  // Generate a stable key for a department node (used in collapse sets and data attributes)
  _deptKey(divTheme, deptName) {
    return `${divTheme}::${deptName}`;
  },

  _buildTree(allBadges) {
    const totalBadges = allBadges.length;

    // Group badges: division → department → badges[]
    const byDivDept = {};
    PUBLIC_DIVISIONS.forEach(d => { byDivDept[d.theme] = {}; });
    allBadges.forEach(badge => {
      const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
      if (!byDivDept[divTheme]) byDivDept[divTheme] = {};
      const dept = badge.department;
      if (!byDivDept[divTheme][dept]) byDivDept[divTheme][dept] = [];
      byDivDept[divTheme][dept].push(badge);
    });

    // Build hierarchy: Root → Divisions → Departments → Employees
    const root = {
      name: 'HELP DESK INC.',
      _type: 'root',
      _color: '#D4A843',
      children: [],
    };

    PUBLIC_DIVISIONS.forEach(div => {
      const deptMap = byDivDept[div.theme] || {};
      const deptNames = Object.keys(deptMap);
      if (deptNames.length === 0) return; // skip empty divisions

      const divColor = DIVISION_ACCENT_COLORS[div.theme] || '#ffd700';
      const divNode = {
        name: div.name,
        _type: 'division',
        _divTheme: div.theme,
        _color: divColor,
        children: [],
      };

      // For _custom division, bucket small departments into "OTHER"
      let otherBadges = [];
      const normalDepts = [];

      deptNames.forEach(deptName => {
        const badges = deptMap[deptName];
        if (div.theme === '_custom' && badges.length <= this._OTHER_THRESHOLD) {
          otherBadges = otherBadges.concat(badges);
        } else {
          normalDepts.push({ deptName, badges });
        }
      });

      // Create department nodes
      normalDepts.forEach(({ deptName, badges }) => {
        const deptNode = {
          name: deptName,
          _type: 'department',
          _deptName: deptName,
          _divTheme: div.theme,
          _color: divColor,
          children: badges.map(badge => {
            const empNode = {
              name: badge.name,
              _type: 'employee',
              _badge: badge,
              _divTheme: div.theme,
              _deptName: deptName,
              _color: divColor,
            };
            this._nodeIndex[badge.employeeId] = empNode;
            this._arrived.add(badge.employeeId); // initial load = already arrived
            return empNode;
          }),
        };
        divNode.children.push(deptNode);
      });

      // "OTHER" bucket for small custom departments
      if (otherBadges.length > 0) {
        const otherNode = {
          name: 'OTHER',
          _type: 'department',
          _deptName: 'OTHER',
          _divTheme: div.theme,
          _color: divColor,
          children: otherBadges.map(badge => {
            const empNode = {
              name: badge.name,
              _type: 'employee',
              _badge: badge,
              _divTheme: div.theme,
              _deptName: 'OTHER',
              _color: divColor,
            };
            this._nodeIndex[badge.employeeId] = empNode;
            this._arrived.add(badge.employeeId);
            return empNode;
          }),
        };
        divNode.children.push(otherNode);
      }

      root.children.push(divNode);
    });

    this._treeData = root;

    // --- Tiered auto-collapse ---
    // Collapse departments with >15 employees
    root.children.forEach(divNode => {
      (divNode.children || []).forEach(deptNode => {
        if ((deptNode.children || []).length > 15) {
          this._collapsedDepts.add(this._deptKey(divNode._divTheme, deptNode._deptName));
        }
      });
    });

    // Collapse all departments when total >100
    if (totalBadges > 100) {
      root.children.forEach(divNode => {
        (divNode.children || []).forEach(deptNode => {
          this._collapsedDepts.add(this._deptKey(divNode._divTheme, deptNode._deptName));
        });
      });
    }

    // Collapse all divisions when total >200
    if (totalBadges > 200) {
      root.children.forEach(divNode => {
        this._collapsed.add(divNode._divTheme);
      });
    }
  },

  _render() {
    const container = this._container;
    const wrapper = document.createElement('div');
    wrapper.className = 'dendro-container';
    container.appendChild(wrapper);

    const rect = wrapper.getBoundingClientRect();
    this._width = rect.width || 900;
    this._height = Math.max(rect.height, 600);

    this._svg = d3.select(wrapper)
      .append('svg')
      .attr('width', this._width)
      .attr('height', this._height)
      .attr('role', 'img')
      .attr('aria-label', 'Help Desk organizational tree');

    // Glow filter
    this._defs = this._svg.append('defs');
    const glow = this._defs.append('filter')
      .attr('id', 'dendro-glow')
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%');
    glow.append('feGaussianBlur')
      .attr('stdDeviation', '2.5')
      .attr('result', 'blur');
    glow.append('feMerge')
      .selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic'])
      .join('feMergeNode')
      .attr('in', d => d);

    // Zoom — apply transform to both tree layer and animation layer
    this._zoom = d3.zoom()
      .scaleExtent([0.2, 3])
      .on('zoom', (event) => {
        this._g.attr('transform', event.transform);
        if (this._animLayer) this._animLayer.attr('transform', event.transform);

        // Pause packet animations during interaction
        this._isUserInteracting = true;
        clearTimeout(this._interactionTimeout);
        this._interactionTimeout = setTimeout(() => {
          this._isUserInteracting = false;
        }, 500);
      });
    this._svg.call(this._zoom);

    this._g = this._svg.append('g');
    this._animLayer = this._svg.append('g').attr('class', 'dendro-anim-layer');

    this._renderTree();

    // Auto-fit after initial render
    this._autoFit(wrapper);

    // Start idle animations
    this._startPacketAnimation();
    this._startCLIPopups();

    // Resize
    this._resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      const h = Math.max(entry.contentRect.height, 600);
      this._width = w;
      this._height = h;
      this._svg.attr('width', w).attr('height', h);
    });
    this._resizeObserver.observe(wrapper);

  },

  _renderTree() {
    if (!this._g || !this._treeData) return;

    // Clear previous tree content
    this._g.selectAll('*').remove();

    // Clear old thumbnail patterns from defs to prevent duplicate IDs
    if (this._defs) {
      this._defs.selectAll('pattern[id^="dendro-thumb-"]').remove();
    }

    // Count total visible employees for dynamic spacing
    let totalVisible = 0;
    const countEmployees = (node) => {
      if (node._type === 'employee') { totalVisible++; return; }
      (node.children || []).forEach(countEmployees);
    };
    countEmployees(this._treeData);

    // Build filtered tree — handle collapse at both division and department level
    const filteredTree = {
      ...this._treeData,
      children: (this._treeData.children || []).map(divNode => {
        if (this._collapsed.has(divNode._divTheme)) {
          // Collapsed division: count ALL employees across all departments
          let empCount = 0;
          (divNode.children || []).forEach(dept => {
            empCount += (dept.children || []).length;
          });
          return {
            ...divNode,
            _childCount: empCount,
            children: undefined,
          };
        }
        // Division expanded — check department-level collapse
        return {
          ...divNode,
          children: (divNode.children || []).map(deptNode => {
            const deptKey = this._deptKey(divNode._divTheme, deptNode._deptName);
            if (this._collapsedDepts.has(deptKey)) {
              return {
                ...deptNode,
                _childCount: (deptNode.children || []).length,
                children: undefined,
              };
            }
            return deptNode;
          }),
        };
      }),
    };

    // Create D3 hierarchy
    const root = d3.hierarchy(filteredTree);

    // Dynamic spacing based on badge count
    const verticalSpacing = totalVisible <= 50 ? 42 : totalVisible <= 200 ? 32 : 26;
    const horizontalSpacing = 260; // wider to use canvas width with 4 levels

    const treeLayout = d3.tree()
      .nodeSize([verticalSpacing, horizontalSpacing])
      .separation((a, b) => a.parent === b.parent ? 1 : 1.4);

    treeLayout(root);

    // Links — curved paths (tagged with source/target for animation lookup)
    this._g.selectAll('path.dendro-link')
      .data(root.links())
      .join('path')
      .attr('class', 'dendro-link')
      .attr('data-target-id', d => {
        const td = d.target.data;
        if (td._badge) return td._badge.employeeId;
        if (td._type === 'department') return this._deptKey(td._divTheme, td._deptName);
        if (td._divTheme) return td._divTheme;
        return '';
      })
      .attr('data-source-id', d => {
        const sd = d.source.data;
        if (sd._badge) return sd._badge.employeeId;
        if (sd._type === 'department') return this._deptKey(sd._divTheme, sd._deptName);
        if (sd._divTheme) return sd._divTheme;
        return 'root';
      })
      .attr('data-link-type', d => {
        const tt = d.target.data._type;
        if (tt === 'division') return 'root-div';
        if (tt === 'department') return 'div-dept';
        if (tt === 'employee') return 'dept-emp';
        return 'unknown';
      })
      .attr('d', d => {
        return `M${d.source.y},${d.source.x} C${(d.source.y + d.target.y) / 2},${d.source.x} ${(d.source.y + d.target.y) / 2},${d.target.x} ${d.target.y},${d.target.x}`;
      })
      .attr('stroke', d => d.target.data._color || '#4b5563')
      .attr('stroke-opacity', d => {
        const t = d.target.data._type;
        if (t === 'division') return 0.6;
        if (t === 'department') return 0.4;
        return 0.25; // employee
      })
      .attr('stroke-width', d => {
        const t = d.target.data._type;
        if (t === 'division') return 2.5;
        if (t === 'department') return 2;
        return 1.5; // employee
      });

    // Node groups
    const nodes = this._g.selectAll('g.dendro-node')
      .data(root.descendants())
      .join('g')
      .attr('class', d => `dendro-node dendro-node-${d.data._type}`)
      .attr('role', d => d.data._type === 'employee' ? 'img' : null)
      .attr('aria-label', d => {
        if (d.data._type === 'employee' && d.data._badge) return `${d.data._badge.name}, ${d.data._badge.title}`;
        if (d.data._type === 'department') return `${d.data.name} department`;
        if (d.data._type === 'division') return `${d.data.name} division`;
        return null;
      })
      .attr('data-emp-id', d => d.data._badge ? d.data._badge.employeeId : null)
      .attr('data-dept-key', d => d.data._type === 'department' ? this._deptKey(d.data._divTheme, d.data._deptName) : null)
      .attr('transform', d => `translate(${d.y},${d.x})`);

    // ─── Root node — Router/Switch icon ───
    const rootNodes = nodes.filter(d => d.data._type === 'root');

    // Router body
    rootNodes.append('rect')
      .attr('x', -28)
      .attr('y', -14)
      .attr('width', 56)
      .attr('height', 28)
      .attr('rx', 4)
      .attr('ry', 4)
      .attr('fill', '#0a0a0f')
      .attr('stroke', '#D4A843')
      .attr('stroke-width', 2.5)
      .attr('filter', 'url(#dendro-glow)');

    // Port indicators (4 ethernet ports across front)
    [-18, -6, 6, 18].forEach(px => {
      rootNodes.append('rect')
        .attr('x', px - 3)
        .attr('y', -4)
        .attr('width', 6)
        .attr('height', 8)
        .attr('rx', 1)
        .attr('fill', 'none')
        .attr('stroke', '#D4A843')
        .attr('stroke-width', 1)
        .attr('stroke-opacity', 0.7);
    });

    // Status LEDs (2 small dots on top)
    rootNodes.append('circle')
      .attr('cx', -10).attr('cy', -8)
      .attr('r', 2)
      .attr('fill', '#00ff41')
      .attr('class', 'dendro-router-led');
    rootNodes.append('circle')
      .attr('cx', -4).attr('cy', -8)
      .attr('r', 2)
      .attr('fill', '#D4A843')
      .attr('class', 'dendro-router-led');

    // Antenna nubs (top edges)
    rootNodes.append('line')
      .attr('x1', -22).attr('y1', -14)
      .attr('x2', -22).attr('y2', -20)
      .attr('stroke', '#D4A843')
      .attr('stroke-width', 1.5)
      .attr('stroke-linecap', 'round');
    rootNodes.append('line')
      .attr('x1', 22).attr('y1', -14)
      .attr('x2', 22).attr('y2', -20)
      .attr('stroke', '#D4A843')
      .attr('stroke-width', 1.5)
      .attr('stroke-linecap', 'round');

    rootNodes.append('text')
      .attr('class', 'dendro-label dendro-label-root')
      .attr('dy', -26)
      .text(d => d.data.name);

    // ─── Division nodes ───
    const divNodes = nodes.filter(d => d.data._type === 'division');

    divNodes.append('rect')
      .attr('x', -24)
      .attr('y', -16)
      .attr('width', 48)
      .attr('height', 32)
      .attr('rx', 8)
      .attr('ry', 8)
      .attr('fill', d => d.data._color)
      .attr('fill-opacity', 0.12)
      .attr('stroke', d => d.data._color)
      .attr('stroke-width', 2)
      .attr('filter', 'url(#dendro-glow)');

    divNodes.append('text')
      .attr('class', 'dendro-label dendro-label-div')
      .attr('dy', -24)
      .attr('fill', d => d.data._color)
      .text(d => d.data.name);

    // Division count: total employees across all departments
    divNodes.append('text')
      .attr('class', 'dendro-label-count')
      .attr('dy', 4)
      .text(d => {
        if (d.data._childCount != null) return d.data._childCount; // collapsed
        // Expanded: sum employees across departments
        let count = 0;
        (d.children || []).forEach(dept => {
          if (dept.data._childCount != null) count += dept.data._childCount;
          else count += (dept.children || []).length;
        });
        return count;
      });

    // Collapsed indicator
    divNodes.append('text')
      .attr('class', 'dendro-label-count')
      .attr('dx', 30)
      .attr('dy', 4)
      .attr('font-size', '9px')
      .attr('fill', '#6b7280')
      .text(d => this._collapsed.has(d.data._divTheme) ? '▶' : (d.children && d.children.length > 0 ? '▼' : ''));

    // Click handler for division collapse/expand
    divNodes.style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        const theme = d.data._divTheme;
        if (this._collapsed.has(theme)) {
          this._collapsed.delete(theme);
        } else {
          this._collapsed.add(theme);
        }
        this._renderTree();
        this._autoFit(this._container.querySelector('.dendro-container'));
      });

    // ─── Department nodes ───
    const deptNodes = nodes.filter(d => d.data._type === 'department');

    deptNodes.append('rect')
      .attr('x', -18)
      .attr('y', -12)
      .attr('width', 36)
      .attr('height', 24)
      .attr('rx', 6)
      .attr('ry', 6)
      .attr('fill', d => d.data._color)
      .attr('fill-opacity', 0.08)
      .attr('stroke', d => d.data._color)
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6);

    deptNodes.append('text')
      .attr('class', 'dendro-label dendro-label-dept')
      .attr('dy', -18)
      .attr('fill', d => d.data._color)
      .attr('fill-opacity', 0.8)
      .attr('font-size', '9px')
      .attr('text-anchor', 'middle')
      .text(d => d.data.name);

    // Department count
    deptNodes.append('text')
      .attr('class', 'dendro-label-count')
      .attr('dy', 3)
      .attr('font-size', '9px')
      .text(d => {
        if (d.data._childCount != null) return d.data._childCount; // collapsed
        return d.children ? d.children.length : 0;
      });

    // Collapsed indicator for departments
    deptNodes.append('text')
      .attr('class', 'dendro-label-count')
      .attr('dx', 22)
      .attr('dy', 3)
      .attr('font-size', '8px')
      .attr('fill', '#6b7280')
      .text(d => {
        const deptKey = this._deptKey(d.data._divTheme, d.data._deptName);
        if (this._collapsedDepts.has(deptKey)) return '▶';
        return (d.children && d.children.length > 0) ? '▼' : '';
      });

    // Click handler for department collapse/expand
    deptNodes.style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        const deptKey = this._deptKey(d.data._divTheme, d.data._deptName);
        if (this._collapsedDepts.has(deptKey)) {
          this._collapsedDepts.delete(deptKey);
        } else {
          this._collapsedDepts.add(deptKey);
        }
        this._renderTree();
        this._autoFit(this._container.querySelector('.dendro-container'));
      });

    // ─── Employee nodes ───
    const empNodes = nodes.filter(d => d.data._type === 'employee');

    empNodes.each((d, i, elems) => {
      if (!d.data._badge) return;
      const patId = `dendro-thumb-${d.data._badge.employeeId}`;
      this._defs.append('pattern')
        .attr('id', patId)
        .attr('width', 1).attr('height', 1)
        .append('image')
        .attr('href', `/api/badge/${d.data._badge.employeeId}/headshot`)
        .attr('width', 28)
        .attr('height', 28)
        .attr('preserveAspectRatio', 'xMidYMid slice');

      const el = d3.select(elems[i]);
      const hasArrived = this._arrived.has(d.data._badge.employeeId);
      if (!hasArrived) {
        el.append('circle')
          .attr('r', 14)
          .attr('fill', '#1C1C22')
          .attr('stroke', d.data._color)
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '4 3')
          .attr('stroke-opacity', 0.5)
          .attr('class', 'dendro-awaiting')
          .attr('data-pat-id', patId);
      } else {
        el.append('circle')
          .attr('r', 14)
          .attr('fill', `url(#${patId})`)
          .attr('stroke', d.data._color)
          .attr('stroke-width', 2);
      }
    });

    // Employee name labels
    empNodes.append('text')
      .attr('class', 'dendro-label dendro-label-emp')
      .attr('x', 20)
      .attr('dy', 2)
      .text(d => d.data.name);

    // Employee title labels
    empNodes.append('text')
      .attr('class', 'dendro-label-title')
      .attr('x', 20)
      .attr('dy', 15)
      .text(d => d.data._badge ? d.data._badge.title : '');

    // Click handler for employees
    empNodes.filter(d => d.data._badge)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        showBadgeDetail(d.data._badge.employeeId, d.data._badge.name);
      });

  },

  _autoFit(wrapper) {
    if (!this._g || !this._svg) return;

    // Get bounding box of all rendered content
    const gNode = this._g.node();
    if (!gNode) return;
    const bbox = gNode.getBBox();
    if (bbox.width === 0 || bbox.height === 0) return;

    const padding = 60;
    const fullWidth = bbox.width + padding * 2;
    const fullHeight = bbox.height + padding * 2;

    const scaleX = this._width / fullWidth;
    const scaleY = this._height / fullHeight;
    const scale = Math.min(scaleX, scaleY, 1.5); // cap max zoom

    const translateX = (this._width / 2) - (bbox.x + bbox.width / 2) * scale;
    const translateY = (this._height / 2) - (bbox.y + bbox.height / 2) * scale;

    this._svg.call(
      this._zoom.transform,
      d3.zoomIdentity.translate(translateX, translateY).scale(scale)
    );
  },

  // ─── Packet Animation — dots traveling along links ──────
  _startPacketAnimation() {
    if (this._packetTimer) clearInterval(this._packetTimer);

    const spawnPacket = () => {
      if (this._isUserInteracting || !this._animLayer) return;

      // Pick a random visible link
      const links = this._g.selectAll('path.dendro-link').nodes();
      if (links.length === 0) return;

      // Limit concurrent packets
      const existing = this._animLayer.selectAll('.dendro-packet').nodes();
      if (existing.length >= 6) return;

      const link = links[Math.floor(Math.random() * links.length)];
      const color = link.getAttribute('stroke') || '#D4A843';
      const pathData = link.getAttribute('d');
      if (!pathData) return;

      // Create packet dot
      const packet = this._animLayer.append('circle')
        .attr('class', 'dendro-packet')
        .attr('r', 3)
        .attr('fill', color)
        .attr('filter', 'url(#dendro-glow)')
        .attr('opacity', 0.8);

      // Animate along path using SVG animateMotion
      const pathLen = link.getTotalLength();
      const duration = 1500 + Math.random() * 1500; // 1.5-3s
      const startTime = performance.now();

      const animate = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);

        if (progress >= 1) {
          packet.remove();
          return;
        }

        const point = link.getPointAtLength(progress * pathLen);
        packet.attr('cx', point.x).attr('cy', point.y);
        packet.attr('opacity', progress < 0.1 ? progress * 8 : progress > 0.9 ? (1 - progress) * 8 : 0.8);
        requestAnimationFrame(animate);
      };

      requestAnimationFrame(animate);
    };

    // Spawn a packet every 800-1200ms
    this._packetTimer = setInterval(spawnPacket, 900);
    // Spawn one immediately
    spawnPacket();
  },

  // ─── CLI Popup Windows — network log messages on nodes ──
  _CLI_MESSAGES: [
    'arp who-has 10.0.1.1 tell 10.0.1.254',
    'arp reply 10.0.1.1 is-at aa:bb:cc:dd:ee:ff',
    '%LINK-3-UPDOWN: Interface Gi0/1, changed state to up',
    '%LINEPROTO-5-UPDOWN: Line protocol on Gi0/2, changed state to up',
    '%SYS-5-CONFIG_I: Configured from console',
    'Neighbor 10.0.0.2 Up on GigabitEthernet0/1',
    '%OSPF-5-ADJCHG: Nbr 10.0.0.1 on Gi0/1: Full',
    'show mac address-table | inc 0050.56b3',
    '%CDP-4-DUPLEX_MISMATCH: duplex mismatch Gi0/3',
    'ping 10.0.1.1 !!!!! Success rate is 100 percent',
    '%DHCPD: assigned 10.0.1.42 to 00:50:56:b3:01:01',
    'traceroute 10.0.2.1\n 1 10.0.1.1 1ms\n 2 10.0.2.1 4ms',
    'show int status | inc connected',
    '%STORM_CONTROL-3: rising threshold on Gi0/4',
    '%SPANNING-TREE: Port Gi0/5 -> forwarding',
  ],

  _startCLIPopups() {
    if (this._cliTimer) clearInterval(this._cliTimer);

    const spawnPopup = () => {
      if (this._isUserInteracting || !this._svg) return;

      // Pick a random node (division or department — not employees to avoid clutter)
      const nodeEls = this._g.selectAll('g.dendro-node-division, g.dendro-node-department').nodes();
      if (nodeEls.length === 0) return;

      // Limit concurrent popups
      const container = this._container.querySelector('.dendro-container');
      if (!container) return;
      const existingPopups = container.querySelectorAll('.dendro-cli-popup');
      if (existingPopups.length >= 2) return;

      const nodeEl = nodeEls[Math.floor(Math.random() * nodeEls.length)];
      const transform = nodeEl.getAttribute('transform');
      if (!transform) return;

      // Parse translate(x, y) from transform
      const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      if (!match) return;

      const nodeX = parseFloat(match[1]);
      const nodeY = parseFloat(match[2]);

      // Get current zoom transform to position the popup correctly
      const currentTransform = d3.zoomTransform(this._svg.node());
      const screenX = currentTransform.applyX(nodeX);
      const screenY = currentTransform.applyY(nodeY);

      // Pick random CLI message
      const msg = this._CLI_MESSAGES[Math.floor(Math.random() * this._CLI_MESSAGES.length)];

      // Create popup HTML element
      const popup = document.createElement('div');
      popup.className = 'dendro-cli-popup';
      popup.style.left = screenX + 'px';
      popup.style.top = (screenY - 40) + 'px';

      // Build CLI window content
      popup.innerHTML = `<div class="dendro-cli-header"><span class="dendro-cli-dot red"></span><span class="dendro-cli-dot yellow"></span><span class="dendro-cli-dot green"></span><span class="dendro-cli-title">switch#</span></div><div class="dendro-cli-body"></div>`;
      container.appendChild(popup);

      // Typewriter effect for the CLI message
      const body = popup.querySelector('.dendro-cli-body');
      let charIdx = 0;
      const typeInterval = setInterval(() => {
        if (charIdx < msg.length) {
          if (msg[charIdx] === '\n') {
            body.appendChild(document.createElement('br'));
          } else {
            body.appendChild(document.createTextNode(msg[charIdx]));
          }
          charIdx++;
        } else {
          clearInterval(typeInterval);
        }
      }, 30);

      // Auto-dismiss after 3-4 seconds
      const dismissDelay = 3000 + Math.random() * 1000;
      setTimeout(() => {
        popup.classList.add('dendro-cli-fade');
        setTimeout(() => {
          clearInterval(typeInterval);
          popup.remove();
        }, 400);
      }, dismissDelay);
    };

    // Spawn a popup every 4-6 seconds
    this._cliTimer = setInterval(spawnPopup, 4500);
    // First one after a short delay
    setTimeout(spawnPopup, 2000);
  },
};
