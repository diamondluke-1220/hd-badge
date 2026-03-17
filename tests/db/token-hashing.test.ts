import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDb, closeDb, createBadge, getBadge, softDeleteBadge } from '../../src/db';

let tmpDir: string;
let dbPath: string;

describe('Token Hashing', () => {
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hdbadge-token-'));
    dbPath = join(tmpDir, 'test.db');
    initDb(dbPath);
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createBadge returns raw delete token (UUID format)', () => {
    const result = createBadge({
      name: 'TOKEN TEST',
      department: 'TEST',
      title: 'Tester',
      song: 'TEST SONG',
      accessLevel: 'TEST',
      accessCss: 'test',
      hasPhoto: false,
      photoPublic: true,
    });
    expect(result.deleteToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('stores SHA-256 hash in DB, not raw token', () => {
    const result = createBadge({
      name: 'HASH CHECK',
      department: 'TEST',
      title: 'Tester',
      song: 'TEST SONG',
      accessLevel: 'TEST',
      accessCss: 'test',
      hasPhoto: false,
      photoPublic: true,
    });

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT delete_token FROM badges WHERE employee_id = ?').get(result.employeeId) as { delete_token: string };
    db.close();

    // Should be 64-char hex (SHA-256), not a UUID
    expect(row.delete_token).toMatch(/^[a-f0-9]{64}$/);
    expect(row.delete_token).not.toContain('-');
    expect(row.delete_token).not.toBe(result.deleteToken);
  });

  it('softDeleteBadge succeeds with correct raw token', () => {
    const result = createBadge({
      name: 'SOFT DEL OK',
      department: 'TEST',
      title: 'Tester',
      song: 'TEST SONG',
      accessLevel: 'TEST',
      accessCss: 'test',
      hasPhoto: false,
      photoPublic: true,
    });

    const success = softDeleteBadge(result.employeeId, result.deleteToken);
    expect(success).toBe(true);
  });

  it('softDeleteBadge fails with wrong token', () => {
    const result = createBadge({
      name: 'SOFT DEL FAIL',
      department: 'TEST',
      title: 'Tester',
      song: 'TEST SONG',
      accessLevel: 'TEST',
      accessCss: 'test',
      hasPhoto: false,
      photoPublic: true,
    });

    const success = softDeleteBadge(result.employeeId, 'wrong-token-value');
    expect(success).toBe(false);
  });

  it('soft-deleted badge has is_visible=0', () => {
    const result = createBadge({
      name: 'VIS CHECK',
      department: 'TEST',
      title: 'Tester',
      song: 'TEST SONG',
      accessLevel: 'TEST',
      accessCss: 'test',
      hasPhoto: false,
      photoPublic: true,
    });

    softDeleteBadge(result.employeeId, result.deleteToken);
    const badge = getBadge(result.employeeId);
    expect(badge).toBeTruthy();
    expect(badge!.is_visible).toBe(0);
  });
});
