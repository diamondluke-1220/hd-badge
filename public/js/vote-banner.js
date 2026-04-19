// BOM 2026 "Vote for Help Desk" top banner.
// Gated server-side via /api/site-config (env + date window).
// Dismissible, resets daily via localStorage.

(function () {
  'use strict';

  const DISMISS_KEY = 'hd_bom_dismissed_date';
  const BOM_URL = 'https://madisonmagazine.secondstreetapp.com/Best-of-Madison-2026/gallery?category=5791127&group=535264';

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function dismissedToday() {
    try {
      return localStorage.getItem(DISMISS_KEY) === todayISO();
    } catch {
      return false;
    }
  }

  function markDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, todayISO());
    } catch {
      // Private mode or storage disabled — banner stays hidden for the session anyway
    }
  }

  function render() {
    const banner = document.createElement('div');
    banner.className = 'vote-banner';
    banner.setAttribute('role', 'complementary');
    banner.setAttribute('aria-label', 'Best of Madison 2026 voting');

    const logo = document.createElement('img');
    logo.className = 'vote-banner-logo';
    logo.src = '/img/bom2026-vote-us.png';
    logo.alt = 'Best of Madison 2026 — Vote for Us';
    logo.width = 76;
    logo.height = 76;
    logo.decoding = 'async';
    logo.loading = 'lazy';
    banner.appendChild(logo);

    const msg = document.createElement('div');
    msg.className = 'vote-banner-msg';
    const headline = document.createElement('strong');
    headline.className = 'vote-banner-headline';
    headline.textContent = 'Help Desk is a top-6 finalist for Best Local Band.';
    const sub = document.createElement('span');
    sub.className = 'vote-banner-sub';
    sub.textContent = 'Best of Madison 2026 voting is open — cast your ballot.';
    msg.appendChild(headline);
    msg.appendChild(document.createTextNode(' '));
    msg.appendChild(sub);

    const actions = document.createElement('div');
    actions.className = 'vote-banner-actions';

    const cta = document.createElement('a');
    cta.className = 'vote-banner-cta';
    cta.href = BOM_URL;
    cta.target = '_blank';
    cta.rel = 'noopener noreferrer';
    cta.textContent = 'Cast Your Vote';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'vote-banner-close';
    close.setAttribute('aria-label', 'Dismiss vote banner');
    close.textContent = '\u00D7';
    close.addEventListener('click', function () {
      markDismissed();
      banner.classList.add('dismissing');
      setTimeout(function () {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
      }, 200);
    });

    actions.appendChild(cta);
    actions.appendChild(close);

    banner.appendChild(msg);
    banner.appendChild(actions);

    const header = document.querySelector('header.app-header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(banner, header.nextSibling);
    } else {
      document.body.insertBefore(banner, document.body.firstChild);
    }

    requestAnimationFrame(function () {
      banner.classList.add('visible');
    });
  }

  function boot() {
    if (dismissedToday()) return;
    fetch('/api/site-config', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (cfg) {
        if (cfg && cfg.voteBannerActive && !dismissedToday()) {
          render();
        }
      })
      .catch(function () {
        // Silent fail — no banner is better than a broken banner
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
