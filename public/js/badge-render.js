// Badge rendering engine — extracted from badge-template-corporate.html
// Handles: waveform rendering, department→access mapping, field population

const DEPT_ACCESS = {
  'TICKET ESCALATION BUREAU':          { access: 'ALL ACCESS',                css: 'all-access' },
  'RIFF SHREDDING DEPARTMENT':          { access: 'ALL ACCESS',                css: 'all-access' },
  'LOW FREQUENCY OPERATIONS':           { access: 'ALL ACCESS',                css: 'all-access' },
  'PRINTER JAMS':                       { access: 'PAPER JAM CLEARANCE',       css: 'paper-jam' },
  'PASSWORD RESET SERVICES':            { access: 'RESET AUTHORIZED',          css: 'reset' },
  'BLUE SCREEN RESPONSE TEAM':          { access: 'BSOD CERTIFIED',            css: 'bsod' },
  'WATERCOOLER SERVICES':               { access: 'GOSSIP CHANNEL OPEN',       css: 'gossip' },
  'MEETING RECOVERY DEPT.':             { access: 'STILL ON MUTE',             css: 'on-mute' },
  'MANDATORY FUN COMMITTEE':            { access: 'FUN IS MANDATORY',          css: 'fun' },
  'MORALE SUPPRESSION UNIT':            { access: 'SOUL EXTRACTION AUTHORIZED', css: 'morale' },
  'TEAM BUILDING AVOIDANCE':            { access: 'TRUST FALL EXEMPT',         css: 'trust-fall' },
  'MOSH PIT HR':                        { access: 'PIT APPROVED',              css: 'pit' },
  'ENTERPRISE GUITAR WORSHIP':           { access: 'SHRED CERTIFIED',           css: 'shred' },
  'STAGE DIVE RISK ASSESSMENT':         { access: 'STAGE DIVE AUTHORIZED',           css: 'dive' },
  'DEPT. OF DOWNSTROKE GOVERNANCE':     { access: 'ALL ACCESS',                css: 'all-access' },
  'DIVISION OF TEMPO ENFORCEMENT':        { access: 'ALL ACCESS',                css: 'all-access' },
};

// All access level options — label + CSS class
// Note: ALL ACCESS is reserved for band members only (enforced server-side too)
const ACCESS_LEVELS = [
  { label: 'ALL ACCESS',                css: 'all-access' },
  { label: 'PAPER JAM CLEARANCE',       css: 'paper-jam' },
  { label: 'RESET AUTHORIZED',          css: 'reset' },
  { label: 'BSOD CERTIFIED',            css: 'bsod' },
  { label: 'GOSSIP CHANNEL OPEN',       css: 'gossip' },
  { label: 'OVERTIME EXEMPT',           css: 'overtime' },
  { label: 'STILL ON MUTE',            css: 'on-mute' },
  { label: 'FUN IS MANDATORY',          css: 'fun' },
  { label: 'SOUL EXTRACTION AUTHORIZED', css: 'morale' },
  { label: 'TRUST FALL EXEMPT',         css: 'trust-fall' },
  { label: 'PIT APPROVED',              css: 'pit' },
  { label: 'SHRED CERTIFIED',           css: 'shred' },
  { label: 'STAGE DIVE AUTHORIZED',           css: 'dive' },
  { label: 'FAST TRACK PROMOTED',       css: 'fast-track' },
  { label: 'CORNER OFFICE APPROVED',    css: 'corner-office' },
  { label: 'THOUGHT LEADER CERTIFIED',  css: 'thought-leader' },
  { label: 'PROMOTED BEYOND CAPABILITY', css: 'peter-principle' },
  { label: 'ABOVE YOUR PAY GRADE',      css: 'above-pay' },
  { label: 'PENDING REVIEW',            css: 'pending' },
];

// Lookup: access label → css class
const ACCESS_CSS = {};
ACCESS_LEVELS.forEach(a => { ACCESS_CSS[a.label] = a.css; });

