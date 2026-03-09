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

    // Show join prompt after successful download
    showJoinPrompt();
  } catch (err) {
    console.error('Badge export failed:', err);
    alert('Badge generation failed. Try again or take a screenshot of the preview instead!');
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
      alert(data.error || 'Submission failed. Please try again.');
    }
  } catch (err) {
    console.error('Badge submission failed:', err);
    alert('Submission failed. Please try again.');
  } finally {
    loading.querySelector('.loading-text').textContent = 'Generating your badge...';
    loading.classList.remove('active');
  }
}

function showSubmitSuccess(employeeId) {
  const toast = document.createElement('div');
  toast.className = 'submit-toast';
  toast.innerHTML = `
    <div class="submit-toast-icon">&#10003;</div>
    <div class="submit-toast-text">
      Welcome aboard, <strong>${employeeId}</strong>!<br>
      <small>Your badge is now on the org chart.</small>
    </div>
  `;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('visible'));
  });

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
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
      alert('Your badge has been shredded.');
    } else {
      alert(data.error || 'Failed to remove badge.');
    }
  } catch {
    alert('Failed to remove badge. Please try again.');
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
    alert('Print test generation failed. Try downloading the badge and printing manually.');
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

let publicOrgPage = 1;
let publicOrgDept = '';

async function renderPublicOrgChart() {
  const container = document.createElement('div');
  container.className = 'public-orgchart';
  document.body.appendChild(container);

  // Fetch stats
  let stats;
  try {
    const resp = await fetch('/api/orgchart/stats');
    stats = await resp.json();
  } catch {
    container.innerHTML = '<div class="no-badges-msg">Failed to load directory.</div>';
    return;
  }

  // Org chart header
  container.innerHTML = `
    <div class="org-header">
      <div class="org-header-title">Help Desk Inc.</div>
      <div class="org-header-sub">Employee Directory &bull; ${stats.visible} on payroll</div>
    </div>
    <div class="dept-filter-bar" id="deptFilterBar"></div>
    <div class="active-dept-heading" id="activeDeptHeading"></div>
    <div id="publicBadgeContent"></div>
    <div id="loadMoreArea"></div>
  `;

  // Department filter tabs — exclude band-exclusive depts
  const filterBar = document.getElementById('deptFilterBar');
  const allBtn = document.createElement('button');
  allBtn.className = 'dept-filter-btn active';
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => {
    publicOrgDept = '';
    publicOrgPage = 1;
    filterBar.querySelectorAll('.dept-filter-btn').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    updateDeptHeading('', stats);
    loadPublicBadges(true);
  });
  filterBar.appendChild(allBtn);

  Object.keys(stats.byDepartment).forEach(dept => {
    // Skip band member exclusive departments from filter
    if (BAND_DEPTS.has(dept)) return;

    const count = stats.byDepartment[dept];
    const btn = document.createElement('button');
    btn.className = 'dept-filter-btn';
    btn.innerHTML = `${esc(dept)} <span class="dept-count">${count}</span>`;
    btn.addEventListener('click', () => {
      publicOrgDept = dept;
      publicOrgPage = 1;
      filterBar.querySelectorAll('.dept-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateDeptHeading(dept, stats);
      loadPublicBadges(true);
    });
    filterBar.appendChild(btn);
  });

  // Load first page
  publicOrgPage = 1;
  updateDeptHeading('', stats);
  await loadPublicBadges(true);
}

function updateDeptHeading(dept, stats) {
  const heading = document.getElementById('activeDeptHeading');
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
}

async function loadPublicBadges(replace) {
  const content = document.getElementById('publicBadgeContent');
  const loadMoreArea = document.getElementById('loadMoreArea');

  if (replace) content.innerHTML = '';
  loadMoreArea.innerHTML = '';

  let url = `/api/orgchart?page=${publicOrgPage}&limit=48`;
  if (publicOrgDept) url += `&department=${encodeURIComponent(publicOrgDept)}`;

  let data;
  try {
    const resp = await fetch(url);
    data = await resp.json();
  } catch {
    content.innerHTML += '<div class="no-badges-msg">Failed to load badges.</div>';
    return;
  }

  if (data.badges.length === 0 && publicOrgPage === 1) {
    content.innerHTML = '<div class="no-badges-msg">No employees found. The hiring freeze continues.</div>';
    return;
  }

  // When showing all departments, group by division
  if (!publicOrgDept) {
    // Sort badges into divisions
    const byDivision = {};
    PUBLIC_DIVISIONS.forEach(d => { byDivision[d.theme] = []; });

    data.badges.forEach(badge => {
      const divTheme = getDivisionForDept(badge.department, badge.isBandMember);
      if (!byDivision[divTheme]) byDivision[divTheme] = [];
      byDivision[divTheme].push(badge);
    });

    // Render each division that has badges
    PUBLIC_DIVISIONS.forEach(div => {
      const badges = byDivision[div.theme];
      if (!badges || badges.length === 0) return;

      const section = createDivisionSection(div, badges);
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
    data.badges.forEach(badge => grid.appendChild(createBadgeCard(badge)));
  }

  // Load more button
  if (publicOrgPage < data.pages) {
    const btn = document.createElement('button');
    btn.className = 'load-more-btn';
    btn.textContent = 'Load More Employees';
    btn.addEventListener('click', () => {
      publicOrgPage++;
      loadPublicBadges(false);
    });
    loadMoreArea.appendChild(btn);
  }
}

function createDivisionSection(div, badges) {
  const section = document.createElement('div');
  section.className = 'division-section';

  // Division header card
  const header = document.createElement('div');
  header.className = `division-header ${div.css}`;
  header.innerHTML = `
    <div class="division-header-name">${esc(div.name)}</div>
    <div class="division-header-count">${badges.length} member${badges.length !== 1 ? 's' : ''}</div>
  `;
  section.appendChild(header);

  // Connector line
  const connector = document.createElement('div');
  connector.className = 'division-connector';
  section.appendChild(connector);

  // Single grid for all badges in this division
  const grid = document.createElement('div');
  grid.className = 'badge-grid';
  badges.forEach(badge => grid.appendChild(createBadgeCard(badge)));
  section.appendChild(grid);

  return section;
}

function createBadgeCard(badge) {
  const card = document.createElement('div');
  card.className = 'badge-grid-card' + (badge.isBandMember ? ' band-member' : '');
  card.innerHTML = `
    <img class="badge-grid-img" src="/api/badge/${esc(badge.employeeId)}/thumb" alt="${esc(badge.name)}" loading="lazy">
    <div class="badge-grid-info">
      <div class="badge-grid-name">${esc(badge.name)}</div>
      <div class="badge-grid-title">${esc(badge.title)}</div>
    </div>
  `;
  card.addEventListener('click', () => showBadgeDetail(badge.employeeId, badge.name));
  return card;
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
  renderPublicOrgChart();
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
