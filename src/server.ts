// Help Desk Badge Generator — Server
// Hono + bun:sqlite + static file serving

import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { bearerAuth } from 'hono/bearer-auth';
import { getConnInfo } from 'hono/bun';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import sharp from 'sharp';
import { initDb, closeDb, listAllBadgeIds } from './db';
import { log } from './logger';
import { initDemo } from './demo';
import { initPresentation } from './presentation';
import { registerPublicRoutes } from './routes/public';
import { registerAdminRoutes } from './routes/admin';

// ─── Playwright Browser Pool ─────────────────────────────

let _browser: import('playwright').Browser | null = null;
let _browserLaunching: Promise<import('playwright').Browser> | null = null;
let _warmPage: import('playwright').Page | null = null;
let _warmPageReady = false;

async function getBrowser() {
  if (_browser?.isConnected()) return _browser;
  if (_browserLaunching) return _browserLaunching;
  _browser = null;
  _warmPage = null;
  _warmPageReady = false;
  _browserLaunching = (async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    _browser = browser;
    _browserLaunching = null;
    return browser;
  })();
  return _browserLaunching;
}

/** Get a warm page with the badge template already loaded */
async function getWarmPage(): Promise<import('playwright').Page> {
  const serverPort = Number(process.env.PORT) || 3000;

  if (_warmPage && !_warmPage.isClosed()) {
    return _warmPage;
  }

  const browser = await getBrowser();
  _warmPage = await browser.newPage({ viewport: { width: 1400, height: 2200 } });
  await _warmPage.goto(`http://localhost:${serverPort}/`, { waitUntil: 'domcontentloaded' });
  await _warmPage.waitForSelector('#badge', { timeout: 5000 });

  // Hide all page UI so only the badge element is captured
  await _warmPage.evaluate(() => {
    document.querySelectorAll('body > *:not(#badgeCapture)').forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });
    const capture = document.getElementById('badgeCapture');
    if (capture) {
      capture.style.position = 'static';
      capture.style.left = '0';
    }
  });

  _warmPageReady = true;
  return _warmPage;
}

async function closeBrowser() {
  if (_warmPage && !_warmPage.isClosed()) {
    await _warmPage.close().catch(() => {});
    _warmPage = null;
    _warmPageReady = false;
  }
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

// ─── Config ──────────────────────────────────────────────

const DATA_DIR = './data';
const PHOTOS_DIR = join(DATA_DIR, 'photos');
const BADGES_DIR = join(DATA_DIR, 'badges');
const THUMBS_DIR = join(DATA_DIR, 'thumbs');
const HEADSHOTS_DIR = join(DATA_DIR, 'headshots');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const THUMB_WIDTH = 320;
const HEADSHOT_WIDTH = 200;

// Ensure data directories exist
mkdirSync(PHOTOS_DIR, { recursive: true });
mkdirSync(BADGES_DIR, { recursive: true });
mkdirSync(THUMBS_DIR, { recursive: true });
mkdirSync(HEADSHOTS_DIR, { recursive: true });

// Initialize database
initDb(join(DATA_DIR, 'badges.db'));

// Sweep orphaned files on startup (badges deleted but files left behind)
{
  const knownIds = listAllBadgeIds();
  const dirs = [
    { path: BADGES_DIR, ext: '.png' },
    { path: PHOTOS_DIR, ext: '.jpg' },
    { path: THUMBS_DIR, ext: '.png' },
    { path: HEADSHOTS_DIR, ext: '.jpg' },
  ];
  let orphanCount = 0;
  for (const { path: dir, ext } of dirs) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(ext)) continue;
      // Extract ID: "HD-12345.png" or "HD-12345-nophoto.png" → "HD-12345"
      const id = file.replace(/-nophoto/, '').replace(ext, '');
      if (!knownIds.has(id)) {
        try { unlinkSync(join(dir, file)); orphanCount++; } catch { /* ignore */ }
      }
    }
  }
  if (orphanCount > 0) {
    console.log(`🧹 Cleaned ${orphanCount} orphaned file${orphanCount !== 1 ? 's' : ''} from data directories`);
  }
}

// Initialize demo engine (broadcast function set after SSE setup below)
let _broadcastFn: typeof broadcastNewBadge;

const app = new Hono();

// ─── Security ───────────────────────────────────────────

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FIELD_LENGTH = 200;
const FIELD_LIMITS: Record<string, number> = {
  name: 18,
  department: 31,
  title: 30,
  song: 25,
  accessLevel: 28,
  accessCss: 30,
  caption: 45,
};

