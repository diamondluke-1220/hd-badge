// ─── Dendrogram Renderer (Org Tree View) ──────────────────
// Implements the renderer interface: { init, addBadge, destroy }
// D3 tree layout: CEO node → divisions → departments → employees.

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
  _nodeIndex: {},  // employeeId → tree node data
  _collapsed: new Set(), // division themes that are collapsed
  _COLLAPSE_THRESHOLD: 50, // auto-collapse when total badges exceed this
  _pendingBadges: [],      // SSE badges awaiting batch render
  _debounceTimer: null,    // debounce timer for batch SSE renders
  _DEBOUNCE_MS: 2000,      // batch window for SSE re-renders

  // Division → color (matches network view)
  _COLORS: {
    '_exec':     '#ffffff',
    'IT':        '#00d4ff',
    'Office':    '#ff3366',
    'Corporate': '#ff6b35',
    'Punk':      '#00ff41',
    '_custom':   '#ffd700',
  },

  async init(container, stats) {
    this._container = container;
    this._stats = stats;
    this._nodeIndex = {};
    this._collapsed = new Set();

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

    // Update shared stats
    window._tickerTotalHires = stats.visible || 0;
    if (stats.byDepartment) {
      window._tickerStats = Object.assign({}, stats.byDepartment);
    }
    initDonut(stats);

    // Build tree hierarchy and render
    this._buildTree(allBadges);
    this._render();
  },

  addBadge(badge) {
    if (!this._svg || !this._treeData || typeof d3 === 'undefined') {
      console.log('[Dendro] addBadge bail: svg/tree/d3 missing');
      return null;
    }

    const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
    const empKey = badge.employeeId;

    // Dedup
    if (this._nodeIndex[empKey]) {
      console.log('[Dendro] addBadge bail: dedup', empKey);
      return null;
    }

    // Auto-expand division if collapsed so new badge is visible
    if (this._collapsed.has(divTheme)) {
      this._collapsed.delete(divTheme);
    }

    // Add to tree data immediately (so subsequent addBadge calls see it for dedup)
    let divNode = this._treeData.children.find(c => c._divTheme === divTheme);
    if (!divNode) {
      const divInfo = PUBLIC_DIVISIONS.find(d => d.theme === divTheme);
      divNode = {
        name: divInfo ? divInfo.name : divTheme,
        _type: 'division',
        _divTheme: divTheme,
        _color: this._COLORS[divTheme] || '#ffd700',
        children: [],
      };
      this._treeData.children.push(divNode);
      console.log('[Dendro] Created new division node:', divTheme);
    }

    const empNode = {
      name: badge.name,
      _type: 'employee',
      _badge: badge,
      _divTheme: divTheme,
      _color: this._COLORS[divTheme] || '#ffd700',
    };
    if (!divNode.children) divNode.children = [];
    divNode.children.push(empNode);
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
    const nodeEl = this._g.select(`[data-emp-id="${empKey}"]`).node();
    console.log('[Dendro] addBadge result:', empKey, divTheme, nodeEl ? 'found' : 'queued');
    return nodeEl;
  },

  _flushPendingBadges() {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = null;

    if (this._pendingBadges.length === 0) return;

    const flushed = this._pendingBadges.splice(0);
    console.log(`[Dendro] Batch render: ${flushed.length} badge(s)`);

    // Single D3 re-render for all queued badges
    this._renderTree();

    // Queue ping trace animations sequentially for each flushed badge
    // (handled by processLiveQueue in app.js — the nodeEl lookup happens after render)
  },

  destroy() {
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this._cssLink) { this._cssLink.remove(); this._cssLink = null; }
    if (this._debounceTimer) { clearTimeout(this._debounceTimer); this._debounceTimer = null; }
    if (this._container) { this._container.innerHTML = ''; }
    this._container = null;
    this._stats = null;
    this._svg = null;
    this._g = null;
    this._zoom = null;
    this._defs = null;
    this._treeData = null;
    this._nodeIndex = {};
    this._collapsed = new Set();
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

  _buildTree(allBadges) {
    // Group badges by division
    const byDiv = {};
    PUBLIC_DIVISIONS.forEach(d => { byDiv[d.theme] = []; });
    allBadges.forEach(badge => {
      const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
      if (!byDiv[divTheme]) byDiv[divTheme] = [];
      byDiv[divTheme].push(badge);
    });

    // Build hierarchy: Root → Divisions → Employees
    const root = {
      name: 'HELP DESK INC.',
      _type: 'root',
      _color: '#D4A843',
      children: [],
    };

    PUBLIC_DIVISIONS.forEach(div => {
      const badges = byDiv[div.theme] || [];
      const divNode = {
        name: div.name,
        _type: 'division',
        _divTheme: div.theme,
        _color: this._COLORS[div.theme] || '#ffd700',
        children: badges.map(badge => {
          const empNode = {
            name: badge.name,
            _type: 'employee',
            _badge: badge,
            _divTheme: div.theme,
            _color: this._COLORS[div.theme] || '#ffd700',
          };
          this._nodeIndex[badge.employeeId] = empNode;
          return empNode;
        }),
      };
      // Only include divisions that have members
      if (badges.length > 0) {
        root.children.push(divNode);
      }
    });

    this._treeData = root;

    // Auto-collapse all divisions when total badge count exceeds threshold
    const totalBadges = allBadges.length;
    if (totalBadges > this._COLLAPSE_THRESHOLD) {
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
      .attr('height', this._height);

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

    // Zoom
    this._zoom = d3.zoom()
      .scaleExtent([0.2, 3])
      .on('zoom', (event) => {
        this._g.attr('transform', event.transform);
      });
    this._svg.call(this._zoom);

    this._g = this._svg.append('g');

    this._renderTree();

    // Auto-fit after initial render
    this._autoFit(wrapper);

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

    // Clear previous
    this._g.selectAll('*').remove();

    // Build filtered tree copy — collapsed divisions become leaf nodes
    const filteredTree = {
      ...this._treeData,
      children: (this._treeData.children || []).map(divNode => {
        if (this._collapsed.has(divNode._divTheme)) {
          // Collapsed: show as leaf with _childCount but no children
          return {
            ...divNode,
            _childCount: (divNode.children || []).length,
            children: undefined,
          };
        }
        return divNode;
      }),
    };

    // Create D3 hierarchy
    const root = d3.hierarchy(filteredTree);

    // Use tree layout (horizontal: root on left, leaves on right)
    const treeLayout = d3.tree()
      .nodeSize([42, 200])
      .separation((a, b) => a.parent === b.parent ? 1 : 1.4);

    treeLayout(root);

    // Links — curved paths (tagged with source/target for animation lookup)
    this._g.selectAll('path.dendro-link')
      .data(root.links())
      .join('path')
      .attr('class', 'dendro-link')
      .attr('data-target-id', d => d.target.data._badge ? d.target.data._badge.employeeId : (d.target.data._divTheme || ''))
      .attr('data-source-id', d => d.source.data._badge ? d.source.data._badge.employeeId : (d.source.data._divTheme || 'root'))
      .attr('d', d => {
        return `M${d.source.y},${d.source.x} C${(d.source.y + d.target.y) / 2},${d.source.x} ${(d.source.y + d.target.y) / 2},${d.target.x} ${d.target.y},${d.target.x}`;
      })
      .attr('stroke', d => d.target.data._color || '#4b5563')
      .attr('stroke-opacity', d => d.target.data._type === 'employee' ? 0.25 : 0.6)
      .attr('stroke-dasharray', d => d.target.data._type === 'employee' ? 'none' : 'none')
      .attr('stroke-width', d => d.target.data._type === 'employee' ? 1.5 : 2);

    // Node groups
    const nodes = this._g.selectAll('g.dendro-node')
      .data(root.descendants())
      .join('g')
      .attr('class', d => `dendro-node dendro-node-${d.data._type}`)
      .attr('data-emp-id', d => d.data._badge ? d.data._badge.employeeId : null)
      .attr('transform', d => `translate(${d.y},${d.x})`);

    // Root node — large circle with amber accent
    nodes.filter(d => d.data._type === 'root')
      .append('circle')
      .attr('r', 24)
      .attr('fill', '#0a0a0f')
      .attr('stroke', '#D4A843')
      .attr('stroke-width', 3)
      .attr('filter', 'url(#dendro-glow)');

    nodes.filter(d => d.data._type === 'root')
      .append('text')
      .attr('class', 'dendro-label dendro-label-root')
      .attr('dy', -28)
      .text(d => d.data.name);

    // Division nodes — rounded rectangles with glow
    nodes.filter(d => d.data._type === 'division')
      .append('rect')
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

    nodes.filter(d => d.data._type === 'division')
      .append('text')
      .attr('class', 'dendro-label dendro-label-div')
      .attr('dy', -24)
      .attr('fill', d => d.data._color)
      .text(d => d.data.name);

    // Division member count (use _childCount for collapsed, children.length for expanded)
    nodes.filter(d => d.data._type === 'division')
      .append('text')
      .attr('class', 'dendro-label-count')
      .attr('dy', 4)
      .text(d => {
        if (d.data._childCount != null) return d.data._childCount; // collapsed
        return d.children ? d.children.length : 0;
      });

    // Collapsed indicator (▶ / ▼)
    nodes.filter(d => d.data._type === 'division')
      .append('text')
      .attr('class', 'dendro-label-count')
      .attr('dx', 30)
      .attr('dy', 4)
      .attr('font-size', '9px')
      .attr('fill', '#6b7280')
      .text(d => this._collapsed.has(d.data._divTheme) ? '▶' : (d.children && d.children.length > 0 ? '▼' : ''));

    // Click handler for division collapse/expand
    nodes.filter(d => d.data._type === 'division')
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        const theme = d.data._divTheme;
        if (this._collapsed.has(theme)) {
          this._collapsed.delete(theme);
        } else {
          this._collapsed.add(theme);
        }
        this._renderTree();
        this._autoFit(this._container.querySelector('.dendro-container'));
      });

    // Employee nodes — small circles with thumbnail
    const empNodes = nodes.filter(d => d.data._type === 'employee');

    empNodes.each((d, i, elems) => {
      if (!d.data._badge) return;
      const patId = `dendro-thumb-${d.data._badge.employeeId}`;
      this._defs.append('pattern')
        .attr('id', patId)
        .attr('width', 1).attr('height', 1)
        .append('image')
        .attr('href', `/api/badge/${d.data._badge.employeeId}/thumb`)
        .attr('width', 28)
        .attr('height', 28)
        .attr('preserveAspectRatio', 'xMidYMid slice');

      d3.select(elems[i]).append('circle')
        .attr('r', 14)
        .attr('fill', `url(#${patId})`)
        .attr('stroke', d.data._color)
        .attr('stroke-width', 2);
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
};
