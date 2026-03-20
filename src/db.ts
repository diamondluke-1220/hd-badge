// Help Desk Badge Generator — SQLite Persistence Layer
// Uses bun:sqlite in WAL mode following Bagel Commander patterns

import { Database } from 'bun:sqlite';
import { randomUUID, createHash } from 'crypto';
import { existsSync, renameSync } from 'fs';
import { join } from 'path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  title TEXT NOT NULL,
  song TEXT NOT NULL,
  access_level TEXT NOT NULL,
  access_css TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT DEFAULT 'web',
  is_visible INTEGER DEFAULT 1,
  delete_token TEXT UNIQUE,
  has_photo INTEGER DEFAULT 0,
  is_band_member INTEGER DEFAULT 0,
  photo_public INTEGER DEFAULT 1,
  is_paid INTEGER DEFAULT 0,
  paid_at TEXT,
  is_printed INTEGER DEFAULT 0,
  printed_at TEXT,
  is_flagged INTEGER DEFAULT 0,
  is_demo INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_badges_department ON badges(department);
CREATE INDEX IF NOT EXISTS idx_badges_visible ON badges(is_visible);
CREATE INDEX IF NOT EXISTS idx_badges_employee_id ON badges(employee_id);
CREATE INDEX IF NOT EXISTS idx_badges_band_member ON badges(is_band_member);
CREATE INDEX IF NOT EXISTS idx_badges_created_at ON badges(created_at);
CREATE INDEX IF NOT EXISTS idx_badges_flagged ON badges(is_flagged);
`;

// Band member seed data — HD-00001 through HD-00005
const BAND_MEMBERS = [
  { id: 'HD-00001', name: 'LUKE',  dept: 'TICKET ESCALATION BUREAU',          title: 'Chief Escalation Officer',      song: 'PLEASE HOLD',       access: 'ALL ACCESS', css: 'all-access' },
  { id: 'HD-00002', name: 'DREW',  dept: 'AUDIO ENGINEERING DIVISION',        title: 'Chief Audio Architect',         song: 'RED ALERT',         access: 'ALL ACCESS', css: 'all-access' },
  { id: 'HD-00003', name: 'HENRY', dept: 'DEPT. OF PERCUSSIVE MAINTENANCE',   title: 'Chief Impact Officer',          song: 'THE MEMO',          access: 'ALL ACCESS', css: 'all-access' },
  { id: 'HD-00004', name: 'TODD',  dept: 'INFRASTRUCTURE & POWER CHORDS',     title: 'VP of Power Distribution',      song: 'TAKING LIBERTIES',  access: 'ALL ACCESS', css: 'all-access' },
  { id: 'HD-00005', name: 'ADAM',  dept: 'LOW FREQUENCY OPERATIONS',          title: 'VP of Bottom Line Operations',  song: 'BOSS LEVEL',        access: 'ALL ACCESS', css: 'all-access' },
];

// Division → department mapping (mirrors PUBLIC_DIVISIONS + DEPARTMENTS in app.js)
const DIVISION_DEPTS: Record<string, string[]> = {
  'EXECUTIVE TEAM': [
    'TICKET ESCALATION BUREAU', 'AUDIO ENGINEERING DIVISION',
    'DEPT. OF PERCUSSIVE MAINTENANCE', 'INFRASTRUCTURE & POWER CHORDS',
    'LOW FREQUENCY OPERATIONS',
  ],
  'TECHNICAL FRUSTRATIONS': [
    'PRINTER JAMS', 'PASSWORD RESET SERVICES', 'BLUE SCREEN RESPONSE TEAM',
  ],
  'OFFICE CULTURE': [
    'WATERCOOLER SERVICES', 'MEETING RECOVERY DEPT.',
  ],
  'CORPORATE AFFAIRS': [
    'MANDATORY FUN COMMITTEE', 'MORALE SUPPRESSION UNIT', 'TEAM BUILDING AVOIDANCE',
  ],
  'PUNK OPERATIONS': [
    'MOSH PIT HR', 'ENTERPRISE GUITAR WORSHIP', 'STAGE DIVE RISK ASSESSMENT',
  ],
};

/** Get the list of departments belonging to a division (unknown depts → INDEPENDENT CONTRACTORS) */
export function getDivisionDepts(division: string): string[] | null {
  if (division === 'INDEPENDENT CONTRACTORS') return null; // special: everything NOT in known divisions
  return DIVISION_DEPTS[division] || null;
}

/** Get list of all known division names */
export function getDivisionNames(): string[] {
  return [...Object.keys(DIVISION_DEPTS), 'INDEPENDENT CONTRACTORS'];
}

/** Get all departments that belong to known divisions (for INDEPENDENT CONTRACTORS exclusion) */
function getAllKnownDepts(): string[] {
  return Object.values(DIVISION_DEPTS).flat();
}

/** Hash a delete token with SHA-256 for storage */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

let db: Database;

// Prepared statements (cached after init)
let stmts: {
  insertBadge: ReturnType<Database['prepare']>;
  getBadge: ReturnType<Database['prepare']>;
  getBadgeByToken: ReturnType<Database['prepare']>;
  listVisible: ReturnType<Database['prepare']>;
  listVisibleByDept: ReturnType<Database['prepare']>;
  listAll: ReturnType<Database['prepare']>;
  countVisible: ReturnType<Database['prepare']>;
  countByDept: ReturnType<Database['prepare']>;
  softDelete: ReturnType<Database['prepare']>;
  hardDelete: ReturnType<Database['prepare']>;
  toggleVisibility: ReturnType<Database['prepare']>;
  checkEmployeeId: ReturnType<Database['prepare']>;
  togglePaid: ReturnType<Database['prepare']>;
  togglePrinted: ReturnType<Database['prepare']>;
  toggleFlagged: ReturnType<Database['prepare']>;
  setHasPhoto: ReturnType<Database['prepare']>;
};

/** Run a migration only if its version hasn't been applied yet */
function runMigration(version: number, description: string, fn: () => void) {
  const applied = db.prepare('SELECT 1 FROM schema_versions WHERE version = ?').get(version);
  if (applied) return;
  fn();
  db.prepare('INSERT INTO schema_versions (version, description, applied_at) VALUES (?, ?, datetime(\'now\'))').run(version, description);
}

export function initDb(dbPath: string) {
  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(SCHEMA);

  // Bootstrap schema versioning table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  // --- Versioned Migrations ---

  // v1: Payment and print tracking columns
  runMigration(1, 'Add is_paid, paid_at, is_printed, printed_at columns', () => {
    const cols = db.prepare("PRAGMA table_info(badges)").all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('is_paid')) {
      db.exec('ALTER TABLE badges ADD COLUMN is_paid INTEGER DEFAULT 0');
      db.exec('ALTER TABLE badges ADD COLUMN paid_at TEXT');
      db.exec('ALTER TABLE badges ADD COLUMN is_printed INTEGER DEFAULT 0');
      db.exec('ALTER TABLE badges ADD COLUMN printed_at TEXT');
    }
  });

  // v2: Flagged column
  runMigration(2, 'Add is_flagged column', () => {
    const cols = db.prepare("PRAGMA table_info(badges)").all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('is_flagged')) {
      db.exec('ALTER TABLE badges ADD COLUMN is_flagged INTEGER DEFAULT 0');
    }
  });

  // v3: Demo badge column
  runMigration(3, 'Add is_demo column', () => {
    const cols = db.prepare("PRAGMA table_info(badges)").all() as { name: string }[];
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('is_demo')) {
      db.exec('ALTER TABLE badges ADD COLUMN is_demo INTEGER DEFAULT 0');
    }
  });

  // v4: Hash plaintext delete tokens
  runMigration(4, 'Hash existing plaintext delete_tokens with SHA-256', () => {
    const rows = db.prepare('SELECT id, delete_token FROM badges WHERE delete_token IS NOT NULL').all() as { id: number; delete_token: string }[];
    const update = db.prepare('UPDATE badges SET delete_token = $hash WHERE id = $id');
    db.transaction(() => {
      for (const row of rows) {
        // Skip tokens that are already 64-char hex (already hashed)
        if (/^[a-f0-9]{64}$/.test(row.delete_token)) continue;
        update.run({ $hash: hashToken(row.delete_token), $id: row.id });
      }
    })();
  });

  // Prepare all statements
  stmts = {
    insertBadge: db.prepare(`
      INSERT INTO badges (employee_id, name, department, title, song, access_level, access_css, source, delete_token, has_photo, is_band_member, photo_public, is_flagged, is_demo)
      VALUES ($employee_id, $name, $department, $title, $song, $access_level, $access_css, $source, $delete_token, $has_photo, $is_band_member, $photo_public, $is_flagged, $is_demo)
    `),
    getBadge: db.prepare('SELECT * FROM badges WHERE employee_id = $id'),
    getBadgeByToken: db.prepare('SELECT * FROM badges WHERE delete_token = $token'),
    listVisible: db.prepare(`
      SELECT * FROM badges WHERE is_visible = 1
      ORDER BY is_band_member DESC, created_at DESC
      LIMIT $limit OFFSET $offset
    `),
    listVisibleByDept: db.prepare(`
      SELECT * FROM badges WHERE is_visible = 1 AND department = $department
      ORDER BY is_band_member DESC, created_at DESC
      LIMIT $limit OFFSET $offset
    `),
    listAll: db.prepare('SELECT * FROM badges ORDER BY created_at DESC LIMIT $limit OFFSET $offset'),
    countVisible: db.prepare('SELECT COUNT(*) as count FROM badges WHERE is_visible = 1'),
    countByDept: db.prepare('SELECT department, COUNT(*) as count FROM badges WHERE is_visible = 1 GROUP BY department ORDER BY count DESC'),
    softDelete: db.prepare('UPDATE badges SET is_visible = 0 WHERE employee_id = $id AND delete_token = $token'),
    hardDelete: db.prepare('DELETE FROM badges WHERE employee_id = $id'),
    toggleVisibility: db.prepare('UPDATE badges SET is_visible = CASE WHEN is_visible = 1 THEN 0 ELSE 1 END WHERE employee_id = $id'),
    checkEmployeeId: db.prepare('SELECT 1 FROM badges WHERE employee_id = $id'),
    togglePaid: db.prepare("UPDATE badges SET is_paid = CASE WHEN is_paid = 1 THEN 0 ELSE 1 END, paid_at = CASE WHEN is_paid = 1 THEN NULL ELSE datetime('now') END WHERE employee_id = $id"),
    togglePrinted: db.prepare("UPDATE badges SET is_printed = CASE WHEN is_printed = 1 THEN 0 ELSE 1 END, printed_at = CASE WHEN is_printed = 1 THEN NULL ELSE datetime('now') END WHERE employee_id = $id"),
    toggleFlagged: db.prepare('UPDATE badges SET is_flagged = CASE WHEN is_flagged = 1 THEN 0 ELSE 1 END WHERE employee_id = $id'),
    setHasPhoto: db.prepare('UPDATE badges SET has_photo = $photo WHERE employee_id = $id'),
  };

  // Migrate 4-digit band member IDs to 5-digit format (HD-0001 → HD-00001)
  migrateBandMemberIds();

  // Seed band members if table is empty
  const count = db.prepare('SELECT COUNT(*) as count FROM badges').get() as { count: number };
  if (count.count === 0) {
    seedBandMembers();
  }
}

function migrateBandMemberIds() {
  const OLD_TO_NEW: Record<string, string> = {
    'HD-0001': 'HD-00001',
    'HD-0002': 'HD-00002',
    'HD-0003': 'HD-00003',
    'HD-0004': 'HD-00004',
    'HD-0005': 'HD-00005',
  };
  const update = db.prepare('UPDATE badges SET employee_id = $new WHERE employee_id = $old');
  const dataDir = join(process.cwd(), 'data');
  for (const [oldId, newId] of Object.entries(OLD_TO_NEW)) {
    const result = update.run({ $old: oldId, $new: newId });
    if (result.changes > 0) {
      // Rename photo + headshot files to match new ID
      for (const subdir of ['photos', 'headshots']) {
        const oldPath = join(dataDir, subdir, `${oldId}.jpg`);
        const newPath = join(dataDir, subdir, `${newId}.jpg`);
        if (existsSync(oldPath)) {
          renameSync(oldPath, newPath);
        }
      }
    }
  }
}

function seedBandMembers() {
  for (const m of BAND_MEMBERS) {
    stmts.insertBadge.run({
      $employee_id: m.id,
      $name: m.name,
      $department: m.dept,
      $title: m.title,
      $song: m.song,
      $access_level: m.access,
      $access_css: m.css,
      $source: 'band',
      $delete_token: hashToken(randomUUID()),
      $has_photo: 0,
      $is_band_member: 1,
      $photo_public: 1,
      $is_flagged: 0,
      $is_demo: 0,
    });
  }
}

/** Generate a unique employee ID (HD-XXXXX), retrying on collision */
export function generateEmployeeId(): string {
  for (let i = 0; i < 10; i++) {
    const num = String(Math.floor(10000 + Math.random() * 90000));
    const id = `HD-${num}`;
    const exists = stmts.checkEmployeeId.get({ $id: id });
    if (!exists) return id;
  }
  // Fallback: use timestamp-based ID with collision check
  for (let i = 0; i < 10; i++) {
    const ts = Date.now().toString(36).toUpperCase().slice(-5);
    const id = `HD-${ts}`;
    const exists = stmts.checkEmployeeId.get({ $id: id });
    if (!exists) return id;
  }
  throw new Error('Failed to generate unique employee ID after 20 attempts');
}

export interface BadgeInput {
  name: string;
  department: string;
  title: string;
  song: string;
  accessLevel: string;
  accessCss: string;
  hasPhoto: boolean;
  photoPublic: boolean;
  source?: string;
  flagged?: boolean;
  isDemo?: boolean;
}

export interface BadgeRow {
  id: number;
  employee_id: string;
  name: string;
  department: string;
  title: string;
  song: string;
  access_level: string;
  access_css: string;
  created_at: string;
  source: string;
  is_visible: number;
  delete_token: string;
  has_photo: number;
  is_band_member: number;
  photo_public: number;
  is_paid: number;
  paid_at: string | null;
  is_printed: number;
  printed_at: string | null;
  is_flagged: number;
  is_demo: number;
}

export function createBadge(input: BadgeInput): { employeeId: string; deleteToken: string } {
  const employeeId = generateEmployeeId();
  const deleteToken = randomUUID();

  stmts.insertBadge.run({
    $employee_id: employeeId,
    $name: input.name,
    $department: input.department,
    $title: input.title,
    $song: input.song,
    $access_level: input.accessLevel,
    $access_css: input.accessCss,
    $source: input.source || 'web',
    $delete_token: hashToken(deleteToken),
    $has_photo: input.hasPhoto ? 1 : 0,
    $is_band_member: 0,
    $photo_public: input.photoPublic ? 1 : 0,
    $is_flagged: input.flagged ? 1 : 0,
    $is_demo: input.isDemo ? 1 : 0,
  });

  return { employeeId, deleteToken };
}

export function getBadge(employeeId: string): BadgeRow | null {
  return (stmts.getBadge.get({ $id: employeeId }) as BadgeRow) || null;
}

export function listBadges(options: {
  department?: string;
  division?: string;
  dateFrom?: string;
  dateTo?: string;
  hasPhoto?: boolean;
  search?: string;
  page?: number;
  limit?: number;
  maxLimit?: number;
  includeHidden?: boolean;
  recentFirst?: boolean;
}): { badges: BadgeRow[]; total: number; page: number; pages: number } {
  const page = options.page || 1;
  const cap = options.maxLimit || 100;
  const limit = Math.min(options.limit || 50, cap);
  const offset = (page - 1) * limit;

  // Build dynamic WHERE clause for advanced filters
  const hasAdvancedFilters = options.dateFrom || options.dateTo || options.hasPhoto !== undefined || options.division || options.recentFirst || options.search;

  if (hasAdvancedFilters || (options.includeHidden && options.department)) {
    const conditions: string[] = [];
    const params: Record<string, any> = {};

    if (!options.includeHidden) {
      conditions.push('is_visible = 1');
    }

    if (options.department) {
      conditions.push('department = $department');
      params.$department = options.department;
    }

    if (options.division) {
      const divDepts = getDivisionDepts(options.division);
      if (divDepts) {
        const placeholders = divDepts.map((_, i) => `$div_dept_${i}`);
        conditions.push(`department IN (${placeholders.join(',')})`);
        divDepts.forEach((d, i) => { params[`$div_dept_${i}`] = d; });
      } else if (options.division === 'INDEPENDENT CONTRACTORS') {
        const knownDepts = getAllKnownDepts();
        const placeholders = knownDepts.map((_, i) => `$known_dept_${i}`);
        conditions.push(`department NOT IN (${placeholders.join(',')})`);
        knownDepts.forEach((d, i) => { params[`$known_dept_${i}`] = d; });
      }
    }

    if (options.dateFrom) {
      conditions.push('created_at >= $dateFrom');
      params.$dateFrom = options.dateFrom;
    }
    if (options.dateTo) {
      conditions.push('created_at < $dateTo');
      // Add one day to make dateTo inclusive (end of day)
      params.$dateTo = options.dateTo + 'T23:59:59';
    }

    if (options.hasPhoto === true) {
      conditions.push('has_photo = 1');
    } else if (options.hasPhoto === false) {
      conditions.push('has_photo = 0');
    }

    if (options.search) {
      // Escape SQL LIKE wildcards in user input
      const escaped = options.search.replace(/[%_]/g, ch => '\\' + ch);
      const pattern = `%${escaped}%`;
      conditions.push('(UPPER(name) LIKE UPPER($search) ESCAPE \'\\\' OR UPPER(employee_id) LIKE UPPER($search) ESCAPE \'\\\' OR UPPER(department) LIKE UPPER($search) ESCAPE \'\\\')');
      params.$search = pattern;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = (options.includeHidden || options.recentFirst) ? 'ORDER BY created_at DESC' : 'ORDER BY is_band_member DESC, created_at DESC';

    const badges = db.prepare(`SELECT * FROM badges ${where} ${orderBy} LIMIT $limit OFFSET $offset`).all({ ...params, $limit: limit, $offset: offset }) as BadgeRow[];
    const total = (db.prepare(`SELECT COUNT(*) as count FROM badges ${where}`).get(params) as { count: number }).count;

    return { badges, total, page, pages: Math.ceil(total / limit) };
  }

  // Original fast paths (no advanced filters)
  let badges: BadgeRow[];
  let total: number;

  if (options.includeHidden) {
    badges = stmts.listAll.all({ $limit: limit, $offset: offset }) as BadgeRow[];
    total = (db.prepare('SELECT COUNT(*) as count FROM badges').get() as { count: number }).count;
  } else if (options.department) {
    badges = stmts.listVisibleByDept.all({ $department: options.department, $limit: limit, $offset: offset }) as BadgeRow[];
    total = (db.prepare('SELECT COUNT(*) as count FROM badges WHERE is_visible = 1 AND department = ?').get(options.department) as { count: number }).count;
  } else {
    badges = stmts.listVisible.all({ $limit: limit, $offset: offset }) as BadgeRow[];
    total = (stmts.countVisible.get() as { count: number }).count;
  }

  return {
    badges,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
}

export function softDeleteBadge(employeeId: string, token: string): boolean {
  const result = stmts.softDelete.run({ $id: employeeId, $token: hashToken(token) });
  return result.changes > 0;
}

export function hardDeleteBadge(employeeId: string): boolean {
  const result = stmts.hardDelete.run({ $id: employeeId });
  return result.changes > 0;
}

export function toggleVisibility(employeeId: string): boolean {
  const result = stmts.toggleVisibility.run({ $id: employeeId });
  return result.changes > 0;
}

export function togglePaid(employeeId: string): boolean {
  const result = stmts.togglePaid.run({ $id: employeeId });
  return result.changes > 0;
}

export function togglePrinted(employeeId: string): boolean {
  const result = stmts.togglePrinted.run({ $id: employeeId });
  return result.changes > 0;
}

export function toggleFlagged(employeeId: string): boolean {
  const result = stmts.toggleFlagged.run({ $id: employeeId });
  return result.changes > 0;
}

export function setHasPhoto(employeeId: string, hasPhoto: boolean): boolean {
  const badge = getBadge(employeeId);
  if (!badge) return false;
  stmts.setHasPhoto.run({
    $photo: hasPhoto ? 1 : 0,
    $id: employeeId,
  });
  return true;
}

export function getStats(): {
  totalBadges: number;
  visible: number;
  hiddenCount: number;
  bandMembers: number;
  flaggedCount: number;
  byDepartment: Record<string, number>;
  newest: string | null;
  newestHire: { name: string; department: string; createdAt: string } | null;
  sparkline: { date: string; count: number }[];
} {
  return db.transaction(() => {
    const visible = (stmts.countVisible.get() as { count: number }).count;
    const total = (db.prepare('SELECT COUNT(*) as count FROM badges').get() as { count: number }).count;
    const bandMembers = (db.prepare('SELECT COUNT(*) as count FROM badges WHERE is_band_member = 1').get() as { count: number }).count;
    const flaggedCount = (db.prepare('SELECT COUNT(*) as count FROM badges WHERE is_flagged = 1').get() as { count: number }).count;
    const byDeptRows = stmts.countByDept.all() as { department: string; count: number }[];
    const newest = db.prepare('SELECT employee_id FROM badges WHERE is_band_member = 0 ORDER BY created_at DESC LIMIT 1').get() as { employee_id: string } | null;

    const newestRow = db.prepare(
      'SELECT name, department, created_at FROM badges WHERE is_visible = 1 ORDER BY created_at DESC LIMIT 1'
    ).get() as { name: string; department: string; created_at: string } | null;

    const sparklineRows = db.prepare(
      `SELECT date(created_at) as date, COUNT(*) as count
       FROM badges WHERE is_visible = 1 AND created_at >= date('now', '-30 days')
       GROUP BY date(created_at) ORDER BY date ASC`
    ).all() as { date: string; count: number }[];

    const byDepartment: Record<string, number> = {};
    for (const row of byDeptRows) {
      byDepartment[row.department] = row.count;
    }

    return {
      totalBadges: total,
      visible,
      hiddenCount: total - visible,
      bandMembers,
      flaggedCount,
      byDepartment,
      newest: newest?.employee_id || null,
      newestHire: newestRow ? { name: newestRow.name, department: newestRow.department, createdAt: newestRow.created_at } : null,
      sparkline: sparklineRows,
    };
  })();
}

/** Get analytics data for admin dashboard */
export function getAnalytics(): {
  topSongs: { name: string; count: number }[];
  topTitles: { name: string; count: number }[];
  topDepartments: { name: string; count: number }[];
  paidCount: number;
  unpaidCount: number;
  photoCount: number;
  noPhotoCount: number;
  customTitleCount: number;
  fanBadgeCount: number;
} {
  return db.transaction(() => {
    const topSongs = db.prepare(
      'SELECT song as name, COUNT(*) as count FROM badges WHERE is_band_member = 0 GROUP BY song ORDER BY count DESC LIMIT 10'
    ).all() as { name: string; count: number }[];

    const topTitles = db.prepare(
      'SELECT title as name, COUNT(*) as count FROM badges WHERE is_band_member = 0 GROUP BY title ORDER BY count DESC LIMIT 10'
    ).all() as { name: string; count: number }[];

    const topDepartments = db.prepare(
      'SELECT department as name, COUNT(*) as count FROM badges WHERE is_band_member = 0 GROUP BY department ORDER BY count DESC LIMIT 10'
    ).all() as { name: string; count: number }[];

    const paidCount = (db.prepare('SELECT COUNT(*) as count FROM badges WHERE is_paid = 1 AND is_band_member = 0').get() as { count: number }).count;
    const fanBadgeCount = (db.prepare('SELECT COUNT(*) as count FROM badges WHERE is_band_member = 0').get() as { count: number }).count;
    const unpaidCount = fanBadgeCount - paidCount;

    const photoCount = (db.prepare('SELECT COUNT(*) as count FROM badges WHERE has_photo = 1 AND is_band_member = 0').get() as { count: number }).count;
    const noPhotoCount = fanBadgeCount - photoCount;

    const customTitleCount = (db.prepare(
      'SELECT COUNT(*) as count FROM (SELECT title FROM badges WHERE is_band_member = 0 GROUP BY title HAVING COUNT(*) = 1)'
    ).get() as { count: number }).count;

    return { topSongs, topTitles, topDepartments, paidCount, unpaidCount, photoCount, noPhotoCount, customTitleCount, fanBadgeCount };
  })();
}

/** Serialize a BadgeRow to a JSON-friendly object for API responses */
export function serializeBadge(b: BadgeRow, opts?: { admin?: boolean }) {
  const base = {
    employeeId: b.employee_id,
    name: b.name,
    department: b.department,
    title: b.title,
    song: b.song,
    accessLevel: b.access_level,
    accessCss: b.access_css,
    hasPhoto: !!b.has_photo,
    photoPublic: !!b.photo_public,
    isBandMember: !!b.is_band_member,
    createdAt: b.created_at,
  };
  if (!opts?.admin) return base;
  return {
    ...base,
    isVisible: !!b.is_visible,
    isPaid: !!b.is_paid,
    paidAt: b.paid_at,
    isPrinted: !!b.is_printed,
    printedAt: b.printed_at,
    isFlagged: !!b.is_flagged,
    source: b.source,
  };
}

/** Export all badges as an array (for CSV backup) */
export function exportAllBadges(): BadgeRow[] {
  return db.prepare('SELECT * FROM badges ORDER BY id ASC').all() as BadgeRow[];
}

/** Get paid but unprinted badges (print queue) */
export function getPrintQueue(): BadgeRow[] {
  return db.prepare('SELECT * FROM badges WHERE is_paid = 1 AND is_printed = 0 ORDER BY created_at ASC').all() as BadgeRow[];
}

/** Get all demo badge employee IDs (for file cleanup) */
export function listDemoBadgeIds(): string[] {
  const rows = db.prepare('SELECT employee_id FROM badges WHERE is_demo = 1').all() as { employee_id: string }[];
  return rows.map(r => r.employee_id);
}

/** Delete all demo badges from DB, return count deleted */
export function deleteDemoBadges(): number {
  const result = db.prepare('DELETE FROM badges WHERE is_demo = 1').run();
  return result.changes;
}

export function closeDb() {
  if (db) db.close();
}
