// ─── Grid Renderer (Default View) ─────────────────────────
// Implements the renderer interface: { init, addBadge, destroy }
// Renders the division-grouped employee directory grid.

window.GridRenderer = {
  _container: null,
  _stats: null,

  async init(container, stats) {
    this._container = container;
    this._stats = stats;

    // Org chart header
    container.innerHTML = `
      <div class="org-header">
        <div class="org-header-title">Help Desk <span class="org-header-accent">LLC.</span></div>
        <div class="org-header-sub">Employee Directory &bull; <span class="odometer" id="payrollOdometer">${this._buildOdometerDigits(stats.visible)}</span> on payroll</div>
      </div>
      <div class="dept-filter-bar" id="deptFilterBar"></div>
      <div class="active-dept-heading" id="activeDeptHeading"></div>
      <div id="publicBadgeContent" aria-live="polite" aria-relevant="additions"></div>
      <div id="loadMoreArea"></div>
    `;

    // Set initial odometer value
    const odo = document.getElementById('payrollOdometer');
    if (odo) odo.dataset.value = stats.visible;

    // Initialize donut chart with current stats
    window._tickerTotalHires = stats.visible || 0;
    if (stats.byDepartment) {
      window._tickerStats = Object.assign({}, stats.byDepartment);
    }
    initDonut(stats);

    // Department filter tabs — exclude band-exclusive depts
    const filterBar = document.getElementById('deptFilterBar');
    const allBtn = document.createElement('button');
    allBtn.className = 'dept-filter-btn active';
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', () => {
      window._publicOrgDept = '';
      window._publicOrgPage = 1;
      filterBar.querySelectorAll('.dept-filter-btn').forEach(b => b.classList.remove('active'));
      allBtn.classList.add('active');
      this._updateDeptHeading('', stats);
      this._loadBadges(true);
    });
    filterBar.appendChild(allBtn);

    Object.keys(stats.byDepartment).forEach(dept => {
      if (BAND_DEPTS.has(dept)) return;
      const count = stats.byDepartment[dept];
      const btn = document.createElement('button');
      btn.className = 'dept-filter-btn';
      btn.innerHTML = `${esc(dept)} <span class="dept-count">${count}</span>`;
      btn.addEventListener('click', () => {
        window._publicOrgDept = dept;
        window._publicOrgPage = 1;
        filterBar.querySelectorAll('.dept-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._updateDeptHeading(dept, stats);
        this._loadBadges(true);
      });
      filterBar.appendChild(btn);
    });

    // Load first page
    window._publicOrgPage = 1;
    this._updateDeptHeading('', stats);
    await this._loadBadges(true);
  },

  addBadge(badge) {
    const content = document.getElementById('publicBadgeContent');
    if (!content) return null;

    // Dedup: don't add if already in DOM
    if (content.querySelector(`[data-employee-id="${badge.employeeId}"]`)) return null;

    const card = this._createBadgeCard(badge);
    card.setAttribute('data-employee-id', badge.employeeId);
    card.classList.add('sse-new');

    if (!window._publicOrgDept) {
      // Division-grouped view: find the right division grid
      const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
      const divInfo = PUBLIC_DIVISIONS.find(d => d.theme === divTheme);
      if (!divInfo) return null;

      // Find existing division section or create one
      let section = content.querySelector(`.division-header.${divInfo.css}`)?.closest('.division-section');
      if (!section) {
        section = this._createDivisionSection(divInfo, []);
        content.appendChild(section);
      }

      const grid = section.querySelector('.badge-grid');
      if (grid) {
        grid.insertBefore(card, grid.firstChild);
      }

      // Update division header count
      const countEl = section.querySelector('.division-header-count');
      if (countEl) {
        const current = parseInt(countEl.textContent) || 0;
        countEl.textContent = `${current + 1} member${current + 1 !== 1 ? 's' : ''}`;
      }
    } else {
      // Single department view: prepend to flat grid
      let grid = content.querySelector('.badge-grid');
      if (!grid) {
        grid = document.createElement('div');
        grid.className = 'badge-grid';
        content.appendChild(grid);
      }
      grid.insertBefore(card, grid.firstChild);
    }

    // Animate odometer count
    const odo = document.getElementById('payrollOdometer');
    if (odo) {
      const current = parseInt(odo.dataset.value || '0');
      this._animateOdometer(odo, current + 1);
    }

    return card;
  },

  destroy() {
    // Remove content rendered by init — container itself stays
    if (this._container) {
      this._container.innerHTML = '';
    }
    this._container = null;
    this._stats = null;
  },

  // ─── Private helpers ────────────────────────────────────

  _buildOdometerDigits(num) {
    const digits = String(num).split('');
    return digits.map(d =>
      `<span class="odometer-digit"><span class="odometer-digit-inner" style="transform:translateY(-${d * 1.3}em)">` +
      [0,1,2,3,4,5,6,7,8,9].map(n => `<span>${n}</span>`).join('') +
      `</span></span>`
    ).join('');
  },

  _animateOdometer(el, newValue) {
    const newDigits = String(newValue).split('');
    const oldDigits = String(el.dataset.value || '0').split('');
    el.dataset.value = newValue;

    // If digit count changed (e.g. 9→10), rebuild the HTML
    if (newDigits.length !== oldDigits.length) {
      el.innerHTML = this._buildOdometerDigits(0);
      // Force reflow so the initial position renders before we animate
      el.offsetHeight;
    }

    const digitEls = el.querySelectorAll('.odometer-digit-inner');
    newDigits.forEach((d, i) => {
      const offset = i - (newDigits.length - digitEls.length);
      if (offset >= 0 && digitEls[offset]) {
        digitEls[offset].style.transform = `translateY(-${d * 1.3}em)`;
      }
    });
  },

  _updateDeptHeading(dept, stats) {
    const heading = document.getElementById('activeDeptHeading');
    if (!heading) return;
    if (!dept) {
      heading.innerHTML = '';
      heading.style.display = 'none';
    } else {
      const count = stats.byDepartment[dept] || 0;
      heading.innerHTML = `
        <div class="dept-heading-name">${esc(dept)}</div>
        <div class="dept-heading-count">${count} employee${count !== 1 ? 's' : ''}</div>
      `;
      heading.style.display = '';
    }
  },

  _createSkeletonGrid(count) {
    const grid = document.createElement('div');
    grid.className = 'badge-grid';
    for (let i = 0; i < count; i++) {
      const card = document.createElement('div');
      card.className = 'skeleton-card compact';
      card.innerHTML = `
        <div class="skeleton-photo"></div>
        <div class="skeleton-info">
          <div class="skeleton-line skeleton-line-name"></div>
          <div class="skeleton-line skeleton-line-title"></div>
        </div>
      `;
      grid.appendChild(card);
    }
    return grid;
  },

  async _loadBadges(replace) {
    const content = document.getElementById('publicBadgeContent');
    const loadMoreArea = document.getElementById('loadMoreArea');

    if (replace) {
      content.innerHTML = '';
      const skeleton = this._createSkeletonGrid(10);
      skeleton.id = 'skeletonGrid';
      content.appendChild(skeleton);
    }
    loadMoreArea.innerHTML = '';

    let url = `/api/orgchart?page=${window._publicOrgPage}&limit=60`;
    if (window._publicOrgDept) url += `&department=${encodeURIComponent(window._publicOrgDept)}`;

    let data;
    try {
      const resp = await fetch(url);
      data = await resp.json();
    } catch {
      content.innerHTML = '<div class="no-badges-msg">Failed to load badges.</div>';
      return;
    }

    // Remove skeleton
    const skeleton = document.getElementById('skeletonGrid');
    if (skeleton) skeleton.remove();

    if (data.badges.length === 0 && window._publicOrgPage === 1) {
      if (window._publicOrgDept) {
        content.innerHTML = '<div class="no-badges-msg">No employees in this department. Try another filter.</div>';
      } else {
        content.innerHTML = '<div class="no-badges-msg">No employees found. The hiring freeze continues.<br><a href="/" style="color:#5B8DEF;margin-top:8px;display:inline-block;">Be the first employee &rarr;</a></div>';
      }
      return;
    }

    // When showing all departments, group by division
    if (!window._publicOrgDept) {
      const byDivision = {};
      PUBLIC_DIVISIONS.forEach(d => { byDivision[d.theme] = []; });

      data.badges.forEach(badge => {
        const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
        if (!byDivision[divTheme]) byDivision[divTheme] = [];
        byDivision[divTheme].push(badge);
      });

      PUBLIC_DIVISIONS.forEach(div => {
        const badges = byDivision[div.theme];
        if (!badges || badges.length === 0) return;
        const section = this._createDivisionSection(div, badges);
        content.appendChild(section);
      });
    } else {
      // Single department — flat grid
      let grid = content.querySelector('.badge-grid');
      if (!grid || replace) {
        grid = document.createElement('div');
        grid.className = 'badge-grid';
        content.appendChild(grid);
      }
      data.badges.forEach(badge => grid.appendChild(this._createBadgeCard(badge)));
    }

    // Load more button
    if (window._publicOrgPage < data.pages) {
      const btn = document.createElement('button');
      btn.className = 'load-more-btn';
      btn.textContent = 'Load More Employees';
      btn.addEventListener('click', () => {
        window._publicOrgPage++;
        this._loadBadges(false);
      });
      loadMoreArea.appendChild(btn);
    }
  },

  _createDivisionSection(div, badges) {
    const section = document.createElement('div');
    section.className = 'division-section';

    const header = document.createElement('div');
    header.className = `division-header ${div.css}`;
    header.innerHTML = `
      <div class="division-header-name">${esc(div.name)}</div>
      <div class="division-header-count">${badges.length} member${badges.length !== 1 ? 's' : ''}</div>
    `;
    section.appendChild(header);

    const connector = document.createElement('div');
    connector.className = 'division-connector';
    section.appendChild(connector);

    const grid = document.createElement('div');
    grid.className = 'badge-grid';
    badges.forEach(badge => grid.appendChild(this._createBadgeCard(badge)));
    section.appendChild(grid);

    return section;
  },

  _createBadgeCard(badge) {
    const card = document.createElement('div');
    card.className = 'badge-grid-card compact' + (badge.isBandMember ? ' band-member' : '');
    card.setAttribute('data-employee-id', badge.employeeId);
    const initials = (badge.name || '?').charAt(0).toUpperCase();
    card.innerHTML = `
      <div class="badge-grid-photo">
        <img class="badge-grid-avatar" src="/api/badge/${esc(badge.employeeId)}/headshot" alt="${esc(badge.name)}" loading="lazy"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="badge-grid-fallback" style="display:none">${initials}</div>
      </div>
      <div class="badge-grid-info">
        <div class="badge-grid-name">${esc(badge.name)}</div>
        <div class="badge-grid-title">${esc(badge.title)}</div>
      </div>
    `;
    card.addEventListener('click', () => showBadgeDetail(badge.employeeId, badge.name));
    return card;
  },
};
