// Help Desk Badge App — Demo Mode Engine
// Creates realistic test badges over time to simulate a live show

import { createBadge, listDemoBadgeIds, deleteDemoBadges } from './db';
import { log } from './logger';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';

// ─── Badge Data (mirrors badge-render.js constants) ──────

const DEPARTMENTS = [
  { name: 'PRINTER JAMS', css: 'paper-jam' },
  { name: 'PASSWORD RESET SERVICES', css: 'reset' },
  { name: 'BLUE SCREEN RESPONSE TEAM', css: 'bsod' },
  { name: 'WATERCOOLER SERVICES', css: 'watercooler' },
  { name: 'MEETING RECOVERY DEPT.', css: 'meeting' },
  { name: 'MANDATORY FUN COMMITTEE', css: 'fun' },
  { name: 'MORALE SUPPRESSION UNIT', css: 'morale' },
  { name: 'TEAM BUILDING AVOIDANCE', css: 'team' },
  { name: 'MOSH PIT HR', css: 'mosh' },
  { name: 'ENTERPRISE GUITAR WORSHIP', css: 'guitar' },
  { name: 'STAGE DIVE RISK ASSESSMENT', css: 'stage' },
];

const TITLES = [
  'Senior Reboot Specialist', 'Level 1 Support', 'Junior Ticket Closer',
  'Bandwidth Hog', 'Ctrl+Z Specialist', 'Full Stack Complainer',
  'Calendar Tetris Champion', 'Desk Plant Supervisor', 'Office Supply Hoarder',
  'Temp, 3rd Year', 'Dept. of Redundancy Dept.', 'Scrum Master of Disaster',
  'Director of First Impressions', 'Mosh Pit Compliance Officer',
  'On-Call Since Monday', 'Air Guitar Tech', 'HUH?! Coordinator',
];

const ACCESS_LEVELS = [
  { label: 'ALL ACCESS', css: 'all-access' },
  { label: 'PAPER JAM CLEARANCE', css: 'paper-jam' },
  { label: 'RESET AUTHORIZED', css: 'reset' },
  { label: 'COFFEE MACHINE ELITE', css: 'coffee' },
  { label: 'MAINFRAME APPROVED', css: 'mainframe' },
  { label: 'CTRL+ALT+CLEARED', css: 'ctrl-alt' },
  { label: 'MOSH PIT APPROVED', css: 'mosh' },
  { label: 'PIT APPROVED', css: 'pit' },
  { label: 'SOUL EXTRACTION AUTHORIZED', css: 'soul' },
  { label: 'PENDING REVIEW', css: 'pending' },
  { label: 'REDACTED', css: 'redacted' },
  { label: 'VISITOR', css: 'visitor' },
  { label: 'INTERN', css: 'intern' },
];

const SONGS = [
  'UN-PTO', 'THE MEMO', 'LOWERING THE BAR', 'SALLY IN ACCOUNTING',
  'TAKING LIBERTIES', '7 CENTS', 'BOSS LEVEL', 'PWNING N00BS',
  'RUMOR MILL', 'THE CONSULTANT', 'PUNK ROCKER V2.0', 'RED ALERT',
  'HOSTILE TAKEOVER', 'PATCH 22', 'PLEASE HOLD', 'ALTERNATIVE FAX',
];

// Curated funny demo names
const DEMO_NAMES = [
  'CHAD THUNDERPATCH', 'KAREN FROM LEGAL', 'DAVE (NOT THAT DAVE)',
  'CTRL+ALT+BRENDA', 'SIR REBOOTS-A-LOT', 'JANET FROM FLOOR 3',
  'THE INTERN', 'ANONYMOUS TIPSTER', 'PLACEHOLDER PETE',
  'DEFINITELY NOT A BOT', 'TICKETMASTER FLEX', 'PASSWORD123',
  'REPLY ALL RACHEL', 'SUDO SUSAN', 'PATCH TUESDAY PAT',
  'GIT PUSH GARY', 'OVERFLOW OSCAR', 'NULL POINTER NANCY',
  'SEGFAULT SAM', 'REGEX RITA', 'LOCALHOST LARRY',
  'KUBERNETES KEITH', 'DOCKER DAN', 'AGILE ALICE',
  'STANDUP STEVE', 'FIREWALL FIONA', 'PING TIMEOUT PHIL',
  'BANDWIDTH BETTY', 'CACHE MISS CARL', 'MERGE CONFLICT MIKE',
  'LEGACY CODE LISA', 'SPRINT ZERO ZACH', 'HOTFIX HANNAH',
  'ROLLBACK ROB', 'DEPENDENCY DIANA', 'SPAGHETTI CODE SARAH',
  'REFACTOR REX', 'BLOCKER BEN', 'JIRA JENNIFER',
  'SLACK NOTIFICATION NICK', 'ZOOM FATIGUE ZOE', 'VPN VICTOR',
  'INCOGNITO IAN', 'BUFFER OVERFLOW BETH', 'API LIMIT ALEX',
  'RATE LIMIT ROGER', 'TIMEOUT TIM', 'DEADLOCK DEBBIE',
  'RACE CONDITION RAY', 'MEMORY LEAK MEL',
];

// ─── Placeholder Badge PNG ───────────────────────────────
// Minimal 1x1 transparent PNG (67 bytes) — just needs to be a valid PNG
// for the file write + thumbnail generation to not crash.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// ─── Demo State ──────────────────────────────────────────

interface DemoState {
  running: boolean;
  total: number;
  created: number;
  createdIds: string[];
  timers: ReturnType<typeof setTimeout>[];
}

