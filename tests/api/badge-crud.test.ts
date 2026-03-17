import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestApp, cleanup, publicRequest, validBadgePayload } from '../helpers/setup';

let ctx: ReturnType<typeof createTestApp>;

describe('Badge CRUD', () => {
  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(() => {
    cleanup(ctx);
  });

  it('creates a badge with valid payload', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/badge', validBadgePayload());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.employeeId).toMatch(/^HD-\d{5}$/);
    expect(json.deleteToken).toBeTruthy();
  });

  it('rejects badge with missing name', async () => {
    const { name, ...payload } = validBadgePayload();
    const res = await publicRequest(ctx.app, 'POST', '/api/badge', payload);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('rejects badge with missing department', async () => {
    const { department, ...payload } = validBadgePayload();
    const res = await publicRequest(ctx.app, 'POST', '/api/badge', payload);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('rejects badge with profanity-blocked name', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'hitler fan' }),
      { 'x-forwarded-for': '10.99.0.1' }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('flagged');
  });

  it('gets badge by employee ID', async () => {
    // Create a badge first
    const createRes = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Get Test' }),
      { 'x-forwarded-for': '10.99.0.2' }
    );
    const { employeeId } = await createRes.json();

    const res = await publicRequest(ctx.app, 'GET', `/api/badge/${employeeId}`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe('GET TEST');
    expect(json.department).toBe('PRINTER JAMS');
    expect(json.title).toBeTruthy();
    expect(json.song).toBeTruthy();
    expect(json.accessLevel).toBeTruthy();
    expect(json.accessCss).toBeTruthy();
  });

  it('returns 404 for nonexistent badge', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/badge/HD-99999');
    expect(res.status).toBe(404);
  });

  it('deletes badge with correct token', async () => {
    const createRes = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Delete Me' }),
      { 'x-forwarded-for': '10.99.0.3' }
    );
    const { employeeId, deleteToken } = await createRes.json();

    const delRes = await publicRequest(ctx.app, 'DELETE', `/api/badge/${employeeId}?token=${deleteToken}`);
    expect(delRes.status).toBe(200);

    // Badge should now be not found (hidden)
    const getRes = await publicRequest(ctx.app, 'GET', `/api/badge/${employeeId}`);
    expect(getRes.status).toBe(404);
  });

  it('rejects delete with wrong token', async () => {
    // Use a band member which always exists
    const res = await publicRequest(ctx.app, 'DELETE', '/api/badge/HD-00001?token=wrong-token');
    expect(res.status).toBe(403);
  });

  it('rejects delete without token', async () => {
    const res = await publicRequest(ctx.app, 'DELETE', '/api/badge/HD-00001');
    expect(res.status).toBe(400);
  });

  it('orgchart returns paginated list with band members', async () => {
    const res = await publicRequest(ctx.app, 'GET', '/api/orgchart');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.badges).toBeArray();
    expect(json.total).toBeGreaterThanOrEqual(5);
    expect(json.page).toBe(1);
    expect(json.pages).toBeGreaterThanOrEqual(1);

    // Band members should be present
    const bandMembers = json.badges.filter((b: any) => b.isBandMember);
    expect(bandMembers.length).toBe(5);
  });
});
