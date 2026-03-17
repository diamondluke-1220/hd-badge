import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestApp, cleanup, publicRequest, validBadgePayload } from '../helpers/setup';
import { resetRateLimits } from '../../src/rate-limit';

let ctx: ReturnType<typeof createTestApp>;

describe('Org Chart', () => {
  beforeAll(async () => {
    ctx = createTestApp();

    // Create a few test badges for orgchart tests
    resetRateLimits();
    await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Org Test 1', department: 'PRINTER JAMS' }),
      { 'x-forwarded-for': '10.2.0.1' }
    );
    resetRateLimits();
    await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Org Test 2', department: 'WATERCOOLER SERVICES' }),
      { 'x-forwarded-for': '10.2.0.2' }
    );
  });

  afterAll(() => {
    cleanup(ctx);
  });

  it('returns paginated badge list', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/orgchart');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.badges).toBeArray();
    expect(json.total).toBeGreaterThanOrEqual(7); // 5 band + 2 test
    expect(json.page).toBe(1);
    expect(json.pages).toBeGreaterThanOrEqual(1);
  });

  it('respects limit parameter', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/orgchart?limit=2');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.badges.length).toBe(2);
  });

  it('filters by division', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/orgchart?division=EXECUTIVE%20TEAM');
    expect(res.status).toBe(200);
    const json = await res.json();
    // Executive team contains only band member departments
    for (const badge of json.badges) {
      expect(badge.isBandMember).toBe(true);
    }
  });

  it('filters by department', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/orgchart?department=PRINTER%20JAMS');
    expect(res.status).toBe(200);
    const json = await res.json();
    for (const badge of json.badges) {
      expect(badge.department).toBe('PRINTER JAMS');
    }
    expect(json.badges.length).toBeGreaterThanOrEqual(1);
  });

  it('stats returns correct shape', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/orgchart/stats');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.totalBadges).toBeNumber();
    expect(json.visible).toBeNumber();
    expect(json.bandMembers).toBe(5);
    expect(json.byDepartment).toBeObject();
  });

  it('stats sparkline is an array', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/orgchart/stats');
    const json = await res.json();
    expect(json.sparkline).toBeArray();
  });
});