// Fan-selectable access levels — excludes ALL ACCESS (band-only, server enforces).
// Use this anywhere fans pick or are shown access levels (popover, randomizers).
const FAN_ACCESS_LEVELS = ACCESS_LEVELS.filter(a => a.label !== 'ALL ACCESS');

// Real waveform data — extracted from actual Help Desk MP3s (RMS amplitude, 60 bars)
const WAVEFORMS = {
  'PLEASE HOLD':        { duration: '2:49', data: [0.877,0.891,0.874,0.765,0.801,0.829,0.844,0.876,0.95,0.918,0.868,0.919,0.9,0.954,0.914,0.941,0.898,0.887,0.892,0.854,0.52,0.92,0.952,0.971,0.87,0.932,0.928,1.0,0.879,0.98,0.95,0.909,0.909,0.886,0.903,0.966,0.915,0.86,0.829,0.803,0.836,0.81,0.795,0.836,0.96,0.904,0.923,0.912,0.93,0.893,0.923,0.934,0.969,0.861,0.834,0.847,0.794,0.459,0.282,0.063] },
  'RED ALERT':          { duration: '3:20', data: [0.095,0.034,0.235,0.481,0.788,0.76,0.746,0.744,0.781,0.326,0.624,0.696,0.72,0.784,0.794,0.822,0.899,0.929,0.906,0.905,0.918,0.885,0.544,0.684,0.671,0.888,0.944,0.923,0.756,0.826,0.854,0.911,0.862,0.867,0.794,0.786,0.805,0.803,0.809,0.785,0.812,0.568,0.859,0.822,0.903,0.868,0.872,0.909,1.0,0.95,0.934,0.972,0.993,0.674,0.956,0.752,0.785,0.667,0.014,0.0] },
  'BOSS LEVEL':         { duration: '2:37', data: [0.821,0.722,0.756,0.749,0.843,0.861,0.826,0.87,0.838,0.865,0.846,0.899,0.941,0.821,0.883,0.937,0.941,0.925,0.932,0.907,0.968,0.804,0.823,0.869,0.843,0.89,0.872,0.954,0.909,0.896,0.92,0.932,0.922,0.907,0.963,0.915,0.862,0.932,0.941,0.9,0.904,0.942,0.952,0.941,1.0,0.654,0.3,0.294,0.736,0.948,0.902,0.855,0.788,0.834,0.959,0.93,0.593,0.379,0.137,0.021] },
  'TAKING LIBERTIES':   { duration: '2:15', data: [0.18,0.553,0.672,0.672,0.681,0.796,0.83,0.796,0.82,0.81,0.424,1.0,0.761,0.998,0.97,0.995,0.84,0.872,0.937,0.982,0.974,0.94,0.944,0.965,0.997,0.876,0.82,0.873,0.904,0.893,0.913,0.859,0.932,0.983,0.993,0.884,0.84,0.836,0.823,0.897,0.918,0.932,0.938,0.929,0.889,0.892,0.88,0.93,0.892,0.91,0.962,0.944,0.818,0.811,0.554,0.351,0.07,0.013,0.0,0.0] },
  'THE MEMO':           { duration: '0:38', data: [0.319,0.286,0.264,0.451,0.743,0.737,0.744,0.798,0.873,0.86,0.821,0.82,0.835,0.897,0.829,0.868,0.815,0.846,0.762,0.896,0.853,0.835,0.833,0.856,0.841,0.837,0.806,0.838,0.844,0.826,0.878,0.871,0.807,0.813,0.809,0.825,0.768,0.773,0.779,0.734,0.835,0.74,0.805,0.753,0.806,0.862,0.869,1.0,0.979,0.929,0.911,0.93,0.926,0.782,0.726,0.704,0.774,0.286,0.086,0.026] },
  'SALLY IN ACCOUNTING':{ duration: '3:20', data: [0.466,0.701,0.793,0.783,0.814,0.788,0.795,0.79,0.74,0.804,0.802,0.799,0.909,0.757,0.79,0.828,0.785,0.794,0.87,0.826,0.82,0.86,0.8,0.871,0.775,0.803,0.777,0.788,0.739,0.811,0.926,0.829,0.849,0.789,0.836,0.774,0.776,0.902,0.87,0.837,0.865,0.808,0.936,0.77,0.775,0.813,0.74,0.759,0.806,0.87,0.782,0.782,0.772,0.731,0.717,1.0,0.991,0.84,0.853,0.073] },
  'HOSTILE TAKEOVER':   { duration: '1:53', data: [0.427,0.238,0.496,0.718,0.74,0.799,0.838,0.826,0.813,0.81,0.825,0.825,0.837,0.831,0.897,0.777,0.85,0.823,0.817,0.8,0.826,0.904,0.831,0.88,0.72,0.705,0.688,0.588,0.762,0.787,0.761,0.729,0.762,0.751,0.738,0.776,0.824,0.736,0.815,0.835,0.821,0.778,0.806,0.675,0.817,0.686,0.815,0.839,0.815,0.849,0.797,0.873,1.0,0.988,0.728,0.525,0.027,0.002,0.001,0.0] },
  'PATCH 22':           { duration: '2:32', data: [0.687,0.678,0.654,0.677,0.694,0.677,0.718,0.722,0.772,0.762,0.785,0.718,0.741,0.814,0.768,0.856,0.739,0.773,0.727,1.0,0.821,0.704,0.693,0.675,0.697,0.689,0.674,0.702,0.847,0.824,0.808,0.796,0.72,0.778,0.698,0.792,0.694,0.771,0.663,0.76,0.806,0.781,0.769,0.745,0.812,0.779,0.784,0.773,0.687,0.699,0.7,0.658,0.483,0.513,0.473,0.264,0.164,0.079,0.048,0.062] },
  'ALTERNATIVE FAX':    { duration: '3:52', data: [0.128,0.119,0.329,0.454,0.644,0.773,0.77,0.761,0.776,0.824,0.811,0.841,0.899,0.895,0.934,0.796,0.835,0.849,0.977,0.757,0.772,0.814,0.82,0.852,0.888,0.923,0.81,0.813,0.788,1.0,0.866,0.562,0.694,0.735,0.724,0.731,0.69,0.842,0.907,0.803,0.819,0.875,0.79,0.836,0.8,0.947,0.846,0.819,0.886,0.847,0.84,0.841,0.739,0.676,0.724,0.416,0.183,0.051,0.019,0.0] },
  '7 CENTS':            { duration: '2:53', data: [0.37,0.761,0.844,0.818,0.846,0.789,0.792,0.881,0.85,0.87,0.847,0.851,0.99,0.898,0.977,0.95,0.907,1.0,0.978,0.888,0.821,0.795,0.848,0.821,0.883,0.901,0.851,0.871,0.833,0.867,0.92,0.991,0.982,0.962,0.906,0.984,0.951,0.87,0.884,0.772,0.885,0.804,0.91,0.87,0.854,0.889,0.906,0.925,0.832,0.781,0.921,0.863,0.919,0.949,0.953,0.862,0.841,0.608,0.437,0.142] },
  'THE CONSULTANT':     { duration: '3:36', data: [0.837,0.853,0.832,0.868,0.801,0.933,0.937,0.921,0.94,0.924,0.964,0.808,0.84,0.852,0.849,0.802,0.827,0.677,0.726,0.747,0.758,0.753,0.824,0.885,0.84,0.83,0.91,0.943,0.867,0.838,0.857,0.822,0.892,0.859,0.857,0.872,0.809,0.767,0.263,0.656,0.772,0.84,0.828,0.82,0.931,0.93,0.942,0.954,1.0,0.941,0.938,0.943,0.876,0.659,0.77,0.862,0.705,0.579,0.002,0.001] },
  'UN-PTO':             { duration: '2:28', data: [0.807,0.788,0.774,0.749,0.838,0.786,0.803,0.873,0.895,0.898,0.932,0.847,0.887,0.973,0.946,0.866,0.977,0.977,0.88,0.814,0.948,0.975,0.88,0.733,0.716,0.726,0.758,0.842,0.774,0.755,0.806,0.914,0.897,0.883,0.97,0.913,0.939,0.971,0.936,0.93,0.996,0.929,0.841,0.952,1.0,0.924,0.814,0.982,0.974,0.851,0.759,0.959,0.971,0.99,0.75,0.734,0.741,0.775,0.522,0.378] },
  'PWNING N00BS':       { duration: '1:30', data: [0.399,0.405,0.802,0.817,0.772,0.773,0.749,0.816,0.839,0.791,0.788,0.941,0.822,0.919,0.881,0.852,0.96,0.852,0.92,0.927,0.961,0.94,0.938,0.907,0.895,0.957,0.809,0.683,0.851,0.789,0.839,0.897,0.82,0.899,0.926,0.862,0.907,0.843,0.888,0.897,0.879,0.936,0.878,0.938,0.91,0.917,0.961,0.869,0.893,0.892,0.914,1.0,0.932,0.956,0.948,0.915,0.939,0.894,0.593,0.056] },
  'RUMOR MILL':         { duration: '3:29', data: [0.207,0.194,0.202,0.782,0.781,0.772,0.841,0.825,0.81,0.6,0.701,0.872,0.874,0.714,0.915,0.903,0.935,0.965,0.957,0.736,0.906,0.902,0.97,0.976,0.984,0.984,0.964,0.915,0.888,0.892,0.901,0.959,0.667,0.812,0.81,0.863,0.946,0.86,1.0,0.917,0.924,0.953,0.949,0.92,0.879,0.927,0.972,0.896,0.882,0.91,0.973,0.896,0.9,0.771,0.019,0.157,0.159,0.16,0.223,0.166] },
};

