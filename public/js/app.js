// Help Desk Badge Generator — Canva-Style Click-to-Edit

// Unregister any leftover service worker + purge its caches. The badge app
// briefly shipped a PWA shell; returning visitors may still have it running.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
}
if ('caches' in window) {
  caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
}

// ─── Visual Viewport Keyboard Sync ────────────────────────
// iOS Safari doesn't reflow fixed elements when the software keyboard opens,
// so bottom-sheet popovers get covered by the keyboard. Track the keyboard
// height via visualViewport and expose it as a CSS custom property --kb,
// which the mobile popover rule consumes via bottom: var(--kb, 0).
// Chrome Android respects `interactive-widget: resizes-content` (set in the
// viewport meta) and this is harmless there.
(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const sync = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--kb', `${kb}px`);
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  // iOS 26 quirk: offsetTop sometimes doesn't reset to 0 on keyboard dismiss.
  // Force a resync shortly after focusout as a belt-and-suspenders reset.
  document.addEventListener('focusout', () => setTimeout(sync, 120));
  sync();
})();

// ─── Haptic Feedback ──────────────────────────────────────
// Cross-platform tactile feedback. iOS Safari ignores navigator.vibrate() —
// the workaround is a hidden <input type="checkbox" switch>; toggling it
// triggers the Taptic Engine on iOS 17.4+. Android uses Vibration API directly.
// Respects prefers-reduced-motion.
const haptic = (() => {
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
  let labelEl = null;
  function ensureSwitchEl() {
    if (labelEl || !isIOS || !document.body) return;
    const switchEl = document.createElement('input');
    switchEl.type = 'checkbox';
    switchEl.setAttribute('switch', '');
    switchEl.setAttribute('aria-hidden', 'true');
    switchEl.tabIndex = -1;
    labelEl = document.createElement('label');
    labelEl.setAttribute('aria-hidden', 'true');
    labelEl.style.cssText = 'position:absolute;left:-9999px;width:0;height:0;overflow:hidden;pointer-events:none;';
    labelEl.appendChild(switchEl);
    document.body.appendChild(labelEl);
  }
  return (duration = 10) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
      ensureSwitchEl();
      if (isIOS && labelEl) labelEl.click();
      else if (navigator.vibrate) navigator.vibrate(duration);
    } catch { /* silent — haptic failure never blocks UX */ }
  };
})();

// ─── Focus Trap Utility ──────────────────────────────────
// Traps Tab focus within a container and closes on Escape.
// Returns a cleanup function to remove the trap.
function trapFocus(container, onClose) {
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function handler(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (onClose) onClose();
      return;
    }
    if (e.key !== 'Tab') return;

    const focusable = [...container.querySelectorAll(FOCUSABLE)];
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener('keydown', handler);
  // Focus first focusable element
  requestAnimationFrame(() => {
    const first = container.querySelector(FOCUSABLE);
    if (first) first.focus();
  });

  return () => document.removeEventListener('keydown', handler);
}

let _activeFocusTrap = null;

let state = {
  name: 'YOUR NAME',
  photoUrl: null,
  department: DEPARTMENTS[0].name,
  title: TITLES[0],
  accessLevel: DEPT_ACCESS[DEPARTMENTS[0].name]?.access || 'PENDING REVIEW',
  song: SONG_LIST[0],
  waveStyle: 'barcode',
  caption: WAVEFORM_CAPTIONS[Math.floor(Math.random() * WAVEFORM_CAPTIONS.length)],
};
let accessManuallySet = false;
let cropper = null;
let activeField = null;

// ─── Live Preview ─────────────────────────────────────────

function refreshPreview() {
  const previewArea = document.getElementById('badgePreviewArea');
  previewArea.innerHTML = '';

  updateBadge(state);

  const badge = document.getElementById('badge');
  const clone = badge.cloneNode(true);
  clone.id = 'badgePreviewClone';
  previewArea.appendChild(clone);

  attachBadgeClickHandlers();
  // Only reanchor if no popover is actively open (prevents sliding while typing)
  if (!activeField) reanchorPopover();
}

// ─── Badge Click Handlers ─────────────────────────────────

const CLICK_MAP = [
  { selector: '.photo-frame',      field: 'photo' },
  { selector: '.access-badge',     field: 'access' },
  { selector: '.name',             field: 'name' },
  { selector: '.department',       field: 'department' },
  { selector: '.title',            field: 'title' },
  { selector: '.badge-caption', field: 'caption' },
  { selector: '.waveform-sticker', field: 'song' },
];

// Natural editing order for chained Prev/Next navigation across popovers.
// Name first (primary identity), photo second, then categorical fields, then
// the expressive ones. Lets users flow through all 7 fields in one gesture
// continuous session instead of dismissing + re-finding the next badge region.
const POPOVER_ORDER = ['name', 'photo', 'department', 'title', 'access', 'song', 'caption'];

let _discoveryDone = false;
let _suppressAutoDiscover = false; // page-load handler manages discover-pulse for new users
let _firstLoadDemoTimers = [];

/**
 * First-load tutorial: cycle each editable field through 3 random values
 * during its discovery pulse window (3.6s per field, value flips at start,
 * middle, end). The user sees the highlight AND multiple values flash by,
 * teaching "this is editable" + "there are LOTS of options" in one motion.
 * Skips name and photo — those stay empty as CTAs. Cancels on first user click.
 */
function _scheduleFirstLoadDemo() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  // Pick N distinct items from an array (avoids back-to-back duplicates)
  const pickN = (arr, n) => {
    if (arr.length <= n) return arr.slice().sort(() => Math.random() - 0.5);
    const out = [];
    const used = new Set();
    while (out.length < n) {
      const idx = Math.floor(Math.random() * arr.length);
      if (!used.has(idx)) { used.add(idx); out.push(arr[idx]); }
    }
    return out;
  };

  // Slot-machine feel: 3 quick value flips clustered at the START of each
  // field's pulse (within ~400ms), then the field locks in for the remaining
  // ~3.2s of its highlight. Spin → land → admire.
  // Pulse offsets match app.css:230-236 .discover-pulse keyframes (3.6s each).
  const CYCLE_OFFSETS = [0, 180, 360];

  // Pre-generate 3 distinct values per field so each cycle looks different
  const deptCycle = pickN(DEPARTMENTS, 3);
  const titleCycle = pickN(TITLES, 3);
  const accessCycle = pickN(FAN_ACCESS_LEVELS, 3);
  const songCycle = pickN(SONG_LIST, 3);
  const captionCycle = pickN(WAVEFORM_CAPTIONS, 3);

  // Top-down badge order: access → dept → title → song → caption.
  // startMs is relative to when this function is called (page-load handler
  // calls it after the 1.4s hint intro). Values match CSS pulse delays
  // in app.css for the matching .discover-pulse selectors.
  const fields = [
    { startMs: 0, cycle: accessCycle, apply: (v) => {
        state.accessLevel = (v && v.label) || v;
      }
    },
    { startMs: 800, cycle: deptCycle, apply: (v) => {
        state.department = v.name;
      }
    },
    { startMs: 1600, cycle: titleCycle, apply: (v) => { state.title = v; } },
    { startMs: 2400, cycle: songCycle, apply: (v) => {
        state.song = v;
        state.waveStyle = state.waveStyle === 'barcode' ? 'sticker' : 'barcode';
      }
    },
    { startMs: 3200, cycle: captionCycle, apply: (v) => { state.caption = v; } },
  ];

  for (const field of fields) {
    field.cycle.forEach((value, i) => {
      const t = setTimeout(() => {
        field.apply(value);
        refreshPreview();
      }, field.startMs + CYCLE_OFFSETS[i]);
      _firstLoadDemoTimers.push(t);
    });
  }
}

function _cancelFirstLoadDemo() {
  for (const t of _firstLoadDemoTimers) clearTimeout(t);
  _firstLoadDemoTimers = [];
  // Also drop the intro class so the hint snaps to its normal state immediately
  const hint = document.getElementById('editHint');
  if (hint) hint.classList.remove('intro');
}

