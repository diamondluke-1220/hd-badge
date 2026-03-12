// Help Desk Badge Generator — Server
// Hono + bun:sqlite + static file serving

import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { bearerAuth } from 'hono/bearer-auth';
import { getConnInfo } from 'hono/bun';
import { join } from 'path';
import { mkdirSync, existsSync, writeFileSync, unlinkSync, statSync } from 'fs';
import sharp from 'sharp';
import { initDb, createBadge, getBadge, listBadges, softDeleteBadge, hardDeleteBadge, toggleVisibility, togglePaid, togglePrinted, toggleFlagged, setHasPhoto, getStats, getAnalytics, getDivisionNames, exportAllBadges, closeDb } from './db';
import { checkRateLimit } from './rate-limit';
import { isNameClean, shouldFlag } from './profanity';
import { log, getLog } from './logger';
import { initDemo, startDemo, stopDemo, getDemoStatus, cleanupDemo } from './demo';

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
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
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

/** Truncate a string field to MAX_FIELD_LENGTH */
function clampField(val: string): string {
  return val.slice(0, MAX_FIELD_LENGTH);
}

// ─── Helpers ─────────────────────────────────────────────

function getClientIp(c: any): string {
  // Only trust forwarded headers behind a known reverse proxy (Cloudflare, nginx)
  if (process.env.TRUST_PROXY === '1') {
    return c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown';
  }
  // Use actual socket IP (prevents X-Forwarded-For spoofing on venue WiFi)
  try {
    const info = getConnInfo(c);
    return info.remote.address || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Admin auth: uses Hono's built-in bearerAuth with timing-safe comparison.
// When ADMIN_TOKEN is empty, all admin routes return 401 (admin disabled).
// Rate limiting: 5 failed attempts per IP = 15-minute lockout.
const adminFailures = new Map<string, { count: number; lastAttempt: number }>();

/** Check if an IP is localhost (handles IPv4, IPv6, and IPv4-mapped IPv6) */
function isLocalhost(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

// Also restrict /admin HTML page to localhost in local mode
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
  // Block if admin is disabled (no token set)
  if (!ADMIN_TOKEN) {
    return c.json({ error: 'Admin panel disabled. Set ADMIN_TOKEN env var.' }, 401);
  }

  // In local mode, restrict admin API to localhost only (token never crosses WiFi)
  if (process.env.ADMIN_LOCAL_ONLY === '1') {
    const ip = getClientIp(c);
    if (!isLocalhost(ip)) {
      return c.json({ error: 'Admin access restricted to localhost.' }, 403);
    }
  }

  // Rate limit failed admin auth attempts
  const ip = getClientIp(c);
  const record = adminFailures.get(ip);
  if (record && record.count >= 5 && Date.now() - record.lastAttempt < 15 * 60 * 1000) {
    return c.json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);
  }

  await next();
});

// Bearer auth middleware (timing-safe token comparison)
app.use('/api/admin/*', async (c, next) => {
  if (!ADMIN_TOKEN) return next(); // Already handled above
  try {
    await bearerAuth({ token: ADMIN_TOKEN })(c, next);
  } catch (e: any) {
    // Track failed auth attempts for rate limiting
    const ip = getClientIp(c);
    const record = adminFailures.get(ip) || { count: 0, lastAttempt: 0 };
    record.count++;
    record.lastAttempt = Date.now();
    adminFailures.set(ip, record);
    log('warn', 'auth', `Failed admin auth from ${ip} (attempt ${record.count})`);
    // Return JSON error instead of plain text "Unauthorized" (client expects JSON)
    return c.json({ error: 'Unauthorized. Invalid or missing admin token.' }, 401);
  }
});

// Clean up stale admin failure records every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, record] of adminFailures) {
    if (record.lastAttempt < cutoff) adminFailures.delete(key);
  }
}, 30 * 60 * 1000);

// ─── Captive Portal Detection ────────────────────────────
// OS-level connectivity checks. Two-phase approach:
//
// Phase 1 (initial connect): Return "wrong" response → OS opens captive portal
//   mini-browser → fan sees badge generator. This happens automatically because
//   our wildcard DNS + generic HTML response doesn't match what the OS expects.
//
// Phase 2 (after badge created): Fan hits "Done" in captive portal browser, or
//   the OS re-checks connectivity. We return the "correct" success responses so
//   the OS stops nagging about "no internet" and stays connected.
//
// We track IPs that have visited the badge page. Once they have, we tell the
// OS "you're connected" so it doesn't auto-disconnect.

