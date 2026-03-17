import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { createTestApp, cleanup, publicRequest, validBadgePayload } from '../helpers/setup';
import { resetRateLimits } from '../../src/rate-limit';

let ctx: ReturnType<typeof createTestApp>;

describe('Rate Limiting', () => {
  beforeAll(() => {
    ctx = createTestApp();
  });

  afterAll(() => {
    cleanup(ctx);
  });

  beforeEach(() => {
    resetRateLimits();
  });

  it('allows first badge creation', async () => {
    const res = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload(),
      { 'x-forwarded-for': '10.1.0.1' }
    );
    expect(res.status).toBe(200);
  });

  it('blocks after 3 creations (hourly limit)', async () => {
    const ip = '10.1.0.2';

    for (let i = 0; i < 3; i++) {
      const res = await publicRequest(ctx.app, 'POST', '/api/badge',
        validBadgePayload({ name: `Rate Test ${i}` }),
        { 'x-forwarded-for': ip }
      );
      expect(res.status).toBe(200);
    }

    // 4th should be blocked
    const res = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Rate Test 4' }),
      { 'x-forwarded-for': ip }
    );
    expect(res.status).toBe(429);
  });

  it('allows higher limits in show mode', async () => {
    const originalShowMode = process.env.SHOW_MODE;
    process.env.SHOW_MODE = '1';
    const ip = '10.1.0.3';

    try {
      // Should allow more than 3 in show mode (limit is 10/hour)
      for (let i = 0; i < 5; i++) {
        const res = await publicRequest(ctx.app, 'POST', '/api/badge',
          validBadgePayload({ name: `Show Test ${i}` }),
          { 'x-forwarded-for': ip }
        );
        expect(res.status).toBe(200);
      }
    } finally {
      if (originalShowMode) {
        process.env.SHOW_MODE = originalShowMode;
      } else {
        delete process.env.SHOW_MODE;
      }
    }
  });

  it('rate limit message uses themed text', async () => {
    const ip = '10.1.0.4';

    for (let i = 0; i < 3; i++) {
      await publicRequest(ctx.app, 'POST', '/api/badge',
        validBadgePayload({ name: `Theme Test ${i}` }),
        { 'x-forwarded-for': ip }
      );
    }

    const res = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Theme Test 4' }),
      { 'x-forwarded-for': ip }
    );
    const json = await res.json();
    expect(json.error).toContain('overheating');
  });

  it('different IPs have independent limits', async () => {
    // Exhaust limit for IP A
    for (let i = 0; i < 3; i++) {
      await publicRequest(ctx.app, 'POST', '/api/badge',
        validBadgePayload({ name: `IP A ${i}` }),
        { 'x-forwarded-for': '10.1.0.5' }
      );
    }

    // IP B should still be allowed
    const res = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'IP B First' }),
      { 'x-forwarded-for': '10.1.0.6' }
    );
    expect(res.status).toBe(200);
  });

  it('resetRateLimits clears all state', async () => {
    const ip = '10.1.0.7';

    // Exhaust limit
    for (let i = 0; i < 3; i++) {
      await publicRequest(ctx.app, 'POST', '/api/badge',
        validBadgePayload({ name: `Reset Test ${i}` }),
        { 'x-forwarded-for': ip }
      );
    }

    // Should be blocked
    let res = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Reset Blocked' }),
      { 'x-forwarded-for': ip }
    );
    expect(res.status).toBe(429);

    // Reset and try again
    resetRateLimits();
    res = await publicRequest(ctx.app, 'POST', '/api/badge',
      validBadgePayload({ name: 'Reset Cleared' }),
      { 'x-forwarded-for': ip }
    );
    expect(res.status).toBe(200);
  });
});