function attachBadgeClickHandlers() {
  const previewArea = document.getElementById('badgePreviewArea');
  if (!previewArea) return;

  // One-time discovery pulse — staggered outline flash across all editable elements.
  // For new users (no existing badge), the page-load handler drives this manually
  // so it can be sequenced with the hint intro animation. Returning users still
  // get the auto-fire path here.
  if (!_discoveryDone && !_suppressAutoDiscover) {
    _discoveryDone = true;
    previewArea.classList.add('discover-pulse');
    // Remove after last pulse ends: 4.8s delay + 0.7s duration = 5.5s, plus buffer
    setTimeout(() => previewArea.classList.remove('discover-pulse'), 6000);
  }

  CLICK_MAP.forEach(({ selector, field }) => {
    const el = previewArea.querySelector(selector);
    if (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        // Hide hint and stop pulse on first interaction
        const hint = document.getElementById('editHint');
        if (hint) hint.classList.add('hidden');
        previewArea.classList.remove('discover-pulse');
        // Stop any pending first-load demo randomizations so the user
        // doesn't see the field they just clicked change under them
        _cancelFirstLoadDemo();
        showPopover(el, field);
      });
    }
  });
}

// ─── Popover System ───────────────────────────────────────

function showPopover(targetEl, fieldName) {
  // Toggle if same field
  if (activeField === fieldName) {
    hidePopover();
    return;
  }

  // Close any existing popover instantly (no animation for switching)
  const container = document.getElementById('popoverContainer');
  container.innerHTML = '';

  activeField = fieldName;

  const popover = document.createElement('div');
  popover.className = 'popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'true');
  popover.innerHTML = buildPopoverContent(fieldName);
  container.appendChild(popover);

  // Dialog gets an accessible name from its title (WAI-ARIA dialog pattern).
  const titleEl = popover.querySelector('.popover-title');
  if (titleEl) {
    titleEl.id = 'popoverTitle';
    popover.setAttribute('aria-labelledby', 'popoverTitle');
  }
  // Live-announce character-counter updates so SR users hear usage as they type.
  popover.querySelectorAll('.char-count').forEach(span => {
    span.setAttribute('aria-live', 'polite');
    span.setAttribute('aria-atomic', 'true');
    const match = span.textContent.match(/^(\d+)\/(\d+)$/);
    if (match) span.setAttribute('aria-label', `${match[1]} of ${match[2]} characters used`);
  });

  // Prevent clicks inside popover from bubbling to document
  popover.addEventListener('click', (e) => e.stopPropagation());

  positionPopover(popover, targetEl);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      popover.classList.add('visible');
      // On mobile, the bottom sheet may cover the field the user is editing.
      // Scroll the page so the clicked badge element sits comfortably above
      // the sheet — user sees their edits reflected live without dismissing.
      if (window.innerWidth <= 640) {
        const sheetHeight = popover.offsetHeight;
        const sheetTop = window.innerHeight - sheetHeight;
        const targetBottom = targetEl.getBoundingClientRect().bottom;
        const desiredBottom = sheetTop - 20;
        if (targetBottom > desiredBottom) {
          window.scrollBy({ top: targetBottom - desiredBottom, behavior: 'smooth' });
        }
      }
    });
  });

  attachPopoverEvents(fieldName, popover);

  // Focus trap for popover (Escape closes, Tab cycles within)
  if (_activeFocusTrap) _activeFocusTrap();
  _activeFocusTrap = trapFocus(popover, hidePopover);

  // Close button
  const closeBtn = popover.querySelector('.popover-close');
  if (closeBtn) closeBtn.addEventListener('click', hidePopover);

  // Done button (same behavior as close — changes auto-save)
  const doneBtn = popover.querySelector('.popover-done');
  if (doneBtn) doneBtn.addEventListener('click', hidePopover);

  // Enter key on any popover input commits (feels like the iOS "Done" key,
  // which the enterkeyhint="done" attribute surfaces on mobile).
  popover.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input.popover-input')) {
      e.preventDefault();
      hidePopover();
    }
  });

  // Fire a short haptic on any tap inside the popover — card selection,
  // wave-toggle, Done, close, photo-control buttons. Captures at bubble phase
  // so stopPropagation inside handlers doesn't block it.
  popover.addEventListener('click', (e) => {
    if (e.target.closest('.card, .wave-btn, .popover-done, .popover-close, .btn-sm, .popover-disclosure-summary')) {
      haptic(8);
    }
  });

  // Swipe-down-to-dismiss — iOS/Android bottom-sheet convention. Only drag
  // gestures starting from the top 60px of the sheet (grab handle + header)
  // count; gestures inside the scroll region remain plain scroll.
  if (window.innerWidth <= 640) attachSwipeDismiss(popover);

  // Chained Prev/Next nav — Linear/Shortcuts pattern. User can flow through
  // all 7 fields without dismissing the sheet. Disabled at boundaries.
  attachPopoverNav(popover, fieldName);

  // Auto-focus text input
  const input = popover.querySelector('.popover-input');
  if (input) setTimeout(() => input.focus(), 80);
}

function attachPopoverNav(popover, fieldName) {
  const doneBtn = popover.querySelector('.popover-done');
  if (!doneBtn) return;
  const idx = POPOVER_ORDER.indexOf(fieldName);
  if (idx < 0) return;

  const navRow = document.createElement('div');
  navRow.className = 'popover-nav-row';
  const total = POPOVER_ORDER.length;
  navRow.innerHTML = `
    <button class="popover-nav-arrow popover-nav-prev" aria-label="Previous field" type="button">&larr; Back</button>
    <span class="popover-nav-position" aria-hidden="true">${idx + 1} of ${total}</span>
    <button class="popover-nav-arrow popover-nav-next" aria-label="Next field" type="button">Next &rarr;</button>
  `;
  doneBtn.parentNode.insertBefore(navRow, doneBtn);

  const prev = navRow.querySelector('.popover-nav-prev');
  const next = navRow.querySelector('.popover-nav-next');
  if (idx === 0) prev.disabled = true;
  if (idx === total - 1) next.disabled = true;

  prev.addEventListener('click', () => _navigatePopover(-1));
  next.addEventListener('click', () => _navigatePopover(+1));
}

function _navigatePopover(direction) {
  if (!activeField) return;
  const idx = POPOVER_ORDER.indexOf(activeField);
  const nextField = POPOVER_ORDER[idx + direction];
  if (!nextField) return;
  const selectorMap = {};
  CLICK_MAP.forEach(({ selector, field }) => { selectorMap[field] = selector; });
  const target = document.getElementById('badgePreviewArea').querySelector(selectorMap[nextField]);
  if (target) {
    haptic(6);
    showPopover(target, nextField);
  }
}

function attachSwipeDismiss(popover) {
  let startY = 0, currentY = 0, dragging = false;
  const onStart = (e) => {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = popover.getBoundingClientRect();
    if (y - rect.top > 60) return; // only from top 60px — grab handle + header
    startY = y;
    currentY = y;
    dragging = true;
    popover.style.transition = 'none';
  };
  const onMove = (e) => {
    if (!dragging) return;
    currentY = e.touches ? e.touches[0].clientY : e.clientY;
    const delta = Math.max(0, currentY - startY);
    popover.style.transform = `translateY(${delta}px)`;
    popover.style.opacity = Math.max(0.4, 1 - (delta / popover.offsetHeight)).toString();
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    popover.style.transition = '';
    const delta = currentY - startY;
    const threshold = popover.offsetHeight * 0.25;
    if (delta > threshold) {
      haptic(12);
      hidePopover();
    } else {
      popover.style.transform = '';
      popover.style.opacity = '';
    }
  };
  popover.addEventListener('touchstart', onStart, { passive: true });
  popover.addEventListener('touchmove', onMove, { passive: true });
  popover.addEventListener('touchend', onEnd);
  popover.addEventListener('touchcancel', onEnd);
}

function hidePopover() {
  if (_activeFocusTrap) { _activeFocusTrap(); _activeFocusTrap = null; }
  const container = document.getElementById('popoverContainer');
  const popover = container.querySelector('.popover');
  if (popover) {
    popover.classList.remove('visible');
    setTimeout(() => { container.innerHTML = ''; }, 150);
  }
  activeField = null;
}

