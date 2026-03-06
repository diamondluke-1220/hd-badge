// Help Desk Badge Generator — Live Editor

let state = {
  name: 'YOUR NAME',
  photoUrl: null,
  department: DEPARTMENTS[0].name,
  title: TITLES[0],
  song: SONG_LIST[0],
};
let cropper = null;

// --- Live preview ---
function refreshPreview() {
  // Clear preview first to avoid duplicate IDs (getElementById finds clone first otherwise)
  const previewArea = document.getElementById('badgePreviewArea');
  previewArea.innerHTML = '';

  // Update the original hidden badge
  updateBadge(state);

  // Clone into preview
  const badge = document.getElementById('badge');
  const clone = badge.cloneNode(true);
  clone.id = 'badgePreviewClone';
  previewArea.appendChild(clone);
}

// --- Populate controls ---
function initControls() {
  const deptSelect = document.getElementById('deptSelect');
  DEPARTMENTS.forEach(dept => {
    const opt = document.createElement('option');
    opt.value = dept.name;
    opt.textContent = dept.name;
    deptSelect.appendChild(opt);
  });
  deptSelect.value = state.department;

  const titleSelect = document.getElementById('titleSelect');
  TITLES.forEach(title => {
    const opt = document.createElement('option');
    opt.value = title;
    opt.textContent = title;
    titleSelect.appendChild(opt);
  });
  titleSelect.value = state.title;

  const songSelect = document.getElementById('songSelect');
  SONG_LIST.forEach(song => {
    const wf = WAVEFORMS[song];
    const opt = document.createElement('option');
    opt.value = song;
    opt.textContent = `${song} (${wf.duration})`;
    songSelect.appendChild(opt);
  });
  songSelect.value = state.song;
}

// --- Event listeners ---
function initEvents() {
  // Name input
  const nameInput = document.getElementById('nameInput');
  nameInput.addEventListener('input', () => {
    const clean = nameInput.value.replace(/[^a-zA-Z\s\-']/g, '').slice(0, 20);
    nameInput.value = clean;
    state.name = clean.trim() || 'YOUR NAME';
    refreshPreview();
  });

  // Department
  document.getElementById('deptSelect').addEventListener('change', (e) => {
    state.department = e.target.value;
    refreshPreview();
  });

  // Title
  document.getElementById('titleSelect').addEventListener('change', (e) => {
    state.title = e.target.value;
    refreshPreview();
  });

  // Song
  document.getElementById('songSelect').addEventListener('change', (e) => {
    state.song = e.target.value;
    refreshPreview();
  });

  // Photo upload
  const fileInput = document.getElementById('fileInput');

  document.getElementById('uploadBtn').addEventListener('click', () => {
    fileInput.removeAttribute('capture');
    fileInput.click();
  });

  document.getElementById('cameraBtn').addEventListener('click', () => {
    fileInput.setAttribute('capture', 'user');
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => openCropModal(evt.target.result);
    reader.readAsDataURL(file);
    fileInput.value = '';
  });

  // Download
  document.getElementById('downloadBtn').addEventListener('click', downloadBadge);
}

// --- Photo crop ---
function openCropModal(imgSrc) {
  const modal = document.getElementById('cropModal');
  const img = document.getElementById('cropImage');
  img.src = imgSrc;
  modal.classList.add('active');

  if (cropper) cropper.destroy();

  img.onload = () => {
    cropper = new Cropper(img, {
      aspectRatio: 620 / 560,
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
    width: 620,
    height: 560,
    imageSmoothingQuality: 'high',
  });

  state.photoUrl = canvas.toDataURL('image/jpeg', 0.85);
  document.getElementById('photoStatus').textContent = 'Photo set';
  refreshPreview();
  cancelCrop();
}

// --- Download ---
async function downloadBadge() {
  const loading = document.getElementById('loading');
  loading.classList.add('active');

  try {
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

    const link = document.createElement('a');
    const employeeId = document.getElementById('idField').textContent;
    const safeName = state.name.toLowerCase().replace(/\s+/g, '-');
    link.download = `helpdesk-badge-${safeName}-${employeeId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('Badge export failed:', err);
    alert('Badge generation failed. Try again or take a screenshot of the preview instead!');
  } finally {
    loading.classList.remove('active');
  }
}

// --- Init on load ---
document.getElementById('idField').textContent = generateEmployeeId();
document.getElementById('idField').dataset.set = '1';
document.getElementById('waveformCaption').textContent = randomCaption();
document.getElementById('waveformCaption').dataset.set = '1';
genQR();

initControls();
initEvents();
refreshPreview();
