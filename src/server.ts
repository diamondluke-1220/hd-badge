// Help Desk Badge Generator — Server
// Hono + bun:sqlite + static file serving

import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { bearerAuth } from 'hono/bearer-auth';
import { getConnInfo } from 'hono/bun';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import sharp from 'sharp';
import { initDb, closeDb } from './db';
import { log } from './logger';
import { initDemo } from './demo';
import { initPresentation } from './presentation';
import { registerPortalRoutes } from './routes/portal';
import { registerPublicRoutes } from './routes/public';
import { registerAdminRoutes } from './routes/admin';

// ─── Playwright Browser Pool ─────────────────────────────

let _browser: import('playwright').Browser | null = null;
let _browserLaunching: Promise<import('playwright').Browser> | null = null;

async function getBrowser() {
  if (_browser?.isConnected()) return _browser;
  if (_browserLaunching) return _browserLaunching;
  _browser = null;
  _browserLaunching = (async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    _browser = browser;
    _browserLaunching = null;
    return browser;
  })();
  return _browserLaunching;
}

async function closeBrowser() {
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

// Initialize demo engine (broadcast function set after SSE setup below)
let _broadcastFn: typeof broadcastNewBadge;

const app = new Hono();

// ─── Security ───────────────────────────────────────────

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FIELD_LENGTH = 200;

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
    return c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
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

function clampField(val: string): string {
  return val.slice(0, MAX_FIELD_LENGTH);
}

/** Strip data URL prefix and decode base64 to Buffer */
function decodeBase64Image(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

// ─── Admin Auth ─────────────────────────────────────────

const adminFailures = new Map<string, { count: number; lastAttempt: number }>();

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
  if (record && record.count >= 5 && Date.now() - record.lastAttempt < 15 * 60 * 1000) {
    return c.json({ success: false, error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);
  }

  await next();
});

// Bearer auth middleware (timing-safe token comparison)
app.use('/api/admin/*', async (c, next) => {
  if (!ADMIN_TOKEN) return next();
  try {
    await bearerAuth({ token: ADMIN_TOKEN })(c, next);
  } catch (e: any) {
    const ip = getClientIp(c);
    const record = adminFailures.get(ip) || { count: 0, lastAttempt: 0 };
    record.count++;
    record.lastAttempt = Date.now();
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

// ─── Captive Portal State ────────────────────────────────

const portalCleared = new Set<string>();

function markPortalCleared(ip: string): void {
  portalCleared.add(ip);
  setTimeout(() => portalCleared.delete(ip), 4 * 60 * 60 * 1000);
}

// ─── Playwright Badge Render ─────────────────────────────

/** Server-side badge render via Playwright + Sharp corner clipping */
async function renderBadgePlaywright(badge: any, options?: { withPhoto?: boolean; print?: boolean }): Promise<Buffer> {
  const serverPort = Number(process.env.PORT) || 3000;
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: 1400, height: 2200 } });
  try {
    await page.goto(`http://localhost:${serverPort}/`, { waitUntil: 'networkidle' });

    const id = badge.employee_id;
    const photoPath = join(PHOTOS_DIR, `${id}.jpg`);
    const includePhoto = (options?.withPhoto !== false) && badge.has_photo && existsSync(photoPath);
    let photoDataUrl: string | null = null;
    if (includePhoto) {
      const photoBuffer = await Bun.file(photoPath).arrayBuffer();
      photoDataUrl = `data:image/jpeg;base64,${Buffer.from(photoBuffer).toString('base64')}`;
    } else {
      const placeholderPath = join('public', 'placeholder-photo.png');
      if (existsSync(placeholderPath)) {
        const placeholderBuffer = await Bun.file(placeholderPath).arrayBuffer();
        photoDataUrl = `data:image/png;base64,${Buffer.from(placeholderBuffer).toString('base64')}`;
      }
    }

    await page.evaluate(({ badge, photoDataUrl }) => {
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

      (window as any).updateBadge({
        name: badge.name,
        department: badge.department,
        title: badge.title,
        song: badge.song,
        accessLevel: badge.access_level,
        accessCss: badge.access_css,
        photoUrl: photoDataUrl,
        waveStyle: 'barcode',
        caption: 'SCAN TO FILE COMPLAINT',
      });
    }, { badge, photoDataUrl });

    if (includePhoto) {
      await page.waitForTimeout(300);
    }

    // Print mode: white background, no rounded corners
    if (options?.print) {
      await page.evaluate(() => {
        const el = document.getElementById('badge');
        if (el) {
          el.style.borderRadius = '0';
          el.style.boxShadow = 'none';
        }
        document.body.style.background = 'white';
      });
    }

    const badgeEl = await page.$('#badge');
    if (!badgeEl) throw new Error('Badge element not found');

    const pngBuf = await badgeEl.screenshot({ type: 'png', omitBackground: !options?.print });

    if (options?.print) {
      return Buffer.from(pngBuf);
    }

    // Round corners with SVG mask
    const meta = await sharp(Buffer.from(pngBuf)).metadata();
    const W = meta.width || 700;
    const H = meta.height || 1100;
    const R = Math.round(W * 0.04);
    const rgbaBuf = await sharp(Buffer.from(pngBuf)).ensureAlpha().raw().toBuffer();
    const roundedMask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" rx="${R}" ry="${R}" fill="white"/></svg>`
    );
    return await sharp(rgbaBuf, { raw: { width: W, height: H, channels: 4 } })
      .composite([{ input: roundedMask, blend: 'dest-in' }])
      .png()
      .toBuffer();
  } finally {
    await page.close();
  }
}

// ─── SSE (Server-Sent Events) for Live Org Chart ─────────

interface SSEClient {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  keepalive: ReturnType<typeof setInterval>;
}

const sseClients = new Set<SSEClient>();
const MAX_SSE_CLIENTS = 500;

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

function handleSSEDirect(): Response {
  if (sseClients.size >= MAX_SSE_CLIENTS) {
    return new Response(JSON.stringify({ success: false, error: 'Too many live connections. Try again later.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
    });
  }

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

      clientRef = { controller, encoder, keepalive };
      sseClients.add(clientRef);
      log('info', 'sse', `Client connected (${sseClients.size} total)`);
    },
    cancel() {
      if (clientRef) {
        clearInterval(clientRef.keepalive);
        sseClients.delete(clientRef);
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
  markPortalCleared,
  broadcastNewBadge,
  decodeBase64Image,
  renderBadgePlaywright,
  clampField,
  portalCleared,
  PHOTOS_DIR,
  BADGES_DIR,
  THUMBS_DIR,
  HEADSHOTS_DIR,
  ADMIN_TOKEN,
  THUMB_WIDTH,
  HEADSHOT_WIDTH,
};

registerPortalRoutes(app, sharedDeps);
registerPublicRoutes(app, sharedDeps);
registerAdminRoutes(app, sharedDeps);

// ─── HTML Page Routes ────────────────────────────────────

app.get('/orgchart', serveStatic({ path: './public/index.html' }));
app.get('/presentation', serveStatic({ path: './public/presentation.html' }));
app.get('/admin', serveStatic({ path: './public/admin.html' }));

// ─── Static Files (must be LAST) ─────────────────────────

app.use('/*', serveStatic({ root: './public' }));
app.get('/', serveStatic({ path: './public/index.html' }));

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
if (process.env.SHOW_MODE === '1') {
  console.log(`🎸 SHOW MODE active — relaxed rate limits`);
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
      return handleSSEDirect();
    }
    return app.fetch(req, server);
  },
};
