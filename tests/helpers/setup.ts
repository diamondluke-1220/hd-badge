// Test harness — creates temp SQLite DB and test Hono app with mocked deps
// No Playwright browser needed — renderBadgePlaywright is mocked

import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDb, closeDb } from '../../src/db';
import { resetRateLimits } from '../../src/rate-limit';
import { registerPublicRoutes } from '../../src/routes/public';
import { registerAdminRoutes } from '../../src/routes/admin';

export const TEST_ADMIN_TOKEN = 'test-admin-token-12345';

interface TestContext {
  app: Hono;
  tmpDir: string;
  dbPath: string;
}

let currentTmpDir: string | null = null;

/**
 * Create a fresh test app with temp DB and mocked dependencies.
 * Call cleanup() when done.
 */
export function createTestApp(): TestContext {
  // Create temp directory for DB and files
  const tmpDir = mkdtempSync(join(tmpdir(), 'hdbadge-test-'));
  currentTmpDir = tmpDir;

  const photosDir = join(tmpDir, 'photos');
  const badgesDir = join(tmpDir, 'badges');
  const thumbsDir = join(tmpDir, 'thumbs');
  const headshotsDir = join(tmpDir, 'headshots');

  mkdirSync(photosDir, { recursive: true });
  mkdirSync(badgesDir, { recursive: true });
  mkdirSync(thumbsDir, { recursive: true });
  mkdirSync(headshotsDir, { recursive: true });

  // Initialize DB at temp path
  const dbPath = join(tmpDir, 'test.db');
  initDb(dbPath);

  // Build Hono app with route modules
  const app = new Hono();

  // Admin auth failure tracking (mirrors server.ts)
  const adminFailures = new Map<string, { count: number; lastAttempt: number }>();

  // Admin auth middleware
  app.use('/api/admin/*', async (c, next) => {
    const ip = c.req.header('x-forwarded-for') || '127.0.0.1';
    const record = adminFailures.get(ip);
    if (record && record.count >= 5 && Date.now() - record.lastAttempt < 15 * 60 * 1000) {
      return c.json({ success: false, error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);
    }
    await next();
  });

  app.use('/api/admin/*', async (c, next) => {
    try {
      await bearerAuth({ token: TEST_ADMIN_TOKEN })(c, next);
    } catch {
      const ip = c.req.header('x-forwarded-for') || '127.0.0.1';
      const record = adminFailures.get(ip) || { count: 0, lastAttempt: 0 };
      record.count++;
      record.lastAttempt = Date.now();
      adminFailures.set(ip, record);
      return c.json({ success: false, error: 'Unauthorized. Invalid or missing admin token.' }, 401);
    }
  });

  // Mock dependencies
  const sharedDeps = {
    getClientIp: (c: any) => c.req.header('x-forwarded-for') || '127.0.0.1',
    markPortalCleared: (_ip: string) => {},
    broadcastNewBadge: (_badge: any) => {},
    decodeBase64Image: (dataUrl: string): Buffer | null => {
      const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
      if (!match) return null;
      return Buffer.from(match[1], 'base64');
    },
    renderBadgePlaywright: async (_badge: any, _options?: any): Promise<Buffer> => {
      // Return a minimal valid PNG (1x1 pixel)
      return Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
    },
    clampField: (val: string) => val.slice(0, 200),
    portalCleared: new Set<string>(),
    PHOTOS_DIR: photosDir,
    BADGES_DIR: badgesDir,
    THUMBS_DIR: thumbsDir,
    HEADSHOTS_DIR: headshotsDir,
    ADMIN_TOKEN: TEST_ADMIN_TOKEN,
    THUMB_WIDTH: 320,
    HEADSHOT_WIDTH: 200,
  };

  registerPublicRoutes(app, sharedDeps);
  registerAdminRoutes(app, sharedDeps);

  return { app, tmpDir, dbPath };
}

/**
 * Clean up temp directory and close DB.
 */
export function cleanup(ctx: TestContext) {
  closeDb();
  resetRateLimits();
  try {
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  currentTmpDir = null;
}

/**
 * Make an authenticated admin request.
 */
export function adminRequest(app: Hono, method: string, path: string, body?: any): Promise<Response> {
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  return app.request(path, opts);
}

/**
 * Make a public request (no auth).
 */
export function publicRequest(app: Hono, method: string, path: string, body?: any, headers?: Record<string, string>): Promise<Response> {
  const opts: RequestInit = {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  return app.request(path, opts);
}

/** Valid badge creation payload */
export function validBadgePayload(overrides?: Record<string, any>) {
  return {
    name: 'Test User',
    department: 'PRINTER JAMS',
    title: 'Senior Jam Specialist',
    song: 'THE MEMO',
    accessLevel: 'PAPER JAM CLEARANCE',
    accessCss: 'paper-jam',
    ...overrides,
  };
}