const SONG_LIST = Object.keys(WAVEFORMS);

const WAVEFORM_CAPTIONS = [
  'SCAN TO FILE COMPLAINT',
  'IF FOUND RETURN TO MOSH PIT',
  'DO NOT COPY (TORRENTING IS OK)',
  'WARRANTY VOID IF REMOVED',
  'NOT RESPONSIBLE FOR LOST EARDRUMS',
  'THIS BADGE IS YOUR RECEIPT',
  'BADGE EXPIRES WHEN THE MUSIC STOPS',
  'UNAUTHORIZED MOSHING VOIDS WARRANTY',
  'HAVE YOU TRIED TURNING IT OFF AND BACK ON',
  'STAGE DIVE TO SCAN',
  'IT\'S NOT THE NETWORK',
  'WHAT\'S THE WIFI PASSWORD?',
  'TAKING BACK MONDAYS',
];

// Fan departments — defined in shared.js (DEPARTMENTS)

// Fan titles (17 options)
const TITLES = [
  'Senior Reboot Specialist',
  'Level 1 Support',
  'Junior Ticket Closer',
  'Bandwidth Hog',
  'Ctrl+Z Specialist',
  'Full Stack Complainer',
  'Calendar Tetris Champion',
  'Desk Plant Supervisor',
  'Office Supply Hoarder',
  'Temp, 3rd Year',
  'Dept. of Redundancy Dept.',
  'Scrum Master of Disaster',
  'Director of First Impressions',
  'Mosh Pit Compliance Officer',
  'On-Call Since Monday',
  'Air Guitar Tech',
  'HUH?! Coordinator',
];

