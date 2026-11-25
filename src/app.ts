// The Hono app: security headers, the body cap, the admin gate and lockout,
// every route, static files and the 404 handler. Building it starts nothing:
// the database, the render pool and the live stream are passed in, so tests
// build the same app with stand-ins.

import { Hono, type Context, type Next } from 'hono';
import { serveStatic, getConnInfo } from 'hono/bun';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { join } from 'path';
import { readFileSync } from 'fs';
import type { Server } from 'bun';
import { log } from './logger';
import { fail } from './http';
import { resolveClientIp, isLocalhost, type ProxyTrust } from './client-ip';
import type { RenderBadge, BroadcastSSE } from './types';
import type { BadgeDirs } from './badge-files';
import type { NewBadgeEvent } from './live-stream';
import { registerPublicRoutes } from './routes/public';
import { registerAdminRoutes } from './routes/admin';

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
const ADMIN_LOCKOUT_FAILURES = 5;
const ADMIN_LOCKOUT_MS = 15 * 60 * 1000;

export interface AppDeps extends BadgeDirs {
  PRINTS_DIR: string;
  THUMB_WIDTH: number;
  HEADSHOT_WIDTH: number;
  /** Empty disables the admin API. */
  adminToken: string;
  /** ADMIN_LOCAL_ONLY=1: the admin page and API answer only loopback peers. Read on every request. */
  adminLocalOnly: () => boolean;
  /** Read on every request. */
  proxyTrust: () => ProxyTrust;
  renderBadgePlaywright: RenderBadge;
  renderPageScreenshot: (path: string, selector: string) => Promise<Buffer>;
  broadcastNewBadge: (badge: NewBadgeEvent) => void;
  broadcastSSE: BroadcastSSE;
  /** Opens a live-stream connection for a client address. */
  connectLiveStream: (clientIp: string) => Response;
}

export interface BadgeApp {
  app: Hono;
  /** The server's fetch handler: the live stream, then everything else through the Hono app. */
  fetch: (req: Request, server: Pick<Server<unknown>, 'requestIP'>) => Response | Promise<Response>;
  /** Forgets admin-auth failures older than the lockout window. */
  pruneAdminFailures: () => void;
}

/** Truncates a user text field to its own limit, or 200 characters. */
export function clampField(val: string, field?: string): string {
  const limit = (field && FIELD_LIMITS[field]) || MAX_FIELD_LENGTH;
  return val.slice(0, limit);
}

