// Help Desk Badge Generator — Canva-Style Click-to-Edit

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

let _discoveryDone = false;

function attachBadgeClickHandlers() {
  const previewArea = document.getElementById('badgePreviewArea');
  if (!previewArea) return;

  // One-time discovery pulse — staggered outline flash across all editable elements
  if (!_discoveryDone) {
    _discoveryDone = true;
    previewArea.classList.add('discover-pulse');
    // Remove after animations complete (~2.4s delay + 1.2s anim)
    setTimeout(() => previewArea.classList.remove('discover-pulse'), 4000);
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

  // Prevent clicks inside popover from bubbling to document
  popover.addEventListener('click', (e) => e.stopPropagation());

  positionPopover(popover, targetEl);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => popover.classList.add('visible'));
  });

  attachPopoverEvents(fieldName, popover);

  // Focus trap for popover (Escape closes, Tab cycles within)
  if (_activeFocusTrap) _activeFocusTrap();
  _activeFocusTrap = trapFocus(popover, hidePopover);

  // Close button
  const closeBtn = popover.querySelector('.popover-close');
  if (closeBtn) closeBtn.addEventListener('click', hidePopover);

  // Auto-focus text input
  const input = popover.querySelector('.popover-input');
  if (input) setTimeout(() => input.focus(), 80);
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

  // Use the preview wrapper for horizontal anchor (fixed width, doesn't shift with text)
  const wrapper = document.querySelector('.preview-wrapper');
  const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : targetEl.getBoundingClientRect();
  const fieldRect = targetEl.getBoundingClientRect();

  const popWidth = 380;
  const viewW = window.innerWidth;
  const rightSpace = viewW - wrapperRect.right;
  const leftSpace = wrapperRect.left;

  const gap = 20;
  let left, arrowSide;
  if (rightSpace >= popWidth + 20) {
    left = wrapperRect.right + gap;
    arrowSide = 'left';
  } else if (leftSpace >= popWidth + 20) {
    left = wrapperRect.left - popWidth - gap;
    arrowSide = 'right';
  } else {
    left = Math.max(10, (viewW - popWidth) / 2);
    arrowSide = 'none';
  }

  // Vertically center on the target field element, clamped to viewport
  const targetCenter = fieldRect.top + fieldRect.height / 2;
  const popHeight = popover.offsetHeight || 450;
  const maxTop = window.innerHeight - popHeight - 10;
  const top = Math.max(10, Math.min(targetCenter - 40, maxTop));

  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
  popover.dataset.arrow = arrowSide;
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
          placeholder="First name" maxlength="18" autocomplete="off"
          value="${esc(val)}">
        <span class="char-count" id="popNameCount">${val.length}/18</span>
      </div>
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
      <div class="card-grid">${cards}</div>
      <div class="popover-input-row">
        <input type="text" class="popover-input popover-input-sm" id="popDeptCustom"
          placeholder="or type your own" maxlength="31" autocomplete="off"
          value="${esc(customVal)}">
        <span class="char-count" id="popDeptCount">${customVal.length}/31</span>
      </div>
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
      <div class="card-grid">${cards}</div>
      <div class="popover-input-row">
        <input type="text" class="popover-input popover-input-sm" id="popTitleCustom"
          placeholder="or type your own" maxlength="30" autocomplete="off"
          value="${esc(customVal)}">
        <span class="char-count" id="popTitleCount">${customVal.length}/30</span>
      </div>
    </div>`;
}

function buildAccessPopover() {
  const cards = ACCESS_LEVELS.map(a => {
    const sel = state.accessLevel === a.label ? ' selected' : '';
    const colorClass = a.css ? ` card-access-${a.css}` : '';
    return `<button class="card${sel}${colorClass}" data-value="${esc(a.label)}">${esc(a.label)}</button>`;
  }).join('');

  const isPreset = ACCESS_LEVELS.some(a => a.label === state.accessLevel);
  const customVal = isPreset ? '' : state.accessLevel;

  return `
    <div class="popover-header">
      <span class="popover-title">Access Level</span>
      <button class="popover-close">&times;</button>
    </div>
    <div class="popover-body">
      <div class="card-grid">${cards}</div>
      <div class="popover-input-row">
        <input type="text" class="popover-input popover-input-sm" id="popAccessCustom"
          placeholder="or type your own" maxlength="28" autocomplete="off"
          value="${esc(customVal)}">
        <span class="char-count" id="popAccessCount">${customVal.length}/28</span>
      </div>
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
      <div class="popover-label">Waveform Style</div>
      <div class="wave-toggle">
        <button class="wave-btn${state.waveStyle === 'barcode' ? ' active' : ''}" data-style="barcode">Barcode</button>
        <button class="wave-btn${state.waveStyle === 'sticker' ? ' active' : ''}" data-style="sticker">Sticker</button>
      </div>
      <div class="popover-divider"></div>
      <div class="popover-label">Track</div>
      <div class="card-grid">${songCards}</div>
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
      <div class="card-grid">${cards}</div>
      <div class="popover-input-row">
        <input type="text" class="popover-input popover-input-sm" id="popCaptionCustom"
          placeholder="or type your own" maxlength="30" autocomplete="off"
          value="${esc(customVal)}">
        <span class="char-count" id="popCaptionCount">${customVal.length}/30</span>
      </div>
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
        input.value = val;
        counter.textContent = `${val.length}/30`;
        counter.className = 'char-count' + (val.length >= 30 ? ' full' : val.length >= 26 ? ' warn' : '');
        state.title = val.trim() || TITLES[0];
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

  // Re-attach close button
  const closeBtn = popover.querySelector('.popover-close');
  if (closeBtn) closeBtn.addEventListener('click', hidePopover);
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

