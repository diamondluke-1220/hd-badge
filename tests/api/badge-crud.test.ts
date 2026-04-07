import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestApp, cleanup, publicRequest, validBadgePayload, extractTokenCookie } from '../helpers/setup';

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
    // Auth token is in HttpOnly cookie, NOT in JSON response
    expect(json.deleteToken).toBeUndefined();
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('hd_token=');
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

  it('deletes badge with correct cookie', async () => {
    const createRes = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Delete Me' }),
      { 'x-forwarded-for': '10.99.0.3' }
    );
    const { employeeId } = await createRes.json();
    const token = extractTokenCookie(createRes);
    expect(token).toBeTruthy();

    const delRes = await publicRequest(ctx.app, 'DELETE', `/api/badge/${employeeId}`,
      undefined,
      { cookie: `hd_token=${token}` }
    );
    expect(delRes.status).toBe(200);

    // Badge should now be not found (hidden)
    const getRes = await publicRequest(ctx.app, 'GET', `/api/badge/${employeeId}`);
    expect(getRes.status).toBe(404);
  });

  it('rejects delete with wrong cookie', async () => {
    const res = await publicRequest(ctx.app, 'DELETE', '/api/badge/HD-00001',
      undefined,
      { cookie: 'hd_token=wrong-token' }
    );
    expect(res.status).toBe(403);
  });

  it('rejects delete without cookie', async () => {
    const res = await publicRequest(ctx.app, 'DELETE', '/api/badge/HD-00001');
    expect(res.status).toBe(401);
  });

  // ─── Cookie auth ──────────────────────────────────────────

  it('POST /api/badge sets hd_token HttpOnly cookie on success', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Cookie Set' }),
      { 'x-forwarded-for': '10.99.0.10' }
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('hd_token=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });

  it('PUT /api/badge/:id with cookie auth succeeds', async () => {
    const createRes = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Cookie Edit' }),
      { 'x-forwarded-for': '10.99.0.11' }
    );
    const { employeeId } = await createRes.json();
    const token = extractTokenCookie(createRes);

    const res = await publicRequest(ctx.app, 'PUT', `/api/badge/${employeeId}`,
      { ...validBadgePayload({ name: 'Cookie Edit Updated' }) },
      { 'x-forwarded-for': '10.99.0.11', cookie: `hd_token=${token}` }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('PUT /api/badge/:id with body token is rejected (no backward compat)', async () => {
    const createRes = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Body Edit Reject' }),
      { 'x-forwarded-for': '10.99.0.12' }
    );
    const { employeeId } = await createRes.json();
    const token = extractTokenCookie(createRes);

    // Body token without cookie must NOT be honored
    const res = await publicRequest(ctx.app, 'PUT', `/api/badge/${employeeId}`,
      { ...validBadgePayload({ name: 'Should Fail' }), token },
      { 'x-forwarded-for': '10.99.0.12' }
    );
    expect(res.status).toBe(401);
  });

  it('PUT /api/badge/:id with no token returns 401', async () => {
    const createRes = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'No Token Edit' }),
      { 'x-forwarded-for': '10.99.0.13' }
    );
    const { employeeId } = await createRes.json();

    const res = await publicRequest(ctx.app, 'PUT', `/api/badge/${employeeId}`,
      validBadgePayload({ name: 'Should Fail' }),
      { 'x-forwarded-for': '10.99.0.13' }
    );
    expect(res.status).toBe(401);
  });

  it('PUT /api/badge/:id refreshes the cookie on success', async () => {
    const createRes = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Refresh Cookie' }),
      { 'x-forwarded-for': '10.99.0.18' }
    );
    const { employeeId } = await createRes.json();
    const token = extractTokenCookie(createRes);

    const res = await publicRequest(ctx.app, 'PUT', `/api/badge/${employeeId}`,
      validBadgePayload({ name: 'Refreshed Name' }),
      { 'x-forwarded-for': '10.99.0.18', cookie: `hd_token=${token}` }
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('hd_token=');
  });

  it('POST /api/badge/:id/recover with valid token sets cookie', async () => {
    const createRes = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Recover Test' }),
      { 'x-forwarded-for': '10.99.0.15' }
    );
    const { employeeId } = await createRes.json();
    const token = extractTokenCookie(createRes);

    const res = await publicRequest(ctx.app, 'POST', `/api/badge/${employeeId}/recover`,
      { token },
      { 'x-forwarded-for': '10.99.0.15' }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.employeeId).toBe(employeeId);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('hd_token=');
    expect(setCookie).toContain('HttpOnly');
  });

  it('POST /api/badge/:id/recover with invalid token returns 403', async () => {
    const createRes = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Recover Bad' }),
      { 'x-forwarded-for': '10.99.0.16' }
    );
    const { employeeId } = await createRes.json();

    const res = await publicRequest(ctx.app, 'POST', `/api/badge/${employeeId}/recover`,
      { token: 'definitely-not-the-real-token' },
      { 'x-forwarded-for': '10.99.0.16' }
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('POST /api/badge/:id/recover requires token in body', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/badge/HD-00001/recover',
      {},
      { 'x-forwarded-for': '10.99.0.17' }
    );
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
