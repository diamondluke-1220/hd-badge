// db.ts behaviour checks: old databases open and upgrade, listing and search
// return what was asked for, stats dates are local to the band, and the ID
// generator retries on a collision.

import { describe, it, expect, beforeAll, afterAll, afterEach, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDb, closeDb, createBadge, listBadges, getStats, generateEmployeeId, getBadge } from '../../src/db';

function badgeInput(overrides: Record<string, any> = {}) {
  return {
    name: 'TESTER', department: 'PRINTER JAMS', title: 'Intern', song: 'PLEASE HOLD',
    accessLevel: 'VISITOR', accessCss: 'visitor', ...overrides,
  };
}

function freshDb(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const path = join(dir, 'test.db');
  return { dir, path };
}

describe('upgrading a database from before the first migration', () => {
  const { dir, path } = freshDb('hdbadge-legacy-');
  afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

  it('opens it, adds every later column, hashes old tokens and renames old band IDs', () => {
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL, department TEXT NOT NULL, title TEXT NOT NULL, song TEXT NOT NULL,
        access_level TEXT NOT NULL, access_css TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        source TEXT DEFAULT 'web', is_visible INTEGER DEFAULT 1, delete_token TEXT UNIQUE,
        has_photo INTEGER DEFAULT 0, is_band_member INTEGER DEFAULT 0, photo_public INTEGER DEFAULT 1
      );
      INSERT INTO badges (employee_id, name, department, title, song, access_level, access_css, delete_token, is_band_member)
        VALUES ('HD-0001', 'LUKE', 'TICKET ESCALATION BUREAU', 'Chief', 'PLEASE HOLD', 'ALL ACCESS', 'all-access', NULL, 1),
               ('HD-12345', 'FAN', 'PRINTER JAMS', 'Intern', 'RED ALERT', 'VISITOR', 'visitor', 'plain-token-1', 0);
    `);
    legacy.close();

    expect(() => initDb(path)).not.toThrow();

    const columns = (new Database(path, { readonly: true }).query('PRAGMA table_info(badges)').all() as { name: string }[]).map(c => c.name);
    for (const col of ['is_paid', 'is_printed', 'is_flagged', 'is_demo', 'caption', 'wave_style']) {
      expect(columns).toContain(col);
    }
    expect(getBadge('HD-12345')!.delete_token).toMatch(/^[a-f0-9]{64}$/);
    expect(getBadge('HD-00001')).not.toBeNull();
    expect(getBadge('HD-0001')).toBeNull();
  });
});

describe('listing and search', () => {
  const { dir, path } = freshDb('hdbadge-list-');
  beforeAll(() => {
    initDb(path);
    for (let i = 0; i < 120; i++) createBadge(badgeInput({ name: `FAN ${i}` }));
    createBadge(badgeInput({ name: 'A\\B' }));
  });
  afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

  it('finds a name containing a backslash', () => {
    expect(listBadges({ search: 'A\\B', includeHidden: true }).total).toBe(1);
  });

  it('treats a search for a lone backslash as literal text', () => {
    expect(listBadges({ search: '\\', includeHidden: true }).total).toBe(1);
  });

  it('never lets a negative limit lift the page cap', () => {
    const result = listBadges({ limit: -1, includeHidden: true });
    expect(result.badges.length).toBeLessThanOrEqual(100);
    expect(result.badges.length).toBeGreaterThan(0);
    expect(result.pages).toBeGreaterThanOrEqual(1);
  });

  it('returns nothing for a division that does not exist', () => {
    expect(listBadges({ division: 'NOT A REAL DIVISION' }).total).toBe(0);
  });
});

describe('stats dates', () => {
  const { dir, path } = freshDb('hdbadge-stats-');
  beforeAll(() => initDb(path));
  afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

  it('puts an evening badge on the Madison calendar day, not the UTC one', () => {
    // 02:00 UTC two days ago is 8 or 9 pm the evening before in Madison.
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    const utcDay = twoDaysAgo.toISOString().slice(0, 10);
    const createdAtUtc = new Date(`${utcDay}T02:00:00Z`);
    const madisonDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(createdAtUtc);

    const { employeeId } = createBadge(badgeInput());
    const db = new Database(path);
    db.query('UPDATE badges SET created_at = ? WHERE employee_id = ?').run(`${utcDay} 02:00:00`, employeeId);
    db.close();

    const days = getStats().sparkline.map(p => p.date);
    expect(days).toContain(madisonDay);
    expect(days).not.toContain(utcDay);
  });
});

describe('employee ID collision retry', () => {
  const { dir, path } = freshDb('hdbadge-idretry-');
  beforeAll(() => initDb(path));
  afterEach(() => { (Math.random as any).mockRestore?.(); });
  afterAll(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

  it('skips an ID that is already taken and returns a free five-digit one', () => {
    const { employeeId: taken } = createBadge(badgeInput());
    const takenNumber = Number(taken.slice(3));
    const takenRandom = (takenNumber - 10000 + 0.5) / 90000;
    const freeRandom = takenRandom > 0.5 ? 0.01 : 0.99;
    const values = [takenRandom, takenRandom, freeRandom];
    const spy = spyOn(Math, 'random').mockImplementation(() => values.shift() ?? freeRandom);

    const id = generateEmployeeId();
    expect(spy).toHaveBeenCalledTimes(3);
    expect(id).not.toBe(taken);
    expect(id).toMatch(/^HD-\d{5}$/);
  });
});