const portalCleared = new Set<string>();

// Call this after badge creation or page visit to "clear" the portal for that IP
function markPortalCleared(ip: string): void {
  portalCleared.add(ip);
  // Auto-expire after 4 hours (show duration)
  setTimeout(() => portalCleared.delete(ip), 4 * 60 * 60 * 1000);
}

// iOS / macOS
app.get('/hotspot-detect.html', (c) => {
  const ip = getClientIp(c);
  if (portalCleared.has(ip)) {
    return c.text('Success');  // Tell iOS "you're online" — stay connected
  }
  // First visit: return redirect to badge page → triggers captive portal browser
  return c.redirect('/');
});

// Android (Google + Samsung)
app.get('/generate_204', (c) => {
  const ip = getClientIp(c);
  if (portalCleared.has(ip)) {
    return new Response(null, { status: 204 });  // Tell Android "you're online"
  }
  return c.redirect('/');
});
app.get('/gen_204', (c) => {
  const ip = getClientIp(c);
  if (portalCleared.has(ip)) {
    return new Response(null, { status: 204 });
  }
  return c.redirect('/');
});

// Windows
app.get('/connecttest.txt', (c) => {
  const ip = getClientIp(c);
  if (portalCleared.has(ip)) {
    return c.text('Microsoft Connect Test');
  }
  return c.redirect('/');
});
app.get('/ncsi.txt', (c) => {
  const ip = getClientIp(c);
  if (portalCleared.has(ip)) {
    return c.text('Microsoft NCSI');
  }
  return c.redirect('/');
});

// Firefox
app.get('/success.txt', (c) => {
  const ip = getClientIp(c);
  if (portalCleared.has(ip)) {
    return c.text('success\n');
  }
  return c.redirect('/');
});

/** Strip data URL prefix and decode base64 to Buffer */
function decodeBase64Image(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

/** Server-side badge render via Playwright + Sharp corner clipping */
async function renderBadgePlaywright(badge: any, options?: { withPhoto?: boolean }): Promise<Buffer> {
  const { chromium } = await import('playwright');
  const serverPort = Number(process.env.PORT) || 3000;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 2200 } });
    await page.goto(`http://localhost:${serverPort}/`, { waitUntil: 'networkidle' });

    const id = badge.employee_id;
    const photoPath = join(PHOTOS_DIR, `${id}.jpg`);
    const includePhoto = (options?.withPhoto !== false) && badge.has_photo && existsSync(photoPath);
    let photoDataUrl: string | null = null;
    if (includePhoto) {
      const photoBuffer = await Bun.file(photoPath).arrayBuffer();
      photoDataUrl = `data:image/jpeg;base64,${Buffer.from(photoBuffer).toString('base64')}`;
    } else {
      // Use skull headset placeholder for badges without a photo
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

    await page.evaluate(() => {
      document.querySelectorAll('body > *:not(#badgeCapture)').forEach((el) => {
        el.remove();
      });
      document.body.style.background = 'white';
      document.body.style.margin = '0';
      document.body.style.padding = '0';

      const captureDiv = document.getElementById('badgeCapture');
      if (captureDiv) {
        captureDiv.style.left = '0';
        captureDiv.style.top = '0';
        captureDiv.style.position = 'fixed';
        captureDiv.style.zIndex = '9999';
      }

      const badgeDiv = document.getElementById('badge');
      if (badgeDiv) {
        badgeDiv.style.clipPath = 'inset(0 round 75px)';
      }
    });

    const badgeEl = await page.$('#badge');
    if (!badgeEl) {
      throw new Error('Badge element not found on page.');
    }

    const screenshot = await badgeEl.screenshot({ type: 'png', omitBackground: true });

    // Apply rounded-corner alpha mask
    const rgbaBuf = await sharp(screenshot).ensureAlpha().png().toBuffer();
    const meta = await sharp(rgbaBuf).metadata();
    const W = meta.width!;
    const H = meta.height!;
    const R = Math.round(75 * (W / 1276));
    const roundedMask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" rx="${R}" ry="${R}" fill="white"/></svg>`
    );
    return await sharp(rgbaBuf)
      .composite([{ input: roundedMask, blend: 'dest-in' }])
      .png()
      .toBuffer();
  } finally {
    await browser.close();
  }
}

