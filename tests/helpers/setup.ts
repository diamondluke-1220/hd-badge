// Test harness: a temp SQLite DB and the real app from src/app.ts, with the
// renderer and live stream stubbed. No browser is needed.
//
// Every request arrives from a loopback peer with proxy trust on, so a test
// sets its client address with X-Forwarded-For (127.0.0.1 when absent).

import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDb, closeDb } from '../../src/db';
import { resetRateLimits } from '../../src/rate-limit';
import { createApp, type AppDeps } from '../../src/app';

export const TEST_ADMIN_TOKEN = 'test-admin-token-12345';

/** A minimal 1x1 PNG, returned by the stub renderer. */
const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** A stand-in for Bun's server that reports every request as coming from `address`. */
function serverWithPeer(address: string) {
  return { requestIP: () => ({ address, family: address.includes(':') ? 'IPv6' : 'IPv4', port: 40000 }) };
}

export interface TestApp {
  request(path: string, init?: RequestInit): Promise<Response>;
}

interface TestContext {
  app: TestApp;
  tmpDir: string;
  dbPath: string;
}

/**
 * Builds the real app on a fresh temp DB and data folders. `overrides`
 * replaces any service or setting (e.g. a renderer that fails); `opts.peer`
 * sets the socket address requests come from. Call cleanup() when done.
 */
export function createTestApp(overrides: Partial<AppDeps> = {}, opts: { peer?: string } = {}): TestContext {
  const tmpDir = mkdtempSync(join(tmpdir(), 'hdbadge-test-'));
  const dirs = {
    PHOTOS_DIR: join(tmpDir, 'photos'),
    BADGES_DIR: join(tmpDir, 'badges'),
    THUMBS_DIR: join(tmpDir, 'thumbs'),
    HEADSHOTS_DIR: join(tmpDir, 'headshots'),
    PRINTS_DIR: join(tmpDir, 'prints'),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });

  const dbPath = join(tmpDir, 'test.db');
  initDb(dbPath);

  const { app: honoApp } = createApp({
    ...dirs,
    THUMB_WIDTH: 320,
    HEADSHOT_WIDTH: 200,
    adminToken: TEST_ADMIN_TOKEN,
    adminLocalOnly: () => false,
    proxyTrust: () => ({ trustProxy: true, trustedProxies: [] }),
    renderBadgePlaywright: async () => STUB_PNG,
    renderPageScreenshot: async () => STUB_PNG,
    broadcastNewBadge: () => {},
    broadcastSSE: () => {},
    connectLiveStream: () => new Response(null, { status: 204 }),
    ...overrides,
  });

  const app: TestApp = {
    request: async (path, init) => honoApp.request(path, init, serverWithPeer(opts.peer ?? '127.0.0.1')),
  };
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
}

/**
 * Make an authenticated admin request.
 */
export function adminRequest(app: TestApp, method: string, path: string, body?: any): Promise<Response> {
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
export function publicRequest(app: TestApp, method: string, path: string, body?: any, headers?: Record<string, string>): Promise<Response> {
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

/** Extract hd_token cookie value from a response's Set-Cookie header */
export function extractTokenCookie(res: Response): string | null {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = setCookie.match(/hd_token=([^;]+)/);
  return match ? match[1] : null;
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
