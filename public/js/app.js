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
  reanchorPopover();
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
          placeholder="or type your own" maxlength="24" autocomplete="off"
          value="${esc(customVal)}">
        <span class="char-count" id="popDeptCount">${customVal.length}/24</span>
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
        const val = input.value.slice(0, 24);
        input.value = val;
        counter.textContent = `${val.length}/24`;
        counter.className = 'char-count' + (val.length >= 24 ? ' full' : val.length >= 20 ? ' warn' : '');
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

async function captureBadgePng() {
  const captureDiv = document.getElementById('badgeCapture');
  captureDiv.style.left = '0';
  captureDiv.style.top = '0';
  captureDiv.style.position = 'fixed';
  captureDiv.style.zIndex = '-1';
  captureDiv.style.opacity = '0.01';

  await new Promise(r => setTimeout(r, 500));

  const badge = document.getElementById('badge');
  const canvas = await html2canvas(badge, {
    width: 1276,
    height: 2026,
    scale: 1,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#FFFFFF',
    logging: false,
  });

  captureDiv.style.left = '-9999px';
  captureDiv.style.position = 'absolute';
  captureDiv.style.zIndex = '';
  captureDiv.style.opacity = '';

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
    // Capture full badge PNG (with photo)
    const badgePng = await captureBadgePng();

    // Capture no-photo variant if needed
    let badgePngNoPhoto = null;
    if (state.photoUrl && !photoPublic) {
      const savedPhoto = state.photoUrl;
      state.photoUrl = null;
      refreshPreview();
      updateBadge(state);
      await new Promise(r => setTimeout(r, 100));
      badgePngNoPhoto = await captureBadgePng();
      state.photoUrl = savedPhoto;
      refreshPreview();
    }

    const body = {
      name: state.name,
      department: state.department,
      title: state.title,
      song: state.song,
      accessLevel: state.accessLevel,
      accessCss: ACCESS_CSS[state.accessLevel] || '',
      photo: state.photoUrl || null,
      badgePng,
      badgePngNoPhoto,
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
  // Destroy current renderer
  if (currentRenderer && currentRenderer.destroy) {
    currentRenderer.destroy();
  }

  // Select new renderer
  const renderers = {
    grid: window.GridRenderer,
    win98: window.Win98Renderer,
    network: window.NetworkRenderer,
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

  // Initialize new renderer
  if (orgChartContainer && orgChartStats) {
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
    network: !!window.NetworkRenderer,
  };
  const mode = available[savedMode] ? savedMode : 'grid';

  currentRenderer = { grid: window.GridRenderer, win98: window.Win98Renderer, network: window.NetworkRenderer }[mode];
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
    <button class="view-switch-btn" data-mode="win98">
      <span class="view-switch-icon">&#128187;</span> Desktop <kbd>2</kbd>
    </button>
    <button class="view-switch-btn" data-mode="network">
      <span class="view-switch-icon">&#9832;</span> Network <kbd>3</kbd>
    </button>
  `;

  // Insert after nav
  nav.after(switcher);

  // Click handlers
  switcher.querySelectorAll('.view-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.mode));
  });

  // Keyboard shortcuts (only on orgchart page)
  document.addEventListener('keydown', (e) => {
    // Don't trigger in inputs/textareas
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '1') switchView('grid');
    else if (e.key === '2') switchView('win98');
    else if (e.key === '3') switchView('network');
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
      queueLiveAnimation(badge);
    } catch (err) {
      console.error('[SSE] Failed to process badge event:', err);
    }
  });

  sseSource.onerror = (e) => {
    console.log('[SSE] Connection error, state:', sseSource.readyState);
  };
}

function queueLiveAnimation(badge) {
  liveAnimationQueue.push(badge);
  if (!liveIsAnimating) processLiveQueue();
}

async function processLiveQueue() {
  liveIsAnimating = true;
  while (liveAnimationQueue.length > 0) {
    const badge = liveAnimationQueue.shift();
    updateTicker(badge);
    updateDonut(badge);
    await playTerminalAnimation(badge);
    const card = currentRenderer ? currentRenderer.addBadge(badge) : null;
    if (card) await playSpotlight(card);
  }
  liveIsAnimating = false;
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

// --- Terminal Onboarding Animation ---

const TERMINAL_LINES = [
  { type: 'prompt', text: '> INITIATING EMPLOYEE ONBOARDING PROTOCOL...' },
  { type: 'prompt', text: '> SCANNING BADGE... [████████████████] 100%' },
  { type: 'data',   key: 'EMPLOYEE IDENTIFIED', field: 'name' },
  { type: 'data',   key: 'TITLE',               field: 'title' },
  { type: 'data',   key: 'DEPARTMENT',           field: 'department' },
  { type: 'data',   key: 'CLEARANCE LEVEL',      field: 'accessLevel' },
  { type: 'data',   key: 'EMPLOYEE ID',          field: 'employeeId' },
  { type: 'warn',   text: '> WARNING: Employee has opinions. Proceed with caution.' },
  { type: 'success', text: '> ONBOARDING COMPLETE. Welcome to the nightmare.' },
];

function playTerminalAnimation(badge) {
  return new Promise((resolve) => {
    // Check reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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

    let lineIndex = 0;
    const lineDelay = 700; // ms per line — 9 lines × 700ms ≈ 6.3s total

    function typeLine() {
      if (lineIndex >= TERMINAL_LINES.length) {
        // Done — auto-dismiss after brief pause
        setTimeout(() => {
          overlay.classList.remove('active');
          setTimeout(() => { overlay.remove(); resolve(); }, 300);
        }, 800);
        return;
      }

      const def = TERMINAL_LINES[lineIndex];
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

      // Remove old cursor, add new one
      const oldCursor = box.querySelector('.terminal-cursor');
      if (oldCursor) oldCursor.remove();
      const cursor = document.createElement('span');
      cursor.className = 'terminal-cursor';
      line.appendChild(cursor);

      lineIndex++;
      setTimeout(typeLine, lineDelay);
    }

    typeLine();
  });
}

// --- Spotlight Mode ---

function playSpotlight(card) {
  return new Promise((resolve) => {
    // Check reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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

// --- Donut Chart ---

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

function initDonut(stats) {
  // Build initial counts from stats
  donutTotal = stats.visible || 0;
  donutCounts = {};

  // We need to map department counts to division counts
  if (stats.byDepartment) {
    Object.entries(stats.byDepartment).forEach(([dept, count]) => {
      // Band depts → exec, known depts → theme, unknown → custom
      let theme;
      if (BAND_DEPTS.has(dept)) {
        theme = '_exec';
      } else {
        theme = KNOWN_DEPT_THEMES[dept] || '_custom';
      }
      donutCounts[theme] = (donutCounts[theme] || 0) + count;
    });
  }

  renderDonut();
}

function renderDonut() {
  // Remove existing donut
  const existing = document.querySelector('.orgchart-donut-wrap');
  if (existing) existing.remove();

  const header = document.querySelector('.org-header');
  if (!header) return;

  const wrap = document.createElement('div');
  wrap.className = 'orgchart-donut-wrap';

  // Build conic-gradient stops
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

  // Fill remainder if rounding leaves a gap
  if (offset < 100 && segments.length > 0) {
    const lastSeg = segments[segments.length - 1];
    segments[segments.length - 1] = lastSeg.replace(/[\d.]+%$/, '100%');
  }

  const gradient = segments.length > 0
    ? `conic-gradient(${segments.join(', ')})`
    : 'conic-gradient(#3A3A44 0% 100%)';

  wrap.innerHTML = `
    <div class="orgchart-donut" style="background: ${gradient}" data-total="${donutTotal}"></div>
    <div class="donut-legend">
      ${legend.map(l => `<div class="donut-legend-item"><span class="donut-legend-dot" style="background:${l.color}"></span>${l.count}</div>`).join('')}
    </div>
  `;

  header.after(wrap);
}

function updateDonut(badge) {
  const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
  donutCounts[divTheme] = (donutCounts[divTheme] || 0) + 1;
  donutTotal++;
  renderDonut();
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