// ─── SSE (Server-Sent Events) for Live Org Chart ─────────

interface SSEClient {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  keepalive: ReturnType<typeof setInterval>;
}

const sseClients = new Set<SSEClient>();

/** Format and enqueue an SSE event */
function sseWrite(client: SSEClient, event: string, data: string) {
  client.controller.enqueue(client.encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
}

/** Broadcast a new badge event to all connected org chart viewers */
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

// Wire up demo engine now that broadcastNewBadge is defined
initDemo({
  broadcast: broadcastNewBadge,
  writeFile: writeFileSync,
  badgesDir: BADGES_DIR,
});

/** Handle SSE directly at the Bun.serve level — bypasses Hono entirely */
function handleSSEDirect(): Response {
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
      }, 5_000); // Must be under Bun's 10s idle timeout

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

// ─── Captive Portal Clearance ────────────────────────────

// Client-side JS calls this on page load to clear the portal for this device.
// After this, OS connectivity checks get "success" responses and the device
// stays connected without "no internet" warnings.
app.post('/api/portal/clear', (c) => {
  const ip = getClientIp(c);
  markPortalCleared(ip);
  return c.json({ cleared: true });
});

// ─── Public API Routes ───────────────────────────────────

// Create badge (join org chart)
app.post('/api/badge', async (c) => {
  const ip = getClientIp(c);

  // Rate limit check
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return c.json({ success: false, error: rateCheck.message }, 429);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid request body.' }, 400);
  }

  const { name, department, title, song, accessLevel, accessCss, photo, photoPublic } = body;

  // Validate required fields
  if (!name || !department || !title || !song || !accessLevel || !accessCss) {
    return c.json({ success: false, error: 'Missing required fields.' }, 400);
  }

  // Profanity check
  if (!isNameClean(name)) {
    return c.json({ success: false, error: 'HR has flagged your name for review.' }, 400);
  }

  try {
    const hasPhoto = !!photo;
    let photoBuffer: Buffer | null = null;
    if (photo) {
      photoBuffer = decodeBase64Image(photo);
    }

    // Auto-flag edgy content for admin review
    const cleanName = clampField(name.trim().toUpperCase());
    const cleanTitle = clampField(title.trim());
    const flagged = shouldFlag(cleanName) || shouldFlag(cleanTitle);

    // Create DB record (clamp all text fields to prevent abuse)
    const result = createBadge({
      name: cleanName,
      department: clampField(department.trim().toUpperCase()),
      title: cleanTitle,
      song: clampField(song.trim().toUpperCase()),
      accessLevel: clampField(accessLevel.trim().toUpperCase()),
      accessCss: clampField(accessCss.trim()),
      hasPhoto,
      photoPublic: photoPublic !== false, // default true
      source: body.source || 'web',
      flagged,
    });

    // Save photo BEFORE render (Playwright needs it on disk)
    if (photoBuffer) {
      writeFileSync(join(PHOTOS_DIR, `${result.employeeId}.jpg`), photoBuffer);
    }

    // Server-side Playwright render for consistent output
    const badge = getBadge(result.employeeId);
    const badgeBuffer = await renderBadgePlaywright(badge);
    writeFileSync(join(BADGES_DIR, `${result.employeeId}.png`), badgeBuffer);

    // Render no-photo variant if fan has a photo but opted out of public display
    if (hasPhoto && photoPublic === false) {
      const noPhotoBuffer = await renderBadgePlaywright(badge, { withPhoto: false });
      writeFileSync(join(BADGES_DIR, `${result.employeeId}-nophoto.png`), noPhotoBuffer);
    }

    // Clear captive portal for this IP — OS will stop nagging about "no internet"
    markPortalCleared(ip);

    // Broadcast to all connected org chart viewers via SSE
    broadcastNewBadge({
      employeeId: result.employeeId,
      name: cleanName,
      department: clampField(department.trim().toUpperCase()),
      title: cleanTitle,
      accessLevel: clampField(accessLevel.trim().toUpperCase()),
      accessCss: clampField(accessCss.trim()),
      isBandMember: false,
    });

    log('info', 'badge', `Created ${result.employeeId}: ${cleanName} → ${clampField(department.trim().toUpperCase())}`);

    return c.json({
      success: true,
      employeeId: result.employeeId,
      deleteToken: result.deleteToken,
      message: 'Welcome to Help Desk Inc.',
    });
  } catch (err: any) {
    log('error', 'badge', `Creation failed: ${err.message}`);
    return c.json({ success: false, error: 'Badge creation failed. Please try again.' }, 500);
  }
});