// Security headers on all responses
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
});

// Body size limit on POST requests
app.use('*', async (c, next) => {
  if (c.req.method === 'POST' || c.req.method === 'PUT') {
    const contentLength = parseInt(c.req.header('content-length') || '0', 10);
    if (contentLength > MAX_BODY_SIZE) {
      return c.json({ success: false, error: 'Request too large. Maximum 10 MB.' }, 413);
    }
  }
  await next();
});

// ─── Helpers ─────────────────────────────────────────────

function getClientIp(c: any): string {
  if (process.env.TRUST_PROXY === '1') {
    return c.req.header('cf-connecting-ip')
      || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown';
  }
  try {
    const info = getConnInfo(c);
    return info.remote.address || 'unknown';
  } catch {
    return 'unknown';
  }
}

function clampField(val: string, field?: string): string {
  const limit = (field && FIELD_LIMITS[field]) || MAX_FIELD_LENGTH;
  return val.slice(0, limit);
}

/** Strip data URL prefix and decode base64 to Buffer */
function decodeBase64Image(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

// ─── Admin Auth ─────────────────────────────────────────

const adminFailures = new Map<string, { count: number; firstAttempt: number; lastAttempt: number }>();

/** Check if an IP is localhost (handles IPv4, IPv6, and IPv4-mapped IPv6) */
function isLocalhost(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

// Restrict /admin HTML page to localhost in local mode
app.use('/admin', async (c, next) => {
  if (process.env.ADMIN_LOCAL_ONLY === '1') {
    const ip = getClientIp(c);
    if (!isLocalhost(ip)) {
      return c.text('Not found', 404);
    }
  }
  await next();
});

app.use('/api/admin/*', async (c, next) => {
  if (!ADMIN_TOKEN) {
    return c.json({ success: false, error: 'Admin panel disabled. Set ADMIN_TOKEN env var.' }, 401);
  }

  if (process.env.ADMIN_LOCAL_ONLY === '1') {
    const ip = getClientIp(c);
    if (!isLocalhost(ip)) {
      return c.json({ success: false, error: 'Admin access restricted to localhost.' }, 403);
    }
  }

  const ip = getClientIp(c);
  const record = adminFailures.get(ip);
  if (record && record.count >= 5) {
    // Locked out for 15 min from the LAST failure (not first)
    if (Date.now() - record.lastAttempt < 15 * 60 * 1000) {
      return c.json({ success: false, error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);
    }
    // Lockout expired — reset
    adminFailures.delete(ip);
  }

  await next();
});

// Bearer auth middleware (timing-safe token comparison)
app.use('/api/admin/*', async (c, next) => {
  if (!ADMIN_TOKEN) return next();
  try {
    await bearerAuth({ token: ADMIN_TOKEN })(c, next);
    // Successful auth — clear failure record
    const ip = getClientIp(c);
    if (adminFailures.has(ip)) adminFailures.delete(ip);
  } catch (e: any) {
    const ip = getClientIp(c);
    const now = Date.now();
    const record = adminFailures.get(ip) || { count: 0, firstAttempt: now, lastAttempt: 0 };
    record.count++;
    record.lastAttempt = now;
    if (!record.firstAttempt) record.firstAttempt = now;
    adminFailures.set(ip, record);
    log('warn', 'auth', `Failed admin auth from ${ip} (attempt ${record.count})`);
    return c.json({ success: false, error: 'Unauthorized. Invalid or missing admin token.' }, 401);
  }
});

// Clean up stale admin failure records every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, record] of adminFailures) {
    if (record.lastAttempt < cutoff) adminFailures.delete(key);
  }
}, 30 * 60 * 1000);

// ─── Playwright Badge Render ─────────────────────────────

// Cache placeholder photo as data URL at startup (never changes)
let _placeholderDataUrl: string | null = null;
{
  const placeholderPath = join('public', 'placeholder-photo.png');
  if (existsSync(placeholderPath)) {
    const buf = readFileSync(placeholderPath);
    _placeholderDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  }
}

