// ─── Windows 98 Desktop Renderer ──────────────────────────
// Implements the renderer interface: { init, addBadge, destroy }
// Renders employees as a Windows 98 desktop with Explorer windows.

window.Win98Renderer = {
  _container: null,
  _stats: null,
  _cssLink: null,
  _overrideLink: null,
  _badges: {},        // { divTheme: [badge, ...] }
  _activeFolder: null, // currently open division theme
  _folderPage: 1,      // current page in open explorer
  _PAGE_SIZE: 12,      // max icons per explorer page
  _clockInterval: null,

  async init(container, stats) {
    this._container = container;
    this._stats = stats;
    this._badges = {};
    this._divCounts = {};  // { divTheme: count } from stats
    this._activeFolder = null;

    // Load 98.css dynamically
    await this._loadCSS();

    // Compute division counts from stats (no badge fetch needed)
    PUBLIC_DIVISIONS.forEach(d => { this._badges[d.theme] = []; this._divCounts[d.theme] = 0; });
    if (stats.byDepartment) {
      Object.entries(stats.byDepartment).forEach(([dept, count]) => {
        const divTheme = getDivisionForDept(dept, BAND_DEPTS.has(dept));
        this._divCounts[divTheme] = (this._divCounts[divTheme] || 0) + count;
      });
    }

    // Update shared stats
    window._tickerTotalHires = stats.visible || 0;
    if (stats.byDepartment) {
      window._tickerStats = Object.assign({}, stats.byDepartment);
    }
    initDonut(stats);

    // Render desktop
    this._renderDesktop();
  },

  addBadge(badge) {
    const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
    if (!this._badges[divTheme]) this._badges[divTheme] = [];

    // Dedup
    if (this._badges[divTheme].some(b => b.employeeId === badge.employeeId)) return null;
    this._badges[divTheme].push(badge);
    this._divCounts[divTheme] = (this._divCounts[divTheme] || 0) + 1;

    // If we have the download dialog container, show the animation
    const desktop = this._container.querySelector('.win98-desktop');
    if (!desktop) return null;

    // Create "Downloading" dialog
    const dialog = this._createDownloadDialog(badge);
    desktop.appendChild(dialog);

    // After 3s, remove dialog and add file to active folder (or desktop)
    return new Promise((resolve) => {
      const bar = dialog.querySelector('.win98-progress-fill');
      // RAF ensures browser paints width:0% first, then transitions to 100% over 3s
      if (bar) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = '100%'; }));

      setTimeout(() => {
        // Change dialog text to "Complete!"
        const statusEl = dialog.querySelector('.win98-dl-status');
        if (statusEl) statusEl.textContent = 'Installation Complete!';

        setTimeout(() => {
          dialog.remove();

          // If Explorer is open for this division, refresh to page 1 to show new badge
          if (this._activeFolder === divTheme) {
            const div = PUBLIC_DIVISIONS.find(d => d.theme === divTheme);
            if (div) {
              this._openFolder(div, 1);
              const icon = this._container.querySelector(`[data-employee-id="${badge.employeeId}"]`);
              resolve(icon);
              return;
            }
          }

          // Update desktop icon count — or create icon if division was empty
          const iconEl = desktop.querySelector(`[data-div-theme="${divTheme}"] .win98-icon-label`);
          if (iconEl) {
            const div = PUBLIC_DIVISIONS.find(d => d.theme === divTheme);
            if (div) {
              iconEl.textContent = `${div.name} (${this._divCounts[divTheme] || 0})`;
            }
          } else {
            // First badge in this division — create desktop icon dynamically
            const div = PUBLIC_DIVISIONS.find(d => d.theme === divTheme);
            if (div) {
              const iconArea = desktop.querySelector('.win98-icons');
              const recycleIcon = iconArea?.querySelector('[data-div-theme]:last-of-type')?.nextElementSibling
                || iconArea?.lastElementChild;
              const newIcon = this._createDesktopIcon(
                '📁', `${div.name} (1)`, () => this._openFolder(div),
                div.theme
              );
              // Insert before Recycle Bin
              if (recycleIcon && iconArea) {
                iconArea.insertBefore(newIcon, recycleIcon);
              } else if (iconArea) {
                iconArea.appendChild(newIcon);
              }
            }
          }

          resolve(null);
        }, 800);
      }, 3000);
    });
  },

  destroy() {
    // Remove 98.css
    if (this._cssLink) { this._cssLink.remove(); this._cssLink = null; }
    if (this._overrideLink) { this._overrideLink.remove(); this._overrideLink = null; }
    if (this._clockInterval) { clearInterval(this._clockInterval); this._clockInterval = null; }
    if (this._container) { this._container.innerHTML = ''; }
    this._container = null;
    this._stats = null;
    this._badges = {};
    this._activeFolder = null;
  },

  // ─── Private helpers ────────────────────────────────────

  _loadCSS() {
    return new Promise((resolve) => {
      // 98.css
      this._cssLink = document.createElement('link');
      this._cssLink.rel = 'stylesheet';
      this._cssLink.href = '/lib/98.css';
      this._cssLink.onload = resolve;
      this._cssLink.onerror = resolve; // don't block on failure
      document.head.appendChild(this._cssLink);

      // Override CSS
      this._overrideLink = document.createElement('link');
      this._overrideLink.rel = 'stylesheet';
      this._overrideLink.href = '/css/win98-overrides.css';
      document.head.appendChild(this._overrideLink);
    });
  },

  _renderDesktop() {
    const container = this._container;
    container.innerHTML = '';

    const desktop = document.createElement('div');
    desktop.className = 'win98-desktop';

    // Desktop icons
    const iconArea = document.createElement('div');
    iconArea.className = 'win98-icons';

    // My Computer
    iconArea.appendChild(this._createDesktopIcon(
      '💻', 'My Computer', () => this._openBandWindow()
    ));

    // Division folders — hide empty divisions
    PUBLIC_DIVISIONS.forEach(div => {
      const count = this._divCounts[div.theme] || 0;
      if (count === 0) return; // skip empty divisions
      iconArea.appendChild(this._createDesktopIcon(
        '📁', `${div.name} (${count})`, () => this._openFolder(div),
        div.theme
      ));
    });

    // Recycle Bin
    iconArea.appendChild(this._createDesktopIcon(
      '🗑️', 'Fired Employees (Empty)', () => {
        this._showErrorDialog('Recycle Bin is empty.', 'No one has been fired... yet.');
      }
    ));

    desktop.appendChild(iconArea);

    // Taskbar
    const taskbar = this._createTaskbar();
    desktop.appendChild(taskbar);

    container.appendChild(desktop);
  },

  _createDesktopIcon(emoji, label, onClick, divTheme) {
    const icon = document.createElement('div');
    icon.className = 'win98-icon';
    if (divTheme) icon.setAttribute('data-div-theme', divTheme);
    icon.innerHTML = `
      <div class="win98-icon-img">${emoji}</div>
      <div class="win98-icon-label">${esc(label)}</div>
    `;
    icon.addEventListener('dblclick', onClick);
    icon.addEventListener('click', onClick); // single click on touch
    return icon;
  },

  _createTaskbar() {
    const taskbar = document.createElement('div');
    taskbar.className = 'win98-taskbar';

    const startBtn = document.createElement('button');
    startBtn.className = 'win98-start-btn';
    startBtn.innerHTML = '🎸 Start';
    startBtn.addEventListener('click', () => {
      this._showStartMenu(startBtn);
    });

    const clock = document.createElement('div');
    clock.className = 'win98-clock';
    this._updateClock(clock);
    this._clockInterval = setInterval(() => this._updateClock(clock), 60000);

    taskbar.appendChild(startBtn);
    taskbar.appendChild(clock);

    return taskbar;
  },

  _updateClock(clockEl) {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  _showStartMenu(startBtn) {
    // Remove existing
    const existing = this._container.querySelector('.win98-start-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.className = 'win98-start-menu window';

    const items = [
      { label: '📁 All Employees', action: () => this._openFolder(PUBLIC_DIVISIONS[0]) },
      ...PUBLIC_DIVISIONS.map(div => ({
        label: `📂 ${div.name}`,
        action: () => this._openFolder(div),
      })),
      { label: '─────────────', action: null },
      { label: '💻 Band Lineup', action: () => this._openBandWindow() },
      { label: '🗑️ Recycle Bin', action: () => this._showErrorDialog('Recycle Bin is empty.', 'No terminations today.') },
    ];

    const list = document.createElement('div');
    list.className = 'win98-start-list';
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = item.action ? 'win98-start-item' : 'win98-start-separator';
      row.textContent = item.label;
      if (item.action) row.addEventListener('click', () => { menu.remove(); item.action(); });
      list.appendChild(row);
    });

    menu.appendChild(list);
    this._container.querySelector('.win98-desktop').appendChild(menu);

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function handler(e) {
        if (!menu.contains(e.target) && e.target !== startBtn) {
          menu.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 50);
  },

  async _openFolder(div, page) {
    this._activeFolder = div.theme;
    this._folderPage = page || 1;

    // Remove existing explorer
    const existing = this._container.querySelector('.win98-window');
    if (existing) existing.remove();

    // Fetch this division's badges from server, paginated
    const divName = PUBLIC_DIVISIONS.find(d => d.theme === div.theme)?.name || div.name;
    let pageBadges = [];
    let totalCount = this._divCounts[div.theme] || 0;
    let totalPages = 1;

    try {
      const resp = await fetch(`/api/orgchart?division=${encodeURIComponent(divName)}&page=${this._folderPage}&limit=${this._PAGE_SIZE}`);
      const data = await resp.json();
      pageBadges = data.badges || [];
      totalCount = data.total;
      totalPages = data.pages;
    } catch {
      // Fall back to any cached badges
      const cached = this._badges[div.theme] || [];
      totalPages = Math.max(1, Math.ceil(cached.length / this._PAGE_SIZE));
      const start = (this._folderPage - 1) * this._PAGE_SIZE;
      pageBadges = cached.slice(start, start + this._PAGE_SIZE);
    }

    if (this._folderPage > totalPages) this._folderPage = totalPages;

    const win = document.createElement('div');
    win.className = 'win98-window window';

    const pageInfo = totalPages > 1 ? ` — Page ${this._folderPage} of ${totalPages}` : '';
    win.innerHTML = `
      <div class="title-bar">
        <div class="title-bar-text">📁 ${esc(div.name)} — ${totalCount} employees</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize"></button>
          <button aria-label="Maximize"></button>
          <button aria-label="Close"></button>
        </div>
      </div>
      <div class="window-body">
        <div class="win98-explorer-toolbar">
          <span class="win98-explorer-path">C:\\HELPDESK\\${div.name.replace(/ /g, '_')}\\</span>
          <span class="win98-explorer-count">${totalCount} object(s)${pageInfo}</span>
        </div>
        <div class="win98-file-grid"></div>
        ${totalPages > 1 ? '<div class="win98-explorer-pager"></div>' : ''}
      </div>
    `;

    // Close button
    win.querySelector('[aria-label="Close"]').addEventListener('click', () => {
      win.remove();
      this._activeFolder = null;
    });

    // Populate files for current page
    const grid = win.querySelector('.win98-file-grid');
    pageBadges.forEach(badge => {
      grid.appendChild(this._createFileIcon(badge));
    });

    if (totalCount === 0) {
      grid.innerHTML = '<div class="win98-empty-folder">This folder is empty.</div>';
    }

    // Pagination buttons
    const pager = win.querySelector('.win98-explorer-pager');
    if (pager && totalPages > 1) {
      if (this._folderPage > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.textContent = '< Prev';
        prevBtn.style.cssText = 'font-size:11px;cursor:pointer;margin-right:8px;';
        prevBtn.addEventListener('click', () => this._openFolder(div, this._folderPage - 1));
        pager.appendChild(prevBtn);
      }
      const pageLabel = document.createElement('span');
      pageLabel.textContent = `Page ${this._folderPage} of ${totalPages}`;
      pageLabel.style.cssText = 'font-size:11px;color:#333;';
      pager.appendChild(pageLabel);
      if (this._folderPage < totalPages) {
        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Next >';
        nextBtn.style.cssText = 'font-size:11px;cursor:pointer;margin-left:8px;';
        nextBtn.addEventListener('click', () => this._openFolder(div, this._folderPage + 1));
        pager.appendChild(nextBtn);
      }
    }

    this._container.querySelector('.win98-desktop').appendChild(win);
  },

  _openBandWindow() {
    const bandMembers = this._badges['_exec'] || [];
    const fakeDiv = { name: 'BAND LINEUP — My Computer', theme: '_exec' };
    this._openFolder(fakeDiv);
  },

  _createFileIcon(badge) {
    const icon = document.createElement('div');
    icon.className = 'win98-file-icon';
    icon.setAttribute('data-employee-id', badge.employeeId);
    icon.innerHTML = `
      <div class="win98-file-thumb">
        <img src="/api/badge/${esc(badge.employeeId)}/thumb" alt="${esc(badge.name)}" loading="lazy" onerror="this.parentElement.textContent='👤'">
      </div>
      <div class="win98-file-name">${esc(badge.name)}</div>
      <div class="win98-file-title">${esc(badge.title)}</div>
    `;
    icon.addEventListener('click', () => showBadgeDetail(badge.employeeId, badge.name));
    return icon;
  },

  _createDownloadDialog(badge) {
    const dialog = document.createElement('div');
    dialog.className = 'win98-download-dialog window';
    dialog.innerHTML = `
      <div class="title-bar">
        <div class="title-bar-text">Downloading Employee...</div>
      </div>
      <div class="window-body">
        <div class="win98-dl-info">
          <span>📥</span>
          <div>
            <div class="win98-dl-name">${esc(badge.name)}</div>
            <div class="win98-dl-status">Downloading from HR servers...</div>
          </div>
        </div>
        <div class="win98-progress-bar">
          <div class="win98-progress-fill"></div>
        </div>
      </div>
    `;
    return dialog;
  },

  _showErrorDialog(title, message) {
    const existing = this._container.querySelector('.win98-error-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.className = 'win98-error-dialog window';
    dialog.innerHTML = `
      <div class="title-bar">
        <div class="title-bar-text">⚠️ ${esc(title)}</div>
        <div class="title-bar-controls">
          <button aria-label="Close"></button>
        </div>
      </div>
      <div class="window-body">
        <p>${esc(message)}</p>
        <div style="text-align: center; margin-top: 8px;">
          <button class="win98-ok-btn">OK</button>
        </div>
      </div>
    `;

    dialog.querySelector('[aria-label="Close"]').addEventListener('click', () => dialog.remove());
    dialog.querySelector('.win98-ok-btn').addEventListener('click', () => dialog.remove());

    this._container.querySelector('.win98-desktop').appendChild(dialog);
  },
};