function positionPopover(popover, targetEl) {
  const isMobile = window.innerWidth <= 640;
  if (isMobile) {
    popover.style.left = '';
    popover.style.top = '';
    popover.dataset.arrow = 'none';
    return;
  }

  const fieldRect = targetEl.getBoundingClientRect();
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  const gap = 16;

  // Allow popover to shrink on tighter screens
  const maxPopWidth = Math.min(380, viewW - 40);
  popover.style.width = maxPopWidth + 'px';

  const popHeight = popover.offsetHeight || 450;

  // Use the scaled preview container bounds (getBoundingClientRect accounts for CSS transforms)
  const previewArea = document.getElementById('badgePreviewArea');
  const badgeRect = previewArea.getBoundingClientRect();
  const badgeLeft = badgeRect.left;
  const badgeRight = badgeRect.right;

  // Use the preview wrapper for vertical fallback (clipped visible area)
  const wrapper = document.querySelector('.preview-wrapper');
  const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : badgeRect;

  let left, top, arrowSide;

  const rightSpace = viewW - badgeRight - gap;
  const leftSpace = badgeLeft - gap;

  if (rightSpace >= maxPopWidth + 10) {
    // Right of badge — preferred
    left = badgeRight + gap;
    arrowSide = 'left';
    const targetCenter = fieldRect.top + fieldRect.height / 2;
    top = Math.max(10, Math.min(targetCenter - 40, viewH - popHeight - 10));
  } else if (leftSpace >= maxPopWidth + 10) {
    // Left of badge
    left = badgeLeft - maxPopWidth - gap;
    arrowSide = 'right';
    const targetCenter = fieldRect.top + fieldRect.height / 2;
    top = Math.max(10, Math.min(targetCenter - 40, viewH - popHeight - 10));
  } else {
    // Tight screen — position below the badge preview, not over it
    left = Math.max(10, (viewW - maxPopWidth) / 2);
    arrowSide = 'none';
    // Scroll the popover into view below the visible badge area
    top = Math.max(10, wrapperRect.bottom + gap);
  }

  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
  popover.dataset.arrow = arrowSide;

  // If popover is below the fold, scroll it into view
  if (arrowSide === 'none') {
    requestAnimationFrame(() => popover.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
}

function reanchorPopover() {
  if (!activeField) return;
  const popover = document.querySelector('.popover');
  if (!popover) return;

  const selectorMap = {};
  CLICK_MAP.forEach(({ selector, field }) => { selectorMap[field] = selector; });

  const selector = selectorMap[activeField];
  if (!selector) return;

  const previewArea = document.getElementById('badgePreviewArea');
  const targetEl = previewArea.querySelector(selector);
  if (targetEl) positionPopover(popover, targetEl);
}

// ─── Popover Content Builders ─────────────────────────────

function buildPopoverContent(fieldName) {
  const builders = {
    name: buildNamePopover,
    photo: buildPhotoPopover,
    department: buildDeptPopover,
    title: buildTitlePopover,
    access: buildAccessPopover,
    song: buildSongPopover,
    caption: buildCaptionPopover,
  };
  return (builders[fieldName] || (() => ''))();
}

// esc() — defined in shared.js

function buildNamePopover() {
  const val = state.name === 'YOUR NAME' ? '' : state.name;
  return `
    <div class="popover-header">
      <span class="popover-title">Name</span>
      <button class="popover-close">&times;</button>
    </div>
    <div class="popover-body">
      <div class="popover-input-row">
        <input type="text" class="popover-input" id="popName"
          placeholder="First name" maxlength="18"
          autocomplete="given-name" autocapitalize="words" enterkeyhint="done"
          value="${esc(val)}">
        <span class="char-count" id="popNameCount">${val.length}/18</span>
      </div>
      <button class="popover-done">Done</button>
    </div>`;
}

function buildPhotoPopover() {
  const status = state.photoUrl ? 'Photo set' : 'No photo';
  return `
    <div class="popover-header">
      <span class="popover-title">Photo</span>
      <button class="popover-close">&times;</button>
    </div>
    <div class="popover-body">
      <div class="popover-photo-controls">
        <button class="btn-sm" id="popUpload">Upload</button>
        <button class="btn-sm" id="popCamera">Selfie</button>
      </div>
      <span class="photo-status">${status}</span>
      <button class="popover-done">Done</button>
    </div>`;
}

function buildDeptPopover() {
  const cards = DEPARTMENTS.map(d => {
    const sel = state.department === d.name ? ' selected' : '';
    return `<button class="card${sel}" data-value="${esc(d.name)}">${esc(d.name)}</button>`;
  }).join('');

  const isPreset = DEPARTMENTS.some(d => d.name === state.department);
  const customVal = isPreset ? '' : state.department;

  return `
    <div class="popover-header">
      <span class="popover-title">Department</span>
      <button class="popover-close">&times;</button>
    </div>
    <div class="popover-body">
      <div class="popover-scroll">
        <div class="card-grid">${cards}</div>
      </div>
      <div class="popover-input-row">
        <input type="text" class="popover-input popover-input-sm" id="popDeptCustom"
          placeholder="or type your own" maxlength="31" autocomplete="off"
          autocapitalize="characters" inputmode="text" enterkeyhint="done"
          value="${esc(customVal)}">
        <span class="char-count" id="popDeptCount">${customVal.length}/31</span>
      </div>
      <button class="popover-done">Done</button>
    </div>`;
}

function buildTitlePopover() {
  const cards = TITLES.map(t => {
    const sel = state.title === t ? ' selected' : '';
    return `<button class="card${sel}" data-value="${esc(t)}">${esc(t)}</button>`;
  }).join('');

  const isPreset = TITLES.includes(state.title);
  const customVal = isPreset ? '' : state.title;

  return `
    <div class="popover-header">
      <span class="popover-title">Title</span>
      <button class="popover-close">&times;</button>
    </div>
    <div class="popover-body">
      <div class="popover-scroll">
        <div class="card-grid">${cards}</div>
      </div>
      <div class="popover-input-row">
        <input type="text" class="popover-input popover-input-sm" id="popTitleCustom"
          placeholder="or type your own" maxlength="30" autocomplete="off"
          autocapitalize="words" inputmode="text" enterkeyhint="done"
          value="${esc(customVal)}">
        <span class="char-count" id="popTitleCount">${customVal.length}/30</span>
      </div>
      <button class="popover-done">Done</button>
    </div>`;
}

function buildAccessPopover() {
  // Fans never see ALL ACCESS — band-only, server-enforced
  const cards = FAN_ACCESS_LEVELS.map(a => {
    const sel = state.accessLevel === a.label ? ' selected' : '';
    const colorClass = a.css ? ` card-access-${a.css}` : '';
    return `<button class="card${sel}${colorClass}" data-value="${esc(a.label)}">${esc(a.label)}</button>`;
  }).join('');

  const isPreset = FAN_ACCESS_LEVELS.some(a => a.label === state.accessLevel);
  const customVal = isPreset ? '' : state.accessLevel;

  // Open the disclosure by default if the user has a custom (non-preset) value,
  // so they can see and edit it immediately. Otherwise it stays collapsed to
  // keep the preset grid as the primary decision surface.
  const disclosureOpen = customVal ? ' open' : '';

  return `
    <div class="popover-header">
      <span class="popover-title">Access Level</span>
      <button class="popover-close">&times;</button>
    </div>
    <div class="popover-body">
      <div class="popover-scroll">
        <div class="card-grid">${cards}</div>
      </div>
      <details class="popover-disclosure"${disclosureOpen}>
        <summary class="popover-disclosure-summary">Make your own &rarr;</summary>
        <div class="popover-input-row">
          <input type="text" class="popover-input popover-input-sm" id="popAccessCustom"
            placeholder="or type your own" maxlength="28" autocomplete="off"
            autocapitalize="characters" inputmode="text" enterkeyhint="done"
            value="${esc(customVal)}">
          <span class="char-count" id="popAccessCount">${customVal.length}/28</span>
        </div>
      </details>
      <button class="popover-done">Done</button>
    </div>`;
}

function buildSongPopover() {
  const songCards = SONG_LIST.map(s => {
    const wf = WAVEFORMS[s];
    const sel = state.song === s ? ' selected' : '';
    return `<button class="card card-song${sel}" data-value="${esc(s)}">${esc(s)}<span class="card-meta">${wf.duration}</span></button>`;
  }).join('');

  return `
    <div class="popover-header">
      <span class="popover-title">Song & Waveform</span>
      <button class="popover-close">&times;</button>
    </div>
    <div class="popover-body">
      <div class="popover-scroll">
        <div class="popover-label">Waveform Style</div>
        <div class="wave-toggle">
          <button class="wave-btn${state.waveStyle === 'barcode' ? ' active' : ''}" data-style="barcode">Barcode</button>
          <button class="wave-btn${state.waveStyle === 'sticker' ? ' active' : ''}" data-style="sticker">Sticker</button>
        </div>
        <div class="popover-divider"></div>
        <div class="popover-label">Track</div>
        <div class="card-grid">${songCards}</div>
      </div>
      <button class="popover-done">Done</button>
    </div>`;
}

function buildCaptionPopover() {
  const cards = WAVEFORM_CAPTIONS.map(c => {
    const sel = state.caption === c ? ' selected' : '';
    return `<button class="card${sel}" data-value="${esc(c)}">${esc(c)}</button>`;
  }).join('');

  const isPreset = WAVEFORM_CAPTIONS.includes(state.caption);
  const customVal = isPreset ? '' : state.caption;

  return `
    <div class="popover-header">
      <span class="popover-title">Caption</span>
      <button class="popover-close">&times;</button>
    </div>
    <div class="popover-body">
      <div class="popover-scroll">
        <div class="card-grid">${cards}</div>
      </div>
      <div class="popover-input-row">
        <input type="text" class="popover-input popover-input-sm" id="popCaptionCustom"
          placeholder="or type your own" maxlength="30" autocomplete="off"
          autocapitalize="characters" inputmode="text" enterkeyhint="done"
          value="${esc(customVal)}">
        <span class="char-count" id="popCaptionCount">${customVal.length}/30</span>
      </div>
      <button class="popover-done">Done</button>
    </div>`;
}

// ─── Popover Event Listeners ──────────────────────────────

function attachPopoverEvents(fieldName, popover) {
  switch (fieldName) {
    case 'name': {
      const input = popover.querySelector('#popName');
      const counter = popover.querySelector('#popNameCount');
      input.addEventListener('input', () => {
        const clean = input.value.replace(/[^a-zA-Z\s\-']/g, '').slice(0, 18);
        input.value = clean;
        counter.textContent = `${clean.length}/18`;
        counter.setAttribute('aria-label', `${clean.length} of 18 characters used`);
        counter.className = 'char-count' + (clean.length >= 18 ? ' full' : clean.length >= 15 ? ' warn' : '');
        state.name = clean.trim() || 'YOUR NAME';
        refreshPreview();
      });
      break;
    }

    case 'photo': {
      const fileInput = document.getElementById('fileInput');
      popover.querySelector('#popUpload').addEventListener('click', () => {
        fileInput.removeAttribute('capture');
        fileInput.click();
      });
      popover.querySelector('#popCamera').addEventListener('click', () => {
        fileInput.setAttribute('capture', 'user');
        fileInput.click();
      });
      break;
    }

    case 'department': {
      popover.querySelectorAll('.card-grid .card').forEach(card => {
        card.addEventListener('click', () => {
          state.department = card.dataset.value;
          if (!accessManuallySet) {
            const mapping = DEPT_ACCESS[state.department];
            if (mapping) state.accessLevel = mapping.access;
          }
          refreshPreview();
          rebuildPopoverContent('department');
        });
      });
      const input = popover.querySelector('#popDeptCustom');
      const counter = popover.querySelector('#popDeptCount');
      input.addEventListener('input', () => {
        const val = input.value.slice(0, 31);
        input.value = val;
        counter.textContent = `${val.length}/31`;
        counter.setAttribute('aria-label', `${val.length} of 31 characters used`);
        counter.className = 'char-count' + (val.length >= 31 ? ' full' : val.length >= 27 ? ' warn' : '');
        if (val.trim()) {
          state.department = val.trim().toUpperCase();
          if (!accessManuallySet) state.accessLevel = 'FAST TRACK PROMOTED';
        } else {
          state.department = DEPARTMENTS[0].name;
          if (!accessManuallySet) {
            const mapping = DEPT_ACCESS[state.department];
            state.accessLevel = mapping ? mapping.access : 'PENDING REVIEW';
          }
        }
        popover.querySelectorAll('.card-grid .card').forEach(c => c.classList.remove('selected'));
        refreshPreview();
      });
      break;
    }

    case 'title': {
      popover.querySelectorAll('.card-grid .card').forEach(card => {
        card.addEventListener('click', () => {
          state.title = card.dataset.value;
          refreshPreview();
          rebuildPopoverContent('title');
        });
      });
      const input = popover.querySelector('#popTitleCustom');
      const counter = popover.querySelector('#popTitleCount');
      input.addEventListener('input', () => {
        const val = input.value.slice(0, 30);
        // Auto-Title Case: capitalize first letter of each word
        const cursor = input.selectionStart;
        const titled = val.replace(/\b\w/g, c => c.toUpperCase());
        input.value = titled;
        input.setSelectionRange(cursor, cursor);
        counter.textContent = `${titled.length}/30`;
        counter.setAttribute('aria-label', `${titled.length} of 30 characters used`);
        counter.className = 'char-count' + (titled.length >= 30 ? ' full' : titled.length >= 26 ? ' warn' : '');
        state.title = titled.trim() || TITLES[0];
        popover.querySelectorAll('.card-grid .card').forEach(c => c.classList.remove('selected'));
        refreshPreview();
      });
      break;
    }

    case 'access': {
      popover.querySelectorAll('.card-grid .card').forEach(card => {
        card.addEventListener('click', () => {
          accessManuallySet = true;
          state.accessLevel = card.dataset.value;
          refreshPreview();
          rebuildPopoverContent('access');
        });
      });
      const input = popover.querySelector('#popAccessCustom');
      const counter = popover.querySelector('#popAccessCount');
      input.addEventListener('input', () => {
        const val = input.value.slice(0, 28);
        input.value = val;
        counter.textContent = `${val.length}/28`;
        counter.setAttribute('aria-label', `${val.length} of 28 characters used`);
        counter.className = 'char-count' + (val.length >= 28 ? ' full' : val.length >= 24 ? ' warn' : '');
        if (val.trim()) {
          accessManuallySet = true;
          state.accessLevel = val.trim().toUpperCase();
        } else {
          const mapping = DEPT_ACCESS[state.department];
          state.accessLevel = mapping ? mapping.access : 'PENDING REVIEW';
        }
        popover.querySelectorAll('.card-grid .card').forEach(c => c.classList.remove('selected'));
        refreshPreview();
      });
      break;
    }

    case 'caption': {
      popover.querySelectorAll('.card-grid .card').forEach(card => {
        card.addEventListener('click', () => {
          state.caption = card.dataset.value;
          refreshPreview();
          rebuildPopoverContent('caption');
        });
      });
      const capInput = popover.querySelector('#popCaptionCustom');
      const capCounter = popover.querySelector('#popCaptionCount');
      capInput.addEventListener('input', () => {
        const val = capInput.value.slice(0, 30);
        capInput.value = val;
        capCounter.textContent = `${val.length}/30`;
        capCounter.setAttribute('aria-label', `${val.length} of 30 characters used`);
        capCounter.className = 'char-count' + (val.length >= 30 ? ' full' : val.length >= 26 ? ' warn' : '');
        if (val.trim()) {
          state.caption = val.trim().toUpperCase();
        } else {
          state.caption = WAVEFORM_CAPTIONS[0];
        }
        popover.querySelectorAll('.card-grid .card').forEach(c => c.classList.remove('selected'));
        refreshPreview();
      });
      break;
    }

    case 'song': {
      popover.querySelectorAll('.card-grid .card').forEach(card => {
        card.addEventListener('click', () => {
          state.song = card.dataset.value;
          refreshPreview();
          rebuildPopoverContent('song');
        });
      });
      popover.querySelectorAll('.wave-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          state.waveStyle = btn.dataset.style;
          popover.querySelectorAll('.wave-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          refreshPreview();
        });
      });
      break;
    }
  }
}

function rebuildPopoverContent(fieldName) {
  const popover = document.querySelector('.popover');
  if (!popover || activeField !== fieldName) return;

  const body = popover.querySelector('.popover-body');
  const scrollTop = body ? body.scrollTop : 0;

  popover.innerHTML = buildPopoverContent(fieldName);
  attachPopoverEvents(fieldName, popover);

  // Restore scroll position
  const newBody = popover.querySelector('.popover-body');
  if (newBody) newBody.scrollTop = scrollTop;

  // Re-attach close + done buttons
  const closeBtn = popover.querySelector('.popover-close');
  if (closeBtn) closeBtn.addEventListener('click', hidePopover);
  const doneBtn = popover.querySelector('.popover-done');
  if (doneBtn) doneBtn.addEventListener('click', hidePopover);
}

// ─── Photo Crop ───────────────────────────────────────────

function openCropModal(imgSrc) {
  const modal = document.getElementById('cropModal');
  const img = document.getElementById('cropImage');
  img.src = imgSrc;
  modal.classList.add('active');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Crop photo');

  // Trap focus inside crop modal
  if (_activeFocusTrap) _activeFocusTrap();
  _activeFocusTrap = trapFocus(modal, cancelCrop);

  if (cropper) cropper.destroy();

  img.onload = () => {
    cropper = new Cropper(img, {
      aspectRatio: 740 / 720,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 0.9,
      cropBoxResizable: true,
      cropBoxMovable: true,
      guides: false,
      highlight: false,
      background: false,
    });
  };
}

function cancelCrop() {
  document.getElementById('cropModal').classList.remove('active');
  if (cropper) { cropper.destroy(); cropper = null; }
  if (_activeFocusTrap) { _activeFocusTrap(); _activeFocusTrap = null; }
}

function applyCrop() {
  if (!cropper) return;

  const canvas = cropper.getCroppedCanvas({
    width: 700,
    height: 630,
    imageSmoothingQuality: 'high',
  });

  state.photoUrl = canvas.toDataURL('image/jpeg', 0.85);
  refreshPreview();
  cancelCrop();

  // Update photo popover if open
  if (activeField === 'photo') {
    rebuildPopoverContent('photo');
  }
}

// ─── Badge Capture (shared) ───────────────────────────────

// Post-process canvas: draw fine-print text + clip rounded corners
// (html2canvas can't handle writing-mode or large rotated transforms)
function postProcessBadgeCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const W = 1276, H = 2026, R = 75;

  // 1. Draw fine-print text rotated along right edge
  const fp = document.querySelector('#badge .fine-print');
  if (fp) {
    const text = fp.textContent.trim().toUpperCase();
    // Center of text area: from y=350 (below header+photo top) to y=1950 (above bottom bar)
    const centerY = 180 + (H - 180 - 76) / 2;
    ctx.save();
    ctx.translate(W - 48, centerY);
    ctx.rotate(Math.PI / 2);
    ctx.font = '600 26px "JetBrains Mono", monospace';
    ctx.fillStyle = '#C0CAD4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  // 2. Clip to rounded rectangle (removes white corner artifacts)
  const clipped = document.createElement('canvas');
  clipped.width = W;
  clipped.height = H;
  const cctx = clipped.getContext('2d');
  cctx.beginPath();
  cctx.moveTo(R, 0);
  cctx.lineTo(W - R, 0);
  cctx.quadraticCurveTo(W, 0, W, R);
  cctx.lineTo(W, H - R);
  cctx.quadraticCurveTo(W, H, W - R, H);
  cctx.lineTo(R, H);
  cctx.quadraticCurveTo(0, H, 0, H - R);
  cctx.lineTo(0, R);
  cctx.quadraticCurveTo(0, 0, R, 0);
  cctx.closePath();
  cctx.clip();
  cctx.drawImage(canvas, 0, 0);

  return clipped;
}

async function captureBadgePng() {
  const captureDiv = document.getElementById('badgeCapture');
  captureDiv.style.left = '0';
  captureDiv.style.top = '0';
  captureDiv.style.position = 'fixed';
  captureDiv.style.zIndex = '-1';
  captureDiv.style.opacity = '0.01';

  // Hide fine-print from html2canvas (we draw it manually)
  const fp = document.querySelector('#badge .fine-print');
  if (fp) fp.style.visibility = 'hidden';

  await new Promise(r => setTimeout(r, 500));

  const badge = document.getElementById('badge');
  let canvas = await html2canvas(badge, {
    width: 1276,
    height: 2026,
    scale: 1,
    useCORS: true,
    allowTaint: true,
    backgroundColor: null,
    logging: false,
  });

  if (fp) fp.style.visibility = '';

  captureDiv.style.left = '-9999px';
  captureDiv.style.position = 'absolute';
  captureDiv.style.zIndex = '';
  captureDiv.style.opacity = '';

  canvas = postProcessBadgeCanvas(canvas);
  return canvas.toDataURL('image/png');
}

// ─── Join / Submit Flow ───────────────────────────────────

function showPrivacyModal() {
  const modal = document.createElement('div');
  modal.id = 'privacyModal';
  modal.className = 'privacy-modal';
  modal.innerHTML = `
    <div class="privacy-modal-card">
      <div class="privacy-modal-header">Employee Onboarding</div>
      <div class="privacy-modal-body">
        <p>Your badge will be visible on the public Help Desk Org Chart. You can remove it anytime with a secret link. No email required.</p>
        <div class="privacy-photo-toggle">
          <label class="privacy-label">Show my photo on the org chart?</label>
          <div class="privacy-toggle-btns">
            <button class="privacy-opt-btn active" data-val="yes" id="photoYes">Yes</button>
            <button class="privacy-opt-btn" data-val="no" id="photoNo">No &mdash; use placeholder</button>
          </div>
        </div>
      </div>
      <div class="privacy-modal-actions">
        <button class="btn btn-primary" id="privacySubmitBtn">Submit</button>
        <button class="btn btn-secondary" id="privacyCancelBtn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => modal.classList.add('active'));
  });

  let photoPublic = true;

  document.getElementById('photoYes').addEventListener('click', () => {
    photoPublic = true;
    document.getElementById('photoYes').classList.add('active');
    document.getElementById('photoNo').classList.remove('active');
  });

  document.getElementById('photoNo').addEventListener('click', () => {
    photoPublic = false;
    document.getElementById('photoNo').classList.add('active');
    document.getElementById('photoYes').classList.remove('active');
  });

  document.getElementById('privacyCancelBtn').addEventListener('click', () => {
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 200);
  });

  document.getElementById('privacySubmitBtn').addEventListener('click', () => {
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 200);
    submitBadge(photoPublic);
  });
}

async function submitBadge(photoPublic) {
  const loading = document.getElementById('loading');
  const isEdit = !!state._editingBadgeId;
  loading.querySelector('.loading-text').textContent = isEdit ? 'Updating your badge...' : 'Filing your paperwork...';
  loading.classList.add('active');

  try {
    const stored = JSON.parse(localStorage.getItem('hd-badge') || '{}');
    const body = {
      name: state.name,
      department: state.department,
      title: state.title,
      song: state.song,
      accessLevel: state.accessLevel,
      accessCss: ACCESS_CSS[state.accessLevel] || '',
      caption: state.caption,
      waveStyle: state.waveStyle,
      photoPublic,
      // Auth: HttpOnly hd_token cookie is auto-sent by the browser.
      // The server validates it and rejects requests without a valid cookie.
      ...(!isEdit && stored.employeeId ? { previousBadgeId: stored.employeeId } : {}),
    };
    // Only send photo field if user uploaded a new one (avoids erasing existing photo on edit)
    if (state.photoUrl) {
      body.photo = state.photoUrl;
    } else if (!isEdit) {
      body.photo = null;
    }

    const url = isEdit ? `/api/badge/${state._editingBadgeId}` : '/api/badge';
    const method = isEdit ? 'PUT' : 'POST';

    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });

    const data = await resp.json();

    if (data.success) {
      if (!isEdit) {
        // Auth token is now in an HttpOnly cookie set by the server.
        // localStorage only holds the public employee ID for auto-load UX.
        localStorage.setItem('hd-badge', JSON.stringify({
          employeeId: data.employeeId,
        }));
      }

      // Set the real server-assigned ID on the badge preview
      const idEl = document.getElementById('idField');
      if (idEl) {
        idEl.textContent = data.employeeId;
        idEl.dataset.set = '1';
        idEl.dataset.locked = '1';
      }
      state._editingBadgeId = data.employeeId;
      refreshPreview();

      showBadgeStatusBar(data.employeeId);
      if (isEdit) {
        showToast('Badge updated successfully.', 'success');
      } else {
        showSubmitSuccess(data.employeeId);
      }
    } else {
      showToast(data.error || 'Submission failed. Please try again.', 'error');
    }
  } catch (err) {
    console.error('Badge submission failed:', err);
    showToast('Submission failed. Please try again.', 'error');
  } finally {
    loading.querySelector('.loading-text').textContent = 'Generating your badge...';
    loading.classList.remove('active');
  }
}

function showToast(message, type = 'success', duration = 4000) {
  const icon = type === 'error' ? '&#10007;' : '&#10003;';
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-text"></div>
  `;
  toast.querySelector('.toast-text').textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('visible'));
  });

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Feature-detect Web Share with PNG files. Required on iOS 15+/Android Chrome;
// desktop Safari's canShare() rejects files so the button is hidden there.
function _canShareBadgeFile() {
  if (!navigator.canShare) return false;
  try {
    const probe = new File([''], 'badge.png', { type: 'image/png' });
    return navigator.canShare({ files: [probe] });
  } catch { return false; }
}

