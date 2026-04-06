// Smoke tests for /api/admin/demo/* and /api/admin/presentation/* routes
// Coverage added post-rack-view-sprint — these endpoints drive live show
// features (demo mode + presentation rotation) and had zero tests before.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { createTestApp, cleanup, adminRequest, publicRequest } from '../helpers/setup';
import { stopDemo, getDemoStatus } from '../../src/demo';
import { stopPresentation, isPresentationActive } from '../../src/presentation';

let ctx: ReturnType<typeof createTestApp>;

describe('Demo Mode API', () => {
  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(() => {
    // Make sure nothing is left running
    if (getDemoStatus().running) stopDemo();
    cleanup(ctx);
  });

  // Reset demo state between tests since module-level state persists
  beforeEach(() => {
    if (getDemoStatus().running) stopDemo();
  });

  it('status returns running=false when no demo active', async () => {
    const res = await adminRequest(ctx.app, 'GET', '/api/admin/demo/status');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.running).toBe(false);
    expect(body.created).toBe(0);
    expect(body.total).toBe(0);
  });

  it('status endpoint requires admin auth', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/admin/demo/status');
    expect(res.status).toBe(401);
  });

  it('start kicks off a demo and returns success', async () => {
    const res = await adminRequest(ctx.app, 'POST', '/api/admin/demo/start', {
      count: 5,     // minimum
      duration: 900, // long enough that badges don't actually create during this test
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);

    // Verify status now reflects running state
    const statusRes = await adminRequest(ctx.app, 'GET', '/api/admin/demo/status');
    const status = await statusRes.json() as any;
    expect(status.running).toBe(true);
    expect(status.total).toBe(5);
  });

  it('start rejects if demo already running', async () => {
    // Start first
    await adminRequest(ctx.app, 'POST', '/api/admin/demo/start', { count: 5, duration: 900 });

    // Second start should fail
    const res = await adminRequest(ctx.app, 'POST', '/api/admin/demo/start', { count: 5, duration: 900 });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  it('stop halts a running demo', async () => {
    await adminRequest(ctx.app, 'POST', '/api/admin/demo/start', { count: 5, duration: 900 });

    const res = await adminRequest(ctx.app, 'POST', '/api/admin/demo/stop');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);

    // Status should reflect stopped state
    const statusRes = await adminRequest(ctx.app, 'GET', '/api/admin/demo/status');
    const status = await statusRes.json() as any;
    expect(status.running).toBe(false);
  });

  it('stop returns error when no demo running', async () => {
    const res = await adminRequest(ctx.app, 'POST', '/api/admin/demo/stop');
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  it('cleanup endpoint returns a count', async () => {
    const res = await adminRequest(ctx.app, 'POST', '/api/admin/demo/cleanup');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.deleted).toBeNumber();
  });

  it('start clamps count below 5 to 5', async () => {
    const res = await adminRequest(ctx.app, 'POST', '/api/admin/demo/start', {
      count: 1,    // below min
      duration: 900,
    });
    expect(res.status).toBe(200);
    const statusRes = await adminRequest(ctx.app, 'GET', '/api/admin/demo/status');
    const status = await statusRes.json() as any;
    expect(status.total).toBe(5); // clamped
  });

  it('start clamps count above 100 to 100', async () => {
    const res = await adminRequest(ctx.app, 'POST', '/api/admin/demo/start', {
      count: 500,   // above max
      duration: 900,
    });
    expect(res.status).toBe(200);
    const statusRes = await adminRequest(ctx.app, 'GET', '/api/admin/demo/status');
    const status = await statusRes.json() as any;
    expect(status.total).toBe(100); // clamped
  });
});

describe('Presentation Mode API', () => {
  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(() => {
    if (isPresentationActive()) stopPresentation();
    cleanup(ctx);
  });

  // Module-level state persists — reset between tests
  beforeEach(() => {
    if (isPresentationActive()) stopPresentation();
  });

  afterEach(() => {
    // Paranoia: ensure no timers leak into the next test
    if (isPresentationActive()) stopPresentation();
  });

  it('status returns inactive state when not running (admin)', async () => {
    const res = await adminRequest(ctx.app, 'GET', '/api/admin/presentation/status');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.active).toBe(false);
    expect(body.phase).toBe('inactive');
    expect(body.chyronMessages).toBeArray();
  });

  it('public status endpoint works without auth', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/presentation/status');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.active).toBe(false);
    expect(body.phase).toBe('inactive');
    // Public state should NOT leak chyronMessages
    expect(body.chyronMessages).toBeUndefined();
  });

  it('admin status endpoint requires auth', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/admin/presentation/status');
    expect(res.status).toBe(401);
  });

  it('start transitions to band_intro phase', async () => {
    const res = await adminRequest(ctx.app, 'POST', '/api/admin/presentation/start', {});
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.phase).toBe('band_intro');
    expect(body.bandMembers).toBe(5);

    // Status should reflect active state with band_intro phase
    const statusRes = await adminRequest(ctx.app, 'GET', '/api/admin/presentation/status');
    const status = await statusRes.json() as any;
    expect(status.active).toBe(true);
    expect(status.phase).toBe('band_intro');
    expect(status.bandIntroIndex).toBe(0);
  });

  it('start accepts custom chyron messages', async () => {
    const custom = ['Custom message 1', 'Custom message 2'];
    await adminRequest(ctx.app, 'POST', '/api/admin/presentation/start', {
      chyronMessages: custom,
    });

    const statusRes = await adminRequest(ctx.app, 'GET', '/api/admin/presentation/status');
    const status = await statusRes.json() as any;
    expect(status.chyronMessages).toEqual(custom);
  });

  it('start rejects if presentation already running', async () => {
    await adminRequest(ctx.app, 'POST', '/api/admin/presentation/start', {});

    const res = await adminRequest(ctx.app, 'POST', '/api/admin/presentation/start', {});
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  it('stop halts a running presentation', async () => {
    await adminRequest(ctx.app, 'POST', '/api/admin/presentation/start', {});

    const res = await adminRequest(ctx.app, 'POST', '/api/admin/presentation/stop');
    expect(res.status).toBe(200);

    // Status should reflect inactive state
    const statusRes = await adminRequest(ctx.app, 'GET', '/api/admin/presentation/status');
    const status = await statusRes.json() as any;
    expect(status.active).toBe(false);
    expect(status.phase).toBe('inactive');
  });

  it('stop returns error when not running', async () => {
    const res = await adminRequest(ctx.app, 'POST', '/api/admin/presentation/stop');
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  it('chyron endpoint updates messages on a running presentation', async () => {
    await adminRequest(ctx.app, 'POST', '/api/admin/presentation/start', {});

    const newMessages = ['Updated chyron 1', 'Updated chyron 2', 'Updated 3'];
    const res = await adminRequest(ctx.app, 'POST', '/api/admin/presentation/chyron', {
      messages: newMessages,
    });
    expect(res.status).toBe(200);

    const statusRes = await adminRequest(ctx.app, 'GET', '/api/admin/presentation/status');
    const status = await statusRes.json() as any;
    expect(status.chyronMessages).toEqual(newMessages);
  });

  it('chyron filters non-string and empty entries', async () => {
    await adminRequest(ctx.app, 'POST', '/api/admin/presentation/start', {});

    const mixed: any = ['Valid', 123, '  ', 'Also valid', null, ''];
    await adminRequest(ctx.app, 'POST', '/api/admin/presentation/chyron', { messages: mixed });

    const statusRes = await adminRequest(ctx.app, 'GET', '/api/admin/presentation/status');
    const status = await statusRes.json() as any;
    // Only the two valid non-empty strings should survive
    expect(status.chyronMessages).toEqual(['Valid', 'Also valid']);
  });

  it('skip-intro advances from band_intro to rotation', async () => {
    await adminRequest(ctx.app, 'POST', '/api/admin/presentation/start', {});

    const res = await adminRequest(ctx.app, 'POST', '/api/admin/presentation/skip-intro');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);

    // Phase should now be rotation, on the first view (grid)
    const statusRes = await adminRequest(ctx.app, 'GET', '/api/admin/presentation/status');
    const status = await statusRes.json() as any;
    expect(status.phase).toBe('rotation');
    expect(status.currentView).toBe('grid');
  });

  it('skip-intro returns error when presentation not running', async () => {
    const res = await adminRequest(ctx.app, 'POST', '/api/admin/presentation/skip-intro');
    expect(res.status).toBe(400);
  });

  it('skip-intro returns error when already in rotation phase', async () => {
    await adminRequest(ctx.app, 'POST', '/api/admin/presentation/start', {});
    await adminRequest(ctx.app, 'POST', '/api/admin/presentation/skip-intro'); // first skip → rotation

    // Second skip should fail since we're no longer in band_intro
    const res = await adminRequest(ctx.app, 'POST', '/api/admin/presentation/skip-intro');
    expect(res.status).toBe(400);
  });

  it('rotation starts on the first view in VIEW_ORDER (grid)', async () => {
    await adminRequest(ctx.app, 'POST', '/api/admin/presentation/start', {});
    await adminRequest(ctx.app, 'POST', '/api/admin/presentation/skip-intro');

    const statusRes = await adminRequest(ctx.app, 'GET', '/api/admin/presentation/status');
    const status = await statusRes.json() as any;
    // Guards against accidental VIEW_ORDER reordering — rotation must start at grid
    expect(status.currentView).toBe('grid');
  });
});
