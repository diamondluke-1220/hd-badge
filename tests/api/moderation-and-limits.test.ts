import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import {
  createTestApp,
  cleanup,
  publicRequest,
  adminRequest,
  validBadgePayload,
  extractTokenCookie,
  TEST_ADMIN_TOKEN,
} from '../helpers/setup';

// Regression tests for the 2026-08-27 review — backend batch.
//
//   1. Hiding a badge must actually stop its images being served publicly.
//   2. Public stats must not leak hidden badges or moderation counts.
//   3. waveStyle must be allowlisted (an unvalidated value permanently bricked
//      that badge's render).
//   4. Badge edits must be rate limited and must not consume the creation quota.
//   5. Non-string required fields must return themed JSON, not a raw 500.

let ctx: ReturnType<typeof createTestApp>;

/** Create a badge and return its id plus the auth cookie header value. */
async function makeBadge(overrides?: Record<string, any>) {
  const res = await publicRequest(ctx.app, 'POST', '/api/badge', validBadgePayload(overrides));
  const json = await res.json();
  const token = extractTokenCookie(res);
  return { id: json.employeeId as string, cookie: `hd_token=${token}` };
}

describe('Hidden badges are not served publicly', () => {
  beforeAll(() => { ctx = createTestApp(); });
  afterAll(() => { cleanup(ctx); });

  it('404s image, thumb, and headshot once hidden — but still serves them to admin', async () => {
    const { id } = await makeBadge({ name: 'Hide Me' });

    // Visible: the JSON endpoint is reachable.
    expect((await publicRequest(ctx.app, 'GET', `/api/badge/${id}`)).status).toBe(200);

    const hide = await adminRequest(ctx.app, 'POST', `/api/admin/badge/${id}/hide`);
    expect(hide.status).toBe(200);

    // The JSON endpoint always 404'd when hidden. The image endpoints did not —
    // that was the bug: moderation was cosmetic.
    expect((await publicRequest(ctx.app, 'GET', `/api/badge/${id}`)).status).toBe(404);
    for (const path of [`/api/badge/${id}/image`, `/api/badge/${id}/thumb`, `/api/badge/${id}/headshot`]) {
      const res = await publicRequest(ctx.app, 'GET', path);
      expect(res.status).toBe(404);
    }

    // An admin Bearer still gets through, so the moderation UI can show them.
    for (const path of [`/api/badge/${id}/image`, `/api/badge/${id}/thumb`, `/api/badge/${id}/headshot`]) {
      const res = await publicRequest(ctx.app, 'GET', path, undefined, {
        Authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
      });
      expect(res.status).not.toBe(404);
    }
  });

  it('does not crash or leak on a non-ASCII Authorization header', async () => {
    const { id } = await makeBadge({ name: 'Ascii Test' });
    // Byte length != UTF-16 length here. The old check compared string length
    // then handed mismatched buffers to timingSafeEqual, throwing a RangeError
    // out of a sync handler — an unauthenticated 500 plus a token-length oracle.
    const res = await publicRequest(ctx.app, 'GET', `/api/badge/${id}/image`, undefined, {
      Authorization: 'Bearer ééééééé',
    });
    expect(res.status).not.toBe(500);
  });

  it('keeps hidden badges and moderation counts out of public stats', async () => {
    const { id } = await makeBadge({ name: 'Newest Hire' });
    await adminRequest(ctx.app, 'POST', `/api/admin/badge/${id}/hide`);

    const stats = await (await publicRequest(ctx.app, 'GET', '/api/orgchart/stats')).json();

    // `newest` had no is_visible filter, so it handed out the ID of the badge
    // that was just hidden.
    expect(stats.newest).not.toBe(id);
    // Internal moderation state is admin-only.
    expect(stats.hiddenCount).toBeUndefined();
    expect(stats.flaggedCount).toBeUndefined();

    // The admin endpoint still gets the full object.
    const adminStats = await (await adminRequest(ctx.app, 'GET', '/api/admin/stats')).json();
    expect(typeof adminStats.hiddenCount).toBe('number');
    expect(typeof adminStats.flaggedCount).toBe('number');
  });
});

describe('Input validation', () => {
  beforeAll(() => { ctx = createTestApp(); });
  afterAll(() => { cleanup(ctx); });

  it('rejects an unrecognized waveStyle on create', async () => {
    // "a b" reaches classList.add(style + '-style'), which throws on whitespace.
    // It was committed to the DB before the render, permanently bricking the badge.
    const res = await publicRequest(ctx.app, 'POST', '/api/badge', validBadgePayload({ waveStyle: 'a b' }));
    expect(res.status).toBe(400);
  });

  it('accepts the known waveStyles', async () => {
    for (const style of ['barcode', 'sticker']) {
      const res = await publicRequest(ctx.app, 'POST', '/api/badge', validBadgePayload({ waveStyle: style }));
      expect(res.status).toBe(200);
    }
  });

  it('rejects an unrecognized waveStyle on edit', async () => {
    const { id, cookie } = await makeBadge();
    const res = await publicRequest(
      ctx.app, 'PUT', `/api/badge/${id}`,
      validBadgePayload({ waveStyle: 'a b' }),
      { Cookie: cookie },
    );
    expect(res.status).toBe(400);
  });

  it('returns themed JSON, not a raw 500, for non-string fields', async () => {
    // isNameClean() and .trim() run outside the try block, so a number used to
    // throw a TypeError past the handler into Hono's plain-text 500.
    const res = await publicRequest(ctx.app, 'POST', '/api/badge', {
      name: 1, department: 1, title: 1, song: 1, accessLevel: 1, accessCss: 1,
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});

describe('Edit rate limiting', () => {
  beforeAll(() => { ctx = createTestApp(); });
  afterAll(() => { cleanup(ctx); });

  it('eventually 429s repeated edits instead of allowing unlimited renders', async () => {
    const { id, cookie } = await makeBadge({ name: 'Edit Me' });

    let sawLimit = false;
    // Well past the 30/hour edit ceiling. Previously PUT had no limiter at all,
    // so this loop would run forever, each iteration costing 1-2 serialized
    // Chrome renders.
    for (let i = 0; i < 40; i++) {
      const res = await publicRequest(
        ctx.app, 'PUT', `/api/badge/${id}`,
        validBadgePayload({ name: `Edit ${i}` }),
        { Cookie: cookie },
      );
      if (res.status === 429) { sawLimit = true; break; }
    }
    expect(sawLimit).toBe(true);
  });

  it('does not spend the badge-creation quota on edits', async () => {
    // Fresh app so the edit loop above doesn't bleed in.
    cleanup(ctx);
    ctx = createTestApp();

    const { id, cookie } = await makeBadge({ name: 'Quota Test' });
    for (let i = 0; i < 15; i++) {
      await publicRequest(
        ctx.app, 'PUT', `/api/badge/${id}`,
        validBadgePayload({ name: `Quota ${i}` }),
        { Cookie: cookie },
      );
    }

    // Creation should still be available — edits live in their own bucket.
    const res = await publicRequest(ctx.app, 'POST', '/api/badge', validBadgePayload({ name: 'Still Allowed' }));
    expect(res.status).toBe(200);
  });
});
