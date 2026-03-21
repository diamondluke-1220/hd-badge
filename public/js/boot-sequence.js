// ─── Corporate Boot Sequence (first visit only) ─────────
// Shows a fake intranet boot animation on first visit.
// Skips on return visits (localStorage), reduced motion, or tap/keypress.

(function bootSequence() {
  'use strict';

  // Skip conditions
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const seen = localStorage.getItem('hdbadge-boot-seen');
  if (seen) return;

  const LINES = [
    { text: 'HELP DESK INC. INTERNAL NETWORK v4.2.0', cls: 'boot-ok' },
    { text: 'AUTHENTICATING GUEST ACCESS...', cls: 'boot-label' },
    { text: 'CLEARANCE LEVEL: ', value: 'VISITOR', cls: 'boot-warn' },
    { text: 'STATUS: ', value: 'APPROVED', cls: 'boot-ok' },
    { text: 'WELCOME, NEW HIRE.', cls: 'boot-value' },
  ];

  const DELAYS = [0, 400, 900, 1400, 1800];
  const FADE_AT = 2200;
  const TOTAL = 2500;

  // Build DOM
  const overlay = document.createElement('div');
  overlay.className = 'boot-overlay';

  LINES.forEach(() => {
    const line = document.createElement('div');
    line.className = 'boot-line';
    overlay.appendChild(line);
  });

  const skip = document.createElement('div');
  skip.className = 'boot-skip';
  skip.textContent = 'TAP TO SKIP';
  overlay.appendChild(skip);

  document.body.appendChild(overlay);

  // Activate
  requestAnimationFrame(() => {
    overlay.classList.add('active');
  });

  let dismissed = false;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    localStorage.setItem('hdbadge-boot-seen', String(Date.now()));
    overlay.classList.add('fade-out');
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 350);
    document.removeEventListener('keydown', dismiss);
    document.removeEventListener('click', dismiss);
    document.removeEventListener('touchstart', dismiss);
  }

  // Reveal lines with staggered timing
  const lineEls = overlay.querySelectorAll('.boot-line');
  const cursor = document.createElement('span');
  cursor.className = 'boot-cursor';

  LINES.forEach((def, i) => {
    setTimeout(() => {
      if (dismissed) return;
      const el = lineEls[i];

      // Build line content
      let html = '<span class="boot-label">&gt; </span>';
      if (def.value) {
        html += `<span class="boot-label">${def.text}</span><span class="${def.cls}">${def.value}</span>`;
      } else {
        html += `<span class="${def.cls}">${def.text}</span>`;
      }
      el.innerHTML = html;
      el.classList.add('visible');

      // Move cursor to current line
      const prevCursor = overlay.querySelector('.boot-cursor');
      if (prevCursor) prevCursor.remove();
      el.appendChild(cursor.cloneNode());
    }, DELAYS[i]);
  });

  // Show skip hint after first line
  setTimeout(() => {
    if (!dismissed) skip.classList.add('visible');
  }, 600);

  // Enable dismiss handlers after first line
  setTimeout(() => {
    document.addEventListener('keydown', dismiss);
    document.addEventListener('click', dismiss);
    document.addEventListener('touchstart', dismiss);
  }, 600);

  // Auto-dismiss
  setTimeout(() => {
    if (!dismissed) dismiss();
  }, TOTAL);
})();
