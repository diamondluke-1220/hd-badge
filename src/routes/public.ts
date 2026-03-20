// ─── Public API Routes ────────────────────────────────────
// Badge creation, retrieval, images, org chart.

import type { Hono } from 'hono';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { timingSafeEqual } from 'crypto';
import sharp from 'sharp';
import { createBadge, getBadge, updateBadge, listBadges, softDeleteBadge, hardDeleteBadge, setHasPhoto, getStats, serializeBadge } from '../db';
import { checkRateLimit } from '../rate-limit';
import { isNameClean, shouldFlag } from '../profanity';
import { isPresentationActive } from '../presentation';
import { log } from '../logger';

// Band-exclusive values — fans cannot use these (enforced on create)
const RESERVED_DEPTS = new Set([
  'TICKET ESCALATION BUREAU',
  'AUDIO ENGINEERING DIVISION',
  'DEPT. OF PERCUSSIVE MAINTENANCE',
  'INFRASTRUCTURE & POWER CHORDS',
  'LOW FREQUENCY OPERATIONS',
]);
const RESERVED_TITLES = new Set([
  'CHIEF ESCALATION OFFICER',
  'CHIEF AUDIO ARCHITECT',
  'CHIEF IMPACT OFFICER',
  'VP OF POWER DISTRIBUTION',
  'VP OF BOTTOM LINE OPERATIONS',
]);
const RESERVED_ACCESS = new Set([
  'ALL ACCESS',
]);

interface PublicDeps {
  getClientIp: (c: any) => string;
  markPortalCleared: (ip: string) => void;
  broadcastNewBadge: (badge: { employeeId: string; name: string; department: string; title: string; accessLevel: string; accessCss: string; isBandMember: boolean }) => void;
  broadcastSSE: (event: string, data: any) => void;
  decodeBase64Image: (dataUrl: string) => Buffer | null;
  renderBadgePlaywright: (badge: any, options?: { withPhoto?: boolean; print?: boolean }) => Promise<Buffer>;
  clampField: (val: string, field?: string) => string;
  PHOTOS_DIR: string;
  BADGES_DIR: string;
  THUMBS_DIR: string;
  HEADSHOTS_DIR: string;
  ADMIN_TOKEN: string;
  THUMB_WIDTH: number;
  HEADSHOT_WIDTH: number;
}

