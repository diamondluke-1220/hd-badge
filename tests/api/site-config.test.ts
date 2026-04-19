import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { createTestApp, cleanup, publicRequest } from '../helpers/setup';

let ctx: ReturnType<typeof createTestApp>;

describe('GET /api/site-config', () => {
  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(() => {
    cleanup(ctx);
  });

  afterEach(() => {
    delete process.env.BOM_VOTE_OVERRIDE;
  });

  it('returns 200 with voteBannerActive boolean', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/site-config');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.voteBannerActive).toBe('boolean');
  });

  it('is public — requires no auth header', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/site-config');
    expect(res.status).toBe(200);
  });

  it('respects BOM_VOTE_OVERRIDE=on', async () => {
    process.env.BOM_VOTE_OVERRIDE = 'on';
    const res = await publicRequest(ctx.app, 'GET', '/api/site-config');
    const json = await res.json();
    expect(json.voteBannerActive).toBe(true);
  });

  it('respects BOM_VOTE_OVERRIDE=off', async () => {
    process.env.BOM_VOTE_OVERRIDE = 'off';
    const res = await publicRequest(ctx.app, 'GET', '/api/site-config');
    const json = await res.json();
    expect(json.voteBannerActive).toBe(false);
  });

  it('sets a cache header', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/site-config');
    const cache = res.headers.get('cache-control');
    expect(cache).toBeTruthy();
    expect(cache).toContain('max-age');
  });
});
