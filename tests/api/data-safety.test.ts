// Route-level checks that a fan's or an admin's work is never lost:
// an admin flag survives the owner's edit, a failed re-create keeps the old
// badge, and shredding a badge removes its row.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import {
  createTestApp, cleanup, publicRequest, adminRequest, validBadgePayload, extractTokenCookie,
} from '../helpers/setup';
import { getBadge, getAnalytics } from '../../src/db';

describe('admin flag vs owner edit', () => {
  let ctx: ReturnType<typeof createTestApp>;
  beforeAll(() => { ctx = createTestApp(); });
  afterAll(() => cleanup(ctx));

  it('keeps an admin-set flag when the owner edits with clean text', async () => {
    const created = await publicRequest(ctx.app, 'POST', '/api/badge', validBadgePayload(), { 'x-forwarded-for': '10.98.0.1' });
    const { employeeId } = await created.json();
    const token = extractTokenCookie(created);

    const flagRes = await adminRequest(ctx.app, 'POST', `/api/admin/badge/${employeeId}/flag`);
    expect(flagRes.status).toBe(200);
    expect(getBadge(employeeId)!.is_flagged).toBe(1);

    const edit = await publicRequest(
      ctx.app, 'PUT', `/api/badge/${employeeId}`,
      validBadgePayload({ name: 'EDITED' }),
      { cookie: `hd_token=${token}`, 'x-forwarded-for': '10.98.0.1' },
    );
    expect(edit.status).toBe(200);
    expect(getBadge(employeeId)!.name).toBe('EDITED');
    expect(getBadge(employeeId)!.is_flagged).toBe(1);
  });
});

describe('re-create when the new render fails', () => {
  let ctx: ReturnType<typeof createTestApp>;
  let renderShouldFail = false;
  beforeAll(() => {
    const okPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    ctx = createTestApp({
      renderBadgePlaywright: async () => {
        if (renderShouldFail) throw new Error('render failed');
        return okPng;
      },
    });
  });
  afterAll(() => cleanup(ctx));

  it('keeps the previous badge, visible and editable, when the replacement cannot be made', async () => {
    const first = await publicRequest(ctx.app, 'POST', '/api/badge', validBadgePayload({ name: 'ORIGINAL' }), { 'x-forwarded-for': '10.98.1.1' });
    const { employeeId: oldId } = await first.json();
    const token = extractTokenCookie(first);

    renderShouldFail = true;
    const second = await publicRequest(
      ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'REPLACEMENT', previousBadgeId: oldId }),
      { cookie: `hd_token=${token}`, 'x-forwarded-for': '10.98.1.1' },
    );
    renderShouldFail = false;

    expect(second.status).toBeGreaterThanOrEqual(500);
    const old = getBadge(oldId);
    expect(old).not.toBeNull();
    expect(old!.name).toBe('ORIGINAL');
    expect(old!.is_visible).toBe(1);
  });
});

describe('shredding a badge', () => {
  let ctx: ReturnType<typeof createTestApp>;
  beforeAll(() => { ctx = createTestApp(); });
  afterAll(() => cleanup(ctx));

  it('removes the row, so it leaves the admin list and the analytics counts', async () => {
    const before = getAnalytics().fanBadgeCount;
    const created = await publicRequest(ctx.app, 'POST', '/api/badge', validBadgePayload({ song: 'SHRED ME' }), { 'x-forwarded-for': '10.98.2.1' });
    const { employeeId } = await created.json();
    const token = extractTokenCookie(created);
    expect(getAnalytics().fanBadgeCount).toBe(before + 1);

    const del = await publicRequest(ctx.app, 'DELETE', `/api/badge/${employeeId}`, undefined, { cookie: `hd_token=${token}` });
    expect(del.status).toBe(200);

    expect(getBadge(employeeId)).toBeNull();
    const after = getAnalytics();
    expect(after.fanBadgeCount).toBe(before);
    expect(after.topSongs.some(s => s.name === 'SHRED ME')).toBe(false);
  });

  it('refuses to shred with a wrong token and leaves the row alone', async () => {
    const created = await publicRequest(ctx.app, 'POST', '/api/badge', validBadgePayload(), { 'x-forwarded-for': '10.98.2.2' });
    const { employeeId } = await created.json();
    const del = await publicRequest(ctx.app, 'DELETE', `/api/badge/${employeeId}`, undefined, { cookie: 'hd_token=not-the-token' });
    expect(del.status).toBe(403);
    expect(getBadge(employeeId)).not.toBeNull();
  });
});
