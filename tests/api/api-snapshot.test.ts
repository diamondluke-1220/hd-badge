// Records the status, content type and body of every read route, plus a
// create → edit → flag → delete flow and the common error paths, against a
// fresh database. A refactor that changes any response fails this test; an
// intended change is accepted with `bun test --update-snapshots`.
//
// Generated IDs, tokens and timestamps are replaced with stable placeholders
// before comparing, so only real differences show.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestApp, cleanup, publicRequest, adminRequest, validBadgePayload, extractTokenCookie } from '../helpers/setup';

type Step = { label: string; status: number; type: string; body: unknown };

function maskText(text: string, ids: Map<string, string>): string {
  return text
    .replace(/HD-(?!0000[1-5]\b)[0-9A-Z]{5}\b/g, id => {
      if (!ids.has(id)) ids.set(id, `HD-FAN${ids.size + 1}`);
      return ids.get(id)!;
    })
    .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<timestamp>')
    .replace(/"\d{4}-\d{2}-\d{2}"/g, '"<date>"')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/[0-9a-f]{64}/g, '<hash>');
}

async function record(label: string, res: Response, ids: Map<string, string>): Promise<Step> {
  const type = (res.headers.get('content-type') || '').split(';')[0];
  let body: unknown;
  if (type.startsWith('image/') || type === 'application/octet-stream' || type === 'application/zip') {
    body = `<binary ${(await res.arrayBuffer()).byteLength} bytes>`;
  } else {
    const text = maskText(await res.text(), ids);
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { label: maskText(label, ids), status: res.status, type, body };
}

describe('API snapshot', () => {
  let ctx: ReturnType<typeof createTestApp>;
  beforeAll(() => { ctx = createTestApp(); });
  afterAll(() => cleanup(ctx));

  it('every read route and the badge lifecycle respond as recorded', async () => {
    const ids = new Map<string, string>();
    const steps: Step[] = [];
    const ip = { 'x-forwarded-for': '10.97.0.1' };
    const pub = async (label: string, method: string, path: string, body?: any, headers: Record<string, string> = ip) =>
      steps.push(await record(label, await publicRequest(ctx.app, method, path, body, headers), ids));
    const adm = async (label: string, method: string, path: string, body?: any) =>
      steps.push(await record(label, await adminRequest(ctx.app, method, path, body), ids));

    // Public reads on the seeded band
    await pub('orgchart', 'GET', '/api/orgchart');
    await pub('orgchart page 2', 'GET', '/api/orgchart?page=2&limit=2');
    await pub('orgchart by division', 'GET', '/api/orgchart?division=EXECUTIVE%20TEAM');
    await pub('orgchart stats', 'GET', '/api/orgchart/stats');
    await pub('site config', 'GET', '/api/site-config');
    await pub('band badge', 'GET', '/api/badge/HD-00001');
    await pub('missing badge', 'GET', '/api/badge/HD-99999');

    // Lifecycle
    const created = await publicRequest(ctx.app, 'POST', '/api/badge', validBadgePayload({ name: 'SNAP FAN' }), ip);
    const token = extractTokenCookie(created);
    const createdStep = await record('create badge', created, ids);
    steps.push(createdStep);
    const fanId = [...ids.entries()][0]?.[0];
    expect(fanId).toBeDefined();
    const owner = { ...ip, cookie: `hd_token=${token}` };

    await pub('fan badge', 'GET', `/api/badge/${fanId}`);
    await pub('fan badge image', 'GET', `/api/badge/${fanId}/image`);
    await pub('edit badge', 'PUT', `/api/badge/${fanId}`, validBadgePayload({ name: 'SNAP EDITED' }), owner);
    await pub('edit with wrong token', 'PUT', `/api/badge/${fanId}`, validBadgePayload(), { ...ip, cookie: 'hd_token=wrong' });
    await pub('create missing name', 'POST', '/api/badge', { department: 'PRINTER JAMS' });
    await pub('game score', 'POST', '/api/game/score', { employeeId: fanId, score: 1200, level: 3, durationMs: 60000 });

    // Admin reads and writes
    await adm('admin flag', 'POST', `/api/admin/badge/${fanId}/flag`);
    await adm('admin paid', 'POST', `/api/admin/badge/${fanId}/paid`);
    for (const path of [
      '/api/admin/badges', '/api/admin/badges?status=flagged', '/api/admin/badges?search=SNAP',
      '/api/admin/stats', '/api/admin/analytics', '/api/admin/divisions',
      '/api/admin/badges/print-queue', '/api/admin/export/csv',
      '/api/admin/demo/status', '/api/admin/presentation/status', '/api/admin/show-mode/status',
      '/api/presentation/status', `/api/admin/badge/${fanId}/print`,
    ]) {
      await adm(`admin GET ${path}`, 'GET', path);
    }
    steps.push(await record('admin without token', await publicRequest(ctx.app, 'GET', '/api/admin/stats'), ids));

    // Delete
    await pub('delete with wrong token', 'DELETE', `/api/badge/${fanId}`, undefined, { ...ip, cookie: 'hd_token=wrong' });
    await pub('delete badge', 'DELETE', `/api/badge/${fanId}`, undefined, owner);
    await pub('deleted badge', 'GET', `/api/badge/${fanId}`);

    expect(steps).toMatchSnapshot();
  });
});