// Share the rendered badge PNG via the native share sheet. Fetches the image,
// wraps it in a File, and hands it to navigator.share. Falls back to a plain
// download if share is unsupported or fails (user cancel swallowed silently).
async function _shareBadge(employeeId) {
  const url = `/api/badge/${encodeURIComponent(employeeId)}/image`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('fetch failed');
    const blob = await resp.blob();
    const file = new File([blob], `helpdesk-badge-${employeeId}.png`, { type: 'image/png' });
    const payload = {
      files: [file],
      title: `Help Desk Badge ${employeeId}`,
      text: `Filed my paperwork at Help Desk Inc. — ${employeeId}`
    };
    if (navigator.canShare && navigator.canShare(payload)) {
      await navigator.share(payload);
      return;
    }
    throw new Error('canShare rejected payload');
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user cancelled share — no-op
    const a = document.createElement('a');
    a.href = url;
    a.download = `helpdesk-badge-${employeeId}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

function showSubmitSuccess(employeeId) {
  // Remove existing success banner
  const existing = document.getElementById('submitSuccess');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'submitSuccess';
  banner.className = 'submit-success';
  const shareBtnHtml = _canShareBadgeFile()
    ? `<button class="submit-success-share" id="shareBadgeBtn">Share Badge</button>`
    : '';
  banner.innerHTML = `
    <div class="submit-success-text">Welcome aboard, <strong>${esc(employeeId)}</strong>! Your badge is on the org chart.</div>
    <div class="submit-success-actions">
      ${shareBtnHtml}
      <a class="submit-success-download" href="/api/badge/${esc(employeeId)}/image" download="helpdesk-badge-${esc(employeeId)}.png">Download Badge</a>
      <button class="submit-success-dismiss" id="successDismissBtn">Dismiss</button>
    </div>
  `;
  const header = document.querySelector('.app-header');
  const statusBar = document.getElementById('badgeStatusBar');
  if (statusBar) {
    statusBar.insertAdjacentElement('afterend', banner);
  } else {
    header.insertAdjacentElement('afterend', banner);
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => banner.classList.add('visible'));
  });

  document.getElementById('successDismissBtn').addEventListener('click', () => {
    banner.classList.remove('visible');
    setTimeout(() => banner.remove(), 200);
  });

  const shareBtn = document.getElementById('shareBadgeBtn');
  if (shareBtn) shareBtn.addEventListener('click', () => _shareBadge(employeeId));

  // Switch button to "Save Changes" now that they have a badge
  const submitLabel = document.getElementById('submitBadgeLabel');
  if (submitLabel) submitLabel.textContent = 'Save Changes';
}

function showBadgeStatusBar(employeeId) {
  // Remove existing
  const existing = document.getElementById('badgeStatusPill');
  if (existing) existing.remove();

  const pill = document.createElement('span');
  pill.id = 'badgeStatusPill';
  pill.className = 'badge-status-pill';
  pill.innerHTML = `
    <span class="badge-status-id">${esc(employeeId)}</span>
    <a class="badge-status-download" href="/api/badge/${esc(employeeId)}/image" download="helpdesk-badge-${esc(employeeId)}.png" title="Download badge">&darr;</a>
    <button class="badge-status-remove" id="removeBadgeBtn" title="Remove my badge">&times;</button>
  `;

  const nav = document.getElementById('appNav');
  if (nav) nav.appendChild(pill);

  document.getElementById('removeBadgeBtn').addEventListener('click', removeBadge);
}

async function removeBadge() {
  const stored = localStorage.getItem('hd-badge');
  if (!stored) return;

  const { employeeId } = JSON.parse(stored);
  if (!confirm('Remove your badge from the org chart? This cannot be undone.')) return;

  try {
    // Auth via HttpOnly hd_token cookie (auto-sent by browser).
    const resp = await fetch(`/api/badge/${employeeId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const data = await resp.json();
    if (data.success) {
      localStorage.removeItem('hd-badge');
      state._editingBadgeId = null;
      const pill = document.getElementById('badgeStatusPill');
      if (pill) pill.remove();
      // Reset ID to placeholder for new badge creation
      const idEl = document.getElementById('idField');
      if (idEl) {
        idEl.textContent = 'HD-?????';
        idEl.dataset.set = '1';
        idEl.dataset.locked = '1';
      }
      refreshPreview();
      // Reset submit button label
      const submitLabel = document.getElementById('submitBadgeLabel');
      if (submitLabel) submitLabel.textContent = 'Join the Org';
      showToast('Your badge has been shredded.', 'success');
    } else {
      showToast(data.error || 'Failed to remove badge.', 'error');
    }
  } catch {
    showToast('Failed to remove badge. Please try again.', 'error');
  }
}

