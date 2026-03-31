import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDb, closeDb } from '../../src/db';

let tmpDir: string;
let dbPath: string;

describe('Migrations', () => {
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hdbadge-mig-'));
    dbPath = join(tmpDir, 'test.db');
    initDb(dbPath);
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates badges table', () => {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='badges'").get();
    db.close();
    expect(row).toBeTruthy();
  });

  it('creates schema_versions table', () => {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_versions'").get();
    db.close();
    expect(row).toBeTruthy();
  });

  it('applies all 8 migrations', () => {
    const db = new Database(dbPath, { readonly: true });
    const result = db.prepare('SELECT COUNT(*) as count FROM schema_versions').get() as { count: number };
    db.close();
    expect(result.count).toBe(8);
  });

  it('is idempotent on re-run', () => {
    // Close and re-init on the same DB
    closeDb();
    initDb(dbPath);

    const db = new Database(dbPath, { readonly: true });
    const result = db.prepare('SELECT COUNT(*) as count FROM schema_versions').get() as { count: number };
    db.close();
    expect(result.count).toBe(8);
  });

  it('seeds 5 band members on fresh DB', () => {
    const db = new Database(dbPath, { readonly: true });
    const result = db.prepare('SELECT COUNT(*) as count FROM badges WHERE is_band_member = 1').get() as { count: number };
    db.close();
    expect(result.count).toBe(5);
  });
});
