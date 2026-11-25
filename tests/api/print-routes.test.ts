// Admin print routes return the renderer's PNG bytes unchanged.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestApp, cleanup, adminRequest } from '../helpers/setup';

const renderedPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('admin print routes', () => {
  let ctx: ReturnType<typeof createTestApp>;
  beforeAll(() => {
    ctx = createTestApp({
      renderBadgePlaywright: async () => renderedPng,
      renderPageScreenshot: async () => renderedPng,
    });
  });
  afterAll(() => cleanup(ctx));

  for (const path of ['/api/admin/badge/HD-00001/print', '/api/admin/badge/HD-00001/print-colorlayer', '/api/admin/print-calibration']) {
    it(`${path} returns the rendered PNG`, async () => {
      const res = await adminRequest(ctx.app, 'GET', path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await res.arrayBuffer()).equals(renderedPng)).toBe(true);
    });
  }
});