/** Server-side badge render via Playwright + Sharp corner clipping */
async function renderBadgePlaywright(badge: any, options?: { withPhoto?: boolean; print?: boolean }): Promise<Buffer> {
  const page = await getWarmPage();

  const id = badge.employee_id;
  const photoPath = join(PHOTOS_DIR, `${id}.jpg`);
  const includePhoto = (options?.withPhoto !== false) && badge.has_photo && existsSync(photoPath);
  let photoDataUrl: string | null = null;
  if (includePhoto) {
    const photoBuffer = await Bun.file(photoPath).arrayBuffer();
    photoDataUrl = `data:image/jpeg;base64,${Buffer.from(photoBuffer).toString('base64')}`;
  } else {
    photoDataUrl = _placeholderDataUrl;
  }

  await page.evaluate(({ badge, photoDataUrl, isPrint }) => {
    const previewArea = document.getElementById('badgePreviewArea');
    if (previewArea) previewArea.innerHTML = '';

    const idEl = document.getElementById('idField');
    if (idEl) { idEl.textContent = badge.employee_id; idEl.dataset.set = '1'; }
    const issuedEl = document.getElementById('issuedField');
    if (issuedEl) {
      const d = new Date(badge.created_at);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(2);
      issuedEl.textContent = `ISSUED ${mm}.${dd}.${yy}`;
      issuedEl.dataset.set = '1';
    }

    const frame = document.querySelector('#badge .photo-frame') as HTMLElement;
    if (frame) {
      const staleImg = frame.querySelector('img');
      if (staleImg) staleImg.remove();
      frame.classList.remove('has-photo');
      const placeholder = frame.querySelector('.photo-placeholder-text') as HTMLElement;
      if (placeholder) placeholder.style.display = '';
    }

    // Reset print-mode overrides from previous render
    const el = document.getElementById('badge');
    if (el) {
      el.style.borderRadius = '';
      el.style.boxShadow = '';
    }
    document.body.style.background = '';

    if (isPrint && el) {
      el.style.borderRadius = '0';
      el.style.boxShadow = 'none';
      document.body.style.background = 'white';
    }

    (window as any).updateBadge({
      name: badge.name,
      department: badge.department,
      title: badge.title,
      song: badge.song,
      accessLevel: badge.access_level,
      accessCss: badge.access_css,
      photoUrl: photoDataUrl,
      waveStyle: badge.wave_style || 'barcode',
      caption: badge.caption || 'SCAN TO FILE COMPLAINT',
    });
  }, { badge, photoDataUrl, isPrint: !!options?.print });

  if (includePhoto) {
    await page.waitForFunction(() => {
      const img = document.querySelector('.photo-frame img') as HTMLImageElement;
      return img && img.complete && img.naturalWidth > 0;
    }, { timeout: 5000 }).catch(() => {
      // Photo may not have loaded — continue with placeholder
    });
  }

  const badgeEl = await page.$('#badge');
  if (!badgeEl) throw new Error('Badge element not found');

  const pngBuf = await badgeEl.screenshot({ type: 'png', omitBackground: !options?.print });

  if (options?.print) {
    // Set DPI metadata so the image maps correctly to CR80 card size
    return await sharp(Buffer.from(pngBuf))
      .withMetadata({ density: 600 })
      .png()
      .toBuffer();
  }

  // Round corners with SVG mask (single pipeline)
  const meta = await sharp(Buffer.from(pngBuf)).metadata();
  const W = meta.width || 700;
  const H = meta.height || 1100;
  const R = Math.round(W * 0.0588);
  const roundedMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" rx="${R}" ry="${R}" fill="white"/></svg>`
  );
  return await sharp(Buffer.from(pngBuf))
    .ensureAlpha()
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// ─── SSE (Server-Sent Events) for Live Org Chart ─────────

interface SSEClient {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  keepalive: ReturnType<typeof setInterval>;
  ip: string;
}

const sseClients = new Set<SSEClient>();
const MAX_SSE_CLIENTS = 500;
const MAX_SSE_PER_IP = 10;
const sseByIp = new Map<string, number>();

