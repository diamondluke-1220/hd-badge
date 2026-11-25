// The one list of files stored for a badge, and the removal and sweep rules built on it.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { badgeFilePaths, removeBadgeFiles, sweepOrphanFiles, type BadgeDirs } from '../../src/badge-files';

let root: string;
let dirs: BadgeDirs;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hdbadge-files-'));
  dirs = {
    BADGES_DIR: join(root, 'badges'),
    PHOTOS_DIR: join(root, 'photos'),
    THUMBS_DIR: join(root, 'thumbs'),
    HEADSHOTS_DIR: join(root, 'headshots'),
  };
  for (const d of Object.values(dirs)) mkdirSync(d);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function touch(...paths: string[]) {
  for (const p of paths) writeFileSync(p, 'x');
}

describe('badgeFilePaths', () => {
  it('names the five files a badge can have', () => {
    expect(badgeFilePaths(dirs, 'HD-12345')).toEqual([
      join(dirs.BADGES_DIR, 'HD-12345.png'),
      join(dirs.BADGES_DIR, 'HD-12345-nophoto.png'),
      join(dirs.PHOTOS_DIR, 'HD-12345.jpg'),
      join(dirs.THUMBS_DIR, 'HD-12345.png'),
      join(dirs.HEADSHOTS_DIR, 'HD-12345.jpg'),
    ]);
  });
});

describe('removeBadgeFiles', () => {
  it('removes every file the badge has, skips missing ones, and counts what it removed', () => {
    const [png, , photo, thumb] = badgeFilePaths(dirs, 'HD-12345');
    touch(png, photo, thumb);
    expect(removeBadgeFiles(dirs, 'HD-12345')).toBe(3);
    for (const p of badgeFilePaths(dirs, 'HD-12345')) expect(existsSync(p)).toBe(false);
  });

  it("leaves other badges' files alone", () => {
    touch(...badgeFilePaths(dirs, 'HD-11111'));
    removeBadgeFiles(dirs, 'HD-12345');
    for (const p of badgeFilePaths(dirs, 'HD-11111')) expect(existsSync(p)).toBe(true);
  });
});

describe('sweepOrphanFiles', () => {
  it('removes files for unknown badges, keeps known ones and unrelated files, and counts removals', () => {
    touch(...badgeFilePaths(dirs, 'HD-11111'), ...badgeFilePaths(dirs, 'HD-99999'));
    touch(join(dirs.BADGES_DIR, 'notes.txt'));
    expect(sweepOrphanFiles(dirs, new Set(['HD-11111']))).toBe(5);
    for (const p of badgeFilePaths(dirs, 'HD-11111')) expect(existsSync(p)).toBe(true);
    for (const p of badgeFilePaths(dirs, 'HD-99999')) expect(existsSync(p)).toBe(false);
    expect(readdirSync(dirs.BADGES_DIR)).toContain('notes.txt');
  });
});