// ─── Print Test ───────────────────────────────────────────

async function printTest() {
  const loading = document.getElementById('loading');
  loading.querySelector('.loading-text').textContent = 'Preparing print test...';
  loading.classList.add('active');
  hidePopover();

  try {
    const dataUrl = await captureBadgePng();

    // CR80 dimensions: 2.125" x 3.375" (portrait)
    // Crop mark length: 0.25"
    const printWin = window.open('', '_blank');
    printWin.document.write(`<!DOCTYPE html>
<html>
<head>
<title>Badge Print Test — CR80</title>
<style>
  @page {
    size: letter;
    margin: 0.5in;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: #f5f5f5;
  }

  .print-sheet {
    background: white;
    width: 7.5in;
    height: 10in;
    padding: 0.5in;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }

  .print-title {
    font-size: 14px;
    font-weight: 700;
    color: #333;
    margin-bottom: 4px;
    letter-spacing: 2px;
    text-transform: uppercase;
  }
  .print-subtitle {
    font-size: 11px;
    color: #888;
    margin-bottom: 24px;
  }

  /* Badge area with crop marks */
  .badge-area {
    position: relative;
    width: calc(2.125in + 0.5in);
    height: calc(3.375in + 0.5in);
  }

  .badge-img {
    position: absolute;
    left: 0.25in;
    top: 0.25in;
    width: 2.125in;
    height: 3.375in;
    border: 1px solid #ddd;
  }

  /* Crop marks */
  .crop { position: absolute; }
  .crop-h {
    width: 0.2in;
    height: 0;
    border-top: 1px solid #000;
  }
  .crop-v {
    width: 0;
    height: 0.2in;
    border-left: 1px solid #000;
  }
  /* Top-left */
  .crop-tl-h { top: 0.25in; left: 0; }
  .crop-tl-v { top: 0; left: 0.25in; }
  /* Top-right */
  .crop-tr-h { top: 0.25in; right: 0; }
  .crop-tr-v { top: 0; right: 0.25in; }
  /* Bottom-left */
  .crop-bl-h { bottom: 0.25in; left: 0; }
  .crop-bl-v { bottom: 0; left: 0.25in; }
  /* Bottom-right */
  .crop-br-h { bottom: 0.25in; right: 0; }
  .crop-br-v { bottom: 0; right: 0.25in; }

  .print-info {
    margin-top: 20px;
    text-align: center;
    font-size: 10px;
    color: #999;
    line-height: 1.6;
  }
  .print-info strong { color: #555; }

  .credit-card-note {
    margin-top: 16px;
    padding: 8px 16px;
    border: 1px dashed #ccc;
    border-radius: 6px;
    font-size: 11px;
    color: #666;
    text-align: center;
  }

  .print-btn {
    margin-top: 20px;
    padding: 12px 32px;
    background: #1B6B2A;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    letter-spacing: 1px;
  }
  .print-btn:hover { background: #22883A; }

  @media print {
    body { background: white; }
    .print-sheet { box-shadow: none; padding: 0; }
    .print-btn { display: none; }
    .credit-card-note { display: none; }
  }
</style>
</head>
<body>
  <div class="print-sheet">
    <div class="print-title">Help Desk — Badge Print Test</div>
    <div class="print-subtitle">CR80 Standard &bull; 2.125&quot; &times; 3.375&quot; &bull; Actual Size</div>

    <div class="badge-area">
      <img class="badge-img" src="${dataUrl}" alt="Badge">
      <div class="crop crop-h crop-tl-h"></div>
      <div class="crop crop-v crop-tl-v"></div>
      <div class="crop crop-h crop-tr-h"></div>
      <div class="crop crop-v crop-tr-v"></div>
      <div class="crop crop-h crop-bl-h"></div>
      <div class="crop crop-v crop-bl-v"></div>
      <div class="crop crop-h crop-br-h"></div>
      <div class="crop crop-v crop-br-v"></div>
    </div>

    <div class="print-info">
      <strong>IMPORTANT:</strong> Set print scale to <strong>100%</strong> (not "Fit to Page")<br>
      Cut along crop marks &bull; Compare against a credit card for size verification<br>
      Source: 1276 &times; 2026px (~600 DPI at CR80)
    </div>

    <div class="credit-card-note">
      A standard credit card is the same size as CR80 (3.375&quot; &times; 2.125&quot;).<br>
      Hold one over the cutout to verify dimensions match exactly.
    </div>

    <button class="print-btn" onclick="window.print()">Print This Page</button>
  </div>
</body>
</html>`);
    printWin.document.close();
  } catch (err) {
    console.error('Print test failed:', err);
    showToast('Print test failed. Try downloading and printing manually.', 'error');
  } finally {
    loading.querySelector('.loading-text').textContent = 'Generating your badge...';
    loading.classList.remove('active');
  }
}

