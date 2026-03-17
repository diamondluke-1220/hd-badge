// ─── Public API Routes ────────────────────────────────────
// Badge creation, retrieval, images, org chart.

import type { Hono } from 'hono';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import sharp from 'sharp';
import { createBadge, getBadge, listBadges, softDeleteBadge, hardDeleteBadge, setHasPhoto, getStats } from '../db';
import { checkRateLimit } from '../rate-limit';
import { isNameClean, shouldFlag } from '../profanity';
import { isPresentationActive } from '../presentation';
import { log } from '../logger';

interface PublicDeps {
  getClientIp: (c: any) => string;
  markPortalCleared: (ip: string) => void;
  broadcastNewBadge: (badge: { employeeId: string; name: string; department: string; title: string; accessLevel: string; accessCss: string; isBandMember: boolean }) => void;
  decodeBase64Image: (dataUrl: string) => Buffer | null;
  renderBadgePlaywright: (badge: any, options?: { withPhoto?: boolean; print?: boolean }) => Promise<Buffer>;
  clampField: (val: string) => string;
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
    getClientIp, markPortalCleared, broadcastNewBadge,
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

    const { name, department, title, song, accessLevel, accessCss, photo, photoPublic } = body;

    if (!name || !department || !title || !song || !accessLevel || !accessCss) {
      return c.json({ success: false, error: 'Missing required fields.' }, 400);
    }

    if (!isNameClean(name)) {
      return c.json({ success: false, error: 'HR has flagged your name for review.' }, 400);
    }

    try {
      const hasPhoto = !!photo;
      let photoBuffer: Buffer | null = null;
      if (photo) {
        photoBuffer = decodeBase64Image(photo);
        if (photoBuffer) {
          try {
            await sharp(photoBuffer).metadata();
          } catch {
            return c.json({ success: false, error: 'Invalid image file.' }, 400);
          }
        }
      }

      const cleanName = clampField(name.trim().toUpperCase());
      const cleanTitle = clampField(title.trim());
      const flagged = shouldFlag(cleanName) || shouldFlag(cleanTitle);

      if (isPresentationActive() && flagged) {
        return c.json({ success: false, error: 'Badge content requires review. Try again after the show.' }, 400);
      }

      const result = createBadge({
        name: cleanName,
        department: clampField(department.trim().toUpperCase()),
        title: cleanTitle,
        song: clampField(song.trim().toUpperCase()),
        accessLevel: clampField(accessLevel.trim().toUpperCase()),
        accessCss: clampField(accessCss.trim()),
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
        throw renderErr;
      }

      markPortalCleared(ip);

      broadcastNewBadge({
        employeeId: result.employeeId,
        name: cleanName,
        department: clampField(department.trim().toUpperCase()),
        title: cleanTitle,
        accessLevel: clampField(accessLevel.trim().toUpperCase()),
        accessCss: clampField(accessCss.trim()),
        isBandMember: false,
      });

      log('info', 'badge', `Created ${result.employeeId}: ${cleanName} → ${clampField(department.trim().toUpperCase())}`);

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

  // ─── Badge Image ─────────────────────────────────────────

  app.get('/api/badge/:id/image', (c) => {
    const id = c.req.param('id');
    const badge = getBadge(id);
    if (!badge) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }

    const authHeader = c.req.header('authorization');
    const isAdmin = !!ADMIN_TOKEN && authHeader === `Bearer ${ADMIN_TOKEN}` && c.req.query('full') === '1';

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

  // ─── Print-Ready Badge ───────────────────────────────────

  const printRateLimit = new Map<string, number[]>();
  app.get('/api/badge/:id/print', async (c) => {
    const ip = getClientIp(c);
    const now = Date.now();
    const timestamps = (printRateLimit.get(ip) || []).filter(t => t > now - 60_000);
    if (timestamps.length >= 5) {
      return c.json({ success: false, error: 'Too many print requests. Try again in a minute.' }, 429);
    }
    timestamps.push(now);
    printRateLimit.set(ip, timestamps);

    const id = c.req.param('id');
    const badge = getBadge(id);
    if (!badge) {
      return c.json({ success: false, error: 'Badge not found.' }, 404);
    }

    const printBuffer = await renderBadgePlaywright(badge, { print: true });
    return new Response(printBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="${id}-print.png"`,
        'Cache-Control': 'no-cache',
      },
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

    return c.json({ success: true, message: 'Your badge has been shredded.' });
  });

  // ─── Org Chart ───────────────────────────────────────────

  app.get('/api/orgchart', (c) => {
    const department = c.req.query('department') || undefined;
    const division = c.req.query('division') || undefined;
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const recentFirst = c.req.query('recentFirst') === '1';

    const result = listBadges({ department, division, page, limit, recentFirst });

    return c.json({
      badges: result.badges.map(b => ({
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
      })),
      total: result.total,
      page: result.page,
      pages: result.pages,
    });
  });

  app.get('/api/orgchart/stats', (c) => {
    return c.json(getStats());
  });
}