const state: DemoState = {
  running: false,
  total: 0,
  created: 0,
  createdIds: [],
  timers: [],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Badge Creation (server-side, no browser) ────────────

type BroadcastFn = (badge: {
  employeeId: string; name: string; department: string;
  title: string; accessLevel: string; accessCss: string; isBandMember: boolean;
}) => void;
type FileWriteFn = (path: string, data: Buffer) => void;

let _broadcast: BroadcastFn;
let _writeFile: FileWriteFn;
let _badgesDir: string;

export function initDemo(opts: {
  broadcast: BroadcastFn;
  writeFile: FileWriteFn;
  badgesDir: string;
}) {
  _broadcast = opts.broadcast;
  _writeFile = opts.writeFile;
  _badgesDir = opts.badgesDir;
}

function createDemoBadge(): string | null {
  if (!state.running) return null;

  const dept = pick(DEPARTMENTS);
  const access = pick(ACCESS_LEVELS);
  const name = state.created < DEMO_NAMES.length
    ? DEMO_NAMES[state.created]
    : `EMPLOYEE #${state.created + 1}`;

  try {
    const result = createBadge({
      name,
      department: dept.name,
      title: pick(TITLES),
      song: pick(SONGS),
      accessLevel: access.label,
      accessCss: access.css,
      hasPhoto: false,
      photoPublic: true,
      source: 'demo',
      isDemo: true,
    });

    // Write placeholder badge PNG
    _writeFile(join(_badgesDir, `${result.employeeId}.png`), PLACEHOLDER_PNG);

    // Broadcast SSE event
    _broadcast({
      employeeId: result.employeeId,
      name,
      department: dept.name,
      title: pick(TITLES),
      accessLevel: access.label,
      accessCss: access.css,
      isBandMember: false,
    });

    state.created++;
    state.createdIds.push(result.employeeId);
    log('info', 'demo', `Badge ${state.created}/${state.total}: ${name} → ${dept.name} (${result.employeeId})`);

    return result.employeeId;
  } catch (err: any) {
    log('error', 'demo', `Badge creation failed: ${err.message}`);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────

export function startDemo(count: number, durationSec: number) {
  if (state.running) {
    return { error: 'Demo already running.' };
  }

  const total = Math.min(Math.max(count, 5), 100); // clamp 5-100
  const duration = Math.min(Math.max(durationSec, 10), 900) * 1000; // clamp 10s-15min

  state.running = true;
  state.total = total;
  state.created = 0;
  state.createdIds = [];
  state.timers = [];

  log('info', 'demo', `Starting demo: ${total} badges over ${durationSec}s`);

  // Schedule badges at randomized intervals
  // Reserve one slot for the concurrent pair test
  const singleCount = total - 2; // 2 badges will be concurrent
  const concurrentIndex = Math.floor(singleCount * 0.6); // ~60% through

  // Generate randomized timestamps spread across duration
  const times: number[] = [];
  for (let i = 0; i < singleCount; i++) {
    // Spread evenly with jitter
    const base = (i / singleCount) * duration;
    const jitter = (Math.random() - 0.5) * (duration / singleCount) * 0.6;
    times.push(Math.max(0, base + jitter));
  }
  times.sort((a, b) => a - b);

  // Schedule single badge creations
  let scheduled = 0;
  for (let i = 0; i < times.length; i++) {
    if (i === concurrentIndex) {
      // Schedule the concurrent pair at this time
      const t = times[i];
      state.timers.push(setTimeout(() => {
        log('info', 'demo', 'Concurrent pair test: creating 2 badges simultaneously');
        createDemoBadge();
        createDemoBadge();
      }, t));
      scheduled += 2;
    } else {
      state.timers.push(setTimeout(() => createDemoBadge(), times[i]));
      scheduled++;
    }
  }

  // If we haven't scheduled enough (due to concurrentIndex math), add remaining
  while (scheduled < total) {
    const t = duration * 0.95; // near the end
    state.timers.push(setTimeout(() => createDemoBadge(), t));
    scheduled++;
  }

  // Auto-stop when done
  state.timers.push(setTimeout(() => {
    if (state.running) {
      state.running = false;
      log('info', 'demo', `Demo complete: ${state.created}/${state.total} badges created`);
    }
  }, duration + 2000));

  return { started: true, total, durationSec };
}

export function stopDemo() {
  if (!state.running) {
    return { error: 'No demo running.' };
  }

  for (const t of state.timers) clearTimeout(t);
  state.timers = [];
  state.running = false;
  log('info', 'demo', `Demo stopped early: ${state.created}/${state.total} badges created`);

  return { stopped: true, created: state.created, total: state.total };
}

export function getDemoStatus() {
  return {
    running: state.running,
    created: state.created,
    total: state.total,
  };
}

export function cleanupDemo(badgesDir: string, thumbsDir: string): { deleted: number } {
  // Stop any running demo first
  if (state.running) {
    for (const t of state.timers) clearTimeout(t);
    state.timers = [];
    state.running = false;
  }

  // Get IDs before deleting from DB
  const ids = listDemoBadgeIds();

  // Delete files
  let filesDeleted = 0;
  for (const id of ids) {
    for (const dir of [badgesDir, thumbsDir]) {
      const path = join(dir, `${id}.png`);
      try {
        if (existsSync(path)) {
          unlinkSync(path);
          filesDeleted++;
        }
      } catch { /* ignore */ }
    }
    // Also try -nophoto variant
    try {
      const np = join(badgesDir, `${id}-nophoto.png`);
      if (existsSync(np)) unlinkSync(np);
    } catch { /* ignore */ }
  }

  // Delete from DB
  const deleted = deleteDemoBadges();
  log('info', 'demo', `Cleanup: ${deleted} demo badges deleted, ${filesDeleted} files removed`);

  // Reset state
  state.created = 0;
  state.total = 0;
  state.createdIds = [];

  return { deleted };
}
