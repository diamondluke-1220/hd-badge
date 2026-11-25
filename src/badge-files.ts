// The files stored on disk for each badge, and the rules for removing them.
// Every place that deletes badge files reads this one list, so a new file kind
// is added here once.

import { existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

export interface BadgeDirs {
  BADGES_DIR: string;
  PHOTOS_DIR: string;
  THUMBS_DIR: string;
  HEADSHOTS_DIR: string;
}

/** Each kind of badge file: the directory it lives in and its file name for an ID. */
function badgeFileKinds(dirs: BadgeDirs): { dir: string; ext: string; name: (id: string) => string }[] {
  return [
    { dir: dirs.BADGES_DIR, ext: '.png', name: id => `${id}.png` },
    { dir: dirs.BADGES_DIR, ext: '.png', name: id => `${id}-nophoto.png` },
    { dir: dirs.PHOTOS_DIR, ext: '.jpg', name: id => `${id}.jpg` },
    { dir: dirs.THUMBS_DIR, ext: '.png', name: id => `${id}.png` },
    { dir: dirs.HEADSHOTS_DIR, ext: '.jpg', name: id => `${id}.jpg` },
  ];
}

/** Every path a badge's files can have: render, no-photo render, photo, thumbnail, headshot. */
export function badgeFilePaths(dirs: BadgeDirs, id: string): string[] {
  return badgeFileKinds(dirs).map(k => join(k.dir, k.name(id)));
}

/** Deletes every file stored for a badge. Missing files are skipped. Returns how many were removed. */
export function removeBadgeFiles(dirs: BadgeDirs, id: string): number {
  let removed = 0;
  for (const path of badgeFilePaths(dirs, id)) {
    try {
      if (existsSync(path)) { unlinkSync(path); removed++; }
    } catch { /* already gone or unreadable: nothing to remove */ }
  }
  return removed;
}

/**
 * Deletes badge files whose ID is not in knownIds, e.g. left behind when a
 * badge row was removed. Files of other types are left alone. Returns the count.
 */
export function sweepOrphanFiles(dirs: BadgeDirs, knownIds: Set<string>): number {
  const scanned = new Map<string, string>();
  for (const k of badgeFileKinds(dirs)) scanned.set(`${k.dir}\0${k.ext}`, k.dir);
  let removed = 0;
  for (const key of scanned.keys()) {
    const [dir, ext] = key.split('\0');
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(ext)) continue;
      const id = file.replace(/-nophoto/, '').replace(ext, '');
      if (!knownIds.has(id)) {
        try { unlinkSync(join(dir, file)); removed++; } catch { /* already gone */ }
      }
    }
  }
  return removed;
}