// ─── Global Event Listeners ──────────────────────────────

// Click outside popover → close
document.addEventListener('click', (e) => {
  if (!activeField) return;
  const popover = document.querySelector('.popover');
  if (popover && popover.contains(e.target)) return;
  hidePopover();
});

// Escape → close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeField) hidePopover();
});

// File input for photo (persistent, not inside popover)
document.getElementById('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => openCropModal(evt.target.result);
  reader.readAsDataURL(file);
  e.target.value = '';
});

// sudo randomize — randomize all selectable fields
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function sudoRandomize() {
  hidePopover();
  const dept = pick(DEPARTMENTS);
  state.department = dept.name;
  state.title = pick(TITLES);
  state.accessLevel = DEPT_ACCESS[dept.name]?.access || pick(FAN_ACCESS_LEVELS).label;
  state.song = pick(SONG_LIST);
  state.waveStyle = pick(['barcode', 'sticker']);
  state.caption = pick(WAVEFORM_CAPTIONS);
  accessManuallySet = false;

  // Reset employee ID + issued date for fresh badge feel (but keep locked IDs)
  const idEl = document.getElementById('idField');
  if (idEl && !idEl.dataset.locked) { delete idEl.dataset.set; }
  const issuedEl = document.getElementById('issuedField');
  if (issuedEl) { delete issuedEl.dataset.set; }
  const captionEl = document.getElementById('badgeCaption');
  if (captionEl) { delete captionEl.dataset.set; }

  refreshPreview();
}