/** Decodes a base64 image data URL; null when the value is not one. */
export function decodeBase64Image(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

/** Socket peer address: who actually opened the connection. Unspoofable. */
function getPeerIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function createApp(deps: AppDeps): BadgeApp {
  const app = new Hono();
  const getClientIp = (c: Context) => resolveClientIp(getPeerIp(c), (name) => c.req.header(name), deps.proxyTrust());

  // ─── Security ───────────────────────────────────────────

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-XSS-Protection', '1; mode=block');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "font-src 'self' https://fonts.gstatic.com",
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '));
  });

  // Counts the bytes actually read, so a chunked upload with no Content-Length
  // is capped the same as one that declares its size.
  app.use('*', bodyLimit({
    maxSize: MAX_BODY_SIZE,
    onError: (c) => fail(c, 413, 'Request too large. Maximum 10 MB.'),
  }));

  // ─── Admin gate ─────────────────────────────────────────

  const adminFailures = new Map<string, { count: number; firstAttempt: number; lastAttempt: number }>();

  // Checks the SOCKET PEER, not the forwarded client IP: a proxy-forwarded
  // "cf-connecting-ip: 127.0.0.1" must never satisfy a localhost-only gate.
  // Registered on both '/admin' and '/admin.html', because the static catch-all
  // would otherwise serve public/admin.html under its file name.
  const adminPageGuard = async (c: Context, next: Next) => {
    if (deps.adminLocalOnly() && !isLocalhost(getPeerIp(c))) {
      return c.text('Not found', 404);
    }
    await next();
  };
  app.use('/admin', adminPageGuard);
  app.use('/admin.html', adminPageGuard);

  app.use('/api/admin/*', async (c, next) => {
    if (!deps.adminToken) {
      return fail(c, 401, 'Admin panel disabled. Set ADMIN_TOKEN env var.');
    }
    // Socket peer, for the same reason as the page guard.
    if (deps.adminLocalOnly() && !isLocalhost(getPeerIp(c))) {
      return fail(c, 403, 'Admin access restricted to localhost.');
    }

    const ip = getClientIp(c);
    const record = adminFailures.get(ip);
    if (record && record.count >= ADMIN_LOCKOUT_FAILURES) {
      // Locked out for 15 min from the LAST failure
      if (Date.now() - record.lastAttempt < ADMIN_LOCKOUT_MS) {
        return fail(c, 429, 'Too many failed attempts. Try again in 15 minutes.');
      }
      adminFailures.delete(ip);
    }

    await next();
  });

  // Bearer auth (timing-safe token comparison)
  app.use('/api/admin/*', async (c, next) => {
    if (!deps.adminToken) return next();
    try {
      await bearerAuth({ token: deps.adminToken })(c, next);
      const ip = getClientIp(c);
      if (adminFailures.has(ip)) adminFailures.delete(ip);
    } catch (e) {
      // bearerAuth runs the downstream handler inside this try (it awaits next()).
      // Only a genuine bad/missing token throws HTTPException 401; any other
      // error (e.g. a render failure in a print route) propagates, so it isn't
      // miscounted as a failed login and doesn't trip the lockout.
      if (!(e instanceof HTTPException) || e.status !== 401) {
        throw e;
      }
      const ip = getClientIp(c);
      const now = Date.now();
      const record = adminFailures.get(ip) || { count: 0, firstAttempt: now, lastAttempt: 0 };
      record.count++;
      record.lastAttempt = now;
      if (!record.firstAttempt) record.firstAttempt = now;
      adminFailures.set(ip, record);
      log('warn', 'auth', `Failed admin auth from ${ip} (attempt ${record.count})`);
      return fail(c, 401, 'Unauthorized. Invalid or missing admin token.');
    }
  });

  // ─── Routes ─────────────────────────────────────────────

  const routeDeps = {
    ...deps,
    getClientIp,
    clampField,
    decodeBase64Image,
    ADMIN_TOKEN: deps.adminToken,
  };
  registerPublicRoutes(app, routeDeps);
  registerAdminRoutes(app, routeDeps);

  app.get('/orgchart', serveStatic({ path: './public/index.html' }));
  app.get('/presentation', serveStatic({ path: './public/presentation.html' }));
  app.get('/admin', serveStatic({ path: './public/admin.html' }));
  app.get('/recover', serveStatic({ path: './public/recover.html' }));
  app.get('/game', (c) => c.redirect('https://game.helpdesk.band', 301));

  // Static files (must be LAST)
  app.use('/*', serveStatic({ root: './public' }));
  app.get('/', serveStatic({ path: './public/index.html' }));

  // API and non-HTML requests get JSON; browser navigation gets the themed 404 page.
  app.notFound((c) => {
    const accept = c.req.header('accept') || '';
    if (c.req.path.startsWith('/api/') || !accept.includes('text/html')) {
      return fail(c, 404, 'Not found.');
    }
    return c.html(readFileSync(join('public', '404.html'), 'utf-8'), 404);
  });

  return {
    app,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === '/api/badges/stream') {
        // Per-IP stream caps use the same client-IP rule as every other route.
        const peer = server?.requestIP?.(req)?.address || 'unknown';
        const ip = resolveClientIp(peer, (name) => req.headers.get(name), deps.proxyTrust());
        return deps.connectLiveStream(ip);
      }
      return app.fetch(req, server);
    },
    pruneAdminFailures() {
      const cutoff = Date.now() - ADMIN_LOCKOUT_MS;
      for (const [key, record] of adminFailures) {
        if (record.lastAttempt < cutoff) adminFailures.delete(key);
      }
    },
  };
}