export function registerPublicRoutes(app: Hono, deps: PublicDeps) {
  const {
    getClientIp, markPortalCleared, broadcastNewBadge, broadcastSSE,
    decodeBase64Image, renderBadgePlaywright, clampField,
    PHOTOS_DIR, BADGES_DIR, THUMBS_DIR, HEADSHOTS_DIR,
    ADMIN_TOKEN, THUMB_WIDTH, HEADSHOT_WIDTH,
  } = deps;

  // ─── Badge Creation ──────────────────────────────────────

  app.post('/api/badge', async (c) => {
    const ip = getClientIp(c);

    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return c.json({ success: false, error: rateCheck.message }, 429);
    }

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid request body.' }, 400);
    }

    const { name, department, title, song, accessLevel, accessCss, caption, photo, photoPublic } = body;

    if (!name || !department || !title || !song || !accessLevel || !accessCss) {
      return c.json({ success: false, error: 'Missing required fields.' }, 400);
    }

    // Check all user-supplied text fields for hate speech
    const textFields = [name, department, title, song, accessLevel, accessCss, ...(caption ? [caption] : [])];
    for (const field of textFields) {
      if (!isNameClean(field)) {
        return c.json({ success: false, error: 'HR has flagged your submission for review.' }, 400);
      }
    }

    // Block band-exclusive departments, titles, and access levels
    const deptUpper = department.trim().toUpperCase();
    const titleUpper = title.trim().toUpperCase();
    const accessUpper = accessLevel.trim().toUpperCase();
    if (RESERVED_DEPTS.has(deptUpper)) {
      return c.json({ success: false, error: 'That department is reserved for executive staff.' }, 400);
    }
    if (RESERVED_TITLES.has(titleUpper)) {
      return c.json({ success: false, error: 'That title is reserved for executive staff.' }, 400);
    }
    if (RESERVED_ACCESS.has(accessUpper)) {
      return c.json({ success: false, error: 'ALL ACCESS clearance requires executive authorization.' }, 400);
    }

    try {
      const hasPhoto = !!photo;
      let photoBuffer: Buffer | null = null;
      if (photo) {
        photoBuffer = decodeBase64Image(photo);
        if (photoBuffer) {
          // Validate magic bytes: JPEG (FF D8 FF) or PNG (89 50 4E 47)
          const isJpeg = photoBuffer[0] === 0xFF && photoBuffer[1] === 0xD8 && photoBuffer[2] === 0xFF;
          const isPng = photoBuffer[0] === 0x89 && photoBuffer[1] === 0x50 && photoBuffer[2] === 0x4E && photoBuffer[3] === 0x47;
          if (!isJpeg && !isPng) {
            return c.json({ success: false, error: 'Invalid image file. JPEG or PNG only.' }, 400);
          }
          try {
            const meta = await sharp(photoBuffer).metadata();
            if (!meta.width || !meta.height || meta.width > 8000 || meta.height > 8000) {
              return c.json({ success: false, error: 'Image too large. Max 8000x8000 pixels.' }, 400);
            }
          } catch {
            return c.json({ success: false, error: 'Invalid image file.' }, 400);
          }
        }
      }

      const cleanName = clampField(name.trim().toUpperCase(), 'name');
      const cleanTitle = clampField(title.trim(), 'title');
      const cleanDept = clampField(department.trim().toUpperCase(), 'department');
      const cleanSong = clampField(song.trim().toUpperCase(), 'song');
      const cleanAccess = clampField(accessLevel.trim().toUpperCase(), 'accessLevel');
      const cleanCaption = caption ? clampField(caption.trim().toUpperCase(), 'caption') : 'SCAN TO FILE COMPLAINT';
      const flagged = [cleanName, cleanTitle, cleanDept, cleanSong, cleanAccess, cleanCaption].some(f => shouldFlag(f));

      if (isPresentationActive() && flagged) {
        return c.json({ success: false, error: 'Badge content requires review. Try again after the show.' }, 400);
      }

      // Clean up previous badge from same device (hard-delete only if token is valid)
      if (body.previousBadgeId && body.previousToken) {
        // softDeleteBadge verifies the hashed token — use it as auth check
        const tokenValid = softDeleteBadge(body.previousBadgeId, body.previousToken);
        if (tokenValid) {
          // Token matched — now fully remove the soft-deleted badge
          hardDeleteBadge(body.previousBadgeId);
          const prevFiles = [
            join(BADGES_DIR, `${body.previousBadgeId}.png`),
            join(BADGES_DIR, `${body.previousBadgeId}-nophoto.png`),
            join(PHOTOS_DIR, `${body.previousBadgeId}.jpg`),
            join(THUMBS_DIR, `${body.previousBadgeId}.png`),
            join(HEADSHOTS_DIR, `${body.previousBadgeId}.jpg`),
          ];
          for (const f of prevFiles) {
            try { unlinkSync(f); } catch { /* ignore */ }
          }
          log('info', 'badge', `Cleaned up previous badge ${body.previousBadgeId} on recreate`);
        }
      }

      const cleanCss = clampField(accessCss.trim(), 'accessCss');
      const result = createBadge({
        name: cleanName,
        department: cleanDept,
        title: cleanTitle,
        song: cleanSong,
        accessLevel: cleanAccess,
        accessCss: cleanCss,
        caption: cleanCaption,
        hasPhoto,
        photoPublic: photoPublic !== false,
        source: body.source || 'web',
        flagged,
      });

      if (photoBuffer) {
        await Bun.write(join(PHOTOS_DIR, `${result.employeeId}.jpg`), photoBuffer);
      }

      let badge, badgeBuffer;
      try {
        badge = getBadge(result.employeeId);
        badgeBuffer = await renderBadgePlaywright(badge);
        await Bun.write(join(BADGES_DIR, `${result.employeeId}.png`), badgeBuffer);

        if (hasPhoto && photoPublic === false) {
          const noPhotoBuffer = await renderBadgePlaywright(badge, { withPhoto: false });
          await Bun.write(join(BADGES_DIR, `${result.employeeId}-nophoto.png`), noPhotoBuffer);
        }
      } catch (renderErr: any) {
        log('error', 'badge', `Render failed for ${result.employeeId}, cleaning up: ${renderErr.message}`);
        hardDeleteBadge(result.employeeId);
        try { unlinkSync(join(PHOTOS_DIR, `${result.employeeId}.jpg`)); } catch { /* ignore */ }
        try { unlinkSync(join(BADGES_DIR, `${result.employeeId}.png`)); } catch { /* ignore */ }
        try { unlinkSync(join(BADGES_DIR, `${result.employeeId}-nophoto.png`)); } catch { /* ignore */ }
        throw renderErr;
      }

      markPortalCleared(ip);

      broadcastNewBadge({
        employeeId: result.employeeId,
        name: cleanName,
        department: cleanDept,
        title: cleanTitle,
        accessLevel: cleanAccess,
        accessCss: cleanCss,
        isBandMember: false,
      });

      log('info', 'badge', `Created ${result.employeeId}: ${cleanName} → ${cleanDept}`);

      return c.json({
        success: true,
        employeeId: result.employeeId,
        deleteToken: result.deleteToken,
        message: 'Welcome to Help Desk LLC.',
      });
    } catch (err: any) {
      log('error', 'badge', `Creation failed: ${err.message}`);
      return c.json({ success: false, error: 'Badge creation failed. Please try again.' }, 500);
    }
  });

  // ─── Badge Metadata ──────────────────────────────────────

  app.get('/api/badge/:id', (c) => {
    const badge = getBadge(c.req.param('id'));
    if (!badge || !badge.is_visible) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }

    return c.json({
      employeeId: badge.employee_id,
      name: badge.name,
      department: badge.department,
      title: badge.title,
      song: badge.song,
      accessLevel: badge.access_level,
      accessCss: badge.access_css,
      hasPhoto: !!badge.has_photo,
      photoPublic: !!badge.photo_public,
      isBandMember: !!badge.is_band_member,
      createdAt: badge.created_at,
    });
  });

  // ─── Badge Edit ──────────────────────────────────────────

  app.put('/api/badge/:id', async (c) => {
    const id = c.req.param('id');

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid request body.' }, 400);
    }

    const { token, name, department, title, song, accessLevel, accessCss, caption, photo, photoPublic } = body;

    if (!token) {
      return c.json({ success: false, error: 'Delete token required for edits.' }, 400);
    }
    if (!name || !department || !title || !song || !accessLevel || !accessCss) {
      return c.json({ success: false, error: 'Missing required fields.' }, 400);
    }

    // Verify badge exists and is visible
    const existing = getBadge(id);
    if (!existing || !existing.is_visible) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }

    // Block edits to band member badges
    if (existing.is_band_member) {
      return c.json({ success: false, error: 'Executive badges cannot be modified.' }, 403);
    }

    // Same validation as creation
    const textFields = [name, department, title, song, accessLevel, accessCss, ...(caption ? [caption] : [])];
    for (const field of textFields) {
      if (!isNameClean(field)) {
        return c.json({ success: false, error: 'HR has flagged your submission for review.' }, 400);
      }
    }

    const deptUpper = department.trim().toUpperCase();
    const titleUpper = title.trim().toUpperCase();
    const accessUpper = accessLevel.trim().toUpperCase();
    if (RESERVED_DEPTS.has(deptUpper)) {
      return c.json({ success: false, error: 'That department is reserved for executive staff.' }, 400);
    }
    if (RESERVED_TITLES.has(titleUpper)) {
      return c.json({ success: false, error: 'That title is reserved for executive staff.' }, 400);
    }
    if (RESERVED_ACCESS.has(accessUpper)) {
      return c.json({ success: false, error: 'ALL ACCESS clearance requires executive authorization.' }, 400);
    }

    try {
      const hasPhoto = photo !== undefined ? !!photo : !!existing.has_photo;
      let photoBuffer: Buffer | null = null;
      if (photo) {
        photoBuffer = decodeBase64Image(photo);
        if (photoBuffer) {
          const isJpeg = photoBuffer[0] === 0xFF && photoBuffer[1] === 0xD8 && photoBuffer[2] === 0xFF;
          const isPng = photoBuffer[0] === 0x89 && photoBuffer[1] === 0x50 && photoBuffer[2] === 0x4E && photoBuffer[3] === 0x47;
          if (!isJpeg && !isPng) {
            return c.json({ success: false, error: 'Invalid image file. JPEG or PNG only.' }, 400);
          }
          try {
            const meta = await sharp(photoBuffer).metadata();
            if (!meta.width || !meta.height || meta.width > 8000 || meta.height > 8000) {
              return c.json({ success: false, error: 'Image too large. Max 8000x8000 pixels.' }, 400);
            }
          } catch {
            return c.json({ success: false, error: 'Invalid image file.' }, 400);
          }
        }
      }

      const cleanName = clampField(name.trim().toUpperCase(), 'name');
      const cleanTitle = clampField(title.trim(), 'title');
      const cleanDept = clampField(department.trim().toUpperCase(), 'department');
      const cleanSong = clampField(song.trim().toUpperCase(), 'song');
      const cleanAccess = clampField(accessLevel.trim().toUpperCase(), 'accessLevel');
      const cleanCss = clampField(accessCss.trim(), 'accessCss');
      const cleanCaption = caption ? clampField(caption.trim().toUpperCase(), 'caption') : existing.caption || 'SCAN TO FILE COMPLAINT';
      const flagged = [cleanName, cleanTitle, cleanDept, cleanSong, cleanAccess, cleanCaption].some(f => shouldFlag(f));

      if (isPresentationActive() && flagged) {
        return c.json({ success: false, error: 'Badge content requires review. Try again after the show.' }, 400);
      }

      const success = updateBadge(id, token, {
        name: cleanName,
        department: cleanDept,
        title: cleanTitle,
        song: cleanSong,
        accessLevel: cleanAccess,
        accessCss: cleanCss,
        caption: cleanCaption,
        hasPhoto,
        photoPublic: photoPublic !== false,
        flagged,
      });

      if (!success) {
        return c.json({ success: false, error: 'Badge not found or invalid token.' }, 403);
      }

      // Write new photo if provided
      if (photoBuffer) {
        await Bun.write(join(PHOTOS_DIR, `${id}.jpg`), photoBuffer);
      }

      // Re-render badge
      const badge = getBadge(id);
      if (badge) {
        const badgeBuffer = await renderBadgePlaywright(badge);
        await Bun.write(join(BADGES_DIR, `${id}.png`), badgeBuffer);

        if (hasPhoto && photoPublic === false) {
          const noPhotoBuffer = await renderBadgePlaywright(badge, { withPhoto: false });
          await Bun.write(join(BADGES_DIR, `${id}-nophoto.png`), noPhotoBuffer);
        }
      }

      // Invalidate cached derivatives
      try { unlinkSync(join(THUMBS_DIR, `${id}.png`)); } catch { /* ignore */ }
      try { unlinkSync(join(HEADSHOTS_DIR, `${id}.jpg`)); } catch { /* ignore */ }

      // Broadcast quiet update (no new-badge animation)
      broadcastSSE('badge-updated', {
        employeeId: id,
        name: cleanName,
        department: cleanDept,
        title: cleanTitle,
        accessLevel: cleanAccess,
        accessCss: cleanCss,
        isBandMember: false,
      });

      log('info', 'badge', `Updated ${id}: ${cleanName} → ${cleanDept}`);

      return c.json({
        success: true,
        employeeId: id,
        message: 'Badge updated successfully.',
      });
    } catch (err: any) {
      log('error', 'badge', `Update failed for ${id}: ${err.message}`);
      return c.json({ success: false, error: 'Badge update failed. Please try again.' }, 500);
    }
  });

  // ─── Badge Image ─────────────────────────────────────────

  app.get('/api/badge/:id/image', (c) => {
    const id = c.req.param('id');
    const badge = getBadge(id);
    if (!badge) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }

    const authHeader = c.req.header('authorization') || '';
    const expected = `Bearer ${ADMIN_TOKEN}`;
    const tokenMatch = ADMIN_TOKEN && authHeader.length === expected.length &&
      timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
    const isAdmin = !!tokenMatch && c.req.query('full') === '1';

    let imagePath: string;
    if (!isAdmin && !badge.photo_public && badge.has_photo) {
      const noPhotoPath = join(BADGES_DIR, `${id}-nophoto.png`);
      imagePath = existsSync(noPhotoPath) ? noPhotoPath : join(BADGES_DIR, `${id}.png`);
    } else {
      imagePath = join(BADGES_DIR, `${id}.png`);
    }

    if (!existsSync(imagePath)) {
      return c.json({ success: false, error: 'Badge image not found.' }, 404);
    }

    const file = Bun.file(imagePath);
    return new Response(file, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' },
    });
  });

  // ─── Headshot Photo ──────────────────────────────────────

  app.get('/api/badge/:id/headshot', async (c) => {
    const id = c.req.param('id');
    const badge = getBadge(id);
    if (!badge) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }

    const photoPath = join(PHOTOS_DIR, `${id}.jpg`);
    const placeholderPath = join('public', 'placeholder-photo.png');
    const hasUsablePhoto = badge.has_photo && badge.photo_public && existsSync(photoPath);

    if (!hasUsablePhoto) {
      if (!existsSync(placeholderPath)) {
        return c.json({ success: false, error: 'Placeholder not found.' }, 404);
      }
      const file = Bun.file(placeholderPath);
      return new Response(file, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
      });
    }

    const headshotPath = join(HEADSHOTS_DIR, `${id}.jpg`);

    let needsGenerate = !existsSync(headshotPath);
    if (!needsGenerate) {
      const sourceStat = await Bun.file(photoPath).stat();
      const headshotStat = await Bun.file(headshotPath).stat();
      if (sourceStat.mtimeMs > headshotStat.mtimeMs) {
        needsGenerate = true;
      }
    }

    if (needsGenerate) {
      try {
        await sharp(photoPath)
          .resize(HEADSHOT_WIDTH)
          .jpeg({ quality: 85 })
          .toFile(headshotPath);
      } catch (err: any) {
        console.error(`Headshot generation failed for ${id}:`, err.message);
        const file = Bun.file(photoPath);
        return new Response(file, {
          headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=60' },
        });
      }
    }

    const file = Bun.file(headshotPath);
    return new Response(file, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
    });
  });

  // ─── Badge Thumbnail ─────────────────────────────────────

  app.get('/api/badge/:id/thumb', async (c) => {
    const id = c.req.param('id');
    const badge = getBadge(id);
    if (!badge) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }

    let sourcePath: string;
    if (!badge.photo_public && badge.has_photo) {
      const noPhotoPath = join(BADGES_DIR, `${id}-nophoto.png`);
      sourcePath = existsSync(noPhotoPath) ? noPhotoPath : join(BADGES_DIR, `${id}.png`);
    } else {
      sourcePath = join(BADGES_DIR, `${id}.png`);
    }

    if (!existsSync(sourcePath)) {
      return c.json({ success: false, error: 'Badge image not found.' }, 404);
    }

    const thumbPath = join(THUMBS_DIR, `${id}.png`);

    let needsGenerate = !existsSync(thumbPath);
    if (!needsGenerate) {
      const sourceStat = await Bun.file(sourcePath).stat();
      const thumbStat = await Bun.file(thumbPath).stat();
      if (sourceStat.mtimeMs > thumbStat.mtimeMs) {
        needsGenerate = true;
      }
    }

    if (needsGenerate) {
      try {
        await sharp(sourcePath)
          .resize(THUMB_WIDTH)
          .png({ quality: 80 })
          .toFile(thumbPath);
      } catch (err: any) {
        console.error(`Thumbnail generation failed for ${id}:`, err.message);
        const file = Bun.file(sourcePath);
        return new Response(file, {
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' },
        });
      }
    }

    const file = Bun.file(thumbPath);
    return new Response(file, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
    });
  });

  // ─── Self-Service Delete ─────────────────────────────────

  app.delete('/api/badge/:id', (c) => {
    const id = c.req.param('id');
    const token = c.req.query('token');

    if (!token) {
      return c.json({ success: false, error: 'Delete token required.' }, 400);
    }

    const success = softDeleteBadge(id, token);
    if (!success) {
      return c.json({ success: false, error: 'Badge not found or invalid token.' }, 403);
    }

    // Clean up all associated files — user asked for deletion
    const files = [
      join(BADGES_DIR, `${id}.png`),
      join(BADGES_DIR, `${id}-nophoto.png`),
      join(PHOTOS_DIR, `${id}.jpg`),
      join(THUMBS_DIR, `${id}.png`),
      join(HEADSHOTS_DIR, `${id}.jpg`),
    ];
    for (const f of files) {
      try { unlinkSync(f); } catch { /* ignore — file may not exist */ }
    }

    return c.json({ success: true, message: 'Your badge has been shredded.' });
  });

  // ─── Org Chart ───────────────────────────────────────────

  app.get('/api/orgchart', (c) => {
    const department = c.req.query('department') || undefined;
    const division = c.req.query('division') || undefined;
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
    const recentFirst = c.req.query('recentFirst') === '1';

    const result = listBadges({ department, division, page, limit, recentFirst });

    return c.json({
      badges: result.badges.map(b => serializeBadge(b)),
      total: result.total,
      page: result.page,
      pages: result.pages,
    });
  });

  app.get('/api/orgchart/stats', (c) => {
    return c.json(getStats());
  });
}
