// fail() is the one way the server answers with an error.

import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import { fail } from '../../src/http';

describe('fail', () => {
  it('answers { success: false, error } with the given status', async () => {
    const app = new Hono();
    app.get('/x', c => fail(c, 404, 'Badge not found.'));
    const res = await app.request('/x');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ success: false, error: 'Badge not found.' });
  });
});