// Get badge metadata
app.get('/api/badge/:id', (c) => {
  const badge = getBadge(c.req.param('id'));
  if (!badge || !badge.is_visible) {
    return c.json({ error: 'Badge not found.' }, 404);
  }

  return c.json({
    employeeId: badge.employee_id,
    name: badge.name,
    department: badge.department,
    title: badge.title,
    song: badge.song,
    accessLevel: badge.access_level,
    accessCss: badge.access_css,
    hasPhoto: !!badge.has_photo,
    photoPublic: !!badge.photo_public,
    isBandMember: !!badge.is_band_member,
    createdAt: badge.created_at,
  });
});

// Serve badge image
app.get('/api/badge/:id/image', (c) => {
  const id = c.req.param('id');
  const badge = getBadge(id);
  if (!badge) {
    return c.json({ error: 'Badge not found.' }, 404);
  }

  // Determine which image to serve
  // Admin with ?full=1 always gets the full version (check Bearer token inline)
  const authHeader = c.req.header('authorization');
  const isAdmin = !!ADMIN_TOKEN && authHeader === `Bearer ${ADMIN_TOKEN}` && c.req.query('full') === '1';

  let imagePath: string;
  if (!isAdmin && !badge.photo_public && badge.has_photo) {
    // Serve no-photo version for public view when photo is opted out
    const noPhotoPath = join(BADGES_DIR, `${id}-nophoto.png`);
    imagePath = existsSync(noPhotoPath) ? noPhotoPath : join(BADGES_DIR, `${id}.png`);
  } else {
    imagePath = join(BADGES_DIR, `${id}.png`);
  }

  if (!existsSync(imagePath)) {
    return c.json({ error: 'Badge image not found.' }, 404);
  }

  const file = Bun.file(imagePath);
  return new Response(file, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' },
  });
});

// Serve badge photo (admin only — for re-rendering)
app.get('/api/badge/:id/photo', (c) => {
  const id = c.req.param('id');
  const badge = getBadge(id);
  if (!badge || !badge.has_photo) {
    return c.json({ error: 'Photo not found.' }, 404);
  }

  const photoPath = join(PHOTOS_DIR, `${id}.jpg`);
  if (!existsSync(photoPath)) {
    return c.json({ error: 'Photo file not found.' }, 404);
  }

  const file = Bun.file(photoPath);
  return new Response(file, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' },
  });
});

// Serve employee headshot photo (public, privacy-aware, resized for org chart)
app.get('/api/badge/:id/headshot', async (c) => {
  const id = c.req.param('id');
  const badge = getBadge(id);
  if (!badge) {
    return c.json({ error: 'Badge not found.' }, 404);
  }

  const photoPath = join(PHOTOS_DIR, `${id}.jpg`);
  const placeholderPath = join('public', 'placeholder-photo.png');
  const hasUsablePhoto = badge.has_photo && badge.photo_public && existsSync(photoPath);

  if (!hasUsablePhoto) {
    // Serve skull placeholder for no-photo or private-photo badges
    if (!existsSync(placeholderPath)) {
      return c.json({ error: 'Placeholder not found.' }, 404);
    }
    const file = Bun.file(placeholderPath);
    return new Response(file, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
    });
  }

  // Serve resized headshot (cached)
  const headshotPath = join(HEADSHOTS_DIR, `${id}.jpg`);

  let needsGenerate = !existsSync(headshotPath);
  if (!needsGenerate) {
    const sourceStat = statSync(photoPath);
    const headshotStat = statSync(headshotPath);
    if (sourceStat.mtimeMs > headshotStat.mtimeMs) {
      needsGenerate = true;
    }
  }

  if (needsGenerate) {
    try {
      await sharp(photoPath)
        .resize(HEADSHOT_WIDTH)
        .jpeg({ quality: 85 })
        .toFile(headshotPath);
    } catch (err: any) {
      console.error(`Headshot generation failed for ${id}:`, err.message);
      // Fall back to full-size photo
      const file = Bun.file(photoPath);
      return new Response(file, {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=60' },
      });
    }
  }

  const file = Bun.file(headshotPath);
  return new Response(file, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
  });
});

