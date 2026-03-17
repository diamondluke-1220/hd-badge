import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDb, closeDb, generateEmployeeId, createBadge } from '../../src/db';

let tmpDir: string;
let dbPath: string;

describe('Employee ID Generation', () => {
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hdbadge-empid-'));
    dbPath = join(tmpDir, 'test.db');
    initDb(dbPath);
  });

  afterAll(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates IDs in HD-XXXXX format', () => {
    const id = generateEmployeeId();
    expect(id).toMatch(/^HD-\d{5}$/);
  });

  it('generates 100 unique IDs via createBadge', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const result = createBadge({
        name: `UNIQUE${i}`,
        department: 'TEST',
        title: 'Tester',
        song: 'TEST',
        accessLevel: 'TEST',
        accessCss: 'test',
        hasPhoto: false,
        photoPublic: true,
      });
      ids.add(result.employeeId);
    }
    expect(ids.size).toBe(100);
  });

  it('band member IDs HD-00001 through HD-00005 exist', () => {
    const db = new Database(dbPath, { readonly: true });
    for (let i = 1; i <= 5; i++) {
      const id = `HD-${String(i).padStart(5, '0')}`;
      const row = db.prepare('SELECT 1 FROM badges WHERE employee_id = ?').get(id);
      expect(row).toBeTruthy();
    }
    db.close();
  });

  it('employee_id index exists', () => {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_badges_employee_id'").get();
    db.close();
    expect(row).toBeTruthy();
  });

  it('generated IDs never collide with band member IDs', () => {
    const bandIds = new Set(['HD-00001', 'HD-00002', 'HD-00003', 'HD-00004', 'HD-00005']);
    // The 100 badges created earlier should not have band member IDs
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare('SELECT employee_id FROM badges WHERE is_band_member = 0').all() as { employee_id: string }[];
    db.close();

    for (const row of rows) {
      expect(bandIds.has(row.employee_id)).toBe(false);
    }
  });
});
