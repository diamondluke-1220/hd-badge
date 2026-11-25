// Deleting a badge, by its owner or by an admin, removes every file stored for it.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createTestApp, cleanup, publicRequest, adminRequest, validBadgePayload, extractTokenCookie } from '../helpers/setup';

let ctx: ReturnType<typeof createTestApp>;

function storedFiles(id: string) {
  return [
    join(ctx.tmpDir, 'badges', `${id}.png`),
    join(ctx.tmpDir, 'badges', `${id}-nophoto.png`),
    join(ctx.tmpDir, 'photos', `${id}.jpg`),
    join(ctx.tmpDir, 'thumbs', `${id}.png`),
    join(ctx.tmpDir, 'headshots', `${id}.jpg`),
  ];
}

async function badgeWithAllFiles(ip: string) {
  const res = await publicRequest(ctx.app, 'POST', '/api/badge', validBadgePayload(), { 'x-forwarded-for': ip });
  const { employeeId } = await res.json();
  for (const f of storedFiles(employeeId)) writeFileSync(f, 'x');
  return { employeeId: employeeId as string, token: extractTokenCookie(res) };
}

beforeAll(() => { ctx = createTestApp(); });
afterAll(() => cleanup(ctx));

describe('badge file removal', () => {
  it('owner delete removes all five files', async () => {
    const { employeeId, token } = await badgeWithAllFiles('10.96.0.1');
    const res = await publicRequest(ctx.app, 'DELETE', `/api/badge/${employeeId}`, undefined, { cookie: `hd_token=${token}` });
    expect(res.status).toBe(200);
    expect(storedFiles(employeeId).filter(existsSync)).toEqual([]);
  });

  it('admin delete removes all five files', async () => {
    const { employeeId } = await badgeWithAllFiles('10.96.0.2');
    const res = await adminRequest(ctx.app, 'DELETE', `/api/admin/badge/${employeeId}`);
    expect(res.status).toBe(200);
    expect(storedFiles(employeeId).filter(existsSync)).toEqual([]);
  });

  it('a wrong-token delete removes nothing', async () => {
    const { employeeId } = await badgeWithAllFiles('10.96.0.3');
    await publicRequest(ctx.app, 'DELETE', `/api/badge/${employeeId}`, undefined, { cookie: 'hd_token=wrong' });
    expect(storedFiles(employeeId).filter(existsSync).length).toBe(5);
  });
});