// Serve badge thumbnail (resized for grid display)
app.get('/api/badge/:id/thumb', async (c) => {
  const id = c.req.param('id');
  const badge = getBadge(id);
  if (!badge) {
    return c.json({ error: 'Badge not found.' }, 404);
  }

  // Determine source image (respect photo privacy)
  let sourcePath: string;
  if (!badge.photo_public && badge.has_photo) {
    const noPhotoPath = join(BADGES_DIR, `${id}-nophoto.png`);
    sourcePath = existsSync(noPhotoPath) ? noPhotoPath : join(BADGES_DIR, `${id}.png`);
  } else {
    sourcePath = join(BADGES_DIR, `${id}.png`);
  }

  if (!existsSync(sourcePath)) {
    return c.json({ error: 'Badge image not found.' }, 404);
  }

  const thumbPath = join(THUMBS_DIR, `${id}.png`);

  // Check if thumbnail needs (re)generation
  let needsGenerate = !existsSync(thumbPath);
  if (!needsGenerate) {
    const sourceStat = statSync(sourcePath);
    const thumbStat = statSync(thumbPath);
    if (sourceStat.mtimeMs > thumbStat.mtimeMs) {
      needsGenerate = true;
    }
  }

  if (needsGenerate) {
    try {
      await sharp(sourcePath)
        .resize(THUMB_WIDTH)
        .png({ quality: 80 })
        .toFile(thumbPath);
    } catch (err: any) {
      console.error(`Thumbnail generation failed for ${id}:`, err.message);
      // Fall back to full-size image
      const file = Bun.file(sourcePath);
      return new Response(file, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' },
      });
    }
  }

  const file = Bun.file(thumbPath);
  return new Response(file, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
  });
});

// Self-service delete (soft delete)
app.delete('/api/badge/:id', (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token');

  if (!token) {
    return c.json({ error: 'Delete token required.' }, 400);
  }

  const success = softDeleteBadge(id, token);
  if (!success) {
    return c.json({ error: 'Badge not found or invalid token.' }, 403);
  }

  return c.json({ success: true, message: 'Your badge has been shredded.' });
});

// Public org chart listing
app.get('/api/orgchart', (c) => {
  const department = c.req.query('department') || undefined;
  const division = c.req.query('division') || undefined;
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const result = listBadges({ department, division, page, limit });

  return c.json({
    badges: result.badges.map(b => ({
      employeeId: b.employee_id,
      name: b.name,
      department: b.department,
      title: b.title,
      song: b.song,
      accessLevel: b.access_level,
      accessCss: b.access_css,
      hasPhoto: !!b.has_photo,
      photoPublic: !!b.photo_public,
      isBandMember: !!b.is_band_member,
      createdAt: b.created_at,
    })),
    total: result.total,
    page: result.page,
    pages: result.pages,
  });
});

// Replay mode: all visible badges for weighted animation loop
app.get('/api/badges/replay', (c) => {
  const result = listBadges({ page: 1, limit: 5000, maxLimit: 5000 });

  return c.json({
    badges: result.badges.map(b => ({
      employeeId: b.employee_id,
      name: b.name,
      department: b.department,
      title: b.title,
      accessLevel: b.access_level,
      accessCss: b.access_css,
      isBandMember: !!b.is_band_member,
      createdAt: b.created_at,
    })),
  });
});

// Org chart stats
app.get('/api/orgchart/stats', (c) => {
  return c.json(getStats());
});

// ─── Admin API Routes ────────────────────────────────────