document.getElementById('rebootBtn').addEventListener('click', () => {
  haptic(12);
  sudoRandomize();
});

// Download & Print FABs
document.getElementById('submitBadgeBtn').addEventListener('click', () => {
  haptic(15);
  if (state.name === 'YOUR NAME') {
    showToast('Tap your name on the badge to get started.', 'error');
    return;
  }
  if (state._editingBadgeId) {
    // Returning user — preserve their existing photo privacy setting
    submitBadge(state._photoPublic !== false);
  } else {
    // New user — show privacy modal first
    showPrivacyModal();
  }
});


// ─── Public Org Chart (Employee Directory) ───────────────

// PUBLIC_DIVISIONS, KNOWN_DEPT_THEMES, BAND_DEPTS, getDivisionForDept,
// and shared orgchart state (window._publicOrgPage, etc.) — all in shared.js

// ─── Renderer System ──────────────────────────────────────
let currentRenderer = null;
let orgChartContainer = null;
let orgChartStats = null;

// ─── Renderer Interface ──────────────────────────────────
// Each view renderer (GridRenderer, RackRenderer, ArcadeRenderer,
// ReviewBoardRenderer) must implement:
//   init(container, stats)  — populate container, return Promise
//   addBadge(badge)         — insert SSE badge, return element or null
//   destroy()               — clean up: clear intervals/timeouts,
//                             remove event listeners (resize, zoom, keyboard),
//                             clear innerHTML, null all refs
async function switchView(mode) {
  // Clean up any active focus trap before switching
  if (_activeFocusTrap) { _activeFocusTrap(); _activeFocusTrap = null; }

  // Destroy current renderer
  if (currentRenderer && currentRenderer.destroy) {
    currentRenderer.destroy();
  }

  // Select new renderer
  const renderers = {
    grid: window.GridRenderer,
    reviewboard: window.ReviewBoardRenderer,
    arcade: window.ArcadeRenderer,
    rack: window.RackRenderer,
  };

  const renderer = renderers[mode];
  if (!renderer) {
    showToast(`View "${mode}" not available yet`, 'info');
    return;
  }

  currentRenderer = renderer;

  // Toggle body class for view-specific CSS (e.g., hiding global ticker in lobby)
  document.body.classList.remove('view-grid', 'view-reviewboard', 'view-arcade', 'view-rack');
  document.body.classList.add('view-' + mode);

  // Save preference
  localStorage.setItem('hd-view-mode', mode);

  // Update dropdown and legacy button states
  updateViewDropdown(mode);
  document.querySelectorAll('.view-switch-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Re-fetch stats so newest hire / counts reflect current state
  if (orgChartContainer) {
    try {
      const resp = await fetch('/api/orgchart/stats');
      orgChartStats = await resp.json();
    } catch { /* use stale stats as fallback */ }

    orgChartContainer.innerHTML = '';
    await currentRenderer.init(orgChartContainer, orgChartStats);
  }
}

async function initOrgChart() {
  orgChartContainer = document.createElement('div');
  orgChartContainer.className = 'public-orgchart';
  document.body.appendChild(orgChartContainer);

  // Fetch stats
  try {
    const resp = await fetch('/api/orgchart/stats');
    orgChartStats = await resp.json();
  } catch {
    orgChartContainer.innerHTML = '<div class="no-badges-msg">Failed to load directory.</div>';
    return;
  }

  // Build view switcher
  buildViewSwitcher();

  // Determine initial mode
  const savedMode = localStorage.getItem('hd-view-mode') || 'grid';
  const available = {
    grid: !!window.GridRenderer,
    reviewboard: !!window.ReviewBoardRenderer,
    arcade: !!window.ArcadeRenderer,
    rack: !!window.RackRenderer,
  };
  const mode = available[savedMode] ? savedMode : 'grid';

  currentRenderer = { grid: window.GridRenderer, reviewboard: window.ReviewBoardRenderer, arcade: window.ArcadeRenderer, rack: window.RackRenderer }[mode];
  if (!currentRenderer) {
    orgChartContainer.innerHTML = '<div class="no-badges-msg">No renderer available.</div>';
    return;
  }

  // Set body class for view-specific CSS (e.g., hiding global ticker in lobby)
  document.body.classList.remove('view-grid', 'view-reviewboard', 'view-arcade', 'view-rack');
  document.body.classList.add('view-' + mode);

  // Mark active button
  document.querySelectorAll('.view-switch-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  await currentRenderer.init(orgChartContainer, orgChartStats);
}

const VIEW_MODES = [
  { mode: 'grid',        icon: '&#9638;',  label: 'Grid',      desc: 'Employee directory',     key: '1' },
  { mode: 'rack',        icon: '&#128429;', label: 'Rack',     desc: 'Network infrastructure',  key: '2' },
  { mode: 'reviewboard', icon: '&#9733;',  label: 'AI Review', desc: 'Performance reviews',    key: '3' },
  { mode: 'arcade',      icon: '&#127918;', label: 'Arcade',   desc: 'Office combat simulator', key: '4' },
];

function buildViewSwitcher() {
  const nav = document.querySelector('.app-nav');
  if (!nav) return;

  const savedMode = localStorage.getItem('hd-view-mode') || 'grid';
  const current = VIEW_MODES.find(v => v.mode === savedMode) || VIEW_MODES[0];

  // Create dropdown container
  const dropdown = document.createElement('div');
  dropdown.className = 'view-dropdown';
  dropdown.innerHTML = `
    <button class="view-dropdown-trigger" id="viewDropdownBtn" aria-expanded="false" aria-haspopup="true">
      <span class="view-dropdown-icon">${current.icon}</span>
      <span class="view-dropdown-label">${current.label}</span>
      <span class="view-dropdown-caret">&#9662;</span>
    </button>
    <div class="view-dropdown-menu" id="viewDropdownMenu" role="menu">
      ${VIEW_MODES.map(v => `
        <button class="view-dropdown-item${v.mode === savedMode ? ' active' : ''}" data-mode="${v.mode}" role="menuitem">
          <span class="view-dropdown-item-icon">${v.icon}</span>
          <span class="view-dropdown-item-text">
            <span class="view-dropdown-item-label">${v.label}</span>
            <span class="view-dropdown-item-desc">${v.desc}</span>
          </span>
          <kbd>${v.key}</kbd>
        </button>
      `).join('')}
      <div class="view-dropdown-divider"></div>
      <button class="view-dropdown-item view-dropdown-fx ${animationsEnabled() ? 'fx-on' : ''}" id="animToggleBtn" role="menuitem">
        <span class="view-dropdown-item-icon">&#10024;</span>
        <span class="view-dropdown-item-text">
          <span class="view-dropdown-item-label">FX</span>
          <span class="view-dropdown-item-desc">${animationsEnabled() ? 'Animations on' : 'Animations off'}</span>
        </span>
        <kbd>A</kbd>
      </button>
    </div>
  `;

  // Insert into header (not nav, since non-grid views hide .app-nav)
  const header = document.querySelector('.app-header');
  header.appendChild(dropdown);

  // Toggle dropdown
  const trigger = document.getElementById('viewDropdownBtn');
  const menu = document.getElementById('viewDropdownMenu');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dropdown.classList.toggle('open');
    trigger.setAttribute('aria-expanded', open);
  });

  // Close on outside click
  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  });
  menu.addEventListener('click', (e) => e.stopPropagation());

  // View switch click handlers
  menu.querySelectorAll('.view-dropdown-item[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.mode);
      dropdown.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    });
  });

  // Animation toggle handler
  if (!animationsEnabled()) document.body.classList.add('fx-off');
  document.getElementById('animToggleBtn').addEventListener('click', toggleAnimations);

  // Keyboard shortcuts (only on orgchart page)
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '1') switchView('grid');
    else if (e.key === '2') switchView('rack');
    else if (e.key === '3') switchView('reviewboard');
    else if (e.key === '4') switchView('arcade');
    else if (e.key === 'a' || e.key === 'A') toggleAnimations();
  });
}

