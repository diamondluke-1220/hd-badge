// Help Desk Badge Generator — Canva-Style Click-to-Edit

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
  { selector: '.waveform-caption', field: 'caption' },
  { selector: '.waveform-sticker', field: 'song' },
];

function attachBadgeClickHandlers() {
  const previewArea = document.getElementById('badgePreviewArea');
  if (!previewArea) return;

  CLICK_MAP.forEach(({ selector, field }) => {
    const el = previewArea.querySelector(selector);
    if (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        // Hide hint on first interaction
        const hint = document.getElementById('editHint');
        if (hint) hint.classList.add('hidden');
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

  // Close button
  const closeBtn = popover.querySelector('.popover-close');
  if (closeBtn) closeBtn.addEventListener('click', hidePopover);

  // Auto-focus text input
  const input = popover.querySelector('.popover-input');
  if (input) setTimeout(() => input.focus(), 80);
}

function hidePopover() {
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

  const rect = targetEl.getBoundingClientRect();
  const popWidth = 380;
  const viewW = window.innerWidth;
  const rightSpace = viewW - rect.right;
  const leftSpace = rect.left;

  const gap = 20;
  let left, arrowSide;
  if (rightSpace >= popWidth + 20) {
    left = rect.right + gap;
    arrowSide = 'left';
  } else if (leftSpace >= popWidth + 20) {
    left = rect.left - popWidth - gap;
    arrowSide = 'right';
  } else {
    left = Math.max(10, (viewW - popWidth) / 2);
    arrowSide = 'none';
  }

  // Vertically center on the target element, clamped to viewport
  const targetCenter = rect.top + rect.height / 2;
  const top = Math.max(10, Math.min(targetCenter - 40, window.innerHeight - 420));

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

function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

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
          placeholder="First name" maxlength="16" autocomplete="off"
          value="${esc(val)}">
        <span class="char-count" id="popNameCount">${val.length}/16</span>
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
          placeholder="or type your own" maxlength="28" autocomplete="off"
          value="${esc(customVal)}">
        <span class="char-count" id="popDeptCount">${customVal.length}/28</span>
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
      <div class="card-grid">${songCards}</div>
      <div class="popover-divider"></div>
      <div class="popover-label">Waveform Style</div>
      <div class="wave-toggle">
        <button class="wave-btn${state.waveStyle === 'barcode' ? ' active' : ''}" data-style="barcode">Barcode</button>
        <button class="wave-btn${state.waveStyle === 'sticker' ? ' active' : ''}" data-style="sticker">Sticker</button>
      </div>
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
          placeholder="or type your own" maxlength="40" autocomplete="off"
          value="${esc(customVal)}">
        <span class="char-count" id="popCaptionCount">${customVal.length}/40</span>
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
        const clean = input.value.replace(/[^a-zA-Z\s\-']/g, '').slice(0, 16);
        input.value = clean;
        counter.textContent = `${clean.length}/16`;
        counter.className = 'char-count' + (clean.length >= 16 ? ' full' : clean.length >= 13 ? ' warn' : '');
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
        const val = input.value.slice(0, 28);
        input.value = val;
        counter.textContent = `${val.length}/28`;
        counter.className = 'char-count' + (val.length >= 28 ? ' full' : val.length >= 24 ? ' warn' : '');
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
        const val = capInput.value.slice(0, 40);
        capInput.value = val;
        capCounter.textContent = `${val.length}/40`;
        capCounter.className = 'char-count' + (val.length >= 40 ? ' full' : val.length >= 35 ? ' warn' : '');
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
  loading.querySelector('.loading-text').textContent = 'Filing your paperwork...';
  loading.classList.add('active');

  try {
    const body = {
      name: state.name,
      department: state.department,
      title: state.title,
      song: state.song,
      accessLevel: state.accessLevel,
      accessCss: ACCESS_CSS[state.accessLevel] || '',
      photo: photoPublic ? (state.photoUrl || null) : null,
      photoPublic,
    };

    const resp = await fetch('/api/badge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();

    if (data.success) {
      localStorage.setItem('hd-badge', JSON.stringify({
        employeeId: data.employeeId,
        deleteToken: data.deleteToken,
      }));
      showBadgeStatusBar(data.employeeId);
      showSubmitSuccess(data.employeeId);
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
    <div class="toast-text">${message}</div>
  `;
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
  showToast(`Welcome aboard, <strong>${employeeId}</strong>!<br><small>Your badge is now on the org chart.</small>`, 'success', 5000);
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
    <button class="badge-status-remove" id="removeBadgeBtn">Remove my badge</button>
  `;

  const header = document.querySelector('.app-header');
  header.insertAdjacentElement('afterend', bar);

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

  // Reset employee ID + issued date for fresh badge feel
  const idEl = document.getElementById('idField');
  if (idEl) { delete idEl.dataset.set; }
  const issuedEl = document.getElementById('issuedField');
  if (issuedEl) { delete issuedEl.dataset.set; }
  const captionEl = document.getElementById('waveformCaption');
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

const PUBLIC_DIVISIONS = [
  { name: 'EXECUTIVE TEAM',         theme: '_exec',     css: 'div-exec' },
  { name: 'TECHNICAL FRUSTRATIONS', theme: 'IT',        css: 'div-it' },
  { name: 'OFFICE CULTURE',         theme: 'Office',    css: 'div-office' },
  { name: 'CORPORATE AFFAIRS',      theme: 'Corporate', css: 'div-corp' },
  { name: 'PUNK OPERATIONS',        theme: 'Punk',      css: 'div-punk' },
  { name: 'INDEPENDENT CONTRACTORS', theme: '_custom',  css: 'div-custom' },
];

// Known fan department names (from badge-render.js DEPARTMENTS)
const KNOWN_DEPT_THEMES = {};
DEPARTMENTS.forEach(d => { KNOWN_DEPT_THEMES[d.name] = d.theme; });

// Band member exclusive departments (not selectable by fans)
const BAND_DEPTS = new Set([
  'TICKET ESCALATION BUREAU',
  'AUDIO ENGINEERING DIVISION',
  'DEPT. OF PERCUSSIVE MAINTENANCE',
  'INFRASTRUCTURE & POWER CHORDS',
  'LOW FREQUENCY OPERATIONS',
]);

function getDivisionForDept(deptName, isBandMember) {
  if (isBandMember) return '_exec';
  const theme = KNOWN_DEPT_THEMES[deptName];
  return theme || '_custom';
}

// Shared orgchart state (accessed by renderers via window._)
window._publicOrgPage = 1;
window._publicOrgDept = '';
window._tickerStats = {};
window._tickerTotalHires = 0;

// ─── Renderer System ──────────────────────────────────────
let currentRenderer = null;
let orgChartContainer = null;
let orgChartStats = null;

async function switchView(mode) {
  // Stop replay on view switch to prevent orphaned animations
  if (replayActive) {
    stopReplay();
  }

  // Destroy current renderer
  if (currentRenderer && currentRenderer.destroy) {
    currentRenderer.destroy();
  }

  // Select new renderer
  const renderers = {
    grid: window.GridRenderer,
    win98: window.Win98Renderer,
    splitflap: window.SplitFlapRenderer,
    dendro: window.DendroRenderer,
    arcade: window.ArcadeRenderer,
  };

  const renderer = renderers[mode];
  if (!renderer) {
    showToast(`View "${mode}" not available yet`, 'info');
    return;
  }

  currentRenderer = renderer;

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
    win98: !!window.Win98Renderer,
    splitflap: !!window.SplitFlapRenderer,
    dendro: !!window.DendroRenderer,
    arcade: !!window.ArcadeRenderer,
  };
  const mode = available[savedMode] ? savedMode : 'grid';

  currentRenderer = { grid: window.GridRenderer, win98: window.Win98Renderer, splitflap: window.SplitFlapRenderer, dendro: window.DendroRenderer, arcade: window.ArcadeRenderer }[mode];
  if (!currentRenderer) {
    orgChartContainer.innerHTML = '<div class="no-badges-msg">No renderer available.</div>';
    return;
  }

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
    <button class="view-switch-btn active" data-mode="grid">
      <span class="view-switch-icon">&#9638;</span> Grid <kbd>1</kbd>
    </button>
    <button class="view-switch-btn" data-mode="splitflap">
      <span class="view-switch-icon">&#9201;</span> Lobby <kbd>2</kbd>
    </button>
    <button class="view-switch-btn" data-mode="dendro">
      <span class="view-switch-icon">&#9776;</span> Tree <kbd>3</kbd>
    </button>
    <button class="view-switch-btn" data-mode="arcade">
      <span class="view-switch-icon">&#127918;</span> Arcade <kbd>4</kbd>
    </button>
    <span class="view-switch-divider"></span>
    <button class="view-switch-btn" id="replayToggleBtn" title="Start Replay (R)">
      <span class="view-switch-icon">&#9654;</span> Replay <kbd>R</kbd>
    </button>
    <span class="view-switch-divider"></span>
    <button class="view-switch-btn ${animationsEnabled() ? 'anim-on' : ''}" id="animToggleBtn" title="${animationsEnabled() ? 'Animations On (A)' : 'Animations Off (A)'}">
      <span class="view-switch-icon">&#10024;</span> FX <kbd>A</kbd>
    </button>
  `;

  // Insert after nav
  nav.after(switcher);

  // Replay toggle handler
  document.getElementById('replayToggleBtn').addEventListener('click', toggleReplay);

  // Animation toggle handler
  document.getElementById('animToggleBtn').addEventListener('click', toggleAnimations);

  // Click handlers (skip replay — it has its own handler above)
  switcher.querySelectorAll('.view-switch-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.mode));
  });

  // Keyboard shortcuts (only on orgchart page)
  document.addEventListener('keydown', (e) => {
    // Don't trigger in inputs/textareas
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '1') switchView('grid');
    else if (e.key === '2') switchView('splitflap');
    else if (e.key === '3') switchView('dendro');
    else if (e.key === '4') switchView('arcade');
    else if (e.key === 'r' || e.key === 'R') toggleReplay();
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

// ─── Live Org Chart Visualizations ─────────────────────────

// --- SSE Connection ---
let sseSource = null;
const liveAnimationQueue = [];
let liveIsAnimating = false;

function connectSSE() {
  if (sseSource) { sseSource.close(); }
  sseSource = new EventSource('/api/badges/stream');

  sseSource.onopen = () => {
    console.log('[SSE] Connected, readyState:', sseSource.readyState);
  };

  sseSource.addEventListener('new-badge', (e) => {
    console.log('[SSE] Received new-badge event:', e.data);
    try {
      const badge = JSON.parse(e.data);
      // Pause replay scheduling while SSE events are processed
      if (replayActive) {
        clearTimeout(_replayTimer);
        _replayScheduled = false;
      }
      queueLiveAnimation(badge, false);
    } catch (err) {
      console.error('[SSE] Failed to process badge event:', err);
    }
  });

  sseSource.onerror = (e) => {
    console.log('[SSE] Connection error, state:', sseSource.readyState);
  };
}

function queueLiveAnimation(badge, isReplay = false) {
  liveAnimationQueue.push({ ...badge, _isReplay: isReplay });
  if (!liveIsAnimating) processLiveQueue();
}

function getCurrentViewMode() {
  if (currentRenderer === window.Win98Renderer) return 'win98';
  if (currentRenderer === window.SplitFlapRenderer) return 'splitflap';
  if (currentRenderer === window.DendroRenderer) return 'dendro';
  if (currentRenderer === window.ArcadeRenderer) return 'arcade';
  return 'grid';
}

async function processLiveQueue() {
  liveIsAnimating = true;
  while (liveAnimationQueue.length > 0) {
    const entry = liveAnimationQueue.shift();
    const isReplay = entry._isReplay;
    const badge = entry;

    // SSE arrival pauses replay — move replay items back and process SSE first
    if (isReplay && liveAnimationQueue.some(b => !b._isReplay)) {
      // Re-queue this replay badge at the end, skip to SSE items
      liveAnimationQueue.push(badge);
      continue;
    }

    // Track SSE badge IDs to skip in replay
    if (!isReplay) {
      _replaySSEBadgeIds.add(badge.employeeId);
    }

    updateTicker(badge);
    updateDonut(badge);

    const mode = getCurrentViewMode();
    const src = isReplay ? 'Replay' : 'SSE';
    console.log(`[${src}] Processing badge ${badge.employeeId} (${badge.name}) in ${mode} mode`);

    if (mode === 'grid') {
      await playTerminalAnimation(badge);
      const card = currentRenderer ? currentRenderer.addBadge(badge) : null;
      if (card) await playSpotlight(card);
    } else if (mode === 'win98') {
      if (currentRenderer) await currentRenderer.addBadge(badge);
    } else if (mode === 'splitflap') {
      if (currentRenderer) await currentRenderer.addBadge(badge);
    } else if (mode === 'dendro') {
      const nodeEl = currentRenderer ? currentRenderer.addBadge(badge) : null;
      if (nodeEl) await playPingTrace(nodeEl);
    } else if (mode === 'arcade') {
      if (currentRenderer) await currentRenderer.addBadge(badge);
    } else {
      const card = currentRenderer ? currentRenderer.addBadge(badge) : null;
    }

    // Inter-badge pause for replay (2 seconds between badges)
    if (isReplay && replayActive && liveAnimationQueue.length === 0) {
      // Don't wait here — scheduleNextReplay handles the 2s gap
    }
  }
  liveIsAnimating = false;

  // Resume replay if it was paused by SSE
  if (replayActive && !_replayScheduled) {
    scheduleNextReplay();
  }
}

// --- Replay Mode ---
let replayActive = false;
let _replayPool = [];
let _replayQueue = [];
let _replayTimer = null;
let _replayRefreshTimer = null;
let _replayScheduled = false;
const _replaySSEBadgeIds = new Set();

async function fetchReplayPool() {
  try {
    const resp = await fetch('/api/badges/replay');
    const data = await resp.json();
    _replayPool = data.badges || [];
    console.log(`[Replay] Fetched ${_replayPool.length} badges`);
  } catch (err) {
    console.error('[Replay] Failed to fetch badge pool:', err);
  }
}

function buildWeightedQueue(badges) {
  const now = Date.now();
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const ONE_DAY = 24 * 60 * 60 * 1000;

  const bandMembers = [];
  const weighted = [];

  for (const badge of badges) {
    // Skip badges that arrived via SSE this cycle
    if (_replaySSEBadgeIds.has(badge.employeeId)) continue;

    if (badge.isBandMember) {
      bandMembers.push(badge);
      continue;
    }

    const age = now - new Date(badge.createdAt).getTime();
    const weight = age < TWO_HOURS ? 3 : age < ONE_DAY ? 2 : 1;
    for (let i = 0; i < weight; i++) {
      weighted.push(badge);
    }
  }

  // Shuffle weighted array (Fisher-Yates)
  for (let i = weighted.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [weighted[i], weighted[j]] = [weighted[j], weighted[i]];
  }

  // Deduplicate: keep first occurrence of each badge
  const seen = new Set();
  const deduped = [];
  for (const badge of weighted) {
    if (!seen.has(badge.employeeId)) {
      seen.add(badge.employeeId);
      deduped.push(badge);
    }
  }

  // Band members always first
  return [...bandMembers, ...deduped];
}

function scheduleNextReplay() {
  if (!replayActive) return;
  _replayScheduled = true;

  _replayTimer = setTimeout(async () => {
    _replayScheduled = false;
    if (!replayActive) return;

    // Rebuild queue if empty
    if (_replayQueue.length === 0) {
      _replaySSEBadgeIds.clear(); // Reset SSE tracking for new cycle
      _replayQueue = buildWeightedQueue(_replayPool);
      if (_replayQueue.length === 0) {
        console.log('[Replay] No badges to replay');
        scheduleNextReplay(); // Try again after delay
        return;
      }
      console.log(`[Replay] New cycle: ${_replayQueue.length} badges queued`);
    }

    const badge = _replayQueue.shift();
    queueLiveAnimation(badge, true);

    // Wait for animation to finish, then schedule next
    // When animations are off, add a short delay so badges don't flash instantly
    const minDelay = animationsEnabled() ? 0 : 800;
    const waitForIdle = () => {
      if (liveIsAnimating) {
        setTimeout(waitForIdle, 200);
      } else {
        setTimeout(scheduleNextReplay, minDelay);
      }
    };
    waitForIdle();
  }, 2000);
}

async function startReplay() {
  replayActive = true;
  console.log('[Replay] Started');

  await fetchReplayPool();
  _replayQueue = buildWeightedQueue(_replayPool);

  // Start the animation cycle
  scheduleNextReplay();

  // Refresh pool every 5 minutes
  _replayRefreshTimer = setInterval(async () => {
    if (replayActive) {
      await fetchReplayPool();
      console.log('[Replay] Pool refreshed');
    }
  }, 5 * 60 * 1000);

  // Update button state
  updateReplayButton();
}

function stopReplay() {
  replayActive = false;
  _replayScheduled = false;
  clearTimeout(_replayTimer);
  clearInterval(_replayRefreshTimer);
  _replayQueue = [];
  _replaySSEBadgeIds.clear();
  console.log('[Replay] Stopped');

  // Remove any pending replay items from the animation queue
  for (let i = liveAnimationQueue.length - 1; i >= 0; i--) {
    if (liveAnimationQueue[i]._isReplay) {
      liveAnimationQueue.splice(i, 1);
    }
  }

  // Clear any in-flight terminal overlay
  const overlay = document.querySelector('.terminal-overlay');
  if (overlay) overlay.remove();

  // Clear spotlight
  const dimmed = document.querySelector('.orgchart-dimmed');
  if (dimmed) dimmed.classList.remove('orgchart-dimmed');
  const spotlight = document.querySelector('.spotlight-active');
  if (spotlight) spotlight.classList.remove('spotlight-active');

  updateReplayButton();
  removeReplayStopFAB();
}

function toggleReplay() {
  if (replayActive) {
    stopReplay();
  } else {
    startReplay();
  }
}

function updateReplayButton() {
  const btn = document.getElementById('replayToggleBtn');
  if (!btn) return;
  btn.classList.toggle('active', replayActive);
  btn.classList.toggle('replay-active', replayActive);
  btn.title = replayActive ? 'Stop Replay (R)' : 'Start Replay (R)';

  if (replayActive) showReplayStopFAB();
  else removeReplayStopFAB();
}

function showReplayStopFAB() {
  if (document.getElementById('replayStopFAB')) return;
  const fab = document.createElement('button');
  fab.id = 'replayStopFAB';
  fab.className = 'replay-stop-fab';
  fab.innerHTML = '&#9724; Stop';
  fab.title = 'Stop Replay (R)';
  fab.addEventListener('click', toggleReplay);
  document.body.appendChild(fab);
  requestAnimationFrame(() => fab.classList.add('visible'));
}

function removeReplayStopFAB() {
  const fab = document.getElementById('replayStopFAB');
  if (!fab) return;
  fab.classList.remove('visible');
  setTimeout(() => fab.remove(), 300);
}

// --- Stock Ticker Banner ---

const TICKER_QUIPS = [
  'MARKET: OPEN', 'SYNERGY LEVELS: CRITICAL', 'MORALE: MANDATORY',
  'COFFEE SUPPLY: LOW', 'TICKETS: OVERFLOWING', 'BANDWIDTH: ZERO',
  'MEETINGS: EXCESSIVE', 'UPTIME: QUESTIONABLE', 'PRODUCTIVITY: TBD',
  'MEMO STATUS: UNREAD', 'PRINTER: JAMMED', 'REPLY-ALL: DETECTED',
];

// tickerStats and tickerTotalHires now live on window._ (shared with renderers)
// Alias for readability in this file
function _getTickerStats() { return window._tickerStats; }
function _getTickerTotal() { return window._tickerTotalHires; }

function initTicker() {
  const bar = document.createElement('div');
  bar.className = 'ticker-bar';
  bar.id = 'tickerBar';
  bar.innerHTML = '<div class="ticker-track" id="tickerTrack"></div>';
  document.body.appendChild(bar);
  buildTickerContent();
}

function buildTickerContent() {
  const track = document.getElementById('tickerTrack');
  if (!track) return;

  const items = [];

  // Corporate quips
  TICKER_QUIPS.forEach(q => {
    items.push(`<span class="ticker-item"><span class="ticker-label">${q}</span></span>`);
    items.push('<span class="ticker-sep"></span>');
  });

  // Department stats
  Object.entries(window._tickerStats).forEach(([dept, count]) => {
    items.push(`<span class="ticker-item"><span class="ticker-value">${esc(dept)}</span> <span class="ticker-label">×</span> <span class="ticker-highlight">${count}</span></span>`);
    items.push('<span class="ticker-sep"></span>');
  });

  if (window._tickerTotalHires > 0) {
    items.push(`<span class="ticker-item"><span class="ticker-new">$HELP</span> <span class="ticker-up">▲ ${window._tickerTotalHires}</span> <span class="ticker-label">TOTAL HIRES</span></span>`);
    items.push('<span class="ticker-sep"></span>');
  }

  // Duplicate for seamless loop
  const content = items.join('');
  track.innerHTML = content + content;
}

function updateTicker(badge) {
  window._tickerTotalHires++;
  window._tickerStats[badge.department] = (window._tickerStats[badge.department] || 0) + 1;

  // Inject a live hire notice into the ticker track
  const track = document.getElementById('tickerTrack');
  if (!track) return;

  // Rebuild with updated stats
  buildTickerContent();
}

// --- Animation Toggle ---

function animationsEnabled() {
  const stored = localStorage.getItem('hd-animations');
  if (stored !== null) return stored === '1';
  // Default: OFF on mobile, ON on desktop
  return !window.matchMedia('(max-width: 768px)').matches;
}

function setAnimationsEnabled(enabled) {
  localStorage.setItem('hd-animations', enabled ? '1' : '0');
  const btn = document.getElementById('animToggleBtn');
  if (btn) {
    btn.classList.toggle('anim-on', enabled);
    btn.title = enabled ? 'Animations On (A)' : 'Animations Off (A)';
  }
}

function toggleAnimations() {
  setAnimationsEnabled(!animationsEnabled());
}

// --- Terminal Onboarding Animation ---

const WARNING_MESSAGES = [
  '> WARNING: Employee has opinions. Proceed with caution.',
  '> WARNING: Subject has been known to reply-all. Quarantine recommended.',
  '> WARNING: Clearance level does not include the good coffee.',
  '> WARNING: Employee claims to "know a little Excel." Threat level: SEVERE.',
  '> WARNING: Subject has strong feelings about open-plan offices.',
  '> WARNING: Badge holder may attempt to "fix" the printer. Do not engage.',
  '> WARNING: Employee insists their password is "very secure." It is not.',
  '> WARNING: Subject has 47 unread emails. And counting.',
  '> WARNING: This employee will ask you to restart your computer.',
  '> WARNING: Detected residual energy from previous meeting. Proceed carefully.',
  '> WARNING: Employee has submitted 14 VPN tickets this quarter. Alone.',
  '> WARNING: Subject keeps saying "it worked on my machine."',
  '> WARNING: Employee claims to love Mondays. Trust level: ZERO.',
];

const COMPLETE_MESSAGES = [
  '> ONBOARDING COMPLETE. Welcome to the nightmare.',
  '> ONBOARDING COMPLETE. Your ticket has been closed without resolution.',
  '> ONBOARDING COMPLETE. Please do not contact IT about this.',
  '> ONBOARDING COMPLETE. Badge activated. Expectations deactivated.',
  '> ONBOARDING COMPLETE. You are now someone else\'s problem.',
  '> ONBOARDING COMPLETE. The Wi-Fi password is "Stop Asking."',
  '> ONBOARDING COMPLETE. Your first meeting starts 5 minutes ago.',
  '> ONBOARDING COMPLETE. Please submit a ticket to celebrate.',
  '> ONBOARDING COMPLETE. Have you tried turning yourself off and on again?',
  '> ONBOARDING COMPLETE. Welcome aboard. The printer is already broken.',
  '> ONBOARDING COMPLETE. Added to 37 distribution lists. You\'re welcome.',
  '> ONBOARDING COMPLETE. Your "temporary" desk is now permanent.',
  '> ONBOARDING COMPLETE. Basically, they\'re Keanu Reeves.',
];

let _lastWarningIdx = -1;
let _lastCompleteIdx = -1;

function _pickRandom(arr, lastIdx) {
  let idx;
  do { idx = Math.floor(Math.random() * arr.length); } while (idx === lastIdx && arr.length > 1);
  return idx;
}

function buildTerminalLines() {
  const wIdx = _pickRandom(WARNING_MESSAGES, _lastWarningIdx);
  const cIdx = _pickRandom(COMPLETE_MESSAGES, _lastCompleteIdx);
  _lastWarningIdx = wIdx;
  _lastCompleteIdx = cIdx;

  return [
    { type: 'prompt', text: '> INITIATING EMPLOYEE ONBOARDING PROTOCOL...' },
    { type: 'scan' },
    { type: 'progress' },
    { type: 'data',   key: 'EMPLOYEE IDENTIFIED', field: 'name' },
    { type: 'data',   key: 'TITLE',               field: 'title' },
    { type: 'data',   key: 'DEPARTMENT',           field: 'department' },
    { type: 'data',   key: 'CLEARANCE LEVEL',      field: 'accessLevel' },
    { type: 'data',   key: 'EMPLOYEE ID',          field: 'employeeId' },
    { type: 'warn',   text: WARNING_MESSAGES[wIdx] },
    { type: 'success', text: COMPLETE_MESSAGES[cIdx] },
  ];
}

function playTerminalAnimation(badge) {
  return new Promise((resolve) => {
    if (!animationsEnabled() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      resolve();
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'terminal-overlay';
    const box = document.createElement('div');
    box.className = 'terminal-box';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('active'));

    const termLines = buildTerminalLines();
    let lineIndex = 0;
    const lineDelay = 700;

    function addCursor(parentEl) {
      const oldCursor = box.querySelector('.terminal-cursor');
      if (oldCursor) oldCursor.remove();
      const cursor = document.createElement('span');
      cursor.className = 'terminal-cursor';
      parentEl.appendChild(cursor);
    }

    // --- Badge Scan Animation ---
    function playScanPhase() {
      return new Promise((scanResolve) => {
        const scanWrap = document.createElement('div');
        scanWrap.className = 'term-scan-wrap';

        const badgeImg = document.createElement('img');
        badgeImg.src = `/api/badge/${badge.employeeId}/headshot`;
        badgeImg.className = 'term-scan-badge';
        badgeImg.alt = 'Badge';

        const scanLine = document.createElement('div');
        scanLine.className = 'term-scanline';

        scanWrap.appendChild(badgeImg);
        scanWrap.appendChild(scanLine);
        box.appendChild(scanWrap);

        // Start scan animation
        requestAnimationFrame(() => {
          scanWrap.classList.add('scanning');
        });

        // Scan takes 2.8s, then fade out
        setTimeout(() => {
          scanWrap.classList.add('scan-done');
          setTimeout(() => {
            scanWrap.remove();
            scanResolve();
          }, 400);
        }, 2800);
      });
    }

    // --- Progress Bar Animation ---
    function playProgressBar() {
      return new Promise((barResolve) => {
        const line = document.createElement('div');
        const totalBlocks = 20;
        const duration = 2500; // 2.5 seconds
        const interval = duration / totalBlocks;
        let filled = 0;

        function renderBar() {
          const filledStr = '\u2588'.repeat(filled);
          const emptyStr = '\u2591'.repeat(totalBlocks - filled);
          const pct = Math.round((filled / totalBlocks) * 100);
          line.innerHTML = `<span class="term-prompt">&gt; SCANNING BADGE... [</span><span class="term-progress">${filledStr}${emptyStr}</span><span class="term-prompt">] ${pct}%</span>`;
          addCursor(line);
        }

        renderBar();
        box.appendChild(line);

        const timer = setInterval(() => {
          filled++;
          renderBar();
          if (filled >= totalBlocks) {
            clearInterval(timer);
            setTimeout(barResolve, 400);
          }
        }, interval);
      });
    }

    function typeLine() {
      if (lineIndex >= termLines.length) {
        // Remove cursor, let the final lines breathe
        const oldCursor = box.querySelector('.terminal-cursor');
        if (oldCursor) oldCursor.remove();
        setTimeout(() => {
          overlay.classList.remove('active');
          setTimeout(() => { overlay.remove(); resolve(); }, 300);
        }, 3500);
        return;
      }

      const def = termLines[lineIndex];

      if (def.type === 'scan') {
        lineIndex++;
        playScanPhase().then(typeLine);
        return;
      }

      if (def.type === 'progress') {
        lineIndex++;
        playProgressBar().then(typeLine);
        return;
      }

      const line = document.createElement('div');

      if (def.type === 'prompt') {
        line.innerHTML = `<span class="term-prompt">${def.text}</span>`;
      } else if (def.type === 'data') {
        const val = badge[def.field] || 'CLASSIFIED';
        line.innerHTML = `<span class="term-prompt">&gt; </span><span class="term-label">${def.key}:</span> <span class="term-value">${esc(val)}</span>`;
      } else if (def.type === 'warn') {
        line.innerHTML = `<span class="term-warn">${def.text}</span>`;
      } else if (def.type === 'success') {
        line.innerHTML = `<span class="term-success">${def.text}</span>`;
      }

      box.appendChild(line);
      addCursor(line);

      lineIndex++;
      setTimeout(typeLine, lineDelay);
    }

    typeLine();
  });
}

// --- Spotlight Mode ---

function playSpotlight(card) {
  return new Promise((resolve) => {
    if (!animationsEnabled() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      resolve();
      return;
    }

    const container = document.querySelector('.public-orgchart');
    if (!container) { resolve(); return; }

    // Scroll to card if off-screen
    const rect = card.getBoundingClientRect();
    const viewH = window.innerHeight;
    if (rect.top < 0 || rect.bottom > viewH - 48) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Dim grid, highlight card
    container.classList.add('orgchart-dimmed');
    card.classList.add('spotlight-active');

    // Revert after 5 seconds
    setTimeout(() => {
      container.classList.remove('orgchart-dimmed');
      card.classList.remove('spotlight-active');
      resolve();
    }, 5000);
  });
}

// --- Dendro Ping Trace Animation ---

function playPingTrace(nodeEl) {
  return new Promise((resolve) => {
    if (!animationsEnabled() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Still mark as arrived so photo shows immediately
      const empId = nodeEl.getAttribute('data-emp-id');
      if (empId && window.DendroRenderer) window.DendroRenderer._arrived.add(empId);
      resolve();
      return;
    }

    const svg = nodeEl.closest('svg');
    if (!svg) { resolve(); return; }
    const g = svg.querySelector('g');
    if (!g) { resolve(); return; }

    const empId = nodeEl.getAttribute('data-emp-id');
    if (!empId) { resolve(); return; }

    // Find links using data attributes (tagged during _renderTree)
    // 4-level tree: Root → Division → Department → Employee
    // Chain: root→div link, div→dept link, dept→emp link (3 segments)
    const empLink = g.querySelector(`path.dendro-link[data-target-id="${empId}"]`);
    const chain = [];

    if (empLink) {
      // Walk backward: emp link → dept link → div link
      const deptKey = empLink.getAttribute('data-source-id');
      if (deptKey) {
        const deptLink = g.querySelector(`path.dendro-link[data-target-id="${CSS.escape(deptKey)}"]`);
        if (deptLink) {
          const divTheme = deptLink.getAttribute('data-source-id');
          if (divTheme) {
            const divLink = g.querySelector(`path.dendro-link[data-target-id="${CSS.escape(divTheme)}"]`);
            if (divLink) chain.push(divLink);
          }
          chain.push(deptLink);
        }
      }
      chain.push(empLink);
    }

    if (chain.length === 0) {
      // No path found — subtle glow only
      nodeEl.classList.add('dendro-arrival-glow');
      setTimeout(() => { nodeEl.classList.remove('dendro-arrival-glow'); resolve(); }, 2000);
      return;
    }

    // Get division color for arrival glow
    const divColor = empLink ? (empLink.getAttribute('stroke') || '#D4A843') : '#D4A843';

    // --- Subtle zoom toward the destination node ---
    const dendroRenderer = window.DendroRenderer;
    let origTransform = null;
    if (dendroRenderer && dendroRenderer._zoom && dendroRenderer._svg && typeof d3 !== 'undefined') {
      try {
        origTransform = d3.zoomTransform(dendroRenderer._svg.node());
        // Get destination node position
        const nodeTransform = nodeEl.getAttribute('transform');
        const nodeMatch = nodeTransform && nodeTransform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
        if (nodeMatch) {
          const nx = parseFloat(nodeMatch[1]);
          const ny = parseFloat(nodeMatch[2]);
          const zoomIn = 1.25; // 25% zoom boost
          const newScale = origTransform.k * zoomIn;
          const svgRect = dendroRenderer._svg.node().getBoundingClientRect();
          const cx = svgRect.width / 2;
          const cy = svgRect.height / 2;
          // Center on destination with zoom boost
          const tx = cx - nx * newScale;
          const ty = cy - ny * newScale;
          const targetTransform = d3.zoomIdentity.translate(tx, ty).scale(newScale);
          dendroRenderer._svg.transition().duration(1800).ease(d3.easeCubicInOut)
            .call(dendroRenderer._zoom.transform, targetTransform);
        }
      } catch { /* zoom is best-effort */ }
    }

    // Create circular-clipped badge photo that travels along the path
    const clipId = `ping-clip-${empId}`;
    const defs = svg.querySelector('defs');

    const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    clipPath.setAttribute('id', clipId);
    const clipCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    clipCircle.setAttribute('r', '14');
    clipCircle.setAttribute('cx', '14');
    clipCircle.setAttribute('cy', '14');
    clipPath.appendChild(clipCircle);
    defs.appendChild(clipPath);

    // Photo group: image + glow border circle
    const photoGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    photoGroup.classList.add('ping-photo');
    photoGroup.setAttribute('filter', 'url(#dendro-glow)');

    const photoImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    photoImg.setAttribute('href', `/api/badge/${empId}/headshot`);
    photoImg.setAttribute('width', '28');
    photoImg.setAttribute('height', '28');
    photoImg.setAttribute('x', '-14');
    photoImg.setAttribute('y', '-14');
    photoImg.setAttribute('clip-path', `url(#${clipId})`);
    photoImg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    // Adjust clipPath center to match negative offset
    clipCircle.setAttribute('cx', '0');
    clipCircle.setAttribute('cy', '0');

    const photoBorder = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    photoBorder.setAttribute('r', '14');
    photoBorder.setAttribute('fill', 'none');
    photoBorder.setAttribute('stroke', divColor);
    photoBorder.setAttribute('stroke-width', '2.5');

    photoGroup.appendChild(photoImg);
    photoGroup.appendChild(photoBorder);

    // Append to animation layer (survives _renderTree re-renders)
    const animLayer = dendroRenderer && dendroRenderer._animLayer
      ? dendroRenderer._animLayer.node()
      : g;
    animLayer.appendChild(photoGroup);

    let linkIdx = 0;

    function animateLink() {
      if (linkIdx >= chain.length) {
        // Arrival — remove traveling photo
        photoGroup.remove();
        clipPath.remove();

        // Find the LIVE DOM element (original nodeEl may be detached by re-render)
        const liveNodeEl = g.querySelector(`[data-emp-id="${empId}"]`);
        const targetNode = liveNodeEl || nodeEl;
        const isLive = !!liveNodeEl;
        const isAttached = targetNode.isConnected;
        console.log(`[PingTrace] ARRIVAL emp=${empId} — liveFound=${isLive}, isAttached=${isAttached}, targetNode=`, targetNode);

        // Mark as arrived — all future re-renders will show the photo
        if (window.DendroRenderer) {
          window.DendroRenderer._arrived.add(empId);
          console.log(`[PingTrace] _arrived now: [${[...window.DendroRenderer._arrived].join(',')}]`);
        }

        // Reveal the badge photo on the LIVE element (swap placeholder → thumbnail)
        const awaitingCircle = targetNode.querySelector('circle.dendro-awaiting');
        console.log(`[PingTrace] awaitingCircle found=${!!awaitingCircle}, empId=${empId}`);
        if (awaitingCircle) {
          const patId = awaitingCircle.getAttribute('data-pat-id');
          const patternExists = !!svg.querySelector(`#${patId}`);
          console.log(`[PingTrace] SWAP placeholder→photo: patId=${patId}, patternExists=${patternExists}`);
          awaitingCircle.setAttribute('fill', patId ? `url(#${patId})` : divColor);
          awaitingCircle.setAttribute('stroke-dasharray', 'none');
          awaitingCircle.setAttribute('stroke-opacity', '1');
          awaitingCircle.classList.remove('dendro-awaiting');
        }

        // Subtle arrival glow on the employee node (division-colored)
        const empCircle = targetNode.querySelector('circle');
        if (empCircle) {
          empCircle.setAttribute('data-orig-stroke', empCircle.getAttribute('stroke') || divColor);
          empCircle.setAttribute('data-orig-stroke-width', empCircle.getAttribute('stroke-width') || '2');
        }
        targetNode.classList.add('dendro-arrival-glow');

        // Expanding glow ring at destination
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ring.setAttribute('r', '18');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', divColor);
        ring.setAttribute('stroke-width', '2');
        ring.setAttribute('opacity', '0.8');
        ring.classList.add('ping-ring');
        targetNode.appendChild(ring);

        // Ripple effect — pulse all branches outward from this node
        playBranchRipple(g, targetNode, divColor);

        // Ease zoom back to original after arrival
        if (origTransform && dendroRenderer && dendroRenderer._zoom && dendroRenderer._svg) {
          try {
            dendroRenderer._svg.transition().duration(2000).ease(d3.easeCubicInOut)
              .call(dendroRenderer._zoom.transform, origTransform);
          } catch { /* best-effort */ }
        }

        setTimeout(() => {
          targetNode.classList.remove('dendro-arrival-glow');
          ring.remove();
        }, 2500);

        // --- DEBUG: verify photo persists after arrival effects complete ---
        setTimeout(() => {
          const verifyNode = g.querySelector(`[data-emp-id="${empId}"]`);
          if (verifyNode) {
            const circle = verifyNode.querySelector('circle');
            const fill = circle ? circle.getAttribute('fill') : 'NO_CIRCLE';
            const isPhoto = fill && fill.startsWith('url(#dendro-thumb-');
            const isPlaceholder = fill === '#1C1C22';
            const hasAwaitingClass = circle ? circle.classList.contains('dendro-awaiting') : false;
            console.log(`[PingTrace] POST-ARRIVAL VERIFY (3s) emp=${empId}: fill=${fill}, isPhoto=${isPhoto}, isPlaceholder=${isPlaceholder}, hasAwaiting=${hasAwaitingClass}, nodeAttached=${verifyNode.isConnected}`);
            if (!isPhoto) {
              console.error(`[PingTrace] ❌ PHOTO LOST for emp=${empId}! fill=${fill}. Check for unexpected re-render.`);
            }
          } else {
            console.error(`[PingTrace] ❌ NODE GONE for emp=${empId}! Node not found in DOM 3s after arrival.`);
          }
        }, 3000);

        setTimeout(resolve, 2500);
        return;
      }

      const path = chain[linkIdx];
      const len = path.getTotalLength();
      // Scale duration by link type: root→div slower (dramatic), dept→emp faster
      const linkType = path.getAttribute('data-link-type') || '';
      const duration = linkType === 'root-div' ? 2200 : linkType === 'div-dept' ? 1800 : 1500;
      const startTime = performance.now();

      // Thicken the active branch segment during travel
      const origOpacity = path.getAttribute('stroke-opacity') || '0.3';
      const origWidth = path.getAttribute('stroke-width') || '1.5';
      path.setAttribute('stroke-opacity', '0.9');
      path.setAttribute('stroke-width', parseFloat(origWidth) + 2);

      function step(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        const pt = path.getPointAtLength(eased * len);
        photoGroup.setAttribute('transform', `translate(${pt.x},${pt.y})`);

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          setTimeout(() => {
            path.setAttribute('stroke-opacity', origOpacity);
            path.setAttribute('stroke-width', origWidth);
          }, 300);
          linkIdx++;
          animateLink();
        }
      }

      requestAnimationFrame(step);
    }

    animateLink();
  });
}

// --- Branch Ripple Effect ---
// Organic multi-wave ripple radiating from a source node

function playBranchRipple(g, sourceNode, color) {
  // Get source position from the node's transform
  const sourceTransform = sourceNode.getAttribute('transform');
  let sx = 0, sy = 0;
  if (sourceTransform) {
    const match = sourceTransform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
    if (match) { sx = parseFloat(match[1]); sy = parseFloat(match[2]); }
  }

  const allLinks = Array.from(g.querySelectorAll('path.dendro-link'));
  if (allLinks.length === 0) return;

  // Classify links: root→division vs division→employee
  const rootLinks = [];
  const empLinks = [];
  const linkMeta = [];

  allLinks.forEach(link => {
    try {
      const len = link.getTotalLength();
      const mid = link.getPointAtLength(len / 2);
      const dx = mid.x - sx;
      const dy = mid.y - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const sourceId = link.getAttribute('data-source-id') || '';
      const isRootLink = sourceId === 'root';
      const meta = { link, dist, isRootLink };
      linkMeta.push(meta);
      if (isRootLink) rootLinks.push(meta);
      else empLinks.push(meta);
    } catch { /* skip */ }
  });

  const maxDist = Math.max(...linkMeta.map(m => m.dist), 1);

  // --- Wave 1: Initial outward ripple with randomized jitter ---
  linkMeta.forEach(({ link, dist, isRootLink }) => {
    const baseDelay = (dist / maxDist) * 1200;
    const jitter = (Math.random() - 0.3) * 400; // asymmetric jitter, slightly forward-biased
    const delay = Math.max(0, baseDelay + jitter);
    const origOpacity = link.getAttribute('stroke-opacity') || '0.25';
    const origWidth = link.getAttribute('stroke-width') || '1.5';
    const peakOpacity = isRootLink ? '1' : '0.8';
    const widthBoost = isRootLink ? 2.5 : 1;

    setTimeout(() => {
      link.setAttribute('stroke-opacity', peakOpacity);
      link.setAttribute('stroke-width', parseFloat(origWidth) + widthBoost);
      setTimeout(() => {
        link.setAttribute('stroke-opacity', origOpacity);
        link.setAttribute('stroke-width', origWidth);
      }, isRootLink ? 800 : 500);
    }, delay);
  });

  // --- Wave 2: Secondary echo ripple (reverse direction, softer) ---
  setTimeout(() => {
    linkMeta.forEach(({ link, dist }) => {
      const reverseDelay = ((maxDist - dist) / maxDist) * 1000;
      const jitter = Math.random() * 300;
      const origOpacity = link.getAttribute('stroke-opacity') || '0.25';

      setTimeout(() => {
        link.setAttribute('stroke-opacity', '0.55');
        setTimeout(() => {
          link.setAttribute('stroke-opacity', origOpacity);
        }, 400);
      }, reverseDelay + jitter);
    });
  }, 1400);

  // --- Root→Division links: extra pulsing glow effect ---
  rootLinks.forEach(({ link }, i) => {
    const origOpacity = link.getAttribute('stroke-opacity') || '0.6';
    const origWidth = link.getAttribute('stroke-width') || '2';

    // Staggered triple-pulse on trunk links
    [0, 600, 1200].forEach((offset, pulseIdx) => {
      const delay = 200 + (i * 150) + offset;
      setTimeout(() => {
        const intensity = 1 - (pulseIdx * 0.2); // decreasing intensity
        link.setAttribute('stroke-opacity', String(Math.min(1, intensity)));
        link.setAttribute('stroke-width', String(parseFloat(origWidth) + 3 - pulseIdx));
        setTimeout(() => {
          link.setAttribute('stroke-opacity', origOpacity);
          link.setAttribute('stroke-width', origWidth);
        }, 350);
      }, delay);
    });
  });

  // --- Scattered sparkle: random individual links flash independently ---
  const sparkleCount = Math.min(allLinks.length, Math.floor(allLinks.length * 0.4));
  const shuffled = [...linkMeta].sort(() => Math.random() - 0.5).slice(0, sparkleCount);
  shuffled.forEach(({ link }, i) => {
    const delay = 2200 + Math.random() * 1200;
    const origOpacity = link.getAttribute('stroke-opacity') || '0.25';

    setTimeout(() => {
      link.setAttribute('stroke-opacity', '0.7');
      setTimeout(() => {
        link.setAttribute('stroke-opacity', origOpacity);
      }, 250 + Math.random() * 200);
    }, delay);
  });
}

// --- Stats Panel (Donut + Newest Hire + Sparkline) ---

function loadD3() {
  return new Promise((resolve) => {
    if (typeof d3 !== 'undefined') { resolve(true); return; }
    const script = document.createElement('script');
    script.src = '/lib/d3.min.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

const DIVISION_COLORS = {
  '_exec':    '#4ADE80',
  'IT':       '#2E7DFF',
  'Office':   '#14B8A6',
  'Corporate':'#A855F7',
  'Punk':     '#EF4444',
  '_custom':  '#6B7280',
};

let donutCounts = {}; // { divisionTheme: count }
let donutTotal = 0;
let _donutAnimated = false;
let _currentNewestHire = null;
let _currentSparkline = [];

function initStatsPanel(stats) {
  // Build initial donut counts
  donutTotal = stats.visible || 0;
  donutCounts = {};

  if (stats.byDepartment) {
    Object.entries(stats.byDepartment).forEach(([dept, count]) => {
      let theme;
      if (BAND_DEPTS.has(dept)) {
        theme = '_exec';
      } else {
        theme = KNOWN_DEPT_THEMES[dept] || '_custom';
      }
      donutCounts[theme] = (donutCounts[theme] || 0) + count;
    });
  }

  _currentNewestHire = stats.newestHire || null;
  _currentSparkline = stats.sparkline || [];
  _donutAnimated = false;

  renderStatsPanel();
}

// --- Relative time helper ---
function timeAgo(dateStr) {
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  const weeks = Math.floor(days / 7);
  return weeks + 'w ago';
}

function renderStatsPanel() {
  const existing = document.querySelector('.stats-panel');
  if (existing) existing.remove();

  const header = document.querySelector('.org-header');
  if (!header) return;

  const panel = document.createElement('div');
  panel.className = 'stats-panel';

  // --- Donut section ---
  const segments = [];
  let offset = 0;
  const legend = [];

  PUBLIC_DIVISIONS.forEach(div => {
    const count = donutCounts[div.theme] || 0;
    if (count === 0) return;
    const pct = donutTotal > 0 ? (count / donutTotal) * 100 : 0;
    const color = DIVISION_COLORS[div.theme] || '#6B7280';
    segments.push(`${color} ${offset}% ${offset + pct}%`);
    legend.push({ name: div.name, color, count });
    offset += pct;
  });

  if (offset < 100 && segments.length > 0) {
    const lastSeg = segments[segments.length - 1];
    segments[segments.length - 1] = lastSeg.replace(/[\d.]+%$/, '100%');
  }

  const gradient = segments.length > 0
    ? `conic-gradient(${segments.join(', ')})`
    : 'conic-gradient(#3A3A44 0% 100%)';

  const animClass = !_donutAnimated ? ' donut-entrance' : '';

  // --- Newest hire section ---
  let newestHtml = '';
  if (_currentNewestHire) {
    newestHtml = `
      <div class="stats-card newest-hire-card">
        <div class="stats-card-label">LATEST HIRE</div>
        <div class="newest-hire-name">${esc(_currentNewestHire.name)}</div>
        <div class="newest-hire-dept">${esc(_currentNewestHire.department)}</div>
        <div class="newest-hire-time">${timeAgo(_currentNewestHire.createdAt)}</div>
      </div>
    `;
  } else {
    newestHtml = `
      <div class="stats-card newest-hire-card newest-hire-empty">
        <div class="stats-card-label">LATEST HIRE</div>
        <div class="newest-hire-name">Awaiting applicants...</div>
      </div>
    `;
  }

  // --- Sparkline section ---
  const hasSparkData = _currentSparkline.length > 0;
  const sparkHtml = `
    <div class="stats-card sparkline-card">
      <div class="stats-card-label">HIRE ACTIVITY</div>
      <div class="sparkline-container" id="sparklineChart">
        ${hasSparkData ? '' : '<div class="sparkline-empty">No recent activity</div>'}
      </div>
    </div>
  `;

  panel.innerHTML = `
    <div class="stats-donut-section${animClass}">
      <div class="orgchart-donut" style="background: ${gradient}" data-total="${donutTotal}"></div>
      <div class="donut-legend">
        ${legend.map(l => `<div class="donut-legend-item"><span class="donut-legend-dot" style="background:${l.color}"></span><span class="donut-legend-name">${esc(l.name)}</span> <span class="donut-legend-count">${l.count}</span></div>`).join('')}
      </div>
    </div>
    ${newestHtml}
    ${sparkHtml}
  `;

  header.after(panel);
  _donutAnimated = true;

  // Animate count-up in donut center
  const donutEl = panel.querySelector('.orgchart-donut');
  if (donutEl && donutTotal > 0) {
    animateCountUp(donutEl, donutTotal);
  }

  // Render sparkline with D3 (lazy-load if needed)
  if (hasSparkData) {
    loadD3().then(ok => { if (ok) renderSparkline(_currentSparkline); });
  }
}

function animateCountUp(el, target) {
  const duration = 800;
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = Math.round(eased * target);
    el.setAttribute('data-total', current);
    if (progress < 1) requestAnimationFrame(step);
  }
  el.setAttribute('data-total', '0');
  requestAnimationFrame(step);
}

function renderSparkline(data) {
  const container = document.getElementById('sparklineChart');
  if (!container) return;

  const width = 200;
  const height = 52;
  const margin = { top: 4, right: 4, bottom: 4, left: 4 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  // Fill in missing days in the 30-day range
  const today = new Date();
  const points = [];
  const dataMap = {};
  data.forEach(d => { dataMap[d.date] = d.count; });

  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().split('T')[0];
    points.push({ date: key, count: dataMap[key] || 0 });
  }

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([0, points.length - 1]).range([0, w]);
  const y = d3.scaleLinear().domain([0, d3.max(points, d => d.count) || 1]).range([h, 0]);

  const area = d3.area()
    .x((d, i) => x(i))
    .y0(h)
    .y1(d => y(d.count))
    .curve(d3.curveMonotoneX);

  const line = d3.line()
    .x((d, i) => x(i))
    .y(d => y(d.count))
    .curve(d3.curveMonotoneX);

  // Gradient fill
  const defs = svg.append('defs');
  const grad = defs.append('linearGradient')
    .attr('id', 'sparkGrad')
    .attr('x1', '0').attr('y1', '0')
    .attr('x2', '0').attr('y2', '1');
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#2E7DFF').attr('stop-opacity', 0.4);
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#2E7DFF').attr('stop-opacity', 0.05);

  svg.append('path')
    .datum(points)
    .attr('d', area)
    .attr('fill', 'url(#sparkGrad)');

  svg.append('path')
    .datum(points)
    .attr('d', line)
    .attr('fill', 'none')
    .attr('stroke', '#2E7DFF')
    .attr('stroke-width', 1.5);

  // Dot on latest point
  const last = points[points.length - 1];
  if (last.count > 0) {
    svg.append('circle')
      .attr('cx', x(points.length - 1))
      .attr('cy', y(last.count))
      .attr('r', 3)
      .attr('fill', '#2E7DFF')
      .attr('class', 'sparkline-dot');
  }
}

// Backward-compat wrapper
function initDonut(stats) {
  initStatsPanel(stats);
}

function updateDonut(badge) {
  const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
  donutCounts[divTheme] = (donutCounts[divTheme] || 0) + 1;
  donutTotal++;
  // Update newest hire to this badge
  _currentNewestHire = { name: badge.name, department: badge.department, createdAt: new Date().toISOString() };
  // Add to sparkline (today)
  const todayKey = new Date().toISOString().split('T')[0];
  const existing = _currentSparkline.find(d => d.date === todayKey);
  if (existing) { existing.count++; } else { _currentSparkline.push({ date: todayKey, count: 1 }); }
  renderStatsPanel();
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
  document.getElementById('idField').textContent = generateEmployeeId();
  document.getElementById('idField').dataset.set = '1';
  document.getElementById('issuedField').textContent = generateIssuedDate();
  document.getElementById('issuedField').dataset.set = '1';
  applyStatus();
  document.getElementById('waveformCaption').textContent = state.caption;
  document.getElementById('waveformCaption').dataset.set = '1';

  refreshPreview();

  // Show status bar if already in directory
  const storedBadge = localStorage.getItem('hd-badge');
  if (storedBadge) {
    try {
      const { employeeId } = JSON.parse(storedBadge);
      showBadgeStatusBar(employeeId);
    } catch { /* ignore corrupt data */ }
  }
}
