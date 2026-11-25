// Records what the real server.ts answers: security headers, the admin gate,
// the 404 handler, the body cap, the /game redirect and the read routes. The
// server split must leave every entry unchanged.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawnRealServer } from '../helpers/spawn-real-server';

const TOKEN = 'real-snapshot-token';
let server: Awaited<ReturnType<typeof spawnRealServer>>;

beforeAll(async () => {
  server = await spawnRealServer({ TRUST_PROXY: '1', TRUSTED_PROXY_IPS: '172.20.0.', ADMIN_TOKEN: TOKEN });
}, 30_000);
afterAll(() => server?.stop());

const KEPT_HEADERS = [
  'content-type', 'location', 'x-content-type-options', 'x-frame-options', 'x-xss-protection',
  'referrer-policy', 'content-security-policy', 'cache-control',
];

function mask(text: string) {
  return text
    .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<timestamp>')
    .replace(/"\d{4}-\d{2}-\d{2}"/g, '"<date>"');
}

async function record(label: string, path: string, init: RequestInit = {}) {
  const res = await fetch(server.baseUrl + path, { redirect: 'manual', ...init });
  const headers: Record<string, string> = {};
  for (const h of KEPT_HEADERS) {
    const v = res.headers.get(h);
    if (v) headers[h] = v;
  }
  const type = headers['content-type'] || '';
  let body: unknown;
  if (type.startsWith('image/')) body = `<binary ${(await res.arrayBuffer()).byteLength} bytes>`;
  else if (type.startsWith('text/html')) body = `<html ${(await res.text()).length} chars>`;
  else {
    const text = mask(await res.text());
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { label, status: res.status, headers, body };
}

describe('real server snapshot', () => {
  it('answers as recorded', async () => {
    const admin = { headers: { authorization: `Bearer ${TOKEN}` } };
    const steps = [
      await record('home page', '/'),
      await record('orgchart page', '/orgchart'),
      await record('game redirect', '/game'),
      await record('orgchart', '/api/orgchart'),
      await record('orgchart stats', '/api/orgchart/stats'),
      await record('site config', '/api/site-config'),
      await record('band badge', '/api/badge/HD-00001'),
      await record('missing badge', '/api/badge/HD-99999'),
      await record('unknown api route', '/api/nope'),
      await record('unknown page (browser)', '/nope', { headers: { accept: 'text/html' } }),
      await record('admin without token', '/api/admin/stats'),
      await record('admin wrong token', '/api/admin/stats', { headers: { authorization: 'Bearer wrong' } }),
      await record('admin stats', '/api/admin/stats', admin),
      await record('admin badges', '/api/admin/badges', admin),
      await record('admin analytics', '/api/admin/analytics', admin),
      await record('admin divisions', '/api/admin/divisions', admin),
      await record('admin csv', '/api/admin/export/csv', admin),
      await record('body over 10 MB', '/api/badge', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pad: 'a'.repeat(11 * 1024 * 1024) }),
      }),
      await record('create with empty body', '/api/badge', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      }),
    ];
    expect(steps).toMatchSnapshot();
  }, 30_000);
});