// Generate employee ID: HD-XXXXX (5 random digits)
function generateEmployeeId() {
  const num = String(Math.floor(10000 + Math.random() * 90000));
  return `HD-${num}`;
}

// Status indicator — always green (ACTIVE)
function applyStatus() {
  const dot = document.getElementById('statusDot');
  if (dot) {
    dot.style.color = '#22C55E';
    dot.style.textShadow = '0 0 8px rgba(34,197,94,0.4)';
  }
}

// Generate issued date: ISSUED MM.DD.YY
function generateIssuedDate() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(2);
  return `ISSUED ${mm}.${dd}.${yy}`;
}

function randomCaption() {
  return WAVEFORM_CAPTIONS[Math.floor(Math.random() * WAVEFORM_CAPTIONS.length)];
}

function renderWaveform(songKey, waveStyle) {
  const wf = WAVEFORMS[songKey] || WAVEFORMS['PLEASE HOLD'];
  const container = document.getElementById('waveform');
  if (!container) return;
  container.innerHTML = '';
  const maxH = 220;
  const style = waveStyle || 'barcode';

  // Apply style class to sticker wrapper
  const sticker = container.closest('.waveform-sticker');
  if (sticker) {
    sticker.classList.remove('barcode-style', 'sticker-style');
    sticker.classList.add(style + '-style');
  }

  wf.data.forEach(amp => {
    const bar = document.createElement('div');
    bar.className = 'wbar';
    const h = Math.max(6, Math.round(amp * maxH));
    bar.style.height = h + 'px';
    container.appendChild(bar);
  });
  document.getElementById('waveformSong').textContent = songKey;
  document.getElementById('waveformDuration').textContent = wf.duration;
}