function sseWrite(client: SSEClient, event: string, data: string) {
  client.controller.enqueue(client.encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
}

function broadcastNewBadge(badge: { employeeId: string; name: string; department: string; title: string; accessLevel: string; accessCss: string; isBandMember: boolean }) {
  const data = JSON.stringify(badge);
  for (const client of sseClients) {
    try {
      sseWrite(client, 'new-badge', data);
    } catch {
      clearInterval(client.keepalive);
      sseClients.delete(client);
    }
  }
}

function broadcastSSE(event: string, data: any) {
  const json = JSON.stringify(data);
  for (const client of sseClients) {
    try {
      sseWrite(client, event, json);
    } catch {
      clearInterval(client.keepalive);
      sseClients.delete(client);
    }
  }
}

// Wire up demo and presentation engines
initDemo({
  broadcast: broadcastNewBadge,
  writeFile: writeFileSync,
  badgesDir: BADGES_DIR,
});
initPresentation({ broadcast: broadcastSSE });

function handleSSEDirect(clientIp: string): Response {
  if (sseClients.size >= MAX_SSE_CLIENTS) {
    return new Response(JSON.stringify({ success: false, error: 'Too many live connections. Try again later.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
    });
  }

  // Per-IP connection limit
  const ipCount = sseByIp.get(clientIp) || 0;
  if (ipCount >= MAX_SSE_PER_IP) {
    return new Response(JSON.stringify({ success: false, error: 'Too many connections from this address.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '10' },
    });
  }
  sseByIp.set(clientIp, ipCount + 1);

  const encoder = new TextEncoder();
  let clientRef: SSEClient | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(': ok\n\nevent: connected\ndata: connected\n\n'));

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
        }
      }, 5_000);

      clientRef = { controller, encoder, keepalive, ip: clientIp };
      sseClients.add(clientRef);
      log('info', 'sse', `Client connected (${sseClients.size} total)`);
    },
    cancel() {
      if (clientRef) {
        clearInterval(clientRef.keepalive);
        sseClients.delete(clientRef);
        // Decrement per-IP counter
        const remaining = (sseByIp.get(clientRef.ip) || 1) - 1;
        if (remaining <= 0) sseByIp.delete(clientRef.ip);
        else sseByIp.set(clientRef.ip, remaining);
        clientRef = null;
        log('info', 'sse', `Client disconnected (${sseClients.size} total)`);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

// ─── Route Modules ───────────────────────────────────────

const sharedDeps = {
  getClientIp,
  broadcastNewBadge,
  broadcastSSE,
  decodeBase64Image,
  renderBadgePlaywright,
  clampField,
  PHOTOS_DIR,
  BADGES_DIR,
  THUMBS_DIR,
  HEADSHOTS_DIR,
  ADMIN_TOKEN,
  THUMB_WIDTH,
  HEADSHOT_WIDTH,
};

registerPublicRoutes(app, sharedDeps);
registerAdminRoutes(app, sharedDeps);

// ─── HTML Page Routes ────────────────────────────────────

app.get('/orgchart', serveStatic({ path: './public/index.html' }));
app.get('/presentation', serveStatic({ path: './public/presentation.html' }));
app.get('/admin', serveStatic({ path: './public/admin.html' }));
app.get('/recover', serveStatic({ path: './public/recover.html' }));

// ─── Static Files (must be LAST) ─────────────────────────

app.use('/*', serveStatic({ root: './public' }));
app.get('/', serveStatic({ path: './public/index.html' }));

// ─── 404 Catch-All (themed incident report page) ────────
// Only serves the HTML error page for navigation requests (not API/assets).
app.notFound((c) => {
  const accept = c.req.header('accept') || '';
  // API requests and non-HTML requests get JSON
  if (c.req.path.startsWith('/api/') || !accept.includes('text/html')) {
    return c.json({ success: false, error: 'Not found.' }, 404);
  }
  // Browser navigation gets the themed 404 page
  return c.html(readFileSync(join('public', '404.html'), 'utf-8'), 404);
});

// ─── Server ──────────────────────────────────────────────

const port = Number(process.env.PORT) || 3000;

log('info', 'server', `Started on port ${port} (admin=${ADMIN_TOKEN ? 'enabled' : 'disabled'}, local_only=${process.env.ADMIN_LOCAL_ONLY || '0'}, show_mode=${process.env.SHOW_MODE || '0'})`);
console.log(`🎫 Help Desk Badge Generator running at http://localhost:${port}`);
if (ADMIN_TOKEN) {
  console.log(`🔐 Admin panel: http://localhost:${port}/admin`);
  console.log(`📺 Presentation: http://localhost:${port}/presentation`);
} else {
  console.log(`⚠️  No ADMIN_TOKEN set — admin panel disabled`);
}
import { isShowMode } from './rate-limit';
if (isShowMode()) {
  console.log(`🎸 SHOW MODE active — relaxed rate limits (50/hr, 200/day)`);
}

// Graceful shutdown
process.on('SIGTERM', async () => { await closeBrowser(); closeDb(); process.exit(0); });
process.on('SIGINT', async () => { await closeBrowser(); closeDb(); process.exit(0); });

export default {
  port,
  idleTimeout: 120,
  fetch(req: Request, server: any): Response | Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/api/badges/stream') {
      // Extract client IP for per-IP SSE limiting
      const ip = (process.env.TRUST_PROXY === '1'
        ? req.headers.get('cf-connecting-ip')
          || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        : server?.requestIP?.(req)?.address) || 'unknown';
      return handleSSEDirect(ip);
    }
    return app.fetch(req, server);
  },
};
