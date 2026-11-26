// The admin gate's two settings: ADMIN_LOCAL_ONLY (loopback peers only) and a
// missing ADMIN_TOKEN (admin API disabled).

import { describe, it, expect, afterEach } from 'bun:test';
import { createTestApp, cleanup, TEST_ADMIN_TOKEN } from '../helpers/setup';

let ctx: ReturnType<typeof createTestApp> | null = null;
afterEach(() => { if (ctx) cleanup(ctx); ctx = null; });

const withToken = { headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } };

describe('ADMIN_LOCAL_ONLY', () => {
  it('refuses the admin API and hides the admin page from a non-loopback peer', async () => {
    ctx = createTestApp({ adminLocalOnly: () => true }, { peer: '172.20.0.11' });
    const api = await ctx.app.request('/api/admin/stats', withToken);
    expect(api.status).toBe(403);
    expect(await api.json()).toEqual({ success: false, error: 'Admin access restricted to localhost.' });
    expect((await ctx.app.request('/admin')).status).toBe(404);
    expect((await ctx.app.request('/admin.html')).status).toBe(404);
  });

  it('does not let a forwarded header pass the local-only check', async () => {
    ctx = createTestApp({ adminLocalOnly: () => true }, { peer: '172.20.0.11' });
    const res = await ctx.app.request('/api/admin/stats', { headers: { ...withToken.headers, 'cf-connecting-ip': '127.0.0.1' } });
    expect(res.status).toBe(403);
  });

  it('serves a loopback peer as usual', async () => {
    ctx = createTestApp({ adminLocalOnly: () => true }, { peer: '127.0.0.1' });
    expect((await ctx.app.request('/api/admin/stats', withToken)).status).toBe(200);
    expect((await ctx.app.request('/admin')).status).toBe(200);
  });
});

describe('no ADMIN_TOKEN', () => {
  it('disables the admin API, whatever token is sent', async () => {
    ctx = createTestApp({ adminToken: '' });
    const res = await ctx.app.request('/api/admin/stats', withToken);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Admin panel disabled. Set ADMIN_TOKEN env var.' });
  });
});