// ─── Download ─────────────────────────────────────────────

async function downloadBadge() {
  const loading = document.getElementById('loading');
  loading.classList.add('active');
  hidePopover();

  try {
    const dataUrl = await captureBadgePng();

    const link = document.createElement('a');
    const employeeId = document.getElementById('idField').textContent;
    const safeName = state.name.toLowerCase().replace(/\s+/g, '-');
    link.download = `helpdesk-badge-${safeName}-${employeeId}.png`;
    link.href = dataUrl;
    link.click();

    showToast('Badge downloaded!', 'success', 3000);

    // Show join prompt after successful download
    showJoinPrompt();
  } catch (err) {
    console.error('Badge export failed:', err);
    showToast('Badge generation failed. Try again or take a screenshot instead.', 'error');
  } finally {
    loading.classList.remove('active');
  }
}

// ─── Join Org Chart Flow ──────────────────────────────────

function showJoinPrompt() {
  // Don't show if already in directory
  if (localStorage.getItem('hd-badge')) return;
  // Don't show if name is default
  if (state.name === 'YOUR NAME') return;

  // Remove existing prompt if any
  const existing = document.getElementById('joinPrompt');
  if (existing) existing.remove();

  const prompt = document.createElement('div');
  prompt.id = 'joinPrompt';
  prompt.className = 'join-prompt';
  prompt.innerHTML = `
    <div class="join-prompt-text">Badge downloaded! Want to join the company directory?</div>
    <div class="join-prompt-actions">
      <button class="join-prompt-btn" id="joinOrgBtn">Join the Org Chart</button>
      <button class="join-prompt-dismiss" id="joinDismissBtn">No thanks</button>
    </div>
  `;
  document.body.appendChild(prompt);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => prompt.classList.add('visible'));
  });

  document.getElementById('joinDismissBtn').addEventListener('click', () => {
    prompt.classList.remove('visible');
    setTimeout(() => prompt.remove(), 200);
  });

  document.getElementById('joinOrgBtn').addEventListener('click', () => {
    prompt.classList.remove('visible');
    setTimeout(() => { prompt.remove(); showPrivacyModal(); }, 200);
  });

  // Auto-dismiss after 12 seconds
  setTimeout(() => {
    if (document.getElementById('joinPrompt')) {
      prompt.classList.remove('visible');
      setTimeout(() => prompt.remove(), 200);
    }
  }, 12000);
}

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
      photo: state.photoUrl || null,
      photoPublic,
      ...(isEdit ? { token: stored.deleteToken } : {}),
      ...(!isEdit && stored.employeeId ? { previousBadgeId: stored.employeeId, previousToken: stored.deleteToken } : {}),
    };

    const url = isEdit ? `/api/badge/${state._editingBadgeId}` : '/api/badge';
    const method = isEdit ? 'PUT' : 'POST';

    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();

    if (data.success) {
      if (!isEdit) {
        localStorage.setItem('hd-badge', JSON.stringify({
          employeeId: data.employeeId,
          deleteToken: data.deleteToken,
        }));
      }
      showBadgeStatusBar(data.employeeId);
      if (isEdit) {
        state._editingBadgeId = null;
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

function showSubmitSuccess(employeeId) {
  showToast(`Welcome aboard, ${employeeId}! Your badge is now on the org chart.`, 'success', 5000);
}

function showBadgeStatusBar(employeeId) {
  // Remove existing
  const existing = document.getElementById('badgeStatusBar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.id = 'badgeStatusBar';
  bar.className = 'badge-status-bar';
  bar.innerHTML = `
    <span class="badge-status-id">${esc(employeeId)}</span>
    <button class="badge-status-edit" id="editBadgeBtn">Edit my badge</button>
    <button class="badge-status-remove" id="removeBadgeBtn">Remove my badge</button>
  `;

  const header = document.querySelector('.app-header');
  header.insertAdjacentElement('afterend', bar);

  document.getElementById('editBadgeBtn').addEventListener('click', () => editBadge(employeeId));
  document.getElementById('removeBadgeBtn').addEventListener('click', removeBadge);
}

async function removeBadge() {
  const stored = localStorage.getItem('hd-badge');
  if (!stored) return;

  const { employeeId, deleteToken } = JSON.parse(stored);
  if (!confirm('Remove your badge from the org chart? This cannot be undone.')) return;

  try {
    const resp = await fetch(`/api/badge/${employeeId}?token=${deleteToken}`, { method: 'DELETE' });
    const data = await resp.json();
    if (data.success) {
      localStorage.removeItem('hd-badge');
      const bar = document.getElementById('badgeStatusBar');
      if (bar) bar.remove();
      showToast('Your badge has been shredded.', 'success');
    } else {
      showToast(data.error || 'Failed to remove badge.', 'error');
    }
  } catch {
    showToast('Failed to remove badge. Please try again.', 'error');
  }
}

async function editBadge(employeeId) {
  try {
    const resp = await fetch(`/api/badge/${employeeId}`);
    const data = await resp.json();
    if (!data.employeeId) {
      showToast('Badge not found.', 'error');
      return;
    }

    // Pre-populate editor state with existing badge data
    state.name = data.name;
    state.department = data.department;
    state.title = data.title;
    state.song = data.song;
    state.accessLevel = data.accessLevel;
    state.caption = data.caption || 'SCAN TO FILE COMPLAINT';
    state._editingBadgeId = employeeId;

    // Update the live badge preview
    updateBadge({
      name: state.name,
      department: state.department,
      title: state.title,
      song: state.song,
      accessLevel: state.accessLevel,
      accessCss: data.accessCss,
      caption: state.caption,
    });

    // Scroll to the badge editor
    const badge = document.getElementById('badge');
    if (badge) badge.scrollIntoView({ behavior: 'smooth', block: 'center' });

    showToast('Editing your badge — make changes and submit.', 'success');
  } catch {
    showToast('Failed to load badge for editing.', 'error');
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
  state.accessLevel = DEPT_ACCESS[dept.name]?.access || pick(ACCESS_LEVELS).label;
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

document.getElementById('rebootBtn').addEventListener('click', sudoRandomize);

// Download & Print FABs
document.getElementById('downloadBtn').addEventListener('click', downloadBadge);
// Print Test button — commented out in HTML, guard against null
const printTestBtn = document.getElementById('printTestBtn');
if (printTestBtn) printTestBtn.addEventListener('click', printTest);


// ─── Public Org Chart (Employee Directory) ───────────────

// PUBLIC_DIVISIONS, KNOWN_DEPT_THEMES, BAND_DEPTS, getDivisionForDept,
// and shared orgchart state (window._publicOrgPage, etc.) — all in shared.js

// ─── Renderer System ──────────────────────────────────────
let currentRenderer = null;
let orgChartContainer = null;
let orgChartStats = null;

// ─── Renderer Interface ──────────────────────────────────
// Each view renderer (GridRenderer, DendroRenderer, ArcadeRenderer,
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
    dendro: window.DendroRenderer,
    arcade: window.ArcadeRenderer,
  };

  const renderer = renderers[mode];
  if (!renderer) {
    showToast(`View "${mode}" not available yet`, 'info');
    return;
  }

  currentRenderer = renderer;

  // Toggle body class for view-specific CSS (e.g., hiding global ticker in lobby)
  document.body.classList.remove('view-grid', 'view-reviewboard', 'view-dendro', 'view-arcade');
  document.body.classList.add('view-' + mode);

  // Save preference
  localStorage.setItem('hd-view-mode', mode);

  // Update switcher button states
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
    dendro: !!window.DendroRenderer,
    arcade: !!window.ArcadeRenderer,
  };
  const mode = available[savedMode] ? savedMode : 'grid';

  currentRenderer = { grid: window.GridRenderer, reviewboard: window.ReviewBoardRenderer, dendro: window.DendroRenderer, arcade: window.ArcadeRenderer }[mode];
  if (!currentRenderer) {
    orgChartContainer.innerHTML = '<div class="no-badges-msg">No renderer available.</div>';
    return;
  }

  // Set body class for view-specific CSS (e.g., hiding global ticker in lobby)
  document.body.classList.remove('view-grid', 'view-reviewboard', 'view-dendro', 'view-arcade');
  document.body.classList.add('view-' + mode);

  // Mark active button
  document.querySelectorAll('.view-switch-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  await currentRenderer.init(orgChartContainer, orgChartStats);
}

function buildViewSwitcher() {
  const nav = document.querySelector('.app-nav');
  if (!nav) return;

  const switcher = document.createElement('div');
  switcher.className = 'view-switcher-bar';
  switcher.innerHTML = `
    <button class="view-switch-btn active" data-mode="grid" title="Grid View (1)">
      <span class="view-switch-icon">&#9638;</span><span class="view-switch-label"> Grid</span> <kbd>1</kbd>
    </button>
    <button class="view-switch-btn" data-mode="reviewboard" title="AI Review (2)">
      <span class="view-switch-icon">&#9733;</span><span class="view-switch-label"> AI Review</span> <kbd>2</kbd>
    </button>
    <button class="view-switch-btn" data-mode="dendro" title="Tree View (3)">
      <span class="view-switch-icon">&#9776;</span><span class="view-switch-label"> Tree</span> <kbd>3</kbd>
    </button>
    <button class="view-switch-btn" data-mode="arcade" title="Arcade View (4)">
      <span class="view-switch-icon">&#127918;</span><span class="view-switch-label"> Arcade</span> <kbd>4</kbd>
    </button>
    <span class="view-switch-divider"></span>
    <button class="view-switch-btn ${animationsEnabled() ? 'anim-on' : ''}" id="animToggleBtn" title="${animationsEnabled() ? 'Animations On (A)' : 'Animations Off (A)'}">
      <span class="view-switch-icon">&#10024;</span><span class="view-switch-label"> FX</span> <kbd>A</kbd>
    </button>
  `;

  // Insert after nav
  nav.after(switcher);

  // Animation toggle handler — set initial fx-off class
  if (!animationsEnabled()) document.body.classList.add('fx-off');
  document.getElementById('animToggleBtn').addEventListener('click', toggleAnimations);

  // View switch click handlers
  switcher.querySelectorAll('.view-switch-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.mode));
  });

  // Keyboard shortcuts (only on orgchart page)
  document.addEventListener('keydown', (e) => {
    // Don't trigger in inputs/textareas
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '1') switchView('grid');
    else if (e.key === '2') switchView('reviewboard');
    else if (e.key === '3') switchView('dendro');
    else if (e.key === '4') switchView('arcade');
    else if (e.key === 'a' || e.key === 'A') toggleAnimations();
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

// Clear captive portal — tells server this device has loaded the page,
// so OS connectivity checks get "success" responses and stop nagging
fetch('/api/portal/clear', { method: 'POST' }).catch(() => {});

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
  // If user has an existing badge, show their real ID; otherwise generate a preview ID
  const storedBadge = localStorage.getItem('hd-badge');
  let existingId = null;
  if (storedBadge) {
    try {
      existingId = JSON.parse(storedBadge).employeeId;
    } catch { /* ignore corrupt data */ }
  }

  const idEl = document.getElementById('idField');
  idEl.textContent = existingId || generateEmployeeId();
  idEl.dataset.set = '1';
  if (existingId) idEl.dataset.locked = '1'; // Prevent sudo randomize from changing it

  document.getElementById('issuedField').textContent = generateIssuedDate();
  document.getElementById('issuedField').dataset.set = '1';
  applyStatus();
  document.getElementById('badgeCaption').textContent = state.caption;
  document.getElementById('badgeCaption').dataset.set = '1';

  refreshPreview();

  if (existingId) {
    showBadgeStatusBar(existingId);
  }
}