// Auto-shrink text to fit within its container (prevents ellipsis clipping)
function autoShrink(el, minFontSize) {
  if (!el) return;
  const min = minFontSize || 32;
  // Reset to CSS default
  el.style.fontSize = '';
  const parent = el.parentElement;
  if (!parent) return;
  const maxWidth = parent.clientWidth;
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > maxWidth && size > min) {
    size -= 2;
    el.style.fontSize = size + 'px';
  }
}

// Update all badge fields
function updateBadge(data) {
  const { name, department, title, song, photoUrl, waveStyle } = data;

  // Name
  const nameEl = document.getElementById('nameField');
  if (nameEl) {
    nameEl.textContent = (name || 'YOUR NAME').toUpperCase();
    autoShrink(nameEl, 32);
  }

  // Department
  const deptEl = document.getElementById('deptField');
  if (deptEl) {
    deptEl.textContent = department || 'SELECT DEPARTMENT';
    autoShrink(deptEl, 28);
  }

  // Title
  const titleEl = document.getElementById('titleField');
  if (titleEl) {
    titleEl.textContent = title || 'Select Title';
    autoShrink(titleEl, 28);
  }

  // Employee ID + Issued date (locked IDs are never regenerated).
  // Prefer the server-assigned ID from state when present — this is what
  // makes the preview reflect HD-XXXXX after submit. Without this, the
  // duplicate-id problem (#badge source vs #badgePreviewClone) prevents
  // the submit handler's getElementById() from reaching the source element.
  const idEl = document.getElementById('idField');
  if (idEl) {
    if (data._editingBadgeId) {
      idEl.textContent = data._editingBadgeId;
      idEl.dataset.set = '1';
      idEl.dataset.locked = '1';
    } else if (!idEl.dataset.set && !idEl.dataset.locked) {
      idEl.textContent = generateEmployeeId();
      idEl.dataset.set = '1';
    }
  }
  const issuedEl = document.getElementById('issuedField');
  if (issuedEl && !issuedEl.dataset.set) {
    issuedEl.textContent = generateIssuedDate();
    issuedEl.dataset.set = '1';
  }

  // Access badge — uses explicit accessLevel from state
  const accessLabel = (data.accessLevel || 'PENDING REVIEW').toUpperCase();
  const accessCss = ACCESS_CSS[accessLabel] || 'custom';
  const ab = document.getElementById('accessBadge');
  if (ab) {
    ab.textContent = accessLabel;
    ab.className = 'access-badge ' + accessCss;
  }

  // Waveform
  if (song) {
    renderWaveform(song, waveStyle);
    const captionEl = document.getElementById('badgeCaption');
    if (captionEl && data.caption) {
      captionEl.textContent = data.caption;
    } else if (captionEl && !captionEl.dataset.set) {
      captionEl.textContent = randomCaption();
      captionEl.dataset.set = '1';
    }
  }

  // Photo
  const frame = document.querySelector('.photo-frame');
  const placeholder = document.querySelector('.photo-placeholder-text');
  if (photoUrl && frame) {
    let img = frame.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      frame.appendChild(img);
    }
    img.src = photoUrl;
    frame.classList.add('has-photo');
    if (placeholder) placeholder.style.display = 'none';
  }
}
