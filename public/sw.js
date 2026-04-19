// Help Desk Badge Generator — Service Worker
// Cache-first for static shell, network-only for API + badge images.
// Bump CACHE version when shell changes to force a refresh on install.

const CACHE = 'hdbadge-shell-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/app.css',
  '/css/badge.css',
  '/css/flap-base.css',
  '/css/reviewboard.css',
  '/css/arcade.css',
  '/css/rack.css',
  '/js/app.js',
  '/js/badge-render.js',
  '/js/shared.js',
  '/js/boot-sequence.js',
  '/js/vote-banner.js',
  '/img/hd-logo.png',
  '/img/hdbadge-logo.png',
  '/img/hdbadge-logo-192.png',
  '/img/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {
        // Ignore individual asset failures — install shouldn't fail just
        // because a non-critical file is missing during dev.
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Cache-first with background revalidation (stale-while-revalidate).
// Skips API, SSE, and dynamically-generated badge images — those need
// network freshness or are already cached server-side.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/events')) return;
  if (url.pathname.includes('/sse')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
        }
        return resp;
      }).catch(() => cached); // network failure — serve stale cache if any
      return cached || fetched;
    })
  );
});