// Admin: list all badges (including hidden)
app.get('/api/admin/badges', (c) => {

  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const department = c.req.query('department') || undefined;
  const search = c.req.query('search') || undefined;
  const division = c.req.query('division') || undefined;
  const dateFrom = c.req.query('dateFrom') || undefined;
  const dateTo = c.req.query('dateTo') || undefined;
  const photoParam = c.req.query('hasPhoto');
  const hasPhoto = photoParam === '1' ? true : photoParam === '0' ? false : undefined;

  const result = listBadges({ page, limit, includeHidden: true, department, division, dateFrom, dateTo, hasPhoto });

  // Client-side search filter (simple — server-side would need a LIKE query)
  let badges = result.badges;
  if (search) {
    const q = search.toUpperCase();
    badges = badges.filter(b =>
      b.name.includes(q) || b.employee_id.includes(q) || b.department.includes(q)
    );
  }

  return c.json({
    badges: badges.map(b => ({
      employeeId: b.employee_id,
      name: b.name,
      department: b.department,
      title: b.title,
      song: b.song,
      accessLevel: b.access_level,
      accessCss: b.access_css,
      hasPhoto: !!b.has_photo,
      photoPublic: !!b.photo_public,
      isBandMember: !!b.is_band_member,
      isVisible: !!b.is_visible,
      isPaid: !!b.is_paid,
      paidAt: b.paid_at,
      isPrinted: !!b.is_printed,
      printedAt: b.printed_at,
      isFlagged: !!b.is_flagged,
      createdAt: b.created_at,
      source: b.source,
    })),
    total: result.total,
    page: result.page,
    pages: result.pages,
  });
});

// Admin: extended stats (auth handled by middleware)
app.get('/api/admin/stats', (c) => {
  return c.json(getStats());
});

// Admin: toggle badge visibility
app.post('/api/admin/badge/:id/hide', (c) => {

  const success = toggleVisibility(c.req.param('id'));
  if (!success) {
    return c.json({ error: 'Badge not found.' }, 404);
  }

  return c.json({ success: true, message: 'Visibility toggled.' });
});

// Admin: hard delete
app.delete('/api/admin/badge/:id', (c) => {

  const id = c.req.param('id');

  // Delete files
  const files = [
    join(BADGES_DIR, `${id}.png`),
    join(BADGES_DIR, `${id}-nophoto.png`),
    join(PHOTOS_DIR, `${id}.jpg`),
  ];
  for (const f of files) {
    try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
  }

  const success = hardDeleteBadge(id);
  if (!success) {
    return c.json({ error: 'Badge not found.' }, 404);
  }

  return c.json({ success: true, message: 'Badge permanently deleted.' });
});

// Admin: toggle paid status
app.post('/api/admin/badge/:id/paid', (c) => {

  const success = togglePaid(c.req.param('id'));
  if (!success) {
    return c.json({ error: 'Badge not found.' }, 404);
  }

  return c.json({ success: true, message: 'Payment status toggled.' });
});

// Admin: toggle printed status
app.post('/api/admin/badge/:id/printed', (c) => {

  const success = togglePrinted(c.req.param('id'));
  if (!success) {
    return c.json({ error: 'Badge not found.' }, 404);
  }

  return c.json({ success: true, message: 'Print status toggled.' });
});

// Admin: toggle flagged status
app.post('/api/admin/badge/:id/flag', (c) => {

  const success = toggleFlagged(c.req.param('id'));
  if (!success) {
    return c.json({ error: 'Badge not found.' }, 404);
  }

  return c.json({ success: true, message: 'Flag status toggled.' });
});