function updateViewDropdown(mode) {
  const current = VIEW_MODES.find(v => v.mode === mode) || VIEW_MODES[0];
  const trigger = document.getElementById('viewDropdownBtn');
  if (trigger) {
    trigger.querySelector('.view-dropdown-icon').innerHTML = current.icon;
    trigger.querySelector('.view-dropdown-label').textContent = current.label;
  }
  document.querySelectorAll('.view-dropdown-item[data-mode]').forEach(item => {
    item.classList.toggle('active', item.dataset.mode === mode);
  });
}

function showBadgeDetail(employeeId, name) {
  const modal = document.createElement('div');
  modal.className = 'badge-detail-modal';
  // Full-size image for detail view (not thumbnail)
  modal.innerHTML = `
    <img class="badge-detail-img" src="/api/badge/${esc(employeeId)}/image" alt="${esc(name)}">
    <div class="badge-detail-actions">
      <a class="btn btn-primary" href="/api/badge/${esc(employeeId)}/image" download="helpdesk-badge-${esc(employeeId)}.png">Download</a>
      <button class="btn btn-secondary" id="detailCloseBtn">Close</button>
    </div>
  `;
  document.body.appendChild(modal);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => modal.classList.add('active'));
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) { modal.remove(); }
  });
  modal.querySelector('#detailCloseBtn').addEventListener('click', () => modal.remove());
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', handler); }
  });
}

// ─── Init ─────────────────────────────────────────────────

// Check if we're on the org chart public page
// Set active nav link
const activePage = window.location.pathname === '/orgchart' ? 'orgchart' : 'editor';
document.querySelectorAll('.app-nav-link').forEach(link => {
  if (link.dataset.page === activePage) link.classList.add('active');
});

if (window.location.pathname === '/orgchart') {
  document.querySelector('.editor').style.display = 'none';
  document.querySelector('.fab-group').style.display = 'none';
  initOrgChart().then(() => {
    // Initialize shared live viz features after renderer renders
    initTicker();
    // Donut is initialized inside renderer after stats are fetched

    // Defer SSE until all images finish loading — Firefox's HTTP/1.1 limit
    // (6 connections per origin) blocks EventSource while thumbnails load
    if (document.readyState === 'complete') {
      connectSSE();
    } else {
      window.addEventListener('load', () => connectSSE());
    }
  });
} else {
  // Add invisible placeholder to match dropdown width so nav doesn't shift
  const placeholder = document.createElement('div');
  placeholder.className = 'view-dropdown-placeholder';
  document.querySelector('.app-header').appendChild(placeholder);

  // Scrub stale localStorage keys from removed features
  localStorage.removeItem('hd-codex'); // arcade boss-discovery, replaced in arcade overhaul
  // FOLLOWUP: when game-engine.js is removed (see hdbadge-backlog), also scrub
  // 'hd_game_badge_id' and 'hd_tutorial_seen' here.

  const storedBadge = localStorage.getItem('hd-badge');
  let existingId = null;
  let legacyToken = null;
  if (storedBadge) {
    try {
      const parsed = JSON.parse(storedBadge);
      existingId = parsed.employeeId;
      legacyToken = parsed.deleteToken || null;
    } catch { /* ignore corrupt data */ }
  }

  // Auto-promote: if localStorage holds a legacy plaintext token (from before
  // the cookie migration), exchange it for an HttpOnly cookie now and scrub
  // the plaintext from localStorage. This is fire-and-forget — the existing
  // editor flow keeps working whether this succeeds or not.
  if (existingId && legacyToken) {
    fetch(`/api/badge/${encodeURIComponent(existingId)}/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token: legacyToken }),
    }).then(async (r) => {
      if (r.ok) {
        // Cookie is set. Strip the plaintext token from localStorage forever.
        localStorage.setItem('hd-badge', JSON.stringify({ employeeId: existingId }));
      }
    }).catch(() => { /* offline or transient — try again next visit */ });
  }

  const idEl = document.getElementById('idField');

  if (existingId) {
    // Existing badge: lock the ID, auto-load badge data into editor
    idEl.textContent = existingId;
    idEl.dataset.set = '1';
    idEl.dataset.locked = '1';
    showBadgeStatusBar(existingId);

    // Switch button to "Save Changes" for returning users
    const submitLabel = document.getElementById('submitBadgeLabel');
    if (submitLabel) submitLabel.textContent = 'Save Changes';

    // Auto-load their badge data into the editor
    fetch(`/api/badge/${existingId}`)
      .then(r => r.json())
      .then(data => {
        if (data.employeeId) {
          state.name = data.name;
          state.department = data.department;
          state.title = data.title;
          state.song = data.song;
          state.accessLevel = data.accessLevel;
          state.caption = data.caption || 'SCAN TO FILE COMPLAINT';
          state.waveStyle = data.waveStyle || 'barcode';
          state._photoPublic = data.photoPublic !== false;
          state._editingBadgeId = existingId;

          // Load existing headshot into preview if badge has a photo
          if (data.hasPhoto && data.photoPublic !== false) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              canvas.getContext('2d').drawImage(img, 0, 0);
              state.photoUrl = canvas.toDataURL('image/jpeg', 0.85);
              refreshPreview();
            };
            img.src = `/api/badge/${existingId}/headshot?t=${Date.now()}`;
          }

          // Set issued date from their creation date
          const d = new Date(data.createdAt);
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const yy = String(d.getFullYear()).slice(2);
          const issuedEl = document.getElementById('issuedField');
          if (issuedEl) {
            issuedEl.textContent = `ISSUED ${mm}.${dd}.${yy}`;
            issuedEl.dataset.set = '1';
          }

          refreshPreview();
        }
      })
      .catch(() => { /* badge may have been deleted — ignore */ });
  } else {
    // New user: show placeholder ID until submission
    idEl.textContent = 'HD-?????';
    idEl.dataset.set = '1';
    idEl.dataset.locked = '1'; // Prevent randomization — server assigns real ID

    // Tutorial sequence: hint intro (700ms) → discover-pulse + slot machine.
    // Suppress the auto-fire of discover-pulse in attachBadgeClickHandlers so
    // we can sequence it manually after the hint intro lands.
    _suppressAutoDiscover = true;

    const hint = document.getElementById('editHint');
    if (hint) hint.classList.add('intro');

    setTimeout(() => {
      // Intro done — drop the intro class so hintPulse infinite animation resumes
      if (hint) hint.classList.remove('intro');

      // Now fire the discovery pulse cascade. CSS delays start counting from
      // this moment, so timings line up with slot machine.
      const previewArea = document.getElementById('badgePreviewArea');
      if (previewArea) {
        _discoveryDone = true;
        previewArea.classList.add('discover-pulse');
        // Last pulse: delay 4.8s + duration 0.7s = 5.5s, plus buffer
        setTimeout(() => previewArea.classList.remove('discover-pulse'), 6000);
      }

      // Slot machine: cycles each editable field through 3 random values
      // synchronized with its discovery pulse window. Tutorial via demonstration.
      _scheduleFirstLoadDemo();
    }, 1400); // matches hintIntro animation duration in app.css
  }

  document.getElementById('issuedField').textContent = generateIssuedDate();
  document.getElementById('issuedField').dataset.set = '1';
  applyStatus();
  document.getElementById('badgeCaption').textContent = state.caption;
  document.getElementById('badgeCaption').dataset.set = '1';

  refreshPreview();
}
