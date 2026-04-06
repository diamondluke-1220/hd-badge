import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { createTestApp, cleanup, publicRequest, validBadgePayload } from '../helpers/setup';
import { resetRateLimits } from '../../src/rate-limit';

let ctx: ReturnType<typeof createTestApp>;
let testBadgeId: string;

describe('Game Score API', () => {
  beforeAll(async () => {
    ctx = createTestApp();

    // Create one real badge to submit scores for
    const res = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Game Score Test' }),
      { 'x-forwarded-for': '10.2.0.1' }
    );
    const body = await res.json() as any;
    testBadgeId = body.employeeId;
  });

  afterAll(() => {
    cleanup(ctx);
  });

  beforeEach(() => {
    resetRateLimits();
  });

  const validScore = (overrides?: Record<string, any>) => ({
    employeeId: testBadgeId,
    profit: 5000,
    floor: 12,
    perksUsed: ['coffee', 'donuts'],
    cardsPlayed: 42,
    win: true,
    ...overrides,
  });

  it('accepts a valid score submission', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/game/score', validScore(),
      { 'x-forwarded-for': '10.2.0.10' }
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('rejects missing employeeId', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/game/score',
      validScore({ employeeId: undefined }),
      { 'x-forwarded-for': '10.2.0.11' }
    );
    expect(res.status).toBe(400);
  });

  it('rejects unknown employeeId with 404', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/game/score',
      validScore({ employeeId: 'HD-00000' }),
      { 'x-forwarded-for': '10.2.0.12' }
    );
    expect(res.status).toBe(404);
  });

  it('rejects non-boolean win field', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/game/score',
      validScore({ win: 'yes' }),
      { 'x-forwarded-for': '10.2.0.13' }
    );
    expect(res.status).toBe(400);
  });

  it('rejects out-of-range profit', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/game/score',
      validScore({ profit: 9_999_999 }),
      { 'x-forwarded-for': '10.2.0.14' }
    );
    expect(res.status).toBe(400);
  });

  it('rejects out-of-range floor', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/game/score',
      validScore({ floor: 200 }),
      { 'x-forwarded-for': '10.2.0.15' }
    );
    expect(res.status).toBe(400);
  });

  it('rejects out-of-range cardsPlayed', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/game/score',
      validScore({ cardsPlayed: 99999 }),
      { 'x-forwarded-for': '10.2.0.16' }
    );
    expect(res.status).toBe(400);
  });

  it('rejects perksUsed with too many items', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/game/score',
      validScore({ perksUsed: Array(51).fill('perk') }),
      { 'x-forwarded-for': '10.2.0.17' }
    );
    expect(res.status).toBe(400);
  });

  it('rejects perksUsed with non-string items', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/game/score',
      validScore({ perksUsed: ['valid', 123, 'also-valid'] }),
      { 'x-forwarded-for': '10.2.0.18' }
    );
    expect(res.status).toBe(400);
  });

  it('rejects perksUsed string longer than 50 chars', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/game/score',
      validScore({ perksUsed: ['x'.repeat(51)] }),
      { 'x-forwarded-for': '10.2.0.19' }
    );
    expect(res.status).toBe(400);
  });

  it('rate limits after 30 submissions in an hour', async () => {
    const ip = '10.2.0.20';

    for (let i = 0; i < 30; i++) {
      const res = await publicRequest(ctx.app, 'POST', '/api/game/score', validScore(),
        { 'x-forwarded-for': ip }
      );
      expect(res.status).toBe(200);
    }

    // 31st should be rate limited
    const res = await publicRequest(ctx.app, 'POST', '/api/game/score', validScore(),
      { 'x-forwarded-for': ip }
    );
    expect(res.status).toBe(429);
  });

  it('game score rate limit is independent of badge creation limit', async () => {
    const ip = '10.2.0.21';

    // Hammer game scores up to the game limit
    for (let i = 0; i < 10; i++) {
      const res = await publicRequest(ctx.app, 'POST', '/api/game/score', validScore(),
        { 'x-forwarded-for': ip }
      );
      expect(res.status).toBe(200);
    }

    // Badge creation should still work for this IP — different bucket
    const res = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Independent Rate Test' }),
      { 'x-forwarded-for': ip }
    );
    expect(res.status).toBe(200);
  });

  it('defaults missing perksUsed and cardsPlayed to safe values', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/game/score',
      {
        employeeId: testBadgeId,
        profit: 100,
        floor: 1,
        win: false,
        // perksUsed and cardsPlayed omitted
      },
      { 'x-forwarded-for': '10.2.0.22' }
    );
    expect(res.status).toBe(200);
  });
});
