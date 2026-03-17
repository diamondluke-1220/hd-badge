import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestApp, cleanup, adminRequest, publicRequest, TEST_ADMIN_TOKEN } from '../helpers/setup';

let ctx: ReturnType<typeof createTestApp>;

describe('Admin Auth', () => {
  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(() => {
    cleanup(ctx);
  });

  it('rejects admin request without token', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/admin/stats');
    expect(res.status).toBe(401);
  });

  it('rejects admin request with wrong token', async () => {
    const res = await ctx.app.request('/api/admin/stats', {
      headers: { 'Authorization': 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts admin request with correct token', async () => {
    const res = await adminRequest(ctx.app, 'GET', '/api/admin/stats');
    expect(res.status).toBe(200);
  });

  it('admin badges returns array', async () => {
    const res = await adminRequest(ctx.app, 'GET', '/api/admin/badges');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.badges).toBeArray();
  });

  it('admin stats has correct shape', async () => {
    const res = await adminRequest(ctx.app, 'GET', '/api/admin/stats');
    const json = await res.json();
    expect(json.totalBadges).toBeNumber();
    expect(json.visible).toBeNumber();
    expect(json.bandMembers).toBe(5);
    expect(json.byDepartment).toBeObject();
  });

  it('admin badges includes band members', async () => {
    const res = await adminRequest(ctx.app, 'GET', '/api/admin/badges');
    const json = await res.json();
    const bandMembers = json.badges.filter((b: any) => b.isBandMember);
    expect(bandMembers.length).toBe(5);
  });

  it('locks out after 5 failed attempts', async () => {
    const lockoutIp = '10.0.0.99';
    const headers = { 'x-forwarded-for': lockoutIp };

    // Make 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await ctx.app.request('/api/admin/stats', {
        headers: { ...headers, 'Authorization': 'Bearer wrong' },
      });
    }

    // 6th attempt should be locked out (429)
    const res = await ctx.app.request('/api/admin/stats', {
      headers: { ...headers, 'Authorization': 'Bearer wrong' },
    });
    expect(res.status).toBe(429);
  });

  it('lockout blocks even correct token from locked IP', async () => {
    const lockoutIp = '10.0.0.98';
    const headers = { 'x-forwarded-for': lockoutIp };

    // Trigger lockout
    for (let i = 0; i < 5; i++) {
      await ctx.app.request('/api/admin/stats', {
        headers: { ...headers, 'Authorization': 'Bearer wrong' },
      });
    }

    // Correct token from locked IP should still be blocked
    const res = await ctx.app.request('/api/admin/stats', {
      headers: { ...headers, 'Authorization': `Bearer ${TEST_ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(429);
  });
});