// Admin: upload photo for existing badge
app.post('/api/admin/badge/:id/photo', async (c) => {
  const id = c.req.param('id');
  const badge = getBadge(id);
  if (!badge) {
    return c.json({ error: 'Badge not found.' }, 404);
  }

  try {
    const formData = await c.req.formData();
    const file = formData.get('photo');
    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No photo file provided.' }, 400);
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return c.json({ error: 'File must be an image.' }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Process with sharp — resize to reasonable max, save as JPEG
    await sharp(buffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(join(PHOTOS_DIR, `${id}.jpg`));

    // Update DB
    setHasPhoto(id, true);

    // Invalidate thumbnail and headshot caches so they regenerate on next request
    const thumbPath = join(THUMBS_DIR, `${id}.png`);
    if (existsSync(thumbPath)) {
      unlinkSync(thumbPath);
    }
    const headshotPath = join(HEADSHOTS_DIR, `${id}.jpg`);
    if (existsSync(headshotPath)) {
      unlinkSync(headshotPath);
    }

    log('info', 'admin', `Photo uploaded for ${id} (${badge.name})`);
    return c.json({ success: true, message: `Photo uploaded for ${badge.name}.` });
  } catch (err: any) {
    log('error', 'admin', `Photo upload failed for ${id}: ${err.message}`);
    return c.json({ error: 'Photo upload failed.' }, 500);
  }
});

// Admin: server-side badge render using Playwright (captures CSS perfectly)
app.post('/api/admin/badge/:id/render', async (c) => {
  const id = c.req.param('id');
  const badge = getBadge(id);
  if (!badge) {
    return c.json({ error: 'Badge not found.' }, 404);
  }

  try {
    const badgeBuffer = await renderBadgePlaywright(badge);
    writeFileSync(join(BADGES_DIR, `${id}.png`), badgeBuffer);

    // Invalidate thumbnail
    const thumbPath = join(THUMBS_DIR, `${id}.png`);
    if (existsSync(thumbPath)) {
      unlinkSync(thumbPath);
    }

    log('info', 'admin', `Badge rendered (Playwright) for ${id} (${badge.name})`);
    return c.json({ success: true, message: `Badge rendered for ${badge.name}.` });
  } catch (err: any) {
    log('error', 'admin', `Badge render failed for ${id}: ${err.message}`);
    return c.json({ error: 'Badge render failed: ' + err.message }, 500);
  }
});

// Admin: analytics data (auth handled by middleware)
app.get('/api/admin/analytics', (c) => {
  return c.json(getAnalytics());
});

// Admin: list available divisions (auth handled by middleware)
app.get('/api/admin/divisions', (c) => {
  return c.json({ divisions: getDivisionNames() });
});

// Admin: export all badges as CSV
app.get('/api/admin/export/csv', (c) => {

  const badges = exportAllBadges();

  const headers = ['id', 'employee_id', 'name', 'department', 'title', 'song', 'access_level', 'access_css', 'created_at', 'source', 'is_visible', 'has_photo', 'is_band_member', 'photo_public', 'is_paid', 'paid_at', 'is_printed', 'printed_at', 'is_flagged'];

  const escCsv = (val: any): string => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const lines = [headers.join(',')];
  for (const b of badges) {
    const row = headers.map(h => escCsv((b as any)[h]));
    lines.push(row.join(','));
  }

  const csv = lines.join('\n');
  const filename = `helpdesk-badges-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

// ─── Admin: System Logs ──────────────────────────────────

app.get('/api/admin/logs', (c) => {
  return c.json({ logs: getLog() });
});

// ─── Admin: Demo Mode ────────────────────────────────────

app.post('/api/admin/demo/start', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const count = body.count || 30;
  const duration = body.duration || 300;
  const result = startDemo(count, duration);
  if ('error' in result) {
    return c.json({ success: false, error: result.error }, 400);
  }
  return c.json({ success: true, ...result });
});

app.post('/api/admin/demo/stop', (c) => {
  const result = stopDemo();
  if ('error' in result) {
    return c.json({ success: false, error: result.error }, 400);
  }
  return c.json({ success: true, ...result });
});

app.get('/api/admin/demo/status', (c) => {
  return c.json(getDemoStatus());
});

app.post('/api/admin/demo/cleanup', (c) => {
  const result = cleanupDemo(BADGES_DIR, THUMBS_DIR, HEADSHOTS_DIR);
  return c.json({ success: true, ...result });
});

// ─── HTML Page Routes ────────────────────────────────────

// Org chart page (serves same SPA, client detects pathname)
app.get('/orgchart', serveStatic({ path: './public/index.html' }));

// Admin panel (separate page)
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
} else {
  console.log(`⚠️  No ADMIN_TOKEN set — admin panel disabled`);
}
if (process.env.SHOW_MODE === '1') {
  console.log(`🎸 SHOW MODE active — relaxed rate limits`);
}

// Graceful shutdown
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
process.on('SIGINT', () => { closeDb(); process.exit(0); });

export default {
  port,
  idleTimeout: 120, // seconds — prevent Bun from killing SSE connections (default 10s)
  fetch(req: Request, server: any): Response | Promise<Response> {
    const url = new URL(req.url);

    // Handle SSE at the Bun level — bypass Hono entirely to avoid response wrapping
    if (url.pathname === '/api/badges/stream') {
      return handleSSEDirect();
    }
    return app.fetch(req, server);
  },
};
